/**
 * PO AI UI Utilities
 * Global namespace for shared UI components: toast, confirm, modal, skeleton, form validation
 */

window.POAI = window.POAI || {};

// ============================================================================
// TOAST SYSTEM
// ============================================================================

POAI.toast = {
  container: null,

  init() {
    if (this.container) return;

    this.container = document.createElement('div');
    this.container.className = 'ds-toast-container';
    this.container.setAttribute('aria-live', 'polite');
    this.container.setAttribute('aria-atomic', 'false');
    document.body.appendChild(this.container);
  },

  getIcon(type) {
    const icons = {
      success: '✓',
      error: '✕',
      warning: '⚠',
      info: 'ℹ'
    };
    return icons[type] || icons.info;
  },

  show(message, type = 'info', duration = 4000) {
    this.init();

    const toast = document.createElement('div');
    toast.className = `ds-toast ds-toast--${type}`;
    toast.setAttribute('role', 'status');
    toast.innerHTML = `
      <span class="ds-toast-icon">${this.getIcon(type)}</span>
      <span class="ds-toast-message">${message}</span>
    `;

    this.container.appendChild(toast);

    // Trigger entrance animation
    requestAnimationFrame(() => {
      toast.classList.add('ds-toast--visible');
    });

    setTimeout(() => {
      toast.classList.remove('ds-toast--visible');
      toast.classList.add('ds-toast--exit');
      setTimeout(() => toast.remove(), 300);
    }, duration);

    return toast;
  },

  success(message, duration) { return this.show(message, 'success', duration); },
  error(message, duration) { return this.show(message, 'error', duration); },
  warning(message, duration) { return this.show(message, 'warning', duration); },
  info(message, duration) { return this.show(message, 'info', duration); }
};

// ============================================================================
// CONFIRM MODAL
// ============================================================================

POAI.confirm = {
  overlay: null,

  createOverlay() {
    if (this.overlay) return this.overlay;

    this.overlay = document.createElement('div');
    this.overlay.className = 'ds-confirm-overlay';
    this.overlay.setAttribute('role', 'dialog');
    this.overlay.setAttribute('aria-modal', 'true');
    this.overlay.innerHTML = `
      <div class="ds-confirm-modal">
        <div class="ds-confirm-icon"></div>
        <h3 class="ds-confirm-title"></h3>
        <p class="ds-confirm-message"></p>
        <div class="ds-confirm-actions">
          <button class="ds-confirm-cancel ds-btn ds-btn--secondary">Cancel</button>
          <button class="ds-confirm-ok ds-btn ds-btn--primary">Confirm</button>
        </div>
      </div>
    `;

    document.body.appendChild(this.overlay);
    return this.overlay;
  },

  show(options = {}) {
    const {
      title = 'Confirm',
      message = 'Are you sure?',
      confirmText = 'Confirm',
      cancelText = 'Cancel',
      type = 'info' // 'info' | 'warning' | 'danger'
    } = options;

    return new Promise((resolve) => {
      const overlay = this.createOverlay();
      const modal = overlay.querySelector('.ds-confirm-modal');
      const iconEl = overlay.querySelector('.ds-confirm-icon');
      const titleEl = overlay.querySelector('.ds-confirm-title');
      const messageEl = overlay.querySelector('.ds-confirm-message');
      const okBtn = overlay.querySelector('.ds-confirm-ok');
      const cancelBtn = overlay.querySelector('.ds-confirm-cancel');

      // Set content
      titleEl.textContent = title;
      titleEl.id = 'ds-confirm-title-' + Date.now();
      messageEl.textContent = message;
      okBtn.textContent = confirmText;
      cancelBtn.textContent = cancelText;

      // Set type styling
      modal.className = 'ds-confirm-modal';
      modal.classList.add(`ds-confirm-modal--${type}`);
      okBtn.className = 'ds-confirm-ok ds-btn';

      // Icon and button styling based on type
      const icons = { info: 'ℹ', warning: '⚠', danger: '⚠' };
      iconEl.textContent = icons[type] || icons.info;
      iconEl.className = `ds-confirm-icon ds-confirm-icon--${type}`;

      if (type === 'danger') {
        okBtn.classList.add('ds-btn--danger');
      } else if (type === 'warning') {
        okBtn.classList.add('ds-btn--warning');
      } else {
        okBtn.classList.add('ds-btn--primary');
      }

      // Set ARIA
      overlay.setAttribute('aria-labelledby', titleEl.id);

      // Store trigger element for focus restoration
      const triggerElement = document.activeElement;

      // Show overlay
      overlay.classList.add('ds-confirm-overlay--visible');

      // Focus the cancel button (safer default)
      setTimeout(() => cancelBtn.focus(), 50);

      // Cleanup function
      const cleanup = () => {
        overlay.classList.remove('ds-confirm-overlay--visible');
        okBtn.removeEventListener('click', handleOk);
        cancelBtn.removeEventListener('click', handleCancel);
        overlay.removeEventListener('click', handleOverlayClick);
        document.removeEventListener('keydown', handleKeydown);

        // Restore focus
        if (triggerElement && triggerElement.focus) {
          setTimeout(() => triggerElement.focus(), 50);
        }
      };

      // Handlers
      const handleOk = () => {
        cleanup();
        resolve(true);
      };

      const handleCancel = () => {
        cleanup();
        resolve(false);
      };

      const handleOverlayClick = (e) => {
        if (e.target === overlay) {
          handleCancel();
        }
      };

      const handleKeydown = (e) => {
        if (e.key === 'Escape') {
          handleCancel();
        }
        // Focus trap
        if (e.key === 'Tab') {
          const focusable = modal.querySelectorAll('button');
          const first = focusable[0];
          const last = focusable[focusable.length - 1];

          if (e.shiftKey && document.activeElement === first) {
            e.preventDefault();
            last.focus();
          } else if (!e.shiftKey && document.activeElement === last) {
            e.preventDefault();
            first.focus();
          }
        }
      };

      // Attach handlers
      okBtn.addEventListener('click', handleOk);
      cancelBtn.addEventListener('click', handleCancel);
      overlay.addEventListener('click', handleOverlayClick);
      document.addEventListener('keydown', handleKeydown);
    });
  },

  // Convenience methods
  danger(title, message, confirmText = 'Delete') {
    return this.show({ title, message, confirmText, type: 'danger' });
  },

  warning(title, message, confirmText = 'Continue') {
    return this.show({ title, message, confirmText, type: 'warning' });
  }
};

