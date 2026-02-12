// Knowledge Base Network Graph
class KBNetworkGraph extends NetworkGraph {
  constructor() {
    super('kb-network', { width: 1200, height: 600 });
    this.sizeMetric = 'connections';
    this.currentMode = 'orchestrator';
    this.setupModeSelector();
  }

  setupModeSelector() {
    const selector = document.getElementById('networkMode');
    if (!selector) return;

    selector.addEventListener('change', (e) => {
      this.currentMode = e.target.value;
      if (this.currentMode === 'orchestrator') {
        this.loadOrchestratorNetwork();
      } else if (this.currentMode === 'project') {
        this.loadProjectNetwork(1); // RTE project
      }
    });
  }

  async loadOrchestratorNetwork() {
    try {
      console.log('📚 Loading Orchestrator Network...');
      
      const response = await fetch('/knowledge-base/api/orchestrator');
      if (!response.ok) {
        throw new Error(`API error: ${response.status}`);
      }
      const data = await response.json();
      const nodes = data.nodes || [];

      this.clear();

      if (nodes.length === 0) {
        this.showEmptyState();
        return;
      }

      // Hide empty state, show SVG
      const emptyDiv = document.getElementById('kb-network-empty');
      const svg = document.getElementById('kb-network');
      if (emptyDiv) emptyDiv.classList.add('hidden');
      if (svg) svg.style.display = 'block';

      this.nodes = nodes;
      this.nodes.forEach(n => this.nodeMap.set(n.id, n));

      // Load relationships for orchestrator
      await this.loadOrchestratorRelationships();
      this.calculateNodeImportance();
      this.render();
      this.applyEdgeFilters();
    } catch (error) {
      console.error('Orchestrator network load failed:', error);
      this.showErrorState(error);
    }
  }

  async loadProjectNetwork(artId) {
    try {
      console.log(`📊 Loading Project Network (ART ${artId})...`);
      
      const response = await fetch(`/knowledge-base/api/project/${artId}`);
      if (!response.ok) {
        throw new Error(`API error: ${response.status}`);
      }
      const data = await response.json();
      const nodes = data.nodes || [];

      this.clear();

      if (nodes.length === 0) {
        this.showEmptyState();
        return;
      }

      // Hide empty state, show SVG
      const emptyDiv = document.getElementById('kb-network-empty');
      const svg = document.getElementById('kb-network');
      if (emptyDiv) emptyDiv.classList.add('hidden');
      if (svg) svg.style.display = 'block';

      this.nodes = nodes;
      this.nodes.forEach(n => this.nodeMap.set(n.id, n));

      // Load relationships for project
      await this.loadProjectRelationships(artId);
      this.calculateNodeImportance();
      this.render();
      this.applyEdgeFilters();
    } catch (error) {
      console.error('Project network load failed:', error);
      this.showErrorState(error);
    }
  }

  async loadOrchestratorRelationships() {
    try {
      const response = await fetch('/api/relationships/all?mode=orchestrator');
      const data = await response.json();
      const relationships = data.relationships || [];

      console.log('📊 [KB-Network] Loaded', relationships.length, 'orchestrator relationships');

      relationships.forEach(rel => {
        if (!rel.source_id || !rel.target_id) return;

        if (this.nodeMap.has(rel.source_id) && this.nodeMap.has(rel.target_id)) {
          this.links.push({
            source: rel.source_id,
            target: rel.target_id,
            type: rel.type || 'semantic',
            weight: rel.weight || 2
          });

          const sourceNode = this.nodeMap.get(rel.source_id);
          const targetNode = this.nodeMap.get(rel.target_id);
          if (sourceNode) sourceNode.connections++;
          if (targetNode) targetNode.connections++;
        }
      });

      console.log('✅ [KB-Network] Created', this.links.length, 'valid links');
    } catch (error) {
      console.warn('Failed to load orchestrator relationships:', error);
    }
  }

  async loadProjectRelationships(artId) {
    try {
      const response = await fetch(`/api/relationships/all?mode=project&artId=${artId}`);
      const data = await response.json();
      const relationships = data.relationships || [];

      console.log('📊 [KB-Network] Loaded', relationships.length, 'project relationships');

      relationships.forEach(rel => {
        if (!rel.source_id || !rel.target_id) return;

        if (this.nodeMap.has(rel.source_id) && this.nodeMap.has(rel.target_id)) {
          this.links.push({
            source: rel.source_id,
            target: rel.target_id,
            type: rel.type || 'reference',
            weight: 2
          });

          const sourceNode = this.nodeMap.get(rel.source_id);
          const targetNode = this.nodeMap.get(rel.target_id);
          if (sourceNode) sourceNode.connections++;
          if (targetNode) targetNode.connections++;
        }
      });

      console.log('✅ [KB-Network] Created', this.links.length, 'valid links');
    } catch (error) {
      console.warn('Failed to load project relationships:', error);
    }
  }

  async loadAllDocuments() {
    // Load orchestrator by default
    await this.loadOrchestratorNetwork();
  }

  showEmptyState() {
    const emptyDiv = document.getElementById('kb-network-empty');
    const svg = document.getElementById('kb-network');
    
    // Hide SVG, show empty state div
    if (svg) svg.style.display = 'none';
    if (emptyDiv) emptyDiv.classList.remove('hidden');
  }

