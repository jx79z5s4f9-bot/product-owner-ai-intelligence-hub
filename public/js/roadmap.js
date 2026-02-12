// Roadmap Timeline Visualization with D3.js

let timelineData = null;
let svg = null;
let tooltip = null;
let currentSource = 'po-ai';

// Initialize on page load
document.addEventListener('DOMContentLoaded', () => {
  const sourceSelect = document.getElementById('roadmap-source');
  if (sourceSelect) {
    currentSource = sourceSelect.value;
    window.currentRoadmapSource = currentSource;
    sourceSelect.addEventListener('change', (e) => {
      currentSource = e.target.value;
      window.currentRoadmapSource = currentSource;
      loadRoadmapData();
    });
  }

  loadRoadmapData();
  createTooltip();
});

async function loadRoadmapData() {
  try {
    document.getElementById('loading').classList.remove('hidden');
    
    const response = await fetch(`/roadmap/api/roadmap?source=${encodeURIComponent(currentSource)}`);
    timelineData = await response.json();
    
    renderStats(timelineData);
    renderTimeline(timelineData);
    renderLegend();
    
    document.getElementById('loading').classList.add('hidden');
  } catch (error) {
    console.error('Failed to load roadmap:', error);
    document.getElementById('loading').innerHTML = `
      <div class="error">
        <p>Failed to load roadmap data</p>
        <button onclick="loadRoadmapData()">Retry</button>
      </div>
    `;
  }
}

function renderStats(data) {
  const stats = document.getElementById('roadmap-stats');
  
  const totalSP = data.epics.reduce((sum, e) => sum + (e.storyPoints || 0), 0);
  const completedEpics = data.epics.filter(e => e.status === 'completed').length;
  
  stats.innerHTML = `
    <div class="stat-item">
      <span class="label">Total Epics</span>
      <span class="value">${data.epics.length}</span>
    </div>
    <div class="stat-item">
      <span class="label">Sprints</span>
      <span class="value">${data.sprints.length}</span>
    </div>
    <div class="stat-item">
      <span class="label">Story Points</span>
      <span class="value">${totalSP}</span>
    </div>
    <div class="stat-item">
      <span class="label">Completed</span>
      <span class="value">${completedEpics}/${data.epics.length}</span>
    </div>
  `;
}

function renderTimeline(data) {
  const container = document.getElementById('timeline-container');
  container.innerHTML = '';
  
  // Dimensions
  const margin = { top: 80, right: 40, bottom: 40, left: 200 };
  const width = Math.max(1400, data.sprints.length * 120);
  const height = data.epics.length * 80 + margin.top + margin.bottom;
  
  // Create SVG
  svg = d3.select('#timeline-container')
    .append('svg')
    .attr('width', width)
    .attr('height', height)
    .attr('class', 'timeline-svg');
  
  const g = svg.append('g')
    .attr('transform', `translate(${margin.left},${margin.top})`);
  
  const chartWidth = width - margin.left - margin.right;
  const chartHeight = height - margin.top - margin.bottom;
  
  // Scales
  const xScale = d3.scaleBand()
    .domain(data.sprints.map(s => s.number))
    .range([0, chartWidth])
    .padding(0.1);
  
  const yScale = d3.scaleBand()
    .domain(data.epics.map(e => e.id))
    .range([0, chartHeight])
    .padding(0.2);
  
  // Draw sprint boundaries
  data.sprints.forEach((sprint, i) => {
    const x = xScale(sprint.number);
    
    // Vertical line
    g.append('line')
      .attr('class', 'sprint-line')
      .attr('x1', x)
      .attr('y1', -20)
      .attr('x2', x)
      .attr('y2', chartHeight);
    
    // Sprint label
    g.append('text')
      .attr('class', 'sprint-label')
      .attr('x', x + xScale.bandwidth() / 2)
      .attr('y', -30)
      .text(`S${sprint.number}`);
    
    // Sprint dates (smaller text below)
    if (sprint.dates) {
      g.append('text')
        .attr('class', 'sprint-label')
        .attr('x', x + xScale.bandwidth() / 2)
        .attr('y', -10)
        .style('font-size', '10px')
        .text(sprint.dates.substring(0, 10));
    }
  });
  
  // Draw epics
  data.epics.forEach(epic => {
    const y = yScale(epic.id);
    const epicHeight = yScale.bandwidth();
    
    // Epic label (left side)
    g.append('text')
      .attr('class', 'epic-label')
      .attr('x', -10)
      .attr('y', y + epicHeight / 2 + 5)
      .attr('text-anchor', 'end')
      .text(epic.name.substring(0, 30) + (epic.name.length > 30 ? '...' : ''));
    
    // Draw bars for each sprint this epic was active in
    if (epic.sprints && epic.sprints.length > 0) {
      const minSprint = Math.min(...epic.sprints);
      const maxSprint = Math.max(...epic.sprints);
      
      const barX = xScale(minSprint);
      const barWidth = xScale(maxSprint) - xScale(minSprint) + xScale.bandwidth();
      
      const color = getStatusColor(epic.status);
      
      g.append('rect')
        .attr('class', `epic-bar status-${epic.status}`)
        .attr('x', barX)
        .attr('y', y)
        .attr('width', barWidth)
        .attr('height', epicHeight)
        .attr('fill', color)
        .attr('data-epic-id', epic.id)
        .style('cursor', 'pointer')
        .on('mouseover', function(event) {
          showTooltip(event, epic);
          d3.select(this).attr('opacity', 0.8);
        })
        .on('mouseout', function() {
          hideTooltip();
          d3.select(this).attr('opacity', 1);
        })
        .on('click', function() {
          openEpicDetail(epic);
        });
      
      // Story points label on bar
      if (epic.storyPoints > 0) {
        g.append('text')
          .attr('x', barX + barWidth / 2)
          .attr('y', y + epicHeight / 2 + 5)
          .attr('text-anchor', 'middle')
          .attr('fill', 'white')
          .attr('font-size', '14px')
          .attr('font-weight', '600')
          .style('pointer-events', 'none')
          .text(`${epic.storyPoints} SP`);
      }
    }
  });
}

