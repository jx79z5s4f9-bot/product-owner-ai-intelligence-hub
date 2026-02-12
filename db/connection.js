/**
 * SQLite Database Connection using better-sqlite3
 * Synchronous API for simpler code
 *
 * Database location: ~/ProductOwnerAI/database.db
 * Auto-migrates from old location (project root) if found
 */

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const os = require('os');

// Import migrations
const v2Migration = require('./migrations/v2_intelligence_system');
const v3Migration = require('./migrations/v3_tag_manager');
const v4Migration = require('./migrations/v4_extraction_blocklist');
const v5Migration = require('./migrations/v5_question_history');
const v6Migration = require('./migrations/v6_semantic_markers');
const v7Migration = require('./migrations/v7_lifecycle_tracking');
const v8Migration = require('./migrations/v8_entity_consolidation');
const v9Migration = require('./migrations/v9_register_system');
const v10Migration = require('./migrations/v10_configurable_content_types');
const v11Migration = require('./migrations/v11_document_templates');

// New database location in user's home directory
const WORKSPACE_ROOT = path.join(os.homedir(), 'ProductOwnerAI');
const DB_PATH = path.join(WORKSPACE_ROOT, 'database.db');

// Old location for migration
const OLD_DB_PATH = path.join(__dirname, '..', 'database.db');

let db = null;

/**
 * Migrate database from old location (project root) to new location (~/ProductOwnerAI/)
 */
function migrateDatabase() {
  // Ensure workspace directory exists
  if (!fs.existsSync(WORKSPACE_ROOT)) {
    fs.mkdirSync(WORKSPACE_ROOT, { recursive: true });
    console.log(`[DB] Created workspace directory: ${WORKSPACE_ROOT}`);
  }

  // Check if old database exists and new one doesn't
  if (fs.existsSync(OLD_DB_PATH) && !fs.existsSync(DB_PATH)) {
    console.log('[DB] Migrating database to new location...');

    try {
      // Copy main database file
      fs.copyFileSync(OLD_DB_PATH, DB_PATH);
      console.log(`[DB] Copied database to ${DB_PATH}`);

      // Copy WAL file if exists
      const oldWalPath = OLD_DB_PATH + '-wal';
      const newWalPath = DB_PATH + '-wal';
      if (fs.existsSync(oldWalPath)) {
        fs.copyFileSync(oldWalPath, newWalPath);
        console.log('[DB] Copied WAL file');
      }

      // Copy SHM file if exists
      const oldShmPath = OLD_DB_PATH + '-shm';
      const newShmPath = DB_PATH + '-shm';
      if (fs.existsSync(oldShmPath)) {
        fs.copyFileSync(oldShmPath, newShmPath);
        console.log('[DB] Copied SHM file');
      }

      // Rename old files to .migrated to prevent re-migration
      fs.renameSync(OLD_DB_PATH, OLD_DB_PATH + '.migrated');
      if (fs.existsSync(oldWalPath)) fs.unlinkSync(oldWalPath);
      if (fs.existsSync(oldShmPath)) fs.unlinkSync(oldShmPath);

      console.log('[DB] Migration complete! Old database renamed to database.db.migrated');
    } catch (err) {
      console.error('[DB] Migration failed:', err.message);
      console.log('[DB] Falling back to creating new database');
    }
  }
}

function initDb() {
  try {
    // Auto-migrate from old location if needed
    migrateDatabase();

    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    console.log(`Connected to SQLite database at ${DB_PATH}`);
    createTables();
    seedRtes();
    runMigrations();
  } catch (err) {
    console.error('Database connection error:', err.message);
  }
}

/**
 * Run pending migrations
 */
