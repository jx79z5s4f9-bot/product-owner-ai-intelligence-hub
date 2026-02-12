const Database = require('better-sqlite3');
const path = require('path');
const db = new Database(path.join(__dirname, '../database.db'));

// Check if migration table exists
try {
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='question_history'").get();
  console.log('question_history table:', tables ? 'EXISTS' : 'NOT FOUND');
  
  // Try running migration manually if needed
  if (!tables) {
    const migration = require('../db/migrations/v5_question_history.js');
    migration.up(db);
    console.log('Migration applied');
  }
  
  // Verify
  const columns = db.prepare("PRAGMA table_info(question_history)").all();
  console.log('Columns:', columns.map(c => c.name).join(', '));
} catch (e) {
  console.error('Error:', e.message);
}
db.close();
