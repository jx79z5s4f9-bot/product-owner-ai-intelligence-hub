/**
 * MD Files Route
 * Browse and edit orchestrator .md files
 */

const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const os = require('os');

const ORCHESTRATOR_ROOT = path.join(os.homedir(), 'ProductOwnerAI', 'orchestrator');

/**
 * GET /api/md-files
 * List all orchestrator .md files
 */
router.get('/', (req, res) => {
  try {
    const result = {
      orchestrator: null,
      prompts: [],
      practices: []
    };

    // Main orchestrator file
    const orchestratorPath = path.join(ORCHESTRATOR_ROOT, 'workflow-orchestrator-v2.md');
    if (fs.existsSync(orchestratorPath)) {
      result.orchestrator = {
        name: 'workflow-orchestrator-v2.md',
        path: orchestratorPath
      };
    }

    // Prompts folder
    const promptsDir = path.join(ORCHESTRATOR_ROOT, 'prompts');
    if (fs.existsSync(promptsDir)) {
      const files = fs.readdirSync(promptsDir).filter(f => f.endsWith('.md'));
      result.prompts = files.map(f => ({
        name: f,
        path: path.join(promptsDir, f)
      }));
    }

    // Best practices folder
    const practicesDir = path.join(ORCHESTRATOR_ROOT, 'best-practices');
    if (fs.existsSync(practicesDir)) {
      const files = fs.readdirSync(practicesDir).filter(f => f.endsWith('.md'));
      result.practices = files.map(f => ({
        name: f,
        path: path.join(practicesDir, f)
      }));
    }

    res.json(result);

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/md-files/view
 * View a specific .md file
 */
router.get('/view', (req, res) => {
  const filepath = req.query.path;

  if (!filepath) {
    return res.status(400).send('Path required');
  }

  // Security: ensure path is within orchestrator root
  const normalizedPath = path.normalize(filepath);
  if (!normalizedPath.startsWith(ORCHESTRATOR_ROOT)) {
    return res.status(403).send('Access denied');
  }

  if (!fs.existsSync(normalizedPath)) {
    return res.status(404).send('File not found');
  }

  const content = fs.readFileSync(normalizedPath, 'utf-8');
  res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
  res.send(content);
});

/**
 * POST /api/md-files/save
 * Save changes to a .md file
 */
router.post('/save', (req, res) => {
  const { filepath, content } = req.body;

  if (!filepath || content === undefined) {
    return res.status(400).json({ error: 'Filepath and content required' });
  }

  // Security: ensure path is within orchestrator root
  const normalizedPath = path.normalize(filepath);
  if (!normalizedPath.startsWith(ORCHESTRATOR_ROOT)) {
    return res.status(403).json({ error: 'Access denied' });
  }

  try {
    fs.writeFileSync(normalizedPath, content, 'utf-8');
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
