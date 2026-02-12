/**
 * Search API Routes
 * SQLite FTS5 search and open items scanner
 * Phase 2: Added query expansion with glossary
 * Phase 4 (v2): Added tag filtering and date range
 */

const express = require('express');
const router = express.Router();
const { getInstance: getSqliteVectorSearch } = require('../services/sqlite-vector-search');
const { getDb } = require('../db/connection');

/**
 * Expand query with glossary terms (Dutch ↔ English)
 * @param {string} query - Original search query
 * @returns {string} Expanded query with OR'd glossary matches
 */
function expandQueryWithGlossary(query) {
  const db = getDb();
  if (!db) return query;

  try {
    const words = query.toLowerCase().split(/\s+/);
    const expansions = new Set([query]);

    for (const word of words) {
      if (word.length < 3) continue;

      // Look for Dutch → English translations
      const dutchMatch = db.prepare(`
        SELECT english FROM glossary WHERE LOWER(dutch) LIKE ?
      `).all(`%${word}%`);
      
      dutchMatch.forEach(m => expansions.add(m.english.toLowerCase()));

      // Look for English → Dutch translations
      const englishMatch = db.prepare(`
        SELECT dutch FROM glossary WHERE LOWER(english) LIKE ?
      `).all(`%${word}%`);
      
      englishMatch.forEach(m => expansions.add(m.dutch.toLowerCase()));
    }

    if (expansions.size > 1) {
      console.log(`[Search] Query expanded: "${query}" → ${Array.from(expansions).join(' OR ')}`);
    }

    // Return as OR query for FTS5
    return Array.from(expansions).join(' OR ');
  } catch (error) {
    console.error('[Search] Query expansion failed:', error.message);
    return query;
  }
}

/**
 * GET / - Text search using SQLite FTS5
 * Query params:
 *   - q: search query (required)
 *   - rteId: filter by RTE ID
 *   - type: filter by result type (document, actor, relationship, glossary)
 *   - limit: max results (default 20)
 *   - expand: expand query with glossary (default true)
 *   - person: filter by person tag
 *   - project: filter by project tag
 *   - semantic: filter by semantic tag
 *   - dateFrom: filter by date range start (YYYY-MM-DD)
 *   - dateTo: filter by date range end (YYYY-MM-DD)
 */
