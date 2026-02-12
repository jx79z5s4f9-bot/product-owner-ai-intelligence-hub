/**
 * PO AI Command Center - Minimal Rebuild
 * Gym-tracker style card deck UI
 */

const express = require('express');
const path = require('path');
const { initDb, getDb } = require('./db/connection');
const { getInstance: getSqliteVectorSearch } = require('./services/sqlite-vector-search');
const { getInstance: getLLMManager } = require('./services/llm-manager');

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// View engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Initialize database
initDb();

// Routes
const promptRoutes = require('./routes/prompt');
const translateRoutes = require('./routes/translate');
const rteRoutes = require('./routes/rte');
const navigatorRoutes = require('./routes/navigator');
const glossaryRoutes = require('./routes/glossary');
const searchRoutes = require('./routes/search');
const maintenanceRoutes = require('./routes/maintenance');
const debriefRoutes = require('./routes/debrief');
const ingestRoutes = require('./routes/ingest');
const extractionRoutes = require('./routes/extraction');
const askRoutes = require('./routes/ask');
const trendRoutes = require('./routes/trend');
const settingsRoutes = require('./routes/settings');
const tagsRoutes = require('./routes/tags');
const analyzeRoutes = require('./routes/analyze');
const registerRoutes = require('./routes/register');
const standupRoutes = require('./routes/standup');
const stakeholderRoutes = require('./routes/stakeholder');

app.use('/api/prompt', promptRoutes);
app.use('/api/translate', translateRoutes);
app.use('/api/rte', rteRoutes);
app.use('/api/navigator', navigatorRoutes);
app.use('/api/glossary', glossaryRoutes);
app.use('/api/search', searchRoutes);
app.use('/api/maintenance', maintenanceRoutes);
app.use('/api/debriefs', debriefRoutes);
app.use('/api/ingest', ingestRoutes);
app.use('/api/extraction', extractionRoutes);
app.use('/api/ask', askRoutes);
app.use('/api/trend', trendRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/tags', tagsRoutes);
app.use('/api/analyze', analyzeRoutes);
app.use('/api/register', registerRoutes);
app.use('/api/standup', standupRoutes);
app.use('/api/stakeholders', stakeholderRoutes);

// Global RTE list endpoint for the selector
app.get('/api/rtes', (req, res) => {
  const db = getDb();
  try {
    const rtes = db.prepare(`SELECT id, name FROM rtes WHERE status != 'system' ORDER BY name`).all();
    
    // Read default RTE from settings table, fallback to first RTE
    let defaultRteId = rtes[0]?.id || 1;
    try {
      const setting = db.prepare(`SELECT value FROM settings WHERE key = 'default_rte_id'`).get();
      if (setting) defaultRteId = parseInt(setting.value);
    } catch (e) { /* settings table may not exist */ }
    
    res.json({ 
      rtes: rtes.map(r => ({ ...r, isDefault: r.id === defaultRteId })),
      defaultRteId 
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Set default RTE
app.post('/api/rtes/default', (req, res) => {
  const db = getDb();
  const { rteId } = req.body;
  try {
    if (rteId) {
      db.prepare(`INSERT OR REPLACE INTO settings (key, value) VALUES ('default_rte_id', ?)`).run(String(rteId));
    } else {
      db.prepare(`DELETE FROM settings WHERE key = 'default_rte_id'`).run();
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Main page - Intelligence Hub (new home)
app.get('/', (req, res) => {
  res.render('home');
});

// Legacy Orchestrator (moved from home)
app.get('/orchestrator', (req, res) => {
  res.render('command-center');
});

// Navigator page - Browse files by RTE (merged with MD Files)
app.get('/navigator', (req, res) => {
  res.render('navigator');
});

// Tags page - Tag Manager (replaces Glossary)
app.get('/tags', (req, res) => {
  res.render('tags');
});

// Glossary page - Legacy, redirects to Tags
app.get('/glossary', (req, res) => {
  res.redirect('/tags');
});

// Network page - Relationship visualization
app.get('/network', (req, res) => {
  res.render('network');
});

// Search page - Unified search
app.get('/search', (req, res) => {
  res.render('search');
});

// Ingest page - v2 Intelligence System
app.get('/ingest', (req, res) => {
  res.render('ingest');
});

// Ask page - Q&A with evidence
app.get('/ask', (req, res) => {
  res.render('ask');
});

// Trend page - Timeline analysis
app.get('/trend', (req, res) => {
  res.render('trend');
});

// Register page - Risk & Action Register
app.get('/register', (req, res) => {
  res.render('register');
});

// Standup page - Quick daily standup
app.get('/standup', (req, res) => {
  res.render('standup');
});

// Stakeholders list page
app.get('/stakeholders', (req, res) => {
  res.render('stakeholders');
});

// Stakeholder profile page
app.get('/stakeholder/:id', (req, res) => {
  res.render('stakeholder');
});

// Analyze page - Deep document analysis
app.get('/analyze', (req, res) => {
  res.render('analyze');
});

// Suggestions inbox - Relationship simmering
app.get('/suggestions', (req, res) => {
  const db = getDb();
  const rtes = db.prepare(`SELECT id, name FROM rtes ORDER BY name`).all();
  
  // Get default RTE - try settings table, fallback to first RTE
  let currentRteId = rtes[0]?.id || 1;
  try {
    const defaultRteSetting = db.prepare(`SELECT value FROM settings WHERE key = 'default_rte_id'`).get();
    if (defaultRteSetting) {
      currentRteId = parseInt(defaultRteSetting.value);
    }
  } catch (e) {
    // Settings table may not exist - use first RTE
  }
  
  res.render('suggestions', { rtes, currentRteId });
});

// Settings page - LLM config, tags, extraction
app.get('/settings', (req, res) => {
  res.render('settings');
});

// Translate page - Dutch/English translation
app.get('/translate', (req, res) => {
  res.render('translate');
});

// Maintenance page - System status
app.get('/maintenance', (req, res) => {
  res.render('maintenance');
});

// Initialize services
(async () => {
  try {
    // Initialize LLM Manager
    const llmManager = getLLMManager();
    console.log('[LLM] Manager initialized');

    // Initialize SQLite Vector Search (embedded, no server needed)
    const vectorSearch = getSqliteVectorSearch();
    await vectorSearch.init();
    console.log('[VectorSearch] SQLite FTS5 ready');
  } catch (error) {
    console.error('[Init] Service initialization failed:', error.message);
  }

  // Initialize backup service (Phase 2)
  try {
    const backupService = require('./services/backup-service');
    backupService.init('0 0 * * *');  // Daily at midnight
    console.log('[Backup] Service initialized');
  } catch (error) {
    console.error('[Backup] Service initialization failed:', error.message);
  }

  // Initialize extraction worker (Intelligence System v2)
  try {
    const { getInstance: getExtractionWorker } = require('./services/extraction-worker');
    const extractionWorker = getExtractionWorker();
    extractionWorker.start();
    console.log('[Extraction] Worker started (polling every 10s)');
  } catch (error) {
    console.error('[Extraction] Worker initialization failed:', error.message);
  }
})();

// Start server
app.listen(PORT, () => {
  console.log(`
╔════════════════════════════════════════════════════╗
║  🎯 PO AI Command Center                           ║
║  Running at http://localhost:${PORT}                  ║
╚════════════════════════════════════════════════════╝
  `);
});
