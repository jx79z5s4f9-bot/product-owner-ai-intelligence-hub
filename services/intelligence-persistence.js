/**
 * Intelligence Persistence Service
 * Persists extracted entities and relationships to RTE-scoped tables
 * Uses: rte_actors, rte_relationships, rte_relationship_suggestions
 * 
 * Updated for better-sqlite3 synchronous API
 * Phase 2: Added entity deduplication with string-similarity
 */

const { getDb } = require('../db/connection');
const stringSimilarity = require('string-similarity');

class IntelligencePersistence {
  constructor() {
    this.minConfidence = 0.5;  // Minimum confidence to save directly
    this.suggestionThreshold = 0.3;  // Below this, discard
    this.deduplicationThreshold = 0.8;  // 80% similarity = same entity
  }

  /**
   * Save extraction results to database
   * @param {object} extraction - Result from EntityExtractor
   * @param {number} rteId - RTE instance ID
   * @param {string} sourceFile - Source file path (optional)
   * @returns {{actors: number, relationships: number, suggestions: number}}
   */
  save(extraction, rteId, sourceFile = null) {
    const db = getDb();
    if (!db) {
      throw new Error('Database not available');
    }

    const stats = { actors: 0, relationships: 0, suggestions: 0 };

    // 1. Save entities as actors
    for (const entity of extraction.entities || []) {
      try {
        const saved = this.saveActor(db, rteId, entity);
        if (saved) stats.actors++;
      } catch (error) {
        console.error('[IntelligencePersistence] Actor save failed:', entity.name, error.message);
      }
    }

    // 2. Build actor ID map for relationship resolution
    const actorMap = this.buildActorMap(db, rteId);

    // 3. Save ALL relationships as suggestions (simmer pattern)
    // Relationships are never saved directly - they accumulate evidence first
    for (const rel of extraction.relationships || []) {
      try {
        const confidence = rel.confidence || 0.7;
        
        // Skip very low confidence relationships
        if (confidence < this.suggestionThreshold) {
          continue;
        }
        
        // Resolve actor IDs from names
        const sourceId = this.resolveActorId(actorMap, rel.source);
        const targetId = this.resolveActorId(actorMap, rel.target);

        if (!sourceId || !targetId) {
          console.log(`[IntelligencePersistence] Cannot resolve relationship: ${rel.source} -> ${rel.target}`);
          // Try to auto-create missing actors
          if (!sourceId && rel.source) {
            this.saveActor(db, rteId, { name: rel.source, type: 'unknown', confidence: 0.5 });
          }
          if (!targetId && rel.target) {
            this.saveActor(db, rteId, { name: rel.target, type: 'unknown', confidence: 0.5 });
          }
          continue;
        }

        // ALL relationships go to suggestions first (simmer pattern)
        // They only become confirmed when approved by user OR auto-promoted
        const saved = this.saveSuggestion(db, rteId, sourceId, targetId, rel, sourceFile);
        if (saved) stats.suggestions++;
      } catch (error) {
        console.error('[IntelligencePersistence] Relationship save failed:', error.message);
      }
    }

    console.log(`[IntelligencePersistence] Saved: ${stats.actors} actors, ${stats.relationships} relationships, ${stats.suggestions} suggestions`);
    return stats;
  }

