/**
 * Extraction Worker Service
 * Background processing of extraction_queue using gemma2:2b
 * 
 * Extracts: people, projects, systems, organizations from documents
 * Stores results as document_tags
 */

const { getDb } = require('../db/connection');

// Import relationship extraction services
let entityExtractor = null;
let intelligencePersistence = null;
try {
  entityExtractor = require('./entity-extractor');
  intelligencePersistence = require('./intelligence-persistence');
  console.log('[Extraction] Relationship extraction services loaded');
} catch (e) {
  console.log('[Extraction] Relationship extraction services not available:', e.message);
}

const OLLAMA_HOST = process.env.OLLAMA_HOST || 'http://localhost:11434';
const POLL_INTERVAL = 10000; // 10 seconds between queue checks
const MAX_ATTEMPTS = 3;

// Extraction prompt - constrained to minimize hallucination
// NOTE: Semantic tags (insight, action, question, etc.) are extracted via regex markers during ingest
const EXTRACTION_PROMPT = `You are an entity extractor. Given the text below, identify:
- PEOPLE: Names of individuals mentioned (e.g., "Clara", "Jan")
- PROJECTS: Project or product names (e.g., "DNA-C", "Portal Redesign")
- SYSTEMS: Software systems or tools (e.g., "Leonardo", "Confluence")
- ORGANIZATIONS: Companies or teams (e.g., "Acme Corp", "Platform team")

RULES:
1. Only extract entities EXPLICITLY mentioned in the text
2. Do NOT infer or guess entities not directly stated
3. Do NOT add descriptions or context
4. If uncertain, do NOT include

Output as JSON only, no other text:
{
  "people": ["name1", "name2"],
  "projects": ["project1"],
  "systems": ["system1"],
  "organizations": ["org1"]
}

TEXT:
`;

class ExtractionWorker {
  constructor() {
    this.isRunning = false;
    this.intervalId = null;
    this.currentModel = null;
  }

  /**
   * Start the background worker
   */
  start() {
    if (this.isRunning) {
      console.log('[Extraction] Worker already running');
      return;
    }

    console.log('[Extraction] Starting background worker...');
    this.isRunning = true;
    
    // Initial check
    this.processQueue();
    
    // Poll for new items
    this.intervalId = setInterval(() => {
      this.processQueue();
    }, POLL_INTERVAL);
  }

