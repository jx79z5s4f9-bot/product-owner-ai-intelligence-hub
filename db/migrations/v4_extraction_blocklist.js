/**
 * Migration: v4 Extraction Blocklist
 * 
 * Adds table for preventing re-extraction of misclassified entities.
 * When a user moves a tag from one type to another (e.g., person → organization),
 * the blocklist prevents future extractions from classifying it as the original type.
 * 
 * Use case: Team names like "Yin", "Yang" are initially classified as people
 * but should be organizations. After moving them, we don't want future
 * extractions to recreate them as people.
 */

/**
 * Run the migration
 * @param {Database} db - better-sqlite3 database instance
 * @returns {object} Migration result
 */
function migrate(db) {
  const results = {
    tablesCreated: [],
    errors: []
  };

  console.log('[Migration] Starting v4 Extraction Blocklist migration...');

  try {
    // =====================================================
    // EXTRACTION BLOCKLIST
    // =====================================================
    // Stores tag values that should NOT be extracted as a specific type
    db.exec(`
      CREATE TABLE IF NOT EXISTS extraction_blocklist (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        tag_value TEXT NOT NULL,
        blocked_type TEXT NOT NULL CHECK(blocked_type IN ('person', 'project', 'system', 'organization')),
        correct_type TEXT CHECK(correct_type IN ('person', 'project', 'system', 'organization')),
        reason TEXT DEFAULT 'reclassified',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(tag_value, blocked_type)
      )
    `);
    results.tablesCreated.push('extraction_blocklist');

    // Create indexes for efficient lookup during extraction
    db.exec(`CREATE INDEX IF NOT EXISTS idx_blocklist_value ON extraction_blocklist(tag_value)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_blocklist_type ON extraction_blocklist(blocked_type)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_blocklist_value_type ON extraction_blocklist(tag_value, blocked_type)`);

    console.log('[Migration] v4 Extraction Blocklist migration complete');
    console.log(`[Migration] Created tables: ${results.tablesCreated.join(', ')}`);

  } catch (error) {
    console.error('[Migration] v4 error:', error.message);
    results.errors.push(error.message);
  }

  return results;
}

/**
 * Check if migration has already been applied
 * @param {Database} db - better-sqlite3 database instance
 * @returns {boolean}
 */
function isApplied(db) {
  try {
    const table = db.prepare(`
      SELECT name FROM sqlite_master 
      WHERE type='table' AND name='extraction_blocklist'
    `).get();
    
    return !!table;
  } catch (e) {
    return false;
  }
}

module.exports = { migrate, isApplied };
