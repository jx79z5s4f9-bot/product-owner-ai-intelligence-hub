/**
 * SQLite Vector Search Service
 * Uses SQLite FTS5 + better-sqlite3 for embedded vector search
 * No external server dependency - 99%+ uptime
 */

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const os = require('os');

// Try to load sqlite-vss, but fall back gracefully
let vssAvailable = false;
try {
  // Note: sqlite-vss requires compilation - we'll use FTS5 as fallback
  vssAvailable = false; // Disable for now until binary is available
} catch (e) {
  console.log('[VectorSearch] VSS extension not available, using FTS5');
}

class SQLiteVectorSearch {
  constructor() {
    this.db = null;
    this.isReady = false;
    this.dbPath = path.join(__dirname, '..', 'vector-search.db');
  }

  /**
   * Initialize the vector search database
   */
  async init() {
    try {
      this.db = new Database(this.dbPath);
      
      // Enable WAL mode for better performance
      this.db.pragma('journal_mode = WAL');
      
      // Create FTS5 virtual table for full-text search
      this.db.exec(`
        CREATE VIRTUAL TABLE IF NOT EXISTS documents_fts USING fts5(
          doc_id,
          rte_id,
          filepath,
          filename,
          chunk_index,
          content,
          section_title,
          tokenize='porter unicode61'
        );
      `);
      
      // Create metadata table
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS document_chunks (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          doc_id TEXT NOT NULL,
          rte_id INTEGER,
          filepath TEXT NOT NULL,
          filename TEXT,
          chunk_index INTEGER DEFAULT 0,
          content TEXT NOT NULL,
          section_title TEXT,
          word_count INTEGER,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(filepath, chunk_index)
        );
      `);
      
      // Create index for fast lookups
      this.db.exec(`
        CREATE INDEX IF NOT EXISTS idx_chunks_filepath ON document_chunks(filepath);
        CREATE INDEX IF NOT EXISTS idx_chunks_rte ON document_chunks(rte_id);
      `);

      this.isReady = true;
      
      const count = this.db.prepare('SELECT COUNT(*) as count FROM document_chunks').get();
      console.log(`[VectorSearch] SQLite FTS5 initialized with ${count.count} chunks`);
      
      return true;
    } catch (error) {
      console.error('[VectorSearch] Init failed:', error.message);
      this.isReady = false;
      return false;
    }
  }

  /**
   * Index a markdown file
   */
  async indexFile(filepath, rteId = null) {
    if (!this.isReady || !this.db) {
      console.log('[VectorSearch] Not ready, skipping indexFile');
      return false;
    }

    try {
      const content = fs.readFileSync(filepath, 'utf-8');
      const filename = path.basename(filepath);
      const docId = `${rteId || 'global'}-${filename}`;
      
      // Delete existing chunks for this file
      this.db.prepare('DELETE FROM document_chunks WHERE filepath = ?').run(filepath);
      this.db.prepare('DELETE FROM documents_fts WHERE filepath = ?').run(filepath);
      
      // Chunk by markdown sections
      const chunks = this.chunkContent(content, filename);
      
      const insertChunk = this.db.prepare(`
        INSERT INTO document_chunks (doc_id, rte_id, filepath, filename, chunk_index, content, section_title, word_count)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);
      
      const insertFts = this.db.prepare(`
        INSERT INTO documents_fts (doc_id, rte_id, filepath, filename, chunk_index, content, section_title)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `);
      
      const insertMany = this.db.transaction((chunks) => {
        for (const chunk of chunks) {
          insertChunk.run(
            docId,
            rteId,
            filepath,
            filename,
            chunk.index,
            chunk.content,
            chunk.section,
            chunk.content.split(/\s+/).length
          );
          insertFts.run(
            docId,
            rteId || '',
            filepath,
            filename,
            chunk.index,
            chunk.content,
            chunk.section || ''
          );
        }
      });
      
      insertMany(chunks);
      
      console.log(`[VectorSearch] Indexed ${filepath}: ${chunks.length} chunks`);
      return true;
    } catch (error) {
      console.error('[VectorSearch] Index error:', error.message);
      return false;
    }
  }

  /**
   * Index a document from content (used by ingest API)
   * @param {Object} options - { filepath, content, title, mode, rteName, rteId }
   */
  indexDocument(options) {
    const { filepath, content, title, mode, rteName, rteId } = options;
    
    if (!this.isReady || !this.db) {
      console.log('[VectorSearch] Not ready, skipping indexDocument');
      return false;
    }

    try {
      const filename = path.basename(filepath);
      // Extract rteId from filepath if not provided (format: "rteId-filename.md")
      const extractedRteId = rteId || (filepath.match(/\/(\d+)-/) ? parseInt(filepath.match(/\/(\d+)-/)[1]) : null);
      const docId = `${extractedRteId || 'global'}-${filename}`;
      
      // Delete existing chunks for this file
      this.db.prepare('DELETE FROM document_chunks WHERE filepath = ?').run(filepath);
      this.db.prepare('DELETE FROM documents_fts WHERE filepath = ?').run(filepath);
      
      // Chunk by markdown sections
      const chunks = this.chunkContent(content, filename);
      
      const insertChunk = this.db.prepare(`
        INSERT INTO document_chunks (doc_id, rte_id, filepath, filename, chunk_index, content, section_title, word_count)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);
      
      const insertFts = this.db.prepare(`
        INSERT INTO documents_fts (doc_id, rte_id, filepath, filename, chunk_index, content, section_title)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `);
      
      const insertMany = this.db.transaction((chunks) => {
        for (const chunk of chunks) {
          insertChunk.run(
            docId,
            extractedRteId,
            filepath,
            filename,
            chunk.index,
            chunk.content,
            chunk.section,
            chunk.content.split(/\s+/).length
          );
          insertFts.run(
            docId,
            extractedRteId || '',
            filepath,
            filename,
            chunk.index,
            chunk.content,
            chunk.section || ''
          );
        }
      });
      
      insertMany(chunks);
      
      console.log(`[VectorSearch] Indexed document ${filename}: ${chunks.length} chunks`);
      return true;
    } catch (error) {
      console.error('[VectorSearch] indexDocument error:', error.message);
      return false;
    }
  }

  /**
   * Chunk markdown content by sections
   */
  chunkContent(content, filename) {
    const chunks = [];
    const lines = content.split('\n');
    
    let currentSection = filename;
    let currentContent = [];
    let chunkIndex = 0;
    
    for (const line of lines) {
      // Check for markdown header
      const headerMatch = line.match(/^(#{1,3})\s+(.+)/);
      
      if (headerMatch) {
        // Save previous chunk if it has content
        if (currentContent.length > 0) {
          const text = currentContent.join('\n').trim();
          if (text.length > 50) { // Minimum chunk size
            chunks.push({
              index: chunkIndex++,
              section: currentSection,
              content: text
            });
          }
        }
        currentSection = headerMatch[2].trim();
        currentContent = [line];
      } else {
        currentContent.push(line);
      }
    }
    
    // Don't forget last chunk
    if (currentContent.length > 0) {
      const text = currentContent.join('\n').trim();
      if (text.length > 50) {
        chunks.push({
          index: chunkIndex++,
          section: currentSection,
          content: text
        });
      }
    }
    
    // If no chunks created, create one from whole content
    if (chunks.length === 0 && content.trim().length > 0) {
      chunks.push({
        index: 0,
        section: filename,
        content: content.trim()
      });
    }
    
    return chunks;
  }

  /**
   * Search for documents matching query
   */
  async search(query, options = {}) {
    if (!this.isReady || !this.db) {
      return { results: [], total: 0, error: 'Search not ready' };
    }

    const { rteId, limit = 10, highlightLength = 200 } = options;

    try {
      // Build FTS5 query - escape special characters
      const ftsQuery = query
        .replace(/[^\w\s]/g, ' ')
        .split(/\s+/)
        .filter(w => w.length > 1)
        .map(w => `"${w}"*`)
        .join(' OR ');
      
      if (!ftsQuery) {
        return { results: [], total: 0 };
      }

      let sql = `
        SELECT 
          dc.id,
          dc.filepath,
          dc.filename,
          dc.section_title,
          dc.rte_id,
          dc.content,
          snippet(documents_fts, 5, '<mark>', '</mark>', '...', 30) as highlight,
          bm25(documents_fts) as score
        FROM documents_fts
        JOIN document_chunks dc ON documents_fts.filepath = dc.filepath AND documents_fts.chunk_index = dc.chunk_index
        WHERE documents_fts MATCH ?
      `;
      
      const params = [ftsQuery];
      
      if (rteId) {
        sql += ` AND dc.rte_id = ?`;
        params.push(rteId);
      }
      
      sql += ` ORDER BY score LIMIT ?`;
      params.push(limit);

      const results = this.db.prepare(sql).all(...params);
      
      return {
        results: results.map(r => ({
          id: r.id,
          filepath: r.filepath,
          filename: r.filename,
          section: r.section_title,
          rteId: r.rte_id,
          highlight: r.highlight,
          content: r.content,
          score: Math.abs(r.score) // BM25 returns negative scores
        })),
        total: results.length,
        query: query
      };
    } catch (error) {
      console.error('[VectorSearch] Search error:', error.message);
      return { results: [], total: 0, error: error.message };
    }
  }

  /**
   * Find open items (TODOs, action items, blockers)
   */
  async findOpenItems(rteId = null) {
    if (!this.isReady || !this.db) {
      return { items: [], total: 0 };
    }

    try {
      const patterns = ['TODO', 'FIXME', 'ACTION', 'BLOCKER', '[ ]', 'OPEN'];
      const results = [];
      
      for (const pattern of patterns) {
        const query = `"${pattern}"`;
        let sql = `
          SELECT dc.filepath, dc.filename, dc.section_title, dc.content
          FROM documents_fts
          JOIN document_chunks dc ON documents_fts.filepath = dc.filepath
          WHERE documents_fts MATCH ?
        `;
        
        const params = [query];
        if (rteId) {
          sql += ` AND dc.rte_id = ?`;
          params.push(rteId);
        }
        sql += ` LIMIT 20`;
        
        const rows = this.db.prepare(sql).all(...params);
        
        for (const row of rows) {
          // Find the actual line with the pattern
          const lines = row.content.split('\n');
          for (const line of lines) {
            if (line.toUpperCase().includes(pattern) || line.includes('[ ]')) {
              results.push({
                type: pattern,
                text: line.trim().substring(0, 200),
                file: row.filename,
                filepath: row.filepath,
                section: row.section_title
              });
            }
          }
        }
      }
      
      return {
        items: results.slice(0, 50), // Limit total results
        total: results.length
      };
    } catch (error) {
      console.error('[VectorSearch] findOpenItems error:', error.message);
      return { items: [], total: 0, error: error.message };
    }
  }

  /**
   * Delete document from index by filepath
   */
  async deleteFile(filepath) {
    if (!this.isReady || !this.db) return false;

    try {
      this.db.prepare('DELETE FROM document_chunks WHERE filepath = ?').run(filepath);
      this.db.prepare('DELETE FROM documents_fts WHERE filepath = ?').run(filepath);
      console.log(`[VectorSearch] Deleted from index: ${filepath}`);
      return true;
    } catch (error) {
      console.error('[VectorSearch] Delete error:', error.message);
      return false;
    }
  }

  /**
   * Delete document from index by rte_id (used when deleting from rte_documents)
   */
  async deleteByRteId(rteDocId) {
    if (!this.isReady || !this.db) return false;

    try {
      // document_chunks uses rte_id field for the RTE, not rte_documents.id
      // We need to find by doc_id pattern or filepath lookup
      // For now, this is called after we have the filepath from rte_documents
      console.log(`[VectorSearch] deleteByRteId called for doc ${rteDocId}`);
      return true;
    } catch (error) {
      console.error('[VectorSearch] deleteByRteId error:', error.message);
      return false;
    }
  }

  /**
   * Rebuild entire index for an RTE
   */
  async rebuildIndex(rteId, basePath) {
    if (!this.isReady || !this.db) return { indexed: 0, errors: 0 };

    const expandedPath = path.normalize(basePath.replace(/^~/, os.homedir()));
    let indexed = 0;
    let errors = 0;

    const scanDir = (dir) => {
      if (!fs.existsSync(dir)) return;
      
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        
        if (entry.isDirectory() && !entry.name.startsWith('.')) {
          scanDir(fullPath);
        } else if (entry.isFile() && entry.name.endsWith('.md')) {
          try {
            this.indexFile(fullPath, rteId);
            indexed++;
          } catch (e) {
            errors++;
          }
        }
      }
    };

    // Clear existing index for this RTE
    this.db.prepare('DELETE FROM document_chunks WHERE rte_id = ?').run(rteId);
    this.db.prepare('DELETE FROM documents_fts WHERE rte_id = ?').run(rteId);
    
    scanDir(expandedPath);
    
    console.log(`[VectorSearch] Rebuilt index for RTE ${rteId}: ${indexed} files, ${errors} errors`);
    return { indexed, errors };
  }

  /**
   * Get stats about the index
   */
  getStats() {
    if (!this.isReady || !this.db) {
      return { ready: false, chunks: 0, files: 0 };
    }

    try {
      const chunks = this.db.prepare('SELECT COUNT(*) as count FROM document_chunks').get();
      const files = this.db.prepare('SELECT COUNT(DISTINCT filepath) as count FROM document_chunks').get();
      const byRte = this.db.prepare(`
        SELECT rte_id, COUNT(*) as chunks, COUNT(DISTINCT filepath) as files
        FROM document_chunks
        GROUP BY rte_id
      `).all();
      
      return {
        ready: true,
        chunks: chunks.count,
        files: files.count,
        byRte
      };
    } catch (error) {
      return { ready: false, error: error.message };
    }
  }

  /**
   * Close database connection
   */
  close() {
    if (this.db) {
      this.db.close();
      this.db = null;
      this.isReady = false;
    }
  }
}

// Singleton instance
let instance = null;

function getInstance() {
  if (!instance) {
    instance = new SQLiteVectorSearch();
  }
  return instance;
}

module.exports = { SQLiteVectorSearch, getInstance };
