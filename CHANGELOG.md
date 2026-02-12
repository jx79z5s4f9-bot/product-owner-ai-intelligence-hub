# Changelog

All notable changes to PO AI will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.1.0] - 2026-02-12

### Added
- **Onboarding wizard**: 3-step welcome flow for new users (detects Ollama, guides RTE setup)
- **Health check endpoint**: `GET /api/health` returns system status
- **Security hardening**: Helmet.js, CORS restrictions, rate limiting
- **Database migration**: Automatic migration to `~/ProductOwnerAI/database.db`
- **Donate link**: Subtle, dismissible support banner on home page
- **GitHub presence**: CONTRIBUTING.md, CHANGELOG.md, issue templates
- **Troubleshooting guide**: Common issues documented in README

### Changed
- Database location moved from project root to user home directory
- Reduced JSON body limit from 10MB to 2MB for security
- API rate limiting: 100 requests/minute general, 20/minute for LLM endpoints
- Template download now shows only main document types (log, meeting, artifact, idea) instead of all aliases

### Removed
- **Mood field** from document templates — was not part of the intended design

### Security
- Added Helmet.js for HTTP security headers
- Added CORS restriction to localhost only
- Added express-rate-limit to prevent abuse

## [1.0.0] - 2026-02-10

### Added
- Initial public release
- **Ingest**: Capture notes with smart template parsing, import `.pages` files
- **Ask**: Evidence-based Q&A with source citations
- **Search**: Full-text search with FTS5, tag and date filtering
- **Trends**: Timeline analysis of topics
- **Deep Analysis**: Heavy document processing with Dutch language support
- **Standup**: One-click daily summary generation
- **Navigator**: Browse all documents by RTE, type, date
- **Network**: Interactive relationship graph visualization
- **Tags**: Semantic tag management
- **Register**: Risk & action tracking with ownership
- **Stakeholders**: Auto-built people profiles from document mentions
- **Suggestions**: Review and approve auto-detected relationships
- **Glossary**: Dutch/English term definitions
- **Translate**: Dutch-English translation via LLM
- **Settings**: LLM provider configuration, extraction behavior
- **Maintenance**: Database health, reindexing, backup management

### Database Migrations
- v2: Intelligence System (rte_documents, extraction_queue)
- v3: Tag Manager (semantic_tags, document_tags)
- v4: Extraction Blocklist
- v5: Question History
- v6: Semantic Markers (question:, decision:, insight:, action:)
- v7: Lifecycle Tracking
- v8: Entity Model Consolidation
- v9: Register System + Stakeholder Fields
- v10: Configurable Content Types + Settings
- v11: Document Templates

---

## Migration Notes

### Upgrading to 1.1.0

Your database will automatically migrate to `~/ProductOwnerAI/database.db` on first run. The old database file will be renamed to `database.db.migrated` in the project folder.

No action required — the migration is automatic and preserves all data.

### New Dependencies

Run `npm install` after upgrading to install new security packages:
- `helmet` - HTTP security headers
- `cors` - Cross-origin request handling
