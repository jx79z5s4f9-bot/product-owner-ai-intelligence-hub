/**
 * Migration v10: Configurable Content Types & Settings
 * 
 * - Adds 'aliases' column to content_types (comma-separated synonyms)
 * - Ensures 'settings' table exists for app configuration
 * - Seeds default aliases for built-in content types
 */

function isApplied(db) {
  try {
    // Check if aliases column exists on content_types
    const cols = db.prepare("PRAGMA table_info(content_types)").all();
    return cols.some(c => c.name === 'aliases');
  } catch (e) {
    return false;
  }
}

function migrate(db) {
  const results = { columnsAdded: [], tablesCreated: [], seedsInserted: [] };

  // Ensure settings table exists (used for app-level key-value config)
  db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
  results.tablesCreated.push('settings (if not exists)');

  // Add aliases column to content_types
  try {
    db.exec('ALTER TABLE content_types ADD COLUMN aliases TEXT DEFAULT \'\'');
    results.columnsAdded.push('content_types.aliases');
  } catch (e) {
    // Column may already exist
    if (!e.message.includes('duplicate column')) throw e;
  }

  // Seed default aliases for built-in types
  const defaultAliases = {
    'log':      'daily, daily log, log the day, dagboek, dagverslag',
    'meeting':  'meetings, bespreking, overleg, sessie, vergadering, standup, retro, refinement, sync',
    'artifact': 'artefact, document, spec, specification, diagram, rapport, verslag',
    'idea':     'thought, brainstorm, concept, idee'
  };

  const updateStmt = db.prepare('UPDATE content_types SET aliases = ? WHERE name = ? AND (aliases IS NULL OR aliases = \'\')');
  for (const [name, aliases] of Object.entries(defaultAliases)) {
    const result = updateStmt.run(aliases, name);
    if (result.changes > 0) {
      results.seedsInserted.push(`${name} aliases`);
    }
  }

  console.log('[Migration v10] Configurable content types:', JSON.stringify(results));
  return results;
}

module.exports = { isApplied, migrate };
