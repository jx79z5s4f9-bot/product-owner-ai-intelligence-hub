/**
 * Ingest Routes - v2 Intelligence System
 * 
 * POST /api/ingest - Save raw content with metadata and tags
 * POST /api/ingest/parse-file - Parse uploaded file for template fields
 * GET /api/tags/semantic - Get semantic tags
 * GET /api/tags/projects - Search project tags (autocomplete)
 * GET /api/tags/people - Search person tags (autocomplete)
 */

const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const os = require('os');
const multer = require('multer');
const mammoth = require('mammoth');
const { execSync } = require('child_process');
const { getDb } = require('../db/connection');

const WORKSPACE_ROOT = path.join(os.homedir(), 'ProductOwnerAI');

// Configure multer for file uploads
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
  fileFilter: (req, file, cb) => {
    const allowedExtensions = ['.docx', '.md', '.txt', '.markdown', '.pages'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowedExtensions.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Allowed: .docx, .md, .txt, .markdown, .pages'));
    }
  }
});

// =====================================================
// HELPER FUNCTIONS
// =====================================================

/**
 * Generate a slug from content/title
 */
function generateSlug(text, maxLength = 30) {
  if (!text) return 'untitled';
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .substring(0, maxLength);
}

/**
 * Extract date from content (tries multiple patterns)
 */
function extractDateFromContent(content) {
  // Pattern: 2026-02-03
  const isoMatch = content.match(/\b(\d{4}-\d{2}-\d{2})\b/);
  if (isoMatch) return isoMatch[1];

  // Pattern: February 3, 2026 or 3 February 2026
  const dateMatch = content.match(/\b(\d{1,2})\s+(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{4})\b/i);
  if (dateMatch) {
    const months = {
      january: '01', february: '02', march: '03', april: '04', may: '05', june: '06',
      july: '07', august: '08', september: '09', october: '10', november: '11', december: '12'
    };
    const day = dateMatch[1].padStart(2, '0');
    const month = months[dateMatch[2].toLowerCase()];
    const year = dateMatch[3];
    return `${year}-${month}-${day}`;
  }

  // Return today if no date found
  return new Date().toISOString().split('T')[0];
}

/**
 * Count words in content
 */
function countWords(content) {
  return content.trim().split(/\s+/).filter(w => w.length > 0).length;
}

/**
 * Ensure RTE directory exists
 */
function ensureRteDirectory(rteName, contentType) {
  const rteRoot = path.join(WORKSPACE_ROOT, 'rte', rteName.toLowerCase());
  
  const pathMap = {
    log: 'logs/daily',
    meeting: 'logs/meetings',
    artifact: 'artifacts/generated',
    idea: 'artifacts/ideas'
  };
  
  const relativePath = pathMap[contentType] || 'logs/daily';
  const fullPath = path.join(rteRoot, relativePath);
  
  if (!fs.existsSync(fullPath)) {
    fs.mkdirSync(fullPath, { recursive: true });
    console.log(`[Ingest] Created directory: ${fullPath}`);
  }
  
  return { rteRoot, relativePath, fullPath };
}

/**
 * Get RTE by ID
 */
function getRte(db, rteId) {
  return db.prepare('SELECT * FROM rtes WHERE id = ?').get(rteId);
}

// =====================================================
// INGEST ENDPOINT
// =====================================================

/**
 * Extract semantic markers from content using keyword: syntax
 * Supports both single-line and multi-line blocks (ended with //)
 * 
 * Single-line: "insight: DNA-C complements Leonardo"
 * Multi-line:  "insight: DNA-C complements Leonardo
 *               because it provides better tooling
 *               //"
 * 
 * @param {string} content - The document content
 * @param {object} db - Database connection
 * @returns {Array<{keyword: string, content: string}>} Extracted markers
 */
