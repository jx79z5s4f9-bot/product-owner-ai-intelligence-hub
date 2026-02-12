/**
 * Debrief API Routes
 * Session summaries and entity extraction
 */

const express = require('express');
const router = express.Router();
const { getDb } = require('../db/connection');
const { getInstance: getLLMManager } = require('../services/llm-manager');

/**
 * GET / - List all debriefs
 * Query params:
 *   - rteId: filter by RTE ID
 *   - limit: max results (default 50)
 */
router.get('/', async (req, res) => {
  const { rteId, limit } = req.query;
  
  try {
    const db = getDb();
    
    let query = `
      SELECT d.*, r.name as rteName
      FROM debriefs d
      LEFT JOIN rtes r ON d.rte_id = r.id
    `;
    const params = [];
    
    if (rteId) {
      query += ' WHERE d.rte_id = ?';
      params.push(parseInt(rteId));
    }
    
    query += ' ORDER BY d.created_at DESC LIMIT ?';
    params.push(parseInt(limit) || 50);
    
    const debriefs = db.prepare(query).all(...params);
    
    // Get entities for each debrief
    const entitiesStmt = db.prepare(`
      SELECT a.id, a.name, a.type
      FROM debrief_entities de
      JOIN actors a ON de.actor_id = a.id
      WHERE de.debrief_id = ?
    `);
    
    debriefs.forEach(d => {
      d.entities = entitiesStmt.all(d.id);
    });
    
    res.json(debriefs);
  } catch (error) {
    console.error('[Debrief] List failed:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /:id - Get single debrief with entities
 */
router.get('/:id', async (req, res) => {
  const { id } = req.params;
  
  try {
    const db = getDb();
    
    const debrief = db.prepare(`
      SELECT d.*, r.name as rteName
      FROM debriefs d
      LEFT JOIN rtes r ON d.rte_id = r.id
      WHERE d.id = ?
    `).get(parseInt(id));
    
    if (!debrief) {
      return res.status(404).json({ error: 'Debrief not found' });
    }
    
    // Get entities
    debrief.entities = db.prepare(`
      SELECT a.id, a.name, a.type
      FROM debrief_entities de
      JOIN actors a ON de.actor_id = a.id
      WHERE de.debrief_id = ?
    `).all(parseInt(id));
    
    res.json(debrief);
  } catch (error) {
    console.error('[Debrief] Get failed:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST / - Create new debrief with entity extraction
 */
router.post('/', async (req, res) => {
  const { rteId, title, content } = req.body;
  
  if (!rteId || !title || !content) {
    return res.status(400).json({ error: 'Missing required fields: rteId, title, content' });
  }
  
  try {
    const db = getDb();
    
    // Ensure debriefs table exists
    db.exec(`
      CREATE TABLE IF NOT EXISTS debriefs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        rte_id INTEGER NOT NULL,
        title TEXT NOT NULL,
        content TEXT NOT NULL,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (rte_id) REFERENCES rtes(id)
      );
      
      CREATE TABLE IF NOT EXISTS debrief_entities (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        debrief_id INTEGER NOT NULL,
        actor_id INTEGER NOT NULL,
        FOREIGN KEY (debrief_id) REFERENCES debriefs(id),
        FOREIGN KEY (actor_id) REFERENCES actors(id)
      );
    `);
    
    // Insert debrief
    const result = db.prepare(`
      INSERT INTO debriefs (rte_id, title, content)
      VALUES (?, ?, ?)
    `).run(parseInt(rteId), title, content);
    
    const debriefId = result.lastInsertRowid;
    
    // Extract entities using LLM
    const extractedEntities = await extractEntities(content, rteId);
    
    // Link entities to debrief
    if (extractedEntities.length > 0) {
      const linkStmt = db.prepare(`
        INSERT INTO debrief_entities (debrief_id, actor_id)
        VALUES (?, ?)
      `);
      
      extractedEntities.forEach(actorId => {
        linkStmt.run(debriefId, actorId);
      });
    }
    
    res.json({
      id: debriefId,
      rteId,
      title,
      entitiesExtracted: extractedEntities.length
    });
  } catch (error) {
    console.error('[Debrief] Create failed:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Extract entities from content using LLM
 */
async function extractEntities(content, rteId) {
  const actorIds = [];
  
  try {
    const llm = getLLMManager();
    const db = getDb();
    
    // Get existing actors for this RTE
    const existingActors = db.prepare(`
      SELECT id, name, type FROM actors WHERE rte_id = ?
    `).all(parseInt(rteId));
    
    const actorNames = existingActors.map(a => a.name.toLowerCase());
    
    // Simple keyword extraction without full LLM call (faster)
    // Match existing actors in content
    existingActors.forEach(actor => {
      if (content.toLowerCase().includes(actor.name.toLowerCase())) {
        actorIds.push(actor.id);
      }
    });
    
    // Try to extract new entities with LLM if available
    try {
      const prompt = `Extract named entities (people, teams, systems) from this text. 
Return ONLY a JSON array of objects with "name" and "type" (person/team/system).
Keep it concise - max 10 entities.

Text: "${content.substring(0, 1500)}"

JSON:`;

      const response = await llm.prompt(prompt, { temperature: 0.1 });
      
      // Parse JSON response
      const match = response.match(/\[[\s\S]*\]/);
      if (match) {
        const entities = JSON.parse(match[0]);
        
        // Insert new actors
        const insertStmt = db.prepare(`
          INSERT OR IGNORE INTO actors (rte_id, name, type, metadata_json)
          VALUES (?, ?, ?, ?)
        `);
        
        const getIdStmt = db.prepare(`
          SELECT id FROM actors WHERE rte_id = ? AND name = ?
        `);
        
        entities.forEach(entity => {
          if (entity.name && entity.type) {
            const nameLower = entity.name.toLowerCase();
            
            // Check if already exists
            if (!actorNames.includes(nameLower)) {
              insertStmt.run(
                parseInt(rteId),
                entity.name,
                entity.type,
                JSON.stringify({ source: 'debrief' })
              );
            }
            
            // Get the actor ID
            const actor = getIdStmt.get(parseInt(rteId), entity.name);
            if (actor && !actorIds.includes(actor.id)) {
              actorIds.push(actor.id);
            }
          }
        });
      }
    } catch (llmError) {
      console.warn('[Debrief] LLM extraction skipped:', llmError.message);
    }
  } catch (error) {
    console.error('[Debrief] Entity extraction failed:', error);
  }
  
  return actorIds;
}

/**
 * DELETE /:id - Delete a debrief
 */
router.delete('/:id', async (req, res) => {
  const { id } = req.params;
  
  try {
    const db = getDb();
    
    // Delete entity links
    db.prepare('DELETE FROM debrief_entities WHERE debrief_id = ?').run(parseInt(id));
    
    // Delete debrief
    db.prepare('DELETE FROM debriefs WHERE id = ?').run(parseInt(id));
    
    res.json({ success: true });
  } catch (error) {
    console.error('[Debrief] Delete failed:', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
