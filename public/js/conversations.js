// Conversation History UI - Modern ART-based organization
(async function() {
  let conversations = [];
  let arts = [];
  let sprints = [];
  let filters = { art: null, sprint: null };
  let libraryData = { books: [], uncategorized: [] };
  let currentBookId = null;
  let currentConversationId = null;

  document.addEventListener('DOMContentLoaded', async () => {
    await loadConversations();
    await loadARTs();
    await loadSprints();
    renderFilters();
    renderConversations();
    updateStats();
    
    // Search functionality
    const searchInput = document.getElementById('searchConversations');
    if (searchInput) {
      searchInput.addEventListener('input', (e) => {
        filterConversations(e.target.value);
      });
    }
  });

  /**
   * Load conversations from API
   */
  async function loadConversations() {
    try {
      const response = await fetch('/api/conversations');
      const data = await response.json();
      conversations = data.conversations || [];
    } catch (error) {
      console.error('Failed to load conversations:', error);
      conversations = [];
    }
  }

  /**
   * Load ARTs from API
   */
  async function loadARTs() {
    try {
      const response = await fetch('/api/arts');
      const data = await response.json();
      arts = data.arts || [];
    } catch (error) {
      console.error('Failed to load ARTs:', error);
      arts = [];
    }
  }

  /**
   * Load Sprints from API
   */
  async function loadSprints() {
    try {
      const response = await fetch('/api/sprints');
      const data = await response.json();
      sprints = data.sprints || [];
    } catch (error) {
      console.error('Failed to load sprints:', error);
      sprints = [];
    }
  }

  /**
   * Render filter chips
   */
  function renderFilters() {
    const artFilters = document.getElementById('artFilters');
    const sprintFilters = document.getElementById('sprintFilters');

    if (artFilters && arts.length > 0) {
      artFilters.innerHTML = arts.map(art => `
        <div class="filter-chip" data-art-id="${art.id}" onclick="window.conversationHistory.filterByART(${art.id})">
          ${escapeHtml(art.name)}
        </div>
      `).join('');
    }

    if (sprintFilters && sprints.length > 0) {
      sprintFilters.innerHTML = sprints.map(sprint => `
        <div class="filter-chip" data-sprint-id="${sprint.id}" onclick="window.conversationHistory.filterBySprint(${sprint.id})">
          Sprint ${sprint.number}
        </div>
      `).join('');
    }
  }

  /**
   * Render conversations grid
   */
  function renderConversations() {
    const grid = document.getElementById('conversationsList');
    const emptyState = document.getElementById('emptyState');

    if (!conversations || conversations.length === 0) {
      grid.innerHTML = '';
      emptyState.classList.remove('hidden');
      return;
    }

    emptyState.classList.add('hidden');

    const html = conversations.map(conv => {
      const date = new Date(conv.created_at).toLocaleDateString('en-US', {
        month: 'short', day: 'numeric', year: 'numeric'
      });

      return `
        <div class="conversation-card" onclick="window.conversationHistory.openConversation('${conv.id}')">
          <div class="conversation-header">
            <h3 class="conversation-title">${escapeHtml(conv.title || 'Untitled Conversation')}</h3>
            <span class="conversation-date">${date}</span>
          </div>
          <p class="conversation-preview">${escapeHtml((conv.first_message || '').substring(0, 150))}...</p>
          <div class="conversation-meta">
            ${conv.art_name ? `<span class="meta-tag">🎯 ${escapeHtml(conv.art_name)}</span>` : ''}
            ${conv.sprint_number ? `<span class="meta-tag">🗓️ Sprint ${conv.sprint_number}</span>` : ''}
            ${conv.message_count ? `<span class="meta-tag">💬 ${conv.message_count} messages</span>` : ''}
          </div>
        </div>
      `;
    }).join('');

    grid.innerHTML = html;
  }

  /**
   * Update statistics
   */
  function updateStats() {
    const statsConversations = document.getElementById('statsConversations');
    const statsARTs = document.getElementById('statsARTs');
    const statsSprints = document.getElementById('statsSprints');

    if (statsConversations) statsConversations.textContent = conversations.length;
    if (statsARTs) statsARTs.textContent = arts.length;
    if (statsSprints) statsSprints.textContent = sprints.length;
  }

  /**
   * Filter conversations by search term
   */
  function filterConversations(searchTerm) {
    const filtered = conversations.filter(conv => {
      const title = (conv.title || '').toLowerCase();
      const message = (conv.first_message || '').toLowerCase();
      const term = searchTerm.toLowerCase();
      return title.includes(term) || message.includes(term);
    });

    renderFilteredConversations(filtered);
  }

  /**
   * Filter by ART
   */
  function filterByART(artId) {
    filters.art = filters.art === artId ? null : artId;
    
    // Update chip styling
    document.querySelectorAll('[data-art-id]').forEach(chip => {
      chip.classList.toggle('active', parseInt(chip.dataset.artId) === filters.art);
    });

    applyFilters();
  }

  /**
   * Filter by Sprint
   */
  function filterBySprint(sprintId) {
    filters.sprint = filters.sprint === sprintId ? null : sprintId;

    // Update chip styling
    document.querySelectorAll('[data-sprint-id]').forEach(chip => {
      chip.classList.toggle('active', parseInt(chip.dataset.sprintId) === filters.sprint);
    });

    applyFilters();
  }

  /**
   * Apply active filters
   */
  function applyFilters() {
    let filtered = [...conversations];

    if (filters.art) {
      filtered = filtered.filter(conv => conv.art_id === filters.art);
    }

    if (filters.sprint) {
      filtered = filtered.filter(conv => conv.sprint_id === filters.sprint);
    }

    renderFilteredConversations(filtered);
  }

  /**
   * Render filtered conversations
   */
  function renderFilteredConversations(filtered) {
    const grid = document.getElementById('conversationsList');
    const emptyState = document.getElementById('emptyState');

    if (filtered.length === 0) {
      grid.innerHTML = '';
      emptyState.classList.remove('hidden');
      emptyState.querySelector('h3').textContent = 'No Matching Conversations';
      emptyState.querySelector('p').textContent = 'Try adjusting your filters or search term.';
      return;
    }

    emptyState.classList.add('hidden');

    const html = filtered.map(conv => {
      const date = new Date(conv.created_at).toLocaleDateString('en-US', {
        month: 'short', day: 'numeric', year: 'numeric'
      });

      return `
        <div class="conversation-card" onclick="window.conversationHistory.openConversation('${conv.id}')">
          <div class="conversation-header">
            <h3 class="conversation-title">${escapeHtml(conv.title || 'Untitled Conversation')}</h3>
            <span class="conversation-date">${date}</span>
          </div>
          <p class="conversation-preview">${escapeHtml((conv.first_message || '').substring(0, 150))}...</p>
          <div class="conversation-meta">
            ${conv.art_name ? `<span class="meta-tag">🎯 ${escapeHtml(conv.art_name)}</span>` : ''}
            ${conv.sprint_number ? `<span class="meta-tag">🗓️ Sprint ${conv.sprint_number}</span>` : ''}
            ${conv.message_count ? `<span class="meta-tag">💬 ${conv.message_count} messages</span>` : ''}
          </div>
        </div>
      `;
    }).join('');

    grid.innerHTML = html;
  }

  /**
   * Open conversation detail
   */
  function openConversation(conversationId) {
    // Navigate to main workspace with conversation loaded
    window.location.href = `/?conversation=${conversationId}`;
  }

  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  // Expose public API
  window.conversationHistory = {
    filterByART,
    filterBySprint,
    openConversation
  };

  /**
   * Load full library from API
   */
  async function loadLibrary() {
    try {
      const response = await fetch('/api/conversations/library');
      const data = await response.json();

      if (data.success) {
        libraryData = data.library;
        renderBooksNav();
        updateLibraryStats();
      } else {
        console.error('Failed to load library:', data.error);
      }
    } catch (error) {
      console.error('Library load error:', error);
      const booksNav = document.getElementById('booksNav');
      if (booksNav) booksNav.innerHTML = '<div class="error">Failed to load library</div>';
    }
  }

  /**
   * Render books navigation sidebar
   */
  function renderBooksNav() {
    const nav = document.getElementById('booksNav');
    if (!nav) return;

    if (!libraryData.books || libraryData.books.length === 0) {
      nav.innerHTML = '<div class="text-muted">No books yet. Create your first book!</div>';
      return;
    }

    const html = libraryData.books.map(book => {
      const conversationCount =
        book.conversations.length +
        book.chapters.reduce((sum, ch) => sum + ch.conversations.length, 0);

      return `
        <div class="book-item" data-book-id="${book.id}" onclick="showBook(${book.id})">
          <div class="book-title">${escapeHtml(book.title)}</div>
          <div class="book-meta">${book.chapters.length} chapters • ${conversationCount} stories</div>
        </div>
      `;
    }).join('');

    // Add uncategorized section
    const uncategorizedHtml = libraryData.uncategorized.length > 0 ? `
      <div class="uncategorized-item" onclick="showUncategorized()">
        📦 Uncategorized (${libraryData.uncategorized.length})
      </div>
    ` : '';

    nav.innerHTML = html + uncategorizedHtml;
  }

  /**
   * Update library statistics (for book/chapter view)
   */
  function updateLibraryStats() {
    const totalBooks = libraryData.books ? libraryData.books.length : 0;
    const totalChapters = libraryData.books ? libraryData.books.reduce((sum, b) => sum + b.chapters.length, 0) : 0;
    const totalConversations = libraryData.books ?
      libraryData.books.reduce((sum, b) =>
        sum + b.conversations.length +
        b.chapters.reduce((chSum, ch) => chSum + ch.conversations.length, 0)
      , 0) + (libraryData.uncategorized ? libraryData.uncategorized.length : 0) : 0;

    const statsBooks = document.getElementById('statsBooks');
    const statsChapters = document.getElementById('statsChapters');
    const statsConvs = document.getElementById('statsConversations');

    if (statsBooks) statsBooks.textContent = totalBooks;
    if (statsChapters) statsChapters.textContent = totalChapters;
    if (statsConvs) statsConvs.textContent = totalConversations;
  }

  /**
   * Show book details
   */
  window.showBook = function(bookId) {
    currentBookId = bookId;
    const book = libraryData.books.find(b => b.id === bookId);

    if (!book) return;

    // Highlight active book
    document.querySelectorAll('.book-item').forEach(item => {
      item.classList.toggle('active', parseInt(item.dataset.bookId) === bookId);
    });

    const contentView = document.getElementById('contentView');
    contentView.innerHTML = `
      <div class="book-view">
        <div class="book-header">
          <h2>${escapeHtml(book.title)}</h2>
          ${book.description ? `<p class="book-description">${escapeHtml(book.description)}</p>` : ''}
          <div class="book-actions">
            <button class="btn btn-primary" onclick="openNewChapterModal(${book.id})">+ New Chapter</button>
            <button class="btn btn-secondary" onclick="showAssignModal(${book.id})">Assign Conversation</button>
          </div>
        </div>

        ${book.chapters.length > 0 ? `
          <div class="chapters-list">
            <h3>Chapters</h3>
            ${book.chapters.map(chapter => `
              <div class="chapter-card">
                <div class="chapter-header">
                  <div class="chapter-title">${escapeHtml(chapter.title)}</div>
                  <div class="chapter-badge">${chapter.conversations.length} stories</div>
                </div>

                ${chapter.conversations.length > 0 ? `
                  <div class="conversations-grid">
                    ${chapter.conversations.map(conv => renderConversationCard(conv)).join('')}
                  </div>
                ` : '<p class="text-muted">No conversations in this chapter yet.</p>'}
              </div>
            `).join('')}
          </div>
        ` : ''}

        ${book.conversations.length > 0 ? `
          <div class="chapters-list">
            <h3>Conversations (Not in Chapters)</h3>
            <div class="conversations-grid">
              ${book.conversations.map(conv => renderConversationCard(conv)).join('')}
            </div>
          </div>
        ` : ''}

        ${book.chapters.length === 0 && book.conversations.length === 0 ? `
          <div class="welcome-message">
            <p>No content yet. Add chapters or assign conversations to this book.</p>
          </div>
        ` : ''}
      </div>
    `;
  };

  /**
   * Show uncategorized conversations
   */
  window.showUncategorized = function() {
    currentBookId = null;

    document.querySelectorAll('.book-item').forEach(item => item.classList.remove('active'));

    const contentView = document.getElementById('contentView');
    contentView.innerHTML = `
      <div class="book-view">
        <div class="book-header">
          <h2>📦 Uncategorized Conversations</h2>
          <p class="book-description">Conversations not yet assigned to any book or chapter.</p>
        </div>

        ${libraryData.uncategorized.length > 0 ? `
          <div class="conversations-grid">
            ${libraryData.uncategorized.map(conv => renderConversationCard(conv)).join('')}
          </div>
        ` : '<p class="text-muted">All conversations are organized!</p>'}
      </div>
    `;
  };

  /**
   * Render a conversation card
   */
  function renderConversationCard(conv) {
    const date = new Date(conv.updated_at).toLocaleDateString();
    return `
      <div class="conversation-card" onclick="showConversation('${conv.conversation_id}')">
        <div class="conversation-title">${escapeHtml(conv.title || conv.first_message.substring(0, 60))}</div>
        <div class="conversation-preview">${escapeHtml(conv.first_message)}</div>
        <div class="conversation-meta">
          <span class="conversation-date">${date}</span>
          <span class="conversation-messages">${conv.message_count} messages</span>
        </div>
      </div>
    `;
  }

  /**
   * Show conversation detail
   */
  window.showConversation = async function(conversationId) {
    currentConversationId = conversationId;

    try {
      const response = await fetch(`/api/conversations/${conversationId}`);
      const data = await response.json();

      if (!data.success) {
        throw new Error(data.error);
      }

      const conv = data.conversation;
      const contentView = document.getElementById('contentView');

      contentView.innerHTML = `
        <div class="conversation-detail">
          <div class="detail-header">
            <div class="detail-breadcrumb">
              ${conv.book_title ? `<a href="#" onclick="showBook(${conv.book_id})">${escapeHtml(conv.book_title)}</a>` : ''}
              ${conv.chapter_title ? ` / ${escapeHtml(conv.chapter_title)}` : ''}
            </div>
            <h2 class="detail-title">${escapeHtml(conv.title || conv.first_message.substring(0, 100))}</h2>
            <div class="detail-actions">
              <button class="btn btn-secondary" onclick="closeConversation()">← Back</button>
              <button class="btn btn-danger" onclick="deleteConversation('${conv.conversation_id}')">Delete</button>
            </div>
          </div>

          <div class="message-thread">
            ${conv.messages.map(msg => `
              <div class="message-item ${msg.role}">
                <div class="message-header">
                  <span class="message-role">${msg.role}</span>
                  <span class="message-timestamp">${new Date(msg.timestamp).toLocaleString()}</span>
                </div>
                <div class="message-content">${escapeHtml(msg.message)}</div>
                ${msg.metadata && Object.keys(msg.metadata).length > 0 ? `
                  <div class="message-metadata">
                    ${msg.metadata.request_type ? `Type: ${msg.metadata.request_type}` : ''}
                    ${msg.metadata.templates_used ? ` • Templates: ${msg.metadata.templates_used.length}` : ''}
                  </div>
                ` : ''}
              </div>
            `).join('')}
          </div>
        </div>
      `;
    } catch (error) {
      console.error('Failed to load conversation:', error);
      alert('Failed to load conversation details');
    }
  };

  /**
   * Close conversation detail
   */
  window.closeConversation = function() {
    if (currentBookId) {
      showBook(currentBookId);
    } else {
      showUncategorized();
    }
  };

  /**
   * Delete conversation
   */
  window.deleteConversation = async function(conversationId) {
    const confirmed = await POAI.confirm.danger('Delete Conversation', 'Are you sure you want to delete this conversation? This cannot be undone.');
    if (!confirmed) return;

    try {
      const response = await fetch(`/api/conversations/${conversationId}`, {
        method: 'DELETE'
      });

      const data = await response.json();

      if (data.success) {
        alert('Conversation deleted successfully');
        await loadLibrary();
        closeConversation();
      } else {
        throw new Error(data.error);
      }
    } catch (error) {
      console.error('Delete failed:', error);
      alert('Failed to delete conversation');
    }
  };

  /**
   * Open new book modal
   */
  function openNewBookModal() {
    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.innerHTML = `
      <div class="modal">
        <div class="modal-header">
          <h2 class="modal-title">📖 Create New Book</h2>
          <button class="modal-close" onclick="this.closest('.modal-overlay').remove()">&times;</button>
        </div>
        <div class="modal-body">
          <div class="form-group">
            <label class="form-label">Book Title *</label>
            <input type="text" id="bookTitle" class="form-input" placeholder="e.g., Q1 2026 Feature Planning" />
          </div>
          <div class="form-group">
            <label class="form-label">Description</label>
            <textarea id="bookDescription" class="form-textarea" rows="3" placeholder="What is this book about?"></textarea>
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-secondary" onclick="this.closest('.modal-overlay').remove()">Cancel</button>
          <button class="btn btn-primary" onclick="createBook()">Create Book</button>
        </div>
      </div>
    `;

    document.body.appendChild(modal);
    document.getElementById('bookTitle').focus();
  }

  /**
   * Create new book
   */
  window.createBook = async function() {
    const title = document.getElementById('bookTitle').value.trim();
    const description = document.getElementById('bookDescription').value.trim();

    if (!title) {
      alert('Please enter a book title');
      return;
    }

    try {
      const response = await fetch('/api/conversations/books', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, description })
      });

      const data = await response.json();

      if (data.success) {
        document.querySelector('.modal-overlay')?.remove();
        await loadLibrary();
        showBook(data.bookId);
      } else {
        throw new Error(data.error);
      }
    } catch (error) {
      console.error('Create book failed:', error);
      alert('Failed to create book');
    }
  };

  /**
   * Open new chapter modal
   */
  window.openNewChapterModal = function(bookId) {
    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.innerHTML = `
      <div class="modal">
        <div class="modal-header">
          <h2 class="modal-title">📑 Create New Chapter</h2>
          <button class="modal-close" onclick="this.closest('.modal-overlay').remove()">&times;</button>
        </div>
        <div class="modal-body">
          <div class="form-group">
            <label class="form-label">Chapter Title *</label>
            <input type="text" id="chapterTitle" class="form-input" placeholder="e.g., Export System Improvements" />
          </div>
          <input type="hidden" id="chapterBookId" value="${bookId}" />
        </div>
        <div class="modal-footer">
          <button class="btn btn-secondary" onclick="this.closest('.modal-overlay').remove()">Cancel</button>
          <button class="btn btn-primary" onclick="createChapter()">Create Chapter</button>
        </div>
      </div>
    `;

    document.body.appendChild(modal);
    document.getElementById('chapterTitle').focus();
  };

  /**
   * Create new chapter
   */
  window.createChapter = async function() {
    const title = document.getElementById('chapterTitle').value.trim();
    const bookId = parseInt(document.getElementById('chapterBookId').value);

    if (!title) {
      alert('Please enter a chapter title');
      return;
    }

    try {
      const response = await fetch('/api/conversations/chapters', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bookId, title })
      });

      const data = await response.json();

      if (data.success) {
        document.querySelector('.modal-overlay')?.remove();
        await loadLibrary();
        showBook(bookId);
      } else {
        throw new Error(data.error);
      }
    } catch (error) {
      console.error('Create chapter failed:', error);
      alert('Failed to create chapter');
    }
  };

  /**
   * Show assign conversation modal
   */
  window.showAssignModal = function(bookId) {
    // For now, just show an alert
    // Full implementation would show a modal with conversation selector
    alert('Assign Conversation feature: Select a conversation to add to this book.\n\nThis will be fully implemented in the UI polish phase.');
  };
})();
