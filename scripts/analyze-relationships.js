/**
 * Analyze relationships to understand what created them
 */
const Database = require('better-sqlite3');
const path = require('path');

const dbPath = path.join(__dirname, '..', 'database.db');
const db = new Database(dbPath);

// Check relationship types
console.log('\n=== Relationship Types ===');
const types = db.prepare(`
  SELECT relationship_type, COUNT(*) as cnt 
  FROM rte_relationships WHERE rte_id=1 
  GROUP BY relationship_type ORDER BY cnt DESC
`).all();
types.forEach(t => console.log(`  ${t.relationship_type}: ${t.cnt}`));

// Check Politie connections
console.log('\n=== Politie Connections (sample) ===');
const politieRels = db.prepare(`
  SELECT r.relationship_type, r.context,
         s.name as source, t.name as target
  FROM rte_relationships r
  JOIN rte_actors s ON r.source_actor_id = s.id
  JOIN rte_actors t ON r.target_actor_id = t.id
  WHERE r.rte_id = 1 
    AND (s.name = 'Politie' OR t.name = 'Politie')
  LIMIT 10
`).all();
politieRels.forEach(r => console.log(`  ${r.source} -> ${r.target} (${r.relationship_type}): ${r.context || 'no context'}`));

// Check how many unique actors Politie is connected to
console.log('\n=== Politie Connection Stats ===');
const politieStats = db.prepare(`
  SELECT COUNT(DISTINCT CASE WHEN s.name = 'Politie' THEN t.id ELSE s.id END) as connections
  FROM rte_relationships r
  JOIN rte_actors s ON r.source_actor_id = s.id
  JOIN rte_actors t ON r.target_actor_id = t.id
  WHERE r.rte_id = 1 
    AND (s.name = 'Politie' OR t.name = 'Politie')
`).get();
console.log(`  Politie is connected to ${politieStats.connections} unique actors`);

// Check test documents in markers
console.log('\n=== Test Documents in Markers ===');
const testMarkers = db.prepare(`
  SELECT d.filename, m.marker_type, m.marker_content
  FROM semantic_markers m
  JOIN rte_documents d ON m.document_id = d.id
  WHERE d.filename LIKE '%test%'
  LIMIT 10
`).all();
testMarkers.forEach(m => console.log(`  ${m.filename}: ${m.marker_type}`));

console.log('\n=== Documents by RTE ===');
const docsByRte = db.prepare(`
  SELECT r.name as rte_name, COUNT(d.id) as doc_count
  FROM rte_documents d
  JOIN rtes r ON d.rte_id = r.id
  GROUP BY d.rte_id
`).all();
docsByRte.forEach(d => console.log(`  ${d.rte_name}: ${d.doc_count} documents`));

db.close();