  /**
   * Save an entity as an actor (synchronous better-sqlite3)
   * Updates lifecycle tracking: last_seen_at and mention_count
   */
  saveActor(db, rteId, entity) {
    const actorType = entity.actor_type || entity.type || 'unknown';
    const name = entity.name?.trim();
    
    if (!name) {
      return false;
    }

    try {
      const stmt = db.prepare(`
        INSERT INTO rte_actors (rte_id, name, actor_type, description, role, team, organization, metadata_json, created_at, updated_at, last_seen_at, mention_count)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'), datetime('now'), 1)
        ON CONFLICT(rte_id, actor_type, name) DO UPDATE SET
          description = COALESCE(excluded.description, rte_actors.description),
          role = COALESCE(excluded.role, rte_actors.role),
          team = COALESCE(excluded.team, rte_actors.team),
          organization = COALESCE(excluded.organization, rte_actors.organization),
          updated_at = datetime('now'),
          last_seen_at = datetime('now'),
          mention_count = rte_actors.mention_count + 1
      `);

      const result = stmt.run(
        rteId,
        name,
        actorType,
        entity.description || null,
        entity.role || null,
        entity.team || null,
        entity.organization || null,
        JSON.stringify({ confidence: entity.confidence || 0.8, source: entity.source || 'extraction' })
      );

      return result.changes > 0 || result.lastInsertRowid > 0;
    } catch (error) {
      if (!error.message.includes('UNIQUE')) {
        console.error('[IntelligencePersistence] saveActor error:', error.message);
      }
      return false;
    }
  }

  /**
   * Build a map of actor names to IDs for relationship resolution (synchronous)
   */
  buildActorMap(db, rteId) {
    const rows = db.prepare(`SELECT id, name, actor_type FROM rte_actors WHERE rte_id = ?`).all(rteId);

    const map = new Map();
    for (const row of rows) {
      // Map by exact name (lowercase)
      map.set(row.name.toLowerCase(), row.id);
      // Also map by first name for people
      if (row.actor_type === 'person') {
        const firstName = row.name.split(' ')[0].toLowerCase();
        if (!map.has(firstName)) {
          map.set(firstName, row.id);
        }
      }
    }
    return map;
  }

  /**
   * Resolve an actor name to its ID
   */
  resolveActorId(actorMap, name) {
    if (!name) return null;
    
    // Try exact match
    const lower = name.toLowerCase();
    if (actorMap.has(lower)) {
      return actorMap.get(lower);
    }
    
    // Try first name
    const firstName = name.split(' ')[0].toLowerCase();
    if (actorMap.has(firstName)) {
      return actorMap.get(firstName);
    }
    
    return null;
  }

  /**
   * Save a confirmed relationship (synchronous better-sqlite3)
   */
  saveRelationship(db, rteId, sourceActorId, targetActorId, rel, sourceFile) {
    try {
      const stmt = db.prepare(`
        INSERT INTO rte_relationships (rte_id, source_actor_id, target_actor_id, relationship_type, description, context, strength, llm_confidence, source_document_id, is_approved, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, datetime('now'), datetime('now'))
        ON CONFLICT(rte_id, source_actor_id, relationship_type, target_actor_id) DO UPDATE SET
          context = COALESCE(excluded.context, rte_relationships.context),
          llm_confidence = MAX(excluded.llm_confidence, rte_relationships.llm_confidence),
          updated_at = datetime('now')
      `);

      const result = stmt.run(
        rteId,
        sourceActorId,
        targetActorId,
        rel.type || 'related_to',
        rel.description || null,
        rel.context || null,
        rel.strength || 1.0,
        rel.confidence || 0.7,
        sourceFile || null
      );

      return result.changes > 0 || result.lastInsertRowid > 0;
    } catch (error) {
      if (!error.message.includes('UNIQUE')) {
        console.error('[IntelligencePersistence] saveRelationship error:', error.message);
      }
      return false;
    }
  }

