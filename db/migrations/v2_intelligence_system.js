/**
 * Migration: v2 Intelligence System
 * 
 * Creates all tables for PO AI Intelligence System v2.0:
 * - content_types (extensible document types)
 * - semantic_tags (extensible tag taxonomy)
 * - document_tags (many-to-many document-tag relationships)
 * - project_tags (autocomplete for projects)
 * - person_tags (autocomplete for people)
 * - llm_configs (model assignments per task)
 * - extraction_queue (background processing with retry/dead-letter)
 * 
 * Also adds columns to rte_documents for raw content storage.
 */

const path = require('path');

/**
 * Run the migration
 * @param {Database} db - better-sqlite3 database instance
 * @returns {object} Migration result
 */
function migrate(db) {
  const results = {
    tablesCreated: [],
    columnsAdded: [],
    seedsInserted: [],
    errors: []
  };

  console.log('[Migration] Starting v2 Intelligence System migration...');

  try {
    // =====================================================
    // CONTENT TYPES (extensible)
    // =====================================================
    db.exec(`
      CREATE TABLE IF NOT EXISTS content_types (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        description TEXT,
        icon TEXT,
        is_active INTEGER DEFAULT 1,
        sort_order INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);
    results.tablesCreated.push('content_types');

    // Seed default content types (only if empty)
    const contentTypeCount = db.prepare('SELECT COUNT(*) as count FROM content_types').get();
    if (contentTypeCount.count === 0) {
      const insertContentType = db.prepare(`
        INSERT INTO content_types (name, description, icon, sort_order) VALUES (?, ?, ?, ?)
      `);
      insertContentType.run('log', 'Daily log entry', '📝', 1);
      insertContentType.run('meeting', 'Meeting notes or summary', '🤝', 2);
      insertContentType.run('artifact', 'Document, diagram, specification', '📄', 3);
      insertContentType.run('idea', 'Thoughts, not yet actioned', '💡', 4);
      results.seedsInserted.push('content_types (4 defaults)');
    }

    // =====================================================
    // SEMANTIC TAGS (extensible)
    // =====================================================
    db.exec(`
      CREATE TABLE IF NOT EXISTS semantic_tags (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        description TEXT,
        color TEXT,
        is_active INTEGER DEFAULT 1,
        sort_order INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);
    results.tablesCreated.push('semantic_tags');

    // Seed default semantic tags (only if empty)
    const semanticTagCount = db.prepare('SELECT COUNT(*) as count FROM semantic_tags').get();
    if (semanticTagCount.count === 0) {
      const insertSemanticTag = db.prepare(`
        INSERT INTO semantic_tags (name, description, color, sort_order) VALUES (?, ?, ?, ?)
      `);
      insertSemanticTag.run('decision', 'Something was decided', '#4CAF50', 1);
      insertSemanticTag.run('action', 'Something to do', '#2196F3', 2);
      insertSemanticTag.run('promise', 'Someone committed to something', '#FF9800', 3);
      insertSemanticTag.run('requirement', 'Must-have feature or constraint', '#9C27B0', 4);
      insertSemanticTag.run('nfr', 'Non-functional requirement', '#673AB7', 5);
      insertSemanticTag.run('blocker', 'Something stopping progress', '#F44336', 6);
      insertSemanticTag.run('question', 'Open question needing answer', '#00BCD4', 7);
      insertSemanticTag.run('observation', 'Fact or insight, no action needed', '#607D8B', 8);
      results.seedsInserted.push('semantic_tags (8 defaults)');
    }

    // =====================================================
    // DOCUMENT TAGS (many-to-many)
    // =====================================================
    db.exec(`
      CREATE TABLE IF NOT EXISTS document_tags (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        document_id INTEGER NOT NULL,
        tag_type TEXT NOT NULL,
        tag_value TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (document_id) REFERENCES rte_documents(id) ON DELETE CASCADE,
        UNIQUE(document_id, tag_type, tag_value)
      )
    `);
    results.tablesCreated.push('document_tags');

    // Create indexes
    db.exec(`CREATE INDEX IF NOT EXISTS idx_document_tags_doc ON document_tags(document_id)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_document_tags_type ON document_tags(tag_type)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_document_tags_value ON document_tags(tag_value)`);

    // =====================================================
    // PROJECT TAGS (for autocomplete)
    // =====================================================
    db.exec(`
      CREATE TABLE IF NOT EXISTS project_tags (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        rte_id INTEGER NOT NULL,
        name TEXT NOT NULL,
        description TEXT,
        is_active INTEGER DEFAULT 1,
        usage_count INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (rte_id) REFERENCES rtes(id),
        UNIQUE(rte_id, name)
      )
    `);
    results.tablesCreated.push('project_tags');

    // =====================================================
    // PERSON TAGS (for autocomplete)
    // =====================================================
    db.exec(`
      CREATE TABLE IF NOT EXISTS person_tags (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        rte_id INTEGER NOT NULL,
        name TEXT NOT NULL,
        role TEXT,
        is_active INTEGER DEFAULT 1,
        usage_count INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (rte_id) REFERENCES rtes(id),
        UNIQUE(rte_id, name)
      )
    `);
    results.tablesCreated.push('person_tags');

    // =====================================================
    // LLM CONFIGURATIONS
    // =====================================================
    db.exec(`
      CREATE TABLE IF NOT EXISTS llm_configs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        task TEXT NOT NULL UNIQUE,
        model_name TEXT NOT NULL,
        endpoint TEXT DEFAULT 'http://localhost:11434',
        temperature REAL DEFAULT 0.1,
        max_tokens INTEGER DEFAULT 2000,
        fallback_models TEXT,
        is_active INTEGER DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);
    results.tablesCreated.push('llm_configs');

    // Seed default LLM configs (only if empty)
    const llmConfigCount = db.prepare('SELECT COUNT(*) as count FROM llm_configs').get();
    if (llmConfigCount.count === 0) {
      const insertLlmConfig = db.prepare(`
        INSERT INTO llm_configs (task, model_name, temperature, max_tokens, fallback_models) 
        VALUES (?, ?, ?, ?, ?)
      `);
      insertLlmConfig.run('extraction', 'gemma2:2b', 0.1, 1000, '["phi3:mini", "qwen2:1.5b", "mistral:7b"]');
      insertLlmConfig.run('query', 'mistral:7b', 0.3, 2000, '["llama3.1:8b", "gemma2:9b"]');
      insertLlmConfig.run('trend', 'deepseek-r1:7b', 0.3, 4000, '["mistral:7b", "llama3.1:8b"]');
      results.seedsInserted.push('llm_configs (3 defaults)');
    }

    // =====================================================
    // EXTRACTION QUEUE (background processing)
    // =====================================================
    db.exec(`
      CREATE TABLE IF NOT EXISTS extraction_queue (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        document_id INTEGER NOT NULL,
        status TEXT DEFAULT 'pending',
        attempts INTEGER DEFAULT 0,
        max_attempts INTEGER DEFAULT 3,
        error_message TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        started_at DATETIME,
        completed_at DATETIME,
        FOREIGN KEY (document_id) REFERENCES rte_documents(id) ON DELETE CASCADE
      )
    `);
    results.tablesCreated.push('extraction_queue');

    db.exec(`CREATE INDEX IF NOT EXISTS idx_extraction_queue_status ON extraction_queue(status)`);

    // =====================================================
    // ADD COLUMNS TO rte_documents (if not exist)
    // =====================================================
    const columns = [
      { name: 'content_type_id', sql: 'ALTER TABLE rte_documents ADD COLUMN content_type_id INTEGER REFERENCES content_types(id)' },
      { name: 'raw_content', sql: 'ALTER TABLE rte_documents ADD COLUMN raw_content TEXT' },
      { name: 'word_count', sql: 'ALTER TABLE rte_documents ADD COLUMN word_count INTEGER' },
      { name: 'extraction_status', sql: "ALTER TABLE rte_documents ADD COLUMN extraction_status TEXT DEFAULT 'pending'" },
      { name: 'extraction_error', sql: 'ALTER TABLE rte_documents ADD COLUMN extraction_error TEXT' },
      { name: 'document_date', sql: 'ALTER TABLE rte_documents ADD COLUMN document_date DATE' }
    ];

    for (const col of columns) {
      try {
        db.exec(col.sql);
        results.columnsAdded.push(`rte_documents.${col.name}`);
      } catch (e) {
        // Column already exists - that's fine
        if (!e.message.includes('duplicate column')) {
          results.errors.push(`Column ${col.name}: ${e.message}`);
        }
      }
    }

    // =====================================================
    // MIGRATION VERSION TRACKING
    // =====================================================
    db.exec(`
      CREATE TABLE IF NOT EXISTS migrations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Record this migration
    try {
      db.prepare('INSERT INTO migrations (name) VALUES (?)').run('v2_intelligence_system');
    } catch (e) {
      // Already applied
    }

    console.log('[Migration] v2 Intelligence System migration complete!');
    console.log('[Migration] Tables created:', results.tablesCreated.join(', '));
    console.log('[Migration] Columns added:', results.columnsAdded.join(', '));
    console.log('[Migration] Seeds inserted:', results.seedsInserted.join(', '));

    if (results.errors.length > 0) {
      console.log('[Migration] Errors:', results.errors.join(', '));
    }

    return results;

  } catch (error) {
    console.error('[Migration] Failed:', error.message);
    results.errors.push(error.message);
    throw error;
  }
}

/**
 * Check if migration has already been applied
 * @param {Database} db - better-sqlite3 database instance
 * @returns {boolean}
 */
function isApplied(db) {
  try {
    const row = db.prepare("SELECT name FROM migrations WHERE name = 'v2_intelligence_system'").get();
    return !!row;
  } catch (e) {
    return false;
  }
}

/**
 * Rollback the migration (for development/testing)
 * @param {Database} db - better-sqlite3 database instance
 */
function rollback(db) {
  console.log('[Migration] Rolling back v2 Intelligence System...');
  
  const tables = [
    'extraction_queue',
    'llm_configs', 
    'person_tags',
    'project_tags',
    'document_tags',
    'semantic_tags',
    'content_types'
  ];

  for (const table of tables) {
    try {
      db.exec(`DROP TABLE IF EXISTS ${table}`);
      console.log(`[Migration] Dropped table: ${table}`);
    } catch (e) {
      console.error(`[Migration] Failed to drop ${table}:`, e.message);
    }
  }

  // Remove migration record
  try {
    db.prepare("DELETE FROM migrations WHERE name = 'v2_intelligence_system'").run();
  } catch (e) {
    // Table might not exist
  }

  console.log('[Migration] Rollback complete');
}

module.exports = { migrate, isApplied, rollback };

// Allow running directly: node db/migrations/v2_intelligence_system.js
if (require.main === module) {
  const Database = require('better-sqlite3');
  const dbPath = path.join(__dirname, '..', '..', 'database.db');
  
  console.log('[Migration] Running standalone migration...');
  console.log('[Migration] Database path:', dbPath);
  
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  
  if (isApplied(db)) {
    console.log('[Migration] Already applied. Use --force to re-run or --rollback to undo.');
    
    if (process.argv.includes('--rollback')) {
      rollback(db);
    } else if (process.argv.includes('--force')) {
      rollback(db);
      migrate(db);
    }
  } else {
    migrate(db);
  }
  
  db.close();
}
