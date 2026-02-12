/**
 * Command Palette Component
 * Universal search and action palette (⌘K / Ctrl+K)
 * 
 * Features:
 * - Fuzzy search across all commands
 * - Quick navigation to any page
 * - Direct actions (ask, search, trend)
 * - Keyboard-only navigation
 */

class CommandPalette {
  constructor() {
    this.isOpen = false;
    this.selectedIndex = 0;
    this.filteredCommands = [];
    this.query = '';
    
    // All available commands
    this.commands = [
      // Navigation
      { type: 'nav', icon: '🏠', label: 'Go to Home', action: () => window.location.href = '/', keywords: 'home dashboard hub' },
      { type: 'nav', icon: '📥', label: 'Go to Ingest', action: () => window.location.href = '/ingest', keywords: 'ingest log capture write' },
      { type: 'nav', icon: '❓', label: 'Go to Ask', action: () => window.location.href = '/ask', keywords: 'ask question query' },
      { type: 'nav', icon: '📈', label: 'Go to Trends', action: () => window.location.href = '/trend', keywords: 'trend timeline analysis' },
      { type: 'nav', icon: '🔍', label: 'Go to Search', action: () => window.location.href = '/search', keywords: 'search find documents' },
      { type: 'nav', icon: '📄', label: 'Go to Deep Analysis', action: () => window.location.href = '/analyze', keywords: 'analyze deep analysis architecture' },
      { type: 'nav', icon: '🗂️', label: 'Go to Navigator', action: () => window.location.href = '/navigator', keywords: 'navigator files browse' },
      { type: 'nav', icon: '🕸️', label: 'Go to Network', action: () => window.location.href = '/network', keywords: 'network graph relationships actors' },
      { type: 'nav', icon: '🏷️', label: 'Go to Tags', action: () => window.location.href = '/tags', keywords: 'tags labels categories' },
      { type: 'nav', icon: '�', label: 'Go to Register', action: () => window.location.href = '/register', keywords: 'register risk action blocker markers semantic questions decisions severity owner due date tracking' },
      { type: 'nav', icon: '☀️', label: 'Go to Standup', action: () => window.location.href = '/standup', keywords: 'standup daily summary yesterday today activity' },
      { type: 'nav', icon: '👥', label: 'Go to Stakeholders', action: () => window.location.href = '/stakeholders', keywords: 'stakeholders people person profile notes team' },
      { type: 'nav', icon: '🧪', label: 'Go to Suggestions', action: () => window.location.href = '/suggestions', keywords: 'suggestions inbox relationships review' },
      { type: 'nav', icon: '⚙️', label: 'Go to Settings', action: () => window.location.href = '/settings', keywords: 'settings config preferences llm' },
      { type: 'nav', icon: '🔧', label: 'Go to Maintenance', action: () => window.location.href = '/maintenance', keywords: 'maintenance system status' },
      { type: 'nav', icon: '🌐', label: 'Go to Translate', action: () => window.location.href = '/translate', keywords: 'translate dutch english' },
      { type: 'nav', icon: '🗺️', label: 'Go to Guide', action: () => window.location.href = '/guide', keywords: 'guide tour help onboarding walkthrough features' },
      
      // Quick actions (these will be enhanced with the query)
      { type: 'action', icon: '🔍', label: 'Search for...', action: (q) => window.location.href = `/search?q=${encodeURIComponent(q)}`, keywords: 'search find', requiresQuery: true },
      { type: 'action', icon: '❓', label: 'Ask about...', action: (q) => window.location.href = `/ask?q=${encodeURIComponent(q)}`, keywords: 'ask question', requiresQuery: true },
      { type: 'action', icon: '📈', label: 'Trend for...', action: (q) => window.location.href = `/trend?topic=${encodeURIComponent(q)}`, keywords: 'trend timeline', requiresQuery: true },
    ];
    
    this.init();
  }
  
  init() {
    // Create DOM elements
    this.createElements();
    
    // Bind keyboard shortcuts
    document.addEventListener('keydown', (e) => this.handleGlobalKeydown(e));
  }
  
  createElements() {
    // Overlay
    this.overlay = document.createElement('div');
    this.overlay.className = 'cmd-palette-overlay';
    this.overlay.innerHTML = `
      <div class="cmd-palette">
        <div class="cmd-palette-header">
          <input type="text" class="cmd-palette-input" placeholder="Type a command or search..." autocomplete="off">
          <kbd class="cmd-palette-hint">ESC</kbd>
        </div>
        <div class="cmd-palette-results"></div>
        <div class="cmd-palette-footer">
          <span><kbd>↑↓</kbd> Navigate</span>
          <span><kbd>Enter</kbd> Select</span>
          <span><kbd>ESC</kbd> Close</span>
        </div>
      </div>
    `;
    
    document.body.appendChild(this.overlay);
    
    // Get references
    this.input = this.overlay.querySelector('.cmd-palette-input');
    this.results = this.overlay.querySelector('.cmd-palette-results');
    
    // Bind events
    this.overlay.addEventListener('click', (e) => {
      if (e.target === this.overlay) this.close();
    });
    
    this.input.addEventListener('input', (e) => this.handleInput(e));
    this.input.addEventListener('keydown', (e) => this.handleInputKeydown(e));
  }
  
