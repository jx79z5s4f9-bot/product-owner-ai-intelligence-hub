/**
 * Backfill Semantic Markers
 * Re-extracts markers from existing documents into the new semantic_markers table
 */

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const dbPath = path.join(__dirname, '..', 'database.db');
const db = new Database(dbPath);

// Get valid keywords from semantic_tags table
function getValidKeywords() {
  try {
    const tags = db.prepare('SELECT name FROM semantic_tags WHERE is_active = 1').all();
    return tags.map(t => t.name.toLowerCase());
  } catch (e) {
    return ['insight', 'action', 'question', 'decision', 'strategic', 'priority', 'risk', 'blocker', 'observation', 'promise', 'requirement', 'nfr', 'planning'];
  }
}

// Extract semantic markers from content
function extractSemanticMarkers(content) {
  const markers = [];
  const validKeywords = getValidKeywords();
  
  if (validKeywords.length === 0) return markers;
  
  const keywordPattern = validKeywords.join('|');
  
  // Multi-line blocks (keyword: ... //)
  // Allow optional list markers (-, *, •) and whitespace at the start
  const multiLineRegex = new RegExp(`^[-*•]?[ \\t]*(${keywordPattern}):[ \\t]*([\\s\\S]*?)^[-*•]?[ \\t]*//[ \\t]*$`, 'gim');
  
  let match;
  const processedRanges = [];
  
  while ((match = multiLineRegex.exec(content)) !== null) {
    markers.push({
      keyword: match[1].toLowerCase(),
      content: match[2].trim() || null
    });
    processedRanges.push({ start: match.index, end: match.index + match[0].length });
  }
  
  // Single-line markers (keyword: content // OR keyword: content$)
  // Allow optional list markers (-, *, •) and whitespace at the start
  const singleLineRegex = new RegExp(`^[-*•]?[ \\t]*(${keywordPattern}):[ \\t]*(.+?)(?:[ \\t]*//|$)`, 'gim');
  
  while ((match = singleLineRegex.exec(content)) !== null) {
    const isInsideMultiLine = processedRanges.some(
      range => match.index >= range.start && match.index < range.end
    );
    
    if (!isInsideMultiLine) {
      markers.push({
        keyword: match[1].toLowerCase(),
        content: match[2].trim() || null
      });
    }
  }
  
  return markers;
}

// Main backfill function
function backfillMarkers() {
  console.log('[Backfill] Starting semantic markers backfill...\n');
  
  // Ensure table exists
  db.exec(`
    CREATE TABLE IF NOT EXISTS semantic_markers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      document_id INTEGER NOT NULL,
      rte_id INTEGER,
      marker_type TEXT NOT NULL,
      marker_content TEXT,
      is_resolved INTEGER DEFAULT 0,
      resolved_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (document_id) REFERENCES rte_documents(id) ON DELETE CASCADE,
      FOREIGN KEY (rte_id) REFERENCES rtes(id)
    );
  `);
  
  // Clear existing markers
  const clearResult = db.prepare('DELETE FROM semantic_markers').run();
  console.log(`[Backfill] Cleared ${clearResult.changes} existing markers\n`);
  
  // Get all documents with their content
  const documents = db.prepare(`
    SELECT d.id, d.rte_id, d.filepath, d.filename, d.raw_content as content
    FROM rte_documents d
    WHERE d.raw_content IS NOT NULL AND d.raw_content != ''
  `).all();
  
  console.log(`[Backfill] Processing ${documents.length} documents...\n`);
  
  const insertMarker = db.prepare(`
    INSERT INTO semantic_markers (document_id, rte_id, marker_type, marker_content)
    VALUES (?, ?, ?, ?)
  `);
  
  let totalMarkers = 0;
  const markerCounts = {};
  
  for (const doc of documents) {
    const markers = extractSemanticMarkers(doc.content);
    
    if (markers.length > 0) {
      for (const marker of markers) {
        try {
          insertMarker.run(doc.id, doc.rte_id, marker.keyword, marker.content);
          totalMarkers++;
          markerCounts[marker.keyword] = (markerCounts[marker.keyword] || 0) + 1;
        } catch (e) {
          console.error(`  Error inserting marker: ${e.message}`);
        }
      }
      console.log(`  📄 ${doc.filename}: ${markers.length} markers`);
    }
  }
  
  console.log('\n[Backfill] Summary:');
  console.log(`  Total markers: ${totalMarkers}`);
  console.log('  By type:');
  Object.entries(markerCounts)
    .sort((a, b) => b[1] - a[1])
    .forEach(([type, count]) => {
      console.log(`    ${type}: ${count}`);
    });
  
  console.log('\n[Backfill] Complete!');
  
  db.close();
}

backfillMarkers();
