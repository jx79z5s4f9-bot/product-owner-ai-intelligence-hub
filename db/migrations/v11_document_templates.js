/**
 * Migration v11: Document Templates
 * 
 * Stores user-defined import templates with configurable fields.
 * Templates can be downloaded as .md files for filling in and re-importing.
 */

function isApplied(db) {
  try {
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='document_templates'").all();
    return tables.length > 0;
  } catch (e) {
    return false;
  }
}

function migrate(db) {
  const results = { tablesCreated: [], seedsInserted: [] };

  db.exec(`
    CREATE TABLE IF NOT EXISTS document_templates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      description TEXT DEFAULT '',
      content_type TEXT DEFAULT '',
      fields TEXT NOT NULL DEFAULT '[]',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
  results.tablesCreated.push('document_templates');

  // Seed a default template for each content type
  const defaults = [
    {
      name: 'Daily Log',
      description: 'A daily work log with reflections',
      content_type: 'log',
      fields: JSON.stringify([
        { key: 'date', label: 'Date', required: true, hint: 'e.g. Monday, 12 February 2026' },
        { key: 'title', label: 'Title', required: true, hint: 'e.g. Sprint 5 Day 3' },
        { key: 'type', label: 'Document type', required: true, prefill: 'log' },
        { key: 'content', label: 'Content', required: true, hint: 'Write your log here...', multiline: true }
      ])
    },
    {
      name: 'Meeting Notes',
      description: 'Capture attendees, decisions, and action items',
      content_type: 'meeting',
      fields: JSON.stringify([
        { key: 'date', label: 'Date', required: true, hint: 'e.g. Wednesday, 12 February 2026' },
        { key: 'title', label: 'Title', required: true, hint: 'e.g. Sprint Review' },
        { key: 'type', label: 'Document type', required: true, prefill: 'meeting' },
        { key: 'participants', label: 'Participants', required: false, hint: 'e.g. Alice, Bob, Charlie' },
        { key: 'tags', label: 'Tags', required: false, hint: 'e.g. #sprint-review, #architecture' },
        { key: 'content', label: 'Content', required: true, hint: 'Agenda, decisions, action items...', multiline: true }
      ])
    },
    {
      name: 'Artifact',
      description: 'A specification, diagram description, or technical document',
      content_type: 'artifact',
      fields: JSON.stringify([
        { key: 'date', label: 'Date', required: true, hint: 'e.g. 2026-02-12' },
        { key: 'title', label: 'Title', required: true, hint: 'e.g. Authentication Flow Spec' },
        { key: 'type', label: 'Document type', required: true, prefill: 'artifact' },
        { key: 'tags', label: 'Tags', required: false, hint: 'e.g. #architecture, #security' },
        { key: 'content', label: 'Content', required: true, hint: 'Document content...', multiline: true }
      ])
    },
    {
      name: 'Idea',
      description: 'Capture a quick idea or brainstorm',
      content_type: 'idea',
      fields: JSON.stringify([
        { key: 'date', label: 'Date', required: true, hint: 'e.g. 2026-02-12' },
        { key: 'title', label: 'Title', required: true, hint: 'e.g. What if we add a chatbot?' },
        { key: 'type', label: 'Document type', required: true, prefill: 'idea' },
        { key: 'content', label: 'Content', required: true, hint: 'Describe your idea...', multiline: true }
      ])
    }
  ];

  const insert = db.prepare(`
    INSERT INTO document_templates (name, description, content_type, fields)
    VALUES (?, ?, ?, ?)
  `);

  for (const t of defaults) {
    insert.run(t.name, t.description, t.content_type, t.fields);
    results.seedsInserted.push(t.name);
  }

  console.log('[Migration v11] Document templates:', JSON.stringify(results));
  return results;
}

module.exports = { isApplied, migrate };
