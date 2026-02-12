/**
 * Register API Routes
 * Risk & Action Register — manages semantic markers with ownership,
 * due dates, severity, and response threads
 */

const express = require('express');
const router = express.Router();
const { getDb } = require('../db/connection');

/**
 * GET /api/register
 * List register items (filtered semantic markers)
 * 
 * Query params:
 *   - type: filter by marker type (risk, action, blocker, promise, etc.)
 *   - rteId: filter by RTE
 *   - resolved: 0, 1, or omit for all
 *   - severity: low, medium, high, critical
 *   - owner: filter by owner name
 *   - overdue: '1' to show only overdue items
 *   - limit: max results (default 100)
 *   - offset: pagination offset
 */
router.get('/', (req, res) => {
  const db = getDb();
  if (!db) return res.status(500).json({ error: 'Database not available' });

  try {
    const { type, rteId, resolved, severity, owner, overdue, limit = 100, offset = 0 } = req.query;
    
    let whereConditions = [];
    let params = [];
    
    // Default to actionable types when no type filter specified
    const ACTIONABLE_TYPES = ['risk', 'action', 'blocker', 'promise'];
    
    if (type) {
      if (type === '_all') {
        // Explicit "show all" — no type filter
      } else {
        whereConditions.push('m.marker_type = ?');
        params.push(type);
      }
    } else {
      // Default: only actionable types
      whereConditions.push(`m.marker_type IN (${ACTIONABLE_TYPES.map(() => '?').join(',')})`);
      params.push(...ACTIONABLE_TYPES);
    }
    
    if (rteId) {
      whereConditions.push('m.rte_id = ?');
      params.push(parseInt(rteId));
    }
    
    if (resolved !== undefined && resolved !== '') {
      whereConditions.push('m.is_resolved = ?');
      params.push(parseInt(resolved));
    }
    
    if (severity) {
      whereConditions.push('m.severity = ?');
      params.push(severity);
    }
    
    if (owner) {
      whereConditions.push('m.owner = ?');
      params.push(owner);
    }
    
    if (overdue === '1') {
      whereConditions.push("m.due_date < date('now') AND m.is_resolved = 0");
    }
    
    const whereClause = whereConditions.length > 0 
      ? 'WHERE ' + whereConditions.join(' AND ')
      : '';
    
    const items = db.prepare(`
      SELECT 
        m.id,
        m.document_id,
        m.rte_id,
        m.marker_type,
        m.marker_content,
        m.is_resolved,
        m.resolved_at,
        m.owner,
        m.due_date,
        m.severity,
        m.created_at,
        d.filename,
        d.filepath,
        d.document_date,
        r.name as rte_name,
        (SELECT COUNT(*) FROM marker_responses mr WHERE mr.marker_id = m.id) as response_count
      FROM semantic_markers m
      LEFT JOIN rte_documents d ON m.document_id = d.id
      LEFT JOIN rtes r ON m.rte_id = r.id
      ${whereClause}
      ORDER BY 
        CASE WHEN m.is_resolved = 0 AND m.due_date < date('now') THEN 0 ELSE 1 END,
        CASE m.severity 
          WHEN 'critical' THEN 0 
          WHEN 'high' THEN 1 
          WHEN 'medium' THEN 2 
          WHEN 'low' THEN 3 
          ELSE 4 
        END,
        m.created_at DESC
      LIMIT ? OFFSET ?
    `).all(...params, parseInt(limit), parseInt(offset));
    
    const countResult = db.prepare(`
      SELECT COUNT(*) as total FROM semantic_markers m ${whereClause}
    `).get(...params);
    
    res.json({
      items,
      total: countResult.total,
      limit: parseInt(limit),
      offset: parseInt(offset)
    });
    
  } catch (error) {
    console.error('[Register] List failed:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/register/types
 * Get all marker types with counts
 */
router.get('/types', (req, res) => {
  const db = getDb();
  if (!db) return res.status(500).json({ error: 'Database not available' });

  try {
    const { rteId, resolved } = req.query;
    let whereConditions = [];
    let params = [];

    if (rteId) {
      whereConditions.push('rte_id = ?');
      params.push(parseInt(rteId));
    }
    if (resolved !== undefined && resolved !== '') {
      whereConditions.push('is_resolved = ?');
      params.push(parseInt(resolved));
    }

    const whereClause = whereConditions.length > 0
      ? 'WHERE ' + whereConditions.join(' AND ')
      : '';

    const types = db.prepare(`
      SELECT marker_type, COUNT(*) as count
      FROM semantic_markers
      ${whereClause}
      GROUP BY marker_type
      ORDER BY count DESC
    `).all(...params);

    res.json({ types });
  } catch (error) {
    console.error('[Register] Types failed:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/register/stats
 * Get register statistics
 */
router.get('/stats', (req, res) => {
  const db = getDb();
  if (!db) return res.status(500).json({ error: 'Database not available' });

  try {
    const { rteId, scope } = req.query;
    const ACTIONABLE_TYPES = ['risk', 'action', 'blocker', 'promise'];
    const typeFilter = scope === 'all' ? '' : `AND marker_type IN (${ACTIONABLE_TYPES.map(() => '?').join(',')})`;
    const typeParams = scope === 'all' ? [] : [...ACTIONABLE_TYPES];
    const rteFilter = rteId ? 'AND rte_id = ?' : '';
    const rteParams = rteId ? [parseInt(rteId)] : [];
    const allParams = [...typeParams, ...rteParams];

    const stats = {
      total: db.prepare(`SELECT COUNT(*) as n FROM semantic_markers WHERE 1=1 ${typeFilter} ${rteFilter}`).get(...allParams).n,
      open: db.prepare(`SELECT COUNT(*) as n FROM semantic_markers WHERE is_resolved = 0 ${typeFilter} ${rteFilter}`).get(...allParams).n,
      resolved: db.prepare(`SELECT COUNT(*) as n FROM semantic_markers WHERE is_resolved = 1 ${typeFilter} ${rteFilter}`).get(...allParams).n,
      overdue: db.prepare(`SELECT COUNT(*) as n FROM semantic_markers WHERE is_resolved = 0 AND due_date < date('now') AND due_date IS NOT NULL ${typeFilter} ${rteFilter}`).get(...allParams).n,
      bySeverity: db.prepare(`
        SELECT severity, COUNT(*) as count 
        FROM semantic_markers 
        WHERE is_resolved = 0 AND severity IS NOT NULL ${typeFilter} ${rteFilter}
        GROUP BY severity
      `).all(...allParams),
      byType: db.prepare(`
        SELECT marker_type, COUNT(*) as count 
        FROM semantic_markers 
        WHERE is_resolved = 0 ${typeFilter} ${rteFilter}
        GROUP BY marker_type 
        ORDER BY count DESC
      `).all(...allParams)
    };

    res.json(stats);
  } catch (error) {
    console.error('[Register] Stats failed:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/register/owners
 * Get distinct owners for filter dropdown
 */
router.get('/owners', (req, res) => {
  const db = getDb();
  if (!db) return res.status(500).json({ error: 'Database not available' });

  try {
    const owners = db.prepare(`
      SELECT DISTINCT owner FROM semantic_markers 
      WHERE owner IS NOT NULL AND owner != '' 
      ORDER BY owner
    `).all();
    res.json({ owners: owners.map(o => o.owner) });
  } catch (error) {
    console.error('[Register] Owners failed:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * PATCH /api/register/:id
 * Update a register item (owner, due_date, severity, content, resolved)
 */
router.patch('/:id', (req, res) => {
  const db = getDb();
  if (!db) return res.status(500).json({ error: 'Database not available' });

  try {
    const { id } = req.params;
    const { owner, due_date, severity, marker_content, is_resolved } = req.body;
    
    const updates = [];
    const params = [];
    
    if (owner !== undefined) { updates.push('owner = ?'); params.push(owner || null); }
    if (due_date !== undefined) { updates.push('due_date = ?'); params.push(due_date || null); }
    if (severity !== undefined) { updates.push('severity = ?'); params.push(severity || null); }
    if (marker_content !== undefined) { updates.push('marker_content = ?'); params.push(marker_content); }
    if (is_resolved !== undefined) {
      updates.push('is_resolved = ?');
      params.push(is_resolved ? 1 : 0);
      updates.push('resolved_at = ?');
      params.push(is_resolved ? new Date().toISOString() : null);
    }
    
    if (updates.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }
    
    params.push(id);
    db.prepare(`UPDATE semantic_markers SET ${updates.join(', ')} WHERE id = ?`).run(...params);
    
    const item = db.prepare(`
      SELECT m.*, d.filename, d.filepath, r.name as rte_name
      FROM semantic_markers m
      LEFT JOIN rte_documents d ON m.document_id = d.id
      LEFT JOIN rtes r ON m.rte_id = r.id
      WHERE m.id = ?
    `).get(id);
    
    res.json({ success: true, item });
  } catch (error) {
    console.error('[Register] Update failed:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/register/:id/responses
 * Get all responses for a marker
 */
router.get('/:id/responses', (req, res) => {
  const db = getDb();
  if (!db) return res.status(500).json({ error: 'Database not available' });

  try {
    const responses = db.prepare(`
      SELECT mr.*, d.filename as source_filename
      FROM marker_responses mr
      LEFT JOIN rte_documents d ON mr.source_document_id = d.id
      WHERE mr.marker_id = ?
      ORDER BY mr.created_at ASC
    `).all(req.params.id);
    
    res.json({ responses });
  } catch (error) {
    console.error('[Register] Responses failed:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/register/:id/respond
 * Add a response/mitigation entry to a marker
 */
router.post('/:id/respond', (req, res) => {
  const db = getDb();
  if (!db) return res.status(500).json({ error: 'Database not available' });

  try {
    const { id } = req.params;
    const { response_text, response_type = 'update', author } = req.body;
    
    if (!response_text || !response_text.trim()) {
      return res.status(400).json({ error: 'Response text is required' });
    }
    
    const result = db.prepare(`
      INSERT INTO marker_responses (marker_id, response_text, response_type, author)
      VALUES (?, ?, ?, ?)
    `).run(id, response_text.trim(), response_type, author || null);
    
    const response = db.prepare('SELECT * FROM marker_responses WHERE id = ?').get(result.lastInsertRowid);
    
    res.json({ success: true, response });
  } catch (error) {
    console.error('[Register] Respond failed:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * DELETE /api/register/response/:responseId
 * Delete a response entry
 */
router.delete('/response/:responseId', (req, res) => {
  const db = getDb();
  if (!db) return res.status(500).json({ error: 'Database not available' });

  try {
    const result = db.prepare('DELETE FROM marker_responses WHERE id = ?').run(req.params.responseId);
    res.json({ success: result.changes > 0 });
  } catch (error) {
    console.error('[Register] Delete response failed:', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
