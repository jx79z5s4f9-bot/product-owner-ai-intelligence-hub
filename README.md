# 🎯 PO AI — Product Ownership Intelligence Hub

A local-first, AI-powered knowledge base for Product Owners and Agile practitioners. Ingest meeting notes, daily logs, and artifacts — then search, analyze, and track decisions across your entire product history.

**Everything runs on your machine. Your data never leaves your laptop.**

## Why PO AI?

Product Owners drown in information: Slack threads, meeting notes, decisions made verbally, risks mentioned in passing. PO AI captures all of it, extracts meaning automatically, and gives you a searchable, analyzable knowledge base — without sending anything to the cloud.

- 📥 **Ingest** meeting notes, logs, and documents (paste, upload, or import from Apple Pages)
- 🔍 **Search** with full-text + semantic search across your entire history
- ❓ **Ask** natural language questions with evidence-based answers citing sources
- 📈 **Track trends** — see how topics evolve over weeks and months
- 📋 **Register** risks, actions, blockers with owners, due dates, and severity
- 🕸️ **Visualize** relationships between people, topics, and decisions
- 👥 **Profile stakeholders** — auto-built from document mentions
- ☀️ **Standup summaries** — instant "what happened yesterday" reports
- 🌐 **Dutch ↔ English** translation for multilingual teams

## Features

### Core Actions
| Feature | Description |
|---------|-------------|
| **Ingest** | Capture notes with smart template parsing. Import `.pages` files, paste text, or upload. Auto-extracts dates, document types, and metadata. |
| **Ask** | Evidence-based Q&A — ask questions, get answers with source citations and confidence scores. |
| **Search** | Full-text search with tag, date, and semantic marker filters. |
| **Trends** | Timeline analysis of topics across your document history. |
| **Deep Analysis** | Heavy document processing — architecture extraction, relationship mapping (supports Dutch). |
| **Standup** | One-click daily summary from recent activity. |

### Knowledge Tools
| Feature | Description |
|---------|-------------|
| **Navigator** | Browse all documents by RTE, type, date, and tags. |
| **Network** | Interactive relationship graph — people, topics, decisions. |
| **Tags** | Manage document categories and labels. |
| **Register** | Risk & Action tracking — ownership, due dates, severity, response threads. |
| **Stakeholders** | Auto-generated people profiles from document mentions. |
| **Suggestions** | Review and approve auto-detected relationships. |
| **Glossary** | Team/product term definitions. |

### System
| Feature | Description |
|---------|-------------|
| **Translate** | Dutch ↔ English translation via LLM. |
| **Settings** | Configure LLM providers, models, and extraction behavior. |
| **Maintenance** | Database health, reindexing, backup management. |

## Architecture

```
┌─────────────────────────────────────────────────┐
│                   Browser UI                     │
│              (EJS templates + JS)                │
├─────────────────────────────────────────────────┤
│                Express.js API                    │
│         18 route modules + middleware            │
├──────────┬──────────┬───────────────────────────┤
│  SQLite  │  FTS5    │    LLM Manager            │
│   (DB)   │ (Search) │  (Ollama / Mistral /      │
│          │          │   GitHub Copilot)          │
└──────────┴──────────┴───────────────────────────┘
```

- **Database**: SQLite via `better-sqlite3` — zero config, single file
- **Search**: FTS5 full-text search — no external search server needed
- **LLM**: Pluggable — Ollama (local, default), Mistral API, or GitHub Copilot
- **Background**: Extraction worker polls for new documents, auto-extracts entities, relationships, and semantic markers
- **Backup**: Automated daily database backups via `node-cron`

## Prerequisites

- **Node.js** ≥ 18
- **Ollama** (recommended) — for local LLM inference
  - Install: https://ollama.ai
  - Pull a model: `ollama pull mistral` or `ollama pull aya`

## Quick Start

```bash
# Clone the repo
git clone https://github.com/YOUR_USERNAME/po-ai.git
cd po-ai

# Install dependencies
npm install

# (Optional) Configure environment
cp .env.example .env
# Edit .env with your settings

# Start the app
npm start

# Open in browser
open http://localhost:3001
```

On first run, the database is auto-created with all tables and migrations.

## Configuration

Copy `.env.example` to `.env`:

```dotenv
# Server port (default: 3001)
PORT=3001

# Ollama host (default: http://localhost:11434)
OLLAMA_HOST=http://localhost:11434

# Optional: Mistral API key (for cloud LLM)
MISTRAL_API_KEY=your-key-here

# Optional: GitHub token (for Copilot LLM provider)
GITHUB_TOKEN=your-token-here
```

LLM model selection is also configurable via the **Settings** page in the UI.

## Project Structure

```
├── local-app.js          # Express server entry point
├── db/
│   ├── connection.js     # SQLite connection + initialization
│   └── migrations/       # Database schema migrations
├── routes/               # API route handlers (18 modules)
├── services/
│   ├── llm-manager.js    # Multi-provider LLM abstraction
│   ├── extraction-worker.js  # Background entity/relationship extraction
│   ├── entity-extractor.js   # NLP entity extraction
│   ├── graph-builder.js      # Relationship graph construction
│   ├── sqlite-vector-search.js  # FTS5 search engine
│   ├── backup-service.js     # Automated daily backups
│   └── file-saver.js         # Document file management
├── views/                # EJS templates (one per page)
├── public/               # Static assets (CSS, JS, images)
├── config/               # LLM configuration
├── scripts/              # Utility scripts (migrations, seeding)
└── docs/                 # Architecture documentation
```

## RTE (Release Train Engineer) Model

PO AI organizes documents by **RTE** — your product, team, or project context. Each RTE has its own document folder at `~/ProductOwnerAI/rte/{name}/` with subdirectories for logs, meetings, artifacts, and ideas.

You can manage multiple RTEs and switch between them in the UI.

## License

MIT — see [LICENSE](LICENSE).
