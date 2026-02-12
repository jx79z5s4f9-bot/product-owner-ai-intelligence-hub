/**
 * Context Browser - Modal for selecting knowledge base files
 */

const ContextBrowser = {
  selectedFiles: new Set(),
  allFiles: [],

  async init() {
    await this.loadFiles();
  },

  async loadFiles() {
    try {
      const response = await fetch('/api/md-files');
      const data = await response.json();
      this.allFiles = data.files || [];
      this.renderFiles();
    } catch (error) {
      console.error('Failed to load files:', error);
    }
  },

  renderFiles() {
    const container = document.getElementById('kbResults');
    if (!container) return;

    container.innerHTML = this.allFiles.map(file => `
      <div class="kb-file-item">
        <input type="checkbox" id="file-${file.id}" value="${file.id}">
        <label for="file-${file.id}">
          <span class="file-icon">📄</span>
          <span class="file-name">${file.filename}</span>
          <span class="file-category">${file.category || ''}</span>
        </label>
      </div>
    `).join('');
  }
};

// Initialize on load
document.addEventListener('DOMContentLoaded', () => {
  ContextBrowser.init();
});

window.ContextBrowser = ContextBrowser;