router.get('/', async (req, res) => {
  const { q, rteId, type, limit, expand, person, project, semantic, dateFrom, dateTo } = req.query;

  // Check if query is empty or just wildcards
  const isWildcardQuery = !q || /^[\s.*]+$/.test(q);
  const markerTypes = ['question', 'decision', 'insight', 'action'];
  const isMarkerSearch = semantic && markerTypes.includes(semantic.toLowerCase());

  // Allow empty query if searching for semantic markers
  if (isWildcardQuery && !isMarkerSearch) {
    return res.status(400).json({ error: 'Missing query parameter: q' });
  }

  try {
    const db = getDb();
    const vectorSearch = getSqliteVectorSearch();
    
    let results = [];
    let searchQuery = q;
    const shouldExpand = expand !== 'false';

    // If it's a wildcard/empty query with marker filter, search markers directly
    if (isWildcardQuery && isMarkerSearch) {
      // Get individual markers (not documents) - each marker is a separate result
      const markerQuery = `
        SELECT 
          m.id as marker_id,
          m.marker_type,
          m.marker_content,
          m.is_resolved,
          m.created_at as marker_created,
          d.id as document_id,
          d.filepath,
          d.filename,
          d.rte_id,
          r.name as rte_name
        FROM semantic_markers m
        JOIN rte_documents d ON m.document_id = d.id
        LEFT JOIN rtes r ON d.rte_id = r.id
        WHERE m.marker_type = ?
        ${rteId ? 'AND d.rte_id = ?' : ''}
        ORDER BY m.created_at DESC
        LIMIT ?
      `;
      const params = [semantic.toLowerCase()];
      if (rteId) params.push(parseInt(rteId));
      params.push(parseInt(limit) || 100);

      const markerResults = db.prepare(markerQuery).all(...params);
      
      // Return markers directly with full content - skip normal processing
      const enrichedMarkers = markerResults.map(m => ({
        id: m.marker_id,
        markerId: m.marker_id,
        documentId: m.document_id,
        title: m.filename,
        name: m.filename,
        path: m.filepath,
        content: m.marker_content,  // Full marker content
        snippet: m.marker_content,  // Full marker content
        type: 'marker',
        markerType: m.marker_type,
        isResolved: m.is_resolved === 1,
        rteId: m.rte_id,
        rteName: m.rte_name,
        score: 1,
        expandedQuery: null,
        tags: { people: [], projects: [], semantics: [] }
      }));
      
      return res.json(enrichedMarkers);
    }
    
    // Normal FTS search
    searchQuery = shouldExpand ? expandQueryWithGlossary(q) : q;
    
    const searchResult = await vectorSearch.search(searchQuery, {
      rteId: rteId ? parseInt(rteId) : null,
      limit: parseInt(limit) || 100 // Get more, then filter
    });

    // Handle error from search
    if (searchResult.error) {
      return res.status(500).json({ error: searchResult.error });
    }

    results = searchResult.results || [];

    // Apply tag filters (filter by document_id matches in document_tags)
    // Skip this if we already filtered by marker type above
    if (db && (person || project || (semantic && !isWildcardQuery))) {
      const documentIds = results.map(r => r.documentId || r.id).filter(Boolean);
      
      if (documentIds.length > 0) {
        const placeholders = documentIds.map(() => '?').join(',');
        
        // Build tag filter query
        const tagConditions = [];
        const tagParams = [];
        
        if (person) {
          tagConditions.push(`(tag_type = 'person' AND tag_value = ?)`);
          tagParams.push(person);
        }
        if (project) {
          tagConditions.push(`(tag_type = 'project' AND tag_value = ?)`);
          tagParams.push(project);
        }
        if (semantic) {
          tagConditions.push(`(tag_type = 'semantic' AND tag_value = ?)`);
          tagParams.push(semantic);
        }
        
        const tagQuery = `
          SELECT DISTINCT document_id FROM document_tags
          WHERE document_id IN (${placeholders})
          AND (${tagConditions.join(' OR ')})
        `;
        
        const matchingDocs = db.prepare(tagQuery).all(...documentIds, ...tagParams);
        let matchingIds = new Set(matchingDocs.map(d => d.document_id));
        
        // Also include documents with explicit semantic markers (question:, decision:, etc.)
        // Note: semantic_markers uses rte_documents.id which differs from vector search IDs
        // So we match by filepath instead
        if (semantic) {
          const markerTypes = ['question', 'decision', 'insight', 'action'];
          if (markerTypes.includes(semantic.toLowerCase())) {
            try {
              // Get filepaths from search results
              const searchFilepaths = results.map(r => r.filepath || r.path).filter(Boolean);
              if (searchFilepaths.length > 0) {
                const fpPlaceholders = searchFilepaths.map(() => '?').join(',');
                const markerQuery = `
                  SELECT DISTINCT d.filepath 
                  FROM semantic_markers m
                  JOIN rte_documents d ON m.document_id = d.id
                  WHERE d.filepath IN (${fpPlaceholders})
                  AND m.marker_type = ?
                `;
                const markerDocs = db.prepare(markerQuery).all(...searchFilepaths, semantic.toLowerCase());
                const markerPaths = new Set(markerDocs.map(d => d.filepath));
                
                // Add matching vector search IDs to the allowed set
                results.forEach(r => {
                  const fp = r.filepath || r.path;
                  if (fp && markerPaths.has(fp)) {
                    matchingIds.add(r.documentId || r.id);
                  }
                });
              }
            } catch (e) {
              console.error('[Search] Marker lookup failed:', e.message);
            }
          }
        }
        
        results = results.filter(r => matchingIds.has(r.documentId || r.id));
      }
    }

    // Apply date range filter
    if (db && (dateFrom || dateTo)) {
      const documentIds = results.map(r => r.documentId || r.id).filter(Boolean);
      
      if (documentIds.length > 0) {
        const placeholders = documentIds.map(() => '?').join(',');
        const dateConditions = [];
        const dateParams = [...documentIds];
        
        if (dateFrom) {
          dateConditions.push(`document_date >= ?`);
          dateParams.push(dateFrom);
        }
        if (dateTo) {
          dateConditions.push(`document_date <= ?`);
          dateParams.push(dateTo);
        }
        
        const dateQuery = `
          SELECT id FROM rte_documents
          WHERE id IN (${placeholders})
          AND ${dateConditions.join(' AND ')}
        `;
        
        const matchingDocs = db.prepare(dateQuery).all(...dateParams);
        const matchingIds = new Set(matchingDocs.map(d => d.id));
        
        results = results.filter(r => matchingIds.has(r.documentId || r.id));
      }
    }

    // Limit final results
    const finalLimit = parseInt(limit) || 20;
    results = results.slice(0, finalLimit);

    // Enrich results with tag information
    const enrichedResults = results.map(r => {
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
        } catch (e) { /* ignore tag fetch errors */ }
      }
      
      return {
        id: r.id,
        documentId: docId,
        title: r.section || r.filename,
        name: r.filename,
        content: r.highlight,
        snippet: r.highlight || '',
        path: r.filepath,
        type: type || 'document',
        rteId: r.rteId,
        rteName: r.rteName,
        score: r.score,
        expandedQuery: shouldExpand ? searchQuery : null,
        tags
      };
    });

    res.json(enrichedResults);
  } catch (error) {
    console.error('[Search] Query failed:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /open-items - Find TODOs, action items, open points
 * Query params:
 *   - rteId: filter by RTE ID
 */
router.get('/open-items', async (req, res) => {
  const { rteId } = req.query;

  try {
    const vectorSearch = getSqliteVectorSearch();
    
    const results = await vectorSearch.findOpenItems({
      rteId: rteId ? parseInt(rteId) : null
    });

    res.json(results);
  } catch (error) {
    console.error('[Search] Open items failed:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /filters - Get available filter options for search
 * Returns all unique persons, projects, and semantic tags
 */
router.get('/filters', (req, res) => {
  const db = getDb();
  if (!db) {
    return res.status(500).json({ error: 'Database not initialized' });
  }

  try {
    // Get unique persons
    const persons = db.prepare(`
      SELECT DISTINCT tag_value as name, COUNT(*) as count
      FROM document_tags 
      WHERE tag_type = 'person' AND tag_value IS NOT NULL
      GROUP BY tag_value
      ORDER BY count DESC
    `).all();

    // Get unique projects
    const projects = db.prepare(`
      SELECT DISTINCT tag_value as name, COUNT(*) as count
      FROM document_tags 
      WHERE tag_type = 'project' AND tag_value IS NOT NULL
      GROUP BY tag_value
      ORDER BY count DESC
    `).all();

    // Get semantic tags
    const semantics = db.prepare(`
      SELECT name, description FROM semantic_tags ORDER BY name
    `).all();

    // Get date range
    const dateRange = db.prepare(`
      SELECT 
        MIN(document_date) as minDate,
        MAX(document_date) as maxDate
      FROM rte_documents
      WHERE document_date IS NOT NULL
    `).get();

    res.json({
      persons,
      projects,
      semantics,
      dateRange: dateRange || { minDate: null, maxDate: null }
    });
  } catch (error) {
    console.error('[Search] Get filters failed:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /document/:id - Get full document content for modal view
 */
router.get('/document/:id', (req, res) => {
  const { id } = req.params;
  const db = getDb();
  
  if (!db) {
    return res.status(500).json({ error: 'Database not initialized' });
  }

  try {
    const doc = db.prepare(`
      SELECT 
        rd.*,
        r.name as rte_name,
        ct.name as content_type_name
      FROM rte_documents rd
      LEFT JOIN rtes r ON rd.rte_id = r.id
      LEFT JOIN content_types ct ON rd.content_type_id = ct.id
      WHERE rd.id = ?
    `).get(id);

    if (!doc) {
      return res.status(404).json({ error: 'Document not found' });
    }

    // Get document tags
    const tags = db.prepare(`
      SELECT tag_type, tag_value FROM document_tags WHERE document_id = ?
    `).all(id);

    const tagsByType = {
      people: tags.filter(t => t.tag_type === 'person').map(t => t.tag_value),
      projects: tags.filter(t => t.tag_type === 'project').map(t => t.tag_value),
      semantics: tags.filter(t => t.tag_type === 'semantic').map(t => t.tag_value)
    };

    res.json({
      id: doc.id,
      filename: doc.filename,
      filepath: doc.filepath,
      title: doc.title,
      content: doc.raw_content,
      wordCount: doc.word_count,
      contentType: doc.content_type_name,
      rteName: doc.rte_name,
      documentDate: doc.document_date,
      extractionStatus: doc.extraction_status,
      createdAt: doc.created_at,
      tags: tagsByType
    });
  } catch (error) {
    console.error('[Search] Get document failed:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /recent - Get recent documents (no query required)
 * Used by home page to show recent activity
 */
router.get('/recent', (req, res) => {
  const { limit = 5, rteId } = req.query;
  const db = getDb();

  if (!db) {
    return res.status(500).json({ error: 'Database not initialized' });
  }

  try {
    let query = `
      SELECT
        rd.id,
        rd.filename,
        rd.title,
        rd.filepath,
        rd.file_type as content_type,
        rd.document_date,
        rd.created_at,
        rd.word_count,
        r.name as rte_name,
        r.id as rte_id
      FROM rte_documents rd
      LEFT JOIN rtes r ON rd.rte_id = r.id
    `;

    const params = [];

    if (rteId) {
      query += ` WHERE rd.rte_id = ?`;
      params.push(rteId);
    }

    query += ` ORDER BY rd.created_at DESC LIMIT ?`;
    params.push(parseInt(limit) || 5);

    const docs = db.prepare(query).all(...params);

    res.json({ results: docs });
  } catch (error) {
    console.error('[Search] Recent documents failed:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /stats - Get index statistics
 */
router.get('/stats', async (req, res) => {
  try {
    const vectorSearch = getSqliteVectorSearch();
    const stats = await vectorSearch.getStats();

    res.json(stats);
  } catch (error) {
    console.error('[Search] Stats failed:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /reindex - Rebuild entire index for an RTE
 */
router.post('/reindex', async (req, res) => {
  const { rteId } = req.body;

  if (!rteId) {
    return res.status(400).json({ error: 'Missing rteId' });
  }

  try {
    const db = getDb();
    const vectorSearch = getSqliteVectorSearch();

    // Get RTE name from database
    const rte = db.prepare('SELECT name FROM rtes WHERE id = ?').get(rteId);
    if (!rte) {
      return res.status(404).json({ error: 'RTE not found' });
    }

    // Construct path from RTE name
    const os = require('os');
    const path = require('path');
    const basePath = path.join(os.homedir(), 'ProductOwnerAI', 'rte', rte.name.toLowerCase());

    const result = await vectorSearch.rebuildIndex(parseInt(rteId), basePath);

    res.json({
      success: true,
      message: 'Reindex completed',
      ...result
    });
  } catch (error) {
    console.error('[Search] Reindex failed:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============================================================
// Phase 3: Saved Searches
// ============================================================

/**
 * GET /saved - List all saved searches
 */
router.get('/saved', (req, res) => {
  const db = getDb();
  if (!db) {
    return res.status(500).json({ error: 'Database not initialized' });
  }

  try {
    const searches = db.prepare(`
      SELECT id, name, query, filters, created_at
      FROM saved_searches
      ORDER BY created_at DESC
    `).all();

    res.json(searches.map(s => ({
      ...s,
      filters: s.filters ? JSON.parse(s.filters) : null
    })));
  } catch (error) {
    console.error('[Search] List saved searches failed:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /saved - Save a search query
 */
router.post('/saved', (req, res) => {
  const { name, query, filters } = req.body;
  
  if (!name || !query) {
    return res.status(400).json({ error: 'Missing name or query' });
  }

  const db = getDb();
  if (!db) {
    return res.status(500).json({ error: 'Database not initialized' });
  }

  try {
    const result = db.prepare(`
      INSERT INTO saved_searches (name, query, filters)
      VALUES (?, ?, ?)
    `).run(name, query, filters ? JSON.stringify(filters) : null);

    res.json({
      success: true,
      id: result.lastInsertRowid,
      message: `Search "${name}" saved`
    });
  } catch (error) {
    console.error('[Search] Save search failed:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * DELETE /saved/:id - Delete a saved search
 */
router.delete('/saved/:id', (req, res) => {
  const { id } = req.params;

  const db = getDb();
  if (!db) {
    return res.status(500).json({ error: 'Database not initialized' });
  }

  try {
    const result = db.prepare('DELETE FROM saved_searches WHERE id = ?').run(id);

    if (result.changes === 0) {
      return res.status(404).json({ error: 'Saved search not found' });
    }

    res.json({ success: true, message: 'Saved search deleted' });
  } catch (error) {
    console.error('[Search] Delete saved search failed:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /markers - Search semantic markers (question, decision, insight, action)
 * Query params:
 *   - q: search query (searches marker_content)
 *   - type: filter by marker_type (question|decision|insight|action)
 *   - rteId: filter by RTE ID
 *   - resolved: filter by resolved status (true|false|all, default: all)
 *   - limit: max results (default: 50)
 */
router.get('/markers', (req, res) => {
  const { q, type, rteId, resolved, limit } = req.query;

  const db = getDb();
  if (!db) {
    return res.status(500).json({ error: 'Database not initialized' });
  }

  try {
    const conditions = [];
    const params = [];

    // Text search in marker_content
    if (q) {
      conditions.push(`m.marker_content LIKE ?`);
      params.push(`%${q}%`);
    }

    // Filter by marker type
    if (type) {
      conditions.push(`m.marker_type = ?`);
      params.push(type);
    }

    // Filter by RTE
    if (rteId) {
      conditions.push(`m.rte_id = ?`);
      params.push(parseInt(rteId));
    }

    // Filter by resolved status
    if (resolved === 'true') {
      conditions.push(`m.is_resolved = 1`);
    } else if (resolved === 'false') {
      conditions.push(`m.is_resolved = 0`);
    }
    // 'all' or undefined = no filter

    const whereClause = conditions.length > 0 
      ? `WHERE ${conditions.join(' AND ')}` 
      : '';

    const limitVal = parseInt(limit) || 50;

    const query = `
      SELECT 
        m.id,
        m.document_id,
        m.rte_id,
        m.marker_type,
        m.marker_content,
        m.is_resolved,
        m.resolved_at,
        m.created_at,
        d.filename as document_name,
        d.filepath as document_path,
        r.name as rte_name
      FROM semantic_markers m
      JOIN rte_documents d ON m.document_id = d.id
      LEFT JOIN rtes r ON m.rte_id = r.id
      ${whereClause}
      ORDER BY m.created_at DESC
      LIMIT ?
    `;

    const markers = db.prepare(query).all(...params, limitVal);

    // Group by type for summary
    const summary = {
      question: 0,
      decision: 0,
      insight: 0,
      action: 0
    };

    markers.forEach(m => {
      if (summary.hasOwnProperty(m.marker_type)) {
        summary[m.marker_type]++;
      }
    });

    res.json({
      markers,
      summary,
      total: markers.length
    });
  } catch (error) {
    console.error('[Search] Markers search failed:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * PATCH /markers/:id - Update marker (e.g., mark as resolved)
 */
router.patch('/markers/:id', (req, res) => {
  const { id } = req.params;
  const { is_resolved } = req.body;

  const db = getDb();
  if (!db) {
    return res.status(500).json({ error: 'Database not initialized' });
  }

  try {
    const updates = [];
    const params = [];

    if (is_resolved !== undefined) {
      updates.push(`is_resolved = ?`);
      params.push(is_resolved ? 1 : 0);
      
      if (is_resolved) {
        updates.push(`resolved_at = datetime('now')`);
      } else {
        updates.push(`resolved_at = NULL`);
      }
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'No updates provided' });
    }

    params.push(parseInt(id));

    const query = `UPDATE semantic_markers SET ${updates.join(', ')} WHERE id = ?`;
    const result = db.prepare(query).run(...params);

    if (result.changes === 0) {
      return res.status(404).json({ error: 'Marker not found' });
    }

    res.json({ success: true, message: 'Marker updated' });
  } catch (error) {
    console.error('[Search] Update marker failed:', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
