/**
 * Mode Selector V2 - Vertical Layout for Sidebar
 */

const ModeSelectorV2 = {
  currentMode: 'query',
  modes: {
    debrief: {
      title: 'DEBRIEF',
      icon: '🕵️',
      description: 'Log your day - meetings, tasks, observations'
    },
    organize: {
      title: 'ORGANIZE',
      icon: '📋',
      description: 'Process new content into structured docs'
    },
    query: {
      title: 'QUERY',
      icon: '❓',
      description: 'Ask questions about existing knowledge'
    },
    create: {
      title: 'CREATE',
      icon: '✨',
      description: 'Generate new artifacts and documents'
    }
  },

  init() {
    this.renderModeCards();
    this.attachEventListeners();
    this.loadSavedMode();
  },

  renderModeCards() {
    const container = document.getElementById('modeSelector');
    if (!container) return;

    container.innerHTML = Object.entries(this.modes).map(([key, mode]) => `
      <div class="mode-card-vertical ${key === this.currentMode ? 'active' : ''}" data-mode="${key}">
        <div class="mode-card-header">
          <span class="mode-icon">${mode.icon}</span>
          <span class="mode-title">${mode.title}</span>
        </div>
        <p class="mode-description">${mode.description}</p>
      </div>
    `).join('');
  },

  attachEventListeners() {
    document.querySelectorAll('.mode-card-vertical').forEach(card => {
      card.addEventListener('click', () => {
        const mode = card.dataset.mode;
        this.selectMode(mode);
      });
    });
  },

  selectMode(mode) {
    if (!this.modes[mode]) return;

    this.currentMode = mode;
    
    // Update visual state
    document.querySelectorAll('.mode-card-vertical').forEach(card => {
      card.classList.toggle('active', card.dataset.mode === mode);
    });

    // Save to session
    sessionStorage.setItem('selected_mode', mode);

    // Notify listeners
    window.dispatchEvent(new CustomEvent('mode-changed', { detail: { mode } }));
    
    console.log('Mode selected:', mode);
  },

  loadSavedMode() {
    const saved = sessionStorage.getItem('selected_mode');
    if (saved && this.modes[saved]) {
      this.selectMode(saved);
    }
  },

  getMode() {
    return this.currentMode;
  },

  handleModeDetection(detectedMode, confidence) {
    console.log(`Mode detected: ${detectedMode} (confidence: ${confidence})`);
    
    // Show hint if auto-detected mode differs
    if (detectedMode !== this.currentMode && confidence > 0.7) {
      const hintDiv = document.getElementById('modeHint');
      if (hintDiv) {
        hintDiv.textContent = `💡 Detected as ${this.modes[detectedMode].title} (${Math.round(confidence * 100)}% confidence)`;
        hintDiv.classList.remove('hidden');
        setTimeout(() => hintDiv.classList.add('hidden'), 5000);
      }
    }
  }
};

// Initialize on load
document.addEventListener('DOMContentLoaded', () => {
  ModeSelectorV2.init();
});

// Export
window.ModeSelectorV2 = ModeSelectorV2;
