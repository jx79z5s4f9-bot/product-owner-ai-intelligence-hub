# Network Topology - PO AI

## Overview

The Network Topology view (`/network`) visualizes relationships between actors (people, teams, systems, organizations, projects, etc.) extracted from your documents. It uses **Cytoscape.js** for rendering and **Graphology** for graph algorithms.

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         Frontend                                │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │  network.ejs                                              │  │
│  │  - Cytoscape.js visualization                             │  │
│  │  - Sidebar controls (filters, search, legend)             │  │
│  │  - Node selection & details panel                         │  │
│  │  - Export (PNG/JSON/CSV)                                  │  │
│  └───────────────────────────────────────────────────────────┘  │
│                              │                                  │
│                    fetch(/api/rte/:id/graph)                    │
│                              ▼                                  │
├─────────────────────────────────────────────────────────────────┤
│                          Backend                                │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │  routes/rte.js                                            │  │
│  │  - GET /api/rte/:id/graph         → Full graph            │  │
│  │  - GET /api/rte/:id/graph/neighbors/:actorId              │  │
│  │  - GET /api/rte/:id/graph/hubs    → High-degree nodes     │  │
│  │  - GET /api/rte/:id/graph/isolated → Disconnected nodes   │  │
│  │  - GET /api/rte/:id/graph/path/:from/:to                  │  │
│  └───────────────────────────────────────────────────────────┘  │
│                              │                                  │
│                   graphBuilder.toJSON(rteId)                    │
│                              ▼                                  │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │  services/graph-builder.js                                │  │
│  │  - Uses Graphology library                                │  │
│  │  - Caches graphs in memory (per RTE)                      │  │
│  │  - Builds 3 types of edges (see below)                    │  │
│  │  - Calculates node metrics (degree, size)                 │  │
│  └───────────────────────────────────────────────────────────┘  │
│                              │                                  │
│                     db.prepare().all()                          │
│                              ▼                                  │
├─────────────────────────────────────────────────────────────────┤
│                        Database                                 │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │  rte_actors       │ id, name, actor_type, team, org       │  │
│  │  rte_relationships│ source_actor_id, target_actor_id,     │  │
│  │                   │ relationship_type, context, strength  │  │
│  │  document_tags    │ document_id, tag_type, tag_value      │  │
│  │  rte_documents    │ id, rte_id, content                   │  │
│  └───────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

---

## Data Sources

### 1. Actors (Nodes)
**Table:** `rte_actors`

| Field | Description |
|-------|-------------|
| `id` | Unique identifier |
| `name` | Display name |
| `actor_type` | person, role, team, system, organization, project, location, technology |
| `role` | Job role (for persons) |
| `team` | Team affiliation |
| `organization` | Organization affiliation |
| `description` | Free-text description |

**Source:** Extracted from documents by LLM during Deep Analysis or manual creation.

### 2. Relationships (Edges)
**Table:** `rte_relationships`

| Field | Description |
|-------|-------------|
| `source_actor_id` | Origin actor |
| `target_actor_id` | Target actor |
| `relationship_type` | works_with, reports_to, manages, member_of, owns, uses, depends_on, related_to |
| `context` | Descriptive context from document |
| `strength` | 0.0-1.0 edge strength |
| `llm_confidence` | 0.0-1.0 extraction confidence |
| `is_approved` | Boolean (1 = human-verified) |

**Source:** Extracted from document analysis when two actors appear in related context.

### 3. Tag Co-occurrences (Implicit Edges)
**Table:** `document_tags`

When a person and project/system are tagged together on 2+ documents, an implicit edge is inferred.

---

## Edge Types (Hybrid System)

The graph uses a **hybrid edge system** with 3 sources:

| Edge Source | Weight | Description | Color |
|-------------|--------|-------------|-------|
| `explicit` | 0.50 | From document co-occurrence (relationships table) | By relationship type |
| `implicit_team` | 0.25 | Actors share same team attribute | Green `#10b981` |
| `implicit_org` | 0.15 | Actors share same organization | Amber `#f59e0b` |
| `tag_cooccurrence` | 0.30 | Person + project tagged together in docs | Purple `#8b5cf6` |

**Edge priority:** Explicit > Team > Org > Tag (no duplicates)

---

## Node Styling

### Size
`size = 10 + degree * 2`

Nodes with more connections appear larger.

### Colors by Actor Type