function extractSemanticMarkers(content, db) {
  const markers = [];
  
  // Get valid keywords from semantic_tags table
  let validKeywords = [];
  try {
    const tags = db.prepare('SELECT name FROM semantic_tags WHERE is_active = 1').all();
    validKeywords = tags.map(t => t.name.toLowerCase());
  } catch (e) {
    // Fallback to common keywords if table not available
    validKeywords = ['insight', 'action', 'question', 'decision', 'strategic', 'priority', 'risk', 'blocker', 'observation', 'promise', 'requirement', 'nfr'];
  }
  
  if (validKeywords.length === 0) {
    return markers;
  }
  
  const keywordPattern = validKeywords.join('|');
  
  // First pass: Extract multi-line blocks (keyword: ... //)
  // Allow optional list markers (-, *, •) and whitespace at the start
  const multiLineRegex = new RegExp(`^[-*•]?[ \\t]*(${keywordPattern}):[ \\t]*([\\s\\S]*?)^[-*•]?[ \\t]*//[ \\t]*$`, 'gim');
  
  let match;
  const processedRanges = []; // Track what we've already extracted
  
  while ((match = multiLineRegex.exec(content)) !== null) {
    const keyword = match[1].toLowerCase();
    const markerContent = match[2].trim();
    
    markers.push({
      keyword,
      content: markerContent || null
    });
    
    // Track the range so we don't double-extract in single-line pass
    processedRanges.push({ start: match.index, end: match.index + match[0].length });
  }
  
  // Second pass: Extract single-line markers (keyword: content // OR keyword: content$)
  // Only if they weren't part of a multi-line block
  // Allow optional list markers (-, *, •) and whitespace at the start
  // Content ends at // or end of line
  const singleLineRegex = new RegExp(`^[-*•]?[ \\t]*(${keywordPattern}):[ \\t]*(.+?)(?:[ \\t]*//|$)`, 'gim');
  
  while ((match = singleLineRegex.exec(content)) !== null) {
    // Check if this match is inside a processed multi-line range
    const isInsideMultiLine = processedRanges.some(
      range => match.index >= range.start && match.index < range.end
    );
    
    if (!isInsideMultiLine) {
      const keyword = match[1].toLowerCase();
      const markerContent = match[2].trim();
      
      markers.push({
        keyword,
        content: markerContent || null
      });
    }
  }
  
  return markers;
}

/**
 * POST /api/ingest
 * Save raw content with metadata and tags
 */
