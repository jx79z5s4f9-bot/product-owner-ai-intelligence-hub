/**
 * Node Details Panel
 * Shows rich context when phylo tree or roadmap node is clicked
 */

class NodeDetailsPanel {
  constructor(containerId) {
    this.container = document.getElementById(containerId);
    this.currentNodeId = null;
  }

  /**
   * Show details for a node
   */
  async show(nodeId) {
    if (!this.container) return;
    
    this.currentNodeId = nodeId;
    this.container.classList.add('loading');
    
    try {
      const source = window.currentRoadmapSource || document.getElementById('treeSourceSelect')?.value || 'po-ai';
      const response = await fetch(`/roadmap/api/node/${nodeId}?source=${encodeURIComponent(source)}`);
      const data = await response.json();
      
      this.render(data);
      this.container.classList.remove('hidden', 'loading');
      this.container.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    } catch (error) {
      console.error('Failed to load node details:', error);
      this.showError('Failed to load node details');
    }
  }

  /**
   * Render node details
   */
  render(data) {
    const { node, relationships } = data;
    
    const html = `
      <div class="node-details-header">
        <div class="node-details-title">
          <span class="node-type-badge ${node.type}">${node.type}</span>
          <h3>${node.name}</h3>
        </div>
        <button class="close-btn" onclick="nodeDetailsPanel.hide()">✕</button>
      </div>

      <div class="node-details-body">
        ${this.renderMetadata(node)}
        ${this.renderBusinessValue(node)}
        ${this.renderRelationships(relationships)}
        ${this.renderTimeline(node)}
        ${this.renderSource(node)}
      </div>
    `;
    
    this.container.innerHTML = html;
  }

  /**
   * Render metadata section
   */
  renderMetadata(node) {
    let metadata = [];
    
    if (node.storyPoints) {
      metadata.push(`<div class="metadata-item"><strong>Story Points:</strong> ${node.storyPoints}</div>`);
    }
    
    if (node.status) {
      const statusEmoji = node.status === 'completed' ? '✅' : node.status === 'in-progress' ? '🚧' : '📋';
      metadata.push(`<div class="metadata-item"><strong>Status:</strong> ${statusEmoji} ${node.status}</div>`);
    }
    
    if (node.priority) {
      metadata.push(`<div class="metadata-item"><strong>Priority:</strong> ${node.priority}</div>`);
    }
    
    if (node.wsjf) {
      metadata.push(`<div class="metadata-item"><strong>WSJF Score:</strong> ${node.wsjf}</div>`);
    }
    
    if (node.sprint) {
      metadata.push(`<div class="metadata-item"><strong>Sprint:</strong> ${node.sprint}</div>`);
    }
    
    if (node.sprints && node.sprints.length > 0) {
      metadata.push(`<div class="metadata-item"><strong>Sprints:</strong> ${node.sprints.join(', ')}</div>`);
    }
    
    if (metadata.length === 0) return '';
    
    return `
      <div class="details-section">
        <h4>📊 Metadata</h4>
        <div class="metadata-grid">
          ${metadata.join('')}
        </div>
      </div>
    `;
  }

  /**
   * Render business value section
   */
  renderBusinessValue(node) {
    if (!node.businessValue) return '';
    
    return `
      <div class="details-section">
        <h4>💡 Business Value</h4>
        <p class="business-value">${node.businessValue}</p>
      </div>
    `;
  }

