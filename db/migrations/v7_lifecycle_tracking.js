/**
 * v7 Lifecycle Tracking Migration
 * Adds lifecycle columns to rte_actors for archival system
 * 
 * New columns:
 * - last_seen_at: Updated when entity is mentioned in new document
 * - mention_count: Number of times entity appears across documents
 * - archived_at: NULL for active entities, timestamp when archived
 */

function isApplied(db) {
  try {
    const stmt = db.prepare(`SELECT last_seen_at FROM rte_actors LIMIT 1`);
    stmt.get();
    return true;
  } catch (e) {
    return false;
  }
}

function migrate(db) {
  console.log('[v7 Migration] Adding lifecycle tracking columns to rte_actors...');
  
  // Add last_seen_at column (no default, backfill after)
  try {
    db.exec(`ALTER TABLE rte_actors ADD COLUMN last_seen_at DATETIME`);
    console.log('[v7 Migration] Added last_seen_at column');
  } catch (e) {
    if (!e.message.includes('duplicate column')) {
      console.error('[v7 Migration] last_seen_at error:', e.message);
    }
  }
  
  // Add mention_count column (no default, backfill after)
  try {
    db.exec(`ALTER TABLE rte_actors ADD COLUMN mention_count INTEGER`);
    console.log('[v7 Migration] Added mention_count column');
  } catch (e) {
    if (!e.message.includes('duplicate column')) {
      console.error('[v7 Migration] mention_count error:', e.message);
    }
  }
  
  // Add archived_at column
  try {
    db.exec(`ALTER TABLE rte_actors ADD COLUMN archived_at DATETIME`);
    console.log('[v7 Migration] Added archived_at column');
  } catch (e) {
    if (!e.message.includes('duplicate column')) {
      console.error('[v7 Migration] archived_at error:', e.message);
    }
  }
  
  // Backfill: Set last_seen_at = updated_at and mention_count = 1 for existing actors
  try {
    db.exec(`UPDATE rte_actors SET last_seen_at = updated_at WHERE last_seen_at IS NULL`);
    db.exec(`UPDATE rte_actors SET mention_count = 1 WHERE mention_count IS NULL`);
    console.log('[v7 Migration] Backfilled last_seen_at and mention_count');
  } catch (e) {
    console.error('[v7 Migration] Backfill error:', e.message);
  }
  
  // Create index for efficient staleness queries
  try {
    db.exec(`CREATE INDEX IF NOT EXISTS idx_rte_actors_last_seen ON rte_actors(rte_id, last_seen_at)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_rte_actors_archived ON rte_actors(rte_id, archived_at)`);
    console.log('[v7 Migration] Created indexes for lifecycle queries');
  } catch (e) {
    console.error('[v7 Migration] Index creation error:', e.message);
  }
  
  console.log('[v7 Migration] Complete');
}

module.exports = { isApplied, migrate };
