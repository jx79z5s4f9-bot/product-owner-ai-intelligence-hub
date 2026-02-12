/**
 * Dashboard Functionality
 * Handles workspace status, health checks, and command tiles
 */

(function() {
  // Check workspace status on load (only if elements exist)
  const hasWorkspaceStatus = document.getElementById('workspace-status');
  const hasPipelineStatus = document.getElementById('pipeline-status');

  if (hasWorkspaceStatus) {
    checkWorkspaceStatus();
  }

  if (hasPipelineStatus) {
    loadPipelineStats();
  }

  // Tile click handlers
  document.getElementById('health-check-tile')?.addEventListener('click', runHealthCheck);
  document.getElementById('new-idea-tile')?.addEventListener('click', openNewIdeaModal);
  document.getElementById('pipeline-tile')?.addEventListener('click', showPipelineDetails);
  document.getElementById('wsjf-tile')?.addEventListener('click', openWsjfCalculator);
  document.getElementById('workspace-tile')?.addEventListener('click', openWorkspaceFolder);

  /**
   * Check if workspace exists and show status
   */
  async function checkWorkspaceStatus() {
    const statusEl = document.getElementById('workspace-status');
    if (!statusEl) return;

    try {
      const response = await fetch('/api/workspace/status');
      const data = await response.json();
      
      if (data.exists) {
        statusEl.textContent = '✓ Ready';
        statusEl.style.color = 'var(--success)';
      } else {
        statusEl.textContent = '⚠ Not initialized';
        statusEl.style.color = '#eab308';
      }
    } catch (error) {
      console.error('Workspace status check failed:', error);
      const statusEl = document.getElementById('workspace-status');
      if (statusEl) statusEl.textContent = '✗ Error';
    }
  }

  /**
   * Load pipeline statistics
   */
  async function loadPipelineStats() {
    const statusEl = document.getElementById('pipeline-status');
    if (!statusEl) return;

    try {
      const response = await fetch('/api/workspace/pipeline-stats');
      const data = await response.json();
      const badgeEl = document.getElementById('pipeline-badge');

      const total = data.rough + data.developing + data.polished;
      statusEl.textContent = `${total} ideas`;

      if (badgeEl && data.stalled > 0) {
        badgeEl.textContent = data.stalled;
        badgeEl.classList.add('show', 'yellow');
      }
    } catch (error) {
      console.error('Pipeline stats failed:', error);
      statusEl.textContent = 'Error';
    }
  }

  /**
   * Run health check
   */
  async function runHealthCheck() {
    const tile = document.getElementById('health-check-tile');
    const statusEl = document.getElementById('health-status');
    const badgeEl = document.getElementById('health-badge');

    tile.classList.add('active');
    statusEl.textContent = 'Scanning...';

    try {
      const response = await fetch('/api/commands/health-check', { method: 'POST' });
      const data = await response.json();

      // Show results in modal
      showHealthCheckResults(data);

      // Update tile
      if (data.urgent.length > 0) {
        statusEl.textContent = `${data.urgent.length} urgent`;
        statusEl.style.color = 'var(--danger)';
        badgeEl.textContent = data.urgent.length;
        badgeEl.classList.add('show');
      } else if (data.attention.length > 0) {
        statusEl.textContent = `${data.attention.length} attention`;
        statusEl.style.color = '#eab308';
        badgeEl.textContent = data.attention.length;
        badgeEl.classList.add('show', 'yellow');
      } else {
        statusEl.textContent = '✓ All good';
        statusEl.style.color = 'var(--success)';
        badgeEl.classList.remove('show');
      }
    } catch (error) {
      console.error('Health check failed:', error);
      statusEl.textContent = 'Error';
      alert('Health check failed. See console for details.');
    } finally {
      tile.classList.remove('active');
    }
  }

  /**
   * Show health check results in modal
   */
  function showHealthCheckResults(data) {
    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.innerHTML = `
      <div class="modal modal-lg">
        <div class="modal-header">
          <h2 class="modal-title">🏥 Health Check Results</h2>
          <button class="modal-close" onclick="this.closest('.modal-overlay').remove()">&times;</button>
        </div>
        <div class="modal-body">
          ${data.urgent.length > 0 ? `
            <div class="health-section urgent">
              <h3>🚨 Urgent Actions Required (${data.urgent.length})</h3>
              <ul>
                ${data.urgent.map(item => `
                  <li>
                    <strong>${item.file}</strong> (${item.stage}, ${Math.floor(item.days_idle)} days idle)
                    <br><span class="text-muted">${item.action}</span>
                  </li>
                `).join('')}
              </ul>
            </div>
          ` : ''}

          ${data.attention.length > 0 ? `
            <div class="health-section attention">
              <h3>🟡 Attention Needed (${data.attention.length})</h3>
              <ul>
                ${data.attention.map(item => `
                  <li>
                    <strong>${item.file}</strong> (${item.stage})
                    <br><span class="text-muted">${item.issue}</span>
                  </li>
                `).join('')}
              </ul>
            </div>
          ` : ''}

          ${data.wins.length > 0 ? `
            <div class="health-section wins">
              <h3>✅ Recent Wins (${data.wins.length})</h3>
              <ul>
                ${data.wins.map(item => `
                  <li>${item.file}: ${item.from_stage} → ${item.to_stage}</li>
                `).join('')}
              </ul>
            </div>
          ` : ''}

          <div class="health-section metrics">
            <h3>📊 Pipeline Metrics</h3>
            <div class="metrics-grid">
              <div class="metric">
                <div class="metric-value">${data.metrics.rough_count}</div>
                <div class="metric-label">Rough</div>
              </div>
              <div class="metric">
                <div class="metric-value">${data.metrics.developing_count}</div>
                <div class="metric-label">Developing</div>
              </div>
              <div class="metric">
                <div class="metric-value">${data.metrics.polished_count}</div>
                <div class="metric-label">Polished</div>
              </div>
            </div>
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-secondary" onclick="this.closest('.modal-overlay').remove()">Close</button>
        </div>
      </div>
    `;

    document.body.appendChild(modal);
  }

  /**
   * Open new idea modal
   */
  function openNewIdeaModal() {
    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.innerHTML = `
      <div class="modal">
        <div class="modal-header">
          <h2 class="modal-title">💡 New Idea - Auto Triage</h2>
          <button class="modal-close" onclick="this.closest('.modal-overlay').remove()">&times;</button>
        </div>
        <div class="modal-body">
          <div class="form-group">
            <label class="form-label">Describe your idea:</label>
            <textarea id="new-idea-input" class="form-textarea" rows="6" placeholder="Example: Integrate EMCS excise system with export tracking to reduce manual data entry and improve compliance reporting..."></textarea>
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-secondary" onclick="this.closest('.modal-overlay').remove()">Cancel</button>
          <button class="btn btn-primary" onclick="submitNewIdea()">Auto-Triage 🚀</button>
        </div>
      </div>
    `;

    document.body.appendChild(modal);
    document.getElementById('new-idea-input').focus();
  }

  /**
   * Submit new idea for auto-triage
   */
  window.submitNewIdea = async function() {
    const input = document.getElementById('new-idea-input');
    const idea = input.value.trim();

    if (!idea) {
      alert('Please describe your idea');
      return;
    }

    // Close modal
    document.querySelector('.modal-overlay')?.remove();

    // Show in main prompt area
    document.getElementById('promptInput').value = `Auto-triage: ${idea}`;

    // Trigger submission
    document.getElementById('submitBtn').click();
  };

  /**
   * Show pipeline details
   */
  function showPipelineDetails() {
    // For now, just open a simple alert
    // In Sprint 4, this will show the full pipeline dashboard
    alert('Pipeline Dashboard\n\nFull visualization coming in Sprint 4!\n\nFor now, use Health Check to see file counts.');
  }

  /**
   * Open WSJF calculator
   */
  function openWsjfCalculator() {
    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.innerHTML = `
      <div class="modal">
        <div class="modal-header">
          <h2 class="modal-title">🎯 WSJF Calculator</h2>
          <button class="modal-close" onclick="this.closest('.modal-overlay').remove()">&times;</button>
        </div>
        <div class="modal-body">
          <p class="text-muted mb-2">WSJF = (Business Value + Time Criticality + Risk Reduction) ÷ Job Size</p>

          <div class="form-group">
            <label class="form-label">Business Value (1-10)</label>
            <input type="range" id="wsjf-bv" class="form-range" min="1" max="10" value="5">
            <span id="wsjf-bv-value">5</span>
          </div>

          <div class="form-group">
            <label class="form-label">Time Criticality (1-10)</label>
            <input type="range" id="wsjf-tc" class="form-range" min="1" max="10" value="5">
            <span id="wsjf-tc-value">5</span>
          </div>

          <div class="form-group">
            <label class="form-label">Risk Reduction (1-10)</label>
            <input type="range" id="wsjf-rr" class="form-range" min="1" max="10" value="5">
            <span id="wsjf-rr-value">5</span>
          </div>

          <div class="form-group">
            <label class="form-label">Job Size / Effort (1-10)</label>
            <input type="range" id="wsjf-size" class="form-range" min="1" max="10" value="5">
            <span id="wsjf-size-value">5</span>
          </div>

          <div class="wsjf-result">
            <h3>WSJF Score: <span id="wsjf-score">3.0</span></h3>
            <p id="wsjf-priority" class="text-muted">Priority: Medium</p>
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-secondary" onclick="this.closest('.modal-overlay').remove()">Close</button>
          <button class="btn btn-primary" onclick="saveWsjfScore()">Save Score</button>
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    // Add real-time calculation
    ['wsjf-bv', 'wsjf-tc', 'wsjf-rr', 'wsjf-size'].forEach(id => {
      const input = document.getElementById(id);
      const valueSpan = document.getElementById(id + '-value');

      input.addEventListener('input', () => {
        valueSpan.textContent = input.value;
        calculateWsjf();
      });
    });
  }

  /**
   * Calculate WSJF score
   */
  function calculateWsjf() {
    const bv = parseInt(document.getElementById('wsjf-bv').value);
    const tc = parseInt(document.getElementById('wsjf-tc').value);
    const rr = parseInt(document.getElementById('wsjf-rr').value);
    const size = parseInt(document.getElementById('wsjf-size').value);

    const score = (bv + tc + rr) / size;
    const scoreEl = document.getElementById('wsjf-score');
    const priorityEl = document.getElementById('wsjf-priority');

    scoreEl.textContent = score.toFixed(2);

    if (score >= 2.0) {
      priorityEl.textContent = 'Priority: HIGH';
      priorityEl.style.color = 'var(--success)';
    } else if (score >= 1.0) {
      priorityEl.textContent = 'Priority: MEDIUM';
      priorityEl.style.color = '#eab308';
    } else {
      priorityEl.textContent = 'Priority: LOW';
      priorityEl.style.color = 'var(--text-muted)';
    }
  }

  /**
   * Save WSJF score
   */
  window.saveWsjfScore = async function() {
    const bv = parseInt(document.getElementById('wsjf-bv').value);
    const tc = parseInt(document.getElementById('wsjf-tc').value);
    const rr = parseInt(document.getElementById('wsjf-rr').value);
    const size = parseInt(document.getElementById('wsjf-size').value);

    try {
      const response = await fetch('/api/commands/calculate-wsjf', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          businessValue: bv,
          timeCriticality: tc,
          riskReduction: rr,
          jobSize: size
          // fileId: null for now - in full implementation, would select a file first
        })
      });

      const data = await response.json();

      if (data.success) {
        // Show result
        alert(`✓ WSJF Calculated!\n\nScore: ${data.wsjfScore}\nPriority: ${data.priority}\n\nRecommendation: ${data.recommendation}\n\nUsed: ${data.mdFilesUsed[0].name}`);

        // Close modal
        document.querySelector('.modal-overlay')?.remove();

        // Could trigger a prompt with WSJF context here
        console.log('WSJF calculation:', data);
      } else {
        alert('Failed to calculate WSJF');
      }
    } catch (error) {
      console.error('WSJF save error:', error);
      alert('Error saving WSJF score');
    }
  };

  /**
   * Open workspace folder in Finder/Explorer
   */
  function openWorkspaceFolder() {
    // This would need a backend endpoint to trigger 'open ~/ProductOwnerAI'
    alert('Workspace Location:\n~/ProductOwnerAI\n\nOpen in Finder manually, or we can add a backend route to open it automatically.');
  }
})();
