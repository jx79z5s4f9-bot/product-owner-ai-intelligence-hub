/**
 * Graph Builder Service
 * Builds in-memory graph from RTE actors and relationships
 * Uses graphology for graph operations
 *
 * Hybrid Edge System v2.0:
 * - Explicit edges: from document co-occurrences (relationships table)
 * - Implicit edges: from shared team/organization attributes
 * - Tag edges: from person-project co-occurrence in document tags
 */

const Graph = require('graphology');
const { getDb } = require('../db/connection');

class GraphBuilder {
  constructor() {
    this.graphs = new Map();  // Cache graphs by rteId

    // Edge weight configuration
    this.EDGE_WEIGHTS = {
      explicit: 0.5,      // Document co-occurrence (relationships)
      sameTeam: 0.25,     // Actors share same team
      sameOrg: 0.15,      // Actors share same organization
      tagCooccur: 0.3     // Person + project appear together in documents
    };
  }

  /**
   * Build a graph for an RTE from database
   * @param {number} rteId - RTE instance ID
   * @param {object} options - Build options
   * @returns {Graph}
   */
  build(rteId, options = {}) {
    const {
      refresh = false,
      includeUnapproved = false,
      actorTypes = null,
      edgeTypes = null,          // Filter by edge types: explicit, implicit_team, implicit_org
      minConfidence = 0,         // Minimum confidence for edges
      includeImplicit = true,    // Include implicit edges from shared attributes
      includeArchived = false,   // Include archived actors (default: exclude)
      groupBy = null             // Group nodes by: team, organization, type
    } = options;

    // Build cache key from options
    const cacheKey = `${rteId}:${JSON.stringify({
      actorTypes, edgeTypes, minConfidence, includeImplicit, includeArchived, groupBy
    })}`;

    // Return cached if available and not forcing refresh
    if (!refresh && this.graphs.has(cacheKey)) {
      return this.graphs.get(cacheKey);
    }

    const db = getDb();
    if (!db) {
      throw new Error('Database not available');
    }

    // Create new graph
    const graph = new Graph({ multi: true, allowSelfLoops: false });

    // 1. Load actors as nodes (synchronous with better-sqlite3)
    const actors = this.loadActors(db, rteId, actorTypes, includeArchived);
    for (const actor of actors) {
      graph.addNode(actor.id.toString(), {
        label: actor.name,
        type: actor.actor_type,
        role: actor.role,
        team: actor.team,
        organization: actor.organization,
        lastSeenAt: actor.last_seen_at,
        mentionCount: actor.mention_count || 1,
        // Visual attributes
        size: 10,
        color: this.getColorForType(actor.actor_type)
      });
    }

    // 2. Load explicit relationships as edges (from document co-occurrences)
    const relationships = this.loadRelationships(db, rteId, includeUnapproved);
    for (const rel of relationships) {
      const sourceId = rel.source_actor_id.toString();
      const targetId = rel.target_actor_id.toString();

      // Ensure both nodes exist
      if (graph.hasNode(sourceId) && graph.hasNode(targetId)) {
        try {
          graph.addEdge(sourceId, targetId, {
            label: rel.relationship_type,
            type: rel.relationship_type,
            edgeSource: 'explicit',  // Mark as explicit relationship
            context: rel.context,
            confidence: rel.llm_confidence || 1.0,
            strength: rel.strength || 1.0,
            source_file: rel.source_file || null,
            relationshipId: rel.id,
            weight: (rel.llm_confidence || 1.0) * (rel.strength || 1.0) * this.EDGE_WEIGHTS.explicit,
            color: this.getColorForRelationType(rel.relationship_type)
          });
        } catch (e) {
          // Edge might already exist
        }
      }
    }

    // 3. Add implicit edges from shared attributes (if enabled)
    if (includeImplicit) {
      this.addImplicitEdges(graph, actors);
      this.addTagCooccurrenceEdges(graph, db, rteId, actors);
    }

    // 4. Filter edges by type and confidence
    if (edgeTypes && edgeTypes.length > 0) {
      graph.edges().forEach(edge => {
        const edgeSource = graph.getEdgeAttribute(edge, 'edgeSource') || 'explicit';
        if (!edgeTypes.includes(edgeSource)) {
          graph.dropEdge(edge);
        }
      });
    }
    
    if (minConfidence > 0) {
      graph.edges().forEach(edge => {
        const confidence = graph.getEdgeAttribute(edge, 'confidence') || 1.0;
        if (confidence < minConfidence) {
          graph.dropEdge(edge);
        }
      });
    }

    // 5. Calculate graph metrics
    this.calculateMetrics(graph);

    // Cache the graph with options key
    this.graphs.set(cacheKey, graph);

    const implicitCount = includeImplicit ? this.countImplicitEdges(graph) : 0;
    console.log(`[GraphBuilder] Built graph for RTE ${rteId}: ${graph.order} nodes, ${graph.size} edges (${implicitCount} implicit)`);
    return graph;
  }

