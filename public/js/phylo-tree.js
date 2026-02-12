/**
 * Phylogenetic Tree v2 - Horizontal Layout
 *
 * Two visualization modes:
 * 1. Idea Evolution: Shows file progression (rough → developing → polished → feature)
 * 2. .md File Usage: Shows which templates were applied during reasoning
 *
 * Design: Horizontal tree (left-to-right) with color-coded stages
 */

class PhyloTreeV2 {
  constructor(svgId, options = {}) {
    this.svg = d3.select(`#${svgId}`);
    this.svgId = svgId;
    this.width = options.width || 1200;  // Increased from 900
    this.height = options.height || 800;  // Increased from 500
    this.mode = options.mode || 'md-usage'; // 'idea-evolution' or 'md-usage'
    this.source = options.source || 'po-ai';

    // Tree data
    this.rootNode = null;
    this.nodes = [];
    this.links = [];

    // Layout settings
    this.nodeRadius = 10;  // Slightly larger nodes
    this.horizontalGap = 200;  // Increased spacing
    this.verticalGap = 80;  // More vertical room

    // Colors by stage/category
    this.colors = {
      // Idea stages
      'rough': '#60a5fa',           // Blue
      'developing': '#a855f7',      // Purple
      'polished': '#22c55e',        // Green
      'portfolio': '#f97316',       // Orange
      'program': '#f97316',         // Orange
      'team': '#eab308',            // Yellow

      // SAFe hierarchy
      'epic': '#3b82f6',            // Blue
      'feature': '#06b6d4',         // Cyan
      'story': '#22c55e',           // Green
      'meeting': '#eab308',         // Yellow
      'sprint': '#8b5cf6',          // Purple

      // .md file categories
      'workflow': '#60a5fa',        // Blue
      'template': '#a855f7',        // Purple
      'best-practice': '#22c55e',   // Green
      'framework': '#f97316',       // Orange
      'custom': '#64748b',          // Gray

      // Default
      'default': '#10b981'
    };

    this.initialize();
  }

  initialize() {
    // Set SVG dimensions with proper pixel height for D3
    this.svg
      .attr('width', '100%')
      .attr('height', this.height)
      .attr('viewBox', `0 0 ${this.width} ${this.height}`)
      .attr('preserveAspectRatio', 'xMidYMid meet');

    // Create main group for zoom/pan
    this.mainGroup = this.svg.append('g')
      .attr('class', 'tree-container');

    // Setup zoom/pan
    this.zoom = d3.zoom()
      .scaleExtent([0.4, 2.5])
      .on('zoom', (event) => {
        if (this.mainGroup) {
          this.mainGroup.attr('transform', event.transform);
        }
      });
    this.svg.call(this.zoom);

    // Add mode toggle buttons
    this.addModeToggle();

    // Clear message
    this.showEmptyMessage();
  }

  /**
   * Toggle fullscreen mode for the tree
   */
  toggleFullscreen() {
    const container = document.querySelector('.reasoning-tree');
    if (!container) return;

    container.classList.toggle('fullscreen');
    document.body.classList.toggle('tree-fullscreen');
    this.resizeToContainer();
    this.fitToScreen();
  }

  /**
   * Resize SVG to fit container
   */
  resizeToContainer() {
    const svgElement = document.getElementById(this.svgId);
    const container = svgElement?.parentElement;
    if (!container) return;

    const rect = container.getBoundingClientRect();
    this.width = Math.max(600, rect.width);
    this.height = Math.max(400, rect.height);

    this.svg
      .attr('width', '100%')
      .attr('height', this.height)
      .attr('viewBox', `0 0 ${this.width} ${this.height}`);

    if (this.rootNode) {
      this.render();
    }
  }

  zoomIn() {
    if (!this.zoom) return;
    this.svg.transition().duration(200).call(this.zoom.scaleBy, 1.2);
  }

  zoomOut() {
    if (!this.zoom) return;
    this.svg.transition().duration(200).call(this.zoom.scaleBy, 0.8);
  }