  /**
   * Save a relationship suggestion for review (synchronous better-sqlite3)
   * Implements "simmer" pattern: if same relationship seen again, 
   * evidence count increases and confidence auto-adjusts
   */
  saveSuggestion(db, rteId, sourceActorId, targetActorId, rel, documentId = null) {
    try {
      // Check for existing suggestion (same actors + type)
      const existing = db.prepare(`
        SELECT id, evidence_count, source_documents, context_samples, llm_confidence
        FROM rte_relationship_suggestions
        WHERE rte_id = ? AND source_actor_id = ? AND target_actor_id = ? AND relationship_type = ?
          AND is_dismissed = 0 AND is_approved = 0
      `).get(rteId, sourceActorId, targetActorId, rel.type || 'related_to');

      if (existing) {
        // SIMMER: Same relationship seen again - increase evidence!
        const newCount = (existing.evidence_count || 1) + 1;
        
        // Parse existing arrays
        let sourceDocs = [];
        let contextSamples = [];
        try { sourceDocs = JSON.parse(existing.source_documents || '[]'); } catch (e) {}
        try { contextSamples = JSON.parse(existing.context_samples || '[]'); } catch (e) {}
        
        // Add new document and context (avoid duplicates)
        if (documentId && !sourceDocs.includes(documentId)) {
          sourceDocs.push(documentId);
        }
        const newContext = rel.context || rel.source_text || '';
        if (newContext && contextSamples.length < 5) {
          contextSamples.push(newContext.slice(0, 500)); // Keep first 500 chars
        }
        
        // Calculate simmered confidence: base + 10% per additional evidence, max 0.9
        const baseConfidence = existing.llm_confidence || 0.3;
        const simmeredConfidence = Math.min(0.9, baseConfidence + (0.1 * (newCount - 1)));
        
        const updateStmt = db.prepare(`
          UPDATE rte_relationship_suggestions SET
            evidence_count = ?,
            source_documents = ?,
            context_samples = ?,
            llm_confidence = ?,
            last_seen_at = datetime('now')
          WHERE id = ?
        `);
        
        updateStmt.run(
          newCount,
          JSON.stringify(sourceDocs),
          JSON.stringify(contextSamples),
          simmeredConfidence,
          existing.id
        );
        
        console.log(`[Simmer] Relationship evidence +1 (${newCount} total), confidence: ${(simmeredConfidence * 100).toFixed(0)}%`);
        return true;
      }

      // New suggestion
      const stmt = db.prepare(`
        INSERT INTO rte_relationship_suggestions (
          rte_id, source_actor_id, target_actor_id, relationship_type, 
          source_text, llm_confidence, is_approved, is_dismissed,
          evidence_count, source_documents, context_samples, 
          last_seen_at, created_at
        )
        VALUES (?, ?, ?, ?, ?, ?, 0, 0, 1, ?, ?, datetime('now'), datetime('now'))
      `);

      const sourceDocs = documentId ? JSON.stringify([documentId]) : '[]';
      const contextSamples = rel.context ? JSON.stringify([rel.context.slice(0, 500)]) : '[]';

      const result = stmt.run(
        rteId,
        sourceActorId,
        targetActorId,
        rel.type || 'related_to',
        rel.context || rel.source_text || '',
        rel.confidence || 0.3,
        sourceDocs,
        contextSamples
      );

      return result.changes > 0;
    } catch (error) {
      console.error('[IntelligencePersistence] saveSuggestion error:', error.message);
      return false;
    }
  }

  /**
   * Get actor by name (for linking) - synchronous
   */
  getActorByName(rteId, name) {
    const db = getDb();
    if (!db) return null;

    return db.prepare(`SELECT * FROM rte_actors WHERE rte_id = ? AND LOWER(name) = LOWER(?)`).get(rteId, name) || null;
  }

  /**
   * Get or create an actor - synchronous
   */
  getOrCreateActor(rteId, name, actorType = 'person') {
    let actor = this.getActorByName(rteId, name);
    if (actor) return actor;

    const db = getDb();
    if (!db) return null;

    try {
      const stmt = db.prepare(`
        INSERT INTO rte_actors (rte_id, name, actor_type, created_at, updated_at)
        VALUES (?, ?, ?, datetime('now'), datetime('now'))
      `);
      const result = stmt.run(rteId, name, actorType);
      return { id: result.lastInsertRowid, name, actor_type: actorType };
    } catch (error) {
      console.error('[IntelligencePersistence] getOrCreateActor error:', error.message);
      return null;
    }
  }