// ============================================================================
// MODAL HELPERS
// ============================================================================

POAI.modal = {
  activeModals: [],

  open(modalId) {
    const modal = document.getElementById(modalId);
    if (!modal) return;

    // Store trigger for focus restoration
    modal._triggerElement = document.activeElement;

    // Add ARIA attributes if not present
    if (!modal.hasAttribute('role')) {
      modal.setAttribute('role', 'dialog');
    }
    modal.setAttribute('aria-modal', 'true');

    // Show modal
    modal.classList.remove('hidden');
    modal.classList.add('ds-modal-overlay--visible');

    // Set up focus trap
    this.setupFocusTrap(modal);

    // Focus first focusable element
    const focusable = this.getFocusableElements(modal);
    if (focusable.length) {
      setTimeout(() => focusable[0].focus(), 50);
    }

    // Track active modal
    this.activeModals.push(modalId);

    // Add escape handler
    modal._escapeHandler = (e) => {
      if (e.key === 'Escape') {
        this.close(modalId);
      }
    };
    document.addEventListener('keydown', modal._escapeHandler);
  },

  close(modalId) {
    const modal = document.getElementById(modalId);
    if (!modal) return;

    // Hide modal
    modal.classList.add('hidden');
    modal.classList.remove('ds-modal-overlay--visible');

    // Remove escape handler
    if (modal._escapeHandler) {
      document.removeEventListener('keydown', modal._escapeHandler);
    }

    // Remove focus trap
    if (modal._focusTrapHandler) {
      modal.removeEventListener('keydown', modal._focusTrapHandler);
    }

    // Restore focus
    if (modal._triggerElement && modal._triggerElement.focus) {
      modal._triggerElement.focus();
    }

    // Remove from active modals
    this.activeModals = this.activeModals.filter(id => id !== modalId);
  },

  closeAll() {
    [...this.activeModals].forEach(id => this.close(id));
  },

  getFocusableElements(container) {
    const selector = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';
    return Array.from(container.querySelectorAll(selector)).filter(el => {
      return !el.disabled && el.offsetParent !== null;
    });
  },

  setupFocusTrap(modal) {
    modal._focusTrapHandler = (e) => {
      if (e.key !== 'Tab') return;

      const focusable = this.getFocusableElements(modal);
      if (focusable.length === 0) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];

      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };

    modal.addEventListener('keydown', modal._focusTrapHandler);
  }
};

