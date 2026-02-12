/**
 * EXAMPLE: Add Roadmap Projects/Systems as Actors
 * 
 * This is an example script showing how to batch-import actors.
 * Modify the actors array with your own projects/systems.
 */

const Database = require('better-sqlite3');
const path = require('path');

const dbPath = path.join(__dirname, '..', 'database.db');
const db = new Database(dbPath);

const rteId = 1; // Change to your RTE ID

const actors = [
  // Main categories/programs as 'system' type
  { name: 'Procesverbetering MA', type: 'system', description: 'Procesverbeteringsinitiatieven voor Matching Autoriteit' },
  { name: 'PMIV', type: 'system', description: 'Programma Modernisering Identiteitsvaststelling - 5 experimenten Proces Innovatie' },
  { name: 'TIV', type: 'system', description: 'Toekomst Identiteitsvaststelling - Verrijkingen systeem' },
  { name: 'Register Identiteitsvaststellingen', type: 'system', description: 'Registratiesysteem voor identiteitsvaststellingen' },
  
  // Procesverbetering MA sub-projects
  { name: 'Vernieuwde signaalverwerking', type: 'project', description: 'Modernisering van signaalverwerking binnen MA' },
  { name: 'Verstevigde incident- en serviceverzoekbehandeling', type: 'project', description: 'Verbetering incident en service request handling' },
  { name: 'Identiteitsbeeld/dossier Identiteitsvaststelling Personen', type: 'project', description: 'Persoons-identiteitsbeeld en dossiervorming' },
  { name: 'Vernieuwde registratie- en monitorings-ondersteuning', type: 'project', description: 'Modernisering registratie en monitoring ondersteuning' },
  { name: 'Moderne matchings-algoritmen', type: 'project', description: 'Ontwikkeling nieuwe matching algoritmen' },
  { name: 'Schermen MA', type: 'project', description: 'Schermen Matching Autoriteit (evt. TIV / vernieuwing SKDB)' },
  
  // PMIV 5 experimenten
  { name: 'Experiment 1: Registratie bij staandehouding/aanhouding', type: 'project', description: 'PMIV experiment - registratie bij staandehouding en/of aanhouding (review Q3)' },
  { name: 'Experiment 2: Bepalen en communiceren vaststelling', type: 'project', description: 'PMIV experiment - bepalen en communiceren vaststelling (Q4)' },
  { name: 'Experiment 3: Kritieke momenten dienstverlening MA', type: 'project', description: 'PMIV experiment - Kritieke momenten en dienstverlening Matching Autoriteit (Done Q1?)' },
  { name: 'Experiment 4: Actief herstel persoonverwisseling', type: 'project', description: 'PMIV experiment - Actief herstel voor slachtoffers van persoonverwisseling in de strafrechtsketen (primair PS)' },
  { name: 'Experiment 5: Afhandeling bijna-overeenkomsten', type: 'project', description: 'PMIV experiment - Onderzoek afhandeling bijna-overeenkomsten (na BRP koppeling)' },
  
  // TIV/PMIV Verrijkingen - BRP integrations
  { name: 'Verrijken met BRP', type: 'project', description: 'BRP verrijking functionaliteit (in progress Q2-Q3 2026)' },
  { name: 'Abonneren BRP', type: 'project', description: 'BRP abonnement functionaliteit' },
  { name: 'Opzeggen abonnement', type: 'project', description: 'Opzeggen BRP abonnement' },
  { name: 'Verwerken mutaties BRP', type: 'project', description: 'Verwerken van BRP mutaties (in progress Q3 2026)' },
  { name: 'Terugmelden BRP', type: 'project', description: 'Terugmelden naar BRP (in progress Q3 2026)' },
  { name: 'Realtime matchen', type: 'project', description: 'Realtime matching functionaliteit (in progress Q3 2026)' },
  { name: 'Synchroon bevragen', type: 'project', description: 'Synchrone bevraging functionaliteit' },
  
  // Register Identiteitsvaststellingen sub-projects
  { name: 'Registreren ID vaststelling', type: 'project', description: 'Registreren van identiteitsvaststellingen' },
  { name: 'Toekennen IVI', type: 'project', description: 'Toekennen Identiteits Verificatie Index' },
  { name: 'Bepaal kwaliteit', type: 'project', description: 'Kwaliteitsbepaling van identiteitsvaststellingen' },
  { name: 'Verstrekken ID vaststelling', type: 'project', description: 'Verstrekken van identiteitsvaststellingen' },
  { name: 'Vernietigen Registratie ID vaststelling', type: 'project', description: 'Vernietigen van registraties identiteitsvaststellingen' },
  
  // External systems
  { name: 'BRP', type: 'system', description: 'Basisregistratie Personen - Landelijke bevolkingsregistratie' },
  { name: 'SKDB', type: 'system', description: 'Strafketen Database' },
  { name: 'MA', type: 'system', description: 'Matching Autoriteit - Hoofdsysteem' }
];

console.log('[Roadmap Import] Adding roadmap actors...\n');

const stmt = db.prepare(`
  INSERT INTO rte_actors (rte_id, name, actor_type, description, created_at, updated_at)
  VALUES (?, ?, ?, ?, datetime('now'), datetime('now'))
  ON CONFLICT(rte_id, actor_type, name) DO UPDATE SET
    description = excluded.description,
    updated_at = datetime('now')
`);

let added = 0;
const byType = {};

for (const a of actors) {
  try {
    stmt.run(rteId, a.name, a.type, a.description);
    added++;
    byType[a.type] = (byType[a.type] || 0) + 1;
    console.log(`  ✓ ${a.type}: ${a.name}`);
  } catch (e) {
    console.log(`  ✗ Error: ${a.name} - ${e.message}`);
  }
}

console.log('\n[Roadmap Import] Summary:');
console.log(`  Total added: ${added}`);
Object.entries(byType).forEach(([type, count]) => {
  console.log(`    ${type}: ${count}`);
});

db.close();
console.log('\n[Roadmap Import] Complete!');