  /**
   * Find potential duplicates for an entity name
   * @param {number} rteId - RTE instance ID
   * @param {string} name - Entity name to check
   * @param {string} actorType - Actor type to match
   * @returns {object|null} Best matching existing actor or null
   */
  findSimilarActor(rteId, name, actorType) {
    const db = getDb();
    if (!db || !name) return null;

    try {
      // Get all actors of the same type
      const actors = db.prepare(`
        SELECT id, name, actor_type FROM rte_actors 
        WHERE rte_id = ? AND actor_type = ?
      `).all(rteId, actorType);

      if (actors.length === 0) return null;

      const actorNames = actors.map(a => a.name);
      const matches = stringSimilarity.findBestMatch(name, actorNames);

      if (matches.bestMatch.rating >= this.deduplicationThreshold) {
        const matchedActor = actors.find(a => a.name === matches.bestMatch.target);
        console.log(`[Dedup] "${name}" matches "${matches.bestMatch.target}" (${(matches.bestMatch.rating * 100).toFixed(1)}%)`);
        return matchedActor;
      }

      return null;
    } catch (error) {
      console.error('[IntelligencePersistence] findSimilarActor error:', error.message);
      return null;
    }
  }

  /**
   * Merge duplicate actors - Phase 2 implementation
   * Finds similar actors and merges them, updating relationships
   * @param {number} rteId - RTE instance ID
   * @returns {{merged: number, groups: Array}} Merge statistics
   */
  mergeDuplicates(rteId) {
    const db = getDb();
    if (!db) return { merged: 0, groups: [] };

    try {
      // Get all actors for this RTE
      const actors = db.prepare(`SELECT * FROM rte_actors WHERE rte_id = ? ORDER BY name`).all(rteId);
      
      if (actors.length < 2) return { merged: 0, groups: [] };

      // Group by actor type
      const byType = {};
      actors.forEach(a => {
        if (!byType[a.actor_type]) byType[a.actor_type] = [];
        byType[a.actor_type].push(a);
      });

      let totalMerged = 0;
      const mergeGroups = [];

      // Find duplicates within each type
      for (const [actorType, typeActors] of Object.entries(byType)) {
        if (typeActors.length < 2) continue;

        const names = typeActors.map(a => a.name);
        const processed = new Set();

        for (let i = 0; i < typeActors.length; i++) {
          if (processed.has(i)) continue;
          
          const actor = typeActors[i];
          const duplicates = [actor];
          processed.add(i);

          // Find all similar actors
          for (let j = i + 1; j < typeActors.length; j++) {
            if (processed.has(j)) continue;
            
            const otherActor = typeActors[j];
            const similarity = stringSimilarity.compareTwoStrings(actor.name, otherActor.name);
            
            if (similarity >= this.deduplicationThreshold) {
              duplicates.push(otherActor);
              processed.add(j);
            }
          }

          // Merge if we found duplicates
          if (duplicates.length > 1) {
            // Keep the longest name (usually most complete)
            duplicates.sort((a, b) => b.name.length - a.name.length);
            const primary = duplicates[0];
            const toMerge = duplicates.slice(1);

            console.log(`[Dedup] Merging into "${primary.name}": ${toMerge.map(d => d.name).join(', ')}`);

            for (const dup of toMerge) {
              // Update relationships to point to primary
              db.prepare(`UPDATE rte_relationships SET source_actor_id = ? WHERE source_actor_id = ?`).run(primary.id, dup.id);
              db.prepare(`UPDATE rte_relationships SET target_actor_id = ? WHERE target_actor_id = ?`).run(primary.id, dup.id);
              db.prepare(`UPDATE rte_relationship_suggestions SET source_actor_id = ? WHERE source_actor_id = ?`).run(primary.id, dup.id);
              db.prepare(`UPDATE rte_relationship_suggestions SET target_actor_id = ? WHERE target_actor_id = ?`).run(primary.id, dup.id);
              
              // Delete the duplicate
              db.prepare(`DELETE FROM rte_actors WHERE id = ?`).run(dup.id);
              totalMerged++;
            }

            mergeGroups.push({
              primary: primary.name,
              merged: toMerge.map(d => d.name)
            });
          }
        }
      }

      console.log(`[Dedup] Merged ${totalMerged} duplicate actors`);
      return { merged: totalMerged, groups: mergeGroups };
    } catch (error) {
      console.error('[IntelligencePersistence] mergeDuplicates error:', error.message);
      return { merged: 0, groups: [] };
    }
  }

