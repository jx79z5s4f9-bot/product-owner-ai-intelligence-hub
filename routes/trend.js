/**
 * Trend API Routes
 * Timeline generation and trend analysis
 * Phase 6: Intelligence System v2.0
 */

const express = require('express');
const router = express.Router();
const { getDb } = require('../db/connection');
const { getInstance: getSqliteVectorSearch } = require('../services/sqlite-vector-search');

// Ollama configuration
const OLLAMA_HOST = process.env.OLLAMA_HOST || 'http://localhost:11434';
const TREND_MODELS = ['deepseek-r1:7b', 'mistral:7b', 'llama3.1:8b'];

/**
 * POST /api/trend
 * Analyze trends for a topic over time
 * 
 * Body:
 *   - topic: The topic to analyze (required)
 *   - dateFrom: Start date (optional, defaults to 30 days ago)
 *   - dateTo: End date (optional, defaults to today)
 *   - rteId: Optional RTE filter
 *   - person: Optional person filter
 *   - project: Optional project filter
 */
router.post('/', async (req, res) => {
  const { topic, dateFrom, dateTo, rteId, person, project } = req.body;

  if (!topic || topic.trim().length === 0) {
    return res.status(400).json({ error: 'Missing topic' });
  }

  try {
    // Calculate date range
    const endDate = dateTo || new Date().toISOString().split('T')[0];
    const startDate = dateFrom || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    // Step 1: Build timeline
    const timeline = await buildTimeline(topic, {
      dateFrom: startDate,
      dateTo: endDate,
      rteId: rteId ? parseInt(rteId) : null,
      person,
      project
    });

    if (timeline.events.length === 0) {
      return res.json({
        topic,
        dateRange: { from: startDate, to: endDate },
        timeline: { events: [] },
        analysis: "No documents found for this topic in the specified date range.",
        model: null
      });
    }

    // Step 2: Get trend analysis from LLM
    const analysis = await analyzeTrend(topic, timeline);

    res.json({
      topic,
      dateRange: { from: startDate, to: endDate },
      timeline,
      analysis: analysis.text,
      model: analysis.model
    });

  } catch (error) {
    console.error('[Trend] Error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Build timeline of events for a topic
 */
async function buildTimeline(topic, options) {
  const db = getDb();
  const vectorSearch = getSqliteVectorSearch();
  
  // Search for documents matching topic
  const searchResult = await vectorSearch.search(topic, {
    rteId: options.rteId,
    limit: 100
  });

  if (searchResult.error || !searchResult.results) {
    return { events: [], summary: {} };
  }

  let results = searchResult.results;

  // Filter by date range - match by filepath since vector search returns chunk IDs, not document IDs
  if (db && (options.dateFrom || options.dateTo)) {
    const filepaths = results.map(r => r.filepath).filter(Boolean);

    if (filepaths.length > 0) {
      const placeholders = filepaths.map(() => '?').join(',');
      const dateConditions = [];
      const dateParams = [...filepaths];

      if (options.dateFrom) {
        dateConditions.push(`document_date >= ?`);
        dateParams.push(options.dateFrom);
      }
      if (options.dateTo) {
        dateConditions.push(`document_date <= ?`);
        dateParams.push(options.dateTo);
      }

      if (dateConditions.length > 0) {
        const dateQuery = `
          SELECT id, filepath, document_date FROM rte_documents
          WHERE filepath IN (${placeholders})
          AND document_date IS NOT NULL
          AND ${dateConditions.join(' AND ')}
        `;

        const matchingDocs = db.prepare(dateQuery).all(...dateParams);
        const matchingMap = new Map(matchingDocs.map(d => [d.filepath, { id: d.id, date: d.document_date }]));

        results = results.filter(r => matchingMap.has(r.filepath));

        // Attach dates and document IDs to results
        results = results.map(r => ({
          ...r,
          documentId: matchingMap.get(r.filepath)?.id,
          date: matchingMap.get(r.filepath)?.date
        }));
      }
    }
  }

  // Apply tag filters - use documentId if available, otherwise look up by filepath
  if (db && (options.person || options.project)) {
    // First ensure all results have documentId by looking up via filepath
    const filepaths = results.filter(r => !r.documentId).map(r => r.filepath).filter(Boolean);
    if (filepaths.length > 0) {
      const placeholders = filepaths.map(() => '?').join(',');
      const docLookup = db.prepare(`SELECT id, filepath FROM rte_documents WHERE filepath IN (${placeholders})`).all(...filepaths);
      const pathToId = new Map(docLookup.map(d => [d.filepath, d.id]));
      results = results.map(r => ({
        ...r,
        documentId: r.documentId || pathToId.get(r.filepath)
      }));
    }

    const documentIds = results.map(r => r.documentId).filter(Boolean);

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

      results = results.filter(r => matchingIds.has(r.documentId));
    }
  }

  // Get semantic tags for each document
  const events = results.map(r => {
    const docId = r.documentId || r.id;
    let semanticTags = [];
    
    if (db && docId) {
      try {
        const tags = db.prepare(`
          SELECT tag_value FROM document_tags 
          WHERE document_id = ? AND tag_type = 'semantic'
        `).all(docId);
        semanticTags = tags.map(t => t.tag_value);
      } catch (e) { /* ignore */ }
    }
    
    return {
      date: r.date || 'Unknown',
      documentId: docId,
      filename: r.filename,
      snippet: (r.highlight || r.content || '').substring(0, 200),
      score: r.score || 0,
      semanticTags
    };
  });

  // Sort by date
  events.sort((a, b) => {
    if (a.date === 'Unknown') return 1;
    if (b.date === 'Unknown') return -1;
    return new Date(a.date) - new Date(b.date);
  });

  // Build summary statistics
  const summary = {
    totalEvents: events.length,
    dateRange: {
      earliest: events.find(e => e.date !== 'Unknown')?.date,
      latest: [...events].reverse().find(e => e.date !== 'Unknown')?.date
    },
    tagDistribution: {}
  };

  // Count semantic tags
  events.forEach(e => {
    e.semanticTags.forEach(tag => {
      summary.tagDistribution[tag] = (summary.tagDistribution[tag] || 0) + 1;
    });
  });

  return { events, summary };
}

/**
 * Call LLM to analyze the trend
 */
async function analyzeTrend(topic, timeline) {
  // Build context from timeline
  const context = timeline.events.map((e, i) => {
    const tags = e.semanticTags.length > 0 ? ` [${e.semanticTags.join(', ')}]` : '';
    return `${e.date}: ${e.snippet}${tags}`;
  }).join('\n\n');

  const tagSummary = Object.entries(timeline.summary.tagDistribution)
    .map(([tag, count]) => `${tag}: ${count}`)
    .join(', ');

  const prompt = `You are analyzing trends over time for the topic: "${topic}"

TIMELINE (${timeline.events.length} events from ${timeline.summary.dateRange?.earliest || 'unknown'} to ${timeline.summary.dateRange?.latest || 'unknown'}):

${context}

TAG DISTRIBUTION: ${tagSummary || 'None'}

Analyze this timeline and provide:
1. Key trends or patterns you observe
2. Notable changes over time
3. Recommendations based on the trend

Keep your analysis concise and actionable. Reference specific dates when relevant.

ANALYSIS:`;

  for (const model of TREND_MODELS) {
    try {
      const response = await fetch(`${OLLAMA_HOST}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          prompt,
          stream: false,
          options: {
            temperature: 0.4,
            num_predict: 600
          }
        })
      });

      if (!response.ok) {
        console.log(`[Trend] Model ${model} failed with status ${response.status}`);
        continue;
      }

      const data = await response.json();
      
      if (data.response) {
        console.log(`[Trend] Analyzed using ${model}`);
        return {
          text: data.response.trim(),
          model
        };
      }
    } catch (error) {
      console.log(`[Trend] Model ${model} error:`, error.message);
      continue;
    }
  }

  return {
    text: "Could not generate trend analysis. LLM service may be unavailable.",
    model: null
  };
}

/**
 * GET /api/trend/topics
 * Get suggested topics based on project/person tags
 */
router.get('/topics', (req, res) => {
  const db = getDb();
  if (!db) {
    return res.status(500).json({ error: 'Database not initialized' });
  }

  try {
    // Get top projects
    const projects = db.prepare(`
      SELECT tag_value as name, COUNT(*) as count
      FROM document_tags 
      WHERE tag_type = 'project' AND tag_value IS NOT NULL
      GROUP BY tag_value
      ORDER BY count DESC
      LIMIT 10
    `).all();

    // Get top people
    const people = db.prepare(`
      SELECT tag_value as name, COUNT(*) as count
      FROM document_tags 
      WHERE tag_type = 'person' AND tag_value IS NOT NULL
      GROUP BY tag_value
      ORDER BY count DESC
      LIMIT 10
    `).all();

    // Get top semantic tags
    const semantics = db.prepare(`
      SELECT tag_value as name, COUNT(*) as count
      FROM document_tags 
      WHERE tag_type = 'semantic' AND tag_value IS NOT NULL
      GROUP BY tag_value
      ORDER BY count DESC
      LIMIT 10
    `).all();

    res.json({
      projects,
      people,
      semantics
    });
  } catch (error) {
    console.error('[Trend] Get topics failed:', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
