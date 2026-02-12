/**
 * Migration: v5_question_history
 * Adds question_history table to store Ask Q&A pairs
 */

/**
 * Run the migration
 * @param {Database} db - better-sqlite3 database instance
 */
function migrate(db) {
  console.log('[Migration v5] Creating question_history table...');
  
  // Create question_history table
  db.exec(`
    CREATE TABLE IF NOT EXISTS question_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      question TEXT NOT NULL,
      answer TEXT NOT NULL,
      evidence_json TEXT,
      model TEXT,
      confidence REAL,
      rte_id INTEGER,
      rte_name TEXT,
      filters_json TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (rte_id) REFERENCES rtes(id)
    );
    
    CREATE INDEX IF NOT EXISTS idx_question_history_created 
      ON question_history(created_at DESC);
    
    CREATE INDEX IF NOT EXISTS idx_question_history_rte 
      ON question_history(rte_id);
  `);
  
  // Mark migration as complete
  db.prepare(`
    INSERT OR REPLACE INTO migrations (name, applied_at) VALUES ('v5_question_history', datetime('now'))
  `).run();
  
  console.log('[Migration v5] question_history table created');
}

/**
 * Check if migration has been applied
 * @param {Database} db - better-sqlite3 database instance
 * @returns {boolean}
 */
function isApplied(db) {
  try {
    const result = db.prepare(`
      SELECT 1 FROM migrations WHERE name = 'v5_question_history'
    `).get();
    return !!result;
  } catch (e) {
    return false;
  }
}

module.exports = { migrate, isApplied };