function getStatusColor(status) {
  const colors = {
    'completed': '#22c55e',
    'in-progress': '#eab308',
    'planned': '#64748b',
    'unknown': '#94a3b8'
  };
  return colors[status] || colors.unknown;
}

function createTooltip() {
  tooltip = d3.select('body')
    .append('div')
    .attr('class', 'roadmap-tooltip')
    .style('position', 'absolute');
}

function showTooltip(event, epic) {
  tooltip
    .style('left', (event.pageX + 10) + 'px')
    .style('top', (event.pageY - 10) + 'px')
    .classed('visible', true)
    .html(`
      <h4>${epic.name}</h4>
      <div class="tooltip-row">
        <span class="tooltip-label">Story Points:</span>
        <span class="tooltip-value">${epic.storyPoints || 0}</span>
      </div>
      <div class="tooltip-row">
        <span class="tooltip-label">Status:</span>
        <span class="tooltip-value">${epic.status}</span>
      </div>
      <div class="tooltip-row">
        <span class="tooltip-label">Sprints:</span>
        <span class="tooltip-value">${epic.sprints.join(', ')}</span>
      </div>
      ${epic.wsjf ? `
        <div class="tooltip-row">
          <span class="tooltip-label">WSJF:</span>
          <span class="tooltip-value">${epic.wsjf}</span>
        </div>
      ` : ''}
      <p style="margin-top: 0.5rem; font-size: 0.85rem; color: var(--text-secondary);">Click for details</p>
    `);
}

function hideTooltip() {
  tooltip.classed('visible', false);
}

function renderLegend() {
  const legend = document.getElementById('roadmap-legend');
  
  legend.innerHTML = `
    <div class="legend-item">
      <div class="legend-color" style="background: #22c55e;"></div>
      <span class="legend-label">Completed</span>
    </div>
    <div class="legend-item">
      <div class="legend-color" style="background: #eab308;"></div>
      <span class="legend-label">In Progress</span>
    </div>
    <div class="legend-item">
      <div class="legend-color" style="background: #64748b;"></div>
      <span class="legend-label">Planned</span>
    </div>
  `;
}

