/**
 * Stakeholder API Routes
 * Profile pages for people/actors with documents, relationships, notes
 */

const express = require('express');
const router = express.Router();
const { getDb } = require('../db/connection');

/**
 * GET /api/stakeholders
 * List all stakeholders (people-type actors)
 *
 * Query params:
 *   - rteId: optional RTE filter
 *   - search: optional name search
 *   - stakeholdersOnly: if '1', only show is_stakeholder=1
 */
router.get('/', (req, res) => {
  const db = getDb();
  if (!db) return res.status(500).json({ error: 'Database not ready' });

  const { rteId, search, stakeholdersOnly, showAll } = req.query;

  try {
    let where = [`a.actor_type = 'person'`, `a.archived_at IS NULL`];
    let having = [];
    let params = [];

    if (rteId) {
      where.push('a.rte_id = ?');
      params.push(parseInt(rteId));
    }

    if (search) {
      where.push('a.name LIKE ?');
      params.push(`%${search}%`);
    }

    if (stakeholdersOnly === '1') {
      where.push('a.is_stakeholder = 1');
    }

    // By default, hide actors with 0 document links (phantom entries from relationship extraction)
    // unless showAll=1 is passed or the user is filtering by stakeholders
    if (showAll !== '1' && stakeholdersOnly !== '1') {
      having.push('(document_count > 0 OR a.is_stakeholder = 1)');
    }

    const havingClause = having.length > 0 ? `HAVING ${having.join(' AND ')}` : '';

    const actors = db.prepare(`
      SELECT a.id, a.name, a.actor_type, a.role, a.team, a.organization,
             a.description, a.mention_count, a.is_stakeholder, a.notes,
             a.last_seen_at, a.rte_id,
             (SELECT COUNT(DISTINCT dt.document_id)
              FROM document_tags dt
              WHERE dt.tag_type = 'person' AND dt.tag_value = a.name) AS document_count
      FROM rte_actors a
      WHERE ${where.join(' AND ')}
      GROUP BY a.id
      ${havingClause}
      ORDER BY a.is_stakeholder DESC, document_count DESC, a.mention_count DESC, a.name ASC
    `).all(...params);

    // Count totals
    const totalPeople = db.prepare(`
      SELECT COUNT(*) AS count FROM rte_actors
      WHERE actor_type = 'person' AND archived_at IS NULL
    `).get();

    const totalStakeholders = db.prepare(`
      SELECT COUNT(*) AS count FROM rte_actors
      WHERE actor_type = 'person' AND archived_at IS NULL AND is_stakeholder = 1
    `).get();

    // Count people with at least 1 document link
    const withDocs = db.prepare(`
      SELECT COUNT(*) AS count FROM (
        SELECT a.id
        FROM rte_actors a
        WHERE a.actor_type = 'person' AND a.archived_at IS NULL
          AND (a.is_stakeholder = 1 OR EXISTS (
            SELECT 1 FROM document_tags dt
            WHERE dt.tag_type = 'person' AND dt.tag_value = a.name
          ))
      )
    `).get();

    res.json({
      actors,
      total: totalPeople?.count || 0,
      stakeholders: totalStakeholders?.count || 0,
      withDocs: withDocs?.count || 0
    });

  } catch (err) {
    console.error('[Stakeholder] List error:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/stakeholders/lookup/:name
 * Resolve a person name to an actor ID (for deep linking)
 */
router.get('/lookup/:name', (req, res) => {
  const db = getDb();
  if (!db) return res.status(500).json({ error: 'Database not ready' });

  const name = req.params.name;

  try {
    const actor = db.prepare(`
      SELECT id, name, actor_type, rte_id
      FROM rte_actors
      WHERE name = ? AND actor_type = 'person' AND archived_at IS NULL
      ORDER BY mention_count DESC
      LIMIT 1
    `).get(name);

    if (!actor) {
      return res.status(404).json({ error: 'Person not found' });
    }

    res.json(actor);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/stakeholders/:id
 * Full stakeholder profile — actor info, documents, relationships, markers
 */
router.get('/:id', (req, res) => {
  const db = getDb();
  if (!db) return res.status(500).json({ error: 'Database not ready' });

  const actorId = parseInt(req.params.id);

  try {
    // Get actor
    const actor = db.prepare(`
      SELECT id, name, actor_type, role, team, organization, description,
             mention_count, is_stakeholder, notes,
             last_seen_at, created_at, rte_id
      FROM rte_actors
      WHERE id = ?
    `).get(actorId);

    if (!actor) {
      return res.status(404).json({ error: 'Actor not found' });
    }

    // Documents mentioning this person
    const documents = db.prepare(`
      SELECT DISTINCT rd.id, rd.filename, rd.filepath, rd.document_date, rd.rte_id
      FROM document_tags dt
      JOIN rte_documents rd ON dt.document_id = rd.id
      WHERE dt.tag_type = 'person' AND dt.tag_value = ?
      ORDER BY rd.document_date DESC
      LIMIT 50
    `).all(actor.name);

    // Relationships (this actor → others and others → this actor)
    const relationships = db.prepare(`
      SELECT r.id, r.relationship_type, r.description AS rel_description,
             r.strength, r.llm_confidence,
             a1.id AS from_id, a1.name AS from_name, a1.actor_type AS from_type,
             a2.id AS to_id, a2.name AS to_name, a2.actor_type AS to_type
      FROM rte_relationships r
      JOIN rte_actors a1 ON r.source_actor_id = a1.id
      JOIN rte_actors a2 ON r.target_actor_id = a2.id
      WHERE r.source_actor_id = ? OR r.target_actor_id = ?
      ORDER BY r.strength DESC
    `).all(actorId, actorId);

    // Markers from documents that mention this person
    const markers = db.prepare(`
      SELECT sm.id, sm.marker_type, sm.marker_content, sm.is_resolved,
             sm.owner, sm.due_date, sm.severity,
             rd.filename AS source_filename, rd.filepath AS source_filepath, rd.id AS document_id
      FROM semantic_markers sm
      JOIN rte_documents rd ON sm.document_id = rd.id
      WHERE rd.id IN (
        SELECT DISTINCT dt.document_id
        FROM document_tags dt
        WHERE dt.tag_type = 'person' AND dt.tag_value = ?
      )
      ORDER BY sm.created_at DESC
      LIMIT 30
    `).all(actor.name);

    // Co-mentioned people (who appears in the same documents)
    const coMentioned = db.prepare(`
      SELECT dt2.tag_value AS name, COUNT(DISTINCT dt2.document_id) AS shared_docs,
             a.id AS actor_id, a.role, a.team
      FROM document_tags dt1
      JOIN document_tags dt2 ON dt1.document_id = dt2.document_id
        AND dt2.tag_type = 'person' AND dt2.tag_value != dt1.tag_value
      LEFT JOIN rte_actors a ON a.name = dt2.tag_value AND a.actor_type = 'person'
      WHERE dt1.tag_type = 'person' AND dt1.tag_value = ?
      GROUP BY dt2.tag_value
      ORDER BY shared_docs DESC
      LIMIT 15
    `).all(actor.name);

    // Topics (semantic tags from their documents)
    const topics = db.prepare(`
      SELECT dt2.tag_value AS topic, COUNT(DISTINCT dt2.document_id) AS count
      FROM document_tags dt1
      JOIN document_tags dt2 ON dt1.document_id = dt2.document_id
        AND dt2.tag_type = 'semantic'
      WHERE dt1.tag_type = 'person' AND dt1.tag_value = ?
      GROUP BY dt2.tag_value
      ORDER BY count DESC
      LIMIT 20
    `).all(actor.name);

    res.json({
      actor,
      documents,
      relationships,
      markers,
      coMentioned,
      topics,
      stats: {
        documentCount: documents.length,
        relationshipCount: relationships.length,
        markerCount: markers.length,
        openMarkers: markers.filter(m => !m.is_resolved).length
      }
    });

  } catch (err) {
    console.error('[Stakeholder] Profile error:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * PATCH /api/stakeholders/:id
 * Update stakeholder fields
 *
 * Body: { is_stakeholder, notes, role, team, organization, description }
 */
router.patch('/:id', (req, res) => {
  const db = getDb();
  if (!db) return res.status(500).json({ error: 'Database not ready' });

  const actorId = parseInt(req.params.id);
  const { is_stakeholder, notes, role, team, organization, description } = req.body;

  try {
    // Check actor exists
    const existing = db.prepare('SELECT id FROM rte_actors WHERE id = ?').get(actorId);
    if (!existing) {
      return res.status(404).json({ error: 'Actor not found' });
    }

    const updates = [];
    const params = [];

    if (is_stakeholder !== undefined) {
      updates.push('is_stakeholder = ?');
      params.push(is_stakeholder ? 1 : 0);
    }
    if (notes !== undefined) {
      updates.push('notes = ?');
      params.push(notes);
    }
    if (role !== undefined) {
      updates.push('role = ?');
      params.push(role);
    }
    if (team !== undefined) {
      updates.push('team = ?');
      params.push(team);
    }
    if (organization !== undefined) {
      updates.push('organization = ?');
      params.push(organization);
    }
    if (description !== undefined) {
      updates.push('description = ?');
      params.push(description);
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    updates.push('updated_at = datetime(\'now\')');
    params.push(actorId);

    db.prepare(`UPDATE rte_actors SET ${updates.join(', ')} WHERE id = ?`).run(...params);

    // Also sync to person_metadata if role/team/org changed
    if (role !== undefined || team !== undefined || organization !== undefined) {
      const actor = db.prepare('SELECT name FROM rte_actors WHERE id = ?').get(actorId);
      if (actor) {
        try {
          const existing = db.prepare('SELECT id FROM person_metadata WHERE name = ?').get(actor.name);
          if (existing) {
            const metaUpdates = [];
            const metaParams = [];
            if (role !== undefined) { metaUpdates.push('role = ?'); metaParams.push(role); }
            if (team !== undefined) { metaUpdates.push('team = ?'); metaParams.push(team); }
            if (organization !== undefined) { metaUpdates.push('organization = ?'); metaParams.push(organization); }
            if (metaUpdates.length > 0) {
              metaParams.push(actor.name);
              db.prepare(`UPDATE person_metadata SET ${metaUpdates.join(', ')} WHERE name = ?`).run(...metaParams);
            }
          }
        } catch (e) {
          // person_metadata table may not exist — that's fine
        }
      }
    }

    // Return updated actor
    const updated = db.prepare(`
      SELECT id, name, actor_type, role, team, organization, description,
             is_stakeholder, notes, mention_count, last_seen_at
      FROM rte_actors WHERE id = ?
    `).get(actorId);

    res.json(updated);

  } catch (err) {
    console.error('[Stakeholder] Update error:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
