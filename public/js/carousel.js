// Dashboard Carousel Control
// Manages the 3D carousel in bottom left with center focus

class DashboardCarousel {
  constructor() {
    this.track = document.getElementById('carouselTrack');
    this.cards = Array.from(document.querySelectorAll('.carousel-card'));
    this.prevBtn = document.getElementById('carouselPrev');
    this.nextBtn = document.getElementById('carouselNext');

    this.currentIndex = this.getRandomIndex();
    this.isAnimating = false;

    this.init();
  }

  init() {
    // Set initial positions
    this.updateCarousel();

    // Navigation buttons
    this.prevBtn.addEventListener('click', () => this.navigate(-1));
    this.nextBtn.addEventListener('click', () => this.navigate(1));

    // Card click handlers
    this.cards.forEach((card, index) => {
      card.addEventListener('click', (e) => {
        e.stopPropagation();

        // If clicking center card, flip it
        if (index === this.currentIndex) {
          this.flipCard(card);
        } else {
          // If clicking side card, navigate to it
          const direction = index > this.currentIndex ? 1 : -1;
          const steps = Math.abs(index - this.currentIndex);
          for (let i = 0; i < steps; i++) {
            this.navigate(direction);
          }
        }
      });
    });

    // Card action button handlers
    document.querySelectorAll('.card-action-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const card = e.target.closest('.carousel-card');
        const command = card.dataset.command;
        this.executeCommand(command);
      });
    });

    // Touch/swipe support
    this.setupSwipeGestures();
  }

  getRandomIndex() {
    return Math.floor(Math.random() * this.cards.length);
  }

  navigate(direction) {
    if (this.isAnimating) return;

    this.isAnimating = true;

    // Update index (wrap around)
    this.currentIndex = (this.currentIndex + direction + this.cards.length) % this.cards.length;

    // Update carousel
    this.updateCarousel();

    // Reset animation lock
    setTimeout(() => {
      this.isAnimating = false;
    }, 400);
  }

  updateCarousel() {
    this.cards.forEach((card, index) => {
      // Calculate position relative to current center
      const offset = this.getOffset(index);

      // Remove all position classes
      card.classList.remove('center', 'left', 'right', 'hidden', 'flipped');

      if (offset === 0) {
        // Center card
        card.classList.add('center');
        card.style.transform = 'translateX(0) scale(1)';
        card.style.zIndex = 3;
        card.style.opacity = '1';
      } else if (offset === -1) {
        // Left card
        card.classList.add('left');
        card.style.transform = 'translateX(-80%) scale(0.8) translateZ(-30px)';
        card.style.zIndex = 2;
        card.style.opacity = '0.6';
      } else if (offset === 1) {
        // Right card
        card.classList.add('right');
        card.style.transform = 'translateX(80%) scale(0.8) translateZ(-30px)';
        card.style.zIndex = 2;
        card.style.opacity = '0.6';
      } else {
        // Hidden cards
        card.classList.add('hidden');
        card.style.transform = offset < 0 ? 'translateX(-180%) scale(0.5)' : 'translateX(180%) scale(0.5)';
        card.style.zIndex = 1;
        card.style.opacity = '0';
      }
    });
  }

  getOffset(index) {
    // Calculate shortest distance considering wrap-around
    const total = this.cards.length;
    let offset = index - this.currentIndex;

    // Adjust for wrap-around
    if (offset > total / 2) {
      offset -= total;
    } else if (offset < -total / 2) {
      offset += total;
    }

    return offset;
  }

  flipCard(card) {
    card.classList.toggle('flipped');
  }

  executeCommand(command) {
    console.log('Executing command:', command);

    switch (command) {
      case 'health-check':
        this.runHealthCheck();
        break;
      case 'new-idea':
        this.openNewIdea();
        break;
      case 'pipeline':
        this.openPipeline();
        break;
      case 'wsjf':
        this.openWSJF();
        break;
      case 'workspace':
        this.openWorkspace();
        break;
      case 'trends':
        this.openTrends();
        break;
      case 'recent':
        window.location.href = '/conversations';
        break;
      case 'search':
        this.openSearch();
        break;
      default:
        console.warn('Unknown command:', command);
    }
  }

  runHealthCheck() {
    const promptInput = document.getElementById('promptInput');
    promptInput.value = 'Run a health check on my current pipeline. Identify any blockers, risks, or wins.';
    promptInput.scrollIntoView({ behavior: 'smooth' });
  }

  openNewIdea() {
    const promptInput = document.getElementById('promptInput');
    promptInput.value = 'I have a new idea: ';
    promptInput.focus();
    promptInput.scrollIntoView({ behavior: 'smooth' });
  }

  openPipeline() {
    const promptInput = document.getElementById('promptInput');
    promptInput.value = 'Show me my current pipeline status and next actions.';
    promptInput.scrollIntoView({ behavior: 'smooth' });
  }

  openWSJF() {
    const promptInput = document.getElementById('promptInput');
    promptInput.value = 'Help me calculate WSJF scores for my features. I need to prioritize based on business value, time criticality, risk reduction, and job size.';
    promptInput.scrollIntoView({ behavior: 'smooth' });
  }

  openWorkspace() {
    window.location.href = '/knowledge-base';
  }

  openTrends() {
    const promptInput = document.getElementById('promptInput');
    promptInput.value = 'Analyze trends in my pipeline: cycle times, velocity, and patterns.';
    promptInput.scrollIntoView({ behavior: 'smooth' });
  }

  openSearch() {
    const promptInput = document.getElementById('promptInput');
    promptInput.value = 'Search for: ';
    promptInput.focus();
    promptInput.scrollIntoView({ behavior: 'smooth' });
  }

  setupSwipeGestures() {
    let touchStartX = 0;
    let touchEndX = 0;

    this.track.addEventListener('touchstart', (e) => {
      touchStartX = e.changedTouches[0].screenX;
    }, { passive: true });

    this.track.addEventListener('touchend', (e) => {
      touchEndX = e.changedTouches[0].screenX;
      this.handleSwipe();
    }, { passive: true });

    const handleSwipe = () => {
      const swipeThreshold = 50;
      const diff = touchStartX - touchEndX;

      if (Math.abs(diff) > swipeThreshold) {
        if (diff > 0) {
          // Swipe left - next
          this.navigate(1);
        } else {
          // Swipe right - prev
          this.navigate(-1);
        }
      }
    };

    this.handleSwipe = handleSwipe;
  }
}

// Initialize carousel when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  new DashboardCarousel();
});
