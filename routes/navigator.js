/**
 * Navigator Route - Browse RTE folder structure
 */

const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const os = require('os');
const { getDb } = require('../db/connection');

// Services for auto-extraction
let entityExtractor = null;
let intelligencePersistence = null;
let graphBuilder = null;

try {
  entityExtractor = require('../services/entity-extractor');
  intelligencePersistence = require('../services/intelligence-persistence');
  graphBuilder = require('../services/graph-builder');
  console.log('[Navigator] Entity extraction services loaded');
} catch (e) {
  console.log('[Navigator] Entity extraction services not available');
}

const WORKSPACE_ROOT = path.join(os.homedir(), 'ProductOwnerAI', 'rte');

/**
 * GET /api/navigator/tree
 * Get folder structure for an RTE
 */
router.get('/tree', (req, res) => {
  const { rteName = 'default' } = req.query;
  const rtePath = path.join(WORKSPACE_ROOT, rteName);

  if (!fs.existsSync(rtePath)) {
    return res.json({ 
      error: `RTE '${rteName}' not found`,
      tree: null,
      rteName 
    });
  }

  try {
    const tree = buildTree(rtePath, rteName);
    res.json({ 
      tree, 
      rteName,
      rootPath: rtePath 
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/navigator/doc/:id
 * Resolve a document database ID to its filepath + metadata
 */
router.get('/doc/:id', (req, res) => {
  const db = getDb();
  if (!db) return res.status(500).json({ error: 'Database not available' });

  try {
    const doc = db.prepare(`
      SELECT id, filename, filepath, document_date, rte_id
      FROM rte_documents WHERE id = ?
    `).get(req.params.id);

    if (!doc) return res.status(404).json({ error: 'Document not found' });
    res.json(doc);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/navigator/file
 * Read a specific file
 */
router.get('/file', (req, res) => {
  const { filepath } = req.query;

  if (!filepath) {
    return res.status(400).send('Filepath required');
  }

  // Security: ensure path is within workspace
  const normalizedPath = path.resolve(filepath);
  if (!normalizedPath.startsWith(path.resolve(WORKSPACE_ROOT))) {
    return res.status(403).send('Access denied');
  }

  if (!fs.existsSync(normalizedPath)) {
    return res.status(404).send('File not found');
  }

  try {
    const content = fs.readFileSync(normalizedPath, 'utf-8');
    const stats = fs.statSync(normalizedPath);
    
    res.json({
      content,
      filename: path.basename(normalizedPath),
      size: stats.size,
      modified: stats.mtime,
      path: normalizedPath
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/navigator/rtes
 * List all available RTEs
 */
router.get('/rtes', (req, res) => {
  try {
    if (!fs.existsSync(WORKSPACE_ROOT)) {
      return res.json({ rtes: [] });
    }

    const entries = fs.readdirSync(WORKSPACE_ROOT, { withFileTypes: true });
    const rtes = entries
      .filter(entry => entry.isDirectory())
      .map(entry => ({
        name: entry.name,
        path: path.join(WORKSPACE_ROOT, entry.name),
        fileCount: countFiles(path.join(WORKSPACE_ROOT, entry.name))
      }));

    res.json({ rtes });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * Build hierarchical tree structure
 */
function buildTree(dirPath, baseName = '') {
  const stats = fs.statSync(dirPath);
  
  const node = {
    name: baseName || path.basename(dirPath),
    path: dirPath,
    type: stats.isDirectory() ? 'folder' : 'file',
    size: stats.size,
    modified: stats.mtime,
    children: []
  };

  if (stats.isDirectory()) {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    
    // Sort: folders first, then files, alphabetically
    entries.sort((a, b) => {
      if (a.isDirectory() && !b.isDirectory()) return -1;
      if (!a.isDirectory() && b.isDirectory()) return 1;
      return a.name.localeCompare(b.name);
    });

    for (const entry of entries) {
      // Skip hidden files and node_modules
      if (entry.name.startsWith('.') || entry.name === 'node_modules') {
        continue;
      }

      const childPath = path.join(dirPath, entry.name);
      node.children.push(buildTree(childPath));
    }
  }

  return node;
}

/**
 * Count total files in directory recursively
 */
function countFiles(dirPath) {
  let count = 0;
  
  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      
      if (entry.isDirectory()) {
        count += countFiles(path.join(dirPath, entry.name));
      } else {
        count++;
      }
    }
  } catch (error) {
    // Ignore errors
  }
  
  return count;
}

/**
 * Save file content
 */
router.post('/save', async (req, res) => {
  const { filepath, content, rteId } = req.body;

  if (!filepath) {
    return res.status(400).json({ error: 'Missing filepath' });
  }

  // Security: Only allow files in workspace
  if (!path.resolve(filepath).startsWith(path.resolve(WORKSPACE_ROOT))) {
    return res.status(403).json({ error: 'Access denied' });
  }

  try {
    fs.writeFileSync(filepath, content, 'utf-8');
    
    let extractionStats = null;
    
    // Index in vector search if .md file
    if (filepath.endsWith('.md')) {
      try {
        const { getInstance: getVectorSearch } = require('../services/vector-search');
        const vectorSearch = getVectorSearch();
        if (vectorSearch.isReady) {
          vectorSearch.indexFile(filepath).catch(err => {
            console.error('[Navigator] Vector index failed:', err.message);
          });
        }
      } catch (error) {
        // Vector search not available, that's ok
      }
      
      // Auto-extract entities and relationships
      if (entityExtractor && intelligencePersistence && rteId) {
        try {
          console.log(`[Navigator] Auto-extracting entities from: ${path.basename(filepath)}`);
          
          // Extract entities and relationships
          const extraction = await entityExtractor.extract(content, { rteId });
          
          if (extraction.entities.length > 0 || extraction.relationships.length > 0) {
            // Save to database
            extractionStats = await intelligencePersistence.save(extraction, rteId);
            
            // Invalidate graph cache
            if (graphBuilder) {
              graphBuilder.invalidate(rteId);
            }
            
            console.log(`[Navigator] Extracted: ${extractionStats.actors} actors, ${extractionStats.relationships} relationships, ${extractionStats.suggestions} suggestions`);
          }
        } catch (error) {
          console.error('[Navigator] Entity extraction failed:', error.message);
        }
      }
    }
    
    res.json({ 
      success: true,
      extraction: extractionStats 
    });
  } catch (error) {
    console.error('Save error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Delete file or folder
 */
router.post('/delete', (req, res) => {
  const { filepath } = req.body;

  if (!filepath) {
    return res.status(400).json({ error: 'Missing filepath' });
  }

  // Security: Only allow files in workspace
  if (!path.resolve(filepath).startsWith(path.resolve(WORKSPACE_ROOT))) {
    return res.status(403).json({ error: 'Access denied' });
  }

  try {
    const isDirectory = fs.lstatSync(filepath).isDirectory();
    
    if (isDirectory) {
      fs.rmSync(filepath, { recursive: true, force: true });
    } else {
      fs.unlinkSync(filepath);
      
      // Remove from vector search if .md file
      if (filepath.endsWith('.md')) {
        try {
          const { getInstance: getVectorSearch } = require('../services/vector-search');
          const vectorSearch = getVectorSearch();
          if (vectorSearch.isReady) {
            vectorSearch.removeFile(filepath).catch(err => {
              console.error('[Navigator] Vector remove failed:', err.message);
            });
          }
        } catch (error) {
          // Vector search not available, that's ok
        }
      }
    }
    
    res.json({ success: true });
  } catch (error) {
    console.error('Delete error:', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;