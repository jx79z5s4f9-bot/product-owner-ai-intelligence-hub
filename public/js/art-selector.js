/**
 * RTE Selector - Manages RTE (Release Train Engine) selection and context
 * Loads from rte_instances table, provides context for AI conversations
 */

const ARTSelector = {
  selectedArtId: null,
  arts: [], // Actually RTEs now

  async init() {
    await this.loadArts();
    this.renderSelector();
    this.loadSavedSelection();
  },

  async loadArts() {
    try {
      // Load from RTE instances (the unified model)
      const response = await fetch('/api/rte');
      const data = await response.json();
      this.arts = data.rtes || [];
      console.log('Loaded RTEs:', this.arts);
    } catch (error) {
      console.error('Failed to load RTEs:', error);
      this.arts = [];
    }
  },

  renderSelector() {
    const container = document.getElementById('art-selector') || document.getElementById('artSelectorCompact');
    if (!container) return;

    if (this.arts.length === 0) {
      container.innerHTML = `
        <div class="art-selector-empty">
          <span>No ARTs configured</span>
        </div>
      `;
      return;
    }

    // Compact version for top bar
    container.innerHTML = `
      <select id="art-select" class="art-dropdown">
        <option value="">Select Project...</option>
        ${this.arts.map(art => `
          <option value="${art.id}" ${art.id === this.selectedArtId ? 'selected' : ''}>
            ${art.name}${art.current_sprint_number ? ` (Sprint ${art.current_sprint_number})` : ''}
          </option>
        `).join('')}
      </select>
    `;

    // Attach change listener
    document.getElementById('art-select').addEventListener('change', (e) => {
      const artId = parseInt(e.target.value);
      if (artId) {
        this.selectArt(artId);
      }
    });
  },

  async selectArt(artId) {
    this.selectedArtId = artId;
    sessionStorage.setItem('selected_art_id', artId);
    console.log('🎯 ART selected and saved:', artId);

    // Load and display current position
    await this.updateCurrentPosition(artId);

    // Notify listeners
    window.dispatchEvent(new CustomEvent('art-changed', { detail: { artId } }));

    console.log('ART selected:', artId);
  },

  async updateCurrentPosition(artId) {
    try {
      const response = await fetch(`/api/rte/${artId}`);
      const data = await response.json();
      const rte = data.rte || {};

      // Update context tab if it exists
      const positionDiv = document.getElementById('currentPosition');
      if (positionDiv && rte.current_sprint_number) {
        positionDiv.innerHTML = `
          <div class="position-label">Current Position</div>
          <div class="position-value">PI ${rte.current_pi_number} • Sprint ${rte.current_sprint_number}</div>
          <div class="position-dates">${this.formatDate(rte.current_sprint_start)} - ${this.formatDate(rte.current_sprint_end)}</div>
        `;
        positionDiv.style.display = 'block';
      }
    } catch (error) {
      console.error('Failed to load current position:', error);
    }
  },

  loadSavedSelection() {
    const saved = sessionStorage.getItem('selected_art_id');
    console.log('📂 Loading saved ART:', saved);
    if (saved) {
      const artId = parseInt(saved);
      const art = this.arts.find(a => a.id === artId);
      if (art) {
        console.log('✅ Found saved ART:', art.name);
        this.selectArt(artId);
        // Update dropdown UI
        const select = document.getElementById('art-select');
        if (select) select.value = artId;
      }
    } else {
      // Auto-select first ART if available
      if (this.arts.length > 0) {
        console.log('🔄 Auto-selecting first ART:', this.arts[0].name);
        this.selectArt(this.arts[0].id);
        const select = document.getElementById('art-select');
        if (select) select.value = this.arts[0].id;
      }
    }
  },

  getSelectedArtId() {
    return this.selectedArtId;
  },

  formatDate(dateStr) {
    if (!dateStr) return '';
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  },

  showCreateModal() {
    // TODO: Implement ART creation modal
    alert('ART creation UI coming soon. Use scripts/migrate-to-art.js for now.');
  }
};

// Initialize on load
document.addEventListener('DOMContentLoaded', () => {
  ARTSelector.init();
});

// Export
window.ARTSelector = ARTSelector;