router.post('/', (req, res) => {
  const db = getDb();
  if (!db) {
    return res.status(500).json({ error: 'Database not available' });
  }

  const {
    content,
    rteId,
    contentType = 'log',
    date,
    title,
    semanticTags = [],
    projectTags = [],
    personTags = []
  } = req.body;

  // Validation
  if (!content || content.trim().length === 0) {
    return res.status(400).json({ error: 'Content is required' });
  }

  if (!rteId) {
    return res.status(400).json({ error: 'RTE ID is required' });
  }

  try {
    // Get RTE
    const rte = getRte(db, rteId);
    if (!rte) {
      return res.status(404).json({ error: 'RTE not found' });
    }

    // Get content type
    const contentTypeRow = db.prepare('SELECT * FROM content_types WHERE name = ?').get(contentType);
    if (!contentTypeRow) {
      return res.status(400).json({ error: `Invalid content type: ${contentType}` });
    }

    // Extract or use provided date
    const documentDate = date || extractDateFromContent(content);
    
    // Generate filename
    const time = new Date().toISOString().split('T')[1].substring(0, 5).replace(':', '');
    const slug = generateSlug(title || content);
    const filename = `${documentDate}-${time}-${slug}.md`;
    
    // Ensure directory exists
    const { relativePath, fullPath } = ensureRteDirectory(rte.name, contentType);
    const filepath = path.join(fullPath, filename);
    
    // Build file content with frontmatter
    const frontmatter = `---
date: ${documentDate}
type: ${contentType}
rte: ${rte.name}
tags: [${semanticTags.join(', ')}]
projects: [${projectTags.join(', ')}]
people: [${personTags.join(', ')}]
created: ${new Date().toISOString()}
---

`;
    
    const fileTitle = title || `${contentType.charAt(0).toUpperCase() + contentType.slice(1)} - ${documentDate}`;
    const fullContent = `${frontmatter}# ${fileTitle}\n\n${content}`;
    
    // Write file to disk
    fs.writeFileSync(filepath, fullContent, 'utf-8');
    console.log(`[Ingest] Saved file: ${filepath}`);
    
    // Insert into rte_documents
    const insertDoc = db.prepare(`
      INSERT INTO rte_documents (
        rte_id, filename, filepath, file_type, category, title,
        content_type_id, raw_content, word_count, extraction_status, document_date
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)
    `);
    
    const result = insertDoc.run(
      rteId,
      filename,
      filepath,
      contentType,
      relativePath,
      fileTitle,
      contentTypeRow.id,
      content,
      countWords(content),
      documentDate
    );
    
    const documentId = result.lastInsertRowid;
    
    // Insert semantic tags using tag_type/tag_value schema
    const insertDocTag = db.prepare(`
      INSERT INTO document_tags (document_id, tag_type, tag_value) VALUES (?, ?, ?)
    `);
    
    // Prepare semantic markers insert
    const insertMarker = db.prepare(`
      INSERT INTO semantic_markers (document_id, rte_id, marker_type, marker_content)
      VALUES (?, ?, ?, ?)
    `);
    
    // 1. Insert manually selected semantic tags (from UI)
    for (const tagName of semanticTags) {
      try {
        insertDocTag.run(documentId, 'semantic', tagName);
      } catch (e) {
        // Ignore duplicate
      }
    }
    
    // 2. Extract markers from content
    const extractedMarkers = extractSemanticMarkers(content, db);
    for (const marker of extractedMarkers) {
      try {
        // Store just the keyword in document_tags (for filtering)
        insertDocTag.run(documentId, 'semantic', marker.keyword);
      } catch (e) {
        // Ignore duplicate
      }
      
      try {
        // Store full marker in semantic_markers table (for browsing)
        insertMarker.run(documentId, rteId, marker.keyword, marker.content || null);
      } catch (e) {
        console.log('[Ingest] Failed to insert marker:', e.message);
      }
    }
    
    console.log(`[Ingest] Extracted ${extractedMarkers.length} semantic markers from content`);
    
    // Insert project tags
    for (const projectName of projectTags) {
      try {
        insertDocTag.run(documentId, 'project', projectName);
      } catch (e) {
        // Ignore duplicate
      }
    }
    
    // Insert person tags
    for (const personName of personTags) {
      try {
        insertDocTag.run(documentId, 'person', personName);
      } catch (e) {
        // Ignore duplicate
      }
    }
    
    // Also update usage counts in project_tags and person_tags
    const upsertProjectTag = db.prepare(`
      INSERT INTO project_tags (rte_id, name, usage_count)
      VALUES (?, ?, 1)
      ON CONFLICT(rte_id, name) DO UPDATE SET usage_count = usage_count + 1
    `);
    
    for (const projectName of projectTags) {
      upsertProjectTag.run(rteId, projectName);
    }
    
    const upsertPersonTag = db.prepare(`
      INSERT INTO person_tags (rte_id, name, usage_count)
      VALUES (?, ?, 1)
      ON CONFLICT(rte_id, name) DO UPDATE SET usage_count = usage_count + 1
    `);
    
    for (const personName of personTags) {
      upsertPersonTag.run(rteId, personName);
    }
    
    // Add to extraction queue for background processing
    const insertQueue = db.prepare(`
      INSERT INTO extraction_queue (document_id, status)
      VALUES (?, 'pending')
    `);
    
    insertQueue.run(documentId);
    
    // Index in FTS5 if available
    try {
      const sqliteVectorSearch = require('../services/sqlite-vector-search');
      const instance = sqliteVectorSearch.getInstance ? sqliteVectorSearch.getInstance() : sqliteVectorSearch;
      if (instance && instance.isReady) {
        instance.indexDocument({
          filepath,
          content: fullContent,
          title: fileTitle,
          mode: contentType,
          rteName: rte.name,
          rteId: rteId
        });
      }
    } catch (e) {
      console.log('[Ingest] FTS indexing skipped:', e.message);
    }
    
    // Return success response
    res.json({
      success: true,
      documentId: Number(documentId),
      filename,
      filepath,
      date: documentDate,
      wordCount: countWords(content),
      tags: {
        semantic: semanticTags,
        projects: projectTags,
        people: personTags
      },
      extraction: {
        status: 'queued',
        message: 'Entity extraction will run in background'
      }
    });
    
  } catch (err) {
    console.error('[Ingest] Error:', err);
    res.status(500).json({ error: err.message });
  }
});

// =====================================================
// TAG ENDPOINTS
// =====================================================

/**
 * GET /api/tags/semantic
 * Get all semantic tags
 */
