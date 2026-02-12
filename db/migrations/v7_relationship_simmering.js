/**
 * Migration: v7_relationship_simmering
 * Enhances relationship suggestions for the "simmer" pattern:
 * - Track evidence count (how many documents suggest this)
 * - Track source documents
 * - Track dismissed state (never suggest again)
 * - Auto-increase confidence as evidence accumulates
 */

/**
 * Run the migration
 * @param {Database} db - better-sqlite3 database instance
 */
function migrate(db) {
  console.log('[Migration v7] Enhancing relationship suggestions for simmering...');

  // Add new columns to rte_relationship_suggestions
  // SQLite doesn't support IF NOT EXISTS for columns, so we check first
  const columns = db.prepare(`PRAGMA table_info(rte_relationship_suggestions)`).all();
  const columnNames = columns.map(c => c.name);

  if (!columnNames.includes('evidence_count')) {
    db.exec(`ALTER TABLE rte_relationship_suggestions ADD COLUMN evidence_count INTEGER DEFAULT 1`);
    console.log('  Added evidence_count column');
  }

  if (!columnNames.includes('source_documents')) {
    db.exec(`ALTER TABLE rte_relationship_suggestions ADD COLUMN source_documents TEXT`); // JSON array of doc IDs
    console.log('  Added source_documents column');
  }

  if (!columnNames.includes('is_dismissed')) {
    db.exec(`ALTER TABLE rte_relationship_suggestions ADD COLUMN is_dismissed INTEGER DEFAULT 0`);
    console.log('  Added is_dismissed column');
  }

  if (!columnNames.includes('last_seen_at')) {
    db.exec(`ALTER TABLE rte_relationship_suggestions ADD COLUMN last_seen_at DATETIME`);
    console.log('  Added last_seen_at column');
  }

  if (!columnNames.includes('context_samples')) {
    db.exec(`ALTER TABLE rte_relationship_suggestions ADD COLUMN context_samples TEXT`); // JSON array of context snippets
    console.log('  Added context_samples column');
  }

  // Create index for quick lookup of existing suggestions
  db.exec(`CREATE INDEX IF NOT EXISTS idx_suggestions_actors ON rte_relationship_suggestions(rte_id, source_actor_id, target_actor_id, relationship_type)`);
  console.log('  Created lookup index');

  // Create index for dismissed suggestions
  db.exec(`CREATE INDEX IF NOT EXISTS idx_suggestions_dismissed ON rte_relationship_suggestions(is_dismissed)`);
  console.log('  Created dismissed index');

  // Mark migration as complete
  db.prepare(`
    INSERT OR REPLACE INTO migrations (name, applied_at) VALUES ('v7_relationship_simmering', datetime('now'))
  `).run();

  console.log('[Migration v7] Relationship simmering schema ready');
}

/**
 * Check if migration has been applied
 * @param {Database} db - better-sqlite3 database instance
 * @returns {boolean}
 */
function isApplied(db) {
  try {
    const result = db.prepare(`
      SELECT 1 FROM migrations WHERE name = 'v7_relationship_simmering'
    `).get();
    return !!result;
  } catch (e) {
    return false;
  }
}

module.exports = { migrate, isApplied };
