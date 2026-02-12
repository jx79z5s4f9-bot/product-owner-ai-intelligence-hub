/**
 * Maintenance Routes
 * System status, health checks, and admin actions
 */

const express = require('express');
const router = express.Router();
const os = require('os');
const path = require('path');
const fs = require('fs');
const { getDb } = require('../db/connection');

// Get services
let vectorSearch = null;
let llmManager = null;
let graphBuilder = null;
let entityExtractor = null;
let intelligencePersistence = null;

try {
  vectorSearch = require('../services/sqlite-vector-search').getInstance();
} catch (e) {}
try {
  llmManager = require('../services/llm-manager').getInstance();
} catch (e) {}
try {
  graphBuilder = require('../services/graph-builder');
} catch (e) {}
try {
  entityExtractor = require('../services/entity-extractor');
} catch (e) {}
try {
  intelligencePersistence = require('../services/intelligence-persistence');
} catch (e) {}

/**
 * GET /api/maintenance/status
 * Get full system status
 */
router.get('/status', async (req, res) => {
  const status = {
    timestamp: new Date().toISOString(),
    server: {
      status: 'online',
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      node: process.version
    },
    database: {
      status: 'unknown',
      path: path.join(__dirname, '..', 'database.db')
    },
    vectorSearch: {
      status: 'unknown',
      type: 'SQLite FTS5',
      stats: null
    },
    llm: {
      status: 'unknown',
      models: []
    },
    rtes: []
  };

  // Check SQLite database
  try {
    const db = getDb();
    if (db) {
      const test = db.prepare('SELECT 1 as ok').get();
      status.database.status = test?.ok === 1 ? 'online' : 'error';
    }
  } catch (e) {
    status.database.status = 'error';
    status.database.error = e.message;
  }

  // Check Vector Search
  try {
    if (vectorSearch && vectorSearch.isReady) {
      status.vectorSearch.status = 'online';
      status.vectorSearch.stats = vectorSearch.getStats();
    } else if (vectorSearch) {
      await vectorSearch.init();
      status.vectorSearch.status = vectorSearch.isReady ? 'online' : 'offline';
      status.vectorSearch.stats = vectorSearch.getStats();
    }
  } catch (e) {
    status.vectorSearch.status = 'error';
    status.vectorSearch.error = e.message;
  }

  // Check LLM availability
  try {
    const response = await fetch('http://localhost:11434/api/tags', { 
      signal: AbortSignal.timeout(3000) 
    });
    if (response.ok) {
      const data = await response.json();
      status.llm.status = 'online';
      status.llm.models = data.models?.map(m => ({
        name: m.name,
        size: m.size,
        modified: m.modified_at
      })) || [];
    }
  } catch (e) {
    status.llm.status = 'offline';
    status.llm.error = 'Ollama not running';
  }

  // Get RTE stats
  try {
    const db = getDb();
    if (db) {
      const rtes = db.prepare(`
        SELECT r.id, r.name, r.status, r.metadata_json,
               (SELECT COUNT(*) FROM actors WHERE rte_id = r.id) as actors,
               (SELECT COUNT(*) FROM relationships WHERE rte_id = r.id) as relationships,
               0 as documents
        FROM rtes r
      `).all();
      status.rtes = rtes.map(r => ({
        id: r.id,
        name: r.name,
        status: r.status,
        readOnly: JSON.parse(r.metadata_json || '{}').read_only || false,
        actors: r.actors,
        relationships: r.relationships,
        documents: r.documents
      }));
    }
  } catch (e) {
    console.error('[Maintenance] RTE stats error:', e.message);
  }

  res.json(status);
});

/**
 * POST /api/maintenance/rebuild-index
 * Rebuild vector search index for an RTE
 */