  /**
   * Get pending suggestions for review - synchronous
   */
  getPendingSuggestions(rteId, limit = 20) {
    const db = getDb();
    if (!db) return [];

    try {
      return db.prepare(`
        SELECT sg.*, 
               s.name as source_name, s.actor_type as source_type,
               t.name as target_name, t.actor_type as target_type
        FROM rte_relationship_suggestions sg
        LEFT JOIN rte_actors s ON sg.source_actor_id = s.id
        LEFT JOIN rte_actors t ON sg.target_actor_id = t.id
        WHERE sg.rte_id = ? AND sg.is_approved = 0
        ORDER BY sg.llm_confidence DESC
        LIMIT ?
      `).all(rteId, limit);
    } catch (error) {
      console.error('[IntelligencePersistence] getPendingSuggestions error:', error.message);
      return [];
    }
  }

  /**
   * Approve a suggestion (convert to relationship) - synchronous
   */
  approveSuggestion(suggestionId, rteId) {
    const db = getDb();
    if (!db) return false;

    try {
      // Get suggestion
      const suggestion = db.prepare(`SELECT * FROM rte_relationship_suggestions WHERE id = ? AND rte_id = ?`).get(suggestionId, rteId);
      if (!suggestion) return false;

      // Create relationship
      db.prepare(`
        INSERT INTO rte_relationships (rte_id, source_actor_id, target_actor_id, relationship_type, context, llm_confidence, is_approved, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, 1, datetime('now'), datetime('now'))
        ON CONFLICT DO NOTHING
      `).run(rteId, suggestion.source_actor_id, suggestion.target_actor_id, suggestion.relationship_type, suggestion.source_text, suggestion.llm_confidence);

      // Mark suggestion as approved
      db.prepare(`UPDATE rte_relationship_suggestions SET is_approved = 1, reviewed_at = datetime('now') WHERE id = ?`).run(suggestionId);

      return true;
    } catch (error) {
      console.error('[IntelligencePersistence] approveSuggestion error:', error.message);
      return false;
    }
  }

  /**
   * Reject a suggestion - synchronous
   */
  rejectSuggestion(suggestionId, rteId) {
    const db = getDb();
    if (!db) return false;

    try {
      const result = db.prepare(`DELETE FROM rte_relationship_suggestions WHERE id = ? AND rte_id = ?`).run(suggestionId, rteId);
      return result.changes > 0;
    } catch (error) {
      console.error('[IntelligencePersistence] rejectSuggestion error:', error.message);
      return false;
    }
  }

  /**
   * Dismiss a suggestion forever (never suggest again) - synchronous
   */
  dismissSuggestion(suggestionId, rteId) {
    const db = getDb();
    if (!db) return false;

    try {
      const result = db.prepare(`
        UPDATE rte_relationship_suggestions 
        SET is_dismissed = 1, reviewed_at = datetime('now') 
        WHERE id = ? AND rte_id = ?
      `).run(suggestionId, rteId);
      return result.changes > 0;
    } catch (error) {
      console.error('[IntelligencePersistence] dismissSuggestion error:', error.message);
      return false;
    }
  }

  /**
   * Check for high-evidence suggestions that could be auto-promoted
   * Call this periodically or after ingests
   */
  checkAutoPromotions(rteId, minEvidence = 3, minConfidence = 0.7) {
    const db = getDb();
    if (!db) return [];

    try {
      // Find suggestions with enough evidence and high enough confidence
      const candidates = db.prepare(`
        SELECT sg.*, 
               s.name as source_name, s.actor_type as source_type,
               t.name as target_name, t.actor_type as target_type
        FROM rte_relationship_suggestions sg
        LEFT JOIN rte_actors s ON sg.source_actor_id = s.id
        LEFT JOIN rte_actors t ON sg.target_actor_id = t.id
        WHERE sg.rte_id = ? 
          AND sg.is_approved = 0 
          AND sg.is_dismissed = 0
          AND sg.evidence_count >= ?
          AND sg.llm_confidence >= ?
        ORDER BY sg.evidence_count DESC, sg.llm_confidence DESC
      `).all(rteId, minEvidence, minConfidence);

      console.log(`[AutoPromotion] Found ${candidates.length} candidates for auto-promotion`);
      return candidates;
    } catch (error) {
      console.error('[IntelligencePersistence] checkAutoPromotions error:', error.message);
      return [];
    }
  }

