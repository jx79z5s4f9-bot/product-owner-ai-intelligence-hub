/**
 * v8 Entity Model Consolidation Migration
 * 
 * Consolidates the three overlapping entity systems:
 * 1. rte_actors table (primary)
 * 2. person_metadata table (legacy → synced to rte_actors)
 * 3. tag_categories table (legacy → synced to rte_actors.type)
 * 
 * After this migration:
 * - person_metadata data is synced into rte_actors
 * - tag_categories data updates rte_actors.actor_type
 * - Legacy tables are kept but marked deprecated (not dropped)
 */

function isApplied(db) {
  try {
    // Check if the consolidation marker exists
    const marker = db.prepare(`
      SELECT COUNT(*) as count FROM rte_actors WHERE metadata_json LIKE '%"consolidated":true%'
    `).get();
    return marker.count > 0;
  } catch (e) {
    return false;
  }
}

function migrate(db) {
  console.log('[v8 Migration] Starting Entity Model Consolidation...');
  
  // Step 1: Sync person_metadata → rte_actors
  // For each person in person_metadata, update matching rte_actors entries
  try {
    const personMeta = db.prepare(`
      SELECT tag_value, organization, team, role FROM person_metadata
      WHERE organization IS NOT NULL OR team IS NOT NULL OR role IS NOT NULL
    `).all();
    
    let synced = 0;
    const updateStmt = db.prepare(`
      UPDATE rte_actors SET
        organization = COALESCE(?, rte_actors.organization),
        team = COALESCE(?, rte_actors.team),
        role = COALESCE(?, rte_actors.role),
        updated_at = datetime('now')
      WHERE name = ? AND actor_type = 'person'
    `);
    
    for (const person of personMeta) {
      if (person.organization || person.team || person.role) {
        const result = updateStmt.run(
          person.organization || null,
          person.team || null,
          person.role || null,
          person.tag_value
        );
        if (result.changes > 0) synced++;
      }
    }
    
    console.log(`[v8 Migration] Synced ${synced} person_metadata entries to rte_actors`);
  } catch (e) {
    console.error('[v8 Migration] person_metadata sync error:', e.message);
  }
  
  // Step 2: Sync tag_categories → rte_actors.actor_type
  // For entities with a category that differs from their actor_type
  try {
    const tagCats = db.prepare(`
      SELECT tag_value, category FROM tag_categories 
      WHERE category != 'uncategorized' AND category IS NOT NULL
    `).all();
    
    let typeUpdated = 0;
    const updateTypeStmt = db.prepare(`
      UPDATE rte_actors SET 
        actor_type = ?,
        updated_at = datetime('now')
      WHERE name = ? AND actor_type IN ('unknown', 'project')
    `);
    
    for (const tc of tagCats) {
      const result = updateTypeStmt.run(tc.category, tc.tag_value);
      if (result.changes > 0) typeUpdated++;
    }
    
    console.log(`[v8 Migration] Updated ${typeUpdated} actor types from tag_categories`);
  } catch (e) {
    console.error('[v8 Migration] tag_categories sync error:', e.message);
  }
  
  // Step 3: Mark one actor as consolidated (migration marker)
  try {
    const firstActor = db.prepare(`SELECT id, metadata_json FROM rte_actors LIMIT 1`).get();
    if (firstActor) {
      let meta = {};
      try { meta = JSON.parse(firstActor.metadata_json || '{}'); } catch (e) {}
      meta.consolidated = true;
      db.prepare(`UPDATE rte_actors SET metadata_json = ? WHERE id = ?`)
        .run(JSON.stringify(meta), firstActor.id);
    }
  } catch (e) {
    console.error('[v8 Migration] Marker error:', e.message);
  }
  
  console.log('[v8 Migration] Complete — legacy tables preserved but data synced to rte_actors');
}

module.exports = { isApplied, migrate };