  /**
   * Add implicit edges between actors who share team or organization
   */
  addImplicitEdges(graph, actors) {
    // Group actors by team and organization
    const byTeam = {};
    const byOrg = {};

    for (const actor of actors) {
      if (actor.team) {
        if (!byTeam[actor.team]) byTeam[actor.team] = [];
        byTeam[actor.team].push(actor);
      }
      if (actor.organization) {
        if (!byOrg[actor.organization]) byOrg[actor.organization] = [];
        byOrg[actor.organization].push(actor);
      }
    }

    // Add edges for same team
    for (const [team, members] of Object.entries(byTeam)) {
      if (members.length < 2) continue;
      for (let i = 0; i < members.length; i++) {
        for (let j = i + 1; j < members.length; j++) {
          const sourceId = members[i].id.toString();
          const targetId = members[j].id.toString();

          // Only add if no explicit edge exists
          if (!this.hasExplicitEdge(graph, sourceId, targetId)) {
            try {
              graph.addEdge(sourceId, targetId, {
                label: 'same_team',
                type: 'same_team',
                edgeSource: 'implicit_team',
                context: `Both in team: ${team}`,
                weight: this.EDGE_WEIGHTS.sameTeam,
                color: '#10b981',  // Green for team connections
                style: 'dashed'
              });
            } catch (e) { /* edge exists */ }
          }
        }
      }
    }

    // Add edges for same organization (lower weight)
    for (const [org, members] of Object.entries(byOrg)) {
      if (members.length < 2) continue;
      for (let i = 0; i < members.length; i++) {
        for (let j = i + 1; j < members.length; j++) {
          const sourceId = members[i].id.toString();
          const targetId = members[j].id.toString();

          // Only add if no explicit or team edge exists
          if (!this.hasExplicitEdge(graph, sourceId, targetId) &&
              !this.hasEdgeOfType(graph, sourceId, targetId, 'same_team')) {
            try {
              graph.addEdge(sourceId, targetId, {
                label: 'same_org',
                type: 'same_org',
                edgeSource: 'implicit_org',
                context: `Both in org: ${org}`,
                weight: this.EDGE_WEIGHTS.sameOrg,
                color: '#f59e0b',  // Amber for org connections
                style: 'dotted'
              });
            } catch (e) { /* edge exists */ }
          }
        }
      }
    }
  }

  /**
   * Add edges from tag co-occurrence (person tagged with project on same documents)
   */
  addTagCooccurrenceEdges(graph, db, rteId, actors) {
    try {
      // Find person-project co-occurrences in document tags
      const cooccurrences = db.prepare(`
        SELECT
          dt1.tag_value as person,
          dt2.tag_value as project,
          COUNT(DISTINCT dt1.document_id) as doc_count
        FROM document_tags dt1
        JOIN document_tags dt2 ON dt1.document_id = dt2.document_id
        JOIN rte_documents rd ON dt1.document_id = rd.id
        WHERE dt1.tag_type = 'person'
          AND dt2.tag_type IN ('project', 'system', 'organization')
          AND rd.rte_id = ?
        GROUP BY dt1.tag_value, dt2.tag_value
        HAVING doc_count >= 2
      `).all(rteId);

      // Build lookup from actor name to ID
      const actorNameToId = {};
      for (const actor of actors) {
        actorNameToId[actor.name.toLowerCase()] = actor.id.toString();
      }

      // Add edges for strong person-project associations
      for (const cooc of cooccurrences) {
        const personId = actorNameToId[cooc.person.toLowerCase()];
        const projectId = actorNameToId[cooc.project.toLowerCase()];

        if (personId && projectId && personId !== projectId) {
          if (!this.hasExplicitEdge(graph, personId, projectId)) {
            try {
              graph.addEdge(personId, projectId, {
                label: 'works_on',
                type: 'works_on',
                edgeSource: 'tag_cooccurrence',
                context: `Tagged together in ${cooc.doc_count} documents`,
                docCount: cooc.doc_count,
                weight: Math.min(this.EDGE_WEIGHTS.tagCooccur * (cooc.doc_count / 5), 0.5),
                color: '#8b5cf6',  // Purple for tag-derived connections
                style: 'dashed'
              });
            } catch (e) { /* edge exists */ }
          }
        }
      }
    } catch (e) {
      console.log('[GraphBuilder] Tag co-occurrence edges skipped:', e.message);
    }
  }

