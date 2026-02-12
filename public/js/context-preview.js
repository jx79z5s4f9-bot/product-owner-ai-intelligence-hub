/**
 * Context Preview System
 * Shows what documents will be injected before query submission
 * Makes the "magic" transparent and controllable
 */

class ContextPreview {
  constructor() {
    this.panel = document.getElementById('contextPreviewPanel');
    this.content = document.getElementById('contextPreviewContent');
    this.promptInput = document.getElementById('promptInput');
    this.submitBtn = document.getElementById('submitBtn');
    
    this.selectedDocs = [];
    this.lastQuery = '';
    this.debounceTimer = null;

    this.init();
  }

  init() {
    // Listen to prompt changes with debounce
    this.promptInput.addEventListener('input', () => {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = setTimeout(() => this.analyzeQuery(), 800);
    });

    // Button actions
    document.getElementById('contextRefreshBtn')?.addEventListener('click', () => {
      this.analyzeQuery();
    });

    document.getElementById('contextEditBtn')?.addEventListener('click', () => {
      this.openFullEditor();
    });

    document.getElementById('contextClearBtn')?.addEventListener('click', () => {
      this.clearContext();
    });
  }

  async analyzeQuery() {
    const query = this.promptInput.value.trim();
    
    if (!query || query.length < 5) {
      this.hidePanel();
      return;
    }

    if (query === this.lastQuery) {
      return; // No change
    }

    this.lastQuery = query;
    this.showPanel();
    this.showLoading();

    try {
      // Call backend to analyze query and get recommended context
      const response = await fetch('/api/context/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query })
      });

      if (!response.ok) {
        throw new Error('Context analysis failed');
      }

      const data = await response.json();
      this.selectedDocs = data.documents || [];
      this.renderDocuments();
      await this.previewContext();
    } catch (error) {
      console.error('Context analysis error:', error);
      this.showError('Failed to analyze query context');
    }
  }

  async previewContext() {
    try {
      const query = this.promptInput.value.trim();
      if (!query) return;

      const conversationId = document.getElementById('conversationId')?.value || null;
      const selectedIds = (this.selectedDocs || []).map(d => d.id).filter(Boolean);

      const response = await fetch('/api/context/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query, conversationId, selectedMdFiles: selectedIds })
      });

      if (!response.ok) return;
      const data = await response.json();
      this.updateTransparencyPanel(data);
    } catch (err) {
      console.warn('Context preview failed:', err);
    }
  }

  updateTransparencyPanel(data) {
    const tokenEl = document.getElementById('tokenCount');
    const docEl = document.getElementById('docCount');
    const historyEl = document.getElementById('historyCount');
    const warningEl = document.getElementById('contextWarning');
    const docsList = document.getElementById('contextDocsList');

    if (tokenEl) tokenEl.textContent = `${data.tokenCount || 0} tokens`;
    if (docEl) docEl.textContent = `${(data.documents || []).length} documents`;
    if (historyEl) historyEl.textContent = `${data.historyMessages || 0} history messages`;

    if (warningEl) {
      if (data.willTruncate) warningEl.classList.remove('hidden');
      else warningEl.classList.add('hidden');
    }

    if (docsList) {
      if (!data.documents || data.documents.length === 0) {
        docsList.innerHTML = '<div class="context-doc-row"><span>No documents selected</span></div>';
      } else {
        docsList.innerHTML = data.documents.map(d => `
          <div class="context-doc-row">
            <span>${this.truncate(d.filename || d.name, 45)}</span>
            <span>${d.category || 'doc'}</span>
          </div>
        `).join('');
      }
    }
  }

  showPanel() {
    if (this.panel.classList.contains('hidden')) {
      this.panel.classList.remove('hidden');
    }
  }

  hidePanel() {
    if (!this.panel.classList.contains('hidden')) {
      this.panel.classList.add('hidden');
    }
  }

  showLoading() {
    this.content.innerHTML = '<p class="context-loading">🔍 Analyzing query and finding relevant documents...</p>';
  }

  showError(message) {
    this.content.innerHTML = `<p class="context-loading" style="color: var(--danger);">⚠️ ${message}</p>`;
  }

  renderDocuments() {
    if (!this.selectedDocs || this.selectedDocs.length === 0) {
      this.content.innerHTML = '<p class="context-loading">💡 No specific documents detected. System will use general context.</p>';
      return;
    }

    const html = this.selectedDocs.map((doc, idx) => `
      <div class="context-doc-item" data-doc-id="${doc.id || idx}">
        <div class="context-doc-info">
          <div>
            <span class="context-doc-category">${doc.category || 'general'}</span>
            <span class="context-doc-name">${this.truncate(doc.filename || doc.name, 45)}</span>
          </div>
          <div class="context-doc-reason">${doc.reason || 'Relevant to your query'}</div>
        </div>
        <div class="context-doc-actions">
          <button class="btn-context-remove" onclick="contextPreview.removeDoc(${idx})">✕</button>
        </div>
      </div>
    `).join('');

    this.content.innerHTML = html;
  }

  removeDoc(index) {
    this.selectedDocs.splice(index, 1);
    this.renderDocuments();
  }

  clearContext() {
    this.selectedDocs = [];
    this.renderDocuments();
  }

  openFullEditor() {
    // Future: Open modal with full KB for manual selection
    alert('Full context editor coming soon! For now, use the Knowledge Base page to explore documents.');
  }

  truncate(text, maxLength) {
    if (!text) return '';
    return text.length > maxLength ? text.substring(0, maxLength - 3) + '...' : text;
  }

  // Get selected documents (for submission)
  getSelectedDocuments() {
    return this.selectedDocs;
  }
}

// Initialize on page load
let contextPreview;
document.addEventListener('DOMContentLoaded', () => {
  contextPreview = new ContextPreview();
});
