// Handle LLM streaming and knowledge visualization (network/phylo)
(function() {
  const submitBtn = document.getElementById('submitBtn');
  const stopBtn = document.getElementById('stopBtn');
  const promptInput = document.getElementById('promptInput');
  const historyItems = document.getElementById('historyItems');
  const publishBtn = document.getElementById('publishBtn');

  let currentEventSource = null;
  let currentPrompt = '';
  let currentResponse = '';
  let currentReasoningJson = null;
  let conversationHistory = [];
  let lastSubmittedPrompt = null;
  let lastSubmittedDocs = null;

  // Error handling functions
  function showError(message, recoverable = true) {
    const errorDiv = document.createElement('div');
    errorDiv.className = 'toast toast-error';
    errorDiv.style.zIndex = '10000';
    errorDiv.innerHTML = `
      <span style="font-weight: bold;">⚠️ Error</span>
      <span style="margin: 0 10px;">${escapeHtml(message)}</span>
      ${recoverable ? '<button onclick="window.retryLastPrompt()" style="padding: 5px 10px; cursor: pointer; border: none; background: white; color: #d32f2f; border-radius: 3px;">Retry</button>' : ''}
    `;
    document.body.appendChild(errorDiv);
    setTimeout(() => {
      errorDiv.classList.add('fade-out');
      setTimeout(() => errorDiv.remove(), 300);
    }, 8000);
  }

  function showWarning(message) {
    const warnDiv = document.createElement('div');
    warnDiv.className = 'toast toast-warning';
    warnDiv.style.zIndex = '10000';
    warnDiv.innerHTML = `
      <span style="font-weight: bold;">⚠️ Warning</span>
      <span style="margin: 0 10px;">${escapeHtml(message)}</span>
    `;
    document.body.appendChild(warnDiv);
    setTimeout(() => {
      warnDiv.classList.add('fade-out');
      setTimeout(() => warnDiv.remove(), 300);
    }, 6000);
  }

  // Expose retry function globally
  window.retryLastPrompt = function() {
    if (lastSubmittedPrompt) {
      promptInput.value = lastSubmittedPrompt;
      submitPrompt();
    } else {
      showError('No previous prompt to retry', false);
    }
  };

  // Phase 6: Session State Persistence
  function saveSessionState() {
    const state = {
      conversationId: document.getElementById('conversationId')?.value || '',
      selectedDocs: Array.from(window.contextPreview?.selectedDocs || []).map(d => ({ id: d.id, filename: d.filename })),
      networkZoom: window.networkGraph?.currentZoom || 1,
      timestamp: new Date().toISOString()
    };
    try {
      sessionStorage.setItem('poai_session_state', JSON.stringify(state));
      console.log('Session state saved:', state.conversationId);
    } catch (e) {
      console.warn('Failed to save session state:', e);
    }
  }

  function restoreSessionState() {
    try {
      const saved = sessionStorage.getItem('poai_session_state');
      if (saved) {
        const state = JSON.parse(saved);
        const convoInput = document.getElementById('conversationId');
        if (convoInput && state.conversationId) {
          convoInput.value = state.conversationId;
          console.log('Restored conversation ID:', state.conversationId);
        }
        // Store for later use when needed
        window.restoredSessionState = state;
      }
    } catch (e) {
      console.warn('Failed to restore session state:', e);
    }
  }

  // Save session state periodically (every 30 seconds) and on page unload
  setInterval(saveSessionState, 30000);
  window.addEventListener('beforeunload', saveSessionState);
  window.addEventListener('unload', saveSessionState);

  // Restore session state on page load
  document.addEventListener('DOMContentLoaded', restoreSessionState);
  
  // Also restore immediately if DOM is already loaded
  if (document.readyState === 'interactive' || document.readyState === 'complete') {
    restoreSessionState();
  }

  // Visualization mode (network or phylo)
  let networkGraph;
  let visualizationMode = localStorage.getItem('visualization_mode') || 'network';

  function initNetworkGraph() {
    if (networkGraph || typeof NetworkGraph === 'undefined') return networkGraph;
    networkGraph = new NetworkGraph('phyloTree', { source: 'po-ai' });
    window.networkGraph = networkGraph;
    return networkGraph;
  }

  function initPhyloTree() {
    if (typeof window.initPhyloTreeV2 !== 'function') return window.phyloTreeV2;
    return window.initPhyloTreeV2({ svgId: 'phyloTree', mode: 'md-usage' });
  }

  function updateVisualizationButtons() {
    const networkBtn = document.getElementById('vizNetworkBtn');
    const phyloBtn = document.getElementById('vizPhyloBtn');
    if (networkBtn) networkBtn.classList.toggle('active', visualizationMode === 'network');
    if (phyloBtn) phyloBtn.classList.toggle('active', visualizationMode === 'phylo');
  }

  function setVisualizationMode(mode) {
    if (!['network', 'phylo'].includes(mode)) return;
    visualizationMode = mode;
    localStorage.setItem('visualization_mode', mode);
    updateVisualizationButtons();

    if (mode === 'network') {
      window.destroyPhyloTreeV2?.();
      initNetworkGraph();
      networkGraph?.clear();
    } else {
      networkGraph?.clear();
      initPhyloTree();
      window.phyloTreeV2?.showEmptyMessage();
    }
  }

  function toggleVisualizationFullscreen() {
    const container = document.querySelector('.reasoning-tree');
    if (!container) return;

    container.classList.toggle('fullscreen');
    document.body.classList.toggle('tree-fullscreen');

    if (visualizationMode === 'phylo' && window.phyloTreeV2) {
      window.phyloTreeV2.resizeToContainer();
      window.phyloTreeV2.fitToScreen();
      return;
    }

    if (visualizationMode === 'network' && networkGraph) {
      networkGraph.fitToScreen();
    }
  }

  // Handle Knowledge Base file selection from query parameter
  const urlParams = new URLSearchParams(window.location.search);
  const kbSelectedId = urlParams.get('kb-selected');
  let selectedMdFilesFromKb = [];

  if (kbSelectedId) {
    // Store the selected file ID for use in prompts
    selectedMdFilesFromKb = [kbSelectedId];

    // Show a toast notification
    const toast = document.createElement('div');
    toast.className = 'toast toast-success';
    toast.innerHTML = `
      <strong>✓ Knowledge Base File Selected</strong>
      <p>File will be included in your next prompt</p>
    `;
    document.body.appendChild(toast);

    setTimeout(() => {
      toast.classList.add('fade-out');
      setTimeout(() => toast.remove(), 300);
    }, 3000);

    // Clean up URL
    window.history.replaceState({}, '', window.location.pathname);
  }

  // Listen for node click events from tree
  document.addEventListener('treeNodeClick', (e) => {
    showNodeDetails(e.detail);
  });

  // Submit prompt
  submitBtn.addEventListener('click', submitPrompt);
  
  // Stop button handler
  if (stopBtn) {
    stopBtn.addEventListener('click', () => {
      if (currentEventSource) {
        currentEventSource.close();
        currentEventSource = null;
        stopBtn.classList.add('hidden');
        submitBtn.disabled = false;
        
        // Add system message to conversation
        const systemMsg = document.createElement('div');
        systemMsg.className = 'history-item system-message';
        systemMsg.innerHTML = '<em>⏹️ Response stopped by user</em>';
        historyItems.appendChild(systemMsg);
        historyItems.scrollTop = historyItems.scrollHeight;
      }
    });
  }
  
  promptInput.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.key === 'Enter') {
      submitPrompt();
    }
  });

  function submitPrompt() {
    const prompt = promptInput.value.trim();
    if (!prompt) return;

    // Store current prompt for retry
    lastSubmittedPrompt = prompt;
    currentPrompt = prompt;

    // Get selected .md files from KB session storage OR context preview
    let selectedMdFiles = [];
    
    // First check KB selections (from Knowledge Base page)
    try {
      const kbSelected = sessionStorage.getItem('kb_selected_files');
      if (kbSelected) {
        selectedMdFiles = JSON.parse(kbSelected);
        console.log('📚 Using KB selected files:', selectedMdFiles);
      }
    } catch (err) {
      console.warn('Failed to load KB selections:', err);
    }
    
    // Then check context preview selections (takes priority)
    if (window.contextPreview && window.contextPreview.selectedDocs && window.contextPreview.selectedDocs.length > 0) {
      selectedMdFiles = window.contextPreview.selectedDocs.map(doc => doc.id);
      console.log('📋 Using context preview selections:', selectedMdFiles);
    }

    // Get selected ART
    const artId = window.ARTSelector ? window.ARTSelector.getSelectedArtId() : null;
    console.log('🎯 ART ID:', artId);

    // Store for retry
    lastSubmittedDocs = selectedMdFiles;

    console.log('Submitting with selectedMdFiles:', selectedMdFiles);

    // Disable submit button, show stop button
    submitBtn.disabled = true;
    submitBtn.innerHTML = '<span class="spinner"></span> Thinking...';
    if (stopBtn) stopBtn.classList.remove('hidden');
    publishBtn.disabled = true;

    // Clear previous response but keep history
    currentResponse = '';
    
    // Add thinking indicator to history
    addToHistory(prompt, '<span class="spinner"></span> AI is thinking...');

    // Close previous connection if any
    if (currentEventSource) {
      currentEventSource.close();
    }

    // Send prompt to server
    fetch('/api/prompt', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt,
        selectedMdFiles,
        artId,
        conversationId: document.getElementById('conversationId')?.value || null
      })
    })
    .then(async (response) => {
      if (!response.ok) {
        throw new Error(`Server error ${response.status}: ${response.statusText}`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();

      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          // Response complete - load network if in network mode
          if (window.loadNetworkAfterResponse && window.contextPreview && window.contextPreview.selectedDocs && window.contextPreview.selectedDocs.length > 0) {
            window.loadNetworkAfterResponse(currentPrompt, window.contextPreview.selectedDocs);
          }
          break;
        }

        const chunk = decoder.decode(value);
        const lines = chunk.split('\n\n').filter(l => l.startsWith('data: '));

        for (const line of lines) {
          const dataStr = line.replace('data: ', '');
          try {
            const data = JSON.parse(dataStr);
            handleStreamData(data);
          } catch (err) {
            console.error('Failed to parse stream data:', err);
            showError('Failed to parse server response', true);
          }
        }
      }

      // Re-enable submit button after response completes
      submitBtn.disabled = false;
      submitBtn.innerHTML = 'Submit 💭';      if (stopBtn) stopBtn.classList.add('hidden');    })
    .catch((error) => {
      console.error('Stream error:', error);
      showError(`Request failed: ${error.message}`, true);
      updateLastHistoryAnswer(`❌ Error: ${error.message}`);
      submitBtn.disabled = false;
      submitBtn.innerHTML = 'Submit 💭';
      if (stopBtn) stopBtn.classList.add('hidden');
    });
  }

  function addToHistory(question, answer) {
    // Remove empty state if present
    const emptyState = historyItems.querySelector('.empty-state');
    if (emptyState) {
      emptyState.remove();
    }

    const historyItem = document.createElement('div');
    historyItem.className = 'history-item';
    historyItem.innerHTML = `
      <div class=\"history-question\">Q: ${escapeHtml(question)}</div>
      <div class=\"history-answer\">${answer}</div>
    `;
    
    historyItems.appendChild(historyItem);
    
    // Auto-scroll to bottom
    historyItems.parentElement.scrollTop = historyItems.parentElement.scrollHeight;
    
    // Store in memory
    conversationHistory.push({ question, answer });
  }

  function updateLastHistoryAnswer(answer) {
    const lastItem = historyItems.lastElementChild;
    if (lastItem && lastItem.classList.contains('history-item')) {
      const answerDiv = lastItem.querySelector('.history-answer');
      if (answerDiv) {
        answerDiv.innerHTML = renderMarkdown(answer);
      }
    }
    
    // Update in memory
    if (conversationHistory.length > 0) {
      conversationHistory[conversationHistory.length - 1].answer = answer;
    }
  }

  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  function handleStreamData(data) {
    switch (data.type) {
      case 'mode-detected':
        // Show mode detection result
        if (window.ModeSelector) {
          window.ModeSelector.handleModeDetection(data.mode, data.confidence);
        }
        break;

      case 'token':
        // Append token to response
        currentResponse += data.content;
        updateLastHistoryAnswer(currentResponse);
        break;

      case 'thinking':
        if (visualizationMode === 'phylo' && window.phyloTreeV2 && data.md_file) {
          window.phyloTreeV2.addMdUsageNode(data);
        }
        break;

      case 'file_created':
        // Show notification that file was created
        showFileCreatedNotification(data);
        break;

      case 'warning':
        showWarningNotification(data);
        break;

      case 'complete':
        // Final response
        currentResponse = data.response;
        currentReasoningJson = data.reasoning_json;
        updateLastHistoryAnswer(currentResponse);

        // Persist conversation ID for follow-ups
        if (data.conversation_id) {
          const convoInput = document.getElementById('conversationId');
          if (convoInput) convoInput.value = data.conversation_id;
        }

        // Enable buttons
        submitBtn.disabled = false;
        submitBtn.innerHTML = 'Submit 💭';
        publishBtn.disabled = false;

        // Clear input
        promptInput.value = '';

        // Save to database (TODO)
        saveConversation(currentPrompt, currentResponse, currentReasoningJson);
        break;

      case 'error':
        updateLastHistoryAnswer(`<p style="color: #ef4444;">❌ ${data.message}</p>`);
        submitBtn.disabled = false;
        submitBtn.innerHTML = 'Submit 💭';
        break;
    }
  }

  function renderMarkdown(text) {
    // Simple markdown rendering (replace with marked.js in production)
    return text
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.*?)\*/g, '<em>$1</em>')
      .replace(/`(.*?)`/g, '<code>$1</code>')
      .replace(/\n\n/g, '</p><p>')
      .replace(/\n/g, '<br>');
  }

  async function saveConversation(prompt, response, reasoning_json) {
    // Save to local database via API
    console.log('Saving conversation to database...');

    try {
      const res = await fetch('/api/conversations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt,
          response,
          reasoning_json
        })
      });
      if (!res.ok) {
        const errorText = await res.text();
        throw new Error(`Save failed (${res.status}): ${errorText}`);
      }

      const data = await res.json();
      if (data.success) {
        // Store conversation ID for publish button
        window.currentConversationId = data.conversationId || data.id || null;
      }
    } catch (err) {
      console.error('Failed to save conversation:', err);
    }
  }

  function showWarningNotification(data) {
    const toast = document.createElement('div');
    toast.className = 'toast toast-warning';
    toast.innerHTML = `
      <strong>⚠️ Notice</strong>
      <p>${data.message || 'An advisory warning was raised.'}</p>
    `;

    document.body.appendChild(toast);

    setTimeout(() => {
      toast.classList.add('fade-out');
      setTimeout(() => toast.remove(), 300);
    }, 5000);
  }

  function showFileCreatedNotification(data) {
    // Show toast notification
    const toast = document.createElement('div');
    toast.className = 'toast toast-success';
    toast.innerHTML = `
      <strong>✓ File Created</strong>
      <p>${data.filename}</p>
      <p class="text-muted">Saved to ${data.stage} stage</p>
    `;

    document.body.appendChild(toast);

    // Auto-remove after 5 seconds
    setTimeout(() => {
      toast.classList.add('fade-out');
      setTimeout(() => toast.remove(), 300);
    }, 5000);
  }

  function showNodeDetails(nodeData) {
    // Show modal with full node details
    const modal = document.createElement('div');
    modal.className = 'node-details-modal';
    modal.innerHTML = `
      <div class="modal-overlay"></div>
      <div class="modal-content">
        <div class="modal-header">
          <h3>${nodeData.name}</h3>
          <span class="category-badge ${nodeData.category}">${nodeData.category}</span>
          <button class="modal-close" aria-label="Close modal">✕</button>
        </div>
        <div class="modal-body">
          ${nodeData.rule ? `
            <div class="detail-section">
              <h4>Business Rule</h4>
              <p class="rule-text">${nodeData.rule}</p>
            </div>
          ` : ''}
          ${nodeData.excerpt ? `
            <div class="detail-section">
              <h4>Relevant Excerpt</h4>
              <p class="excerpt-text">${nodeData.excerpt}</p>
            </div>
          ` : ''}
        </div>
        <div class="modal-footer">
          <button class="btn btn-secondary">Close</button>
        </div>
      </div>
    `;

    const closeModal = () => {
      modal.remove();
    };

    // Close button click
    modal.querySelector('.modal-close').addEventListener('click', closeModal);
    modal.querySelector('.btn-secondary').addEventListener('click', closeModal);
    
    // Overlay click
    modal.querySelector('.modal-overlay').addEventListener('click', closeModal);
    
    // Escape key
    const escapeHandler = (e) => {
      if (e.key === 'Escape') {
        closeModal();
        document.removeEventListener('keydown', escapeHandler);
      }
    };
    document.addEventListener('keydown', escapeHandler);

    document.body.appendChild(modal);
  }

  // Initialize visualization on page load
  document.addEventListener('DOMContentLoaded', () => {
    setVisualizationMode(visualizationMode);

    const networkBtn = document.getElementById('vizNetworkBtn');
    const phyloBtn = document.getElementById('vizPhyloBtn');
    networkBtn?.addEventListener('click', () => setVisualizationMode('network'));
    phyloBtn?.addEventListener('click', () => setVisualizationMode('phylo'));

    const zoomInBtn = document.getElementById('treeZoomInBtn');
    zoomInBtn?.addEventListener('click', () => {
      if (visualizationMode === 'phylo') return window.phyloTreeV2?.zoomIn();
      return networkGraph?.zoomIn();
    });

    const zoomOutBtn = document.getElementById('treeZoomOutBtn');
    zoomOutBtn?.addEventListener('click', () => {
      if (visualizationMode === 'phylo') return window.phyloTreeV2?.zoomOut();
      return networkGraph?.zoomOut();
    });

    const fitBtn = document.getElementById('treeFitBtn');
    fitBtn?.addEventListener('click', () => {
      if (visualizationMode === 'phylo') return window.phyloTreeV2?.fitToScreen();
      return networkGraph?.fitToScreen();
    });

    const fullscreenBtn = document.getElementById('treeFullscreenBtn');
    fullscreenBtn?.addEventListener('click', () => toggleVisualizationFullscreen());

    const downloadBtn = document.getElementById('treeDownloadBtn');
    downloadBtn?.addEventListener('click', () => {
      if (visualizationMode === 'phylo') return window.phyloTreeV2?.downloadSvg();
      return networkGraph?.downloadSvg();
    });
  });

  // Expose function to load network after response completes
  window.loadNetworkAfterResponse = function(prompt, selectedDocs) {
    if (visualizationMode !== 'network') return;
    if (networkGraph && selectedDocs && selectedDocs.length > 0) {
      try {
        console.log('🕸️ Loading network graph with', selectedDocs.length, 'documents for query:', prompt.substring(0, 50));
        console.log('Selected docs:', selectedDocs.map(d => ({ id: d.id, filename: d.filename })));
        networkGraph.loadFromQuery(prompt, selectedDocs);
      } catch (err) {
        console.error('Failed to load network graph:', err);
      }
    } else {
      console.warn('Cannot load network: networkGraph=', !!networkGraph, 'selectedDocs=', selectedDocs?.length);
    }
  };
})();
