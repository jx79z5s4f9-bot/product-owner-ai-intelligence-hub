/**
 * Daily Logger - Frontend Controller
 */

(async function() {
  let arts = [];
  let sprints = [];
  let currentPeriod = 'week';

  // Initialize on page load
  document.addEventListener('DOMContentLoaded', async () => {
    // Set date input to today
    document.getElementById('logDate').valueAsDate = new Date();

    // Load data
    await loadARTs();
    await loadSprints();
    await loadStats();
    await loadSummary();
    await loadRecentLogs();
    await loadTemplates();

    // Event listeners
    document.getElementById('submitBtn').addEventListener('click', submitLog);
    
    document.querySelectorAll('.summary-tab-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        document.querySelectorAll('.summary-tab-btn').forEach(b => b.classList.remove('active'));
        e.target.classList.add('active');
        currentPeriod = e.target.dataset.period;
        loadSummary();
      });
    });
  });

  /**
   * Load ARTs from API
   */
  async function loadARTs() {
    try {
      const response = await fetch('/api/arts');
      const data = await response.json();
      arts = data.arts || [];
      
      const select = document.getElementById('logArt');
      select.innerHTML = '<option value="">Select project...</option>';
      arts.forEach(art => {
        const option = document.createElement('option');
        option.value = art.id;
        option.textContent = art.name;
        select.appendChild(option);
      });
    } catch (error) {
      console.error('Failed to load ARTs:', error);
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
      
      const select = document.getElementById('logSprint');
      select.innerHTML = '<option value="">Select sprint...</option>';
      sprints.forEach(sprint => {
        const option = document.createElement('option');
        option.value = sprint.id;
        option.textContent = `Sprint ${sprint.sprint_number}`;
        select.appendChild(option);
      });
    } catch (error) {
      console.error('Failed to load sprints:', error);
    }
  }

  /**
   * Load and display statistics
   */
  async function loadStats() {
    try {
      const response = await fetch('/logger/api/stats');
      const data = await response.json();
      const stats = data.stats || {};

      document.getElementById('statTotalHours').textContent = (stats.total_hours || 0).toFixed(1);
      document.getElementById('statTotalKm').textContent = (stats.total_km || 0).toLocaleString();
      document.getElementById('statAvgHours').textContent = (stats.avg_hours_per_day || 0).toFixed(1);
      document.getElementById('statAvgKm').textContent = (stats.avg_km_per_day || 0).toFixed(0);
      document.getElementById('statDaysLogged').textContent = stats.total_days || 0;
    } catch (error) {
      console.error('Failed to load stats:', error);
    }
  }

  /**
   * Load and display summary
   */
  async function loadSummary() {
    try {
      const response = await fetch(`/logger/api/summary?period=${currentPeriod}`);
      const data = await response.json();
      const summary = data.summary || [];

      const content = document.getElementById('summaryContent');
      
      if (summary.length === 0) {
        content.innerHTML = '<div class="loading">No data yet</div>';
        return;
      }

      let html = '';
      summary.forEach(item => {
        const period = currentPeriod === 'week' ? item.week : item.month;
        html += `
          <div class="summary-item">
            <span class="summary-label">${period}</span>
            <div>
              <div class="summary-value">${item.total_hours ? item.total_hours.toFixed(1) : 0}h</div>
              <div class="summary-value" style="font-size: 0.85rem;">${item.total_km || 0}km</div>
            </div>
          </div>
        `;
      });
      
      content.innerHTML = html;
    } catch (error) {
      console.error('Failed to load summary:', error);
    }
  }

  /**
   * Load and display recent log entries
   */
  async function loadRecentLogs() {
    try {
      const response = await fetch('/logger/api/logs');
      const data = await response.json();
      const logs = data.logs || [];

      const container = document.getElementById('recentLogs');
      
      if (logs.length === 0) {
        container.innerHTML = '<div class="loading">No entries yet</div>';
        return;
      }

      let html = '';
      logs.slice(0, 10).forEach(log => {
        const date = new Date(log.log_date).toLocaleDateString('en-US', {
          month: 'short',
          day: 'numeric'
        });
        
        html += `
          <div class="log-entry">
            <div class="log-entry-date">${date}</div>
            <div class="log-entry-stats">
              ${log.hours ? `<span class="log-entry-stat">⏱️ ${log.hours}h</span>` : ''}
              ${log.km ? `<span class="log-entry-stat">🚗 ${log.km}km</span>` : ''}
              ${log.notes ? `<span class="log-entry-stat">📝 ${log.notes.substring(0, 30)}...</span>` : ''}
            </div>
          </div>
        `;
      });
      
      container.innerHTML = html;
    } catch (error) {
      console.error('Failed to load logs:', error);
    }
  }

  /**
   * Load and display available templates
   */
  async function loadTemplates() {
    try {
      const response = await fetch('/logger/api/templates');
      const data = await response.json();
      const templates = data.templates || [];

      const container = document.getElementById('templatesList');
      
      if (templates.length === 0) {
        container.innerHTML = '<div class="loading">No templates available</div>';
        return;
      }

      let html = '';
      templates.forEach(template => {
        const typeLabel = template.type === 'hours' ? '⏱️ Hours' : template.type === 'declaration' ? '📄 Declaration' : '📋 Other';
        html += `
          <div class="template-item">
            <span style="flex: 1; font-size: 0.85rem;">${template.name.substring(0, 40)}</span>
            <span class="template-type">${typeLabel}</span>
          </div>
        `;
      });
      
      container.innerHTML = html;
    } catch (error) {
      console.error('Failed to load templates:', error);
    }
  }

  /**
   * Submit new log entry
   */
  async function submitLog() {
    try {
      const date = document.getElementById('logDate').value;
      const hours = parseFloat(document.getElementById('logHours').value) || 0;
      const km = parseInt(document.getElementById('logKm').value) || 0;
      const art_id = parseInt(document.getElementById('logArt').value) || null;
      const sprint_id = parseInt(document.getElementById('logSprint').value) || null;
      const notes = document.getElementById('logNotes').value;
      const tasksStr = document.getElementById('logTasks').value;
      const tasks = tasksStr ? tasksStr.split(',').map(t => t.trim()) : [];

      if (!date) {
        alert('Please select a date');
        return;
      }

      if (hours === 0 && km === 0) {
        alert('Please enter at least hours or kilometers');
        return;
      }

      const btn = document.getElementById('submitBtn');
      btn.disabled = true;
      btn.textContent = '💾 Saving...';

      const response = await fetch('/logger/api/log', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          date,
          hours: hours || null,
          km: km || null,
          art_id,
          sprint_id,
          notes,
          tasks
        })
      });

      const data = await response.json();

      if (data.success) {
        // Reset form
        document.getElementById('logHours').value = '';
        document.getElementById('logKm').value = '';
        document.getElementById('logNotes').value = '';
        document.getElementById('logTasks').value = '';
        document.getElementById('logArt').value = '';
        document.getElementById('logSprint').value = '';

        // Reload data
        await loadStats();
        await loadSummary();
        await loadRecentLogs();

        // Show success message
        alert('✅ ' + data.message);
      } else {
        alert('❌ Failed to save entry: ' + (data.error || 'Unknown error'));
      }
    } catch (error) {
      alert('❌ Error: ' + error.message);
    } finally {
      const btn = document.getElementById('submitBtn');
      btn.disabled = false;
      btn.textContent = '💾 Save Entry';
    }
  }

  /**
   * Export logs to Excel
   */
  async function exportToExcel() {
    const startDate = document.getElementById('exportStartDate').value;
    const endDate = document.getElementById('exportEndDate').value;
    const template = document.getElementById('exportTemplate').value;

    if (!startDate || !endDate) {
      alert('Please select both start and end dates');
      return;
    }

    if (new Date(startDate) > new Date(endDate)) {
      alert('Start date must be before end date');
      return;
    }

    const btn = document.getElementById('exportBtn');
    btn.disabled = true;
    btn.textContent = '⏳ Exporting...';

    try {
      const response = await fetch('/logger/api/export', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          startDate,
          endDate,
          templateName: template
        })
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Export failed');
      }

      // Download the file
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `Timesheet_${startDate}_to_${endDate}.xlsx`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);

      alert('✅ Excel file exported successfully!');
    } catch (error) {
      alert('❌ Export failed: ' + error.message);
    } finally {
      btn.disabled = false;
      btn.textContent = '📥 Export Excel';
    }
  }

  // Set default export dates (current month)
  const today = new Date();
  const firstDay = new Date(today.getFullYear(), today.getMonth(), 1);
  const lastDay = new Date(today.getFullYear(), today.getMonth() + 1, 0);
  
  document.getElementById('exportStartDate').valueAsDate = firstDay;
  document.getElementById('exportEndDate').valueAsDate = lastDay;

  // Event listeners
  document.getElementById('exportBtn').addEventListener('click', exportToExcel);
})();
