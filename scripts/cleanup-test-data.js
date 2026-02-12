/**
 * Clean up test documents and reset co-occurs relationships
 */
const Database = require('better-sqlite3');
const path = require('path');

const dbPath = path.join(__dirname, '..', 'database.db');
const db = new Database(dbPath);

console.log('\n=== Cleaning Test Documents ===');

// Find test documents
const testDocs = db.prepare(`
  SELECT id, filename, rte_id FROM rte_documents 
  WHERE filename LIKE '%test%' OR filename LIKE '%phase-2%'
`).all();

console.log(`Found ${testDocs.length} test documents`);

if (testDocs.length > 0) {
  // Delete markers for test documents
  const markerResult = db.prepare(`
    DELETE FROM semantic_markers 
    WHERE document_id IN (SELECT id FROM rte_documents WHERE filename LIKE '%test%' OR filename LIKE '%phase-2%')
  `).run();
  console.log(`Deleted ${markerResult.changes} markers from test documents`);
  
  // Delete tags for test documents
  const tagResult = db.prepare(`
    DELETE FROM document_tags 
    WHERE document_id IN (SELECT id FROM rte_documents WHERE filename LIKE '%test%' OR filename LIKE '%phase-2%')
  `).run();
  console.log(`Deleted ${tagResult.changes} tags from test documents`);
  
  // Delete the test documents themselves
  const docResult = db.prepare(`
    DELETE FROM rte_documents 
    WHERE filename LIKE '%test%' OR filename LIKE '%phase-2%'
  `).run();
  console.log(`Deleted ${docResult.changes} test documents`);
}

console.log('\n=== Analyzing Co-occurs Relationships ===');

// Count co-occurs relationships
const cooccursCount = db.prepare(`
  SELECT COUNT(*) as cnt FROM rte_relationships WHERE relationship_type = 'co-occurs'
`).get();
console.log(`Total co-occurs relationships: ${cooccursCount.cnt}`);

// These relationships are not meaningful - they just mean "appeared in same document"
// They don't tell us HOW entities are related

// For now, let's delete them and let the user manually create meaningful relationships
// or use LLM extraction with proper relationship types

console.log('\n=== Deleting Co-occurs Relationships ===');
const delResult = db.prepare(`
  DELETE FROM rte_relationships WHERE relationship_type = 'co-occurs'
`).run();
console.log(`Deleted ${delResult.changes} co-occurs relationships`);

// Check remaining relationships
const remaining = db.prepare(`
  SELECT relationship_type, COUNT(*) as cnt 
  FROM rte_relationships 
  GROUP BY relationship_type
`).all();

if (remaining.length > 0) {
  console.log('\nRemaining relationships by type:');
  remaining.forEach(r => console.log(`  ${r.relationship_type}: ${r.cnt}`));
} else {
  console.log('\nNo relationships remaining');
}

console.log('\n=== Final Stats ===');
const stats = {
  documents: db.prepare('SELECT COUNT(*) as cnt FROM rte_documents').get().cnt,
  markers: db.prepare('SELECT COUNT(*) as cnt FROM semantic_markers').get().cnt,
  relationships: db.prepare('SELECT COUNT(*) as cnt FROM rte_relationships').get().cnt,
  actors: db.prepare('SELECT COUNT(*) as cnt FROM rte_actors').get().cnt
};
console.log(`Documents: ${stats.documents}`);
console.log(`Markers: ${stats.markers}`);
console.log(`Relationships: ${stats.relationships}`);
console.log(`Actors: ${stats.actors}`);

db.close();
console.log('\n✅ Cleanup complete!');
