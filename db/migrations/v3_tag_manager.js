/**
 * Migration: v3 Tag Manager
 * 
 * Adds tables for enhanced tag management:
 * - person_metadata (org, team, role for people)
 * - tag_categories (categorize project/system/org tags)
 * 
 * Enables:
 * - Person org/team/role assignments
 * - Tag categorization (uncategorized -> project/system/org)
 * - Better network graph analysis
 */

/**
 * Run the migration
 * @param {Database} db - better-sqlite3 database instance
 * @returns {object} Migration result
 */
function migrate(db) {
  const results = {
    tablesCreated: [],
    errors: []
  };

  console.log('[Migration] Starting v3 Tag Manager migration...');

  try {
    // =====================================================
    // PERSON METADATA (org, team, role for people)
    // =====================================================
    db.exec(`
      CREATE TABLE IF NOT EXISTS person_metadata (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        tag_value TEXT NOT NULL UNIQUE,
        organization TEXT,
        team TEXT,
        role TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);
    results.tablesCreated.push('person_metadata');

    // Create indexes
    db.exec(`CREATE INDEX IF NOT EXISTS idx_person_meta_org ON person_metadata(organization)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_person_meta_team ON person_metadata(team)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_person_meta_role ON person_metadata(role)`);

    // =====================================================
    // TAG CATEGORIES (project/system/org classification)
    // =====================================================
    db.exec(`
      CREATE TABLE IF NOT EXISTS tag_categories (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        tag_value TEXT NOT NULL UNIQUE,
        category TEXT CHECK(category IN ('project', 'system', 'organization', 'uncategorized')) DEFAULT 'uncategorized',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);
    results.tablesCreated.push('tag_categories');

    // Create index
    db.exec(`CREATE INDEX IF NOT EXISTS idx_tag_cat_category ON tag_categories(category)`);

    // =====================================================
    // MIGRATE EXISTING TAGS
    // =====================================================
    // Auto-populate person_metadata from existing person tags
    const existingPeople = db.prepare(`
      SELECT DISTINCT tag_value FROM document_tags WHERE tag_type = 'person'
    `).all();
    
    if (existingPeople.length > 0) {
      const insertPersonMeta = db.prepare(`
        INSERT OR IGNORE INTO person_metadata (tag_value) VALUES (?)
      `);
      for (const person of existingPeople) {
        insertPersonMeta.run(person.tag_value);
      }
      console.log(`[Migration] Added ${existingPeople.length} existing people to person_metadata`);
    }

    // Auto-populate tag_categories from existing project/system/org tags
    const existingProjects = db.prepare(`
      SELECT DISTINCT tag_value FROM document_tags WHERE tag_type = 'project'
    `).all();
    
    if (existingProjects.length > 0) {
      const insertTagCat = db.prepare(`
        INSERT OR IGNORE INTO tag_categories (tag_value, category) VALUES (?, 'project')
      `);
      for (const proj of existingProjects) {
        insertTagCat.run(proj.tag_value);
      }
      console.log(`[Migration] Added ${existingProjects.length} existing projects to tag_categories`);
    }

    const existingSystems = db.prepare(`
      SELECT DISTINCT tag_value FROM document_tags WHERE tag_type = 'system'
    `).all();
    
    if (existingSystems.length > 0) {
      const insertTagCat = db.prepare(`
        INSERT OR IGNORE INTO tag_categories (tag_value, category) VALUES (?, 'system')
      `);
      for (const sys of existingSystems) {
        insertTagCat.run(sys.tag_value);
      }
      console.log(`[Migration] Added ${existingSystems.length} existing systems to tag_categories`);
    }

    const existingOrgs = db.prepare(`
      SELECT DISTINCT tag_value FROM document_tags WHERE tag_type = 'organization'
    `).all();
    
    if (existingOrgs.length > 0) {
      const insertTagCat = db.prepare(`
        INSERT OR IGNORE INTO tag_categories (tag_value, category) VALUES (?, 'organization')
      `);
      for (const org of existingOrgs) {
        insertTagCat.run(org.tag_value);
      }
      console.log(`[Migration] Added ${existingOrgs.length} existing organizations to tag_categories`);
    }

    // Mark migration as complete
    db.prepare(`
      INSERT OR REPLACE INTO migrations (name, applied_at) VALUES ('v3_tag_manager', datetime('now'))
    `).run();

    console.log('[Migration] v3 Tag Manager migration complete');
    console.log('[Migration] Tables created:', results.tablesCreated.join(', '));

    return results;
  } catch (error) {
    console.error('[Migration] Error:', error.message);
    results.errors.push(error.message);
    return results;
  }
}

/**
 * Check if migration has been applied
 * @param {Database} db - better-sqlite3 database instance
 * @returns {boolean}
 */
function isApplied(db) {
  try {
    const result = db.prepare(`
      SELECT 1 FROM migrations WHERE name = 'v3_tag_manager'
    `).get();
    return !!result;
  } catch (e) {
    return false;
  }
}

module.exports = { migrate, isApplied };
