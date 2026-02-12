/**
 * Vector Search Service
 * Uses Ollama nomic-embed-text for embeddings
 * Chunks documents by ## headers
 * Stores in ChromaDB for semantic similarity search
 */

const { ChromaClient } = require('chromadb');
const fs = require('fs');
const path = require('path');
const os = require('os');

const VECTOR_DB_PATH = path.join(os.homedir(), 'ProductOwnerAI', '.vectordb');
const WORKSPACE_ROOT = path.join(os.homedir(), 'ProductOwnerAI', 'rte');
const OLLAMA_URL = 'http://localhost:11434/api/embeddings';
const EMBED_MODEL = 'nomic-embed-text';

class VectorSearchService {
  constructor() {
    this.client = null;
    this.collection = null;
    this.isReady = false;
    this.ollamaAvailable = false;
    this.indexedFiles = new Set();
  }

  /**
   * Initialize ChromaDB and check Ollama
   */
  async init() {
    try {
      // Create storage directory
      if (!fs.existsSync(VECTOR_DB_PATH)) {
        fs.mkdirSync(VECTOR_DB_PATH, { recursive: true });
      }

      // Connect to ChromaDB (persistent local storage)
      this.client = new ChromaClient();

      // Create collection
      try {
        this.collection = await this.client.getOrCreateCollection({
          name: 'po_ai_chunks',
          metadata: {
            description: 'PO AI document chunks',
            'hnsw:space': 'cosine'
          }
        });
      } catch (error) {
        // Collection might exist, try to get it
        this.collection = await this.client.getCollection({
          name: 'po_ai_chunks'
        });
      }

      // Check if Ollama is available
      this.ollamaAvailable = await this.checkOllama();
      
      if (!this.ollamaAvailable) {
        console.warn('[VectorSearch] Ollama not available - embeddings will fail');
      } else {
        console.log('[VectorSearch] Ollama connected');
      }

      this.isReady = true;
      console.log('[VectorSearch] Initialized');

      // Index all existing files
      await this.indexAllFiles();

      return true;
    } catch (error) {
      console.error('[VectorSearch] Init failed:', error.message);
      return false;
    }
  }