function runMigrations() {
  // v2 Intelligence System migration
  if (!v2Migration.isApplied(db)) {
    console.log('[DB] Running v2 Intelligence System migration...');
    v2Migration.migrate(db);
  } else {
    console.log('[DB] v2 migration already applied');
  }

  // v3 Tag Manager migration
  if (!v3Migration.isApplied(db)) {
    console.log('[DB] Running v3 Tag Manager migration...');
    v3Migration.migrate(db);
  } else {
    console.log('[DB] v3 migration already applied');
  }

  // v4 Extraction Blocklist migration
  if (!v4Migration.isApplied(db)) {
    console.log('[DB] Running v4 Extraction Blocklist migration...');
    v4Migration.migrate(db);
  } else {
    console.log('[DB] v4 migration already applied');
  }

  // v5 Question History migration
  if (!v5Migration.isApplied(db)) {
    console.log('[DB] Running v5 Question History migration...');
    v5Migration.migrate(db);
  } else {
    console.log('[DB] v5 migration already applied');
  }

  // v6 Semantic Markers migration
  if (!v6Migration.isApplied(db)) {
    console.log('[DB] Running v6 Semantic Markers migration...');
    v6Migration.migrate(db);
  } else {
    console.log('[DB] v6 migration already applied');
  }

  // v7 Lifecycle Tracking migration
  if (!v7Migration.isApplied(db)) {
    console.log('[DB] Running v7 Lifecycle Tracking migration...');
    v7Migration.migrate(db);
  } else {
    console.log('[DB] v7 migration already applied');
  }

  // v8 Entity Model Consolidation migration
  if (!v8Migration.isApplied(db)) {
    console.log('[DB] Running v8 Entity Model Consolidation migration...');
    v8Migration.migrate(db);
  } else {
    console.log('[DB] v8 migration already applied');
  }

  // v9 Register System + Stakeholder Fields migration
  if (!v9Migration.isApplied(db)) {
    console.log('[DB] Running v9 Register System migration...');
    v9Migration.migrate(db);
  } else {
    console.log('[DB] v9 migration already applied');
  }

  // v10 Configurable Content Types + Settings
  if (!v10Migration.isApplied(db)) {
    console.log('[DB] Running v10 Configurable Content Types migration...');
    v10Migration.migrate(db);
  } else {
    console.log('[DB] v10 migration already applied');
  }

  // v11 Document Templates
  if (!v11Migration.isApplied(db)) {
    console.log('[DB] Running v11 Document Templates migration...');
    v11Migration.migrate(db);
  } else {
    console.log('[DB] v11 migration already applied');
  }
}