  /**
   * Check if explicit edge exists between two nodes
   */
  hasExplicitEdge(graph, source, target) {
    try {
      const edges = graph.edges(source, target);
      for (const edge of edges) {
        if (graph.getEdgeAttribute(edge, 'edgeSource') === 'explicit') {
          return true;
        }
      }
      return false;
    } catch (e) {
      return false;
    }
  }

  /**
   * Check if edge of specific type exists
   */
  hasEdgeOfType(graph, source, target, type) {
    try {
      const edges = graph.edges(source, target);
      for (const edge of edges) {
        if (graph.getEdgeAttribute(edge, 'type') === type) {
          return true;
        }
      }
      return false;
    } catch (e) {
      return false;
    }
  }

  /**
   * Count implicit edges in graph
   */
  countImplicitEdges(graph) {
    let count = 0;
    graph.forEachEdge((edge, attrs) => {
      if (attrs.edgeSource && attrs.edgeSource !== 'explicit') {
        count++;
      }
    });
    return count;
  }

  /**
   * Load actors from database
   * @param {Database} db
   * @param {number} rteId
   * @param {Array<string>|null} actorTypes - Filter by actor types (null = all)
   * @param {boolean} includeArchived - Include archived actors (default: false)
   */
  loadActors(db, rteId, actorTypes = null, includeArchived = false) {
    // better-sqlite3 uses synchronous API
    const archivedFilter = includeArchived ? '' : 'AND archived_at IS NULL';
    try {
      let query = `
        SELECT id, name, actor_type, role, team, organization, description, 
               metadata_json, last_seen_at, mention_count
        FROM rte_actors 
        WHERE rte_id = ? ${archivedFilter}
      `;
      let params = [rteId];
      
      if (actorTypes && actorTypes.length > 0) {
        const placeholders = actorTypes.map(() => '?').join(',');
        query += ` AND actor_type IN (${placeholders})`;
        params = params.concat(actorTypes);
      }
      
      const rows = db.prepare(query).all(...params);
      return rows || [];
    } catch (err) {
      console.error('[GraphBuilder] Error loading actors:', err.message);
      return [];
    }
  }

  /**
   * Load relationships from database
   */
  loadRelationships(db, rteId, includeUnapproved) {
    const approvalFilter = includeUnapproved ? '' : 'AND is_approved = 1';
    
    try {
      const rows = db.prepare(`
        SELECT id, source_actor_id, target_actor_id, relationship_type, context, strength, llm_confidence,
               source_document_id, (SELECT filepath FROM rte_documents WHERE id = source_document_id) as source_file
        FROM rte_relationships 
        WHERE rte_id = ? ${approvalFilter}
      `).all(rteId);
      return rows || [];
    } catch (err) {
      console.error('[GraphBuilder] Error loading relationships:', err.message);
      return [];
    }
  }

  /**
   * Calculate graph metrics and store on nodes
   */
  calculateMetrics(graph) {
    if (graph.order === 0) return;

    // Calculate degree for each node
    graph.forEachNode((node) => {
      const degree = graph.degree(node);
      const inDegree = graph.inDegree(node);
      const outDegree = graph.outDegree(node);
      
      graph.setNodeAttribute(node, 'degree', degree);
      graph.setNodeAttribute(node, 'inDegree', inDegree);
      graph.setNodeAttribute(node, 'outDegree', outDegree);
      
      // Adjust size based on degree
      graph.setNodeAttribute(node, 'size', 10 + degree * 2);
    });
  }

