/**
 * Ask API Routes
 * Q&A with evidence-based interpretation
 * Phase 5: Intelligence System v2.0
 */

const express = require('express');
const router = express.Router();
const { getDb } = require('../db/connection');
const { getInstance: getSqliteVectorSearch } = require('../services/sqlite-vector-search');

// Ollama configuration
const OLLAMA_HOST = process.env.OLLAMA_HOST || 'http://localhost:11434';

// Fallback models if database config unavailable
const FALLBACK_MODELS = ['mistral:latest', 'deepseek-r1:7b', 'gemma3:4b'];

/**
 * Get query model from database config
 */
function getQueryModel() {
  const db = getDb();
  if (!db) return FALLBACK_MODELS[0];
  
  try {
    const config = db.prepare(`SELECT model_name FROM llm_configs WHERE task = 'query'`).get();
    return config?.model_name || FALLBACK_MODELS[0];
  } catch (e) {
    return FALLBACK_MODELS[0];
  }
}

/**
 * POST /api/ask
 * Ask a question and get an evidence-based answer
 * 
 * Body:
 *   - question: The question to ask (required)
 *   - rteId: Optional RTE filter
 *   - person: Optional person filter
 *   - project: Optional project filter
 *   - maxEvidence: Max evidence chunks (default 5)
 */