async function openEpicDetail(epic) {
  const modal = document.getElementById('epic-detail-modal');
  const content = document.getElementById('epic-detail-content');
  
  // Show loading
  content.innerHTML = '<p style="text-align: center; padding: 2rem;">Loading...</p>';
  modal.classList.remove('hidden');
  
  try {
    // Fetch epic details including stories
    const response = await fetch(`/roadmap/api/node/${epic.id}?source=${encodeURIComponent(currentSource)}`);
    const data = await response.json();
    
    const stories = data.relationships.contains || [];
    
    content.innerHTML = `
      <div class="epic-detail-header">
        <h2>${epic.name}</h2>
        <button class="close-btn" onclick="closeEpicDetail()">✕</button>
      </div>
      
      <div class="epic-detail-meta">
        <div class="meta-item">
          <div class="meta-label">Story Points</div>
          <div class="meta-value">${epic.storyPoints || 0}</div>
        </div>
        <div class="meta-item">
          <div class="meta-label">Status</div>
          <div class="meta-value">${epic.status}</div>
        </div>
        <div class="meta-item">
          <div class="meta-label">Sprints</div>
          <div class="meta-value">${epic.sprints.join(', ')}</div>
        </div>
        ${epic.wsjf ? `
          <div class="meta-item">
            <div class="meta-label">WSJF Score</div>
            <div class="meta-value">${epic.wsjf}</div>
          </div>
        ` : ''}
      </div>
      
      ${epic.businessValue ? `
        <div style="margin-bottom: 1.5rem;">
          <h3 style="margin-bottom: 0.5rem; color: var(--text-primary);">Business Value</h3>
          <p style="padding: 1rem; background: var(--surface-1); border-left: 3px solid var(--color-creation); border-radius: 6px; line-height: 1.6;">
            ${epic.businessValue}
          </p>
        </div>
      ` : ''}
      
      <h3 style="margin-bottom: 1rem; color: var(--text-primary);">User Stories (${stories.length})</h3>
      <ul class="story-list">
        ${stories.length > 0 ? stories.map(story => `
          <li class="story-item">
            <span class="story-name">${story.name}</span>
            <div class="story-meta">
              ${story.storyPoints ? `<span class="story-sp">${story.storyPoints} SP</span>` : ''}
              ${story.sprint ? `<span class="story-sprint">Sprint ${story.sprint}</span>` : ''}
            </div>
          </li>
        `).join('') : '<li style="color: var(--text-secondary); padding: 1rem;">No stories found</li>'}
      </ul>
      
      <div style="margin-top: 1.5rem; display: flex; gap: 1rem;">
        <button onclick="viewEpicInTree('${epic.id}')" style="padding: 0.75rem 1.5rem; background: var(--color-creation); color: white; border: none; border-radius: 6px; cursor: pointer; font-weight: 500;">
          View in Tree
        </button>
        <button onclick="closeEpicDetail()" style="padding: 0.75rem 1.5rem; background: var(--surface-1); color: var(--text-primary); border: 1px solid var(--border-color); border-radius: 6px; cursor: pointer;">
          Close
        </button>
      </div>
    `;
  } catch (error) {
    console.error('Failed to load epic details:', error);
    content.innerHTML = '<p style="color: #ef4444; text-align: center; padding: 2rem;">Failed to load epic details</p>';
  }
}

function closeEpicDetail() {
  document.getElementById('epic-detail-modal').classList.add('hidden');
}

function viewEpicInTree(epicId) {
  // Navigate to main workspace with tree focused on this epic
  window.location.href = `/?focus=${epicId}`;
}

function refreshRoadmap() {
  fetch(`/roadmap/api/relationships/refresh?source=${encodeURIComponent(currentSource)}`, { method: 'POST' })
    .then(() => loadRoadmapData())
    .catch(error => console.error('Failed to refresh:', error));
}

function downloadRoadmapSvg() {
  if (!svg || !svg.node()) {
    console.error('No roadmap SVG to download');
    return;
  }

  const svgElement = svg.node();
  const serializer = new XMLSerializer();
  const source = serializer.serializeToString(svgElement);
  const blob = new Blob([source], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);

  const link = document.createElement('a');
  link.href = url;
  link.download = `roadmap-${currentSource}-${new Date().toISOString().split('T')[0]}.svg`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

// Close modal on escape
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    closeEpicDetail();
  }
});

// Close modal on overlay click
document.addEventListener('click', (e) => {
  if (e.target.id === 'epic-detail-modal') {
    closeEpicDetail();
  }
});
