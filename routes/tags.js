/**
 * Tag Manager API Routes
 * 
 * Provides CRUD operations for tag management:
 * - List all tags grouped by type
 * - Rename tags
 * - Delete tags
 * - Merge duplicate tags
 * - Categorize entity tags (project/system/org)
 * - Manage person metadata (org/team/role)
 */

const express = require('express');
const router = express.Router();
const { getDb } = require('../db/connection');

/**
 * GET /api/tags
 * List all tags grouped by type with usage counts
 */
router.get('/', (req, res) => {
  const db = getDb();
  if (!db) {
    return res.status(500).json({ error: 'Database not available' });
  }

  try {
    // Get all tags with document counts
    const tags = db.prepare(`
      SELECT 
        tag_type,
        tag_value,
        COUNT(*) as doc_count,
        MAX(created_at) as last_used
      FROM document_tags
      GROUP BY tag_type, tag_value
      ORDER BY tag_type, doc_count DESC, tag_value
    `).all();

    // Get person metadata
    const personMeta = db.prepare(`
      SELECT tag_value, organization, team, role FROM person_metadata
    `).all();
    const personMetaMap = {};
    personMeta.forEach(p => {
      personMetaMap[p.tag_value] = {
        organization: p.organization,
        team: p.team,
        role: p.role
      };
    });

    // Get tag categories
    const tagCats = db.prepare(`
      SELECT tag_value, category FROM tag_categories
    `).all();
    const tagCatMap = {};
    tagCats.forEach(t => {
      tagCatMap[t.tag_value] = t.category;
    });

    // Organize by type
    const result = {
      people: [],
      projects: [],
      systems: [],
      organizations: [],
      locations: [],
      technologies: [],
      uncategorized: [],
      semantic: []
    };

    for (const tag of tags) {
      const item = {
        value: tag.tag_value,
        docCount: tag.doc_count,
        lastUsed: tag.last_used
      };

      if (tag.tag_type === 'person') {
        const meta = personMetaMap[tag.tag_value] || {};
        result.people.push({
          ...item,
          organization: meta.organization || null,
          team: meta.team || null,
          role: meta.role || null
        });
      } else if (tag.tag_type === 'semantic') {
        result.semantic.push(item);
      } else if (tag.tag_type === 'project') {
        // Check if categorized
        const cat = tagCatMap[tag.tag_value];
        if (cat === 'system') {
          result.systems.push(item);
        } else if (cat === 'organization') {
          result.organizations.push(item);
        } else if (cat === 'location') {
          result.locations.push(item);
        } else if (cat === 'technology') {
          result.technologies.push(item);
        } else if (cat === 'project' || !cat) {
          // Default extracted projects stay as projects
          result.projects.push(item);
        }
      } else if (tag.tag_type === 'system') {
        result.systems.push(item);
      } else if (tag.tag_type === 'organization') {
        result.organizations.push(item);
      } else if (tag.tag_type === 'location') {
        result.locations.push(item);
      } else if (tag.tag_type === 'technology') {
        result.technologies.push(item);
      } else {
        // Uncategorized (shouldn't happen but handle gracefully)
        result.uncategorized.push({ ...item, originalType: tag.tag_type });
      }
    }

    // Also include tags from tag_categories that might be uncategorized
    const uncategorizedTags = db.prepare(`
      SELECT tag_value, category FROM tag_categories WHERE category = 'uncategorized'
    `).all();
    for (const ut of uncategorizedTags) {
      if (!result.uncategorized.find(u => u.value === ut.tag_value)) {
        result.uncategorized.push({
          value: ut.tag_value,
          docCount: 0,
          lastUsed: null
        });
      }
    }

    res.json(result);
  } catch (error) {
    console.error('[Tags] Error listing tags:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/tags/recent/:type
 * Get recent tags of a specific type for autocomplete
 */
router.get('/recent/:type', (req, res) => {
  const db = getDb();
  if (!db) {
    return res.status(500).json({ error: 'Database not available' });
  }

  const { type } = req.params;
  const limit = parseInt(req.query.limit) || 10;

  try {
    let tags;
    if (type === 'person') {
      tags = db.prepare(`
        SELECT tag_value as value, MAX(created_at) as last_used, COUNT(*) as doc_count
        FROM document_tags
        WHERE tag_type = 'person'
        GROUP BY tag_value
        ORDER BY MAX(created_at) DESC
        LIMIT ?
      `).all(limit);
    } else if (type === 'project') {
      // Include projects, systems, orgs - all entity tags
      tags = db.prepare(`
        SELECT tag_value as value, MAX(created_at) as last_used, COUNT(*) as doc_count
        FROM document_tags
        WHERE tag_type IN ('project', 'system', 'organization')
        GROUP BY tag_value
        ORDER BY MAX(created_at) DESC
        LIMIT ?
      `).all(limit);
    } else {
      tags = db.prepare(`
        SELECT tag_value as value, MAX(created_at) as last_used, COUNT(*) as doc_count
        FROM document_tags
        WHERE tag_type = ?
        GROUP BY tag_value
        ORDER BY MAX(created_at) DESC
        LIMIT ?
      `).all(type, limit);
    }

    res.json({ tags });
  } catch (error) {
    console.error('[Tags] Error getting recent tags:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * PUT /api/tags/rename
 * Rename a tag across all documents
 */
router.put('/rename', (req, res) => {
  const db = getDb();
  if (!db) {
    return res.status(500).json({ error: 'Database not available' });
  }

  const { type, oldValue, newValue } = req.body;

  if (!type || !oldValue || !newValue) {
    return res.status(400).json({ error: 'Missing type, oldValue, or newValue' });
  }

  try {
    // Check if new value already exists (would create duplicate)
    const existing = db.prepare(`
      SELECT COUNT(*) as count FROM document_tags 
      WHERE tag_type = ? AND tag_value = ?
    `).get(type, newValue);

    if (existing.count > 0) {
      return res.status(400).json({ 
        error: 'Tag already exists. Use merge instead.',
        suggestMerge: true
      });
    }

    // Rename in document_tags
    const result = db.prepare(`
      UPDATE document_tags SET tag_value = ? WHERE tag_type = ? AND tag_value = ?
    `).run(newValue, type, oldValue);

    // Update person_metadata if person
    if (type === 'person') {
      db.prepare(`
        UPDATE person_metadata SET tag_value = ?, updated_at = datetime('now') 
        WHERE tag_value = ?
      `).run(newValue, oldValue);
    }

    // Update tag_categories if applicable
    db.prepare(`
      UPDATE tag_categories SET tag_value = ?, updated_at = datetime('now') 
      WHERE tag_value = ?
    `).run(newValue, oldValue);

    res.json({ 
      success: true, 
      renamed: result.changes,
      message: `Renamed "${oldValue}" to "${newValue}" in ${result.changes} documents`
    });
  } catch (error) {
    console.error('[Tags] Error renaming tag:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * DELETE /api/tags
 * Delete a tag from all documents
 */
router.delete('/', (req, res) => {
  const db = getDb();
  if (!db) {
    return res.status(500).json({ error: 'Database not available' });
  }

  const { type, value } = req.body;

  if (!type || !value) {
    return res.status(400).json({ error: 'Missing type or value' });
  }

  try {
    // Delete from document_tags
    const result = db.prepare(`
      DELETE FROM document_tags WHERE tag_type = ? AND tag_value = ?
    `).run(type, value);

    // Delete from person_metadata if person
    if (type === 'person') {
      db.prepare(`DELETE FROM person_metadata WHERE tag_value = ?`).run(value);
    }

    // Delete from tag_categories
    db.prepare(`DELETE FROM tag_categories WHERE tag_value = ?`).run(value);

    res.json({ 
      success: true, 
      deleted: result.changes,
      message: `Deleted "${value}" from ${result.changes} documents`
    });
  } catch (error) {
    console.error('[Tags] Error deleting tag:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * PUT /api/tags/change-type
 * Change tag type (e.g., move person to organization for team names)
 * Also adds to blocklist to prevent future re-extraction as original type
 */
router.put('/change-type', (req, res) => {
  const db = getDb();
  if (!db) {
    return res.status(500).json({ error: 'Database not available' });
  }

  const { values, fromType, toType } = req.body;

  if (!values || !Array.isArray(values) || values.length < 1) {
    return res.status(400).json({ error: 'Missing values array' });
  }

  if (!fromType || !toType) {
    return res.status(400).json({ error: 'Missing fromType or toType' });
  }

  try {
    let changed = 0;
    let blocklisted = 0;

    for (const value of values) {
      // Update tag type in document_tags
      const result = db.prepare(`
        UPDATE document_tags SET tag_type = ? 
        WHERE tag_type = ? AND tag_value = ?
      `).run(toType, fromType, value);
      
      changed += result.changes;

      // If moving from person, remove from person_metadata
      if (fromType === 'person') {
        db.prepare(`DELETE FROM person_metadata WHERE tag_value = ?`).run(value);
      }

      // Update tag_categories for non-person types
      if (toType !== 'person') {
        db.prepare(`
          INSERT OR REPLACE INTO tag_categories (tag_value, category, updated_at)
          VALUES (?, ?, datetime('now'))
        `).run(value, toType);
      } else {
        // If moving TO person, remove from tag_categories
        db.prepare(`DELETE FROM tag_categories WHERE tag_value = ?`).run(value);
      }

      // Add to blocklist to prevent future re-extraction as original type
      try {
        db.prepare(`
          INSERT OR IGNORE INTO extraction_blocklist (tag_value, blocked_type, correct_type, reason)
          VALUES (?, ?, ?, 'reclassified')
        `).run(value, fromType, toType);
        blocklisted++;
      } catch (e) {
        // Blocklist table might not exist yet
        console.log('[Tags] Could not add to blocklist:', e.message);
      }
    }

    res.json({ 
      success: true, 
      changed,
      blocklisted,
      message: `Moved ${values.length} tags from ${fromType} to ${toType}, added ${blocklisted} to extraction blocklist`
    });
  } catch (error) {
    console.error('[Tags] Error changing tag type:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/tags/merge
 * Merge multiple tags into one (supports cross-type merging)
 */
router.post('/merge', (req, res) => {
  const db = getDb();
  if (!db) {
    return res.status(500).json({ error: 'Database not available' });
  }

  const { type, sourceValues, targetValue, targetType } = req.body;
  const finalTargetType = targetType || type; // Default to source type if not specified

  if (!type || !sourceValues || !Array.isArray(sourceValues) || sourceValues.length < 1 || !targetValue) {
    return res.status(400).json({ error: 'Missing type, sourceValues array, or targetValue' });
  }

  try {
    let totalMerged = 0;

    for (const sourceValue of sourceValues) {
      // Skip if same value and same type
      if (sourceValue === targetValue && type === finalTargetType) continue;

      // Get documents with source tag
      const docs = db.prepare(`
        SELECT document_id FROM document_tags 
        WHERE tag_type = ? AND tag_value = ?
      `).all(type, sourceValue);

      for (const doc of docs) {
        // Insert target tag with the target type (will be ignored if exists)
        db.prepare(`
          INSERT OR IGNORE INTO document_tags (document_id, tag_type, tag_value)
          VALUES (?, ?, ?)
        `).run(doc.document_id, finalTargetType, targetValue);
      }

      // Delete source tag
      const result = db.prepare(`
        DELETE FROM document_tags WHERE tag_type = ? AND tag_value = ?
      `).run(type, sourceValue);
      totalMerged += result.changes;

      // Clean up person_metadata
      if (type === 'person') {
        db.prepare(`DELETE FROM person_metadata WHERE tag_value = ?`).run(sourceValue);
      }

      // Clean up tag_categories
      db.prepare(`DELETE FROM tag_categories WHERE tag_value = ?`).run(sourceValue);
      
      // Add to blocklist if changing types
      if (type !== finalTargetType) {
        try {
          db.prepare(`
            INSERT OR IGNORE INTO extraction_blocklist (tag_value, blocked_type, correct_type, reason)
            VALUES (?, ?, ?, 'merged')
          `).run(sourceValue, type, finalTargetType);
        } catch (e) {
          // Blocklist table might not exist
        }
      }
    }

    // Ensure target exists in metadata tables
    if (finalTargetType === 'person') {
      db.prepare(`INSERT OR IGNORE INTO person_metadata (tag_value) VALUES (?)`).run(targetValue);
    } else {
      // Ensure target is in tag_categories with correct category
      db.prepare(`
        INSERT OR REPLACE INTO tag_categories (tag_value, category, updated_at)
        VALUES (?, ?, datetime('now'))
      `).run(targetValue, finalTargetType);
    }

    res.json({ 
      success: true, 
      merged: totalMerged,
      message: `Merged ${sourceValues.length} tags into "${targetValue}" (${finalTargetType})`
    });
  } catch (error) {
    console.error('[Tags] Error merging tags:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * PUT /api/tags/categorize
 * Move tags between categories (project/system/organization)
 */
router.put('/categorize', (req, res) => {
  const db = getDb();
  if (!db) {
    return res.status(500).json({ error: 'Database not available' });
  }

  const { values, category } = req.body;

  if (!values || !Array.isArray(values) || values.length < 1) {
    return res.status(400).json({ error: 'Missing values array' });
  }

  const validCategories = ['project', 'system', 'organization', 'uncategorized'];
  if (!validCategories.includes(category)) {
    return res.status(400).json({ error: 'Invalid category. Must be: ' + validCategories.join(', ') });
  }

  try {
    let updated = 0;

    for (const value of values) {
      // Update or insert in tag_categories
      const result = db.prepare(`
        INSERT INTO tag_categories (tag_value, category, updated_at)
        VALUES (?, ?, datetime('now'))
        ON CONFLICT(tag_value) DO UPDATE SET category = ?, updated_at = datetime('now')
      `).run(value, category, category);
      updated += result.changes;

      // Also update the tag_type in document_tags to match
      // This ensures consistency
      db.prepare(`
        UPDATE document_tags 
        SET tag_type = ?
        WHERE tag_value = ? AND tag_type IN ('project', 'system', 'organization')
      `).run(category, value);
    }

    res.json({ 
      success: true, 
      updated,
      message: `Categorized ${values.length} tags as "${category}"`
    });
  } catch (error) {
    console.error('[Tags] Error categorizing tags:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * PUT /api/tags/person/bulk
 * Update multiple people at once (for bulk assign org/team/role)
 * NOTE: This route MUST come before /person/:name to avoid "bulk" being matched as a name
 */
router.put('/person/bulk', (req, res) => {
  const db = getDb();
  if (!db) {
    return res.status(500).json({ error: 'Database not available' });
  }

  const { names, organization, team, role } = req.body;

  if (!names || !Array.isArray(names) || names.length < 1) {
    return res.status(400).json({ error: 'Missing names array' });
  }

  try {
    let updated = 0;

    for (const name of names) {
      const result = db.prepare(`
        INSERT INTO person_metadata (tag_value, organization, team, role, updated_at)
        VALUES (?, ?, ?, ?, datetime('now'))
        ON CONFLICT(tag_value) DO UPDATE SET 
          organization = COALESCE(?, organization),
          team = COALESCE(?, team),
          role = COALESCE(?, role),
          updated_at = datetime('now')
      `).run(name, organization, team, role, organization, team, role);
      updated += result.changes;
      
      // Also sync to rte_actors (D.1 entity consolidation)
      try {
        db.prepare(`
          UPDATE rte_actors SET
            organization = COALESCE(?, rte_actors.organization),
            team = COALESCE(?, rte_actors.team),
            role = COALESCE(?, rte_actors.role),
            updated_at = datetime('now')
          WHERE name = ? AND actor_type = 'person'
        `).run(organization || null, team || null, role || null, name);
      } catch (e) { /* ignore */ }
    }

    res.json({ 
      success: true,
      updated,
      message: `Updated ${names.length} people`
    });
  } catch (error) {
    console.error('[Tags] Error bulk updating people:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/tags/person/:name
 * Get person metadata
 */
router.get('/person/:name', (req, res) => {
  const db = getDb();
  if (!db) {
    return res.status(500).json({ error: 'Database not available' });
  }

  const { name } = req.params;

  try {
    const person = db.prepare(`
      SELECT tag_value as name, organization, team, role, created_at, updated_at
      FROM person_metadata WHERE tag_value = ?
    `).get(name);

    if (!person) {
      return res.status(404).json({ error: 'Person not found' });
    }

    // Get document count
    const docCount = db.prepare(`
      SELECT COUNT(*) as count FROM document_tags 
      WHERE tag_type = 'person' AND tag_value = ?
    `).get(name);

    res.json({ 
      ...person, 
      docCount: docCount.count 
    });
  } catch (error) {
    console.error('[Tags] Error getting person:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * PUT /api/tags/person/:name
 * Update person metadata (org, team, role)
 */
router.put('/person/:name', (req, res) => {
  const db = getDb();
  if (!db) {
    return res.status(500).json({ error: 'Database not available' });
  }

  const { name } = req.params;
  const { organization, team, role } = req.body;

  try {
    // Upsert person_metadata (legacy)
    db.prepare(`
      INSERT INTO person_metadata (tag_value, organization, team, role, updated_at)
      VALUES (?, ?, ?, ?, datetime('now'))
      ON CONFLICT(tag_value) DO UPDATE SET 
        organization = COALESCE(?, organization),
        team = COALESCE(?, team),
        role = COALESCE(?, role),
        updated_at = datetime('now')
    `).run(name, organization, team, role, organization, team, role);

    // Also sync to rte_actors (D.1 entity consolidation)
    try {
      db.prepare(`
        UPDATE rte_actors SET
          organization = COALESCE(?, rte_actors.organization),
          team = COALESCE(?, rte_actors.team),
          role = COALESCE(?, rte_actors.role),
          updated_at = datetime('now')
        WHERE name = ? AND actor_type = 'person'
      `).run(organization || null, team || null, role || null, name);
    } catch (e) {
      console.log('[Tags] rte_actors sync skipped:', e.message);
    }

    res.json({ 
      success: true,
      message: `Updated metadata for "${name}"`
    });
  } catch (error) {
    console.error('[Tags] Error updating person:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/tags/stats
 * Get tag statistics
 */
router.get('/stats', (req, res) => {
  const db = getDb();
  if (!db) {
    return res.status(500).json({ error: 'Database not available' });
  }

  try {
    const stats = {
      people: db.prepare(`
        SELECT COUNT(DISTINCT tag_value) as count FROM document_tags WHERE tag_type = 'person'
      `).get().count,
      projects: db.prepare(`
        SELECT COUNT(DISTINCT tag_value) as count FROM document_tags WHERE tag_type = 'project'
      `).get().count,
      systems: db.prepare(`
        SELECT COUNT(DISTINCT tag_value) as count FROM document_tags WHERE tag_type = 'system'
      `).get().count,
      organizations: db.prepare(`
        SELECT COUNT(DISTINCT tag_value) as count FROM document_tags WHERE tag_type = 'organization'
      `).get().count,
      semantic: db.prepare(`
        SELECT COUNT(DISTINCT tag_value) as count FROM document_tags WHERE tag_type = 'semantic'
      `).get().count,
      totalDocuments: db.prepare(`
        SELECT COUNT(DISTINCT document_id) as count FROM document_tags
      `).get().count
    };

    res.json(stats);
  } catch (error) {
    console.error('[Tags] Error getting stats:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/tags/organizations
 * Get unique organizations for dropdown
 */
router.get('/organizations', (req, res) => {
  const db = getDb();
  if (!db) {
    return res.status(500).json({ error: 'Database not available' });
  }

  try {
    const orgs = db.prepare(`
      SELECT DISTINCT organization FROM person_metadata 
      WHERE organization IS NOT NULL AND organization != ''
      ORDER BY organization
    `).all();

    res.json({ organizations: orgs.map(o => o.organization) });
  } catch (error) {
    console.error('[Tags] Error getting organizations:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/tags/teams
 * Get unique teams for dropdown
 */
router.get('/teams', (req, res) => {
  const db = getDb();
  if (!db) {
    return res.status(500).json({ error: 'Database not available' });
  }

  try {
    const teams = db.prepare(`
      SELECT DISTINCT team FROM person_metadata 
      WHERE team IS NOT NULL AND team != ''
      ORDER BY team
    `).all();

    res.json({ teams: teams.map(t => t.team) });
  } catch (error) {
    console.error('[Tags] Error getting teams:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/tags/roles
 * Get unique roles for dropdown
 */
router.get('/roles', (req, res) => {
  const db = getDb();
  if (!db) {
    return res.status(500).json({ error: 'Database not available' });
  }

  try {
    const roles = db.prepare(`
      SELECT DISTINCT role FROM person_metadata 
      WHERE role IS NOT NULL AND role != ''
      ORDER BY role
    `).all();

    res.json({ roles: roles.map(r => r.role) });
  } catch (error) {
    console.error('[Tags] Error getting roles:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============================================================
// Semantic Tags Management
// ============================================================

/**
 * GET /api/tags/semantic
 * Get all semantic tag definitions (from semantic_tags table)
 */
router.get('/semantic', (req, res) => {
  const db = getDb();
  if (!db) {
    return res.status(500).json({ error: 'Database not available' });
  }

  try {
    const tags = db.prepare(`
      SELECT st.*, 
        (SELECT COUNT(*) FROM document_tags dt WHERE dt.tag_type = 'semantic' AND dt.tag_value = st.name) as usage_count
      FROM semantic_tags st
      ORDER BY st.name
    `).all();

    res.json(tags);
  } catch (error) {
    console.error('[Tags] Error getting semantic tags:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/tags/semantic
 * Add a new semantic tag
 */
router.post('/semantic', (req, res) => {
  const { name, description } = req.body;

  if (!name) {
    return res.status(400).json({ error: 'Name is required' });
  }

  const db = getDb();
  if (!db) {
    return res.status(500).json({ error: 'Database not available' });
  }

  try {
    const result = db.prepare(`
      INSERT INTO semantic_tags (name, description) VALUES (?, ?)
    `).run(name.toLowerCase().trim(), description || '');

    res.json({ 
      success: true, 
      id: result.lastInsertRowid,
      message: `Tag "${name}" created` 
    });
  } catch (error) {
    if (error.message.includes('UNIQUE')) {
      return res.status(400).json({ error: 'Tag already exists' });
    }
    console.error('[Tags] Create semantic tag failed:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * DELETE /api/tags/semantic/:name
 * Delete a semantic tag definition
 * Query param: force=true to also remove from all documents
 */
router.delete('/semantic/:name', (req, res) => {
  const { name } = req.params;
  const { force } = req.query;

  const db = getDb();
  if (!db) {
    return res.status(500).json({ error: 'Database not available' });
  }

  try {
    // Check usage
    const usage = db.prepare(`
      SELECT COUNT(*) as count FROM document_tags
      WHERE tag_type = 'semantic' AND tag_value = ?
    `).get(name);

    // If used and not forcing, return error with usage count
    if (usage.count > 0 && force !== 'true') {
      return res.status(400).json({
        error: `Tag is used in ${usage.count} documents. Delete anyway?`,
        usage: usage.count,
        requiresForce: true
      });
    }

    // If forcing or no usage, proceed with deletion
    let removedFromDocs = 0;
    if (usage.count > 0) {
      // First remove from all documents
      const docResult = db.prepare(`
        DELETE FROM document_tags WHERE tag_type = 'semantic' AND tag_value = ?
      `).run(name);
      removedFromDocs = docResult.changes;
    }

    // Then delete the tag definition
    const result = db.prepare('DELETE FROM semantic_tags WHERE name = ?').run(name);

    if (result.changes === 0 && removedFromDocs === 0) {
      return res.status(404).json({ error: 'Tag not found' });
    }

    res.json({
      success: true,
      message: `Tag "${name}" deleted`,
      removedFromDocuments: removedFromDocs
    });
  } catch (error) {
    console.error('[Tags] Delete semantic tag failed:', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
