/**
 * Glossary Route - View and manage domain glossary
 */

const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');

const GLOSSARY_PATH = path.join(__dirname, '..', 'data', 'domain-glossary.md');

/**
 * GET /api/glossary
 * Get all glossary entries
 */
router.get('/', (req, res) => {
  try {
    if (!fs.existsSync(GLOSSARY_PATH)) {
      return res.json({ entries: [], raw: '' });
    }

    const content = fs.readFileSync(GLOSSARY_PATH, 'utf-8');
    const entries = parseGlossary(content);

    res.json({
      entries,
      raw: content,
      path: GLOSSARY_PATH
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/glossary/add
 * Add a new glossary entry
 */
router.post('/add', (req, res) => {
  const { dutch, english, context } = req.body;

  if (!dutch || !english) {
    return res.status(400).json({ error: 'Dutch and English terms required' });
  }

  try {
    let content = '';
    if (fs.existsSync(GLOSSARY_PATH)) {
      content = fs.readFileSync(GLOSSARY_PATH, 'utf-8');
    } else {
      content = '# Domain Glossary\n\n## Terms\n\n';
    }

    // Add new entry
    const entry = context
      ? `| ${dutch} | ${english} | ${context} |\n`
      : `| ${dutch} | ${english} | - |\n`;

    // Find the table and add entry
    if (content.includes('| Dutch | English |')) {
      // Insert before the last line of the table
      const lines = content.split('\n');
      const tableEnd = lines.findIndex((l, i) => i > 5 && !l.startsWith('|'));
      if (tableEnd > 0) {
        lines.splice(tableEnd, 0, entry.trim());
        content = lines.join('\n');
      } else {
        content += entry;
      }
    } else {
      // Create table
      content += '\n| Dutch | English | Context |\n|-------|---------|----------|\n' + entry;
    }

    fs.writeFileSync(GLOSSARY_PATH, content, 'utf-8');

    res.json({ success: true, entry: { dutch, english, context } });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/glossary/save
 * Save entire glossary content
 */
router.post('/save', (req, res) => {
  const { content } = req.body;

  if (content === undefined) {
    return res.status(400).json({ error: 'Content required' });
  }

  try {
    fs.writeFileSync(GLOSSARY_PATH, content, 'utf-8');
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * DELETE /api/glossary/entry
 * Delete a glossary entry
 */
router.delete('/entry', (req, res) => {
  const { dutch } = req.body;

  if (!dutch) {
    return res.status(400).json({ error: 'Dutch term required' });
  }

  try {
    if (!fs.existsSync(GLOSSARY_PATH)) {
      return res.status(404).json({ error: 'Glossary not found' });
    }

    let content = fs.readFileSync(GLOSSARY_PATH, 'utf-8');
    const lines = content.split('\n');
    const filtered = lines.filter(line => {
      if (!line.startsWith('|')) return true;
      const cells = line.split('|').map(c => c.trim());
      return cells[1] !== dutch;
    });

    fs.writeFileSync(GLOSSARY_PATH, filtered.join('\n'), 'utf-8');
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * Parse glossary markdown into structured entries
 */
function parseGlossary(content) {
  const entries = [];
  const lines = content.split('\n');

  for (const line of lines) {
    if (line.startsWith('|') && !line.includes('---') && !line.includes('Dutch')) {
      const cells = line.split('|').map(c => c.trim()).filter(c => c);
      if (cells.length >= 2) {
        entries.push({
          dutch: cells[0],
          english: cells[1],
          context: cells[2] || ''
        });
      }
    }
  }

  return entries;
}

module.exports = router;
