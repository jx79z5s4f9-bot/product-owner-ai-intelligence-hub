/**
 * Phase 1 Verification Script
 */

const Database = require('better-sqlite3');
const path = require('path');

const db = new Database(path.join(__dirname, '..', 'database.db'), { readonly: true });

console.log('===== PHASE 1 VERIFICATION =====');
console.log('');

// Check migrations
const migration = db.prepare("SELECT * FROM migrations WHERE name = 'v2_intelligence_system'").get();
console.log('✓ Migration applied:', migration.applied_at);

// Check new tables
const tables = ['content_types', 'semantic_tags', 'document_tags', 'project_tags', 'person_tags', 'llm_configs', 'extraction_queue'];
console.log('');
console.log('New tables:');
for (const t of tables) {
  const count = db.prepare('SELECT COUNT(*) as c FROM ' + t).get();
  console.log('  ✓', t + ':', count.c, 'rows');
}

// Check rte_documents columns
console.log('');
console.log('rte_documents v2 columns:');
const cols = db.prepare('PRAGMA table_info(rte_documents)').all();
const v2Cols = ['content_type_id', 'raw_content', 'word_count', 'extraction_status', 'extraction_error', 'document_date'];
for (const colName of v2Cols) {
  const exists = cols.some(c => c.name === colName);
  console.log('  ' + (exists ? '✓' : '✗'), colName);
}

console.log('');
console.log('===== PHASE 1 COMPLETE ✓ =====');
db.close();