  showErrorState(error) {
    const emptyDiv = document.getElementById('kb-network-empty');
    const svg = document.getElementById('kb-network');
    
    // Hide SVG
    if (svg) svg.style.display = 'none';
    
    // Show error in empty div
    if (emptyDiv) {
      emptyDiv.classList.remove('hidden');
      emptyDiv.innerHTML = `
        <div class="empty-icon">⚠️</div>
        <h3>Failed to Load Network</h3>
        <p style="color: #ef4444;">${error.message}</p>
      `;
    }
  }

  async loadAllRelationships() {
    try {
      const response = await fetch('/api/relationships/all');
      const data = await response.json();
      const relationships = data.relationships || [];

      console.log('📊 [KB-Network] Loaded', relationships.length, 'relationships');

      relationships.forEach(rel => {
        // Skip relationships with null IDs
        if (!rel.source_id || !rel.target_id) {
          return;
        }

        // Only add if both source and target nodes exist
        if (this.nodeMap.has(rel.source_id) && this.nodeMap.has(rel.target_id)) {
          this.links.push({
            source: rel.source_id,
            target: rel.target_id,
            type: rel.type || 'reference',
            weight: 2
          });
          
          // Increment connection counts for node importance
          const sourceNode = this.nodeMap.get(rel.source_id);
          const targetNode = this.nodeMap.get(rel.target_id);
          if (sourceNode) sourceNode.connections++;
          if (targetNode) targetNode.connections++;
        }
      });
      
      console.log('✅ [KB-Network] Created', this.links.length, 'valid links');
    } catch (error) {
      console.warn('Failed to load KB relationships:', error);
    }
  }

  applyEdgeFilters() {
    const filters = document.querySelectorAll('.network-filters input[type="checkbox"]');
    if (!filters || filters.length === 0) return;

    const active = new Set();
    filters.forEach(f => {
      if (f.checked) active.add(f.dataset.edge);
    });

    this.linkGroup.selectAll('line')
      .attr('stroke-opacity', d => active.has(d.type) ? 0.7 : 0.05)
      .attr('stroke-width', d => active.has(d.type) ? Math.sqrt(d.weight || 1) : 0.5);

    this.linkGroup.selectAll('text')
      .attr('opacity', d => active.has(d.type) ? 1 : 0);
  }

  setSizeMetric(metric) {
    this.sizeMetric = metric || 'connections';
    // Re-apply node sizing
    this.nodeGroup.selectAll('circle')
      .attr('r', d => this.getNodeRadius(d));

    if (this.simulation) {
      this.simulation.force('collision', d3.forceCollide().radius(d => this.getNodeRadius(d) + 10));
      this.simulation.alpha(0.3).restart();
    }
  }

  getNodeRadius(node) {
    if (node.isQuery) return 30;
    const base = 10;

    if (this.sizeMetric === 'connections') {
      const connectionBonus = Math.min(node.connections * 2, 20);
      return base + connectionBonus;
    }

    // Fallback to connections for now (frequency/recency not tracked yet)
    const fallbackBonus = Math.min(node.connections * 2, 20);
    return base + fallbackBonus;
  }
}

// Initialize KB network on page load
window.addEventListener('DOMContentLoaded', () => {
  if (typeof NetworkGraph === 'undefined') return;
  window.kbNetwork = new KBNetworkGraph();
  window.kbNetwork.loadAllDocuments();

  // Wire filter controls
  document.querySelectorAll('.network-filters input[type="checkbox"]').forEach(cb => {
    cb.addEventListener('change', () => {
      window.kbNetwork.applyEdgeFilters();
      // Phase 6: Save filter state to session
      saveKBSessionState();
    });
  });

  const metricSelect = document.getElementById('nodeSizeMetric');
  if (metricSelect) {
    metricSelect.addEventListener('change', (e) => {
      window.kbNetwork.setSizeMetric(e.target.value);
      // Phase 6: Save size metric to session
      saveKBSessionState();
    });
  }

  // Phase 6: Restore KB session state
  restoreKBSessionState();
});

// Phase 6: Session state persistence for KB
function saveKBSessionState() {
  try {
    const filters = {};
    document.querySelectorAll('.network-filters input[type="checkbox"]').forEach(cb => {
      filters[cb.dataset.edge] = cb.checked;
    });
    
    const sizeMetric = document.getElementById('nodeSizeMetric')?.value || 'connections';
    
    const state = {
      filters,
      sizeMetric,
      timestamp: new Date().toISOString()
    };
    
    sessionStorage.setItem('kb_network_state', JSON.stringify(state));
    console.log('KB network state saved');
  } catch (e) {
    console.warn('Failed to save KB network state:', e);
  }
}

function restoreKBSessionState() {
  try {
    const saved = sessionStorage.getItem('kb_network_state');
    if (saved) {
      const state = JSON.parse(saved);
      
      // Restore filters
      if (state.filters) {
        document.querySelectorAll('.network-filters input[type="checkbox"]').forEach(cb => {
          if (state.filters.hasOwnProperty(cb.dataset.edge)) {
            cb.checked = state.filters[cb.dataset.edge];
          }
        });
      }
      
      // Restore size metric
      if (state.sizeMetric) {
        const metricSelect = document.getElementById('nodeSizeMetric');
        if (metricSelect) metricSelect.value = state.sizeMetric;
      }
      
      console.log('KB network state restored');
      
      // Apply restored settings
      if (window.kbNetwork) {
        window.kbNetwork.applyEdgeFilters();
        if (state.sizeMetric) window.kbNetwork.setSizeMetric(state.sizeMetric);
      }
    }
  } catch (e) {
    console.warn('Failed to restore KB network state:', e);
  }
}
