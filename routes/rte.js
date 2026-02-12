/**
 * RTE Routes - Release Train Engine
 * All routes are RTE-scoped with /:rteId/ parameter
 * Uses proper rte_actors, rte_relationships, rte_relationship_suggestions tables
 */

const express = require('express');
const router = express.Router();
const { getDb } = require('../db/connection');
const fs = require('fs');
const path = require('path');
const os = require('os');

// Services
let graphBuilder = null;
try {
  graphBuilder = require('../services/graph-builder');
} catch (e) {
  console.log('[RTE Routes] GraphBuilder not available');
}

// ===========================================
// RTE INSTANCES
// ===========================================

/**
 * GET /api/rte
 * List all RTEs (simple format for dropdowns)
 */
router.get('/', (req, res) => {
  const db = getDb();
  if (!db) {
    return res.status(500).json({ error: 'Database not available' });
  }

  try {
    const rtes = db.prepare(`
      SELECT id, name, status, metadata_json
      FROM rtes
      ORDER BY 
        CASE WHEN status = 'system' THEN 1 ELSE 0 END,
        name
    `).all();

    res.json(rtes.map(r => ({
      id: r.id,
      name: r.name,
      status: r.status,
      readOnly: JSON.parse(r.metadata_json || '{}').read_only || false
    })));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/rte/instances
 * List all RTE instances (legacy, with more details)
 */
router.get('/instances', (req, res) => {
  const db = getDb();
  if (!db) {
    return res.status(500).json({ error: 'Database not available' });
  }

  try {
    // Legacy table might not exist, fallback to rtes
    const instances = db.prepare(`SELECT id, name, metadata_json as description, created_at FROM rtes ORDER BY name`).all();
    res.json({ instances, total: instances.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ===========================================
// ACTORS (RTE-scoped)
// ===========================================

/**
 * GET /api/rte/:rteId/actors
 * Returns all actors for a specific RTE
 * Query params: archived=true to include archived actors
 */
router.get('/:rteId/actors', (req, res) => {
  const db = getDb();
  if (!db) {
    return res.status(500).json({ error: 'Database not available' });
  }

  const { rteId } = req.params;
  const includeArchived = req.query.archived === 'true';
  const archivedFilter = includeArchived ? '' : 'AND archived_at IS NULL';

  try {
    const actors = db.prepare(`
      SELECT id, name, actor_type, description, role, team, organization, 
             metadata_json, created_at, updated_at, last_seen_at, mention_count, archived_at 
      FROM rte_actors 
      WHERE rte_id = ? ${archivedFilter}
      ORDER BY actor_type, name
    `).all(rteId);

    // Group by actor_type
    const grouped = {};
    actors.forEach(a => {
      if (!grouped[a.actor_type]) grouped[a.actor_type] = [];
      grouped[a.actor_type].push(a);
    });

    res.json({ actors, grouped, total: actors.length, rteId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/rte/:rteId/actors
 * Create a new actor
 */
router.post('/:rteId/actors', (req, res) => {
  const db = getDb();
  if (!db) {
    return res.status(500).json({ error: 'Database not available' });
  }

  const { rteId } = req.params;
  const { name, actor_type, description, role, team, organization, metadata } = req.body;

  if (!name || !actor_type) {
    return res.status(400).json({ error: 'name and actor_type are required' });
  }

  try {
    const result = db.prepare(`
      INSERT INTO rte_actors (rte_id, name, actor_type, description, role, team, organization, metadata_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
      ON CONFLICT(rte_id, actor_type, name) DO UPDATE SET 
        description = excluded.description,
        role = excluded.role,
        team = excluded.team,
        organization = excluded.organization,
        metadata_json = excluded.metadata_json,
        updated_at = datetime('now')
    `).run(rteId, name, actor_type, description || null, role || null, team || null, organization || null, JSON.stringify(metadata || {}));
    
    res.json({ id: result.lastInsertRowid, name, actor_type, rteId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * DELETE /api/rte/:rteId/actors/:actorId
 * Delete an actor
 */
router.delete('/:rteId/actors/:actorId', (req, res) => {
  const db = getDb();
  if (!db) {
    return res.status(500).json({ error: 'Database not available' });
  }

  const { rteId, actorId } = req.params;

  try {
    const result = db.prepare(`DELETE FROM rte_actors WHERE id = ? AND rte_id = ?`).run(actorId, rteId);
    res.json({ deleted: result.changes > 0 });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/rte/:rteId/sync-tags-to-actors
 * Create actors from document tags (projects, systems, organizations, etc.)
 */
router.post('/:rteId/sync-tags-to-actors', (req, res) => {
  const db = getDb();
  if (!db) {
    return res.status(500).json({ error: 'Database not available' });
  }

  const { rteId } = req.params;

  try {
    // Get unique tags from documents in this RTE (excluding person and semantic)
    const tags = db.prepare(`
      SELECT DISTINCT dt.tag_type, dt.tag_value
      FROM document_tags dt
      JOIN rte_documents rd ON dt.document_id = rd.id
      WHERE rd.rte_id = ?
        AND dt.tag_type IN ('project', 'system', 'organization', 'location', 'technology')
      ORDER BY dt.tag_type, dt.tag_value
    `).all(rteId);

    // Also get people tags
    const peopleTags = db.prepare(`
      SELECT DISTINCT dt.tag_value
      FROM document_tags dt
      JOIN rte_documents rd ON dt.document_id = rd.id
      WHERE rd.rte_id = ?
        AND dt.tag_type = 'person'
      ORDER BY dt.tag_value
    `).all(rteId);

    let created = 0;
    let skipped = 0;

    // Insert or update actors for entity tags
    const insertActor = db.prepare(`
      INSERT INTO rte_actors (rte_id, name, actor_type, description, created_at, updated_at)
      VALUES (?, ?, ?, ?, datetime('now'), datetime('now'))
      ON CONFLICT(rte_id, actor_type, name) DO NOTHING
    `);

    for (const tag of tags) {
      const result = insertActor.run(rteId, tag.tag_value, tag.tag_type, `Imported from document tags`);
      if (result.changes > 0) created++;
      else skipped++;
    }

    // Insert people as actors
    for (const p of peopleTags) {
      const result = insertActor.run(rteId, p.tag_value, 'person', `Imported from document tags`);
      if (result.changes > 0) created++;
      else skipped++;
    }

    // Clear graph cache to show new actors
    if (graphBuilder) {
      graphBuilder.invalidate(parseInt(rteId));
    }

    res.json({
      success: true,
      created,
      skipped,
      total: tags.length + peopleTags.length
    });
  } catch (err) {
    console.error('[RTE] Sync tags to actors error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ===========================================
// RELATIONSHIPS (RTE-scoped)
// ===========================================

/**
 * GET /api/rte/:rteId/relationships
 * Returns all relationships for a specific RTE
 */
router.get('/:rteId/relationships', (req, res) => {
  const db = getDb();
  if (!db) {
    return res.status(500).json({ error: 'Database not available' });
  }

  const { rteId } = req.params;

  try {
    const relationships = db.prepare(`
      SELECT r.id, r.relationship_type, r.description, r.context, r.strength, r.llm_confidence, r.is_approved, r.created_at,
             s.id as source_id, s.name as source_name, s.actor_type as source_type,
             t.id as target_id, t.name as target_name, t.actor_type as target_type
      FROM rte_relationships r
      LEFT JOIN rte_actors s ON r.source_actor_id = s.id
      LEFT JOIN rte_actors t ON r.target_actor_id = t.id
      WHERE r.rte_id = ?
      ORDER BY r.relationship_type, s.name
    `).all(rteId);

    // Group by relationship_type
    const grouped = {};
    relationships.forEach(r => {
      if (!grouped[r.relationship_type]) grouped[r.relationship_type] = [];
      grouped[r.relationship_type].push(r);
    });

    res.json({ relationships, grouped, total: relationships.length, rteId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/rte/:rteId/relationships
 * Create a new relationship
 */
router.post('/:rteId/relationships', (req, res) => {
  const db = getDb();
  if (!db) {
    return res.status(500).json({ error: 'Database not available' });
  }

  const { rteId } = req.params;
  const { source_actor_id, target_actor_id, relationship_type, description, context, strength, confidence } = req.body;

  if (!source_actor_id || !target_actor_id || !relationship_type) {
    return res.status(400).json({ error: 'source_actor_id, target_actor_id, and relationship_type are required' });
  }

  try {
    const result = db.prepare(`
      INSERT INTO rte_relationships (rte_id, source_actor_id, target_actor_id, relationship_type, description, context, strength, llm_confidence, is_approved, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, datetime('now'), datetime('now'))
      ON CONFLICT(rte_id, source_actor_id, relationship_type, target_actor_id) DO UPDATE SET
        description = excluded.description,
        context = excluded.context,
        strength = excluded.strength,
        llm_confidence = excluded.llm_confidence,
        updated_at = datetime('now')
    `).run(rteId, source_actor_id, target_actor_id, relationship_type, description || null, context || null, strength || 1.0, confidence || 1.0);
    
    res.json({ id: result.lastInsertRowid, relationship_type, rteId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * DELETE /api/rte/:rteId/relationships/:relId
 * Delete a relationship
 */
router.delete('/:rteId/relationships/:relId', (req, res) => {
  const db = getDb();
  if (!db) {
    return res.status(500).json({ error: 'Database not available' });
  }

  const { rteId, relId } = req.params;

  try {
    const result = db.prepare(`DELETE FROM rte_relationships WHERE id = ? AND rte_id = ?`).run(relId, rteId);
    res.json({ deleted: result.changes > 0 });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ===========================================
// SUGGESTIONS (RTE-scoped) - "Simmer" Pattern
// ===========================================

/**
 * GET /api/rte/:rteId/suggestions
 * Get relationship suggestions inbox with simmer stats
 */
router.get('/:rteId/suggestions', (req, res) => {
  const db = getDb();
  if (!db) {
    return res.status(500).json({ error: 'Database not available' });
  }

  const { rteId } = req.params;
  const { status, includeDismissed, minEvidence, sortBy } = req.query;

  try {
    // Build WHERE clause with parameterized queries
    let whereClause = 'sg.rte_id = ?';
    const params = [rteId];

    if (status === 'approved') {
      whereClause += ' AND sg.is_approved = 1';
    } else {
      whereClause += ' AND sg.is_approved = 0';
    }
    if (includeDismissed !== 'true') {
      whereClause += ' AND (sg.is_dismissed = 0 OR sg.is_dismissed IS NULL)';
    }
    if (minEvidence && parseInt(minEvidence) > 0) {
      whereClause += ' AND sg.evidence_count >= ?';
      params.push(parseInt(minEvidence));
    }

    // Sort order (whitelist approach - no user input in ORDER BY)
    const orderBy = sortBy === 'confidence'
      ? 'sg.llm_confidence DESC, sg.evidence_count DESC'
      : 'sg.evidence_count DESC, sg.llm_confidence DESC';

    const suggestions = db.prepare(`
      SELECT sg.id, sg.relationship_type, sg.source_text, sg.llm_confidence,
             sg.is_approved, sg.is_dismissed, sg.evidence_count, sg.source_documents,
             sg.context_samples, sg.last_seen_at, sg.created_at,
             s.id as source_id, s.name as source_name, s.actor_type as source_type,
             t.id as target_id, t.name as target_name, t.actor_type as target_type
      FROM rte_relationship_suggestions sg
      LEFT JOIN rte_actors s ON sg.source_actor_id = s.id
      LEFT JOIN rte_actors t ON sg.target_actor_id = t.id
      WHERE ${whereClause}
      ORDER BY ${orderBy}
      LIMIT 50
    `).all(...params);
    
    // Get stats
    const stats = db.prepare(`
      SELECT 
        COUNT(*) as total,
        SUM(CASE WHEN is_dismissed = 0 OR is_dismissed IS NULL THEN 1 ELSE 0 END) as pending,
        SUM(CASE WHEN evidence_count >= 3 THEN 1 ELSE 0 END) as strong_evidence,
        SUM(CASE WHEN llm_confidence >= 0.7 THEN 1 ELSE 0 END) as high_confidence,
        SUM(CASE WHEN is_dismissed = 1 THEN 1 ELSE 0 END) as dismissed,
        ROUND(AVG(evidence_count), 1) as avg_evidence
      FROM rte_relationship_suggestions
      WHERE rte_id = ? AND is_approved = 0
    `).get(rteId);
    
    res.json({ suggestions, stats, total: suggestions.length, rteId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/rte/:rteId/suggestions/:suggestionId/approve
 * Approve a suggestion (convert to confirmed relationship)
 */
router.post('/:rteId/suggestions/:suggestionId/approve', (req, res) => {
  const db = getDb();
  if (!db) {
    return res.status(500).json({ error: 'Database not available' });
  }

  const { rteId, suggestionId } = req.params;

  try {
    // Get the suggestion
    const suggestion = db.prepare(`SELECT * FROM rte_relationship_suggestions WHERE id = ? AND rte_id = ?`).get(suggestionId, rteId);
    
    if (!suggestion) {
      return res.status(404).json({ error: 'Suggestion not found' });
    }

    // Create the confirmed relationship
    const insertResult = db.prepare(`
      INSERT INTO rte_relationships (rte_id, source_actor_id, target_actor_id, relationship_type, context, llm_confidence, is_approved, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, 1, datetime('now'), datetime('now'))
      ON CONFLICT(rte_id, source_actor_id, relationship_type, target_actor_id) DO NOTHING
    `).run(rteId, suggestion.source_actor_id, suggestion.target_actor_id, suggestion.relationship_type, suggestion.source_text, suggestion.llm_confidence);

    // Mark suggestion as approved
    db.prepare(`UPDATE rte_relationship_suggestions SET is_approved = 1, reviewed_at = datetime('now') WHERE id = ?`).run(suggestionId);
    
    res.json({ approved: true, relationshipId: insertResult.lastInsertRowid, evidence: suggestion.evidence_count });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/rte/:rteId/suggestions/:suggestionId/reject
 * Reject a suggestion (delete it, can be re-suggested later)
 */
router.post('/:rteId/suggestions/:suggestionId/reject', (req, res) => {
  const db = getDb();
  if (!db) {
    return res.status(500).json({ error: 'Database not available' });
  }

  const { rteId, suggestionId } = req.params;

  try {
    const result = db.prepare(`DELETE FROM rte_relationship_suggestions WHERE id = ? AND rte_id = ?`).run(suggestionId, rteId);
    res.json({ rejected: result.changes > 0 });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/rte/:rteId/suggestions/:suggestionId/dismiss
 * Dismiss a suggestion forever (never suggest again)
 */
router.post('/:rteId/suggestions/:suggestionId/dismiss', (req, res) => {
  const db = getDb();
  if (!db) {
    return res.status(500).json({ error: 'Database not available' });
  }

  const { rteId, suggestionId } = req.params;

  try {
    const result = db.prepare(`
      UPDATE rte_relationship_suggestions 
      SET is_dismissed = 1, reviewed_at = datetime('now') 
      WHERE id = ? AND rte_id = ?
    `).run(suggestionId, rteId);
    res.json({ dismissed: result.changes > 0 });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ===========================================
// STATS (RTE-scoped)
// ===========================================

/**
 * GET /api/rte/:rteId/stats
 * Returns summary stats for an RTE
 */
router.get('/:rteId/stats', (req, res) => {
  const db = getDb();
  if (!db) {
    return res.status(500).json({ error: 'Database not available' });
  }

  const { rteId } = req.params;
  const stats = { rteId };

  try {
    const actorRow = db.prepare(`SELECT COUNT(*) as count FROM rte_actors WHERE rte_id = ?`).get(rteId);
    stats.actors = actorRow?.count || 0;

    const relationshipRow = db.prepare(`SELECT COUNT(*) as count FROM rte_relationships WHERE rte_id = ?`).get(rteId);
    stats.relationships = relationshipRow?.count || 0;

    const suggestionRow = db.prepare(`SELECT COUNT(*) as count FROM rte_relationship_suggestions WHERE rte_id = ? AND is_approved = 0`).get(rteId);
    stats.pendingSuggestions = suggestionRow?.count || 0;

    const docRow = db.prepare(`SELECT COUNT(*) as count FROM rte_documents WHERE rte_id = ?`).get(rteId);
    stats.documents = docRow?.count || 0;

    res.json(stats);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ===========================================
// GRAPH (RTE-scoped)
// ===========================================

/**
 * GET /api/rte/:rteId/graph
 * Returns full graph as JSON for visualization
 */
router.get('/:rteId/graph', async (req, res) => {
  if (!graphBuilder) {
    return res.status(503).json({ error: 'Graph service not available' });
  }

  try {
    const { rteId } = req.params;
    const { refresh, actorTypes, edgeTypes, minConfidence, groupBy, includeArchived } = req.query;
    
    // Parse comma-separated filters
    const typeFilter = actorTypes ? actorTypes.split(',').filter(t => t.trim()) : null;
    const edgeFilter = edgeTypes ? edgeTypes.split(',').filter(t => t.trim()) : null;
    
    const graph = await graphBuilder.toJSON(rteId, { 
      refresh: refresh === 'true',
      actorTypes: typeFilter,
      edgeTypes: edgeFilter,
      minConfidence: minConfidence ? parseFloat(minConfidence) : 0,
      groupBy: groupBy || null,
      includeArchived: includeArchived === 'true'
    });
    res.json(graph);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/rte/:rteId/graph/neighbors/:actorId
 * Get neighbors of a specific actor
 */
router.get('/:rteId/graph/neighbors/:actorId', async (req, res) => {
  if (!graphBuilder) {
    return res.status(503).json({ error: 'Graph service not available' });
  }

  try {
    const { rteId, actorId } = req.params;
    const depth = parseInt(req.query.depth) || 1;
    
    const neighbors = await graphBuilder.getNeighbors(rteId, actorId, depth);
    res.json(neighbors);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/rte/:rteId/graph/path/:from/:to
 * Find shortest path between two actors
 */
router.get('/:rteId/graph/path/:from/:to', async (req, res) => {
  if (!graphBuilder) {
    return res.status(503).json({ error: 'Graph service not available' });
  }

  try {
    const { rteId, from, to } = req.params;
    
    const path = await graphBuilder.findPath(rteId, from, to);
    res.json({ path, found: path !== null });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/rte/:rteId/graph/hubs
 * Get most connected actors
 */
router.get('/:rteId/graph/hubs', async (req, res) => {
  if (!graphBuilder) {
    return res.status(503).json({ error: 'Graph service not available' });
  }

  try {
    const { rteId } = req.params;
    const limit = parseInt(req.query.limit) || 10;
    
    const hubs = await graphBuilder.getHubs(rteId, limit);
    res.json({ hubs });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/rte/:rteId/graph/isolated
 * Get actors with no relationships
 */
router.get('/:rteId/graph/isolated', async (req, res) => {
  if (!graphBuilder) {
    return res.status(503).json({ error: 'Graph service not available' });
  }

  try {
    const { rteId } = req.params;
    
    const isolated = await graphBuilder.getIsolated(rteId);
    res.json({ isolated });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/rte/:rteId/graph/refresh
 * Force refresh the graph cache
 */
router.post('/:rteId/graph/refresh', async (req, res) => {
  if (!graphBuilder) {
    return res.status(503).json({ error: 'Graph service not available' });
  }

  try {
    const { rteId } = req.params;
    
    graphBuilder.invalidate(rteId);
    const graph = await graphBuilder.toJSON(rteId);
    res.json({ refreshed: true, nodes: graph.nodes.length, edges: graph.edges.length });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ===========================================
// DOCUMENTS (RTE-scoped)
// ===========================================

/**
 * GET /api/rte/:rteId/documents
 * Returns all documents for an RTE
 */
router.get('/:rteId/documents', (req, res) => {
  const db = getDb();
  if (!db) {
    return res.status(500).json({ error: 'Database not available' });
  }

  const { rteId } = req.params;

  try {
    const documents = db.prepare(
      `SELECT id, filename, filepath, file_type, category, title, created_at 
       FROM rte_documents 
       WHERE rte_id = ? 
       ORDER BY created_at DESC 
       LIMIT 100`
    ).all(rteId);
    res.json({ documents, total: documents.length, rteId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/rte/:rteId/documents/:docId/content
 * Get document content
 */
router.get('/:rteId/documents/:docId/content', (req, res) => {
  const db = getDb();
  if (!db) {
    return res.status(500).json({ error: 'Database not available' });
  }

  const { rteId, docId } = req.params;

  try {
    const row = db.prepare(
      `SELECT filepath FROM rte_documents WHERE id = ? AND rte_id = ?`
    ).get(docId, rteId);

    if (!row || !row.filepath) {
      return res.status(404).json({ error: 'Document not found' });
    }

    if (fs.existsSync(row.filepath)) {
      const content = fs.readFileSync(row.filepath, 'utf-8');
      res.json({ content, filepath: row.filepath });
    } else {
      res.status(404).json({ error: 'File not found on disk' });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ===========================================
// LEGACY ROUTES (backward compatibility)
// ===========================================

/**
 * GET /api/rte/entities (LEGACY - redirects to first RTE)
 */
router.get('/entities', (req, res) => {
  const db = getDb();
  if (!db) {
    return res.status(500).json({ error: 'Database not available' });
  }

  // Get first RTE and redirect
  try {
    const rteRow = db.prepare(`SELECT id FROM rtes ORDER BY id LIMIT 1`).get();
    if (!rteRow) {
      return res.json({ entities: [], grouped: {}, total: 0, warning: 'No RTE found. Create one first.' });
    }

    // Proxy to new route
    req.params.rteId = rteRow.id;

    const actors = db.prepare(
      `SELECT id, name, actor_type as type, description, role, team, organization, metadata_json, created_at, updated_at 
       FROM rte_actors 
       WHERE rte_id = ? 
       ORDER BY actor_type, name`
    ).all(rteRow.id);

    // Map to old format for backward compatibility
    const entities = actors.map(a => ({
      id: a.id,
      name: a.name,
      type: a.type,
      role: a.role,
      metadata: a.metadata_json,
      created_at: a.created_at
    }));

    const grouped = {};
    entities.forEach(e => {
      if (!grouped[e.type]) grouped[e.type] = [];
      grouped[e.type].push(e);
    });

    res.json({ entities, grouped, total: entities.length, rteId: rteRow.id, legacy: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/rte/relationships (LEGACY - redirects to first RTE)
 */
router.get('/relationships', (req, res) => {
  const db = getDb();
  if (!db) {
    return res.status(500).json({ error: 'Database not available' });
  }

  try {
    const rteRow = db.prepare(`SELECT id FROM rtes ORDER BY id LIMIT 1`).get();
    if (!rteRow) {
      return res.json({ relationships: [], grouped: {}, total: 0, warning: 'No RTE found' });
    }

    const relationships = db.prepare(
      `SELECT r.id, r.relationship_type as type, r.context, r.llm_confidence, r.created_at,
              s.name as source_name, t.name as target_name
       FROM rte_relationships r
       LEFT JOIN rte_actors s ON r.source_actor_id = s.id
       LEFT JOIN rte_actors t ON r.target_actor_id = t.id
       WHERE r.rte_id = ?
       ORDER BY r.relationship_type`
    ).all(rteRow.id);

    const grouped = {};
    relationships.forEach(r => {
      if (!grouped[r.type]) grouped[r.type] = [];
      grouped[r.type].push(r);
    });

    res.json({ relationships, grouped, total: relationships.length, rteId: rteRow.id, legacy: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/rte/files (LEGACY)
 */
router.get('/files', (req, res) => {
  const db = getDb();
  if (!db) {
    return res.status(500).json({ error: 'Database not available' });
  }

  try {
    // Try old files table first, then fall back to rte_documents
    const files = db.prepare(
      `SELECT * FROM files ORDER BY created_at DESC LIMIT 50`
    ).all();
    
    res.json({ files, total: files.length });
  } catch (err) {
    try {
      // Try rte_documents instead
      const docs = db.prepare(
        `SELECT id, filename, filepath, file_type as type, created_at FROM rte_documents ORDER BY created_at DESC LIMIT 50`
      ).all();
      res.json({ files: docs, total: docs.length, legacy: true });
    } catch (err2) {
      res.status(500).json({ error: err2.message });
    }
  }
});

/**
 * GET /api/rte/stats (LEGACY)
 */
router.get('/stats', (req, res) => {
  const db = getDb();
  if (!db) {
    return res.status(500).json({ error: 'Database not available' });
  }

  try {
    const stats = {};

    const actorRow = db.prepare(`SELECT COUNT(*) as count FROM rte_actors`).get();
    stats.entities = actorRow?.count || 0;

    const relRow = db.prepare(`SELECT COUNT(*) as count FROM rte_relationships`).get();
    stats.relationships = relRow?.count || 0;

    const fileRow = db.prepare(`SELECT COUNT(*) as count FROM files`).get();
    stats.files = fileRow?.count || 0;

    const glossaryRow = db.prepare(`SELECT COUNT(*) as count FROM glossary`).get();
    stats.glossaryTerms = glossaryRow?.count || 0;

    res.json({ ...stats, legacy: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * DELETE /api/rte/entity/:id (LEGACY)
 */
router.delete('/entity/:id', (req, res) => {
  const db = getDb();
  if (!db) {
    return res.status(500).json({ error: 'Database not available' });
  }

  try {
    const result = db.prepare(`DELETE FROM rte_actors WHERE id = ?`).run(req.params.id);
    res.json({ deleted: result.changes > 0 });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * DELETE /api/rte/relationship/:id (LEGACY)
 */
router.delete('/relationship/:id', (req, res) => {
  const db = getDb();
  if (!db) {
    return res.status(500).json({ error: 'Database not available' });
  }

  try {
    const result = db.prepare(`DELETE FROM rte_relationships WHERE id = ?`).run(req.params.id);
    res.json({ deleted: result.changes > 0 });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/rte/file/:filename
 * Serve .md file content for viewing
 */
router.get('/file/:filename', (req, res) => {
  const db = getDb();
  if (!db) {
    return res.status(500).send('Database not available');
  }

  const filename = req.params.filename;

  // Look up file path in database
  try {
    const row = db.prepare(`SELECT filepath FROM files WHERE filename = ?`).get(filename);

    if (!row || !row.filepath) {
      // Try common locations
      const possiblePaths = [
        path.join(os.homedir(), 'ProductOwnerAI', 'rte', 'default', 'logs', 'daily', filename),
        path.join(os.homedir(), 'ProductOwnerAI', 'logs', 'daily', filename)
      ];

      for (const p of possiblePaths) {
        if (fs.existsSync(p)) {
          const content = fs.readFileSync(p, 'utf-8');
          res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
          return res.send(content);
        }
      }

      return res.status(404).send('File not found');
    }

    // Read file from stored path
    if (fs.existsSync(row.filepath)) {
      const content = fs.readFileSync(row.filepath, 'utf-8');
      res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
      res.send(content);
    } else {
      res.status(404).send('File not found at stored path');
    }
  } catch (err) {
    res.status(500).send(`Error: ${err.message}`);
  }
});

/**
 * DELETE /api/rte/file/:id
 * Delete a file (from DB and filesystem)
 */
router.delete('/file/:id', (req, res) => {
  const db = getDb();
  if (!db) {
    return res.status(500).json({ error: 'Database not available' });
  }

  const id = req.params.id;

  try {
    // Get filepath first
    const row = db.prepare(`SELECT filepath FROM files WHERE id = ?`).get(id);

    // Delete from filesystem
    if (row && row.filepath && fs.existsSync(row.filepath)) {
      fs.unlinkSync(row.filepath);
    }

    // Delete from database
    const result = db.prepare(`DELETE FROM files WHERE id = ?`).run(id);
    res.json({ deleted: result.changes > 0 });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * DELETE /api/rte/:rteId/documents/:docId
 * Delete a document and all related data:
 * - rte_documents row (triggers CASCADE for semantic_markers, document_tags, extraction_queue)
 * - document_chunks and documents_fts (search index)
 * - Optionally delete filesystem file
 * 
 * Note: Actors and relationships are NOT deleted (they may be referenced by other documents)
 */
router.delete('/:rteId/documents/:docId', async (req, res) => {
  const db = getDb();
  if (!db) {
    return res.status(500).json({ error: 'Database not available' });
  }

  const { rteId, docId } = req.params;
  const { deleteFile: shouldDeleteFile } = req.query; // ?deleteFile=true to also remove from filesystem

  try {
    // 1. Get document info before deletion
    const doc = db.prepare(`
      SELECT id, filepath, filename FROM rte_documents WHERE id = ? AND rte_id = ?
    `).get(docId, rteId);

    if (!doc) {
      return res.status(404).json({ error: 'Document not found' });
    }

    const deletedData = {
      document: false,
      searchIndex: false,
      filesystem: false,
      cascaded: []
    };

    // 2. Delete from search index (document_chunks and documents_fts)
    try {
      const { getInstance } = require('../services/sqlite-vector-search');
      const vectorSearch = getInstance();
      if (vectorSearch && vectorSearch.isReady) {
        await vectorSearch.deleteFile(doc.filepath);
        deletedData.searchIndex = true;
      }
    } catch (e) {
      console.log('[RTE] Vector search cleanup skipped:', e.message);
    }

    // 3. Check what will be cascaded (for reporting)
    const markerCount = db.prepare('SELECT COUNT(*) as count FROM semantic_markers WHERE document_id = ?').get(docId)?.count || 0;
    const tagCount = db.prepare('SELECT COUNT(*) as count FROM document_tags WHERE document_id = ?').get(docId)?.count || 0;
    const queueCount = db.prepare('SELECT COUNT(*) as count FROM extraction_queue WHERE document_id = ?').get(docId)?.count || 0;

    if (markerCount > 0) deletedData.cascaded.push(`${markerCount} semantic markers`);
    if (tagCount > 0) deletedData.cascaded.push(`${tagCount} document tags`);
    if (queueCount > 0) deletedData.cascaded.push(`${queueCount} extraction queue entries`);

    // 4. Delete from rte_documents (CASCADE handles markers, tags, queue)
    const result = db.prepare('DELETE FROM rte_documents WHERE id = ? AND rte_id = ?').run(docId, rteId);
    deletedData.document = result.changes > 0;

    // 5. Optionally delete from filesystem
    if (shouldDeleteFile === 'true' && doc.filepath && fs.existsSync(doc.filepath)) {
      fs.unlinkSync(doc.filepath);
      deletedData.filesystem = true;
    }

    console.log(`[RTE] Deleted document ${docId} (${doc.filename}):`, deletedData);

    res.json({
      success: deletedData.document,
      deleted: deletedData,
      message: `Deleted ${doc.filename}` + 
        (deletedData.cascaded.length > 0 ? ` (including ${deletedData.cascaded.join(', ')})` : '')
    });
  } catch (err) {
    console.error('[RTE] Document delete error:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * PUT /api/rte/file/:filename
 * Update file content
 */
router.put('/file/:filename', (req, res) => {
  const db = getDb();
  const filename = req.params.filename;
  const { content } = req.body;

  if (!content) {
    return res.status(400).json({ error: 'Content required' });
  }

  // Look up filepath in database
  try {
    const row = db.prepare(`SELECT filepath FROM files WHERE filename = ?`).get(filename);
    let filepath = row?.filepath;

    // If not in DB, try common locations
    if (!filepath) {
      const possiblePaths = [
        path.join(os.homedir(), 'ProductOwnerAI', 'rte', 'default', 'logs', 'daily', filename)
      ];

      for (const p of possiblePaths) {
        if (fs.existsSync(p)) {
          filepath = p;
          break;
        }
      }
    }

    if (!filepath) {
      return res.status(404).json({ error: 'File not found' });
    }

    // Write updated content
    fs.writeFileSync(filepath, content, 'utf-8');
    res.json({ success: true, filepath });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ===========================================
// MAINTENANCE - Deduplication
// ===========================================

/**
 * POST /api/rte/:rteId/deduplicate
 * Merge duplicate actors based on name similarity
 */
router.post('/:rteId/deduplicate', (req, res) => {
  const { rteId } = req.params;

  try {
    const intelligencePersistence = require('../services/intelligence-persistence');
    const result = intelligencePersistence.mergeDuplicates(rteId);
    res.json({ 
      success: true, 
      merged: result.merged, 
      groups: result.groups 
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ===============================================
// RELATIONSHIP DETAILS ENDPOINT (C.8)
// ===============================================

/**
 * GET /:rteId/relationships/:relId/details
 * Get detailed relationship info including source document
 */
router.get('/:rteId/relationships/:relId/details', (req, res) => {
  const { rteId, relId } = req.params;
  
  try {
    const db = getDb();
    const rel = db.prepare(`
      SELECT r.*, 
             sa.name as source_name, sa.actor_type as source_type,
             ta.name as target_name, ta.actor_type as target_type,
             d.filepath as source_filepath, d.filename as source_filename
      FROM rte_relationships r
      LEFT JOIN rte_actors sa ON r.source_actor_id = sa.id
      LEFT JOIN rte_actors ta ON r.target_actor_id = ta.id
      LEFT JOIN rte_documents d ON r.source_document_id = d.id
      WHERE r.rte_id = ? AND r.id = ?
    `).get(rteId, relId);
    
    if (!rel) {
      return res.status(404).json({ error: 'Relationship not found' });
    }
    
    res.json({
      id: rel.id,
      type: rel.relationship_type,
      context: rel.context,
      description: rel.description,
      strength: rel.strength,
      confidence: rel.llm_confidence,
      source: { id: rel.source_actor_id, name: rel.source_name, type: rel.source_type },
      target: { id: rel.target_actor_id, name: rel.target_name, type: rel.target_type },
      sourceDocument: rel.source_filepath ? {
        path: rel.source_filepath,
        filename: rel.source_filename
      } : null,
      createdAt: rel.created_at
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ===============================================
// ARCHIVAL SYSTEM ENDPOINTS (v7)
// ===============================================

/**
 * Archive actors (soft delete)
 * POST /:rteId/actors/archive
 * Body: { actorIds: number[] }
 */
router.post('/:rteId/actors/archive', (req, res) => {
  const { rteId } = req.params;
  const { actorIds } = req.body;
  
  if (!actorIds || !Array.isArray(actorIds) || actorIds.length === 0) {
    return res.status(400).json({ error: 'actorIds array required' });
  }
  
  try {
    const db = getDb();
    const placeholders = actorIds.map(() => '?').join(',');
    const stmt = db.prepare(`
      UPDATE rte_actors 
      SET archived_at = datetime('now')
      WHERE rte_id = ? AND id IN (${placeholders}) AND archived_at IS NULL
    `);
    const result = stmt.run(rteId, ...actorIds);
    
    res.json({ 
      success: true, 
      archived: result.changes,
      message: `Archived ${result.changes} actors`
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * Restore archived actors
 * POST /:rteId/actors/restore
 * Body: { actorIds: number[] }
 */
router.post('/:rteId/actors/restore', (req, res) => {
  const { rteId } = req.params;
  const { actorIds } = req.body;
  
  if (!actorIds || !Array.isArray(actorIds) || actorIds.length === 0) {
    return res.status(400).json({ error: 'actorIds array required' });
  }
  
  try {
    const db = getDb();
    const placeholders = actorIds.map(() => '?').join(',');
    const stmt = db.prepare(`
      UPDATE rte_actors 
      SET archived_at = NULL
      WHERE rte_id = ? AND id IN (${placeholders}) AND archived_at IS NOT NULL
    `);
    const result = stmt.run(rteId, ...actorIds);
    
    res.json({ 
      success: true, 
      restored: result.changes,
      message: `Restored ${result.changes} actors`
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * Get stale actors (not seen for X days)
 * GET /:rteId/actors/stale?days=90
 */
router.get('/:rteId/actors/stale', (req, res) => {
  const { rteId } = req.params;
  const days = parseInt(req.query.days) || 90;
  
  try {
    const db = getDb();
    const actors = db.prepare(`
      SELECT id, name, actor_type, team, organization, role,
             last_seen_at, mention_count, created_at
      FROM rte_actors 
      WHERE rte_id = ? 
        AND archived_at IS NULL
        AND last_seen_at < datetime('now', '-' || ? || ' days')
      ORDER BY last_seen_at ASC
    `).all(rteId, days);
    
    res.json({ 
      staleActors: actors, 
      threshold: days,
      count: actors.length
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * Get archived actors
 * GET /:rteId/actors/archived
 */
router.get('/:rteId/actors/archived', (req, res) => {
  const { rteId } = req.params;
  
  try {
    const db = getDb();
    const actors = db.prepare(`
      SELECT id, name, actor_type, team, organization, role,
             archived_at, last_seen_at, mention_count
      FROM rte_actors 
      WHERE rte_id = ? AND archived_at IS NOT NULL
      ORDER BY archived_at DESC
    `).all(rteId);
    
    res.json({ archivedActors: actors, count: actors.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
