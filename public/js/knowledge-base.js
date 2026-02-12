// Knowledge Base Explorer with Tabbed Organization

let allFiles = [];
let currentTab = 'workflow';
let selectedFileIds = new Set(); // Multi-select support
let currentScope = 'all';
let searchQuery = '';


// Section categories
const sectionCategories = {
  'workflow': ['workflow', 'orchestrator'],
  'epics': ['epic', 'feature'],
  'architecture': ['architecture', 'design', 'schema', 'flow', 'technical'],
  'meetings': ['standup', 'retrospective', 'review', 'planning', 'minute', 'daily'],
  'analysis': ['business', 'case', 'wsjf', 'okr', 'metrics', 'value-stream', 'analysis'],
  'practices': ['best-practice', 'practice', 'framework', 'safe', 'guideline']
};

// Initialize on page load
document.addEventListener('DOMContentLoaded', () => {
  loadFiles();
  setupTabNavigation();
  setupScopeSelector();
  setupSearch();
  loadSelectedFilesFromSession();
});

// Multi-select functions
function toggleFileSelection(fileId) {
  if (selectedFileIds.has(fileId)) {
    selectedFileIds.delete(fileId);
  } else {
    selectedFileIds.add(fileId);
  }
  
  // Update checkbox visual state
  const checkbox = document.querySelector(`.kb-card-checkbox[data-file-id="${fileId}"]`);
  if (checkbox) {
    checkbox.checked = selectedFileIds.has(fileId);
  }
  
  // Update card visual state
  const card = document.querySelector(`.kb-card[data-file-id="${fileId}"]`);
  if (card) {
    card.classList.toggle('selected', selectedFileIds.has(fileId));
  }
  
  // Save to session storage
  sessionStorage.setItem('kb_selected_files', JSON.stringify(Array.from(selectedFileIds)));
  
  // Update selection counter
  updateSelectionCounter();
}

function loadSelectedFilesFromSession() {
  try {
    const saved = sessionStorage.getItem('kb_selected_files');
    if (saved) {
      selectedFileIds = new Set(JSON.parse(saved));
      updateSelectionCounter();
    }
  } catch (err) {
    console.warn('Failed to load selected files:', err);
  }
}

function updateSelectionCounter() {
  const count = selectedFileIds.size;
  let counter = document.getElementById('selectionCounter');
  
  if (!counter) {
    counter = document.createElement('div');
    counter.id = 'selectionCounter';
    counter.className = 'selection-counter';
    document.querySelector('.header-right').prepend(counter);
  }
  
  if (count > 0) {
    counter.innerHTML = `<strong>${count} selected</strong> <button onclick="clearAllSelections()" class="btn-clear-selection">Clear</button>`;
    counter.classList.remove('hidden');
  } else {
    counter.classList.add('hidden');
  }
}

function clearAllSelections() {
  selectedFileIds.clear();
  sessionStorage.removeItem('kb_selected_files');
  document.querySelectorAll('.kb-card-checkbox').forEach(cb => cb.checked = false);
  document.querySelectorAll('.kb-card').forEach(card => card.classList.remove('selected'));
  updateSelectionCounter();
}

function setupScopeSelector() {
  const scopeSelect = document.getElementById('kbScopeSelect');
  if (!scopeSelect) return;

  const saved = localStorage.getItem('kbScope') || 'all';
  scopeSelect.value = saved;
  currentScope = saved;

  scopeSelect.addEventListener('change', (e) => {
    currentScope = e.target.value;
    localStorage.setItem('kbScope', currentScope);
    renderAllSections();
  });
}

function setupSearch() {
  const searchInput = document.getElementById('kbSearchInput');
  const searchClear = document.getElementById('kbSearchClear');
  
  if (!searchInput) return;

  // Handle input with debouncing
  let debounceTimer;
  searchInput.addEventListener('input', (e) => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      searchQuery = e.target.value.toLowerCase().trim();
      renderAllSections();
      
      // Show/hide clear button
      if (searchClear) {
        searchClear.style.display = searchQuery ? 'block' : 'none';
      }
    }, 300);
  });

  // Clear search
  if (searchClear) {
    searchClear.addEventListener('click', () => {
      searchInput.value = '';
      searchQuery = '';
      searchClear.style.display = 'none';
      renderAllSections();
      searchInput.focus();
    });
  }

  // Enter key focuses first result
  searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const firstCard = document.querySelector('.kb-card');
      if (firstCard) firstCard.click();
    }
  });
}

function setupTabNavigation() {
  document.querySelectorAll('.kb-tab-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      document.querySelectorAll('.kb-tab-btn').forEach(b => b.classList.remove('active'));
      e.target.classList.add('active');

      document.querySelectorAll('.kb-section').forEach(s => s.classList.remove('active'));
      currentTab = e.target.dataset.tab;
      document.getElementById(`tab-${currentTab}`).classList.add('active');
    });
  });
}