router.get('/tags/semantic', (req, res) => {
  const db = getDb();
  if (!db) {
    return res.status(500).json({ error: 'Database not available' });
  }

  try {
    const tags = db.prepare(`
      SELECT id, name, name as slug, color, '🏷️' as icon, description 
      FROM semantic_tags 
      WHERE is_active = 1 
      ORDER BY sort_order
    `).all();
    
    res.json({ tags });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/tags/projects
 * Search project tags for autocomplete
 */
router.get('/tags/projects', (req, res) => {
  const db = getDb();
  if (!db) {
    return res.status(500).json({ error: 'Database not available' });
  }

  const { q = '', rteId } = req.query;

  try {
    let query = `
      SELECT id, name, usage_count 
      FROM project_tags 
      WHERE name LIKE ?
    `;
    const params = [`%${q}%`];
    
    if (rteId) {
      query += ' AND rte_id = ?';
      params.push(rteId);
    }
    
    query += ' ORDER BY usage_count DESC, name LIMIT 20';
    
    const tags = db.prepare(query).all(...params);
    res.json({ tags });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/tags/people
 * Search person tags for autocomplete
 */
router.get('/tags/people', (req, res) => {
  const db = getDb();
  if (!db) {
    return res.status(500).json({ error: 'Database not available' });
  }

  const { q = '', rteId } = req.query;

  try {
    let query = `
      SELECT id, name, usage_count 
      FROM person_tags 
      WHERE name LIKE ?
    `;
    const params = [`%${q}%`];
    
    if (rteId) {
      query += ' AND rte_id = ?';
      params.push(rteId);
    }
    
    query += ' ORDER BY usage_count DESC, name LIMIT 20';
    
    const tags = db.prepare(query).all(...params);
    res.json({ tags });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/tags/content-types
 * Get all content types
 */
router.get('/tags/content-types', (req, res) => {
  const db = getDb();
  if (!db) {
    return res.status(500).json({ error: 'Database not available' });
  }

  try {
    const types = db.prepare(`
      SELECT id, name, name as slug, icon, description 
      FROM content_types 
      WHERE is_active = 1
      ORDER BY sort_order
    `).all();
    
    res.json({ types });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// =====================================================
// FILE PARSING - Enhanced Ingest
// =====================================================

/**
 * Parse template fields from document content
 * Expected template format:
 *   Line 1: Date (e.g. "Wednesday, 12 February 2026" or "2026-02-12")
 *   Line 2: Title
 *   Line 3: Document type: meeting
 *   Line 4: Participants: Alice, Bob, Charlie
 *   Line 5: Tags: #architecture, #sprint-5
 *   Line 6+: Content (unstructured)
 *
 * Brackets around values are optional: "Participants: [Alice, Bob]" also works.
 */
function parseTemplateFields(text) {
  // Strip template hint comments (← ...) before parsing
  // These are generated by the template maker to show valid values
  text = text.replace(/\s*←[^\n]*/g, '');

  const lines = text.split('\n').map(l => l.trim()).filter(l => l);
  
  const result = {
    date: null,
    title: null,
    docType: null,
    participants: [],
    tags: [],
    content: ''
  };
  
  let contentStartIndex = 0;
  
  // First, try to extract fields from anywhere in the text (handles concatenated lines)
  // This runs on the full text to catch fields that might be on the same line
  const fullText = text;
  
  // Document type: can appear anywhere - extract and remember position
  const docTypeMatch = fullText.match(/document\s*type:\s*\[?([^\]\n]+?)\]?(?=\s*(?:participants?:|tags?:|$|\n))/i);
  if (docTypeMatch) {
    result.docType = docTypeMatch[1].trim().replace(/[\[\]]/g, '');
  }
  
  // Participants: can appear anywhere
  const participantsMatch = fullText.match(/participants?:\s*\[?([^\]\n]+?)\]?(?=\s*(?:document\s*type:|tags?:|$|\n))/i);
  if (participantsMatch) {
    result.participants = participantsMatch[1]
      .split(/[,;]/)
      .map(p => p.trim().replace(/[\[\]@]/g, '')) // Remove brackets and @ symbols
      .filter(p => p && p.length > 0);
  }
  
  // Tags: can appear anywhere
  const tagsMatch = fullText.match(/tags?:\s*\[?([^\]\n]+?)\]?(?=\s*(?:document\s*type:|participants?:|$|\n))/i);
  if (tagsMatch) {
    // Extract hashtags from the match
    const tagContent = tagsMatch[1];
    result.tags = tagContent
      .split(/[,;\s]+/)
      .map(t => t.trim().replace(/[\[\]]/g, ''))
      .filter(t => t.length > 0)
      .map(t => t.startsWith('#') ? t : '#' + t); // Ensure # prefix
  }
  
  // Line 1: Try to parse date
  if (lines.length > 0) {
    const dateLine = lines[0];
    // Try various date formats
    // "Saturday, 7 February 2026" or "7 February 2026" or "2026-02-07"
    const datePatterns = [
      // Full day name format: "Saturday, 7 February 2026"
      /(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday),?\s*(\d{1,2})\s+(january|february|march|april|may|june|july|august|september|october|november|december)\s+(\d{4})/i,
      // Short format: "7 February 2026"
      /(\d{1,2})\s+(january|february|march|april|may|june|july|august|september|october|november|december)\s+(\d{4})/i,
      // ISO format: "2026-02-07"
      /(\d{4})-(\d{2})-(\d{2})/
    ];
    
    for (const pattern of datePatterns) {
      const match = dateLine.match(pattern);
      if (match) {
        if (match[0].includes('-')) {
          // ISO format
          result.date = match[0];
        } else {
          // Convert month name to number
          const months = {
            january: '01', february: '02', march: '03', april: '04',
            may: '05', june: '06', july: '07', august: '08',
            september: '09', october: '10', november: '11', december: '12'
          };
          const day = match[1].padStart(2, '0');
          const month = months[match[2].toLowerCase()];
          const year = match[3];
          result.date = `${year}-${month}-${day}`;
        }
        contentStartIndex = 1;
        break;
      }
    }
  }
  
  // Line 2: Title (next non-empty line after date, if not a template field line)
  if (lines.length > contentStartIndex) {
    const titleLine = lines[contentStartIndex];
    // Check if it's NOT a template field line (doesn't start with or contain template keywords)
    if (!titleLine.match(/^(document type|participants|tags):/i) && 
        !titleLine.match(/document\s*type:/i)) {
      result.title = titleLine;
      contentStartIndex++;
    }
  }
  
  // Find where actual content starts - skip lines that contain template fields
  for (let i = contentStartIndex; i < lines.length; i++) {
    const line = lines[i];
    // If line contains template field patterns, skip it
    if (line.match(/document\s*type:/i) || 
        line.match(/participants?:/i) || 
        line.match(/tags?:/i)) {
      contentStartIndex = i + 1;
    } else {
      // Found a line without template fields - this is where content starts
      break;
    }
  }
  
  // Everything else is content
  result.content = lines.slice(contentStartIndex).join('\n');
  
  return result;
}

/**
 * POST /api/ingest/parse-file
 * Parse an uploaded file and extract template fields
 */
router.post('/parse-file', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }
    
    const ext = path.extname(req.file.originalname).toLowerCase();
    let textContent = '';
    
    // Extract text based on file type
    if (ext === '.pages') {
      // .pages conversion requires macOS + Pages app
      if (process.platform !== 'darwin') {
        return res.status(400).json({
          error: '.pages files can only be converted on macOS. Please export to .docx or .txt from Pages first.'
        });
      }
      // Use AppleScript to have Pages export to plain text
      const tempDir = os.tmpdir();
      const tempPagesFile = path.join(tempDir, `upload-${Date.now()}.pages`);
      const tempTxtFile = path.join(tempDir, `upload-${Date.now()}.txt`);
      
      try {
        // Write the uploaded buffer to a temp file
        fs.writeFileSync(tempPagesFile, req.file.buffer);
        
        // Use AppleScript to convert via Pages app
        const appleScript = `
          set pagesFile to POSIX file "${tempPagesFile}"
          set txtFile to POSIX file "${tempTxtFile}"
          
          tell application "Pages"
            set wasRunning to running
            activate
            
            set theDoc to open pagesFile
            delay 0.5
            
            export theDoc to txtFile as unformatted text
            close theDoc saving no
            
            if not wasRunning then
              quit
            end if
          end tell
        `;
        
        execSync(`osascript -e '${appleScript.replace(/'/g, "'\"'\"'")}'`, {
          timeout: 60000 // 60 second timeout for Pages to open
        });
        
        // Read the converted text
        textContent = fs.readFileSync(tempTxtFile, 'utf-8');
        
        // Cleanup temp files
        fs.unlinkSync(tempPagesFile);
        fs.unlinkSync(tempTxtFile);
        
        console.log(`[Ingest] Converted .pages file using Pages app`);
      } catch (convErr) {
        // Cleanup on error
        try { fs.unlinkSync(tempPagesFile); } catch (e) {}
        try { fs.unlinkSync(tempTxtFile); } catch (e) {}
        throw new Error(`Failed to convert .pages file. Please export to .docx or .txt from Pages first. (${convErr.message})`);
      }
    } else if (ext === '.docx') {
      // Use mammoth for Word documents
      const result = await mammoth.extractRawText({ buffer: req.file.buffer });
      textContent = result.value;
    } else {
      // Plain text files (.md, .txt, .markdown)
      textContent = req.file.buffer.toString('utf-8');
    }
    
    // Parse template fields
    const parsed = parseTemplateFields(textContent);
    
    // Add original filename for reference
    parsed.originalFilename = req.file.originalname;
    
    console.log(`[Ingest] Parsed file: ${req.file.originalname}`);
    console.log(`[Ingest] Extracted: date=${parsed.date}, title=${parsed.title}, docType=${parsed.docType}`);
    console.log(`[Ingest] Participants: ${parsed.participants.join(', ')}`);
    console.log(`[Ingest] Tags: ${parsed.tags.join(', ')}`);
    
    res.json(parsed);
    
  } catch (err) {
    console.error('[Ingest] Parse error:', err);
    res.status(500).json({ error: err.message });
  }
});

// =====================================================
// IMPORT TODAY — Batch scan incoming folder
// =====================================================

/**
 * Get the incoming folder path from DB settings, env var, or OS-specific default.
 * Configurable via Settings > Preferences in the UI.
 */
function getIncomingFolder() {
  try {
    const db = getDb();
    if (db) {
      const row = db.prepare("SELECT value FROM settings WHERE key = 'incoming_folder'").get();
      if (row && row.value) {
        // Expand ~ to home directory
        return row.value.replace(/^~/, os.homedir());
      }
    }
  } catch (e) { /* settings table may not exist yet */ }

  // Env var fallback
  if (process.env.INCOMING_FOLDER) {
    return process.env.INCOMING_FOLDER.replace(/^~/, os.homedir());
  }

  // OS-specific default
  if (process.platform === 'darwin') {
    return path.join(os.homedir(), 'Documents');
  } else if (process.platform === 'win32') {
    return path.join(os.homedir(), 'Documents');
  } else {
    return path.join(os.homedir(), 'Documents');
  }
}

/**
 * GET /api/ingest/scan-incoming
 * Scan ~/Documents (local)/ root for .pages files ready to import
 */
router.get('/scan-incoming', (req, res) => {
  const INCOMING_FOLDER = getIncomingFolder();
  try {
    if (!fs.existsSync(INCOMING_FOLDER)) {
      return res.json({ files: [], folder: INCOMING_FOLDER, error: `Incoming folder not found: ${INCOMING_FOLDER}. Configure it in Settings > Preferences.` });
    }

    const entries = fs.readdirSync(INCOMING_FOLDER, { withFileTypes: true });
    // Accept common document formats, not just .pages
    const importExtensions = ['.pages', '.md', '.txt', '.docx', '.markdown'];
    const files = entries
      .filter(e => e.isFile() && importExtensions.some(ext => e.name.toLowerCase().endsWith(ext)) && !e.name.startsWith('.'))
      .map(e => {
        const fullPath = path.join(INCOMING_FOLDER, e.name);
        const stats = fs.statSync(fullPath);
        return {
          name: e.name,
          path: fullPath,
          size: stats.size,
          modified: stats.mtime.toISOString()
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name));

    res.json({ files, folder: INCOMING_FOLDER });
  } catch (err) {
    console.error('[Ingest] Scan incoming error:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/ingest/parse-local-file
 * Parse a .pages file from disk (by path) — same as parse-file but reads from local path
 */
router.post('/parse-local-file', async (req, res) => {
  try {
    const INCOMING_FOLDER = getIncomingFolder();
    const { filePath: localPath } = req.body;
    if (!localPath || !path.resolve(localPath).startsWith(path.resolve(INCOMING_FOLDER))) {
      return res.status(400).json({ error: 'Invalid file path — not inside the configured incoming folder' });
    }

    if (!fs.existsSync(localPath)) {
      return res.status(404).json({ error: 'File not found' });
    }

    const ext = path.extname(localPath).toLowerCase();
    let textContent = '';

    if (ext === '.pages') {
      if (process.platform !== 'darwin') {
        return res.status(400).json({ error: '.pages files can only be converted on macOS' });
      }

      // Sanitize path to prevent AppleScript injection via double-quote characters
      if (/["\\`$]/.test(localPath)) {
        return res.status(400).json({ error: 'File path contains unsupported characters' });
      }

      const tempTxtFile = path.join(os.tmpdir(), `import-${Date.now()}.txt`);
      try {
        const appleScript = `
          set pagesFile to POSIX file "${localPath}"
          set txtFile to POSIX file "${tempTxtFile}"
          tell application "Pages"
            set wasRunning to running
            activate
            set theDoc to open pagesFile
            delay 0.5
            export theDoc to txtFile as unformatted text
            close theDoc saving no
            if not wasRunning then quit
          end tell
        `;
        execSync(`osascript -e '${appleScript.replace(/'/g, "'\"'\"'")}'`, { timeout: 60000 });
        textContent = fs.readFileSync(tempTxtFile, 'utf-8');
        fs.unlinkSync(tempTxtFile);
      } catch (convErr) {
        try { fs.unlinkSync(tempTxtFile); } catch (e) {}
        throw new Error(`Failed to convert .pages file: ${convErr.message}`);
      }
    } else {
      textContent = fs.readFileSync(localPath, 'utf-8');
    }

    const parsed = parseTemplateFields(textContent);
    parsed.originalFilename = path.basename(localPath);
    parsed.sourcePath = localPath;

    console.log(`[Import] Parsed local file: ${parsed.originalFilename} → type=${parsed.docType}, date=${parsed.date}`);
    res.json(parsed);
  } catch (err) {
    console.error('[Import] Parse local file error:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/ingest/archive-source
 * Move a .pages source file to the correct subfolder after successful ingest
 */
router.post('/archive-source', (req, res) => {
  try {
    const { sourcePath, contentType } = req.body;

    const INCOMING_FOLDER = getIncomingFolder();
    console.log(`[Archive] Request: sourcePath=${sourcePath}, contentType=${contentType}, INCOMING_FOLDER=${INCOMING_FOLDER}`);

    if (!sourcePath) {
      return res.status(400).json({ error: 'Missing sourcePath in request body' });
    }

    // Normalize both paths for comparison (resolve symlinks, trailing slashes)
    const normalizedSource = path.resolve(sourcePath);
    const normalizedIncoming = path.resolve(INCOMING_FOLDER);

    if (!normalizedSource.startsWith(normalizedIncoming)) {
      console.log(`[Archive] Path mismatch: "${normalizedSource}" does not start with "${normalizedIncoming}"`);
      return res.status(400).json({ error: `Invalid source path: not inside incoming folder` });
    }

    if (!fs.existsSync(sourcePath)) {
      return res.status(404).json({ error: 'Source file not found (already moved?)' });
    }

    // Map content type to subfolder
    const folderMap = {
      'meeting': 'meetings',
      'log': 'log the day',
      'artifact': 'artifacts',
      'idea': 'artifacts'
    };

    const subFolder = folderMap[contentType] || 'artifacts';
    const destDir = path.join(INCOMING_FOLDER, subFolder);  // Uses dynamic incoming folder

    // Ensure destination exists
    if (!fs.existsSync(destDir)) {
      fs.mkdirSync(destDir, { recursive: true });
    }

    const destPath = path.join(destDir, path.basename(sourcePath));

    // Move file
    fs.renameSync(sourcePath, destPath);
    console.log(`[Import] Archived source: ${path.basename(sourcePath)} → ${subFolder}/`);

    res.json({ success: true, destination: destPath, folder: subFolder });
  } catch (err) {
    console.error('[Import] Archive source error:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
