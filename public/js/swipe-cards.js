/**
 * Swipeable Card Deck Component
 * For reviewing suggestions with swipe gestures
 */

class SwipeableDeck {
  constructor(container, options = {}) {
    this.container = container;
    this.options = {
      onAccept: options.onAccept || (() => {}),
      onReject: options.onReject || (() => {}),
      onSkip: options.onSkip || (() => {}),
      onEmpty: options.onEmpty || (() => {}),
      threshold: options.threshold || 100, // px to trigger swipe
      ...options
    };
    
    this.cards = [];
    this.currentIndex = 0;
    this.startX = 0;
    this.startY = 0;
    this.isDragging = false;
    
    this.init();
  }
  
  init() {
    // Create deck structure
    this.deckEl = document.createElement('div');
    this.deckEl.className = 'swipe-deck';
    this.container.appendChild(this.deckEl);
    
    // Create action buttons
    this.actionsEl = document.createElement('div');
    this.actionsEl.className = 'swipe-actions';
    this.actionsEl.innerHTML = `
      <button class="swipe-action-btn reject" title="Reject (←)">✕</button>
      <button class="swipe-action-btn skip" title="Skip (↓)">↻</button>
      <button class="swipe-action-btn accept" title="Accept (→)">✓</button>
    `;
    this.container.appendChild(this.actionsEl);
    
    // Keyboard hints
    this.hintsEl = document.createElement('div');
    this.hintsEl.className = 'swipe-keyboard-hints';
    this.hintsEl.innerHTML = `
      <span><kbd>←</kbd> Reject</span>
      <span><kbd>↓</kbd> Skip</span>
      <span><kbd>→</kbd> Accept</span>
    `;
    this.container.appendChild(this.hintsEl);
    
    // Bind button events
    this.actionsEl.querySelector('.reject').addEventListener('click', () => this.reject());
    this.actionsEl.querySelector('.skip').addEventListener('click', () => this.skip());
    this.actionsEl.querySelector('.accept').addEventListener('click', () => this.accept());
    
    // Keyboard navigation
    document.addEventListener('keydown', (e) => this.handleKeydown(e));
  }
  
  setCards(cards) {
    this.cards = cards;
    this.currentIndex = 0;
    this.render();
  }
  
  render() {
    this.deckEl.innerHTML = '';
    
    if (this.cards.length === 0) {
      this.showEmpty();
      return;
    }
    
    // Render up to 3 visible cards
    const visibleCards = this.cards.slice(this.currentIndex, this.currentIndex + 3);
    
    visibleCards.forEach((card, i) => {
      const cardEl = this.createCardElement(card, i === 0);
      this.deckEl.appendChild(cardEl);
    });
  }
  
  createCardElement(card, isActive) {
    const el = document.createElement('div');
    el.className = 'swipe-card';
    el.dataset.id = card.id;
    
    // Calculate evidence percentage (max 5 evidence = 100%)
    const evidencePercent = Math.min(100, (card.evidenceCount || card.mention_count || 1) * 20);
    const confidence = card.confidence || 0;
    
    // Support both old format (from_name/to_name) and new format (title/subtitle)
    const title = card.title || `${card.from_name || card.source} → ${card.to_name || card.target}`;
    const subtitle = card.subtitle || card.relationship_type || card.type || 'related to';
    const details = card.details || '';
    const context = (card.contexts && card.contexts[0]) ? card.contexts[0].slice(0, 150) + '...' : '';
    
    el.innerHTML = `
      <div class="swipe-indicator reject">REJECT</div>
      <div class="swipe-indicator accept">ACCEPT</div>
      <div class="swipe-card-content">
        <div class="swipe-relationship">
          <div class="swipe-title">${this.escapeHtml(title)}</div>
          <div class="swipe-type">${this.escapeHtml(subtitle)}</div>
          ${details ? `<div class="swipe-details">${this.escapeHtml(details)}</div>` : ''}
        </div>
        ${context ? `
          <div class="swipe-context">
            <div class="swipe-context-label">Context:</div>
            <div class="swipe-context-text">"${this.escapeHtml(context)}"</div>
          </div>
        ` : ''}
        <div class="swipe-evidence">
          <div class="swipe-evidence-label">Evidence Strength</div>
          <div class="swipe-evidence-bar">
            <div class="swipe-evidence-fill" style="width: ${evidencePercent}%"></div>
          </div>
          <div class="swipe-count">
            <span>🔥 ${card.evidenceCount || card.mention_count || 1} evidence</span>
            ${confidence > 0 ? `<span>${confidence}% confidence</span>` : ''}
          </div>
        </div>
      </div>
    `;
    
    if (isActive) {
      this.bindDragEvents(el);
    }
    
    return el;
  }
  
  escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str || '';
    return div.innerHTML;
  }
  
  bindDragEvents(el) {
    // Touch events
    el.addEventListener('touchstart', (e) => this.handleDragStart(e), { passive: true });
    el.addEventListener('touchmove', (e) => this.handleDragMove(e), { passive: false });
    el.addEventListener('touchend', (e) => this.handleDragEnd(e));
    
    // Mouse events
    el.addEventListener('mousedown', (e) => this.handleDragStart(e));
    document.addEventListener('mousemove', (e) => this.handleDragMove(e));
    document.addEventListener('mouseup', (e) => this.handleDragEnd(e));
  }
  
  handleDragStart(e) {
    const point = e.touches ? e.touches[0] : e;
    this.startX = point.clientX;
    this.startY = point.clientY;
    this.isDragging = true;
    
    const card = this.deckEl.querySelector('.swipe-card');
    if (card) {
      card.classList.add('dragging');
    }
  }
  
  handleDragMove(e) {
    if (!this.isDragging) return;
    
    const point = e.touches ? e.touches[0] : e;
    const deltaX = point.clientX - this.startX;
    const deltaY = point.clientY - this.startY;
    
    const card = this.deckEl.querySelector('.swipe-card');
    if (!card) return;
    
    // Apply transform
    const rotation = deltaX * 0.1;
    card.style.transform = `translate(${deltaX}px, ${deltaY}px) rotate(${rotation}deg)`;
    
    // Show indicators
    card.classList.remove('swiping-left', 'swiping-right');
    if (deltaX < -this.options.threshold / 2) {
      card.classList.add('swiping-left');
    } else if (deltaX > this.options.threshold / 2) {
      card.classList.add('swiping-right');
    }
    
    // Prevent scroll on touch
    if (e.touches) {
      e.preventDefault();
    }
  }
  
  handleDragEnd(e) {
    if (!this.isDragging) return;
    this.isDragging = false;
    
    const card = this.deckEl.querySelector('.swipe-card');
    if (!card) return;
    
    card.classList.remove('dragging');
    
    const point = e.changedTouches ? e.changedTouches[0] : e;
    const deltaX = point.clientX - this.startX;
    
    if (deltaX < -this.options.threshold) {
      this.animateOut(card, 'left');
      setTimeout(() => this.reject(), 200);
    } else if (deltaX > this.options.threshold) {
      this.animateOut(card, 'right');
      setTimeout(() => this.accept(), 200);
    } else {
      // Snap back
      card.style.transform = '';
      card.classList.remove('swiping-left', 'swiping-right');
    }
  }
  
  animateOut(card, direction) {
    const translateX = direction === 'left' ? -500 : 500;
    const rotation = direction === 'left' ? -30 : 30;
    card.style.transition = 'transform 0.3s ease-out, opacity 0.3s ease-out';
    card.style.transform = `translate(${translateX}px, 0) rotate(${rotation}deg)`;
    card.style.opacity = '0';
  }
  
  handleKeydown(e) {
    // Only handle if swipe container is visible
    if (!this.container.classList.contains('active')) return;
    
    switch (e.key) {
      case 'ArrowLeft':
        e.preventDefault();
        this.reject();
        break;
      case 'ArrowRight':
        e.preventDefault();
        this.accept();
        break;
      case 'ArrowDown':
        e.preventDefault();
        this.skip();
        break;
    }
  }
  
  accept() {
    if (this.currentIndex >= this.cards.length) return;
    
    const card = this.cards[this.currentIndex];
    this.options.onAccept(card);
    this.next();
  }
  
  reject() {
    if (this.currentIndex >= this.cards.length) return;
    
    const card = this.cards[this.currentIndex];
    this.options.onReject(card);
    this.next();
  }
  
  skip() {
    if (this.currentIndex >= this.cards.length) return;
    
    const card = this.cards[this.currentIndex];
    this.options.onSkip(card);
    this.next();
  }
  
  next() {
    this.currentIndex++;
    if (this.currentIndex >= this.cards.length) {
      this.options.onEmpty();
    }
    this.render();
  }
  
  showEmpty() {
    this.deckEl.innerHTML = `
      <div class="swipe-empty">
        <div class="swipe-empty-icon">🎉</div>
        <h3>All caught up!</h3>
        <p>No more suggestions to review</p>
      </div>
    `;
    this.actionsEl.style.display = 'none';
    this.hintsEl.style.display = 'none';
  }
  
  getStats() {
    return {
      total: this.cards.length,
      remaining: this.cards.length - this.currentIndex,
      processed: this.currentIndex
    };
  }
}

// Export for use
window.SwipeableDeck = SwipeableDeck;