  /**
   * Render relationships section
   */
  renderRelationships(relationships) {
    const sections = [];
    
    // Contains (children)
    if (relationships.contains && relationships.contains.length > 0) {
      sections.push(`
        <div class="relationship-group">
          <strong>Contains (${relationships.contains.length}):</strong>
          <ul class="relationship-list">
            ${relationships.contains.map(n => `
              <li class="relationship-item">
                <span class="node-type-badge ${n.type}">${n.type}</span>
                <a href="#" onclick="nodeDetailsPanel.show('${n.id}'); return false;">${n.name}</a>
                ${n.storyPoints ? `<span class="sp-badge">${n.storyPoints} SP</span>` : ''}
              </li>
            `).join('')}
          </ul>
        </div>
      `);
    }
    
    // Part of (parent)
    if (relationships.partOf && relationships.partOf.length > 0) {
      sections.push(`
        <div class="relationship-group">
          <strong>Part of:</strong>
          <ul class="relationship-list">
            ${relationships.partOf.map(n => `
              <li class="relationship-item">
                <span class="node-type-badge ${n.type}">${n.type}</span>
                <a href="#" onclick="nodeDetailsPanel.show('${n.id}'); return false;">${n.name}</a>
              </li>
            `).join('')}
          </ul>
        </div>
      `);
    }
    
    // Dependencies
    if (relationships.dependsOn && relationships.dependsOn.length > 0) {
      sections.push(`
        <div class="relationship-group">
          <strong>Depends on:</strong>
          <ul class="relationship-list">
            ${relationships.dependsOn.map(n => `
              <li class="relationship-item dependency">
                <span class="node-type-badge ${n.type}">${n.type}</span>
                <a href="#" onclick="nodeDetailsPanel.show('${n.id}'); return false;">${n.name}</a>
              </li>
            `).join('')}
          </ul>
        </div>
      `);
    }
    
    // Blocked by
    if (relationships.blockedBy && relationships.blockedBy.length > 0) {
      sections.push(`
        <div class="relationship-group">
          <strong>Blocks:</strong>
          <ul class="relationship-list">
            ${relationships.blockedBy.map(n => `
              <li class="relationship-item">
                <span class="node-type-badge ${n.type}">${n.type}</span>
                <a href="#" onclick="nodeDetailsPanel.show('${n.id}'); return false;">${n.name}</a>
              </li>
            `).join('')}
          </ul>
        </div>
      `);
    }
    
    // Discussed in meetings
    if (relationships.discussedIn && relationships.discussedIn.length > 0) {
      sections.push(`
        <div class="relationship-group">
          <strong>Discussed in (${relationships.discussedIn.length} meetings):</strong>
          <ul class="relationship-list">
            ${relationships.discussedIn.slice(0, 5).map(n => `
              <li class="relationship-item">
                <span class="node-type-badge ${n.type}">${n.meetingType || 'meeting'}</span>
                ${n.name}
                ${n.date ? `<span class="date-badge">${n.date}</span>` : ''}
              </li>
            `).join('')}
            ${relationships.discussedIn.length > 5 ? `<li class="more-items">...and ${relationships.discussedIn.length - 5} more</li>` : ''}
          </ul>
        </div>
      `);
    }
    
    if (sections.length === 0) return '';
    
    return `
      <div class="details-section">
        <h4>🔗 Relationships</h4>
        ${sections.join('')}
      </div>
    `;
  }

  /**
   * Render timeline section
   */
  renderTimeline(node) {
    if (!node.sprint && (!node.sprints || node.sprints.length === 0)) return '';
    
    const sprints = node.sprints || [node.sprint];
    
    return `
      <div class="details-section">
        <h4>📅 Timeline</h4>
        <div class="timeline-info">
          <p>Worked on during Sprint${sprints.length > 1 ? 's' : ''}: <strong>${sprints.join(', ')}</strong></p>
        </div>
      </div>
    `;
  }

  /**
   * Render source file section
   */
  renderSource(node) {
    if (!node.sourceFile) return '';
    
    const filename = node.sourceFile.split('/').pop();
    
    return `
      <div class="details-section">
        <h4>📄 Source</h4>
        <p class="source-file">
          <code>${filename}</code>
        </p>
      </div>
    `;
  }

  /**
   * Show error message
   */
  showError(message) {
    this.container.innerHTML = `
      <div class="node-details-error">
        <p>❌ ${message}</p>
        <button onclick="nodeDetailsPanel.hide()">Close</button>
      </div>
    `;
    this.container.classList.remove('hidden', 'loading');
  }

  /**
   * Hide panel
   */
  hide() {
    if (this.container) {
      this.container.classList.add('hidden');
      this.currentNodeId = null;
    }
  }
}

// Global instance
let nodeDetailsPanel = null;

// Initialize on page load
document.addEventListener('DOMContentLoaded', () => {
  // Check if we're on a page that needs node details
  if (document.getElementById('node-details-panel')) {
    nodeDetailsPanel = new NodeDetailsPanel('node-details-panel');
    window.nodeDetailsPanel = nodeDetailsPanel;
  }
});
