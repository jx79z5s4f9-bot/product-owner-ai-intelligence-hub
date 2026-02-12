/**
 * Command Center - Main Controller
 * Handles conversation streaming, context management, and UI coordination
 */

(function() {
  const promptInput = document.getElementById('promptInput');
  const submitBtn = document.getElementById('submitBtn');
  const stopBtn = document.getElementById('stopBtn');
  const conversationContent = document.getElementById('conversationContent');
  const contextPills = document.getElementById('contextPills');
  
  let currentEventSource = null;
  let currentResponse = '';
  let conversationId = '';
  let selectedContextFiles = [];

  // Initialize
  function init() {
    attachEventListeners();
    restoreSession();
  }

  function attachEventListeners() {
    // Submit on button click
    submitBtn.addEventListener('click', submitPrompt);

    // Submit on Ctrl+Enter
    promptInput.addEventListener('keydown', (e) => {
      if (e.ctrlKey && e.key === 'Enter') {
        submitPrompt();
      }
    });

    // Auto-expand textarea and detect meeting notes on input
    promptInput.addEventListener('input', () => {
      autoExpandTextarea();
      detectPastedContent();
    });

    // Also handle paste event for immediate feedback
    promptInput.addEventListener('paste', () => {
      setTimeout(() => {
        autoExpandTextarea();
        detectPastedContent();
      }, 10);
    });

    // Stop button
    stopBtn.addEventListener('click', stopResponse);

    // Quick actions
    document.querySelectorAll('.action-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const action = btn.dataset.action;
        handleQuickAction(action);
      });
    });
  }

  // Auto-expand textarea for long content
  function autoExpandTextarea() {
    promptInput.style.height = 'auto';
    const newHeight = Math.min(promptInput.scrollHeight, 400);
    promptInput.style.height = newHeight + 'px';
  }

  // Detect if pasted content looks like meeting notes
  function detectPastedContent() {
    const content = promptInput.value;
    const indicator = document.getElementById('meetingNotesIndicator');

    // Simple detection (more thorough check happens server-side)
    const hasBullets = (content.match(/^[\-\*]\s+/gm) || []).length >= 3;
    const hasHeaders = (content.match(/^##?\s+/gm) || []).length >= 1;
    const hasNames = (content.match(/\b[A-Z][a-z]+\s+[A-Z][a-z]+\b/g) || []).length >= 2;
    const isLong = content.length > 300;

    const looksLikeMeetingNotes = (hasBullets || hasHeaders) && (hasNames || isLong);

    if (looksLikeMeetingNotes) {
      if (!indicator) {
        const newIndicator = document.createElement('div');
        newIndicator.id = 'meetingNotesIndicator';
        newIndicator.className = 'meeting-notes-indicator';
        newIndicator.innerHTML = '📝 <span>Meeting notes detected - entities will be extracted automatically</span>';
        promptInput.parentElement.insertBefore(newIndicator, promptInput);
      }
    } else if (indicator) {
      indicator.remove();
    }
  }

  function submitPrompt() {
    const prompt = promptInput.value.trim();
    if (!prompt) return;

    console.log('🚀 Submitting prompt:', prompt);

    // Get selected ART (RTE)
    const artId = window.ARTSelector ? window.ARTSelector.getSelectedArtId() : null;
    console.log('🎯 ART ID:', artId);

    // Get selected mode
    const mode = window.ModeSelectorV2 ? window.ModeSelectorV2.getMode() : 'query';
    console.log('📋 Mode:', mode);

    // DEBRIEF mode uses dedicated CIA logging endpoint
    if (mode === 'debrief') {
      submitDebrief(prompt, artId);
      return;
    }

    // Disable input
    submitBtn.disabled = true;
    submitBtn.innerHTML = '<span>Thinking...</span><div class="spinner"></div>';
    stopBtn.classList.remove('hidden');

    // Add user message
    addMessage('user', prompt);

    // Add AI thinking indicator
    const thinkingId = addMessage('assistant', '<div class="typing-indicator"><span></span><span></span><span></span></div>');

    // Send to server
    fetch('/api/prompt', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt,
        artId,
        selectedMdFiles: selectedContextFiles,
        conversationId: document.getElementById('conversationId').value || null
      })
    })
    .then(async (response) => {
      if (!response.ok) {
        throw new Error(`Server error: ${response.status}`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      currentResponse = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value);
        const lines = chunk.split('\n\n').filter(l => l.startsWith('data: '));

        for (const line of lines) {
          const dataStr = line.replace('data: ', '');
          try {
            const data = JSON.parse(dataStr);
            handleStreamData(data, thinkingId);
          } catch (err) {
            console.error('Parse error:', err);
          }
        }
      }

      // Re-enable input
      submitBtn.disabled = false;
      submitBtn.innerHTML = '<span>Send</span><span class="icon">💭</span>';
      stopBtn.classList.add('hidden');
      promptInput.value = '';
    })
    .catch((error) => {
      console.error('❌ Request failed:', error);
      updateMessage(thinkingId, `❌ Error: ${error.message}`);
      submitBtn.disabled = false;
      submitBtn.innerHTML = '<span>Send</span><span class="icon">💭</span>';
      stopBtn.classList.add('hidden');
    });
  }

  function handleStreamData(data, thinkingId) {
    switch (data.type) {
      case 'mode-detected':
        if (window.ModeSelectorV2) {
          window.ModeSelectorV2.handleModeDetection(data.mode, data.confidence);
        }
        // Show extraction mode indicator
        if (data.mode === 'extraction') {
          showToast('📝 Meeting notes detected - extracting entities...', 'info');
        }
        break;

      case 'token':
        currentResponse += data.content;
        updateMessage(thinkingId, renderMarkdown(currentResponse));
        break;

      case 'warning':
        showToast(data.message, 'warning');
        break;

      case 'entity_suggestions':
        // Show inline entity approval UI
        showEntitySuggestions(data);
        break;

      case 'complete':
        currentResponse = data.response || currentResponse;
        updateMessage(thinkingId, renderMarkdown(currentResponse));
        break;
    }
  }

  function showEntitySuggestions(data) {
    const { rteId, actors, relationships, risks, worklog } = data;

    if (actors.length === 0 && relationships.length === 0 && risks.length === 0 && !worklog) {
      return;
    }

    const totalCount = actors.length + relationships.length + risks.length;
    const suggestionId = `suggestions-${Date.now()}`;

    const suggestionDiv = document.createElement('div');
    suggestionDiv.className = 'entity-suggestions';
    suggestionDiv.id = suggestionId;
    suggestionDiv.innerHTML = `
      <div class="suggestions-header">
        <span class="icon">🔍</span>
        <span>Found ${totalCount} entities - click to add to your RTE network</span>
        <div class="suggestions-actions">
          <button class="btn-approve-all" onclick="approveAllEntities('${suggestionId}', ${rteId})">
            ✓ Approve All
          </button>
          <button class="btn-dismiss-all" onclick="document.getElementById('${suggestionId}').remove()">
            ✗ Dismiss All
          </button>
        </div>
      </div>
      <div class="suggestions-content">
        ${actors.length > 0 ? `
          <div class="suggestion-group">
            <div class="suggestion-group-header">👤 People, Teams & Systems (${actors.length})</div>
            ${actors.map((actor, i) => `
              <div class="suggestion-item suggestion-actor" data-type="actor" data-entity='${JSON.stringify(actor).replace(/'/g, "\\'")}'>
                <span class="suggestion-type type-${actor.type}">${actor.type}</span>
                <span class="suggestion-name">${actor.name}</span>
                ${actor.role ? `<span class="suggestion-detail">${actor.role}</span>` : ''}
                ${actor.team ? `<span class="suggestion-detail team">[${actor.team}]</span>` : ''}
                <button class="btn-approve" onclick="approveEntity('actor', ${JSON.stringify(actor).replace(/"/g, '&quot;')}, ${rteId})">✓</button>
                <button class="btn-dismiss" onclick="this.parentElement.remove()">✗</button>
              </div>
            `).join('')}
          </div>
        ` : ''}
        ${relationships.length > 0 ? `
          <div class="suggestion-group">
            <div class="suggestion-group-header">🔗 Relationships (${relationships.length})</div>
            ${relationships.map((rel, i) => `
              <div class="suggestion-item suggestion-relationship" data-type="relationship" data-entity='${JSON.stringify(rel).replace(/'/g, "\\'")}'>
                <span class="suggestion-type type-rel">${rel.type.replace(/_/g, ' ')}</span>
                <span class="suggestion-name">${rel.source} → ${rel.target}</span>
                ${rel.description ? `<span class="suggestion-detail">${rel.description}</span>` : ''}
                <button class="btn-approve" onclick="approveEntity('relationship', ${JSON.stringify(rel).replace(/"/g, '&quot;')}, ${rteId})">✓</button>
                <button class="btn-dismiss" onclick="this.parentElement.remove()">✗</button>
              </div>
            `).join('')}
          </div>
        ` : ''}
        ${risks.length > 0 ? `
          <div class="suggestion-group">
            <div class="suggestion-group-header">⚠️ Risks & Blockers (${risks.length})</div>
            ${risks.map((risk, i) => `
              <div class="suggestion-item suggestion-risk" data-type="risk" data-entity='${JSON.stringify(risk).replace(/'/g, "\\'")}'>
                <span class="suggestion-type risk-${risk.severity}">${risk.severity}</span>
                <span class="suggestion-name">${risk.title}</span>
                ${risk.description ? `<span class="suggestion-detail">${risk.description}</span>` : ''}
                <button class="btn-approve" onclick="approveEntity('risk', ${JSON.stringify(risk).replace(/"/g, '&quot;')}, ${rteId})">✓</button>
                <button class="btn-dismiss" onclick="this.parentElement.remove()">✗</button>
              </div>
            `).join('')}
          </div>
        ` : ''}
        ${worklog ? `
          <div class="suggestion-group">
            <div class="suggestion-group-header">📊 Work Log</div>
            <div class="suggestion-item suggestion-worklog" data-type="worklog" data-entity='${JSON.stringify(worklog).replace(/'/g, "\\'")}'>
              <span class="suggestion-type type-worklog">today</span>
              <span class="suggestion-name">
                ${worklog.hours ? `${worklog.hours}h worked` : ''}
                ${worklog.hours && worklog.kilometers ? ' • ' : ''}
                ${worklog.kilometers ? `${worklog.kilometers}km driven` : ''}
                ${worklog.location ? ` • ${worklog.location}` : ''}
              </span>
              <button class="btn-approve" onclick="approveWorklog(${JSON.stringify(worklog).replace(/"/g, '&quot;')}, ${rteId})">✓ Save</button>
              <button class="btn-dismiss" onclick="this.parentElement.remove()">✗</button>
            </div>
          </div>
        ` : ''}
      </div>
    `;

    conversationContent.appendChild(suggestionDiv);
    conversationContent.scrollTop = conversationContent.scrollHeight;
  }

  // Approve all entities at once
  window.approveAllEntities = async function(suggestionId, rteId) {
    const container = document.getElementById(suggestionId);
    if (!container) return;

    if (!rteId) {
      showToast('Select an RTE first to add entities', 'warning');
      return;
    }

    const items = container.querySelectorAll('.suggestion-item');
    let approved = 0;
    let failed = 0;

    showToast(`Approving ${items.length} entities...`, 'info');

    for (const item of items) {
      const type = item.dataset.type;
      try {
        const entity = JSON.parse(item.dataset.entity);
        let endpoint, body;

        if (type === 'actor') {
          endpoint = `/api/rte/${rteId}/actors`;
          body = {
            name: entity.name,
            actor_type: entity.type,
            role: entity.role,
            team: entity.team,
            organization: entity.organization,
            description: entity.description
          };
        } else if (type === 'relationship') {
          endpoint = `/api/rte/${rteId}/relationships/suggest`;
          body = {
            source_name: entity.source,
            target_name: entity.target,
            relationship_type: entity.type,
            description: entity.description,
            auto_create_actors: true
          };
        } else if (type === 'risk') {
          endpoint = `/api/rte/${rteId}/tasks`;
          body = {
            title: entity.title,
            description: entity.description,
            severity: entity.severity,
            task_type: 'risk'
          };
        } else if (type === 'worklog') {
          const today = new Date().toISOString().split('T')[0];
          endpoint = `/api/rte/${rteId}/logs`;
          body = {
            log_date: today,
            hours_worked: entity.hours,
            kilometers: entity.kilometers,
            work_location: entity.location,
            tasks: [],
            meetings: [],
            observations: [],
            new_people: [],
            surprises: []
          };
        }

        const response = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body)
        });

        if (response.ok) {
          approved++;
          item.classList.add('approved');
        } else {
          failed++;
          item.classList.add('failed');
        }
      } catch (err) {
        console.error('Failed to approve:', err);
        failed++;
      }
    }

    showToast(`Approved ${approved} entities${failed > 0 ? `, ${failed} failed` : ''}`, approved > 0 ? 'success' : 'warning');

    // Remove the suggestions container after a delay
    setTimeout(() => {
      container.remove();
    }, 2000);
  };

  // Global function for saving worklog
  window.approveWorklog = async function(worklog, rteId) {
    if (!rteId) {
      showToast('Select an RTE first to save worklog', 'warning');
      return;
    }

    try {
      const today = new Date().toISOString().split('T')[0];
      const response = await fetch(`/api/rte/${rteId}/logs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          log_date: today,
          hours_worked: worklog.hours,
          kilometers: worklog.kilometers,
          work_location: worklog.location,
          tasks: [],
          meetings: [],
          observations: [],
          new_people: [],
          surprises: []
        })
      });

      if (response.ok) {
        showToast(`Saved: ${worklog.hours || 0}h, ${worklog.kilometers || 0}km`, 'success');
        event.target.closest('.suggestion-item').remove();
      } else {
        const err = await response.json();
        showToast(`Failed: ${err.error || 'Unknown error'}`, 'warning');
      }
    } catch (err) {
      console.error('Failed to save worklog:', err);
      showToast('Failed to save worklog', 'warning');
    }
  };

  // Global function for approving entities
  window.approveEntity = async function(type, entity, rteId) {
    if (!rteId) {
      showToast('Select an RTE first to add entities', 'warning');
      return;
    }

    try {
      let endpoint, body;

      if (type === 'actor') {
        endpoint = `/api/rte/${rteId}/actors`;
        body = {
          name: entity.name,
          actor_type: entity.type,
          role: entity.role,
          team: entity.team,
          organization: entity.organization,
          description: entity.description
        };
      } else if (type === 'relationship') {
        // For relationships, we need to find or create actors first
        endpoint = `/api/rte/${rteId}/relationships/suggest`;
        body = {
          source_name: entity.source,
          target_name: entity.target,
          relationship_type: entity.type,
          description: entity.description,
          auto_create_actors: true
        };
      } else if (type === 'risk') {
        endpoint = `/api/rte/${rteId}/tasks`;
        body = {
          title: entity.title,
          description: entity.description,
          severity: entity.severity,
          task_type: 'risk'
        };
      }

      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });

      if (response.ok) {
        showToast(`Added ${type}: ${entity.name || entity.title || entity.source}`, 'success');
        // Remove the suggestion item from UI
        event.target.closest('.suggestion-item').remove();
      } else {
        const err = await response.json();
        showToast(`Failed: ${err.error || 'Unknown error'}`, 'warning');
      }
    } catch (err) {
      console.error('Failed to approve entity:', err);
      showToast('Failed to add entity', 'warning');
    }
  };

  function stopResponse() {
    if (currentEventSource) {
      currentEventSource.close();
      currentEventSource = null;
    }
    stopBtn.classList.add('hidden');
    submitBtn.disabled = false;
    submitBtn.innerHTML = '<span>Send</span><span class="icon">💭</span>';
  }

  function addMessage(role, content) {
    // Remove empty state
    const emptyState = conversationContent.querySelector('.empty-conversation');
    if (emptyState) {
      emptyState.remove();
    }

    const messageId = `msg-${Date.now()}`;
    const messageDiv = document.createElement('div');
    messageDiv.id = messageId;
    messageDiv.className = `message message-${role}`;
    messageDiv.innerHTML = `
      <div class="message-label">${role === 'user' ? 'You' : 'AI Assistant'}</div>
      <div class="message-content">${content}</div>
    `;
    
    conversationContent.appendChild(messageDiv);
    conversationContent.scrollTop = conversationContent.scrollHeight;
    
    return messageId;
  }

  function updateMessage(messageId, content) {
    const message = document.getElementById(messageId);
    if (message) {
      const contentDiv = message.querySelector('.message-content');
      if (contentDiv) {
        contentDiv.innerHTML = content;
      }
      conversationContent.scrollTop = conversationContent.scrollHeight;
    }
  }

  function renderMarkdown(text) {
    // Simple markdown rendering (basic implementation)
    return text
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.*?)\*/g, '<em>$1</em>')
      .replace(/\n/g, '<br>');
  }

  function handleQuickAction(action) {
    const rteId = window.ARTSelector ? window.ARTSelector.getSelectedArtId() : null;

    // Actions that need RTE selection
    if (action === 'view-network') {
      if (!rteId) {
        showToast('Select an RTE first to view network', 'warning');
        return;
      }
      window.location.href = `/rte/dashboard?rteId=${rteId}`;
      return;
    }

    if (action === 'review-suggestions') {
      if (!rteId) {
        showToast('Select an RTE first to review suggestions', 'warning');
        return;
      }
      window.location.href = `/rte/suggestions?rteId=${rteId}`;
      return;
    }

    if (action === 'translate') {
      openTranslateModal();
      return;
    }

    // Prompt-based actions
    const prompts = {
      'health-check': 'Run a health check on the current sprint. Identify blockers, risks, and wins. Who is blocked? What risks do we have?',
      'new-idea': 'Help me triage a new idea into the backlog. I want to brainstorm and capture key actors involved.',
      'wsjf': 'Calculate WSJF score for prioritizing features. Help me estimate Business Value, Time Criticality, Risk Reduction, and Job Size.'
    };

    if (prompts[action]) {
      promptInput.value = prompts[action];
      promptInput.focus();
    }
  }

  // Delegate to global POAI toast system (from ui-utils.js)
  function showToast(message, type = 'info') {
    if (typeof POAI !== 'undefined' && POAI.toast) {
      POAI.toast.show(message, type);
    } else {
      // Fallback if POAI not loaded
      console.log(`[${type}] ${message}`);
    }
  }

  function restoreSession() {
    const saved = sessionStorage.getItem('poai_conversation_id');
    if (saved) {
      document.getElementById('conversationId').value = saved;
      conversationId = saved;
    }
  }

  // Initialize on DOM ready
  document.addEventListener('DOMContentLoaded', init);

  // Typing indicator CSS
  const style = document.createElement('style');
  style.textContent = `
    .typing-indicator {
      display: flex;
      gap: 4px;
      align-items: center;
    }
    .typing-indicator span {
      width: 8px;
      height: 8px;
      background: var(--accent-blue);
      border-radius: 50%;
      animation: typing 1.4s infinite;
    }
    .typing-indicator span:nth-child(2) {
      animation-delay: 0.2s;
    }
    .typing-indicator span:nth-child(3) {
      animation-delay: 0.4s;
    }
    @keyframes typing {
      0%, 60%, 100% {
        opacity: 0.3;
        transform: translateY(0);
      }
      30% {
        opacity: 1;
        transform: translateY(-8px);
      }
    }
  `;
  document.head.appendChild(style);

  // ============================================================
  // TRANSLATION MODULE
  // ============================================================

  let translateDirection = 'auto';
  let translateModelAvailable = false;

  async function openTranslateModal() {
    const modal = document.getElementById('translateModal');
    if (!modal) return;

    modal.classList.remove('hidden');

    // Check model availability
    await checkTranslateModelStatus();

    // Initialize event listeners (only once)
    if (!modal.dataset.initialized) {
      initTranslateModal();
      modal.dataset.initialized = 'true';
    }
  }

  async function checkTranslateModelStatus() {
    const statusEl = document.getElementById('translateStatus');
    statusEl.className = 'translate-status loading';
    statusEl.innerHTML = '<span class="status-indicator">⏳</span><span class="status-text">Checking Gemma 2 model...</span>';

    try {
      const response = await fetch('/api/translate/status');
      const data = await response.json();

      translateModelAvailable = data.available;

      if (data.available) {
        statusEl.className = 'translate-status available';
        statusEl.innerHTML = '<span class="status-indicator">✅</span><span class="status-text">Gemma 2 ready - Dutch ↔ English</span>';
      } else {
        statusEl.className = 'translate-status unavailable';
        statusEl.innerHTML = `<span class="status-indicator">❌</span><span class="status-text">Model unavailable: ${data.error || 'Run "ollama pull gemma2:2b"'}</span>`;
      }
    } catch (error) {
      statusEl.className = 'translate-status unavailable';
      statusEl.innerHTML = '<span class="status-indicator">❌</span><span class="status-text">Translation service unavailable</span>';
      translateModelAvailable = false;
    }
  }

  function initTranslateModal() {
    const modal = document.getElementById('translateModal');
    const inputEl = document.getElementById('translateInput');
    const outputEl = document.getElementById('translateOutput');
    const translateBtn = document.getElementById('translateBtn');
    const translateNotesBtn = document.getElementById('translateNotesBtn');
    const copyBtn = document.getElementById('copyOutputBtn');
    const pasteBtn = document.getElementById('pasteInputBtn');
    const charCountEl = document.getElementById('inputCharCount');
    const detectedLangEl = document.getElementById('detectedLang');

    // Direction buttons
    document.querySelectorAll('.direction-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.direction-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        translateDirection = btn.dataset.direction;
      });
    });

    // Character count
    inputEl.addEventListener('input', () => {
      charCountEl.textContent = `${inputEl.value.length} chars`;
    });

    // Paste button
    pasteBtn.addEventListener('click', async () => {
      try {
        const text = await navigator.clipboard.readText();
        inputEl.value = text;
        charCountEl.textContent = `${text.length} chars`;
      } catch (error) {
        showToast('Could not paste from clipboard', 'warning');
      }
    });

    // Copy button
    copyBtn.addEventListener('click', async () => {
      if (!outputEl.value) return;
      try {
        await navigator.clipboard.writeText(outputEl.value);
        showToast('Copied to clipboard', 'success');
      } catch (error) {
        showToast('Could not copy to clipboard', 'warning');
      }
    });

    // Translate button
    translateBtn.addEventListener('click', () => translateText(false));

    // Translate as notes button
    translateNotesBtn.addEventListener('click', () => translateText(true));

    // Close modal handlers
    modal.querySelectorAll('.modal-close').forEach(btn => {
      btn.addEventListener('click', () => {
        modal.classList.add('hidden');
      });
    });
  }

  async function translateText(asNotes = false) {
    const inputEl = document.getElementById('translateInput');
    const outputEl = document.getElementById('translateOutput');
    const detectedLangEl = document.getElementById('detectedLang');
    const translateBtn = document.getElementById('translateBtn');
    const markedSection = document.getElementById('markedTermsSection');
    const markedList = document.getElementById('markedTermsList');

    const text = inputEl.value.trim();
    if (!text) {
      showToast('Enter text to translate', 'warning');
      return;
    }

    if (!translateModelAvailable) {
      showToast('Translation model not available', 'error');
      return;
    }

    // Show loading state
    translateBtn.disabled = true;
    translateBtn.innerHTML = '⏳ Translating...';
    outputEl.value = 'Translating...';
    markedSection.classList.add('hidden');

    try {
      const endpoint = asNotes ? '/api/translate/notes' : '/api/translate';
      const bodyKey = asNotes ? 'notes' : 'text';

      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          [bodyKey]: text,
          direction: translateDirection
        })
      });

      const data = await response.json();

      if (data.error) {
        outputEl.value = `Error: ${data.error}`;
        showToast('Translation failed', 'error');
      } else {
        outputEl.value = data.translation || data.text || '';

        // Show detected language
        if (data.detected_language) {
          detectedLangEl.textContent = `Detected: ${data.detected_language}`;
        } else {
          detectedLangEl.textContent = '';
        }

        // Show marked terms if any
        if (data.markedTerms && data.markedTerms.length > 0) {
          showMarkedTerms(data.markedTerms, data.termTranslations || [], data.detected_language === 'Dutch' ? 'nl-en' : 'en-nl');
        }

        showToast('Translation complete', 'success');
      }
    } catch (error) {
      console.error('Translation error:', error);
      outputEl.value = `Error: ${error.message}`;
      showToast('Translation failed', 'error');
    } finally {
      translateBtn.disabled = false;
      translateBtn.innerHTML = '🔄 Translate';
    }
  }

  function showMarkedTerms(terms, translations, direction) {
    const markedSection = document.getElementById('markedTermsSection');
    const markedList = document.getElementById('markedTermsList');

    if (!terms || terms.length === 0) {
      markedSection.classList.add('hidden');
      return;
    }

    markedList.innerHTML = terms.map((term, i) => `
      <div class="marked-term-item" data-term="${term}" data-translation="${translations[i] || ''}" data-direction="${direction}">
        <span class="term-source">${term}</span>
        <span class="term-arrow">→</span>
        <span class="term-translation">${translations[i] || '(translating...)'}</span>
        <button class="btn-add-term" onclick="addTermToGlossary(this)">+ Add</button>
      </div>
    `).join('');

    markedSection.classList.remove('hidden');

    // Set up Add All button
    document.getElementById('addAllTermsBtn').onclick = addAllTermsToGlossary;
  }

  window.addTermToGlossary = async function(btn) {
    const item = btn.closest('.marked-term-item');
    const term = item.dataset.term;
    const translation = item.dataset.translation;
    const direction = item.dataset.direction;

    if (!translation) {
      showToast('No translation available', 'warning');
      return;
    }

    try {
      const response = await fetch('/api/translate/glossary', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          terms: [term],
          translations: [translation],
          direction
        })
      });

      const data = await response.json();

      if (data.success) {
        item.classList.add('added');
        btn.textContent = '✓ Added';
        showToast(`Added "${term}" to glossary`, 'success');
      } else {
        showToast('Failed to add term', 'warning');
      }
    } catch (error) {
      showToast('Failed to add term', 'error');
    }
  };

  async function addAllTermsToGlossary() {
    const items = document.querySelectorAll('.marked-term-item:not(.added)');
    const terms = [];
    const translations = [];
    let direction = 'nl-en';

    items.forEach(item => {
      const term = item.dataset.term;
      const translation = item.dataset.translation;
      direction = item.dataset.direction;

      if (term && translation) {
        terms.push(term);
        translations.push(translation);
      }
    });

    if (terms.length === 0) {
      showToast('No terms to add', 'info');
      return;
    }

    try {
      const response = await fetch('/api/translate/glossary', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ terms, translations, direction })
      });

      const data = await response.json();

      if (data.success) {
        items.forEach(item => {
          item.classList.add('added');
          item.querySelector('.btn-add-term').textContent = '✓ Added';
        });
        showToast(`Added ${data.added} terms to glossary`, 'success');
      }
    } catch (error) {
      showToast('Failed to add terms', 'error');
    }
  }

  // View glossary (opens glossary file or shows info)
  document.getElementById('viewGlossaryBtn')?.addEventListener('click', async () => {
    try {
      const response = await fetch('/api/translate/glossary');
      const data = await response.json();

      alert(`Domain Glossary\n\nTotal terms: ${data.count}\n\nEdit the glossary file at:\ndata/domain-glossary.md`);
    } catch (error) {
      showToast('Could not load glossary', 'error');
    }
  });
})();