  /**
   * Get color for actor type
   * Standardised design system colors
   */
  getColorForType(type) {
    const colors = {
      'person': '#10b981',       // Emerald - primary actors
      'team': '#06b6d4',         // Cyan - organizational units
      'system': '#f59e0b',       // Amber - technical systems
      'organization': '#8b5cf6', // Purple - organizational hierarchy
      'role': '#6366f1',         // Indigo - roles/positions
      'project': '#06b6d4',      // Cyan - same as team
      'location': '#ec4899',     // Pink - geographic
      'technology': '#14b8a6',   // Teal - tech stack
      'unknown': '#6b7280'       // Gray - unclassified
    };
    return colors[type] || colors.unknown;
  }

  /**
   * Get color for relationship type
   */
  getColorForRelationType(type) {
    const colors = {
      'works_with': '#4CAF50',
      'member_of': '#2196F3',
      'owns': '#FF9800',
      'reports_to': '#9C27B0',
      'depends_on': '#F44336',
      'blocks': '#E91E63',
      'related_to': '#9E9E9E'
    };
    return colors[type] || colors.related_to;
  }

  /**
   * Get graph as JSON for visualization
   * @param {number} rteId
   * @param {object} options - { refresh, actorTypes }
   * @returns {{nodes: Array, edges: Array}}
   */
  toJSON(rteId, options = {}) {
    const graph = this.build(rteId, options);
    const { groupBy } = options;
    
    const nodes = [];
    const edges = [];
    const parentGroups = new Set();

    graph.forEachNode((node, attributes) => {
      const nodeData = {
        data: {
          id: node,
          label: attributes.label,
          type: attributes.type,
          role: attributes.role,
          team: attributes.team,
          organization: attributes.organization,
          lastSeenAt: attributes.lastSeenAt || null,
          mentionCount: attributes.mentionCount || 1,
          degree: attributes.degree || 0,
          size: attributes.size || 10,
          color: attributes.color
        }
      };
      
      // C.12 Compound Nodes: assign parent when groupBy is set
      if (groupBy) {
        const groupValue = attributes[groupBy];
        if (groupValue) {
          const parentId = `group_${groupBy}_${groupValue}`;
          nodeData.data.parent = parentId;
          parentGroups.add(groupValue);
        }
      }
      
      nodes.push(nodeData);
    });
    
    // C.12: Add parent (compound) nodes for each group
    if (groupBy && parentGroups.size > 0) {
      for (const groupName of parentGroups) {
        nodes.push({
          data: {
            id: `group_${groupBy}_${groupName}`,
            label: groupName,
            type: '__group',
            groupBy: groupBy,
            isCompound: true
          }
        });
      }
    }

    graph.forEachEdge((edge, attributes, source, target) => {
      const sourceLabel = graph.hasNode(source) ? graph.getNodeAttribute(source, 'label') : source;
      const targetLabel = graph.hasNode(target) ? graph.getNodeAttribute(target, 'label') : target;
      
      edges.push({
        data: {
          id: edge,
          source: source,
          target: target,
          label: attributes.label,
          type: attributes.type,
          edgeSource: attributes.edgeSource || 'explicit',
          context: attributes.context,
          confidence: attributes.confidence || 1.0,
          strength: attributes.strength || 1.0,
          source_file: attributes.source_file || null,
          source_label: sourceLabel,
          target_label: targetLabel,
          weight: attributes.weight || 1,
          color: attributes.color,
          style: attributes.style || 'solid'
        }
      });
    });

    return { nodes, edges };
  }

  /**
   * Get graph statistics including implicit edge counts
   */
  getStats(rteId) {
    const graph = this.build(rteId);

    const stats = {
      nodeCount: graph.order,
      edgeCount: graph.size,
      explicit: 0,
      implicitTeam: 0,
      implicitOrg: 0,
      tagCooccurrence: 0,
      byNodeType: {},
      byEdgeType: {}
    };

    graph.forEachNode((node, attrs) => {
      const type = attrs.type || 'unknown';
      stats.byNodeType[type] = (stats.byNodeType[type] || 0) + 1;
    });

    graph.forEachEdge((edge, attrs) => {
      const edgeSource = attrs.edgeSource || 'explicit';
      if (edgeSource === 'explicit') stats.explicit++;
      else if (edgeSource === 'implicit_team') stats.implicitTeam++;
      else if (edgeSource === 'implicit_org') stats.implicitOrg++;
      else if (edgeSource === 'tag_cooccurrence') stats.tagCooccurrence++;

      const type = attrs.type || 'unknown';
      stats.byEdgeType[type] = (stats.byEdgeType[type] || 0) + 1;
    });

    return stats;
  }

