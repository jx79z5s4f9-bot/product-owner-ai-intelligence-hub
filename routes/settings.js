/**
 * Settings API Routes
 * LLM configuration, tag management, and extraction control
 * Phase 7: Intelligence System v2.0
 */

const express = require('express');
const router = express.Router();
const { getDb } = require('../db/connection');
const { getInstance: getExtractionWorker } = require('../services/extraction-worker');

// Ollama configuration
const OLLAMA_HOST = process.env.OLLAMA_HOST || 'http://localhost:11434';

// ============================================================
// LLM Configuration
// ============================================================

/**
 * GET /api/settings/llm
 * Get all LLM configurations
 */
router.get('/llm', (req, res) => {
  const db = getDb();
  if (!db) {
    return res.status(500).json({ error: 'Database not initialized' });
  }

  try {
    const configs = db.prepare(`
      SELECT id, task as purpose, model_name, endpoint, temperature, max_tokens, fallback_models, is_active, created_at, updated_at 
      FROM llm_configs ORDER BY task
    `).all();

    res.json(configs);
  } catch (error) {
    console.error('[Settings] Get LLM configs failed:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * PUT /api/settings/llm/:purpose
 * Update LLM configuration for a purpose
 */
router.put('/llm/:purpose', (req, res) => {
  const { purpose } = req.params;
  const { model_name, is_active, fallback_models } = req.body;

  const db = getDb();
  if (!db) {
    return res.status(500).json({ error: 'Database not initialized' });
  }

  try {
    const result = db.prepare(`
      UPDATE llm_configs 
      SET model_name = COALESCE(?, model_name),
          is_active = COALESCE(?, is_active),
          fallback_models = COALESCE(?, fallback_models),
          updated_at = datetime('now')
      WHERE task = ?
    `).run(model_name, is_active, fallback_models, purpose);

    if (result.changes === 0) {
      return res.status(404).json({ error: 'Configuration not found' });
    }

    res.json({ success: true, message: `LLM config for ${purpose} updated` });
  } catch (error) {
    console.error('[Settings] Update LLM config failed:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/settings/llm/available
 * Get available models from Ollama
 */
router.get('/llm/available', async (req, res) => {
  try {
    const response = await fetch(`${OLLAMA_HOST}/api/tags`);
    
    if (!response.ok) {
      return res.status(500).json({ error: 'Ollama not available' });
    }

    const data = await response.json();
    const models = (data.models || []).map(m => ({
      name: m.name,
      size: m.size,
      modifiedAt: m.modified_at
    }));

    res.json(models);
  } catch (error) {
    console.error('[Settings] Get available models failed:', error);
    res.status(500).json({ error: 'Could not connect to Ollama' });
  }
});

// ============================================================
// Semantic Tags Management
// ============================================================

/**
 * GET /api/settings/semantic-tags
 * Get all semantic tags
 */
router.get('/semantic-tags', (req, res) => {
  const db = getDb();
  if (!db) {
    return res.status(500).json({ error: 'Database not initialized' });
  }

  try {
    const tags = db.prepare(`
      SELECT st.*, 
        (SELECT COUNT(*) FROM document_tags dt WHERE dt.tag_type = 'semantic' AND dt.tag_value = st.name) as usage_count
      FROM semantic_tags st
      ORDER BY st.name
    `).all();

    res.json(tags);
  } catch (error) {
    console.error('[Settings] Get semantic tags failed:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/settings/semantic-tags
 * Add a new semantic tag
 */
router.post('/semantic-tags', (req, res) => {
  const { name, description } = req.body;

  if (!name) {
    return res.status(400).json({ error: 'Name is required' });
  }

  const db = getDb();
  if (!db) {
    return res.status(500).json({ error: 'Database not initialized' });
  }

  try {
    const result = db.prepare(`
      INSERT INTO semantic_tags (name, description) VALUES (?, ?)
    `).run(name.toLowerCase(), description || '');

    res.json({ 
      success: true, 
      id: result.lastInsertRowid,
      message: `Tag "${name}" created` 
    });
  } catch (error) {
    if (error.message.includes('UNIQUE')) {
      return res.status(400).json({ error: 'Tag already exists' });
    }
    console.error('[Settings] Create semantic tag failed:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * DELETE /api/settings/semantic-tags/:name
 * Delete a semantic tag
 */
router.delete('/semantic-tags/:name', (req, res) => {
  const { name } = req.params;

  const db = getDb();
  if (!db) {
    return res.status(500).json({ error: 'Database not initialized' });
  }

  try {
    // Check usage
    const usage = db.prepare(`
      SELECT COUNT(*) as count FROM document_tags 
      WHERE tag_type = 'semantic' AND tag_value = ?
    `).get(name);

    if (usage.count > 0) {
      return res.status(400).json({ 
        error: `Cannot delete: tag is used in ${usage.count} documents` 
      });
    }

    db.prepare('DELETE FROM semantic_tags WHERE name = ?').run(name);
    res.json({ success: true, message: `Tag "${name}" deleted` });
  } catch (error) {
    console.error('[Settings] Delete semantic tag failed:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============================================================
// Content Types Management
// ============================================================

/**
 * GET /api/settings/content-types
 * Get all content types
 */
router.get('/content-types', (req, res) => {
  const db = getDb();
  if (!db) {
    return res.status(500).json({ error: 'Database not initialized' });
  }

  try {
    const types = db.prepare(`
      SELECT ct.*, 
        (SELECT COUNT(*) FROM rte_documents rd WHERE rd.content_type_id = ct.id) as usage_count
      FROM content_types ct
      ORDER BY ct.name
    `).all();

    res.json(types);
  } catch (error) {
    console.error('[Settings] Get content types failed:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/settings/content-types
 * Add a new content type
 */
router.post('/content-types', (req, res) => {
  const { name, description, icon } = req.body;

  if (!name) {
    return res.status(400).json({ error: 'Name is required' });
  }

  const db = getDb();
  if (!db) {
    return res.status(500).json({ error: 'Database not initialized' });
  }

  try {
    const result = db.prepare(`
      INSERT INTO content_types (name, description, icon) VALUES (?, ?, ?)
    `).run(name.toLowerCase(), description || '', icon || '📄');

    res.json({ 
      success: true, 
      id: result.lastInsertRowid,
      message: `Content type "${name}" created` 
    });
  } catch (error) {
    if (error.message.includes('UNIQUE')) {
      return res.status(400).json({ error: 'Content type already exists' });
    }
    console.error('[Settings] Create content type failed:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============================================================
// Extraction Queue Management
// ============================================================

/**
 * GET /api/settings/extraction/status
 * Get extraction queue status
 */
router.get('/extraction/status', (req, res) => {
  const worker = getExtractionWorker();
  const stats = worker.getStats();
  
  res.json({
    workerRunning: worker.isRunning,
    queue: stats
  });
});

/**
 * GET /api/settings/extraction/queue
 * Get items in extraction queue
 */
router.get('/extraction/queue', (req, res) => {
  const db = getDb();
  if (!db) {
    return res.status(500).json({ error: 'Database not initialized' });
  }

  const { status, limit = 50 } = req.query;

  try {
    let query = `
      SELECT eq.*, rd.filename, rd.word_count
      FROM extraction_queue eq
      JOIN rte_documents rd ON eq.document_id = rd.id
    `;
    
    if (status && status !== 'all') {
      query += ` WHERE eq.status = ?`;
    }
    
    query += ` ORDER BY eq.created_at DESC LIMIT ?`;
    
    const items = status && status !== 'all'
      ? db.prepare(query).all(status, parseInt(limit))
      : db.prepare(query).all(parseInt(limit));
    
    res.json(items);
  } catch (error) {
    console.error('[Settings] Get extraction queue failed:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/settings/extraction/retry
 * Retry failed extraction items
 */
router.post('/extraction/retry', (req, res) => {
  const worker = getExtractionWorker();
  const result = worker.retryFailed();
  
  res.json({
    success: true,
    message: `${result.count} failed items queued for retry`
  });
});

/**
 * POST /api/settings/extraction/retry-dead
 * Retry dead-letter items
 */
router.post('/extraction/retry-dead', (req, res) => {
  const worker = getExtractionWorker();
  const result = worker.retryDead();
  
  res.json({
    success: true,
    message: `${result.count} dead-letter items queued for retry`
  });
});

/**
 * POST /api/settings/extraction/start
 * Start the extraction worker
 */
router.post('/extraction/start', (req, res) => {
  const worker = getExtractionWorker();
  worker.start();
  
  res.json({
    success: true,
    message: 'Extraction worker started'
  });
});

/**
 * POST /api/settings/extraction/stop
 * Stop the extraction worker
 */
router.post('/extraction/stop', (req, res) => {
  const worker = getExtractionWorker();
  worker.stop();
  
  res.json({
    success: true,
    message: 'Extraction worker stopped'
  });
});

// ============================================================
// App Settings (key-value)
// ============================================================

/**
 * GET /api/settings/app
 * Get all app settings from the settings table
 */
router.get('/app', (req, res) => {
  const db = getDb();
  if (!db) return res.status(500).json({ error: 'Database not available' });

  try {
    const rows = db.prepare('SELECT key, value FROM settings').all();
    const settings = {};
    rows.forEach(r => settings[r.key] = r.value);
    res.json(settings);
  } catch (e) {
    // settings table may not exist yet
    res.json({});
  }
});

/**
 * PUT /api/settings/app
 * Save an app setting (key-value)
 */
router.put('/app', (req, res) => {
  const db = getDb();
  if (!db) return res.status(500).json({ error: 'Database not available' });

  const { key, value } = req.body;
  if (!key) return res.status(400).json({ error: 'Key is required' });

  try {
    db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(key, value || '');
    res.json({ success: true, key, value });
  } catch (e) {
    console.error('[Settings] Save app setting failed:', e);
    res.status(500).json({ error: e.message });
  }
});

/**
 * GET /api/settings/content-types/with-aliases
 * Get content types including aliases
 */
router.get('/content-types/with-aliases', (req, res) => {
  const db = getDb();
  if (!db) return res.status(500).json({ error: 'Database not available' });

  try {
    const types = db.prepare(`
      SELECT id, name, description, icon, aliases, is_active, sort_order
      FROM content_types
      WHERE is_active = 1
      ORDER BY sort_order
    `).all();
    res.json({ types });
  } catch (e) {
    // aliases column may not exist yet — return without it
    try {
      const types = db.prepare(`
        SELECT id, name, description, icon, is_active, sort_order
        FROM content_types
        WHERE is_active = 1
        ORDER BY sort_order
      `).all();
      res.json({ types: types.map(t => ({ ...t, aliases: '' })) });
    } catch (e2) {
      res.status(500).json({ error: e2.message });
    }
  }
});

/**
 * PUT /api/settings/content-types/:id/aliases
 * Update aliases for a content type
 */
router.put('/content-types/:id/aliases', (req, res) => {
  const db = getDb();
  if (!db) return res.status(500).json({ error: 'Database not available' });

  const { aliases } = req.body;
  try {
    db.prepare('UPDATE content_types SET aliases = ? WHERE id = ?').run(aliases || '', req.params.id);
    const updated = db.prepare('SELECT * FROM content_types WHERE id = ?').get(req.params.id);
    res.json({ success: true, contentType: updated });
  } catch (e) {
    console.error('[Settings] Update aliases failed:', e);
    res.status(500).json({ error: e.message });
  }
});

// ============================================================
// System Status
// ============================================================

/**
 * GET /api/settings/status
 * Get overall system status
 */
router.get('/status', async (req, res) => {
  const db = getDb();
  const worker = getExtractionWorker();

  // Database stats
  let dbStats = null;
  if (db) {
    try {
      dbStats = {
        documents: db.prepare('SELECT COUNT(*) as count FROM rte_documents').get().count,
        tags: db.prepare('SELECT COUNT(*) as count FROM document_tags').get().count,
        rtes: db.prepare('SELECT COUNT(*) as count FROM rtes').get().count
      };
    } catch (e) {
      dbStats = { error: e.message };
    }
  }

  // Ollama status
  let ollamaStatus = null;
  try {
    const response = await fetch(`${OLLAMA_HOST}/api/tags`);
    if (response.ok) {
      const data = await response.json();
      ollamaStatus = {
        available: true,
        modelCount: (data.models || []).length
      };
    } else {
      ollamaStatus = { available: false };
    }
  } catch (e) {
    ollamaStatus = { available: false, error: e.message };
  }

  res.json({
    database: dbStats,
    ollama: ollamaStatus,
    extraction: {
      running: worker.isRunning,
      stats: worker.getStats()
    }
  });
});

module.exports = router;
