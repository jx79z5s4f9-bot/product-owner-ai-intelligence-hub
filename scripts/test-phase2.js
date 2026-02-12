/**
 * Test Phase 2: Verify database entries
 */

const Database = require('better-sqlite3');
const path = require('path');

const db = new Database(path.join(__dirname, '..', 'database.db'), { readonly: true });

console.log('=== Phase 2 Verification ===');
console.log('');

console.log('rte_documents (recent):');
const docs = db.prepare('SELECT id, filename, word_count, extraction_status, document_date FROM rte_documents ORDER BY id DESC LIMIT 3').all();
docs.forEach(d => console.log('  [' + d.id + ']', d.filename, '- ' + d.word_count + ' words,', d.extraction_status));

console.log('');
console.log('document_tags (recent):');
const tags = db.prepare('SELECT * FROM document_tags ORDER BY id DESC LIMIT 10').all();
tags.forEach(t => console.log('  doc:' + t.document_id, t.tag_type + ':' + t.tag_value));

console.log('');
console.log('project_tags:');
const ptags = db.prepare('SELECT * FROM project_tags').all();
ptags.forEach(t => console.log('  [' + t.rte_id + ']', t.name, '(' + t.usage_count + ' uses)'));

console.log('');
console.log('person_tags:');
const pertags = db.prepare('SELECT * FROM person_tags').all();
pertags.forEach(t => console.log('  [' + t.rte_id + ']', t.name, '(' + t.usage_count + ' uses)'));

console.log('');
console.log('extraction_queue:');
const queue = db.prepare('SELECT * FROM extraction_queue').all();
queue.forEach(q => console.log('  doc:' + q.document_id, q.status, '- attempts:' + q.attempts));

db.close();
console.log('');
console.log('=== Phase 2 Complete ✓ ===');
