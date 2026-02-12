/**
 * Global RTE Selector
 * Persists RTE selection across pages via localStorage
 * Falls back to server-defined default
 */

class RTESelector {
  constructor() {
    this.storageKey = 'poai_session_rte';  // Session override (cleared on new session)
    this.defaultKey = 'poai_default_rte';  // Persistent default from Settings page
    this.rtes = [];
    this.currentRteId = null;
    this.defaultRteId = null;
    this.listeners = [];
    this.initialized = false;
    
    this.init();
  }
  
  async init() {
    // Fetch available RTEs first (includes server default)
    await this.loadRTEs();
    
    // Priority: session override → settings default (localStorage) → server default
    const sessionRte = sessionStorage.getItem(this.storageKey);
    const settingsDefault = localStorage.getItem(this.defaultKey);
    
    if (sessionRte) {
      const id = parseInt(sessionRte, 10);
      if (this.rtes.find(r => r.id === id)) this.currentRteId = id;
    }
    
    if (!this.currentRteId && settingsDefault) {
      const id = parseInt(settingsDefault, 10);
      if (this.rtes.find(r => r.id === id)) this.currentRteId = id;
    }
    
    // If no valid stored RTE, use server default
    if (!this.currentRteId) {
      this.currentRteId = this.defaultRteId;
    }
    
    this.initialized = true;
    
    // Create UI if container exists
    const container = document.getElementById('globalRteSelector');
    if (container) {
      this.renderSelector(container);
    }
    
    // Notify listeners of initial value
    this.listeners.forEach(fn => fn(this.currentRteId));
  }
  
  async loadRTEs() {
    try {
      const resp = await fetch('/api/rtes');
      const data = await resp.json();
      this.rtes = data.rtes || [];
      this.defaultRteId = data.defaultRteId || (this.rtes[0]?.id);
    } catch (err) {
      console.error('Failed to load RTEs:', err);
      this.rtes = [];
    }
  }
  
  renderSelector(container) {
    if (this.rtes.length === 0) {
      container.innerHTML = '<span style="color: #6e7681; font-size: 0.85rem;">No RTEs</span>';
      return;
    }
    
    const currentRte = this.rtes.find(r => r.id === this.currentRteId);
    const rteName = currentRte ? currentRte.name : 'Select RTE';
    
    container.innerHTML = `
      <div class="rte-selector">
        <button class="rte-selector-btn" id="rteSelectorBtn">
          <span class="rte-icon">📋</span>
          <span class="rte-name">${this.escapeHtml(rteName)}</span>
          <span class="rte-dropdown-icon">▼</span>
        </button>
        <div class="rte-dropdown" id="rteDropdown">
          ${this.rtes.map(rte => `
            <div class="rte-option ${rte.id === this.currentRteId ? 'active' : ''}" 
                 data-id="${rte.id}">
              <span class="rte-option-name">${this.escapeHtml(rte.name)}</span>
              <span class="rte-option-badges">
                ${rte.isDefault ? '<span class="rte-default-badge">default</span>' : ''}
                ${rte.id === this.currentRteId ? '<span class="rte-check">✓</span>' : ''}
              </span>
            </div>
          `).join('')}
        </div>
      </div>
    `;
    
    // Bind events
    const btn = container.querySelector('#rteSelectorBtn');
    const dropdown = container.querySelector('#rteDropdown');
    
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      dropdown.classList.toggle('open');
    });
    
    // Option click
    container.querySelectorAll('.rte-option').forEach(option => {
      option.addEventListener('click', () => {
        const id = parseInt(option.dataset.id, 10);
        this.selectRTE(id);
        dropdown.classList.remove('open');
      });
    });
    
    // Close on outside click
    document.addEventListener('click', () => {
      dropdown.classList.remove('open');
    });
  }
  
  selectRTE(id) {
    this.currentRteId = id;
    sessionStorage.setItem(this.storageKey, id);  // Session-only override
    
    // Notify listeners
    this.listeners.forEach(fn => fn(id));
    
    // Re-render selector
    const container = document.getElementById('globalRteSelector');
    if (container) {
      this.renderSelector(container);
    }
  }
  
  getCurrentRteId() {
    return this.currentRteId;
  }
  
  getRTEs() {
    return this.rtes;
  }
  
  onChange(callback) {
    this.listeners.push(callback);
    return () => {
      this.listeners = this.listeners.filter(fn => fn !== callback);
    };
  }
  
  escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str || '';
    return div.innerHTML;
  }
}

// Global instance
window.rteSelector = new RTESelector();
