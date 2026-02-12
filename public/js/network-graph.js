/**
 * Contextual Network Graph - Actor-Network Theory Visualization
 * 
 * Principles:
 * - All documents/meetings/decisions are actors (nodes)
 * - Node importance = relational density (connections)
 * - Query-driven: start from user question, radiate outward
 * - No forced hierarchies - pure network exploration
 */

class NetworkGraph {
  constructor(svgId, options = {}) {
    this.svg = d3.select(`#${svgId}`);
    this.svgId = svgId;
    this.width = options.width || 1400;
    this.height = options.height || 900;
    this.source = options.source || 'po-ai';

    // Network data
    this.nodes = [];
    this.links = [];
    this.nodeMap = new Map(); // id -> node object
    
    // Selected/expanded nodes
    this.queryNode = null;
    this.expandedNodes = new Set();
    this.selectedNode = null;

    // Layout
    this.simulation = null;
    this.linkGroup = null;
    this.nodeGroup = null;

    // Colors by edge type
    this.edgeColors = {
      'reference': '#60a5fa',      // Blue - explicit reference
      'temporal': '#22c55e',       // Green - same sprint/time
      'semantic': '#a855f7',       // Purple - semantic similarity
      'causal': '#f97316',         // Orange - cause/effect
      'contains': '#64748b'        // Gray - hierarchy (if needed)
    };

    // Node categories
    this.nodeColors = {
      'epic': '#3b82f6',
      'feature': '#06b6d4',
      'story': '#22c55e',
      'meeting': '#eab308',
      'sprint': '#8b5cf6',
      'architecture': '#f97316',
      'business': '#ef4444',
      'workflow': '#60a5fa',
      'template': '#a855f7',
      'query': '#ec4899'  // Pink for query node
    };

    this.initialize();
  }

  initialize() {
    // Set SVG dimensions
    this.svg
      .attr('width', '100%')
      .attr('height', this.height)
      .attr('viewBox', `0 0 ${this.width} ${this.height}`)
      .attr('preserveAspectRatio', 'xMidYMid meet')
      .attr('xmlns:xlink', 'http://www.w3.org/1999/xlink');

    // Create main group
    this.mainGroup = this.svg.append('g').attr('class', 'network-container');

    // Add zoom/pan
    this.zoom = d3.zoom()
      .scaleExtent([0.2, 4])
      .on('zoom', (event) => {
        this.mainGroup.attr('transform', event.transform);
      });
    this.svg.call(this.zoom);

    // Create link and node groups
    this.linkGroup = this.mainGroup.append('g').attr('class', 'links');
    this.nodeGroup = this.mainGroup.append('g').attr('class', 'nodes');

    // Show empty state
    this.showEmptyMessage();
  }

  showEmptyMessage() {
    this.svg.selectAll('.ant-empty').remove();

    const emptyGroup = this.svg
      .append('g')
      .attr('class', 'ant-empty');

    emptyGroup
      .append('image')
      .attr('href', '/ant-sketch.svg')
      .attr('xlink:href', '/ant-sketch.svg')
      .attr('x', 0)
      .attr('y', 0)
      .attr('width', this.width)
      .attr('height', this.height)
      .attr('preserveAspectRatio', 'xMidYMid meet');

    emptyGroup
      .append('text')
      .attr('x', this.width / 2)
      .attr('y', this.height - 24)
      .attr('text-anchor', 'middle')
      .attr('fill', '#9ca3af')
      .attr('font-size', '12px')
      .text('Submit a query to render the live network topology');
  }