  /**
   * Find shortest path between two actors
   */
  findPath(rteId, sourceId, targetId) {
    const graph = this.build(rteId);
    
    if (!graph.hasNode(sourceId.toString()) || !graph.hasNode(targetId.toString())) {
      return null;
    }

    // Simple BFS for shortest path
    const visited = new Set();
    const queue = [[sourceId.toString()]];
    
    while (queue.length > 0) {
      const path = queue.shift();
      const node = path[path.length - 1];
      
      if (node === targetId.toString()) {
        return path;
      }
      
      if (visited.has(node)) continue;
      visited.add(node);
      
      graph.forEachNeighbor(node, (neighbor) => {
        if (!visited.has(neighbor)) {
          queue.push([...path, neighbor]);
        }
      });
    }
    
    return null;  // No path found
  }

  /**
   * Find all neighbors of an actor
   */
  getNeighbors(rteId, actorId, depth = 1) {
    const graph = this.build(rteId);
    const nodeId = actorId.toString();
    
    if (!graph.hasNode(nodeId)) {
      return { nodes: [], edges: [] };
    }

    const nodes = new Set([nodeId]);
    const edges = new Set();
    
    let currentLevel = [nodeId];
    for (let d = 0; d < depth; d++) {
      const nextLevel = [];
      for (const node of currentLevel) {
        graph.forEachNeighbor(node, (neighbor) => {
          if (!nodes.has(neighbor)) {
            nodes.add(neighbor);
            nextLevel.push(neighbor);
          }
        });
        graph.forEachEdge(node, (edge, attrs, source, target) => {
          if (nodes.has(source) || nodes.has(target)) {
            edges.add(edge);
          }
        });
      }
      currentLevel = nextLevel;
    }

    // Build result with full node/edge data
    const result = { nodes: [], edges: [] };
    
    for (const nodeId of nodes) {
      const attrs = graph.getNodeAttributes(nodeId);
      result.nodes.push({
        data: {
          id: nodeId,
          label: attrs.label,
          type: attrs.type,
          color: attrs.color,
          size: attrs.size
        }
      });
    }
    
    for (const edgeId of edges) {
      const attrs = graph.getEdgeAttributes(edgeId);
      const [source, target] = graph.extremities(edgeId);
      result.edges.push({
        data: {
          id: edgeId,
          source,
          target,
          label: attrs.label,
          color: attrs.color
        }
      });
    }

    return result;
  }

  /**
   * Get most connected actors (hubs)
   */
  getHubs(rteId, limit = 10) {
    const graph = this.build(rteId);
    
    const hubs = [];
    graph.forEachNode((node, attrs) => {
      hubs.push({
        id: node,
        name: attrs.label,
        type: attrs.type,
        degree: attrs.degree || graph.degree(node)
      });
    });

    return hubs
      .sort((a, b) => b.degree - a.degree)
      .slice(0, limit);
  }

  /**
   * Get isolated actors (no relationships)
   */
  getIsolated(rteId) {
    const graph = this.build(rteId);
    
    const isolated = [];
    graph.forEachNode((node, attrs) => {
      if (graph.degree(node) === 0) {
        isolated.push({
          id: node,
          name: attrs.label,
          type: attrs.type
        });
      }
    });

    return isolated;
  }

  /**
   * Invalidate cached graph
   */
  invalidate(rteId) {
    this.graphs.delete(rteId);
    console.log(`[GraphBuilder] Invalidated cache for RTE ${rteId}`);
  }

  /**
   * Clear all cached graphs
   */
  clearCache() {
    this.graphs.clear();
    console.log('[GraphBuilder] Cleared all graph caches');
  }
}

module.exports = new GraphBuilder();
