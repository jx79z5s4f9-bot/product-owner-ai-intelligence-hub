/**
 * Migration: v6_semantic_markers
 * Creates semantic_markers table for proper marker storage
 */

/**
 * Run the migration
 * @param {Database} db - better-sqlite3 database instance
 */
function migrate(db) {
  console.log('[Migration v6] Creating semantic_markers table...');

  db.exec(`
    CREATE TABLE IF NOT EXISTS semantic_markers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      document_id INTEGER NOT NULL,
      rte_id INTEGER,
      marker_type TEXT NOT NULL,
      marker_content TEXT,
      is_resolved INTEGER DEFAULT 0,
      resolved_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (document_id) REFERENCES rte_documents(id) ON DELETE CASCADE,
      FOREIGN KEY (rte_id) REFERENCES rtes(id)
    );
    
    CREATE INDEX IF NOT EXISTS idx_markers_type ON semantic_markers(marker_type);
    CREATE INDEX IF NOT EXISTS idx_markers_rte ON semantic_markers(rte_id);
    CREATE INDEX IF NOT EXISTS idx_markers_document ON semantic_markers(document_id);
    CREATE INDEX IF NOT EXISTS idx_markers_resolved ON semantic_markers(is_resolved);
  `);

  // Mark migration as complete
  db.prepare(`
    INSERT OR REPLACE INTO migrations (name, applied_at) VALUES ('v6_semantic_markers', datetime('now'))
  `).run();

  console.log('[Migration v6] semantic_markers table created');
}

/**
 * Check if migration has been applied
 * @param {Database} db - better-sqlite3 database instance
 * @returns {boolean}
 */
function isApplied(db) {
  try {
    const result = db.prepare(`
      SELECT 1 FROM migrations WHERE name = 'v6_semantic_markers'
    `).get();
    return !!result;
  } catch (e) {
    return false;
  }
}

module.exports = { migrate, isApplied };