  /**
   * Load network from query results
   * Called when user submits a prompt
   */
  async loadFromQuery(query, contextDocs) {
    this.clear();

    // Create query node at center
    this.queryNode = {
      id: 'query',
      label: query.substring(0, 60),
      type: 'query',
      category: 'query',
      x: this.width / 2,
      y: this.height / 2,
      fx: this.width / 2,  // Fixed position
      fy: this.height / 2,
      connections: contextDocs.length,
      isQuery: true
    };
    this.nodes.push(this.queryNode);
    this.nodeMap.set('query', this.queryNode);

    // Add context documents as nodes
    contextDocs.forEach((doc, idx) => {
      const node = {
        id: doc.id || `doc-${idx}`,
        label: doc.filename || doc.name || doc.label,
        type: doc.category || 'document',
        category: doc.category || 'document',
        path: doc.path,
        connections: 0,  // Will calculate
        metadata: doc
      };
      this.nodes.push(node);
      this.nodeMap.set(node.id, node);

      // Link to query
      this.links.push({
        source: 'query',
        target: node.id,
        type: 'reference',
        weight: 1
      });
    });

    // Fetch relationships between documents
    await this.loadRelationships();

    // Calculate node importance (degree centrality)
    this.calculateNodeImportance();

    // Render network
    this.render();
  }

