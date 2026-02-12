/**
 * File Saver Service
 * Saves output to ~/ProductOwnerAI/rte/{rteName}/ with proper structure
 * ALWAYS saves on every prompt
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { getDb } = require('../db/connection');

const WORKSPACE_ROOT = path.join(os.homedir(), 'ProductOwnerAI');

const PATHS = {
  debrief: 'logs/daily',
  meeting: 'logs/meetings',
  create: 'artifacts/generated',
  retrieve: 'logs/queries'
};

class FileSaver {
  constructor() {
    // Don't auto-create directories on init anymore
    // They'll be created on-demand per RTE
  }

  /**
   * Ensure RTE workspace directories exist
   * @param {string} rteName - Name of the RTE (e.g., 'my-product')
   */
  ensureRteWorkspace(rteName) {
    const rteRoot = path.join(WORKSPACE_ROOT, 'rte', rteName.toLowerCase());

    Object.values(PATHS).forEach(relativePath => {
      const fullPath = path.join(rteRoot, relativePath);
      if (!fs.existsSync(fullPath)) {
        fs.mkdirSync(fullPath, { recursive: true });
        console.log(`Created RTE directory: ${fullPath}`);
      }
    });

    // Also ensure entities folder exists
    const entitiesPath = path.join(rteRoot, 'entities');
    if (!fs.existsSync(entitiesPath)) {
      fs.mkdirSync(entitiesPath, { recursive: true });
    }

    return rteRoot;
  }

  /**
   * Save content to appropriate location within RTE folder
   * @param {string} mode - debrief, meeting, create, retrieve
   * @param {string} content - The content to save
   * @param {object} metadata - {title, entities, relationships, rteName}
   * @returns {object} {filename, filepath}
   */
  save(mode, content, metadata = {}) {
    const rteName = metadata.rteName || 'default';
    const rteRoot = this.ensureRteWorkspace(rteName);

    const date = new Date().toISOString().split('T')[0];
    const time = new Date().toISOString().split('T')[1].substring(0, 5).replace(':', '');
    const slug = this.generateSlug(metadata.title || content);

    // Determine path based on mode, within the RTE folder
    const relativePath = PATHS[mode] || PATHS.debrief;
    const filename = `${date}-${time}-${slug}.md`;
    const filepath = path.join(rteRoot, relativePath, filename);

    // Build frontmatter
    const frontmatter = this.buildFrontmatter(mode, date, metadata);

    // Build full content
    const title = metadata.title || this.extractTitle(content) || `${mode} ${date}`;
    const fullContent = `${frontmatter}# ${title}\n\n${content}`;

    // Write file
    fs.writeFileSync(filepath, fullContent, 'utf-8');
    console.log(`[FileSaver] Saved: ${filepath}`);

    // Index in database (sync)
    this.indexFile(filename, filepath, mode, date, metadata);

    // NEW: Extract and persist entities/relationships
    this.extractAndPersistIntelligence(content, rteName, filepath);

    // Index in FTS5 vector search
    try {
      const { getInstance } = require('./sqlite-vector-search');
      const instance = getInstance();
      if (instance && instance.isReady) {
        instance.indexDocument({
          filepath,
          content: fullContent,
          title,
          mode,
          rteName
        });
      }
    } catch (error) {
      // FTS5 not available, that's ok
      console.log('[FileSaver] FTS5 index skipped:', error.message);
    }

    return { filename, filepath, fullPath: filepath };
  }

  /**
   * Extract entities and relationships from content and persist to database
   * This is the critical wiring that was missing!
   */
  async extractAndPersistIntelligence(content, rteName, sourceFile) {
    try {
      const entityExtractor = require('./entity-extractor');
      const intelligencePersistence = require('./intelligence-persistence');
      
      // Get RTE ID from name
      const rteId = intelligencePersistence.getRteIdByName(rteName);
      if (!rteId) {
        console.log(`[FileSaver] RTE not found: ${rteName}, skipping extraction`);
        return;
      }

      // Extract entities and relationships
      console.log('[FileSaver] Extracting entities...');
      const extraction = await entityExtractor.extract(content, { rteId });
      
      if (extraction.entities.length === 0 && extraction.relationships.length === 0) {
        console.log('[FileSaver] No entities or relationships found');
        return;
      }

      // Persist to database
      console.log(`[FileSaver] Persisting ${extraction.entities.length} entities, ${extraction.relationships.length} relationships...`);
      const stats = intelligencePersistence.save(extraction, rteId, sourceFile);
      console.log(`[FileSaver] Persisted: ${stats.actors} actors, ${stats.relationships} relationships, ${stats.suggestions} suggestions`);
    } catch (error) {
      console.error('[FileSaver] Entity extraction/persistence failed:', error.message);
      // Don't fail the save - this is a background enhancement
    }
  }

  buildFrontmatter(mode, date, metadata) {
    const lines = [
      '---',
      `date: ${date}`,
      `type: ${mode}`
    ];

    if (metadata.title) {
      lines.push(`title: "${metadata.title}"`);
    }

    if (metadata.entities && metadata.entities.length > 0) {
      const people = metadata.entities
        .filter(e => e.type === 'person')
        .map(e => `"${e.name}"`);
      if (people.length > 0) {
        lines.push(`actors: [${people.join(', ')}]`);
      }
    }

    if (metadata.sections && metadata.sections.length > 0) {
      lines.push(`sections: ${metadata.sections.length}`);
    }

    if (metadata.selectedCards && metadata.selectedCards.length > 0) {
      lines.push(`guides_used: [${metadata.selectedCards.map(c => `"${c}"`).join(', ')}]`);
    }

    lines.push('---', '');
    return lines.join('\n');
  }

  extractTitle(content) {
    // Try to get title from first header
    const headerMatch = content.match(/^##?\s+(.+)$/m);
    if (headerMatch) return headerMatch[1].trim();

    // Or first line if short enough
    const firstLine = content.split('\n')[0].trim();
    if (firstLine && firstLine.length < 100) return firstLine;

    return null;
  }

  generateSlug(text) {
    return text
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, '')
      .replace(/\s+/g, '-')
      .substring(0, 50) || 'untitled';
  }

  indexFile(filename, filepath, type, date, metadata) {
    const db = getDb();
    if (!db) return;

    try {
      // Get RTE ID from name if available
      let rteId = null;
      if (metadata.rteName) {
        const rte = db.prepare('SELECT id FROM rtes WHERE LOWER(name) = LOWER(?)').get(metadata.rteName);
        rteId = rte?.id || null;
      }

      db.prepare(`
        INSERT INTO files (rte_id, filename, filepath, type, date, entities_json) 
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(rteId, filename, filepath, type, date, JSON.stringify(metadata.entities || []));
    } catch (err) {
      if (!err.message.includes('UNIQUE')) {
        console.error('[FileSaver] Index error:', err.message);
      }
    }
  }

  /**
   * Index entities in database for RTE queries
   * DEPRECATED: Use extractAndPersistIntelligence instead for RTE-scoped storage
   * This method uses the legacy 'entities' table for backward compatibility
   */
  indexEntities(entities, relationships, sourceFile) {
    const db = getDb();
    if (!db) return;

    // Index entities to legacy table
    for (const entity of entities) {
      try {
        db.prepare(`
          INSERT OR REPLACE INTO entities (name, type, role, team, organization, description, source_file)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(entity.name, entity.type, entity.role, entity.team, entity.organization, entity.description, sourceFile);
      } catch (err) {
        if (!err.message.includes('UNIQUE')) {
          console.error('[FileSaver] Entity index error:', err.message);
        }
      }
    }

    // Note: The relationships table has actor IDs not names - skip legacy indexing
    // New relationships are stored via intelligence-persistence.js
    console.log(`[FileSaver] Indexed ${entities.length} entities to legacy table`);
  }
}

module.exports = new FileSaver();