  handleGlobalKeydown(e) {
    // ⌘K or Ctrl+K to open
    if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
      e.preventDefault();
      this.toggle();
      return;
    }
    
    // / to open (if not in input)
    if (e.key === '/' && !this.isOpen) {
      const activeElement = document.activeElement;
      const isInput = activeElement.tagName === 'INPUT' || 
                      activeElement.tagName === 'TEXTAREA' ||
                      activeElement.isContentEditable;
      if (!isInput) {
        e.preventDefault();
        this.open();
      }
    }
  }
  
  handleInput(e) {
    this.query = e.target.value;
    this.filterCommands();
    this.render();
  }
  
  handleInputKeydown(e) {
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        this.selectedIndex = Math.min(this.selectedIndex + 1, this.filteredCommands.length - 1);
        this.render();
        break;
        
      case 'ArrowUp':
        e.preventDefault();
        this.selectedIndex = Math.max(this.selectedIndex - 1, 0);
        this.render();
        break;
        
      case 'Enter':
        e.preventDefault();
        this.executeSelected();
        break;
        
      case 'Escape':
        e.preventDefault();
        this.close();
        break;
    }
  }
  
  filterCommands() {
    const q = this.query.toLowerCase().trim();
    
    if (!q) {
      // Show all navigation commands when empty
      this.filteredCommands = this.commands.filter(c => c.type === 'nav');
    } else {
      // First, check for nav matches
      const navMatches = this.commands.filter(cmd => {
        if (cmd.type !== 'nav') return false;
        const searchText = `${cmd.label} ${cmd.keywords}`.toLowerCase();
        return searchText.includes(q);
      });
      
      // Always add query-based actions at the top when there's a query
      const queryActions = this.commands
        .filter(c => c.requiresQuery)
        .map(c => ({
          ...c,
          label: `${c.label.replace('...', '')} "${q}"`,
          executeFn: () => c.action(q)
        }));
      
      // Combine: actions first, then nav matches
      this.filteredCommands = [...queryActions, ...navMatches];
    }
    
    this.selectedIndex = 0;
  }
  
  render() {
    if (this.filteredCommands.length === 0) {
      this.results.innerHTML = `
        <div class="cmd-palette-empty">
          No commands found. Try a different search.
        </div>
      `;
      return;
    }
    
    const html = this.filteredCommands.map((cmd, i) => {
      const isSelected = i === this.selectedIndex;
      const typeClass = cmd.type === 'action' ? 'cmd-action' : 'cmd-nav';
      return `
        <div class="cmd-palette-item ${isSelected ? 'selected' : ''} ${typeClass}" data-index="${i}">
          <span class="cmd-icon">${cmd.icon}</span>
          <span class="cmd-label">${cmd.label}</span>
          ${cmd.type === 'action' ? '<span class="cmd-badge">Action</span>' : ''}
        </div>
      `;
    }).join('');
    
    this.results.innerHTML = html;
    
    // Bind click events
    this.results.querySelectorAll('.cmd-palette-item').forEach(item => {
      item.addEventListener('click', () => {
        this.selectedIndex = parseInt(item.dataset.index);
        this.executeSelected();
      });
      item.addEventListener('mouseenter', () => {
        this.selectedIndex = parseInt(item.dataset.index);
        this.render();
      });
    });
    
    // Scroll selected into view
    const selectedEl = this.results.querySelector('.selected');
    if (selectedEl) {
      selectedEl.scrollIntoView({ block: 'nearest' });
    }
  }
  
  executeSelected() {
    const cmd = this.filteredCommands[this.selectedIndex];
    if (!cmd) return;
    
    this.close();
    
    if (cmd.executeFn) {
      cmd.executeFn();
    } else if (cmd.action) {
      cmd.action(this.query);
    }
  }
  
  toggle() {
    if (this.isOpen) {
      this.close();
    } else {
      this.open();
    }
  }
  
  open() {
    this.isOpen = true;
    this.query = '';
    this.selectedIndex = 0;
    this.overlay.classList.add('open');
    this.input.value = '';
    this.filterCommands();
    this.render();
    
    // Focus input after animation
    setTimeout(() => this.input.focus(), 50);
  }
  
  close() {
    this.isOpen = false;
    this.overlay.classList.remove('open');
    this.input.blur();
  }
}

// Auto-initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => new CommandPalette());
} else {
  new CommandPalette();
}