async function loadFiles() {
  try {
    // Use the new organized context endpoint
    const response = await fetch('/knowledge-base/api/organize');
    if (!response.ok) {
      throw new Error(`API error: ${response.status}`);
    }
    const data = await response.json();
    allFiles = data.files || [];

    if (allFiles.length === 0) {
      document.getElementById('loading').innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">📚</div>
          <h3>Knowledge Base is Empty</h3>
          <p>No .md files found in workspace</p>
        </div>
      `;
      return;
    }

    renderAllSections();

    document.getElementById('loading').classList.add('hidden');
  } catch (error) {
    console.error('Failed to load files:', error);
    document.getElementById('loading').innerHTML = `
      <div class="error">
        <p>Failed to load knowledge base: ${error.message}</p>
        <button class="btn btn-primary" onclick="loadFiles()">Retry</button>
      </div>
    `;
  }
}

function renderAllSections() {
  if (!allFiles || allFiles.length === 0) {
    console.warn('No files to render');
    return;
  }

  const filtered = filterByScope(allFiles);
  const searched = filterBySearch(filtered);
  const sections = organizeBySections(searched);

  Object.entries(sections).forEach(([section, files]) => {
    renderSection(section, files);
  });
}

function filterByScope(files) {
  if (currentScope === 'all') return files;
  if (currentScope === 'project') return files.filter(f => f.doc_group === 'project');
  if (currentScope === 'templates') return files.filter(f => f.doc_group === 'template');
  return files;
}

function filterBySearch(files) {
  if (!searchQuery) return files;
  
  return files.filter(file => {
    const searchableText = [
      file.filename,
      file.category,
      file.computed_category,
      file.excerpt,
      ...(file.tags || []),
      ...(file.key_rules || [])
    ].join(' ').toLowerCase();
    
    return searchableText.includes(searchQuery);
  });
}

function organizeBySections(files) {
  const sections = {
    workflow: [],
    epics: [],
    architecture: [],
    meetings: [],
    analysis: [],
    practices: []
  };

  files.forEach(file => {
    const effectiveCategory = file.computed_category || file.category || file.filename;
    const lower = String(effectiveCategory).toLowerCase();
    let assigned = false;

    // Try to match against section keywords
    for (const [section, keywords] of Object.entries(sectionCategories)) {
      if (keywords.some(kw => lower.includes(kw))) {
        sections[section].push(file);
        assigned = true;
        break;
      }
    }

    // If not assigned, default to practices
    if (!assigned) {
      sections.practices.push(file);
    }
  });

  return sections;
}

function renderSection(section, files) {
  const gridId = `grid-${section}`;
  const countId = `count-${section}`;
  const treeId = `tree-${section}`;

  // Update count
  const countEl = document.getElementById(countId);
  if (countEl) {
    countEl.textContent = `${files.length} file${files.length !== 1 ? 's' : ''}`;
  }

  // Render cards
  const grid = document.getElementById(gridId);
  if (!grid) return;

  if (files.length === 0) {
    grid.innerHTML = `
      <div class="kb-empty-state">
        <p>📭 No files in this section</p>
        <p style="font-size: 0.9rem; color: var(--text-secondary);">Files will appear here as they are added</p>
      </div>
    `;
    return;
  }

  grid.innerHTML = files.map(file => {
    const rulesCount = file.key_rules?.length || 0;
    const tagsHtml = (file.tags || []).slice(0, 3).map(tag =>
      `<span class="tag">${tag}</span>`
    ).join('');
    const moreTagsCount = (file.tags?.length || 0) > 3 ? `<span class="tag">+${file.tags.length - 3}</span>` : '';
    const contentBytes = file.content_length || file.content?.length || 0;

    return `
      <div class="kb-card" data-file-id="${file.id}">
        <input type="checkbox" class="kb-card-checkbox" data-file-id="${file.id}" onclick="event.stopPropagation(); toggleFileSelection(${file.id})">
        <div class="card-content" onclick="openFileModal(${file.id})">
          <div class="card-header">
            <h3 class="card-title">${file.filename.replace('.md', '')}</h3>
            <span class="card-badge">${file.computed_category || file.category || 'doc'}</span>
          </div>

          <p class="card-excerpt">${file.excerpt || 'No description'}</p>

          <div class="card-tags">
            ${tagsHtml}
            ${moreTagsCount}
          </div>
        </div>

        <div class="card-footer">
          <span class="rules-count">
            <span style="color: #22c55e;">✓</span>
            ${rulesCount} rule${rulesCount !== 1 ? 's' : ''}
          </span>
          <span>${formatBytes(contentBytes)}</span>
        </div>
      </div>
    `;
  }).join('');

  // Tree rendering removed (network topology only)
}

function buildAndRenderCategoryTree(section, files, treeId) {
  const svgEl = document.getElementById(treeId);
  if (!svgEl) return;

  const width = svgEl.parentElement?.offsetWidth || 800;
  const height = Math.max(420, Math.min(900, files.length * 24 + 200));

  d3.select(`#${treeId}`).selectAll('*').remove();
  const svg = d3.select(`#${treeId}`)
    .attr('width', width)
    .attr('height', height);

  // Group files by category to avoid flat one-level trees
  const grouped = files.reduce((acc, file) => {
    const key = (file.computed_category || file.category || 'general').toLowerCase();
    if (!acc[key]) acc[key] = [];
    acc[key].push(file);
    return acc;
  }, {});

  const categoryNodes = Object.entries(grouped).map(([category, items]) => ({
    name: category.replace(/-/g, ' '),
    category,
    children: items.map(f => ({
      name: f.filename.replace('.md', ''),
      value: f.content_length || f.content?.length || 100,
      category: f.computed_category || f.category || section,
      fileId: f.id
    }))
  }));

  const treeData = {
    name: `${section.charAt(0).toUpperCase() + section.slice(1)}`,
    category: section,
    children: categoryNodes
  };

  // Create hierarchy
  const hierarchy = d3.hierarchy(treeData);
  const treeLayout = d3.tree().size([width - 40, height - 40]);
  const treeNodes = treeLayout(hierarchy);

  // Draw links
  svg.selectAll('.link')
    .data(treeNodes.links())
    .enter()
    .append('path')
    .attr('class', 'link')
    .attr('d', d3.linkVertical()
      .x(d => d.x)
      .y(d => d.y))
    .attr('fill', 'none')
    .attr('stroke', getCategoryColor(section))
    .attr('stroke-opacity', 0.4)
    .attr('stroke-width', 1.5);

  // Draw nodes with labels and click support
  const nodeGroups = svg.selectAll('.kb-tree-node')
    .data(treeNodes.descendants())
    .enter()
    .append('g')
    .attr('class', 'kb-tree-node')
    .attr('transform', d => `translate(${d.x}, ${d.y})`)
    .style('cursor', d => d.data.fileId ? 'pointer' : 'default')
    .on('click', (event, d) => {
      if (d.data.fileId) {
        openFileModal(d.data.fileId);
      }
    });

  nodeGroups.append('circle')
    .attr('r', d => d.depth === 0 ? 8 : d.depth === 1 ? 10 : 6)
    .attr('fill', d => getCategoryColor(d.data.category || section))
    .attr('opacity', 0.85)
    .attr('stroke', 'rgba(255,255,255,0.35)')
    .attr('stroke-width', 1.2);

  nodeGroups.append('text')
    .attr('class', 'kb-tree-label')
    .attr('x', d => d.depth === 0 ? 12 : 10)
    .attr('y', 4)
    .attr('text-anchor', 'start')
    .text(d => (d.data.name || '').substring(0, d.depth === 1 ? 18 : 26));

  nodeGroups.append('title')
    .text(d => d.data.name || '');
}

function getCategoryColor(section) {
  const colors = {
    'workflow': '#60a5fa',
    'epics': '#22c55e',
    'architecture': '#f97316',
    'meetings': '#eab308',
    'analysis': '#ec4899',
    'practices': '#06b6d4'
  };
  return colors[section] || '#10b981';
}

function formatBytes(bytes) {
  if (!bytes) return '0 B';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

async function openFileModal(fileId) {
  selectedFileId = fileId;

  try {
    const response = await fetch(`/knowledge-base/api/file/${fileId}`);
    const data = await response.json();
    const file = data.file;

    document.getElementById('modal-title').textContent = file.filename.replace('.md', '');

    const categoryBadge = document.getElementById('modal-category');
    categoryBadge.textContent = file.computed_category || file.category || 'document';
    categoryBadge.style.background = getCategoryColor(file.category || 'practices');

    const templateBadge = document.getElementById('modal-template');
    if (file.is_template) {
      templateBadge.textContent = 'Template';
      templateBadge.style.display = 'inline-block';
    } else {
      templateBadge.style.display = 'none';
    }

    document.getElementById('modal-size').textContent = formatBytes(file.content.length);

    // Tags
    const tagsContainer = document.getElementById('modal-tags');
    if (file.tags && file.tags.length > 0) {
      tagsContainer.innerHTML = file.tags.map(tag =>
        `<span class="tag">${tag}</span>`
      ).join('');
    } else {
      tagsContainer.innerHTML = '';
    }

    // Rules
    const rulesList = document.getElementById('modal-rules');
    if (file.key_rules && file.key_rules.length > 0) {
      rulesList.innerHTML = file.key_rules.map(rule =>
        `<li>${rule}</li>`
      ).join('');
    } else {
      rulesList.innerHTML = '<li>No key rules documented</li>';
    }

    // Content preview
    const contentPreview = file.content.substring(0, 1000);
    document.getElementById('modal-content').textContent = contentPreview + (file.content.length > 1000 ? '\n\n[... truncated]' : '');

    // Show modal
    document.getElementById('file-modal').classList.remove('hidden');
  } catch (error) {
    console.error('Failed to load file:', error);
    alert('Failed to load file details');
  }
}

function closeModal() {
  document.getElementById('file-modal').classList.add('hidden');
  selectedFileId = null;
}

function useInPrompt() {
  if (selectedFileId) {
    window.location.href = `/?kb-selected=${selectedFileId}`;
  }
}

// Close modal on overlay click
document.addEventListener('click', (e) => {
  if (e.target.id === 'file-modal') {
    closeModal();
  }
});

// Close modal on Escape
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !document.getElementById('file-modal').classList.contains('hidden')) {
    closeModal();
  }
});
