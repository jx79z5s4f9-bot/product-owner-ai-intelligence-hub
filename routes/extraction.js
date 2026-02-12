/**
 * Extraction Routes
 * Manual triggers and status endpoints for extraction service
 */

const express = require('express');
const router = express.Router();
const { getInstance: getExtractionWorker } = require('../services/extraction-worker');
const { getDb } = require('../db/connection');

/**
 * GET /api/extraction/status
 * Get extraction queue statistics
 */
router.get('/status', (req, res) => {
  const worker = getExtractionWorker();
  const stats = worker.getStats();
  
  if (!stats) {
    return res.status(500).json({ error: 'Could not get stats' });
  }
  
  res.json({
    queue: stats,
    workerRunning: worker.isRunning
  });
});

/**
 * GET /api/extraction/queue
 * Get items in the extraction queue
 */
router.get('/queue', (req, res) => {
  const db = getDb();
  if (!db) {
    return res.status(500).json({ error: 'Database not available' });
  }

  const { status = 'all', limit = 50 } = req.query;

  try {
    let query = `
      SELECT eq.*, rd.filename, rd.word_count
      FROM extraction_queue eq
      JOIN rte_documents rd ON eq.document_id = rd.id
    `;
    
    if (status !== 'all') {
      query += ` WHERE eq.status = ?`;
    }
    
    query += ` ORDER BY eq.created_at DESC LIMIT ?`;
    
    const items = status !== 'all'
      ? db.prepare(query).all(status, parseInt(limit))
      : db.prepare(query).all(parseInt(limit));
    
    res.json({ items, count: items.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/extraction/retry-failed
 * Retry all failed extraction items
 */
router.post('/retry-failed', (req, res) => {
  const worker = getExtractionWorker();
  const result = worker.retryFailed();
  
  res.json({
    success: true,
    message: `${result.count} failed items queued for retry`
  });
});

/**
 * POST /api/extraction/retry-dead
 * Retry dead-letter items (after manual review)
 */
router.post('/retry-dead', (req, res) => {
  const worker = getExtractionWorker();
  const result = worker.retryDead();
  
  res.json({
    success: true,
    message: `${result.count} dead-letter items queued for retry`
  });
});

/**
 * POST /api/extraction/document/:id
 * Manually trigger extraction for a specific document
 * Query param: ?clear=true to clear existing tags first (re-extract)
 */
router.post('/document/:id', async (req, res) => {
  const { id } = req.params;
  const clearFirst = req.query.clear === 'true' || req.body.clear === true;
  const worker = getExtractionWorker();
  
  try {
    const result = await worker.extractDocument(parseInt(id), clearFirst);
    
    if (result.success) {
      res.json({
        success: true,
        documentId: parseInt(id),
        entities: result.entities,
        model: result.model,
        reExtracted: clearFirst
      });
    } else {
      res.status(400).json({
        success: false,
        error: result.error
      });
    }
  } catch (err) {
    res.status(500).json({
      success: false,
      error: err.message
    });
  }
});

/**
 * POST /api/extraction/start
 * Start the background worker
 */
router.post('/start', (req, res) => {
  const worker = getExtractionWorker();
  worker.start();
  
  res.json({
    success: true,
    message: 'Extraction worker started'
  });
});

/**
 * POST /api/extraction/stop
 * Stop the background worker
 */
router.post('/stop', (req, res) => {
  const worker = getExtractionWorker();
  worker.stop();
  
  res.json({
    success: true,
    message: 'Extraction worker stopped'
  });
});

/**
 * POST /api/extraction/process-now
 * Trigger immediate queue processing (for testing)
 */
router.post('/process-now', async (req, res) => {
  const worker = getExtractionWorker();
  
  try {
    await worker.processQueue();
    const stats = worker.getStats();
    
    res.json({
      success: true,
      message: 'Queue processed',
      stats
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      error: err.message
    });
  }
});

/**
 * POST /api/extraction/backfill-relationships
 * Re-process all existing documents for relationship extraction.
 * Use this after upgrading to relationship-aware extraction worker.
 */
router.post('/backfill-relationships', async (req, res) => {
  const worker = getExtractionWorker();
  
  try {
    const result = await worker.extractRelationshipsForAll();
    
    res.json({
      success: true,
      message: `Backfill complete: ${result.processed} documents processed, ${result.suggestions} suggestions created`,
      ...result
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      error: err.message
    });
  }
});

module.exports = router;
