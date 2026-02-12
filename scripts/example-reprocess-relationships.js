/**
 * EXAMPLE: Re-process Documents for Relationship Extraction
 * 
 * This script:
 * 1. Gets all documents in a specified RTE
 * 2. Re-extracts relationships using the intelligence system
 * 3. All relationships go to suggestions (simmer pattern)
 * 
 * Usage: Edit the RTE name filter below, then run with: node scripts/example-reprocess-relationships.js
 */

const { initDb, getDb } = require('../db/connection');
const path = require('path');
const fs = require('fs');

// Initialize
initDb();
const db = getDb();

// Get target RTE — change this to match your RTE name
const RTE_NAME = 'My Product';  // Edit this
const targetRte = db.prepare(`SELECT id, name FROM rtes WHERE LOWER(name) LIKE ?`).get(`%${RTE_NAME.toLowerCase()}%`);
if (!targetRte) {
  console.error(`RTE "${RTE_NAME}" not found`);
  process.exit(1);
}

console.log(`\n🔄 Re-processing documents for RTE: ${targetRte.name} (ID: ${targetRte.id})\n`);

// Get all documents from rte_documents table
const documents = db.prepare(`
  SELECT id, filename as name, filepath as file_path, raw_content as content, title
  FROM rte_documents 
  WHERE rte_id = ?
  ORDER BY filename
`).all(targetRte.id);

console.log(`Found ${documents.length} documents\n`);

// Load services
let entityExtractor, intelligencePersistence;
try {
  entityExtractor = require('../services/entity-extractor');
  intelligencePersistence = require('../services/intelligence-persistence');
} catch (e) {
  console.error('Failed to load services:', e.message);
  process.exit(1);
}

async function processDocument(doc) {
  console.log(`📄 Processing: ${doc.name}`);
  
  try {
    // Read content from file if not in DB
    let content = doc.content;
    if (!content && doc.file_path) {
      const fullPath = path.resolve(__dirname, '..', doc.file_path);
      if (fs.existsSync(fullPath)) {
        content = fs.readFileSync(fullPath, 'utf8');
      }
    }
    
    if (!content || content.length < 50) {
      console.log(`   ⏭️  Skipped (no content or too short)`);
      return { skipped: true };
    }
    
    // Extract entities and relationships
    const extraction = await entityExtractor.extract(content, {
      extractRelationships: true,
      extractEntities: true
    });
    
    if (!extraction || !extraction.relationships || extraction.relationships.length === 0) {
      console.log(`   ⏭️  No relationships found`);
      return { relationships: 0 };
    }
    
    console.log(`   🔗 Found ${extraction.relationships.length} relationships`);
    
    // Save using intelligence persistence (all go to suggestions now)
    const stats = intelligencePersistence.save(extraction, targetRte.id, doc.id);
    
    console.log(`   ✅ Saved: ${stats.actors} actors, ${stats.suggestions} suggestions`);
    return stats;
  } catch (error) {
    console.log(`   ❌ Error: ${error.message}`);
    return { error: error.message };
  }
}

async function main() {
  let totalSuggestions = 0;
  let totalActors = 0;
  let processed = 0;
  let skipped = 0;
  let errors = 0;
  
  for (const doc of documents) {
    const result = await processDocument(doc);
    
    if (result.skipped) {
      skipped++;
    } else if (result.error) {
      errors++;
    } else {
      processed++;
      totalSuggestions += result.suggestions || 0;
      totalActors += result.actors || 0;
    }
    
    // Small delay to avoid rate limits
    await new Promise(r => setTimeout(r, 500));
  }
  
  console.log(`\n${'='.repeat(50)}`);
  console.log(`📊 SUMMARY`);
  console.log(`${'='.repeat(50)}`);
  console.log(`Documents processed: ${processed}`);
  console.log(`Documents skipped: ${skipped}`);
  console.log(`Errors: ${errors}`);
  console.log(`Total new actors: ${totalActors}`);
  console.log(`Total relationship suggestions: ${totalSuggestions}`);
  
  // Show suggestion stats
  const suggestionStats = db.prepare(`
    SELECT 
      COUNT(*) as total,
      SUM(CASE WHEN evidence_count >= 2 THEN 1 ELSE 0 END) as multi_evidence,
      SUM(CASE WHEN evidence_count >= 3 THEN 1 ELSE 0 END) as strong_evidence,
      MAX(evidence_count) as max_evidence
    FROM rte_relationship_suggestions
    WHERE rte_id = ? AND is_approved = 0 AND (is_dismissed = 0 OR is_dismissed IS NULL)
  `).get(targetRte.id);
  
  console.log(`\n📬 SUGGESTIONS INBOX`);
  console.log(`${'='.repeat(50)}`);
  console.log(`Total pending: ${suggestionStats.total}`);
  console.log(`With 2+ evidence: ${suggestionStats.multi_evidence || 0}`);
  console.log(`With 3+ evidence (strong): ${suggestionStats.strong_evidence || 0}`);
  console.log(`Max evidence count: ${suggestionStats.max_evidence || 0}`);
  
  console.log(`\n✅ Done! Visit /suggestions to review relationships\n`);
}

main().catch(console.error);