| Type | Color | Hex |
|------|-------|-----|
| Person | Green | `#4CAF50` |
| Role | Blue | `#2196F3` |
| Team | Orange | `#FF9800` |
| System | Purple | `#9C27B0` |
| Organization | Red | `#F44336` |
| Project | Cyan | `#00BCD4` |
| Location | Pink | `#ec4899` |
| Technology | Teal | `#14b8a6` |

---

## Layout Algorithms

Available layouts (toggle with "Layout" button):

| Layout | Description | Best For |
|--------|-------------|----------|
| `cose` | Force-directed (default) | General exploration |
| `circle` | Nodes on circle | Comparing node counts |
| `grid` | Regular grid | Many isolated nodes |
| `concentric` | Rings by degree | Finding hubs |
| `breadthfirst` | Tree structure | Hierarchies |

### COSE Parameters (Current)
```javascript
nodeRepulsion: 8000,
idealEdgeLength: 100,
edgeElasticity: 100,
gravity: 0.25,
numIter: 1000
```

---

## Known UX Issues

### 1. **Visual Crowding**
- Many nodes/edges overlap making labels unreadable
- High-degree nodes create "hairballs"
- No clustering or grouping

### 2. **No Edge Labels**
- Relationship types not visible without clicking
- Hard to distinguish edge types

### 3. **Information Overload**
- All 8 actor types shown by default
- No importance/relevance filtering
- No time-based filtering

### 4. **No Context**
- Can't see which documents created relationships
- No drill-down to source evidence

---

## Questions to Guide Improvement

### Purpose & Audience
1. **Who uses this view?** (PO, architect, manager?)
2. **What questions should it answer?**
   - "Who works with whom?"
   - "What systems does person X interact with?"
   - "What are the key hubs/bottlenecks?"
   - "How are teams connected?"

### Data Quality
3. **How many actors/relationships in your RTE currently?**
4. **Are there many false-positive edges from LLM extraction?**
5. **Is actor deduplication working? (same person, different names)**

### Interaction Goals
6. **Do you need to edit relationships here, or just explore?**
7. **Should clicking a node show source documents?**
8. **Would timeline/date filtering help? (relationships over time)**

### Layout Preferences
9. **Would grouping by team/organization help?**
10. **Should systems be visually separated from people?**
11. **Would a hierarchical view (org chart) be useful?**

---

## Improvement Ideas

### Quick Wins
- [ ] **Increase node spacing** - raise `nodeRepulsion` to 15000+
- [ ] **Show edge labels on hover** - relationship type tooltip
- [ ] **Default to fewer types** - start with person+system only
- [ ] **Add node search highlighting** - pulse animation

### Medium Effort
- [ ] **Cluster by team** - group nodes visually
- [ ] **Edge bundling** - reduce visual clutter
- [ ] **Importance filter** - hide low-confidence edges
- [ ] **Source document links** - click edge → see evidence

### Major Features
- [ ] **Multiple views** - org chart, system diagram, person network
- [ ] **Time slider** - show relationships by date range
- [ ] **Compare RTEs** - overlay two graphs
- [ ] **AI summary** - "Key relationships: X works closely with Y on Z"

---

## API Reference

### GET /api/rte/:rteId/graph
Full graph for RTE.

**Query params:**
- `refresh=true` - Force rebuild (skip cache)
- `actorTypes=person,system` - Filter node types

**Response:**
```json
{
  "nodes": [
    { "data": { "id": "1", "label": "Jan", "type": "person", "color": "#4CAF50", "size": 14 } }
  ],
  "edges": [
    { "data": { "source": "1", "target": "2", "label": "works_with", "color": "#4CAF50" } }
  ]
}
```

### GET /api/rte/:rteId/graph/hubs
Top connected nodes.

### GET /api/rte/:rteId/graph/isolated
Nodes with no connections.

### GET /api/rte/:rteId/graph/neighbors/:actorId
Subgraph of actor + neighbors (depth=2).

---

## Files

| File | Purpose |
|------|---------|
| `views/network.ejs` | Frontend UI (1116 lines) |
| `services/graph-builder.js` | Graph construction (634 lines) |
| `routes/rte.js` | API endpoints (lines 531-655) |

---

## Next Steps

Based on your answers to the questions above, we can prioritize:

1. **Readability** → Increase spacing, reduce default types, edge bundling
2. **Actionability** → Source document links, confidence filtering
3. **Insight** → Clustering, hub detection, AI summaries
4. **Workflow** → Edit relationships inline, batch operations
