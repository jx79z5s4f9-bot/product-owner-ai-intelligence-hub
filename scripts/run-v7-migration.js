/**
 * Run v7 migration for relationship simmering
 */
const { initDb, getDb } = require('../db/connection');
const v7 = require('../db/migrations/v7_relationship_simmering');

initDb();
const db = getDb();

if (!v7.isApplied(db)) {
  v7.migrate(db);
  console.log('v7 migration applied');
} else {
  console.log('v7 migration already applied');
}

process.exit(0);