  fitToScreen() {
    if (!this.rootNode || !this.mainGroup || !this.zoom) return;
    const bbox = this.mainGroup.node().getBBox();
    const scale = Math.min(
      this.width / (bbox.width + 100),
      this.height / (bbox.height + 100),
      1.2
    );

    const translateX = (this.width - bbox.width * scale) / 2 - bbox.x * scale;
    const translateY = (this.height - bbox.height * scale) / 2 - bbox.y * scale;

    const transform = d3.zoomIdentity.translate(translateX, translateY).scale(scale);
    this.svg.transition().duration(250).call(this.zoom.transform, transform);
  }

  /**
   * Download current tree as SVG
   */
  downloadSvg() {
    const svgElement = document.getElementById(this.svgId);
    if (!svgElement) return;

    const serializer = new XMLSerializer();
    const source = serializer.serializeToString(svgElement);
    const blob = new Blob([source], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);

    const link = document.createElement('a');
    link.href = url;
    link.download = `phylo-tree-${this.mode}.svg`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  addModeToggle() {
    // The toggle buttons are already in the tree-header in HTML
    // Just add event listeners to existing buttons
    const toggleButtons = document.querySelectorAll('#tree-mode-toggle .mode-btn');
    
    if (toggleButtons.length > 0) {
      toggleButtons.forEach(btn => {
        btn.addEventListener('click', (e) => {
          // Update active state
          toggleButtons.forEach(b => b.classList.remove('active'));
          e.target.classList.add('active');
          
          // Switch mode
          this.switchMode(e.target.dataset.mode);
        });
      });
    }
  }

  switchMode(mode) {
    this.mode = mode;
    if (this.mode === 'idea-evolution') {
      this.loadRelationshipTree();
      return;
    }

    if (this.rootNode) {
      this.render();
    }
  }

  showEmptyMessage() {
    this.svg.selectAll('*').remove();

    this.svg.append('text')
      .attr('x', this.width / 2)
      .attr('y', this.height / 2)
      .attr('text-anchor', 'middle')
      .attr('fill', '#666')
      .attr('font-size', '14px')
      .text('Submit a prompt to see reasoning path...');
  }

  /**
   * Add a node to the tree (for .md File Usage mode)
   * Called in real-time during LLM streaming
   */
  addMdUsageNode(data) {
    if (this.mode !== 'md-usage') return;

    const node = {
      id: `node-${Date.now()}-${Math.random()}`,
      type: 'md-file',
      label: data.md_file || 'Unknown',
      category: data.category || 'default',
      rule: data.rule || '',
      excerpt: data.excerpt || '',
      children: []
    };

    if (!this.rootNode) {
      // First node - create root
      this.rootNode = {
        id: 'root',
        type: 'question',
        label: 'User Question',
        children: [node]
      };
    } else {
      // Add as branch to root
      this.rootNode.children.push(node);
    }

    this.render();
  }

  /**
   * Set idea evolution tree data
   * Shows progression: rough → developing → polished → backlog
   */
  setIdeaEvolutionTree(treeData) {
    this.rootNode = treeData;
    if (this.mode === 'idea-evolution') {
      this.render();
    }
  }

  /**
   * Load SAFe hierarchy from relationship parser
   */
  async loadRelationshipTree() {
    try {
      const response = await fetch(`/roadmap/api/relationships?source=${encodeURIComponent(this.source)}`);
      if (!response.ok) {
        throw new Error('Failed to load relationships');
      }
      const graph = await response.json();
      this.rootNode = this.buildSaFeTree(graph);
      this.render();
    } catch (error) {
      console.warn('Unable to load relationship tree:', error);
      this.showEmptyMessage();
    }
  }

  /**
   * Build SAFe hierarchy tree from relationship graph
   */
  buildSaFeTree(graph) {
    const nodeById = new Map(graph.nodes.map(n => [n.id, n]));
    const containsEdges = graph.edges.filter(e => e.type === 'contains');
    const discussedEdges = graph.edges.filter(e => e.type === 'discussed-in');

    const epicNodes = graph.nodes.filter(n => n.type === 'epic');
    const featureByEpic = new Map();
    const storiesByFeature = new Map();

    containsEdges.forEach(edge => {
      const source = nodeById.get(edge.source);
      const target = nodeById.get(edge.target);
      if (!source || !target) return;

      if (source.type === 'epic' && target.type === 'feature') {
        if (!featureByEpic.has(source.id)) featureByEpic.set(source.id, []);
        featureByEpic.get(source.id).push(target);
      }

      if (source.type === 'feature' && target.type === 'story') {
        if (!storiesByFeature.has(source.id)) storiesByFeature.set(source.id, []);
        storiesByFeature.get(source.id).push(target);
      }
    });

    const root = {
      id: 'root-portfolio',
      type: 'portfolio',
      label: 'PO AI Workspace Project',
      children: []
    };

    epicNodes.forEach(epic => {
      const epicNode = {
        id: epic.id,
        type: epic.type,
        label: epic.name,
        status: epic.status,
        storyPoints: epic.storyPoints,
        sprints: epic.sprints,
        businessValue: epic.businessValue,
        wsjf: epic.wsjf,
        path: epic.sourceFile,
        children: []
      };

      const features = featureByEpic.get(epic.id) || [];
      if (features.length > 0) {
        features.forEach(feature => {
          const featureNode = {
            id: feature.id,
            type: feature.type,
            label: feature.name,
            storyPoints: feature.storyPoints,
            status: feature.status,
            path: feature.sourceFile,
            children: []
          };

          const stories = storiesByFeature.get(feature.id) || [];
          stories.forEach(story => {
            const storyNode = {
              id: story.id,
              type: story.type,
              label: story.name,
              storyPoints: story.storyPoints,
              priority: story.priority,
              sprint: story.sprint,
              criteriaCount: story.criteriaCount,
              path: story.sourceFile,
              children: []
            };

            const meetingEdges = discussedEdges.filter(e => e.source === story.id);
            meetingEdges.forEach(meetingEdge => {
              const meeting = nodeById.get(meetingEdge.target);
              if (!meeting) return;
              storyNode.children.push({
                id: meeting.id,
                type: meeting.type,
                label: meeting.name,
                meetingType: meeting.meetingType,
                date: meeting.date,
                sprint: meeting.sprint,
                path: meeting.sourceFile,
                children: []
              });
            });

            featureNode.children.push(storyNode);
          });

          epicNode.children.push(featureNode);
        });
      } else {
        const storyEdges = containsEdges.filter(e => e.source === epic.id);
        storyEdges.forEach(edge => {
          const story = nodeById.get(edge.target);
          if (!story || story.type !== 'story') return;

          const storyNode = {
            id: story.id,
            type: story.type,
            label: story.name,
            storyPoints: story.storyPoints,
            priority: story.priority,
            sprint: story.sprint,
            criteriaCount: story.criteriaCount,
            path: story.sourceFile,
            children: []
          };

          const meetingEdges = discussedEdges.filter(e => e.source === story.id);
          meetingEdges.forEach(meetingEdge => {
            const meeting = nodeById.get(meetingEdge.target);
            if (!meeting) return;
            storyNode.children.push({
              id: meeting.id,
              type: meeting.type,
              label: meeting.name,
              meetingType: meeting.meetingType,
              date: meeting.date,
              sprint: meeting.sprint,
              path: meeting.sourceFile,
              children: []
            });
          });

          epicNode.children.push(storyNode);
        });
      }

      root.children.push(epicNode);
    });

    return root;
  }

  /**
   * Render the tree
   */
  render() {
    if (!this.rootNode) {
      this.showEmptyMessage();
      return;
    }

    // Clear previous
    this.svg.selectAll('*').remove();
    this.mainGroup = this.svg.append('g').attr('class', 'tree-container');

    // Re-apply zoom behavior
    this.svg.call(this.zoom);

    // Calculate tree layout
    this.calculateLayout(this.rootNode, 0, 0);

    // Draw links first (so nodes appear on top)
    this.drawLinks();

    // Draw nodes
    this.drawNodes();

    // Center tree after DOM updates
    requestAnimationFrame(() => this.fitToScreen());
  }

  /**
   * Calculate horizontal tree layout using D3's tree layout
   * Much more reliable than manual calculations
   */
  calculateLayout(node, depth, siblingIndex) {
    if (!node) return 0;

    // Use D3's tree layout for proper hierarchical positioning
    const treeLayout = d3.tree().size([this.height - 100, this.width - 100]);
    const hierarchy = d3.hierarchy(node);
    const layoutRoot = treeLayout(hierarchy);

    // Convert D3 coordinates to our format (swap x/y for horizontal tree)
    layoutRoot.each(d => {
      d.data.x = d.y + 50;  // Horizontal position (from D3's x)
      d.data.y = d.x + 50;  // Vertical position (from D3's y)
    });

    return this.height;
  }

  /**
   * Draw links between nodes
   */
  drawLinks() {
    const links = [];
    const dependencies = [];
    this.traverseTree(this.rootNode, (node) => {
      if (node.children && !node._collapsed) {
        node.children.forEach(child => {
          links.push({ source: node, target: child, type: 'contains' });
        });
      }
      // Track dependencies for visualization
      if (node.dependencies && Array.isArray(node.dependencies)) {
        node.dependencies.forEach(depId => {
          dependencies.push({ source: node, targetId: depId, type: 'depends-on' });
        });
      }
    });

    // Draw hierarchy links (contains relationships)
    this.mainGroup.selectAll('.link')
      .data(links)
      .enter()
      .append('path')
      .attr('class', 'link')
      .attr('d', d => {
        // Bezier curve for horizontal tree
        const midX = (d.source.x + d.target.x) / 2;
        return `M ${d.source.x + this.nodeRadius} ${d.source.y}
                C ${midX} ${d.source.y},
                  ${midX} ${d.target.y},
                  ${d.target.x - this.nodeRadius} ${d.target.y}`;
      })
      .attr('fill', 'none')
      .attr('stroke', d => this.getColor(d.target))
      .attr('stroke-width', 2)
      .attr('stroke-opacity', 0.4)
      .attr('stroke-dasharray', '5,5');

    // Draw dependency edges (depends-on relationships) in red
    const nodeMap = new Map();
    this.traverseTree(this.rootNode, (node) => nodeMap.set(node.id, node));

    const validDeps = dependencies.filter(d => nodeMap.has(d.targetId));
    this.mainGroup.selectAll('.dependency-link')
      .data(validDeps)
      .enter()
      .append('path')
      .attr('class', 'dependency-link')
      .attr('d', d => {
        const target = nodeMap.get(d.targetId);
        const midX = (d.source.x + target.x) / 2;
        return `M ${d.source.x + this.nodeRadius} ${d.source.y}
                C ${midX} ${d.source.y},
                  ${midX} ${target.y},
                  ${target.x - this.nodeRadius} ${target.y}`;
      })
      .attr('fill', 'none')
      .attr('stroke', '#ef4444')
      .attr('stroke-width', 2)
      .attr('stroke-opacity', 0.6)
      .attr('stroke-dasharray', '8,4')
      .style('pointer-events', 'none');
  }

  /**
   * Draw nodes with rich information display
   */
  drawNodes() {
    const nodes = [];
    this.traverseTree(this.rootNode, (node) => {
      if (!node._collapsed) {
        nodes.push(node);
      }
    });

    const nodeGroups = this.mainGroup.selectAll('.node')
      .data(nodes, d => d.id)
      .enter()
      .append('g')
      .attr('class', 'node')
      .attr('transform', d => `translate(${d.x}, ${d.y})`)
      .style('cursor', 'pointer')
      .on('click', (event, d) => {
        event.stopPropagation();
        // Double-click to expand/collapse epics/features
        if (event.detail === 2 && (d.type === 'epic' || d.type === 'feature') && d.children?.length > 0) {
          d._collapsed = !d._collapsed;
          this.render();
        } else {
          this.handleNodeClick(d);
        }
      })
      .on('mouseenter', (event, d) => this.showTooltip(event, d))
      .on('mouseleave', () => this.hideTooltip());

    // Node circles (larger, with glow effect)
    nodeGroups.append('circle')
      .attr('r', d => (d.children?.length > 0 && d._collapsed) ? this.nodeRadius + 4 : this.nodeRadius + 2)
      .attr('fill', d => this.getColor(d))
      .attr('stroke', d => this.getColor(d))
      .attr('stroke-width', d => (d.children?.length > 0 && d._collapsed) ? 3 : 2)
      .attr('opacity', 0.9)
      .style('filter', d => `drop-shadow(0 0 12px ${this.getColor(d)})`);

    // Add background rectangles for labels (improves readability on export)
    nodeGroups.insert('rect', ':first-child')
      .attr('class', 'label-background')
      .attr('x', this.nodeRadius + 6)
      .attr('y', -10)
      .attr('width', 180)
      .attr('height', 28)
      .attr('fill', 'rgba(0, 0, 0, 0.6)')
      .attr('rx', 3)
      .attr('ry', 3);

    // Add dark background rectangles for labels (improves SVG export readability)
    nodeGroups.insert('rect', ':first-child')
      .attr('class', 'label-background')
      .attr('x', this.nodeRadius + 8)
      .attr('y', -10)
      .attr('width', 200)
      .attr('height', 30)
      .attr('fill', 'rgba(0, 0, 0, 0.7)')
      .attr('rx', 4)
      .attr('ry', 4);

    // Add dark background rectangles for labels (improves SVG export readability)
    nodeGroups.insert('rect', ':first-child')
      .attr('class', 'label-background')
      .attr('x', this.nodeRadius + 8)
      .attr('y', -10)
      .attr('width', 210)
      .attr('height', 32)
      .attr('fill', 'rgba(0, 0, 0, 0.75)')
      .attr('rx', 4)
      .attr('ry', 4);

    // Collapsed indicator (+ symbol)
    nodeGroups.filter(d => d.children?.length > 0 && d._collapsed)
      .append('text')
      .attr('class', 'collapse-indicator')
      .attr('x', 0)
      .attr('y', 5)
      .attr('text-anchor', 'middle')
      .attr('font-size', '16px')
      .attr('font-weight', 'bold')
      .attr('fill', '#fff')
      .text('+');

    // Node labels - file name (larger, more readable)
    nodeGroups.append('text')
      .attr('class', 'tree-node-file')
      .attr('x', this.nodeRadius + 15)
      .attr('y', 5)
      .attr('font-size', '13px')
      .attr('fill', '#ffffff')
      .attr('font-weight', '600')
      .attr('stroke', '#000')
      .attr('stroke-width', '0.3px')
      .attr('paint-order', 'stroke')
      .text(d => {
        // Extract just filename without extension
        const filename = (d.label || '').replace(/\.md$/, '');
        const label = this.truncateLabel(filename, 28);
        // Show child count for collapsed nodes
        if (d.children?.length > 0 && d._collapsed) {
          return `${label} (${d.children.length})`;
        }
        return label;
      });

    // Category badge (below label)
    nodeGroups.append('text')
      .attr('class', 'tree-node-category')
      .attr('x', this.nodeRadius + 15)
      .attr('y', 19)
      .attr('font-size', '11px')
      .attr('fill', '#ffffff')
      .attr('font-weight', '500')
      .attr('stroke', '#000')
      .attr('stroke-width', '0.2px')
      .attr('paint-order', 'stroke')
      .text(d => (d.category || d.stage || '').toUpperCase());
  }

  /**
   * Center tree in viewport
   */
  centerTree() {
    const bbox = this.mainGroup.node().getBBox();
    const scale = Math.min(
      this.width / (bbox.width + 100),
      this.height / (bbox.height + 100),
      1
    );

    const translateX = (this.width - bbox.width * scale) / 2 - bbox.x * scale;
    const translateY = (this.height - bbox.height * scale) / 2 - bbox.y * scale;

    this.mainGroup.attr('transform', `translate(${translateX}, ${translateY}) scale(${scale})`);
  }

  /**
   * Handle node click - populate details panel and highlight
   */
  handleNodeClick(node) {
    // Remove previous selection
    this.svg.selectAll('.node circle')
      .style('stroke', d => d.id === node.id ? '#fbbf24' : 'none')
      .style('stroke-width', d => d.id === node.id ? 3 : 0);

    // Dispatch custom event with node data
    const event = new CustomEvent('treeNodeClick', {
      detail: node,
      bubbles: true
    });
    document.dispatchEvent(event);

    // Update details panel and ensure it's visible
    this.showDetailsPanel(node);

    // Optional: Roadmap-style details panel if present
    if (window.nodeDetailsPanel && typeof window.nodeDetailsPanel.show === 'function') {
      window.nodeDetailsPanel.show(node.id);
    }

    // Scroll details panel into view
    const detailsPanel = document.getElementById('treeDetailsPanel');
    if (detailsPanel && detailsPanel.classList.contains('hidden')) {
      detailsPanel.classList.remove('hidden');
    }
    if (detailsPanel) {
      detailsPanel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }

  /**
   * Show details panel for selected node
   */
  showDetailsPanel(node) {
    const panel = document.getElementById('treeDetailsPanel');
    if (!panel) return;

    const updatePanel = (data) => {
      const detailNode = data?.node || node;
      const relationships = data?.relationships || null;

      // Populate details
      document.getElementById('detailsFileName').textContent = detailNode.label || detailNode.name || 'Unknown';

      const categoryBadge = document.getElementById('detailsCategory');
      const categoryText = detailNode.type || detailNode.category;
      if (categoryText) {
        categoryBadge.textContent = String(categoryText).toUpperCase();
        categoryBadge.className = 'detail-badge category-badge';
        categoryBadge.style.display = 'inline-block';
      } else {
        categoryBadge.style.display = 'none';
      }

      const stageBadge = document.getElementById('detailsStage');
      const stageText = detailNode.status || detailNode.priority || detailNode.stage;
      if (stageText) {
        stageBadge.textContent = String(stageText).toUpperCase();
        stageBadge.className = 'detail-badge stage-badge';
        stageBadge.style.display = 'inline-block';
      } else {
        stageBadge.style.display = 'none';
      }

      // Rule / business value / summary
      const ruleEl = document.getElementById('detailsRule');
      if (detailNode.businessValue) {
        ruleEl.textContent = detailNode.businessValue;
      } else if (detailNode.rule) {
        ruleEl.textContent = detailNode.rule;
      } else if (detailNode.storyPoints) {
        ruleEl.textContent = `Story Points: ${detailNode.storyPoints}`;
      } else {
        ruleEl.textContent = 'No rule information available';
      }

      // Excerpt / relationships
      const excerptEl = document.getElementById('detailsExcerpt');
      if (detailNode.excerpt) {
        excerptEl.textContent = detailNode.excerpt;
      } else if (relationships?.contains?.length) {
        excerptEl.textContent = `Contains: ${relationships.contains.map(r => r.name).slice(0, 5).join(', ')}${relationships.contains.length > 5 ? '…' : ''}`;
      } else if (detailNode.criteriaCount) {
        excerptEl.textContent = `Acceptance Criteria: ${detailNode.criteriaCount}`;
      } else if (detailNode.date) {
        excerptEl.textContent = `Meeting Date: ${detailNode.date}`;
      } else {
        excerptEl.textContent = 'No content excerpt available';
      }

      // File path
      const pathEl = document.getElementById('detailsPath');
      pathEl.textContent = detailNode.path || `/knowledge-base/${detailNode.label || detailNode.name}`;

      // KB link
      const kbLink = document.getElementById('detailsKbLink');
      if (detailNode.label && detailNode.label.endsWith('.md')) {
        kbLink.href = `/knowledge-base?selected=${encodeURIComponent(detailNode.label)}`;
        kbLink.classList.remove('hidden');
      } else {
        kbLink.classList.add('hidden');
      }

      // Show panel
      panel.classList.remove('hidden');
    };

    const isGraphNode = ['epic', 'feature', 'story', 'meeting', 'sprint'].includes(node.type);
    if (isGraphNode) {
      fetch(`/roadmap/api/node/${node.id}?source=${encodeURIComponent(this.source)}`)
        .then(res => res.ok ? res.json() : null)
        .then(data => updatePanel(data))
        .catch(() => updatePanel({ node }));
    } else {
      updatePanel({ node });
    }

    // Scroll details panel into view
    if (panel) {
      panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }

  /**
   * Show tooltip on hover
   */
  showTooltip(event, node) {
    // Remove existing tooltip
    d3.selectAll('.tree-tooltip').remove();

    const tooltip = d3.select('body')
      .append('div')
      .attr('class', 'tree-tooltip')
      .style('position', 'absolute')
      .style('background', 'rgba(0, 0, 0, 0.95)')
      .style('color', '#fff')
      .style('padding', '14px 18px')
      .style('border-radius', '10px')
      .style('font-size', '12px')
      .style('max-width', '320px')
      .style('pointer-events', 'none')
      .style('z-index', '10000')
      .style('border', `2px solid ${this.getColor(node)}`)
      .style('box-shadow', `0 4px 20px ${this.getColor(node)}60`)
      .style('backdrop-filter', 'blur(10px)');

    let content = `<strong style="font-size: 13px;">📚 ${this.truncateLabel(node.label, 35)}</strong><br>`;
    if (node.type) {
      content += `<span style="color: #60a5fa; font-size: 11px;">${String(node.type).toUpperCase()}</span><br>`;
    }
    if (node.status) {
      content += `<span style="color: #22c55e; font-size: 11px;">Status: ${node.status}</span><br>`;
    }
    if (node.storyPoints) {
      content += `<span style="color: #fbbf24; font-size: 11px;">SP: ${node.storyPoints}</span><br>`;
    }
    if ((node.type === 'epic' || node.type === 'feature') && node.children?.length > 0) {
      content += `<span style="color: #10b981; font-size: 11px;">Double-click to ${node._collapsed ? 'expand' : 'collapse'}</span><br>`;
    } else {
      content += `<span style="color: #888; font-size: 11px;">Click to view details</span><br>`;
    }
    content += `<br>`;

    if (node.rule) {
      content += `<div style="margin: 6px 0;"><strong style="color: #22c55e; font-size: 11px;">📏 RULE APPLIED</strong><br>`;
      content += `<span style="color: #ddd; font-size: 11px;">${this.truncateLabel(node.rule, 40)}</span></div>`;
    }

    if (node.category) {
      content += `<span style="color: #60a5fa; font-size: 11px;">🏷️ ${node.category.toUpperCase()}</span>`;
    }

    tooltip.html(content);

    // Position tooltip
    const mouseX = event.pageX + 15;
    const mouseY = event.pageY - 10;
    tooltip
      .style('left', mouseX + 'px')
      .style('top', mouseY + 'px');
  }

  hideTooltip() {
    d3.selectAll('.tree-tooltip').remove();
  }

  /**
   * Get color for node based on category/stage
   */
  getColor(node) {
    const key = node.category || node.stage || node.type || 'default';
    return this.colors[key] || this.colors['default'];
  }

  /**
   * Truncate label if too long
   */
  truncateLabel(label, maxLength) {
    if (!label) return '';
    return label.length > maxLength ? label.substring(0, maxLength) + '...' : label;
  }

  /**
   * Traverse tree and call callback on each node
   */
  traverseTree(node, callback) {
    if (!node) return;
    callback(node);
    if (node.children) {
      node.children.forEach(child => this.traverseTree(child, callback));
    }
  }

  /**
   * Reset tree (clear all nodes)
   */
  reset() {
    this.rootNode = null;
    this.showEmptyMessage();
  }
}

// Global instance
let phyloTreeV2 = null;

// Explicit init/destroy to support visualization toggles
window.initPhyloTreeV2 = function initPhyloTreeV2(options = {}) {
  if (typeof d3 === 'undefined') return null;
  if (phyloTreeV2) return phyloTreeV2;

  const svgId = options.svgId || 'phyloTree';
  const svgElement = document.getElementById(svgId);
  const container = svgElement?.parentElement;
  const width = options.width || container?.offsetWidth || 1200;
  const height = options.height || container?.offsetHeight || 500;

  const sourceSelect = document.getElementById('treeSourceSelect');
  const savedSource = localStorage.getItem('phyloTreeSource') || (sourceSelect?.value || 'po-ai');
  if (sourceSelect) {
    sourceSelect.value = savedSource;
  }

  phyloTreeV2 = new PhyloTreeV2(svgId, {
    width: width,
    height: height,
    mode: options.mode || 'md-usage',
    source: savedSource
  });
  window.phyloTreeV2 = phyloTreeV2;

  if (sourceSelect) {
    sourceSelect.addEventListener('change', (e) => {
      phyloTreeV2.source = e.target.value;
      localStorage.setItem('phyloTreeSource', e.target.value);
      if (phyloTreeV2.mode === 'idea-evolution') {
        phyloTreeV2.loadRelationshipTree();
      }
    });
  }

  window.addEventListener('resize', () => {
    if (phyloTreeV2) {
      phyloTreeV2.resizeToContainer();
    }
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && document.body.classList.contains('tree-fullscreen')) {
      phyloTreeV2?.toggleFullscreen();
    }
  });

  return phyloTreeV2;
};

window.destroyPhyloTreeV2 = function destroyPhyloTreeV2() {
  if (phyloTreeV2) {
    phyloTreeV2.reset();
  }
  window.phyloTreeV2 = null;
};
