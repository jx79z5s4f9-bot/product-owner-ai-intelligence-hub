/**
 * Standup API Routes
 * Quick daily standup data + AI summary via evidence pipeline
 */

const express = require('express');
const router = express.Router();
const { getDb } = require('../db/connection');
const { getInstance: getSqliteVectorSearch } = require('../services/sqlite-vector-search');

// Ollama configuration
const OLLAMA_HOST = process.env.OLLAMA_HOST || 'http://localhost:11434';
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
 * Parse a date string (YYYY-MM-DD) or default to yesterday
 */
function resolveDate(dateStr) {
  if (dateStr && /^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    return dateStr;
  }
  // Default: yesterday
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d.toISOString().split('T')[0];
}

/**
 * GET /api/standup/data
 * Structured daily activity — instant, no LLM
 *
 * Query params:
 *   - date: YYYY-MM-DD (default: yesterday)
 *   - rteId: optional RTE filter
 */
router.get('/data', (req, res) => {
  const db = getDb();
  if (!db) return res.status(500).json({ error: 'Database not ready' });

  const date = resolveDate(req.query.date);
  const rteId = req.query.rteId ? parseInt(req.query.rteId) : null;

  try {
    // --- Documents processed on this date ---
    const docsQuery = rteId
      ? `SELECT id, filename, filepath, rte_id, document_date, created_at
         FROM rte_documents
         WHERE document_date = ? AND rte_id = ?
         ORDER BY created_at DESC`
      : `SELECT id, filename, filepath, rte_id, document_date, created_at
         FROM rte_documents
         WHERE document_date = ?
         ORDER BY created_at DESC`;
    const docsParams = rteId ? [date, rteId] : [date];
    const documents = db.prepare(docsQuery).all(...docsParams);

    // --- Markers extracted from those documents, by type ---
    // We want markers that belong to documents from this date
    const docIds = documents.map(d => d.id);
    let markers = [];

    if (docIds.length > 0) {
      const placeholders = docIds.map(() => '?').join(',');
      markers = db.prepare(`
        SELECT sm.id, sm.marker_type, sm.marker_content, sm.is_resolved,
               sm.owner, sm.due_date, sm.severity,
               sm.document_id, rd.filename AS source_filename, rd.filepath AS source_filepath
        FROM semantic_markers sm
        JOIN rte_documents rd ON sm.document_id = rd.id
        WHERE sm.document_id IN (${placeholders})
        ORDER BY sm.marker_type, sm.created_at
      `).all(...docIds);
    }

    // Also get open blockers and questions regardless of date (they're still active)
    const openBlockersQuery = rteId
      ? `SELECT sm.id, sm.marker_type, sm.marker_content, sm.is_resolved,
                sm.owner, sm.due_date, sm.severity,
                sm.document_id, rd.filename AS source_filename, rd.filepath AS source_filepath
         FROM semantic_markers sm
         JOIN rte_documents rd ON sm.document_id = rd.id
         WHERE sm.marker_type IN ('blocker', 'question')
           AND sm.is_resolved = 0
           AND rd.rte_id = ?
         ORDER BY sm.marker_type, sm.created_at`
      : `SELECT sm.id, sm.marker_type, sm.marker_content, sm.is_resolved,
                sm.owner, sm.due_date, sm.severity,
                sm.document_id, rd.filename AS source_filename, rd.filepath AS source_filepath
         FROM semantic_markers sm
         JOIN rte_documents rd ON sm.document_id = rd.id
         WHERE sm.marker_type IN ('blocker', 'question')
           AND sm.is_resolved = 0
         ORDER BY sm.marker_type, sm.created_at`;
    const openBlockersParams = rteId ? [rteId] : [];
    const openItems = db.prepare(openBlockersQuery).all(...openBlockersParams);

    // Deduplicate: merge open items with date-based markers
    const seenIds = new Set(markers.map(m => m.id));
    for (const item of openItems) {
      if (!seenIds.has(item.id)) {
        markers.push(item);
        seenIds.add(item.id);
      }
    }

    // Group markers by type
    const grouped = {
      decision: [],
      action: [],
      blocker: [],
      question: [],
      promise: [],
      risk: [],
      insight: [],
      strategic: [],
      feature: [],
      other: []
    };

    for (const m of markers) {
      const type = m.marker_type || 'other';
      if (grouped[type]) {
        grouped[type].push(m);
      } else {
        grouped.other.push(m);
      }
    }

    // Overdue items
    const today = new Date().toISOString().split('T')[0];
    const overdueQuery = rteId
      ? `SELECT sm.id, sm.marker_type, sm.marker_content, sm.owner, sm.due_date, sm.severity,
                rd.filename AS source_filename, rd.filepath AS source_filepath
         FROM semantic_markers sm
         JOIN rte_documents rd ON sm.document_id = rd.id
         WHERE sm.due_date < ? AND sm.is_resolved = 0 AND rd.rte_id = ?
         ORDER BY sm.due_date`
      : `SELECT sm.id, sm.marker_type, sm.marker_content, sm.owner, sm.due_date, sm.severity,
                rd.filename AS source_filename, rd.filepath AS source_filepath
         FROM semantic_markers sm
         JOIN rte_documents rd ON sm.document_id = rd.id
         WHERE sm.due_date < ? AND sm.is_resolved = 0
         ORDER BY sm.due_date`;
    const overdueParams = rteId ? [today, rteId] : [today];
    const overdue = db.prepare(overdueQuery).all(...overdueParams);

    res.json({
      date,
      rteId,
      documents: documents.map(d => ({
        id: d.id,
        filename: d.filename,
        filepath: d.filepath,
        documentDate: d.document_date
      })),
      markers: grouped,
      overdue,
      summary: {
        documentCount: documents.length,
        markerCount: markers.length,
        decisions: grouped.decision.length,
        actions: grouped.action.length,
        blockers: grouped.blocker.length,
        questions: grouped.question.length,
        promises: grouped.promise.length,
        risks: grouped.risk.length,
        overdueCount: overdue.length
      }
    });

  } catch (err) {
    console.error('[Standup] Data error:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/standup/summarize
 * AI-generated standup narrative using the full evidence pipeline
 *
 * Body:
 *   - date: YYYY-MM-DD (default: yesterday)
 *   - rteId: optional RTE filter
 */
router.post('/summarize', async (req, res) => {
  const db = getDb();
  if (!db) return res.status(500).json({ error: 'Database not ready' });

  const date = resolveDate(req.body.date);
  const rteId = req.body.rteId ? parseInt(req.body.rteId) : null;

  try {
    // Step 1: Get documents for this date
    const docsQuery = rteId
      ? `SELECT id, filename, filepath FROM rte_documents
         WHERE document_date = ? AND rte_id = ?`
      : `SELECT id, filename, filepath FROM rte_documents
         WHERE document_date = ?`;
    const docsParams = rteId ? [date, rteId] : [date];
    const documents = db.prepare(docsQuery).all(...docsParams);

    if (documents.length === 0) {
      return res.json({
        date,
        narrative: `No documents found for ${date}. Nothing to summarise.`,
        evidence: [],
        model: null
      });
    }

    // Step 2: Get markers for these documents
    const docIds = documents.map(d => d.id);
    const placeholders = docIds.map(() => '?').join(',');
    const markers = db.prepare(`
      SELECT sm.marker_type, sm.marker_content, sm.owner, sm.due_date, sm.severity,
             rd.filename AS source_filename
      FROM semantic_markers sm
      JOIN rte_documents rd ON sm.document_id = rd.id
      WHERE sm.document_id IN (${placeholders})
      ORDER BY sm.marker_type
    `).all(...docIds);

    // Step 3: Get document content via FTS5 search (evidence pipeline)
    const vectorSearch = getSqliteVectorSearch();
    const filenames = documents.map(d => d.filename);

    // Search for content from these specific documents
    // Use a broad query to pull all chunks from date-relevant documents
    const searchResult = await vectorSearch.search('meeting notes decisions actions', {
      rteId: rteId || null,
      limit: 50
    });

    let evidence = [];
    if (searchResult.results) {
      // Filter to only chunks from today's documents
      const filenameSet = new Set(filenames);
      evidence = searchResult.results
        .filter(r => filenameSet.has(r.filename))
        .slice(0, 8); // Keep top 8 evidence chunks
    }

    // Step 4: Build the LLM prompt
    const markerSummary = markers.map(m => {
      const ownerStr = m.owner ? ` (owner: ${m.owner})` : '';
      const dueStr = m.due_date ? ` [due: ${m.due_date}]` : '';
      const sevStr = m.severity ? ` {${m.severity}}` : '';
      return `- [${m.marker_type}] ${m.marker_content}${ownerStr}${dueStr}${sevStr}`;
    }).join('\n');

    const evidenceText = evidence.map((e, i) =>
      `[Evidence ${i + 1}] ${e.filename}\n${e.content || e.highlight || ''}`
    ).join('\n\n---\n\n');

    const prompt = `You are a Product Owner assistant. Based on the structured markers and document evidence below, write a concise standup update for ${date}.

Format your response in three sections:
1. **What happened** — summarise the key activities, decisions, and progress
2. **What's planned** — any actions assigned or commitments made
3. **Blockers & risks** — anything that needs attention

Keep it brief, professional, and actionable. Use bullet points.

STRUCTURED MARKERS:
${markerSummary || '(no markers extracted)'}

DOCUMENT EVIDENCE:
${evidenceText || '(no document content available)'}

DOCUMENTS PROCESSED: ${filenames.join(', ')}

STANDUP UPDATE:`;

    // Step 5: Call LLM
    const primaryModel = getQueryModel();
    const modelsToTry = [primaryModel, ...FALLBACK_MODELS.filter(m => m !== primaryModel)];
    let narrative = null;
    let usedModel = null;

    for (const model of modelsToTry) {
      try {
        const response = await fetch(`${OLLAMA_HOST}/api/generate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model,
            prompt,
            stream: false,
            options: { temperature: 0.3, num_predict: 600 }
          })
        });

        if (!response.ok) {
          console.log(`[Standup] Model ${model} failed with status ${response.status}`);
          continue;
        }

        const data = await response.json();
        if (data.response) {
          narrative = data.response.trim();
          usedModel = model;
          console.log(`[Standup] Summary generated using ${model}`);
          break;
        }
      } catch (error) {
        console.log(`[Standup] Model ${model} error:`, error.message);
        continue;
      }
    }

    res.json({
      date,
      narrative: narrative || 'LLM unavailable — could not generate summary.',
      evidence: evidence.map(e => ({
        filename: e.filename,
        snippet: e.highlight || e.content?.substring(0, 200) || '',
        score: e.score
      })),
      markers: markers.length,
      documents: filenames,
      model: usedModel
    });

  } catch (err) {
    console.error('[Standup] Summarize error:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