router.post('/rebuild-index', async (req, res) => {
  const { rteId } = req.body;

  if (!rteId) {
    return res.status(400).json({ error: 'rteId required' });
  }

  if (!vectorSearch) {
    return res.status(503).json({ error: 'Vector search not available' });
  }

  try {
    // Get RTE base path
    const db = getDb();
    const rte = db.prepare('SELECT * FROM rtes WHERE id = ?').get(rteId);

    if (!rte) {
      return res.status(404).json({ error: 'RTE not found' });
    }

    const metadata = JSON.parse(rte.metadata_json || '{}');
    const basePath = metadata.base_path || `~/ProductOwnerAI/rte/${rte.name.toLowerCase()}`;

    const result = await vectorSearch.rebuildIndex(rteId, basePath);
    
    res.json({ 
      success: true, 
      rteId, 
      rteName: rte.name,
      indexed: result.indexed, 
      errors: result.errors 
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/maintenance/reanalyze
 * Re-extract entities from all documents in an RTE
 */
router.post('/reanalyze', async (req, res) => {
  const { rteId } = req.body;

  if (!rteId) {
    return res.status(400).json({ error: 'rteId required' });
  }

  if (!entityExtractor || !intelligencePersistence) {
    return res.status(503).json({ error: 'Entity extraction not available' });
  }

  try {
    // Get RTE
    const db = getDb();
    const rte = db.prepare('SELECT * FROM rtes WHERE id = ?').get(rteId);

    if (!rte) {
      return res.status(404).json({ error: 'RTE not found' });
    }

    const metadata = JSON.parse(rte.metadata_json || '{}');
    const basePath = path.normalize((metadata.base_path || '').replace(/^~/, os.homedir()));

    if (!fs.existsSync(basePath)) {
      return res.status(404).json({ error: 'RTE path not found: ' + basePath });
    }

    // Find all .md files
    const mdFiles = [];
    const scanDir = (dir) => {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory() && !entry.name.startsWith('.')) {
          scanDir(fullPath);
        } else if (entry.isFile() && entry.name.endsWith('.md')) {
          mdFiles.push(fullPath);
        }
      }
    };
    scanDir(basePath);

    // Extract entities from each file
    let totalActors = 0;
    let totalRelationships = 0;
    let totalSuggestions = 0;
    let filesProcessed = 0;
    let errors = 0;

    for (const filepath of mdFiles) {
      try {
        const content = fs.readFileSync(filepath, 'utf-8');
        const extraction = await entityExtractor.extract(content, { rteId });
        
        if (extraction.entities.length > 0 || extraction.relationships.length > 0) {
          const stats = await intelligencePersistence.save(extraction, rteId);
          totalActors += stats.actors;
          totalRelationships += stats.relationships;
          totalSuggestions += stats.suggestions;
        }
        filesProcessed++;
      } catch (e) {
        console.error(`[Reanalyze] Error processing ${filepath}:`, e.message);
        errors++;
      }
    }

    // Invalidate graph cache
    if (graphBuilder) {
      graphBuilder.invalidate(rteId);
    }

    res.json({
      success: true,
      rteId,
      rteName: rte.name,
      filesProcessed,
      filesTotal: mdFiles.length,
      errors,
      actors: totalActors,
      relationships: totalRelationships,
      suggestions: totalSuggestions
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/maintenance/clear-cache
 * Clear all caches
 */
router.post('/clear-cache', (req, res) => {
  try {
    if (graphBuilder) {
      graphBuilder.clearCache();
    }
    res.json({ success: true, message: 'Caches cleared' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/maintenance/restart-services
 * Reinitialize services (doesn't restart server)
 */
router.post('/restart-services', async (req, res) => {
  try {
    const results = {
      vectorSearch: false,
      llm: false,
      graphBuilder: false
    };

    if (vectorSearch) {
      await vectorSearch.init();
      results.vectorSearch = vectorSearch.isReady;
    }

    if (graphBuilder) {
      graphBuilder.clearCache();
      results.graphBuilder = true;
    }

    // LLM manager doesn't need restart, just check connection
    try {
      const response = await fetch('http://localhost:11434/api/tags', { 
        signal: AbortSignal.timeout(3000) 
      });
      results.llm = response.ok;
    } catch (e) {
      results.llm = false;
    }

    res.json({ success: true, results });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/maintenance/logs
 * Get recent logs (if available)
 */
router.get('/logs', (req, res) => {
  const logFile = path.join(os.tmpdir(), 'poai.log');
  
  if (fs.existsSync(logFile)) {
    const content = fs.readFileSync(logFile, 'utf-8');
    const lines = content.split('\n').slice(-100);
    res.json({ logs: lines });
  } else {
    res.json({ logs: ['No log file found at ' + logFile] });
  }
});

// ===========================================
// BACKUP MANAGEMENT (Phase 2)
// ===========================================

let backupService = null;
try {
  backupService = require('../services/backup-service');
} catch (e) {
  console.log('[Maintenance] Backup service not available');
}

/**
 * GET /api/maintenance/backups
 * List all available backups
 */
router.get('/backups', (req, res) => {
  if (!backupService) {
    return res.status(503).json({ error: 'Backup service not available' });
  }

  try {
    const backups = backupService.listBackups();
    const status = backupService.getStatus();
    res.json({ backups, status });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/maintenance/backups/create
 * Create a manual backup
 */
router.post('/backups/create', (req, res) => {
  if (!backupService) {
    return res.status(503).json({ error: 'Backup service not available' });
  }

  try {
    const result = backupService.createBackup();
    if (result.success) {
      res.json({ success: true, path: result.path });
    } else {
      res.status(500).json({ error: result.error });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/maintenance/backups/restore
 * Restore from a backup
 */
router.post('/backups/restore', (req, res) => {
  if (!backupService) {
    return res.status(503).json({ error: 'Backup service not available' });
  }

  const { filename } = req.body;
  if (!filename) {
    return res.status(400).json({ error: 'Backup filename required' });
  }

  try {
    const result = backupService.restore(filename);
    if (result.success) {
      res.json({ success: true, message: 'Database restored. Restart the server to apply changes.' });
    } else {
      res.status(500).json({ error: result.error });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ===========================================
// MONTHLY ARCHIVE MANAGEMENT
// ===========================================

/**
 * Extract date from filename (expects format like 2026-02-04-something.md)
 */
function extractDateFromFilename(filename) {
  const match = filename.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (match) {
    return { year: match[1], month: match[2], day: match[3] };
  }
  return null;
}

/**
 * GET /api/maintenance/archive/preview
 * Preview what files would be archived for an RTE
 */
router.get('/archive/preview', (req, res) => {
  const db = getDb();
  if (!db) {
    return res.status(500).json({ error: 'Database not available' });
  }

  const { rteId } = req.query;
  if (!rteId) {
    return res.status(400).json({ error: 'RTE ID required' });
  }

  try {
    const rte = db.prepare('SELECT * FROM rtes WHERE id = ?').get(rteId);
    if (!rte) {
      return res.status(404).json({ error: 'RTE not found' });
    }

    const metadata = JSON.parse(rte.metadata_json || '{}');
    const basePath = path.normalize((metadata.base_path || '').replace(/^~/, os.homedir()));

    if (!fs.existsSync(basePath)) {
      return res.status(404).json({ error: 'RTE path not found' });
    }

    // Get current date info
    const now = new Date();
    const currentYear = now.getFullYear().toString();
    const currentMonth = (now.getMonth() + 1).toString().padStart(2, '0');
    const dayOfMonth = now.getDate();

    // Only allow archiving after the 7th of the month (grace period)
    const gracePeriodDays = 7;
    const canArchive = dayOfMonth >= gracePeriodDays;

    // Find files to archive (from previous months, not in archive folders already)
    const filesToArchive = [];
    const scanDir = (dir, relativePath = '') => {
      if (!fs.existsSync(dir)) return;

      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        const relPath = relativePath ? `${relativePath}/${entry.name}` : entry.name;

        if (entry.isDirectory()) {
          // Skip if this is already a month archive folder (YYYY-MM format)
          if (/^\d{4}-\d{2}$/.test(entry.name)) {
            continue;
          }
          if (!entry.name.startsWith('.')) {
            scanDir(fullPath, relPath);
          }
        } else if (entry.isFile() && entry.name.endsWith('.md')) {
          const dateInfo = extractDateFromFilename(entry.name);
          if (dateInfo) {
            // Check if file is from a previous month
            const fileYearMonth = `${dateInfo.year}-${dateInfo.month}`;
            const currentYearMonth = `${currentYear}-${currentMonth}`;

            if (fileYearMonth < currentYearMonth) {
              filesToArchive.push({
                filename: entry.name,
                filepath: fullPath,
                relativePath: relPath,
                year: dateInfo.year,
                month: dateInfo.month,
                targetFolder: fileYearMonth
              });
            }
          }
        }
      }
    };

    scanDir(basePath);

    // Group by month
    const byMonth = {};
    for (const file of filesToArchive) {
      if (!byMonth[file.targetFolder]) {
        byMonth[file.targetFolder] = [];
      }
      byMonth[file.targetFolder].push(file);
    }

    res.json({
      rteId: parseInt(rteId),
      rteName: rte.name,
      basePath,
      currentMonth: `${currentYear}-${currentMonth}`,
      dayOfMonth,
      gracePeriodDays,
      canArchive,
      canArchiveMessage: canArchive
        ? 'Ready to archive'
        : `Wait until day ${gracePeriodDays} of the month (${gracePeriodDays - dayOfMonth} days remaining)`,
      totalFiles: filesToArchive.length,
      byMonth,
      files: filesToArchive
    });
  } catch (error) {
    console.error('[Archive] Preview error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/maintenance/archive/execute
 * Execute the archive operation for an RTE
 */
router.post('/archive/execute', async (req, res) => {
  const db = getDb();
  if (!db) {
    return res.status(500).json({ error: 'Database not available' });
  }

  const { rteId, force = false } = req.body;
  if (!rteId) {
    return res.status(400).json({ error: 'RTE ID required' });
  }

  try {
    const rte = db.prepare('SELECT * FROM rtes WHERE id = ?').get(rteId);
    if (!rte) {
      return res.status(404).json({ error: 'RTE not found' });
    }

    const metadata = JSON.parse(rte.metadata_json || '{}');
    const basePath = path.normalize((metadata.base_path || '').replace(/^~/, os.homedir()));

    // Check grace period unless forced
    const now = new Date();
    const currentYear = now.getFullYear().toString();
    const currentMonth = (now.getMonth() + 1).toString().padStart(2, '0');
    const dayOfMonth = now.getDate();
    const gracePeriodDays = 7;

    if (!force && dayOfMonth < gracePeriodDays) {
      return res.status(400).json({
        error: `Archive not available yet. Wait until day ${gracePeriodDays} of the month.`,
        daysRemaining: gracePeriodDays - dayOfMonth
      });
    }

    // Find files to archive
    const filesToArchive = [];
    const scanDir = (dir, relativePath = '') => {
      if (!fs.existsSync(dir)) return;

      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        const relPath = relativePath ? `${relativePath}/${entry.name}` : entry.name;

        if (entry.isDirectory()) {
          if (/^\d{4}-\d{2}$/.test(entry.name)) continue;
          if (!entry.name.startsWith('.')) {
            scanDir(fullPath, relPath);
          }
        } else if (entry.isFile() && entry.name.endsWith('.md')) {
          const dateInfo = extractDateFromFilename(entry.name);
          if (dateInfo) {
            const fileYearMonth = `${dateInfo.year}-${dateInfo.month}`;
            const currentYearMonth = `${currentYear}-${currentMonth}`;

            if (fileYearMonth < currentYearMonth) {
              // Get the parent directory of the file
              const parentDir = path.dirname(fullPath);
              const targetDir = path.join(parentDir, fileYearMonth);
              const targetPath = path.join(targetDir, entry.name);

              filesToArchive.push({
                filename: entry.name,
                oldPath: fullPath,
                newPath: targetPath,
                targetDir,
                yearMonth: fileYearMonth
              });
            }
          }
        }
      }
    };

    scanDir(basePath);

    if (filesToArchive.length === 0) {
      return res.json({
        success: true,
        message: 'No files to archive',
        moved: 0,
        dbUpdates: 0
      });
    }

    // Execute the archive
    let moved = 0;
    let dbUpdates = 0;
    const errors = [];

    for (const file of filesToArchive) {
      try {
        // Create target directory if needed
        if (!fs.existsSync(file.targetDir)) {
          fs.mkdirSync(file.targetDir, { recursive: true });
        }

        // Move the file
        fs.renameSync(file.oldPath, file.newPath);
        moved++;

        // Update rte_documents table
        const docUpdate = db.prepare(`
          UPDATE rte_documents SET filepath = ? WHERE filepath = ?
        `).run(file.newPath, file.oldPath);
        dbUpdates += docUpdate.changes;

        // Update document_chunks table (for vector search)
        try {
          const chunkUpdate = db.prepare(`
            UPDATE document_chunks SET filepath = ? WHERE filepath = ?
          `).run(file.newPath, file.oldPath);
          dbUpdates += chunkUpdate.changes;
        } catch (e) {
          // Table might not exist
        }

        // Update documents_fts table (FTS5)
        // Note: FTS5 tables need special handling - we rebuild by deleting and reinserting
        try {
          // Get existing FTS entries
          const ftsEntries = db.prepare(`
            SELECT rowid, * FROM documents_fts WHERE filepath = ?
          `).all(file.oldPath);

          // Delete old entries
          db.prepare(`DELETE FROM documents_fts WHERE filepath = ?`).run(file.oldPath);

          // Reinsert with new path
          const insertFts = db.prepare(`
            INSERT INTO documents_fts (doc_id, rte_id, filepath, filename, chunk_index, content, section_title)
            VALUES (?, ?, ?, ?, ?, ?, ?)
          `);

          for (const entry of ftsEntries) {
            insertFts.run(
              entry.doc_id,
              entry.rte_id,
              file.newPath,
              entry.filename,
              entry.chunk_index,
              entry.content,
              entry.section_title
            );
          }
        } catch (e) {
          // FTS table might not exist or have different schema
        }

      } catch (err) {
        errors.push({ file: file.filename, error: err.message });
      }
    }

    // Clear graph cache since file locations changed
    if (graphBuilder) {
      graphBuilder.invalidate(rteId);
    }

    res.json({
      success: true,
      message: `Archived ${moved} files`,
      moved,
      dbUpdates,
      errors: errors.length > 0 ? errors : undefined
    });
  } catch (error) {
    console.error('[Archive] Execute error:', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