function createTables() {
  // RTEs (Release Train Engineers / Project Instances)
  db.exec(`
    CREATE TABLE IF NOT EXISTS rtes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      status TEXT DEFAULT 'active',
      metadata_json TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Actors (people, teams, systems, etc.)
  db.exec(`
    CREATE TABLE IF NOT EXISTS actors (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      rte_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      role TEXT,
      team TEXT,
      description TEXT,
      metadata_json TEXT,
      source_file TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (rte_id) REFERENCES rtes(id),
      UNIQUE(rte_id, name, type)
    )
  `);

  // Relationships between actors
  db.exec(`
    CREATE TABLE IF NOT EXISTS relationships (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      rte_id INTEGER NOT NULL,
      source_actor_id INTEGER NOT NULL,
      target_actor_id INTEGER NOT NULL,
      type TEXT NOT NULL,
      strength REAL DEFAULT 1.0,
      context TEXT,
      source_file TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (rte_id) REFERENCES rtes(id),
      FOREIGN KEY (source_actor_id) REFERENCES actors(id),
      FOREIGN KEY (target_actor_id) REFERENCES actors(id),
      UNIQUE(rte_id, source_actor_id, target_actor_id, type)
    )
  `);

  // Debriefs (session summaries)
  db.exec(`
    CREATE TABLE IF NOT EXISTS debriefs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      rte_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (rte_id) REFERENCES rtes(id)
    )
  `);

  // Debrief-Entity links
  db.exec(`
    CREATE TABLE IF NOT EXISTS debrief_entities (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      debrief_id INTEGER NOT NULL,
      actor_id INTEGER NOT NULL,
      FOREIGN KEY (debrief_id) REFERENCES debriefs(id),
      FOREIGN KEY (actor_id) REFERENCES actors(id)
    )
  `);

  // Legacy entities table (for backward compatibility)
  db.exec(`
    CREATE TABLE IF NOT EXISTS entities (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      role TEXT,
      team TEXT,
      organization TEXT,
      description TEXT,
      source_file TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(name, type)
    )
  `);

  // Files index
  db.exec(`
    CREATE TABLE IF NOT EXISTS files (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      rte_id INTEGER,
      filename TEXT NOT NULL,
      filepath TEXT NOT NULL,
      type TEXT,
      date TEXT,
      entities_json TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (rte_id) REFERENCES rtes(id)
    )
  `);

  // Glossary terms
  db.exec(`
    CREATE TABLE IF NOT EXISTS glossary (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      dutch TEXT NOT NULL,
      english TEXT NOT NULL,
      context TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(dutch, english)
    )
  `);

  // Suggestions (AI-generated) - legacy table
  db.exec(`
    CREATE TABLE IF NOT EXISTS suggestions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      rte_id INTEGER NOT NULL,
      type TEXT NOT NULL,
      content TEXT NOT NULL,
      status TEXT DEFAULT 'pending',
      source_file TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (rte_id) REFERENCES rtes(id)
    )
  `);

  // ===========================================
  // RTE-SCOPED INTELLIGENCE TABLES
  // Used by intelligence-persistence.js and rte.js routes
  // ===========================================

  // RTE Actors - entities with rte scope and richer metadata
  db.exec(`
    CREATE TABLE IF NOT EXISTS rte_actors (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      rte_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      actor_type TEXT NOT NULL DEFAULT 'person',
      description TEXT,
      role TEXT,
      team TEXT,
      organization TEXT,
      metadata_json TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (rte_id) REFERENCES rtes(id),
      UNIQUE(rte_id, actor_type, name)
    )
  `);

  // RTE Relationships - connections between actors
  db.exec(`
    CREATE TABLE IF NOT EXISTS rte_relationships (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      rte_id INTEGER NOT NULL,
      source_actor_id INTEGER NOT NULL,
      target_actor_id INTEGER NOT NULL,
      relationship_type TEXT NOT NULL DEFAULT 'related_to',
      description TEXT,
      context TEXT,
      strength REAL DEFAULT 1.0,
      llm_confidence REAL DEFAULT 0.7,
      source_document_id INTEGER,
      is_approved INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (rte_id) REFERENCES rtes(id),
      FOREIGN KEY (source_actor_id) REFERENCES rte_actors(id),
      FOREIGN KEY (target_actor_id) REFERENCES rte_actors(id),
      UNIQUE(rte_id, source_actor_id, relationship_type, target_actor_id)
    )
  `);

  // RTE Relationship Suggestions - low-confidence relationships for review
  db.exec(`
    CREATE TABLE IF NOT EXISTS rte_relationship_suggestions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      rte_id INTEGER NOT NULL,
      source_actor_id INTEGER NOT NULL,
      target_actor_id INTEGER NOT NULL,
      relationship_type TEXT NOT NULL DEFAULT 'related_to',
      source_text TEXT,
      llm_confidence REAL DEFAULT 0.3,
      is_approved INTEGER DEFAULT 0,
      reviewed_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (rte_id) REFERENCES rtes(id),
      FOREIGN KEY (source_actor_id) REFERENCES rte_actors(id),
      FOREIGN KEY (target_actor_id) REFERENCES rte_actors(id)
    )
  `);

  // RTE Documents - stored/indexed documents per RTE
  db.exec(`
    CREATE TABLE IF NOT EXISTS rte_documents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      rte_id INTEGER NOT NULL,
      filename TEXT NOT NULL,
      filepath TEXT NOT NULL,
      file_type TEXT,
      category TEXT,
      title TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (rte_id) REFERENCES rtes(id)
    )
  `);

  // Saved searches for Phase 3
  db.exec(`
    CREATE TABLE IF NOT EXISTS saved_searches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      rte_id INTEGER,
      name TEXT NOT NULL,
      query TEXT NOT NULL,
      filters TEXT,
      search_type TEXT DEFAULT 'fts',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (rte_id) REFERENCES rtes(id)
    )
  `);

  // Settings table for app-wide configuration
  db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Add filters column if it doesn't exist (migration for existing DBs)
  try {
    db.exec(`ALTER TABLE saved_searches ADD COLUMN filters TEXT`);
  } catch (e) {
    // Column already exists, ignore
  }

  console.log('Database tables ready');
}

function seedRtes() {
  // Check if RTEs already exist
  const count = db.prepare('SELECT COUNT(*) as count FROM rtes').get();
  if (count.count > 0) return;

  // Seed default RTEs
  const insert = db.prepare(`
    INSERT INTO rtes (name, status, metadata_json)
    VALUES (?, ?, ?)
  `);

  insert.run('My Product', 'active', JSON.stringify({
    base_path: '~/ProductOwnerAI/rte/my-product',
    description: 'Example product — rename to your actual product'
  }));

  insert.run('My Portfolio', 'active', JSON.stringify({
    base_path: '~/ProductOwnerAI/rte/my-portfolio',
    description: 'Portfolio-level oversight — rename as needed'
  }));

  insert.run('Orchestrator', 'system', JSON.stringify({
    base_path: '~/ProductOwnerAI',
    description: 'System-wide orchestration files',
    read_only: true
  }));

  console.log('Seeded default RTEs');
}

function getDb() {
  return db;
}

module.exports = { initDb, getDb };
