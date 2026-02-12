-- Setup RTEs for PO AI
-- Run with: sqlite3 database.db < scripts/setup-rtes.sql

-- Clear old data
DELETE FROM rte_actors;
DELETE FROM rte_relationships;
DELETE FROM rte_relationship_suggestions;
DELETE FROM rte_instances;

-- Create correct RTEs
INSERT INTO rte_instances (id, name, description, status, metadata_json, created_at, updated_at) VALUES 
(1, 'My Product', 'Your main product — rename to your actual product', 'active', '{"base_path": "~/ProductOwnerAI/rte/my-product", "read_only": false}', datetime('now'), datetime('now'));

INSERT INTO rte_instances (id, name, description, status, metadata_json, created_at, updated_at) VALUES 
(2, 'My Portfolio', 'Portfolio-level oversight — rename as needed', 'active', '{"base_path": "~/ProductOwnerAI/rte/my-portfolio", "read_only": false}', datetime('now'), datetime('now'));

INSERT INTO rte_instances (id, name, description, status, metadata_json, created_at, updated_at) VALUES 
(3, 'Orchestrator', 'System files - AI context and instructions (read-only)', 'system', '{"base_path": "~/gym-app/apps/po-ai", "read_only": true}', datetime('now'), datetime('now'));
