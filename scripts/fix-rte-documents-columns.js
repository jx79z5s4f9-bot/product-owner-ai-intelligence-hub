/**
 * Fix missing columns on rte_documents table
 * The v2 migration ran before the table was created, so columns need to be added manually
 */

const Database = require('better-sqlite3');
const path = require('path');

const db = new Database(path.join(__dirname, '..', 'database.db'));

console.log('Adding missing columns to rte_documents...');

const columns = [
  { name: 'content_type_id', sql: 'ALTER TABLE rte_documents ADD COLUMN content_type_id INTEGER' },
  { name: 'raw_content', sql: 'ALTER TABLE rte_documents ADD COLUMN raw_content TEXT' },
  { name: 'word_count', sql: 'ALTER TABLE rte_documents ADD COLUMN word_count INTEGER' },
  { name: 'extraction_status', sql: "ALTER TABLE rte_documents ADD COLUMN extraction_status TEXT DEFAULT 'pending'" },
  { name: 'extraction_error', sql: 'ALTER TABLE rte_documents ADD COLUMN extraction_error TEXT' },
  { name: 'document_date', sql: 'ALTER TABLE rte_documents ADD COLUMN document_date DATE' }
];

for (const col of columns) {
  try {
    db.exec(col.sql);
    console.log('  ✓ Added:', col.name);
  } catch (e) {
    if (e.message.includes('duplicate column')) {
      console.log('  - Already exists:', col.name);
    } else {
      console.log('  ✗ Error on', col.name + ':', e.message);
    }
  }
}

console.log('\nVerifying columns...');
const cols = db.prepare('PRAGMA table_info(rte_documents)').all();
console.log('Total columns:', cols.length);
cols.forEach(c => console.log('  ' + c.name + ' (' + c.type + ')'));

db.close();
console.log('\nDone!');