  /**
   * Check if Ollama is running
   */
  async checkOllama() {
    try {
      const response = await fetch('http://localhost:11434/api/tags', {
        signal: AbortSignal.timeout(3000)
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  /**
   * Get embedding from Ollama
   */
  async getEmbedding(text) {
    if (!this.ollamaAvailable) {
      throw new Error('Ollama not available');
    }

    const response = await fetch(OLLAMA_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: EMBED_MODEL,
        prompt: text
      })
    });

    if (!response.ok) {
      throw new Error(`Ollama embedding failed: ${response.status}`);
    }

    const data = await response.json();
    return data.embedding;
  }

  /**
   * Split document into chunks by ## headers
   */
  chunkDocument(content, filepath) {
    const chunks = [];
    const filename = path.basename(filepath);

    // Extract date from filename (YYYY-MM-DD)
    const dateMatch = filename.match(/^(\d{4}-\d{2}-\d{2})/);
    const date = dateMatch ? dateMatch[1] : new Date().toISOString().split('T')[0];

    // Extract RTE name from path
    const rteMatch = filepath.match(/\/rte\/([^/]+)\//);
    const rteName = rteMatch ? rteMatch[1] : 'unknown';

    // Detect file type from path
    let fileType = 'unknown';
    if (filepath.includes('/logs/daily/')) fileType = 'debrief';
    else if (filepath.includes('/logs/meetings/')) fileType = 'meeting';
    else if (filepath.includes('/logs/queries/')) fileType = 'query';
    else if (filepath.includes('/artifacts/generated/')) fileType = 'artifact';

    // Split by ## headers
    const sections = content.split(/(?=^## )/m);

    sections.forEach((section, index) => {
      const trimmed = section.trim();
      if (!trimmed) return;

      // Extract section title
      const titleMatch = trimmed.match(/^##\s+(.+)$/m);
      const sectionTitle = titleMatch ? titleMatch[1] : (index === 0 ? 'Introduction' : `Section ${index}`);

      chunks.push({
        id: this.generateChunkId(filepath, index),
        content: trimmed,
        metadata: {
          filepath,
          filename,
          rteName,
          date,
          fileType,
          sectionTitle,
          sectionIndex: index,
          indexedAt: new Date().toISOString()
        }
      });
    });

    // If no sections found, treat whole doc as one chunk
    if (chunks.length === 0) {
      chunks.push({
        id: this.generateChunkId(filepath, 0),
        content: content.trim(),
        metadata: {
          filepath,
          filename,
          rteName,
          date,
          fileType,
          sectionTitle: 'Full Document',
          sectionIndex: 0,
          indexedAt: new Date().toISOString()
        }
      });
    }

    return chunks;
  }

  /**
   * Generate unique chunk ID
   */
  generateChunkId(filepath, index) {
    let hash = 0;
    for (let i = 0; i < filepath.length; i++) {
      hash = ((hash << 5) - hash) + filepath.charCodeAt(i);
      hash = hash & hash; // Convert to 32-bit integer
    }
    return `doc_${Math.abs(hash)}_${index}`;
  }

  /**
   * Index a single file
   */
  async indexFile(filepath) {
    if (!this.isReady) {
      console.warn('[VectorSearch] Not ready, skipping index');
      return;
    }

    try {
      // Read file
      const content = fs.readFileSync(filepath, 'utf-8');

      // Remove old chunks for this file
      await this.removeFile(filepath);

      // Create chunks
      const chunks = this.chunkDocument(content, filepath);

      if (chunks.length === 0) {
        console.log(`[VectorSearch] No chunks for ${path.basename(filepath)}`);
        return;
      }

      // Generate embeddings
      const embeddings = [];
      for (const chunk of chunks) {
        try {
          const embedding = await this.getEmbedding(chunk.content);
          embeddings.push(embedding);
        } catch (error) {
          console.error(`[VectorSearch] Embedding failed for chunk: ${error.message}`);
          return; // Skip file if embedding fails
        }
      }

      // Add to ChromaDB
      await this.collection.add({
        ids: chunks.map(c => c.id),
        embeddings: embeddings,
        metadatas: chunks.map(c => c.metadata),
        documents: chunks.map(c => c.content)
      });

      this.indexedFiles.add(filepath);
      console.log(`[VectorSearch] Indexed ${chunks.length} chunks from ${path.basename(filepath)}`);
    } catch (error) {
      console.error(`[VectorSearch] Index failed for ${filepath}:`, error.message);
    }
  }

  /**
   * Remove file from index
   */
  async removeFile(filepath) {
    if (!this.isReady) return;

    try {
      // Get all chunks for this file
      const results = await this.collection.get({
        where: { filepath: filepath }
      });

      if (results.ids.length > 0) {
        await this.collection.delete({
          ids: results.ids
        });
        console.log(`[VectorSearch] Removed ${results.ids.length} chunks for ${path.basename(filepath)}`);
      }

      this.indexedFiles.delete(filepath);
    } catch (error) {
      console.error(`[VectorSearch] Remove failed for ${filepath}:`, error.message);
    }
  }

  /**
   * Semantic search
   */
  async search(query, options = {}) {
    if (!this.isReady) {
      throw new Error('Vector search not initialized');
    }

    const {
      rteName = null,
      dateFrom = null,
      dateTo = null,
      fileType = null,
      limit = 10
    } = options;

    try {
      // Generate query embedding
      const queryEmbedding = await this.getEmbedding(query);

      // Build filter
      const where = {};
      if (rteName) where.rteName = rteName;
      if (fileType) where.fileType = fileType;
      
      // Date filtering requires range query (not supported in where clause)
      // We'll filter results post-query

      // Query ChromaDB
      const results = await this.collection.query({
        queryEmbeddings: [queryEmbedding],
        nResults: limit * 2, // Get more to allow for date filtering
        where: Object.keys(where).length > 0 ? where : undefined
      });

      // Format results
      let formatted = results.ids[0].map((id, index) => ({
        id: id,
        content: results.documents[0][index],
        metadata: results.metadatas[0][index],
        score: results.distances[0][index]
      }));

      // Apply date filtering
      if (dateFrom || dateTo) {
        formatted = formatted.filter(r => {
          const docDate = r.metadata.date;
          if (dateFrom && docDate < dateFrom) return false;
          if (dateTo && docDate > dateTo) return false;
          return true;
        });
      }

      // Limit results
      formatted = formatted.slice(0, limit);

      return formatted;
    } catch (error) {
      console.error('[VectorSearch] Search failed:', error.message);
      throw error;
    }
  }

  /**
   * Find open items (TODOs, action items, etc.)
   */
  async findOpenItems(options = {}) {
    const {
      rteName = null,
      groupBy = 'file' // 'file', 'date', or 'none'
    } = options;

    // Patterns to search for
    const patterns = [
      'TODO',
      'Action:',
      'Open:',
      'pending',
      '@me',
      '[ ]',
      'I need to',
      'must do',
      'should do'
    ];

    try {
      // Search for each pattern
      const allResults = [];

      for (const pattern of patterns) {
        const results = await this.search(pattern, {
          rteName,
          limit: 20
        });
        allResults.push(...results);
      }

      // Deduplicate by chunk ID
      const unique = Array.from(new Map(allResults.map(r => [r.id, r])).values());

      // Group results
      if (groupBy === 'file') {
        const grouped = {};
        unique.forEach(r => {
          const key = r.metadata.filepath;
          if (!grouped[key]) {
            grouped[key] = {
              filepath: key,
              filename: r.metadata.filename,
              items: []
            };
          }
          grouped[key].items.push({
            section: r.metadata.sectionTitle,
            content: r.content.substring(0, 200), // First 200 chars
            score: r.score
          });
        });
        return Object.values(grouped);
      } else if (groupBy === 'date') {
        const grouped = {};
        unique.forEach(r => {
          const key = r.metadata.date;
          if (!grouped[key]) grouped[key] = [];
          grouped[key].push({
            filename: r.metadata.filename,
            section: r.metadata.sectionTitle,
            content: r.content.substring(0, 200),
            score: r.score
          });
        });
        return grouped;
      }

      // No grouping
      return unique.map(r => ({
        filename: r.metadata.filename,
        filepath: r.metadata.filepath,
        section: r.metadata.sectionTitle,
        content: r.content.substring(0, 200),
        score: r.score,
        date: r.metadata.date
      }));
    } catch (error) {
      console.error('[VectorSearch] Find open items failed:', error.message);
      throw error;
    }
  }

  /**
   * Index all .md files in workspace
   */
  async indexAllFiles() {
    if (!this.isReady) return;

    console.log('[VectorSearch] Indexing all files...');

    try {
      const files = this.getAllMarkdownFiles(WORKSPACE_ROOT);
      console.log(`[VectorSearch] Found ${files.length} .md files`);

      for (const filepath of files) {
        if (!this.indexedFiles.has(filepath)) {
          await this.indexFile(filepath);
        }
      }

      console.log(`[VectorSearch] Indexing complete. Total: ${this.indexedFiles.size} files`);
    } catch (error) {
      console.error('[VectorSearch] Index all failed:', error.message);
    }
  }

  /**
   * Recursively get all .md files
   */
  getAllMarkdownFiles(dirPath) {
    const files = [];

    if (!fs.existsSync(dirPath)) {
      return files;
    }

    const entries = fs.readdirSync(dirPath, { withFileTypes: true });

    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;

      const fullPath = path.join(dirPath, entry.name);

      if (entry.isDirectory()) {
        files.push(...this.getAllMarkdownFiles(fullPath));
      } else if (entry.isFile() && entry.name.endsWith('.md')) {
        files.push(fullPath);
      }
    }

    return files;
  }

  /**
   * Get statistics
   */
  async getStats() {
    if (!this.isReady) {
      return {
        ready: false,
        indexed: 0
      };
    }

    try {
      const count = await this.collection.count();
      
      return {
        ready: true,
        indexed: this.indexedFiles.size,
        chunks: count,
        ollamaAvailable: this.ollamaAvailable
      };
    } catch (error) {
      return {
        ready: false,
        error: error.message
      };
    }
  }

  /**
   * Rebuild entire index
   */
  async reindex() {
    console.log('[VectorSearch] Rebuilding index...');

    try {
      // Clear collection
      const allResults = await this.collection.get();
      if (allResults.ids.length > 0) {
        await this.collection.delete({
          ids: allResults.ids
        });
      }

      this.indexedFiles.clear();

      // Reindex all files
      await this.indexAllFiles();

      console.log('[VectorSearch] Reindex complete');
      return true;
    } catch (error) {
      console.error('[VectorSearch] Reindex failed:', error.message);
      return false;
    }
  }
}

// Singleton instance
let instance = null;

module.exports = {
  getInstance: () => {
    if (!instance) {
      instance = new VectorSearchService();
    }
    return instance;
  },
  VectorSearchService
};