  /**
   * Load relationships between documents from backend
   */
  async loadRelationships() {
    try {
      const nodeIds = Array.from(this.nodeMap.keys()).filter(id => id !== 'query');
      const response = await fetch('/api/relationships/network', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nodeIds, source: this.source })
      });

      if (!response.ok) return;

      const data = await response.json();
      if (data.relationships) {
        data.relationships.forEach(rel => {
          // Only add if both nodes exist
          if (this.nodeMap.has(rel.source) && this.nodeMap.has(rel.target)) {
            this.links.push({
              source: rel.source,
              target: rel.target,
              type: rel.type || 'reference',
              weight: rel.weight || 1
            });
          }
        });
      }
    } catch (error) {
      console.warn('Failed to load relationships:', error);
    }
  }

  /**
   * Calculate node importance based on connections
   * Node size = degree centrality + frequency weight
   */
  calculateNodeImportance() {
    // Count connections per node
    const degree = new Map();
    this.links.forEach(link => {
      const sourceId = typeof link.source === 'object' ? link.source.id : link.source;
      const targetId = typeof link.target === 'object' ? link.target.id : link.target;
      
      degree.set(sourceId, (degree.get(sourceId) || 0) + 1);
      degree.set(targetId, (degree.get(targetId) || 0) + 1);
    });

    // Update node connection counts
    this.nodes.forEach(node => {
      node.connections = degree.get(node.id) || 0;
    });
  }

  /**
   * Render the network graph
   */
  render() {
    if (this.nodes.length === 0) {
      this.showEmptyMessage();
      return;
    }

    // Clear previous
    this.linkGroup.selectAll('*').remove();
    this.nodeGroup.selectAll('*').remove();

    // Create force simulation
    this.simulation = d3.forceSimulation(this.nodes)
      .force('link', d3.forceLink(this.links)
        .id(d => d.id)
        .distance(d => {
          // Query links are longer
          if (d.source.id === 'query' || d.target.id === 'query') return 200;
          // Otherwise based on weight
          return 100 / (d.weight || 1);
        })
      )
      .force('charge', d3.forceManyBody()
        .strength(d => d.isQuery ? -2000 : -300)
      )
      .force('center', d3.forceCenter(this.width / 2, this.height / 2))
      .force('collision', d3.forceCollide().radius(d => this.getNodeRadius(d) + 10));

    // Draw links
    this.drawLinks();

    // Draw nodes
    this.drawNodes();

    // Update positions on each tick
    this.simulation.on('tick', () => {
      this.updatePositions();
    });

    // Fit to screen after simulation settles
    setTimeout(() => this.fitToScreen(), 1000);
  }

  drawLinks() {
    const linkElements = this.linkGroup
      .selectAll('line')
      .data(this.links)
      .enter()
      .append('line')
      .attr('class', 'network-link')
      .attr('stroke', d => this.edgeColors[d.type] || '#666')
      .attr('stroke-width', d => Math.sqrt(d.weight || 1))
      .attr('stroke-opacity', 0.6)
      .attr('stroke-dasharray', d => {
        if (d.type === 'semantic') return '5,5';
        if (d.type === 'temporal') return '3,3';
        return 'none';
      });

    // Add link labels for ALL edges showing relationship type
    this.linkGroup
      .selectAll('text')
      .data(this.links)
      .enter()
      .append('text')
      .attr('class', 'link-label')
      .attr('font-size', '10px')
      .attr('font-weight', '600')
      .attr('fill', d => this.edgeColors[d.type] || '#888')
      .attr('text-anchor', 'middle')
      .attr('pointer-events', 'none')
      .style('text-shadow', '0 0 3px rgba(0,0,0,0.8), 0 0 6px rgba(0,0,0,0.6)')
      .text(d => d.type);
  }

  drawNodes() {
    const nodeElements = this.nodeGroup
      .selectAll('g')
      .data(this.nodes)
      .enter()
      .append('g')
      .attr('class', 'network-node')
      .call(this.drag());

    // Node circles (size by importance)
    nodeElements
      .append('circle')
      .attr('r', d => this.getNodeRadius(d))
      .attr('fill', d => this.nodeColors[d.category] || '#64748b')
      .attr('stroke', '#fff')
      .attr('stroke-width', 2)
      .attr('opacity', 0.9)
      .style('filter', d => `drop-shadow(0 0 8px ${this.nodeColors[d.category] || '#64748b'})`);

    // Connection count badge
    nodeElements
      .filter(d => d.connections > 2)
      .append('circle')
      .attr('r', 12)
      .attr('cx', d => this.getNodeRadius(d) - 5)
      .attr('cy', d => -this.getNodeRadius(d) + 5)
      .attr('fill', '#ef4444')
      .attr('stroke', '#fff')
      .attr('stroke-width', 1);

    nodeElements
      .filter(d => d.connections > 2)
      .append('text')
      .attr('x', d => this.getNodeRadius(d) - 5)
      .attr('y', d => -this.getNodeRadius(d) + 9)
      .attr('text-anchor', 'middle')
      .attr('font-size', '10px')
      .attr('font-weight', 'bold')
      .attr('fill', '#fff')
      .text(d => d.connections);

    // Labels
    nodeElements
      .append('text')
      .attr('x', 0)
      .attr('y', d => this.getNodeRadius(d) + 18)
      .attr('text-anchor', 'middle')
      .attr('font-size', d => d.isQuery ? '14px' : '11px')
      .attr('font-weight', d => d.isQuery ? '700' : '500')
      .attr('fill', '#fff')
      .attr('stroke', '#000')
      .attr('stroke-width', '0.3px')
      .attr('paint-order', 'stroke')
      .text(d => this.truncate(d.label, 25));

    // Click handler
    nodeElements.on('click', (event, d) => {
      event.stopPropagation();
      this.handleNodeClick(d);
    });
  }

  /**
   * Calculate node radius based on importance
   */
  getNodeRadius(node) {
    if (node.isQuery) return 30;
    // Base size + connection bonus
    const base = 10;
    const connectionBonus = Math.min(node.connections * 2, 20);
    const radius = base + connectionBonus;
    
    // Debug logging for verification
    if (node.connections > 0) {
      console.log(`Node "${node.label}" - Connections: ${node.connections}, Radius: ${radius}px`);
    }
    
    return radius;
  }

  updatePositions() {
    // Update link positions
    this.linkGroup.selectAll('line')
      .attr('x1', d => d.source.x)
      .attr('y1', d => d.source.y)
      .attr('x2', d => d.target.x)
      .attr('y2', d => d.target.y);

    this.linkGroup.selectAll('text')
      .attr('x', d => (d.source.x + d.target.x) / 2)
      .attr('y', d => (d.source.y + d.target.y) / 2);

    // Update node positions
    this.nodeGroup.selectAll('g')
      .attr('transform', d => `translate(${d.x},${d.y})`);
  }

  handleNodeClick(node) {
    console.log('Node clicked:', node);
    this.selectedNode = node;

    // Highlight connected nodes
    this.highlightConnected(node);

    // Show details panel
    if (window.nodeDetailsPanel && typeof window.nodeDetailsPanel.show === 'function') {
      window.nodeDetailsPanel.show(node.id);
    }

    // Dispatch event
    const event = new CustomEvent('networkNodeClick', { detail: node, bubbles: true });
    document.dispatchEvent(event);
  }

  highlightConnected(node) {
    // Find all connected links
    const connectedLinks = this.links.filter(l => 
      (typeof l.source === 'object' ? l.source.id : l.source) === node.id ||
      (typeof l.target === 'object' ? l.target.id : l.target) === node.id
    );

    // Dim all links
    this.linkGroup.selectAll('line')
      .attr('stroke-opacity', 0.1);

    // Highlight connected
    this.linkGroup.selectAll('line')
      .filter(l => connectedLinks.includes(l))
      .attr('stroke-opacity', 1)
      .attr('stroke-width', 3);

    // Dim all nodes
    this.nodeGroup.selectAll('circle')
      .attr('opacity', 0.2);

    // Highlight connected nodes
    const connectedNodeIds = new Set();
    connectedLinks.forEach(l => {
      connectedNodeIds.add(typeof l.source === 'object' ? l.source.id : l.source);
      connectedNodeIds.add(typeof l.target === 'object' ? l.target.id : l.target);
    });

    this.nodeGroup.selectAll('g')
      .filter(d => connectedNodeIds.has(d.id))
      .select('circle')
      .attr('opacity', 0.9);
  }

  fitToScreen() {
    const bounds = this.mainGroup.node().getBBox();
    const fullWidth = this.width;
    const fullHeight = this.height;
    const width = bounds.width;
    const height = bounds.height;
    
    const midX = bounds.x + width / 2;
    const midY = bounds.y + height / 2;
    
    const scale = 0.8 / Math.max(width / fullWidth, height / fullHeight);
    const translate = [fullWidth / 2 - scale * midX, fullHeight / 2 - scale * midY];
    
    this.svg.transition()
      .duration(750)
      .call(this.zoom.transform, d3.zoomIdentity.translate(translate[0], translate[1]).scale(scale));
  }

  zoomIn() {
    this.svg.transition()
      .duration(200)
      .call(this.zoom.scaleBy, 1.2);
  }

  zoomOut() {
    this.svg.transition()
      .duration(200)
      .call(this.zoom.scaleBy, 0.8);
  }

  downloadSvg(filename = 'network-graph.svg') {
    const svgNode = this.svg.node();
    if (!svgNode) return;

    const serializer = new XMLSerializer();
    const source = serializer.serializeToString(svgNode);
    const blob = new Blob([source], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  drag() {
    return d3.drag()
      .on('start', (event, d) => {
        if (!event.active) this.simulation.alphaTarget(0.3).restart();
        d.fx = d.x;
        d.fy = d.y;
      })
      .on('drag', (event, d) => {
        d.fx = event.x;
        d.fy = event.y;
      })
      .on('end', (event, d) => {
        if (!event.active) this.simulation.alphaTarget(0);
        if (!d.isQuery) {  // Query stays fixed
          d.fx = null;
          d.fy = null;
        }
      });
  }

  truncate(text, maxLength) {
    if (!text) return '';
    return text.length > maxLength ? text.substring(0, maxLength - 3) + '...' : text;
  }

  clear() {
    this.nodes = [];
    this.links = [];
    this.nodeMap.clear();
    this.queryNode = null;
    if (this.simulation) this.simulation.stop();
    this.linkGroup?.selectAll('*').remove();
    this.nodeGroup?.selectAll('*').remove();
    this.svg.selectAll('.ant-empty').remove();
  }
}

// Export for use in stream-handler
window.NetworkGraph = NetworkGraph;
