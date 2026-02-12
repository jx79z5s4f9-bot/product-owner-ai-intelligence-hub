/**
 * Migration: v9_register_system
 * Adds owner, due_date, severity columns to semantic_markers
 * Creates marker_responses table for tracking how items were addressed
 * Adds is_stakeholder, notes columns to rte_actors
 */

/**
 * Run the migration
 * @param {Database} db - better-sqlite3 database instance
 */
function migrate(db) {
  console.log('[Migration v9] Setting up register system + stakeholder fields...');

  // --- Add columns to semantic_markers ---
  const markerCols = db.prepare(`PRAGMA table_info(semantic_markers)`).all().map(c => c.name);
  
  if (!markerCols.includes('owner')) {
    db.exec(`ALTER TABLE semantic_markers ADD COLUMN owner TEXT`);
    console.log('[Migration v9] Added owner to semantic_markers');
  }
  
  if (!markerCols.includes('due_date')) {
    db.exec(`ALTER TABLE semantic_markers ADD COLUMN due_date DATE`);
    console.log('[Migration v9] Added due_date to semantic_markers');
  }
  
  if (!markerCols.includes('severity')) {
    db.exec(`ALTER TABLE semantic_markers ADD COLUMN severity TEXT`);
    console.log('[Migration v9] Added severity to semantic_markers');
  }

  // --- Create marker_responses table ---
  db.exec(`
    CREATE TABLE IF NOT EXISTS marker_responses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      marker_id INTEGER NOT NULL,
      response_text TEXT NOT NULL,
      response_type TEXT DEFAULT 'update',
      author TEXT,
      source_document_id INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (marker_id) REFERENCES semantic_markers(id) ON DELETE CASCADE,
      FOREIGN KEY (source_document_id) REFERENCES rte_documents(id) ON DELETE SET NULL
    );
    
    CREATE INDEX IF NOT EXISTS idx_responses_marker ON marker_responses(marker_id);
    CREATE INDEX IF NOT EXISTS idx_responses_created ON marker_responses(created_at);
  `);
  console.log('[Migration v9] Created marker_responses table');

  // --- Add columns to rte_actors ---
  const actorCols = db.prepare(`PRAGMA table_info(rte_actors)`).all().map(c => c.name);
  
  if (!actorCols.includes('is_stakeholder')) {
    db.exec(`ALTER TABLE rte_actors ADD COLUMN is_stakeholder INTEGER DEFAULT 0`);
    console.log('[Migration v9] Added is_stakeholder to rte_actors');
  }
  
  if (!actorCols.includes('notes')) {
    db.exec(`ALTER TABLE rte_actors ADD COLUMN notes TEXT`);
    console.log('[Migration v9] Added notes to rte_actors');
  }

  // --- Add indexes for register queries ---
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_markers_owner ON semantic_markers(owner);
    CREATE INDEX IF NOT EXISTS idx_markers_due_date ON semantic_markers(due_date);
    CREATE INDEX IF NOT EXISTS idx_markers_severity ON semantic_markers(severity);
    CREATE INDEX IF NOT EXISTS idx_actors_stakeholder ON rte_actors(is_stakeholder);
  `);

  // Mark migration as complete
  db.prepare(`
    INSERT OR REPLACE INTO migrations (name, applied_at) VALUES ('v9_register_system', datetime('now'))
  `).run();

  console.log('[Migration v9] Register system + stakeholder fields complete');
}

/**
 * Check if migration has been applied
 * @param {Database} db - better-sqlite3 database instance
 * @returns {boolean}
 */
function isApplied(db) {
  try {
    const result = db.prepare(`
      SELECT 1 FROM migrations WHERE name = 'v9_register_system'
    `).get();
    return !!result;
  } catch (e) {
    return false;
  }
}

module.exports = { migrate, isApplied };
