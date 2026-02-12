#!/usr/bin/env node
/**
 * Reindex all documents in vector search
 */

const { SQLiteVectorSearch } = require('../services/sqlite-vector-search');
const Database = require('better-sqlite3');

const db = new Database('./database.db');

// Get all documents
const docs = db.prepare('SELECT id, rte_id, filepath, raw_content, filename FROM rte_documents').all();
console.log('Total documents:', docs.length);

// Create and init vector search
const instance = new SQLiteVectorSearch();
instance.init();

if (!instance.isReady) {
  console.log('Vector search not ready');
  process.exit(1);
}

let indexed = 0;
for (const doc of docs) {
  try {
    instance.indexDocument({
      filepath: doc.filepath,
      content: doc.raw_content,
      rteId: doc.rte_id
    });
    indexed++;
    console.log(`[${indexed}/${docs.length}] ${doc.filename}`);
  } catch (e) {
    console.log('Failed:', doc.filename, e.message);
  }
}

console.log('\nDone! Indexed', indexed, 'documents');