// ============================================================================
// SKELETON LOADERS
// ============================================================================

POAI.skeleton = {
  show(selector) {
    const elements = document.querySelectorAll(selector);
    elements.forEach(el => {
      el.dataset.originalContent = el.innerHTML;
      el.innerHTML = '<span class="ds-skeleton ds-skeleton-text"></span>';
    });
  },

  hide(selector) {
    const elements = document.querySelectorAll(selector);
    elements.forEach(el => {
      if (el.dataset.originalContent) {
        el.innerHTML = el.dataset.originalContent;
        delete el.dataset.originalContent;
      }
    });
  },

  replace(selector, content) {
    const elements = document.querySelectorAll(selector);
    elements.forEach(el => {
      // Remove any existing skeleton
      const skeleton = el.querySelector('.ds-skeleton');
      if (skeleton) {
        skeleton.remove();
      }

      // Set new content
      if (typeof content === 'string' || typeof content === 'number') {
        el.textContent = content;
      } else if (content instanceof HTMLElement) {
        el.innerHTML = '';
        el.appendChild(content);
      }
    });
  }
};

// ============================================================================
// FORM VALIDATION
// ============================================================================

POAI.form = {
  validate(formElement) {
    const inputs = formElement.querySelectorAll('[required], [data-validate]');
    let isValid = true;
    let firstInvalid = null;

    inputs.forEach(input => {
      const error = this.validateInput(input);
      if (error) {
        this.showError(input, error);
        isValid = false;
        if (!firstInvalid) firstInvalid = input;
      } else {
        this.clearError(input);
      }
    });

    // Focus first invalid input
    if (firstInvalid) {
      firstInvalid.focus();
    }

    return isValid;
  },

  validateInput(input) {
    const value = input.value.trim();
    const rules = (input.dataset.validate || '').split(',').filter(Boolean);

    // Required check
    if (input.required && !value) {
      return input.dataset.errorRequired || 'This field is required';
    }

    // Skip other validations if empty and not required
    if (!value) return null;

    // Custom rules
    for (const rule of rules) {
      switch (rule.trim()) {
        case 'email':
          if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
            return 'Please enter a valid email address';
          }
          break;
        case 'url':
          try {
            new URL(value);
          } catch {
            return 'Please enter a valid URL';
          }
          break;
        case 'number':
          if (isNaN(Number(value))) {
            return 'Please enter a valid number';
          }
          break;
        case 'min':
          const min = Number(input.dataset.min);
          if (Number(value) < min) {
            return `Value must be at least ${min}`;
          }
          break;
        case 'max':
          const max = Number(input.dataset.max);
          if (Number(value) > max) {
            return `Value must be at most ${max}`;
          }
          break;
      }
    }

    return null;
  },

  showError(input, message) {
    // Add error styling
    input.classList.add('ds-input--error');
    input.setAttribute('aria-invalid', 'true');

    // Find or create error element
    let errorEl = input.parentElement.querySelector('.ds-field-error');
    if (!errorEl) {
      errorEl = document.createElement('div');
      errorEl.className = 'ds-field-error';
      errorEl.id = `error-${input.id || input.name || Date.now()}`;
      input.after(errorEl);
    }

    errorEl.textContent = message;
    input.setAttribute('aria-describedby', errorEl.id);

    // Add input listener to clear error on change
    if (!input._errorClearHandler) {
      input._errorClearHandler = () => this.clearError(input);
      input.addEventListener('input', input._errorClearHandler, { once: true });
    }
  },

  clearError(input) {
    input.classList.remove('ds-input--error');
    input.removeAttribute('aria-invalid');
    input.removeAttribute('aria-describedby');

    const errorEl = input.parentElement.querySelector('.ds-field-error');
    if (errorEl) {
      errorEl.remove();
    }
  },

  clearAllErrors(formElement) {
    const inputs = formElement.querySelectorAll('.ds-input--error');
    inputs.forEach(input => this.clearError(input));
  }
};

// ============================================================================
// INITIALIZATION
// ============================================================================

// Auto-initialize on DOM ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    POAI.toast.init();
  });
} else {
  POAI.toast.init();
}