router.post('/', async (req, res) => {
  const { question, rteId, person, project, maxEvidence = 5 } = req.body;

  if (!question || question.trim().length === 0) {
    return res.status(400).json({ error: 'Missing question' });
  }

  try {
    // Step 1: Gather evidence
    const evidence = await gatherEvidence(question, {
      rteId: rteId ? parseInt(rteId) : null,
      person,
      project,
      limit: maxEvidence
    });

    if (evidence.length === 0) {
      return res.json({
        question,
        answer: "I couldn't find any relevant documents to answer this question. Try rephrasing or removing filters.",
        evidence: [],
        model: null,
        confidence: 0
      });
    }

    // Step 2: Build context from evidence
    const context = buildContext(evidence);

    // Step 3: Get interpretation from LLM
    const interpretation = await interpret(question, context);

    // Step 4: Store in question history
    const historyId = saveToHistory({
      question,
      answer: interpretation.answer,
      evidence,
      model: interpretation.model,
      confidence: calculateConfidence(evidence, interpretation),
      rteId: rteId ? parseInt(rteId) : null,
      filters: { person, project }
    });

    res.json({
      question,
      answer: interpretation.answer,
      evidence: evidence.map(e => ({
        documentId: e.documentId,
        filename: e.filename,
        filepath: e.filepath,
        snippet: e.snippet,
        chunkContent: e.chunkContent,
        score: e.score,
        tags: e.tags
      })),
      model: interpretation.model,
      confidence: calculateConfidence(evidence, interpretation),
      historyId
    });

  } catch (error) {
    console.error('[Ask] Error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Parse temporal phrases from question and return date range
 */
function parseDateRange(question) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const q = question.toLowerCase();

  // "last N days" pattern
  const lastDaysMatch = q.match(/last\s+(\d+)\s+days?/);
  if (lastDaysMatch) {
    const days = parseInt(lastDaysMatch[1]);
    const start = new Date(today);
    start.setDate(start.getDate() - days + 1);
    return { start, end: today };
  }

  // "yesterday"
  if (q.includes('yesterday')) {
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    return { start: yesterday, end: yesterday };
  }

  // "today"
  if (q.includes('today') && !q.includes('yesterday')) {
    return { start: today, end: today };
  }

  // "this week"
  if (q.includes('this week')) {
    const start = new Date(today);
    start.setDate(start.getDate() - start.getDay() + 1); // Monday
    return { start, end: today };
  }

  // "last week"
  if (q.includes('last week')) {
    const start = new Date(today);
    start.setDate(start.getDate() - start.getDay() - 6); // Last Monday
    const end = new Date(start);
    end.setDate(end.getDate() + 6); // Last Sunday
    return { start, end };
  }

  return null;
}

/**
 * Gather evidence from documents matching the question
 */
async function gatherEvidence(question, options) {
  const db = getDb();
  const vectorSearch = getSqliteVectorSearch();

  // Parse date range from question
  const dateRange = parseDateRange(question);

  // Search for relevant documents
  const searchResult = await vectorSearch.search(question, {
    rteId: options.rteId,
    limit: 50 // Get more, then filter
  });

  if (searchResult.error || !searchResult.results) {
    return [];
  }

  let results = searchResult.results;

  // Apply date filter if temporal phrase detected
  if (dateRange && db) {
    const startStr = dateRange.start.toISOString().split('T')[0];
    const endStr = dateRange.end.toISOString().split('T')[0];

    // Get documents within date range
    const dateQuery = db.prepare(`
      SELECT filename FROM rte_documents
      WHERE document_date >= ? AND document_date <= ?
      ${options.rteId ? 'AND rte_id = ?' : ''}
    `);
    const params = options.rteId ? [startStr, endStr, options.rteId] : [startStr, endStr];
    const docsInRange = dateQuery.all(...params);
    const filenamesInRange = new Set(docsInRange.map(d => d.filename));

    // Filter results to only include docs from date range
    const filteredResults = results.filter(r => filenamesInRange.has(r.filename));

    // If we have date-filtered results, use those; otherwise fall back to all results
    if (filteredResults.length > 0) {
      results = filteredResults;
      console.log(`[Ask] Date filter ${startStr} to ${endStr}: ${filteredResults.length} of ${searchResult.results.length} results`);
    } else {
      console.log(`[Ask] No results in date range ${startStr} to ${endStr}, using all ${results.length} results`);
    }
  }

  // Apply tag filters if specified
  if (db && (options.person || options.project)) {
    const documentIds = results.map(r => r.documentId || r.id).filter(Boolean);
    
    if (documentIds.length > 0) {
      const placeholders = documentIds.map(() => '?').join(',');
      const tagConditions = [];
      const tagParams = [];
      
      if (options.person) {
        tagConditions.push(`(tag_type = 'person' AND tag_value = ?)`);
        tagParams.push(options.person);
      }
      if (options.project) {
        tagConditions.push(`(tag_type = 'project' AND tag_value = ?)`);
        tagParams.push(options.project);
      }
      
      const tagQuery = `
        SELECT DISTINCT document_id FROM document_tags
        WHERE document_id IN (${placeholders})
        AND (${tagConditions.join(' OR ')})
      `;
      
      const matchingDocs = db.prepare(tagQuery).all(...documentIds, ...tagParams);
      const matchingIds = new Set(matchingDocs.map(d => d.document_id));
      
      results = results.filter(r => matchingIds.has(r.documentId || r.id));
    }
  }

  // Limit and enrich results
  results = results.slice(0, options.limit);

  // Get tags for each result
  return results.map(r => {
    const docId = r.documentId || r.id;
    let tags = { people: [], projects: [], semantics: [] };
    
    if (db && docId) {
      try {
        const docTags = db.prepare(`
          SELECT tag_type, tag_value FROM document_tags WHERE document_id = ?
        `).all(docId);
        
        docTags.forEach(t => {
          if (t.tag_type === 'person') tags.people.push(t.tag_value);
          else if (t.tag_type === 'project') tags.projects.push(t.tag_value);
          else if (t.tag_type === 'semantic') tags.semantics.push(t.tag_value);
        });
      } catch (e) { /* ignore */ }
    }
    
    return {
      documentId: docId,
      filename: r.filename,
      filepath: r.filepath || '',
      snippet: r.highlight || r.content || '',
      chunkContent: r.content || r.highlight || '',
      score: r.score || 0,
      tags
    };
  });
}

/**
 * Build context string from evidence for LLM
 */
function buildContext(evidence) {
  return evidence.map((e, i) => {
    const tagStr = [
      ...e.tags.people.map(p => `@${p}`),
      ...e.tags.projects.map(p => `#${p}`),
      ...e.tags.semantics
    ].join(', ');
    
    return `[Evidence ${i + 1}] ${e.filename}${tagStr ? ` (${tagStr})` : ''}\n${e.snippet}`;
  }).join('\n\n---\n\n');
}

/**
 * Call LLM to interpret the question with evidence
 */
async function interpret(question, context) {
  const prompt = `You are a Product Owner assistant. Answer the question based ONLY on the provided evidence.
If the evidence doesn't contain enough information, say so clearly.
Cite evidence by number (e.g., [Evidence 1]) when making claims.
Keep your answer concise and actionable.

EVIDENCE:
${context}

QUESTION: ${question}

ANSWER:`;

  // Get configured model and fallbacks
  const primaryModel = getQueryModel();
  const modelsToTry = [primaryModel, ...FALLBACK_MODELS.filter(m => m !== primaryModel)];

  for (const model of modelsToTry) {
    try {
      const response = await fetch(`${OLLAMA_HOST}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          prompt,
          stream: false,
          options: {
            temperature: 0.3,
            num_predict: 500
          }
        })
      });

      if (!response.ok) {
        console.log(`[Ask] Model ${model} failed with status ${response.status}`);
        continue;
      }

      const data = await response.json();
      
      if (data.response) {
        console.log(`[Ask] Answered using ${model}`);
        return {
          answer: data.response.trim(),
          model
        };
      }
    } catch (error) {
      console.log(`[Ask] Model ${model} error:`, error.message);
      continue;
    }
  }

  return {
    answer: "Sorry, I couldn't process your question. LLM service may be unavailable.",
    model: null
  };
}

/**
 * Calculate confidence score based on evidence quality
 */
function calculateConfidence(evidence, interpretation) {
  if (!interpretation.model) return 0;
  if (evidence.length === 0) return 0;
  
  // Base confidence on number of evidence pieces and their scores
  const avgScore = evidence.reduce((sum, e) => sum + (e.score || 0), 0) / evidence.length;
  const countBonus = Math.min(evidence.length / 5, 1); // More evidence = more confident
  
  return Math.round((avgScore * 0.7 + countBonus * 0.3) * 100);
}

/**
 * Save question and answer to history
 */
function saveToHistory({ question, answer, evidence, model, confidence, rteId, filters }) {
  const db = getDb();
  if (!db) return null;
  
  try {
    // Get RTE name if rteId provided
    let rteName = null;
    if (rteId) {
      const rte = db.prepare('SELECT name FROM rtes WHERE id = ?').get(rteId);
      rteName = rte?.name;
    }
    
    const result = db.prepare(`
      INSERT INTO question_history (question, answer, evidence_json, model, confidence, rte_id, rte_name, filters_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      question,
      answer,
      JSON.stringify(evidence.map(e => ({
        filename: e.filename,
        snippet: e.snippet?.substring(0, 200),
        score: e.score
      }))),
      model,
      confidence,
      rteId,
      rteName,
      JSON.stringify(filters)
    );
    
    return result.lastInsertRowid;
  } catch (error) {
    console.error('[Ask] Failed to save history:', error.message);
    return null;
  }
}

/**
 * GET /api/ask/recent
 * Get recent questions (for history)
 */
router.get('/recent', (req, res) => {
  const db = getDb();
  if (!db) {
    return res.json({ questions: [] });
  }
  
  try {
    const limit = parseInt(req.query.limit) || 20;
    const offset = parseInt(req.query.offset) || 0;
    
    const questions = db.prepare(`
      SELECT id, question, answer, evidence_json, model, confidence, rte_id, rte_name, filters_json, created_at
      FROM question_history
      ORDER BY created_at DESC
      LIMIT ? OFFSET ?
    `).all(limit, offset);
    
    const total = db.prepare('SELECT COUNT(*) as count FROM question_history').get();
    
    res.json({
      questions: questions.map(q => ({
        id: q.id,
        question: q.question,
        answer: q.answer,
        evidence: q.evidence_json ? JSON.parse(q.evidence_json) : [],
        model: q.model,
        confidence: q.confidence,
        rteId: q.rte_id,
        rteName: q.rte_name,
        filters: q.filters_json ? JSON.parse(q.filters_json) : {},
        createdAt: q.created_at
      })),
      total: total.count,
      limit,
      offset
    });
  } catch (error) {
    console.error('[Ask] Failed to get history:', error.message);
    res.json({ questions: [], error: error.message });
  }
});

/**
 * DELETE /api/ask/history/:id
 * Delete a specific question from history
 */
router.delete('/history/:id', (req, res) => {
  const db = getDb();
  if (!db) {
    return res.status(500).json({ error: 'Database not available' });
  }
  
  try {
    const result = db.prepare('DELETE FROM question_history WHERE id = ?').run(req.params.id);
    res.json({ success: result.changes > 0 });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * DELETE /api/ask/history
 * Clear all question history
 */
router.delete('/history', (req, res) => {
  const db = getDb();
  if (!db) {
    return res.status(500).json({ error: 'Database not available' });
  }
  
  try {
    const result = db.prepare('DELETE FROM question_history').run();
    res.json({ success: true, deleted: result.changes });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/ask/document
 * Fetch a document's content by filepath (read-only, for evidence viewer)
 */
router.get('/document', (req, res) => {
  const { filepath } = req.query;
  if (!filepath) {
    return res.status(400).json({ error: 'filepath required' });
  }

  const path = require('path');
  const fs = require('fs');
  const os = require('os');
  const WORKSPACE_ROOT = path.join(os.homedir(), 'ProductOwnerAI', 'rte');

  const normalizedPath = path.resolve(filepath);
  if (!normalizedPath.startsWith(path.resolve(WORKSPACE_ROOT))) {
    return res.status(403).json({ error: 'Access denied' });
  }

  if (!fs.existsSync(normalizedPath)) {
    return res.status(404).json({ error: 'File not found' });
  }

  try {
    const content = fs.readFileSync(normalizedPath, 'utf-8');
    res.json({
      content,
      filename: path.basename(normalizedPath),
      path: normalizedPath
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
