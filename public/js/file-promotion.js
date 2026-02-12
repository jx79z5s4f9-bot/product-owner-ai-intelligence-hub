/**
 * File Promotion Workflow
 * Handles promoting ideas through stages: rough → developing → polished → backlog
 */

(function() {
  // Add "View Files" button to pipeline tile
  const pipelineTile = document.getElementById('pipeline-tile');
  if (pipelineTile) {
    pipelineTile.addEventListener('dblclick', showFilePipeline);
  }

  /**
   * Show file pipeline management modal
   */
  async function showFilePipeline() {
    try {
      // Fetch all workspace files
      const response = await fetch('/api/workspace/files/all');
      const data = await response.json();

      showFileManager(data.files || []);
    } catch (error) {
      console.error('Failed to load files:', error);
      alert('Failed to load workspace files');
    }
  }

  /**
   * Show file manager modal
   */
  function showFileManager(files) {
    // Group files by stage
    const byStage = {
      rough: files.filter(f => f.stage === 'rough'),
      developing: files.filter(f => f.stage === 'developing'),
      polished: files.filter(f => f.stage === 'polished'),
      program: files.filter(f => f.stage === 'program'),
      portfolio: files.filter(f => f.stage === 'portfolio')
    };

    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.innerHTML = `
      <div class="modal modal-xl file-manager-modal">
        <div class="modal-header">
          <h2 class="modal-title">📊 Pipeline - Idea Evolution</h2>
          <button class="modal-close" onclick="this.closest('.modal-overlay').remove()">&times;</button>
        </div>
        <div class="modal-body">
          <div class="pipeline-view">
            ${renderStageColumn('rough', 'Rough Ideas', byStage.rough, '60a5fa')}
            ${renderStageColumn('developing', 'Developing', byStage.developing, 'a855f7')}
            ${renderStageColumn('polished', 'Polished', byStage.polished, '22c55e')}
            ${renderStageColumn('program', 'Program Backlog', byStage.program, 'f97316')}
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-secondary" onclick="this.closest('.modal-overlay').remove()">Close</button>
        </div>
      </div>
    `;

    document.body.appendChild(modal);
  }

  function renderStageColumn(stage, title, files, color) {
    return `
      <div class="stage-column" data-stage="${stage}">
        <div class="stage-header" style="border-color: #${color}">
          <h3>${title}</h3>
          <span class="stage-count">${files.length}</span>
        </div>
        <div class="stage-files">
          ${files.length === 0 ? '<div class="empty-stage">No files yet</div>' : ''}
          ${files.map(file => renderFileCard(file, stage, color)).join('')}
        </div>
      </div>
    `;
  }

  function renderFileCard(file, stage, color) {
    const daysIdle = Math.floor((Date.now() - new Date(file.updated_at).getTime()) / (1000 * 60 * 60 * 24));

    const nextStage = getNextStage(stage);
    const actionLabel = getActionLabel(stage);

    return `
      <div class="file-card" data-file-id="${file.id}" style="border-left-color: #${color}">
        <div class="file-card-header">
          <strong class="file-title">${truncate(file.filename, 40)}</strong>
          ${daysIdle > 7 ? `<span class="days-idle">${daysIdle}d</span>` : ''}
        </div>
        <div class="file-card-meta">
          <span class="file-size">${formatBytes(file.content?.length || 0)}</span>
          <span class="file-date">${formatDate(file.updated_at)}</span>
        </div>
        <div class="file-card-actions">
          <button class="btn-sm btn-view" onclick="viewFile(${file.id})">
            👁️ View
          </button>
          ${nextStage ? `
            <button class="btn-sm btn-promote" onclick="promoteFile(${file.id}, '${nextStage}', '${stage}')" style="background: #${color}">
              → ${actionLabel}
            </button>
          ` : ''}
        </div>
      </div>
    `;
  }

  function getNextStage(currentStage) {
    const progression = {
      'rough': 'developing',
      'developing': 'polished',
      'polished': 'program',
      'program': null
    };
    return progression[currentStage];
  }

  function getActionLabel(stage) {
    const labels = {
      'rough': 'Develop',
      'developing': 'Polish',
      'polished': 'To Backlog'
    };
    return labels[stage] || 'Promote';
  }

  /**
   * View file details
   */
  window.viewFile = async function(fileId) {
    try {
      const response = await fetch(`/api/workspace/file/${fileId}`);
      const data = await response.json();
      const file = data.file;

      const detailModal = document.createElement('div');
      detailModal.className = 'modal-overlay';
      detailModal.innerHTML = `
        <div class="modal modal-lg">
          <div class="modal-header">
            <h2 class="modal-title">${file.filename}</h2>
            <button class="modal-close" onclick="this.closest('.modal-overlay').remove()">&times;</button>
          </div>
          <div class="modal-body">
            <div class="file-meta-row">
              <span class="badge">${file.stage}</span>
              <span class="text-muted">${formatDate(file.updated_at)}</span>
            </div>
            <pre class="file-content">${file.content}</pre>
          </div>
          <div class="modal-footer">
            <button class="btn btn-secondary" onclick="this.closest('.modal-overlay').remove()">Close</button>
          </div>
        </div>
      `;

      document.body.appendChild(detailModal);
    } catch (error) {
      console.error('Failed to load file:', error);
      alert('Failed to load file');
    }
  };

  /**
   * Promote file to next stage
   */
  window.promoteFile = async function(fileId, toStage, fromStage) {
    const confirmed = await POAI.confirm.show({
      title: 'Promote Idea',
      message: `Promote this idea to ${toStage}?`,
      confirmText: 'Promote',
      type: 'info'
    });
    if (!confirmed) return;

    try {
      // Get template content to append based on stage
      const templateContent = getTemplateForStage(toStage);

      const response = await fetch('/api/workspace/move-file', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fileId,
          toStage,
          appendContent: templateContent
        })
      });

      const data = await response.json();

      if (data.success) {
        alert(`✓ Promoted to ${toStage}!\n\nFile: ${data.filename}\nApplied template: ${getTemplateNameForStage(toStage)}`);

        // Reload pipeline view
        document.querySelector('.modal-overlay')?.remove();
        showFilePipeline();
      } else {
        alert('Failed to promote file');
      }
    } catch (error) {
      console.error('Promotion error:', error);
      alert('Error promoting file');
    }
  };

  function getTemplateForStage(stage) {
    const templates = {
      'developing': `

---

## Feasibility Analysis (Added: ${new Date().toISOString().split('T')[0]})

### Pros & Cons
**Pros:**
-

**Cons:**
-

### Technical Feasibility
- Technology:
- Complexity:
- Dependencies:

### User Impact
- User segments affected:
- Expected value:

### Cost Estimate
- Effort (story points):
- Timeline:

_Template applied from: idea-evolution-template.md_
`,

      'polished': `

---

## Business Case (Added: ${new Date().toISOString().split('T')[0]})

### Problem Statement
[Describe the problem this solves]

### Solution Overview
[High-level solution approach]

### Business Value
- Revenue impact:
- Cost savings:
- Strategic alignment:

### WSJF Scoring
- Business Value (1-10):
- Time Criticality (1-10):
- Risk Reduction (1-10):
- Job Size (1-10):
- **WSJF Score**: _[Calculate: (BV+TC+RR)÷Size]_

### Recommendation
[Priority and next steps]

_Template applied from: lean-business-case-template.md_
`,

      'program': `

---

## Program Backlog Entry (Added: ${new Date().toISOString().split('T')[0]})

### Feature Summary
[One-line feature description]

### Acceptance Criteria
- [ ]
- [ ]
- [ ]

### Dependencies
-

### PI Planning Notes
- Target PI:
- Team assignment:
- Risk level:

_Ready for PI Planning - workflow-orchestrator-v2.md applied_
`
    };

    return templates[stage] || '';
  }

  function getTemplateNameForStage(stage) {
    const names = {
      'developing': 'idea-evolution-template.md',
      'polished': 'lean-business-case-template.md',
      'program': 'workflow-orchestrator-v2.md'
    };
    return names[stage] || 'none';
  }

  // Helper functions
  function truncate(str, len) {
    return str.length > len ? str.substring(0, len) + '...' : str;
  }

  function formatBytes(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  }

  function formatDate(dateStr) {
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now - date;
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffDays === 0) return 'Today';
    if (diffDays === 1) return 'Yesterday';
    if (diffDays < 7) return `${diffDays} days ago`;
    return date.toLocaleDateString();
  }

  // Make showFilePipeline globally accessible
  window.showFilePipeline = showFilePipeline;
})();