  /**
   * Stop the background worker
   */
  stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    this.isRunning = false;
    console.log('[Extraction] Worker stopped');
  }

  /**
   * Get the extraction model from llm_configs
   */
  async getExtractionModel() {
    const db = getDb();
    if (!db) return 'gemma2:2b'; // fallback

    try {
      const config = db.prepare(
        "SELECT model_name, fallback_models FROM llm_configs WHERE task = 'extraction'"
      ).get();
      
      if (config) {
        // Check if primary model is available
        const isAvailable = await this.isModelAvailable(config.model_name);
        if (isAvailable) {
          return config.model_name;
        }
        
        // Try fallbacks
        if (config.fallback_models) {
          const fallbacks = JSON.parse(config.fallback_models);
          for (const fallback of fallbacks) {
            const fallbackAvailable = await this.isModelAvailable(fallback);
            if (fallbackAvailable) {
              console.log(`[Extraction] Using fallback model: ${fallback}`);
              return fallback;
            }
          }
        }
      }
    } catch (e) {
      console.error('[Extraction] Error getting model config:', e.message);
    }
    
    return 'gemma2:2b';
  }

  /**
   * Check if a model is available in Ollama
   */
  async isModelAvailable(modelName) {
    try {
      const response = await fetch(`${OLLAMA_HOST}/api/tags`);
      if (!response.ok) return false;
      
      const data = await response.json();
      return data.models?.some(m => m.name.startsWith(modelName)) || false;
    } catch (e) {
      return false;
    }
  }

  /**
   * Process pending items in the queue
   */
  async processQueue() {
    const db = getDb();
    if (!db) return;

    try {
      // Get next pending item (include rte_id and filepath for relationship extraction)
      const item = db.prepare(`
        SELECT eq.*, rd.raw_content, rd.filename, rd.rte_id, rd.filepath
        FROM extraction_queue eq
        JOIN rte_documents rd ON eq.document_id = rd.id
        WHERE eq.status = 'pending'
        ORDER BY eq.created_at ASC
        LIMIT 1
      `).get();

      if (!item) return; // No pending items

      console.log(`[Extraction] Processing document ${item.document_id}: ${item.filename}`);

      // Mark as processing
      db.prepare(`
        UPDATE extraction_queue 
        SET status = 'processing', started_at = datetime('now')
        WHERE id = ?
      `).run(item.id);

      // Get content to extract from
      const content = item.raw_content || '';
      if (!content.trim()) {
        this.markComplete(item.id, item.document_id, {});
        return;
      }

      // Get model
      if (!this.currentModel) {
        this.currentModel = await this.getExtractionModel();
      }

      // Call LLM for extraction (flat entity tags)
      const entities = await this.extractEntities(content, this.currentModel);

      if (entities) {
        // Store entities as tags
        await this.storeEntities(item.document_id, entities);
        this.markComplete(item.id, item.document_id, entities);
      } else {
        this.markFailed(item.id, item.attempts, 'Extraction returned no valid entities');
      }

      // Also run relationship extraction (EntityExtractor → IntelligencePersistence)
      if (entityExtractor && intelligencePersistence && item.rte_id) {
        try {
          const extraction = await entityExtractor.extract(content, { rteId: item.rte_id });
          if (extraction.entities.length > 0 || extraction.relationships.length > 0) {
            const stats = intelligencePersistence.save(extraction, item.rte_id, item.filepath || null);
            console.log(`[Extraction] Relationships: ${stats.actors} actors, ${stats.suggestions} suggestions for document ${item.document_id}`);
          }
        } catch (relErr) {
          console.error(`[Extraction] Relationship extraction failed for document ${item.document_id}:`, relErr.message);
          // Don't fail the whole extraction - entity tags were already saved
        }
      }

    } catch (err) {
      console.error('[Extraction] Queue processing error:', err.message);
    }
  }

  /**
   * Call Ollama to extract entities
   */
  async extractEntities(content, model) {
    try {
      // Truncate very long content
      const maxTokens = 4000;
      const truncatedContent = content.length > maxTokens * 4 
        ? content.substring(0, maxTokens * 4) + '\n...[truncated]'
        : content;

      const response = await fetch(`${OLLAMA_HOST}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: model,
          prompt: EXTRACTION_PROMPT + truncatedContent,
          stream: false,
          options: {
            temperature: 0.1,
            num_predict: 500
          }
        })
      });

      if (!response.ok) {
        throw new Error(`Ollama returned ${response.status}`);
      }

      const data = await response.json();
      const responseText = data.response || '';

      // Parse JSON from response
      const entities = this.parseEntitiesJson(responseText);
      return entities;

    } catch (err) {
      console.error('[Extraction] LLM error:', err.message);
      return null;
    }
  }

  /**
   * Parse JSON from LLM response (handles markdown code blocks)
   */
  parseEntitiesJson(text) {
    try {
      // Try to find JSON in the response
      let jsonStr = text;
      
      // Remove markdown code blocks if present
      const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (jsonMatch) {
        jsonStr = jsonMatch[1];
      }
      
      // Try to find JSON object
      const objectMatch = jsonStr.match(/\{[\s\S]*\}/);
      if (objectMatch) {
        jsonStr = objectMatch[0];
      }

      const parsed = JSON.parse(jsonStr);
      
      // Validate structure - entities only (semantic tags extracted via markers during ingest)
      return {
        people: Array.isArray(parsed.people) ? parsed.people.filter(p => typeof p === 'string') : [],
        projects: Array.isArray(parsed.projects) ? parsed.projects.filter(p => typeof p === 'string') : [],
        systems: Array.isArray(parsed.systems) ? parsed.systems.filter(p => typeof p === 'string') : [],
        organizations: Array.isArray(parsed.organizations) ? parsed.organizations.filter(p => typeof p === 'string') : []
      };

    } catch (e) {
      console.error('[Extraction] JSON parse error:', e.message);
      console.error('[Extraction] Raw response:', text.substring(0, 200));
      return null;
    }
  }

  /**
   * Store extracted entities as document_tags
   * Filters out blocklisted value+type combinations
   */
  async storeEntities(documentId, entities) {
    const db = getDb();
    if (!db) return;

    const insertTag = db.prepare(`
      INSERT OR IGNORE INTO document_tags (document_id, tag_type, tag_value)
      VALUES (?, ?, ?)
    `);

    // Load blocklist for efficient lookup
    const blocklist = this.getBlocklist(db);

    let count = 0;
    let blocked = 0;

    // Store people
    for (const person of entities.people || []) {
      const value = person.trim();
      if (value) {
        if (this.isBlocked(blocklist, value, 'person')) {
          console.log(`[Extraction] Blocked: "${value}" as person (in blocklist)`);
          blocked++;
        } else {
          insertTag.run(documentId, 'person', value);
          count++;
        }
      }
    }

    // Store projects
    for (const project of entities.projects || []) {
      const value = project.trim();
      if (value) {
        if (this.isBlocked(blocklist, value, 'project')) {
          console.log(`[Extraction] Blocked: "${value}" as project (in blocklist)`);
          blocked++;
        } else {
          insertTag.run(documentId, 'project', value);
          count++;
        }
      }
    }

    // Store systems
    for (const system of entities.systems || []) {
      const value = system.trim();
      if (value) {
        if (this.isBlocked(blocklist, value, 'system')) {
          console.log(`[Extraction] Blocked: "${value}" as system (in blocklist)`);
          blocked++;
        } else {
          insertTag.run(documentId, 'system', value);
          count++;
        }
      }
    }

    // Store organizations
    for (const org of entities.organizations || []) {
      const value = org.trim();
      if (value) {
        if (this.isBlocked(blocklist, value, 'organization')) {
          console.log(`[Extraction] Blocked: "${value}" as organization (in blocklist)`);
          blocked++;
        } else {
          insertTag.run(documentId, 'organization', value);
          count++;
        }
      }
    }

    // NOTE: Semantic tags (insight, action, question, etc.) are extracted via markers during ingest
    // See routes/ingest.js extractSemanticMarkers()

    if (blocked > 0) {
      console.log(`[Extraction] Stored ${count} entities, blocked ${blocked} for document ${documentId}`);
    } else {
      console.log(`[Extraction] Stored ${count} entities for document ${documentId}`);
    }
  }

  /**
   * Load blocklist from database
   * @returns {Map<string, Set<string>>} Map of lowercase tag_value to Set of blocked types
   */
  getBlocklist(db) {
    const blocklist = new Map();
    
    try {
      const rows = db.prepare(`SELECT tag_value, blocked_type FROM extraction_blocklist`).all();
      
      for (const row of rows) {
        const key = row.tag_value.toLowerCase();
        if (!blocklist.has(key)) {
          blocklist.set(key, new Set());
        }
        blocklist.get(key).add(row.blocked_type);
      }
    } catch (e) {
      // Table might not exist yet (migration pending)
      console.log('[Extraction] Blocklist table not available:', e.message);
    }
    
    return blocklist;
  }

  /**
   * Check if a value+type combination is blocked
   */
  isBlocked(blocklist, value, type) {
    const key = value.toLowerCase();
    const blockedTypes = blocklist.get(key);
    return blockedTypes ? blockedTypes.has(type) : false;
  }

  /**
   * Mark queue item as complete
   */
  markComplete(queueId, documentId, entities) {
    const db = getDb();
    if (!db) return;

    db.prepare(`
      UPDATE extraction_queue 
      SET status = 'complete', completed_at = datetime('now')
      WHERE id = ?
    `).run(queueId);

    db.prepare(`
      UPDATE rte_documents 
      SET extraction_status = 'complete'
      WHERE id = ?
    `).run(documentId);

    const entityCount = Object.values(entities).flat().length;
    console.log(`[Extraction] Complete: document ${documentId} (${entityCount} entities)`);
  }

  /**
   * Mark queue item as failed, handle retry logic
   */
  markFailed(queueId, currentAttempts, errorMessage) {
    const db = getDb();
    if (!db) return;

    const newAttempts = currentAttempts + 1;
    
    if (newAttempts >= MAX_ATTEMPTS) {
      // Move to dead-letter (status = 'dead')
      db.prepare(`
        UPDATE extraction_queue 
        SET status = 'dead', attempts = ?, error_message = ?
        WHERE id = ?
      `).run(newAttempts, errorMessage, queueId);

      db.prepare(`
        UPDATE rte_documents 
        SET extraction_status = 'failed', extraction_error = ?
        WHERE id = (SELECT document_id FROM extraction_queue WHERE id = ?)
      `).run(errorMessage, queueId);

      console.log(`[Extraction] Dead-letter: queue item ${queueId} after ${newAttempts} attempts`);
    } else {
      // Retry later (back to pending)
      db.prepare(`
        UPDATE extraction_queue 
        SET status = 'pending', attempts = ?, error_message = ?
        WHERE id = ?
      `).run(newAttempts, errorMessage, queueId);

      console.log(`[Extraction] Retry scheduled: queue item ${queueId} (attempt ${newAttempts}/${MAX_ATTEMPTS})`);
    }
  }

  /**
   * Retry all failed items (reset to pending)
   */
  retryFailed() {
    const db = getDb();
    if (!db) return { count: 0 };

    const result = db.prepare(`
      UPDATE extraction_queue 
      SET status = 'pending', attempts = 0, error_message = NULL
      WHERE status = 'failed'
    `).run();

    console.log(`[Extraction] Retrying ${result.changes} failed items`);
    return { count: result.changes };
  }

  /**
   * Retry dead-letter items (manual intervention)
   */
  retryDead() {
    const db = getDb();
    if (!db) return { count: 0 };

    const result = db.prepare(`
      UPDATE extraction_queue 
      SET status = 'pending', attempts = 0, error_message = NULL
      WHERE status = 'dead'
    `).run();

    console.log(`[Extraction] Retrying ${result.changes} dead-letter items`);
    return { count: result.changes };
  }

  /**
   * Get queue statistics
   */
  getStats() {
    const db = getDb();
    if (!db) return null;

    const stats = db.prepare(`
      SELECT 
        status,
        COUNT(*) as count
      FROM extraction_queue
      GROUP BY status
    `).all();

    const result = {
      pending: 0,
      processing: 0,
      complete: 0,
      failed: 0,
      dead: 0
    };

    for (const row of stats) {
      result[row.status] = row.count;
    }

    return result;
  }

  /**
   * Manually trigger extraction for a specific document
   * @param {number} documentId - The document ID
   * @param {boolean} clearFirst - If true, clear existing tags before extracting
   */
  async extractDocument(documentId, clearFirst = false) {
    const db = getDb();
    if (!db) return { success: false, error: 'Database not available' };

    try {
      // Get document content
      const doc = db.prepare(`
        SELECT id, raw_content, filename FROM rte_documents WHERE id = ?
      `).get(documentId);

      if (!doc) {
        return { success: false, error: 'Document not found' };
      }

      if (!doc.raw_content) {
        return { success: false, error: 'Document has no content' };
      }

      // Clear existing extracted tags if requested (keep semantic tags)
      if (clearFirst) {
        db.prepare(`
          DELETE FROM document_tags 
          WHERE document_id = ? 
          AND tag_type IN ('person', 'project', 'system', 'organization')
        `).run(documentId);
        console.log(`[Extraction] Cleared existing entity tags for document ${documentId}`);
      }

      // Get model
      const model = await this.getExtractionModel();
      
      // Extract
      const entities = await this.extractEntities(doc.raw_content, model);

      if (entities) {
        await this.storeEntities(documentId, entities);
        
        // Update document status
        db.prepare(`
          UPDATE rte_documents 
          SET extraction_status = 'complete'
          WHERE id = ?
        `).run(documentId);

        return { 
          success: true, 
          entities,
          model
        };
      } else {
        return { success: false, error: 'Extraction failed to parse entities' };
      }

    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  /**
   * Re-process all existing documents for relationship extraction only.
   * This is for backfilling - documents that were ingested before relationship
   * extraction was added to the worker pipeline.
   * @returns {{processed: number, suggestions: number, errors: number}}
   */
  async extractRelationshipsForAll() {
    if (!entityExtractor || !intelligencePersistence) {
      return { processed: 0, suggestions: 0, errors: 0, error: 'Relationship extraction services not available' };
    }

    const db = getDb();
    if (!db) return { processed: 0, suggestions: 0, errors: 0, error: 'Database not available' };

    const docs = db.prepare(`
      SELECT id, rte_id, raw_content, filepath, filename 
      FROM rte_documents 
      WHERE raw_content IS NOT NULL AND raw_content != ''
      ORDER BY id ASC
    `).all();

    let processed = 0;
    let totalSuggestions = 0;
    let errors = 0;

    console.log(`[Extraction] Backfill: processing ${docs.length} documents for relationship extraction...`);

    for (const doc of docs) {
      try {
        const extraction = await entityExtractor.extract(doc.raw_content, { rteId: doc.rte_id });
        if (extraction.entities.length > 0 || extraction.relationships.length > 0) {
          const stats = intelligencePersistence.save(extraction, doc.rte_id, doc.filepath || null);
          totalSuggestions += stats.suggestions || 0;
          console.log(`[Extraction] Backfill ${doc.filename}: ${stats.actors} actors, ${stats.suggestions} suggestions`);
        }
        processed++;
      } catch (err) {
        console.error(`[Extraction] Backfill error for ${doc.filename}:`, err.message);
        errors++;
      }
    }

    console.log(`[Extraction] Backfill complete: ${processed} documents, ${totalSuggestions} suggestions, ${errors} errors`);
    return { processed, suggestions: totalSuggestions, errors };
  }
}

// Singleton instance
let instance = null;

function getInstance() {
  if (!instance) {
    instance = new ExtractionWorker();
  }
  return instance;
}

module.exports = { getInstance, ExtractionWorker };