  /**
   * Get suggestions inbox for a specific RTE with enhanced details
   */
  getSuggestionsInbox(rteId, options = {}) {
    const db = getDb();
    if (!db) return { suggestions: [], stats: {} };

    const { includeDismissed = false, minEvidence = 0, sortBy = 'evidence' } = options;

    try {
      let whereClause = 'sg.rte_id = ? AND sg.is_approved = 0';
      if (!includeDismissed) {
        whereClause += ' AND sg.is_dismissed = 0';
      }
      if (minEvidence > 0) {
        whereClause += ` AND sg.evidence_count >= ${minEvidence}`;
      }

      const orderBy = sortBy === 'confidence' 
        ? 'sg.llm_confidence DESC, sg.evidence_count DESC'
        : 'sg.evidence_count DESC, sg.llm_confidence DESC';

      const suggestions = db.prepare(`
        SELECT sg.*, 
               s.name as source_name, s.actor_type as source_type,
               t.name as target_name, t.actor_type as target_type
        FROM rte_relationship_suggestions sg
        LEFT JOIN rte_actors s ON sg.source_actor_id = s.id
        LEFT JOIN rte_actors t ON sg.target_actor_id = t.id
        WHERE ${whereClause}
        ORDER BY ${orderBy}
        LIMIT 50
      `).all(rteId);

      // Get stats
      const stats = db.prepare(`
        SELECT 
          COUNT(*) as total,
          SUM(CASE WHEN evidence_count >= 3 THEN 1 ELSE 0 END) as strong_evidence,
          SUM(CASE WHEN llm_confidence >= 0.7 THEN 1 ELSE 0 END) as high_confidence,
          SUM(CASE WHEN is_dismissed = 1 THEN 1 ELSE 0 END) as dismissed,
          AVG(evidence_count) as avg_evidence
        FROM rte_relationship_suggestions
        WHERE rte_id = ? AND is_approved = 0
      `).get(rteId);

      return { suggestions, stats };
    } catch (error) {
      console.error('[IntelligencePersistence] getSuggestionsInbox error:', error.message);
      return { suggestions: [], stats: {} };
    }
  }

  /**
   * Get all actors for an RTE
   */
  getActors(rteId) {
    const db = getDb();
    if (!db) return [];

    try {
      return db.prepare(`
        SELECT * FROM rte_actors 
        WHERE rte_id = ? 
        ORDER BY actor_type, name
      `).all(rteId);
    } catch (error) {
      console.error('[IntelligencePersistence] getActors error:', error.message);
      return [];
    }
  }

  /**
   * Get all relationships for an RTE
   */
  getRelationships(rteId) {
    const db = getDb();
    if (!db) return [];

    try {
      return db.prepare(`
        SELECT r.*, 
               s.name as source_name, s.actor_type as source_type,
               t.name as target_name, t.actor_type as target_type
        FROM rte_relationships r
        LEFT JOIN rte_actors s ON r.source_actor_id = s.id
        LEFT JOIN rte_actors t ON r.target_actor_id = t.id
        WHERE r.rte_id = ?
        ORDER BY r.created_at DESC
      `).all(rteId);
    } catch (error) {
      console.error('[IntelligencePersistence] getRelationships error:', error.message);
      return [];
    }
  }

  /**
   * Get RTE ID by name
   */
  getRteIdByName(rteName) {
    const db = getDb();
    if (!db) return null;

    const row = db.prepare('SELECT id FROM rtes WHERE LOWER(name) = LOWER(?)').get(rteName);
    return row?.id || null;
  }
}

module.exports = new IntelligencePersistence();
