// ========================================
// Dial 112 AI Query Assistant - App Logic
// ========================================

const API_BASE = '';
const conversationId = 'conv_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
let activeCharts = [];

// ========================================
// Initialization
// ========================================
document.addEventListener('DOMContentLoaded', () => {
    loadStats();
    document.getElementById('chat-input').focus();
});

// ========================================
// Stats
// ========================================
async function loadStats() {
    try {
        const res = await fetch(`${API_BASE}/api/stats`);
        const data = await res.json();
        animateValue('stat-total', 0, data.totalCalls, 1200);
        animateValue('stat-critical', 0, data.criticalCalls, 1000);
        animateValue('stat-resolved', 0, data.resolvedCalls, 1100);
        animateValue('stat-response', 0, data.avgResponseTime, 900);
    } catch (e) {
        console.error('Failed to load stats:', e);
    }
}

function animateValue(elementId, start, end, duration) {
    const el = document.getElementById(elementId);
    if (!el || end === null || end === undefined) return;

    const isFloat = !Number.isInteger(end);
    const startTime = performance.now();

    function update(currentTime) {
        const elapsed = currentTime - startTime;
        const progress = Math.min(elapsed / duration, 1);
        const eased = 1 - Math.pow(1 - progress, 3); // ease out cubic
        const current = start + (end - start) * eased;

        el.textContent = isFloat ? current.toFixed(1) : Math.round(current).toLocaleString();

        if (progress < 1) {
            requestAnimationFrame(update);
        }
    }
    requestAnimationFrame(update);
}

// ========================================
// Chat Interface
// ========================================
function handleKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
    }
}

function autoResize(textarea) {
    textarea.style.height = 'auto';
    textarea.style.height = Math.min(textarea.scrollHeight, 120) + 'px';
}

function useSuggestion(btn) {
    const input = document.getElementById('chat-input');
    input.value = btn.textContent.trim();
    input.focus();
    autoResize(input);
    sendMessage();
}

function toggleSidebar() {
    const sidebar = document.getElementById('sidebar');
    const overlay = document.querySelector('.sidebar-overlay');
    sidebar.classList.toggle('open');

    if (sidebar.classList.contains('open')) {
        if (!overlay) {
            const ov = document.createElement('div');
            ov.className = 'sidebar-overlay show';
            ov.onclick = toggleSidebar;
            document.body.appendChild(ov);
        } else {
            overlay.classList.add('show');
        }
    } else {
        if (overlay) overlay.classList.remove('show');
    }
}

function clearChat() {
    const messagesDiv = document.getElementById('chat-messages');
    // Destroy all active charts
    activeCharts.forEach(c => c.destroy());
    activeCharts = [];

    messagesDiv.innerHTML = `
    <div class="message assistant-message fade-in">
      <div class="message-avatar">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M12 2L2 7V17L12 22L22 17V7L12 2Z"/>
          <path d="M12 8V16M8 10V14M16 10V14" stroke-linecap="round"/>
        </svg>
      </div>
      <div class="message-content">
        <div class="message-text">
          <p>🔄 Chat cleared! How can I help you with the emergency call data?</p>
        </div>
      </div>
    </div>
  `;
}

async function sendMessage() {
    const input = document.getElementById('chat-input');
    const message = input.value.trim();
    if (!message) return;

    // Clear input
    input.value = '';
    input.style.height = 'auto';

    // Add user message
    addMessage(message, 'user');

    // Show typing indicator
    const typingId = showTyping();

    try {
        const res = await fetch(`${API_BASE}/api/chat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message, conversationId })
        });

        const data = await res.json();

        // Remove typing indicator
        removeTyping(typingId);

        // Add assistant response
        addAssistantMessage(data);

    } catch (err) {
        removeTyping(typingId);
        addMessage('Sorry, I encountered an error connecting to the server. Please make sure the server is running.', 'assistant');
    }
}

// ========================================
// Message Rendering
// ========================================
function addMessage(text, type) {
    const messagesDiv = document.getElementById('chat-messages');
    const messageHtml = `
    <div class="message ${type}-message">
      <div class="message-avatar">
        ${type === 'user' ? `
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/>
            <circle cx="12" cy="7" r="4"/>
          </svg>
        ` : `
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M12 2L2 7V17L12 22L22 17V7L12 2Z"/>
            <path d="M12 8V16M8 10V14M16 10V14" stroke-linecap="round"/>
          </svg>
        `}
      </div>
      <div class="message-content">
        <div class="message-text">
          <p>${escapeHtml(text)}</p>
        </div>
      </div>
    </div>
  `;
    messagesDiv.insertAdjacentHTML('beforeend', messageHtml);
    scrollToBottom();
}

function addAssistantMessage(data) {
    const messagesDiv = document.getElementById('chat-messages');
    const messageId = 'msg_' + Date.now();

    let contentHtml = `<p>${formatExplanation(data.explanation)}</p>`;

    // SQL block
    if (data.sql) {
        contentHtml += `
      <div class="sql-block">
        <div class="sql-header">
          <span>SQL Query</span>
          <button class="sql-copy-btn" onclick="copySQL(this, '${escapeAttr(data.sql)}')">Copy</button>
        </div>
        <div class="sql-code">${highlightSQL(data.sql)}</div>
      </div>
    `;
    }

    // Error
    if (data.error) {
        contentHtml += `<div class="error-block">${escapeHtml(data.error)}</div>`;
    }

    // Visualization
    if (data.data && data.data.length > 0 && data.visualization !== 'none') {
        contentHtml += renderVisualization(data, messageId);
    }

    // Row count
    if (data.data && data.data.length > 0) {
        contentHtml += `<div class="row-count">${data.data.length} row${data.data.length !== 1 ? 's' : ''} returned</div>`;
    }

    const messageHtml = `
    <div class="message assistant-message">
      <div class="message-avatar">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M12 2L2 7V17L12 22L22 17V7L12 2Z"/>
          <path d="M12 8V16M8 10V14M16 10V14" stroke-linecap="round"/>
        </svg>
      </div>
      <div class="message-content">
        <div class="message-text">${contentHtml}</div>
      </div>
    </div>
  `;

    messagesDiv.insertAdjacentHTML('beforeend', messageHtml);
    scrollToBottom();

    // Render chart or map if needed
    if (data.data && data.data.length > 0) {
        if (['bar_chart', 'pie_chart', 'line_chart'].includes(data.visualization)) {
            setTimeout(() => renderChart(data, messageId), 100);
        } else if (data.visualization === 'map') {
            setTimeout(() => renderMap(data, messageId), 100);
        }
    }
}

// ========================================
// Visualization Rendering
// ========================================
function renderVisualization(data, messageId) {
    switch (data.visualization) {
        case 'stat_card':
            return renderStatCard(data);
        case 'table':
            return renderTable(data.data);
        case 'bar_chart':
        case 'pie_chart':
        case 'line_chart':
            return renderChartContainer(data, messageId);
        case 'map':
            return renderMapContainer(data, messageId);
        default:
            return data.data ? renderTable(data.data) : '';
    }
}

function renderStatCard(data) {
    if (!data.data || data.data.length === 0) return '';
    const row = data.data[0];
    const value = Object.values(row)[0];
    const label = data.chart_config?.title || Object.keys(row)[0].replace(/_/g, ' ');

    return `
    <div class="visualization-container">
      <div class="stat-result">
        <div class="stat-big-value">${typeof value === 'number' ? value.toLocaleString() : value}</div>
        <div class="stat-big-label">${escapeHtml(label)}</div>
      </div>
    </div>
  `;
}

function renderTable(data) {
    if (!data || data.length === 0) return '';
    const columns = Object.keys(data[0]);

    let html = `
    <div class="visualization-container">
      <div class="table-wrapper">
        <table class="data-table">
          <thead>
            <tr>
              ${columns.map(col => `<th>${escapeHtml(formatColumnName(col))}</th>`).join('')}
            </tr>
          </thead>
          <tbody>
  `;

    for (const row of data) {
        html += '<tr>';
        for (const col of columns) {
            const value = row[col];
            const formatted = formatCellValue(col, value);
            html += `<td>${formatted}</td>`;
        }
        html += '</tr>';
    }

    html += `
          </tbody>
        </table>
      </div>
    </div>
  `;

    return html;
}

function renderChartContainer(data, messageId) {
    const title = data.chart_config?.title || 'Chart';
    return `
    <div class="visualization-container">
      <div class="chart-container">
        <div class="chart-title">${escapeHtml(title)}</div>
        <canvas id="chart-${messageId}"></canvas>
      </div>
    </div>
  `;
}

function renderChart(data, messageId) {
    const canvas = document.getElementById(`chart-${messageId}`);
    if (!canvas) return;

    const config = data.chart_config || {};
    const rows = data.data;

    // Determine label and value columns
    const columns = Object.keys(rows[0]);
    const labelCol = config.label_column || columns[0];
    const valueCol = config.value_column || columns[columns.length > 1 ? 1 : 0];

    const labels = rows.map(r => r[labelCol]);
    const values = rows.map(r => parseFloat(r[valueCol]) || 0);

    // Color palette
    const colors = [
        '#3b82f6', '#8b5cf6', '#06b6d4', '#10b981', '#f59e0b',
        '#ef4444', '#ec4899', '#14b8a6', '#f97316', '#6366f1',
        '#84cc16', '#e11d48', '#0ea5e9', '#a855f7', '#22d3ee'
    ];

    const bgColors = colors.map(c => c + '20');
    const borderColors = colors;

    let chartConfig;

    if (data.visualization === 'pie_chart') {
        chartConfig = {
            type: 'doughnut',
            data: {
                labels: labels,
                datasets: [{
                    data: values,
                    backgroundColor: colors.slice(0, values.length),
                    borderColor: 'rgba(10, 14, 26, 0.8)',
                    borderWidth: 2,
                    hoverOffset: 8
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        position: 'right',
                        labels: {
                            color: '#94a3b8',
                            font: { family: 'Inter', size: 12 },
                            padding: 12,
                            usePointStyle: true,
                            pointStyleWidth: 10
                        }
                    },
                    tooltip: {
                        backgroundColor: '#1e293b',
                        titleColor: '#f1f5f9',
                        bodyColor: '#94a3b8',
                        borderColor: 'rgba(148, 163, 184, 0.12)',
                        borderWidth: 1,
                        cornerRadius: 8,
                        padding: 12,
                        titleFont: { family: 'Inter', weight: '600' },
                        bodyFont: { family: 'Inter' }
                    }
                }
            }
        };
    } else if (data.visualization === 'line_chart') {
        chartConfig = {
            type: 'line',
            data: {
                labels: labels,
                datasets: [{
                    label: config.y_label || valueCol,
                    data: values,
                    borderColor: '#3b82f6',
                    backgroundColor: 'rgba(59, 130, 246, 0.1)',
                    fill: true,
                    tension: 0.4,
                    pointBackgroundColor: '#3b82f6',
                    pointBorderColor: '#0a0e1a',
                    pointBorderWidth: 2,
                    pointRadius: 4,
                    pointHoverRadius: 7
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        labels: {
                            color: '#94a3b8',
                            font: { family: 'Inter', size: 12 }
                        }
                    },
                    tooltip: {
                        backgroundColor: '#1e293b',
                        titleColor: '#f1f5f9',
                        bodyColor: '#94a3b8',
                        borderColor: 'rgba(148, 163, 184, 0.12)',
                        borderWidth: 1,
                        cornerRadius: 8,
                        padding: 12
                    }
                },
                scales: {
                    x: {
                        grid: { color: 'rgba(148, 163, 184, 0.06)' },
                        ticks: { color: '#64748b', font: { family: 'Inter', size: 11 } }
                    },
                    y: {
                        grid: { color: 'rgba(148, 163, 184, 0.06)' },
                        ticks: { color: '#64748b', font: { family: 'Inter', size: 11 } },
                        title: {
                            display: !!config.y_label,
                            text: config.y_label || '',
                            color: '#94a3b8',
                            font: { family: 'Inter', size: 12 }
                        }
                    }
                }
            }
        };
    } else {
        // Bar chart
        chartConfig = {
            type: 'bar',
            data: {
                labels: labels,
                datasets: [{
                    label: config.y_label || valueCol,
                    data: values,
                    backgroundColor: colors.slice(0, values.length).map(c => c + '40'),
                    borderColor: colors.slice(0, values.length),
                    borderWidth: 1.5,
                    borderRadius: 6,
                    hoverBackgroundColor: colors.slice(0, values.length).map(c => c + '70')
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        backgroundColor: '#1e293b',
                        titleColor: '#f1f5f9',
                        bodyColor: '#94a3b8',
                        borderColor: 'rgba(148, 163, 184, 0.12)',
                        borderWidth: 1,
                        cornerRadius: 8,
                        padding: 12,
                        titleFont: { family: 'Inter', weight: '600' },
                        bodyFont: { family: 'Inter' }
                    }
                },
                scales: {
                    x: {
                        grid: { display: false },
                        ticks: {
                            color: '#64748b',
                            font: { family: 'Inter', size: 11 },
                            maxRotation: 45
                        }
                    },
                    y: {
                        grid: { color: 'rgba(148, 163, 184, 0.06)' },
                        ticks: { color: '#64748b', font: { family: 'Inter', size: 11 } },
                        title: {
                            display: !!config.y_label,
                            text: config.y_label || '',
                            color: '#94a3b8',
                            font: { family: 'Inter', size: 12 }
                        }
                    }
                }
            }
        };
    }

    const chart = new Chart(canvas, chartConfig);
    activeCharts.push(chart);
}

function renderMapContainer(data, messageId) {
    const title = data.chart_config?.title || 'Map View';
    return `
    <div class="visualization-container">
      <div class="map-title">${escapeHtml(title)}</div>
      <div id="map-${messageId}" class="map-container"></div>
    </div>
  `;
}

function renderMap(data, messageId) {
    const mapId = `map-${messageId}`;
    const mapEl = document.getElementById(mapId);
    if (!mapEl) return;

    // Use UP center as default approx
    let defaultCenter = [26.8467, 80.9462]; // Lucknow roughly
    let defaultZoom = 6;

    const map = L.map(mapId).setView(defaultCenter, defaultZoom);

    // Dark theme map tiles (CartoDB Dark Matter)
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
        subdomains: 'abcd',
        maxZoom: 20
    }).addTo(map);

    const rows = data.data;
    const markers = [];

    // Find lat/lng columns if they match standard
    const hasLat = rows.length > 0 && 'latitude' in rows[0];
    const hasLng = rows.length > 0 && 'longitude' in rows[0];

    if (!hasLat || !hasLng) {
        mapEl.innerHTML = '<div style="padding: 20px; text-align: center; color: var(--text-muted);">Error: Latitude or Longitude columns missing from SQL results.</div>';
        return;
    }

    rows.forEach(row => {
        if (!row.latitude || !row.longitude) return;

        let isCluster = row.total_incidents !== undefined && parseInt(row.total_incidents) > 1;
        let count = parseInt(row.total_incidents) || 1;

        // Determine marker color based on severity if available
        let color = '#3b82f6'; // default blue
        if (row.severity) {
            const sev = String(row.severity).toLowerCase();
            if (sev === 'critical') color = '#ef4444';
            else if (sev === 'high') color = '#f59e0b';
            else if (sev === 'low') color = '#10b981';
        } else if (isCluster) {
            color = '#8b5cf6'; // purple for unknown severity clusters
        }

        // Create circle marker
        let radius = isCluster ? Math.min(35, 8 + Math.sqrt(count) * 3) : 7;
        const marker = L.circleMarker([row.latitude, row.longitude], {
            radius: radius,
            fillColor: color,
            color: '#1a2236',
            weight: 2,
            fillOpacity: isCluster ? 0.75 : 0.9
        });

        // Add popup
        let popupHtml = '<strong>' + (isCluster ? 'Incident Hotspot' : 'Incident Details') + '</strong>';
        popupHtml += '<div class="popup-meta">';
        if (isCluster) popupHtml += `<span style="color:var(--accent-primary); font-weight:bold;">Total Incidents: ${count}</span>`;

        if (row.incident_types) popupHtml += `<span>Types: ${escapeHtml(row.incident_types)}</span>`;
        else if (row.incident_type) popupHtml += `<span>Type: ${escapeHtml(row.incident_type)}</span>`;

        if (row.severities) popupHtml += `<span>Severities: ${escapeHtml(row.severities)}</span>`;
        else if (row.severity) popupHtml += `<span>Severity: ${formatCellValue('severity', row.severity)}</span>`;

        if (row.cluster_location) popupHtml += `<span style="display:block;margin-top:4px;">Loc Context: ${escapeHtml(row.cluster_location)}</span>`;
        else if (row.location) popupHtml += `<span style="display:block;margin-top:4px;">Loc: ${escapeHtml(row.location)}</span>`;

        if (row.status) popupHtml += `<span>Status: ${escapeHtml(row.status)}</span>`;
        popupHtml += '</div>';

        marker.bindPopup(popupHtml);
        marker.addTo(map);
        markers.push([row.latitude, row.longitude]);
    });

    // Auto-fit bounds if we have markers
    if (markers.length > 0) {
        map.fitBounds(markers, { padding: [30, 30], maxZoom: 12 });
    }
}

// ========================================
// Typing Indicator
// ========================================
function showTyping() {
    const messagesDiv = document.getElementById('chat-messages');
    const id = 'typing_' + Date.now();

    const html = `
    <div class="message assistant-message" id="${id}">
      <div class="message-avatar">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M12 2L2 7V17L12 22L22 17V7L12 2Z"/>
          <path d="M12 8V16M8 10V14M16 10V14" stroke-linecap="round"/>
        </svg>
      </div>
      <div class="message-content">
        <div class="message-text">
          <div class="typing-indicator">
            <div class="typing-dot"></div>
            <div class="typing-dot"></div>
            <div class="typing-dot"></div>
          </div>
        </div>
      </div>
    </div>
  `;

    messagesDiv.insertAdjacentHTML('beforeend', html);
    scrollToBottom();

    // Disable send button
    document.getElementById('send-btn').disabled = true;

    return id;
}

function removeTyping(id) {
    const el = document.getElementById(id);
    if (el) el.remove();
    document.getElementById('send-btn').disabled = false;
}

// ========================================
// Helpers
// ========================================
function scrollToBottom() {
    const messagesDiv = document.getElementById('chat-messages');
    requestAnimationFrame(() => {
        messagesDiv.scrollTop = messagesDiv.scrollHeight;
    });
}

function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    const div = document.createElement('div');
    div.textContent = String(str);
    return div.innerHTML;
}

function escapeAttr(str) {
    return String(str).replace(/'/g, "\\'").replace(/"/g, '&quot;').replace(/\n/g, ' ');
}

function formatExplanation(text) {
    if (!text) return '';
    // Convert markdown-style bold
    let formatted = escapeHtml(text);
    formatted = formatted.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
    // Convert newlines
    formatted = formatted.replace(/\n/g, '<br>');
    return formatted;
}

function formatColumnName(col) {
    return col.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
}

function formatCellValue(col, value) {
    if (value === null || value === undefined) return '<span style="color: var(--text-muted);">—</span>';

    const colLower = col.toLowerCase();

    // Severity badges
    if (colLower === 'severity') {
        const severity = String(value).toLowerCase();
        return `<span class="badge badge-${severity}">${escapeHtml(value)}</span>`;
    }

    // Status badges
    if (colLower === 'status') {
        const statusColors = {
            'received': 'medium',
            'dispatched': 'medium',
            'in progress': 'high',
            'resolved': 'low',
            'closed': 'low',
            'false alarm': 'critical'
        };
        const colorClass = statusColors[String(value).toLowerCase()] || 'medium';
        return `<span class="badge badge-${colorClass}">${escapeHtml(value)}</span>`;
    }

    return escapeHtml(value);
}

function highlightSQL(sql) {
    if (!sql) return '';
    const escaped = escapeHtml(sql);
    // Basic SQL keyword highlighting
    const keywords = ['SELECT', 'FROM', 'WHERE', 'JOIN', 'LEFT JOIN', 'RIGHT JOIN', 'INNER JOIN',
        'ON', 'GROUP BY', 'ORDER BY', 'HAVING', 'LIMIT', 'AS', 'AND', 'OR', 'NOT', 'IN',
        'LIKE', 'BETWEEN', 'IS', 'NULL', 'COUNT', 'SUM', 'AVG', 'MAX', 'MIN', 'DISTINCT',
        'CASE', 'WHEN', 'THEN', 'ELSE', 'END', 'DESC', 'ASC', 'ROUND', 'WITH', 'UNION',
        'INSERT', 'UPDATE', 'DELETE', 'CREATE', 'DROP', 'ALTER', 'STRFTIME', 'COALESCE'];

    let result = escaped;
    keywords.forEach(kw => {
        const regex = new RegExp(`\\b(${kw})\\b`, 'gi');
        result = result.replace(regex, `<span style="color: #c084fc;">$1</span>`);
    });

    // Highlight strings
    result = result.replace(/'([^']*)'/g, `<span style="color: #86efac;">'$1'</span>`);

    // Highlight numbers
    result = result.replace(/\b(\d+)\b/g, `<span style="color: #fbbf24;">$1</span>`);

    return result;
}

function copySQL(btn, sql) {
    navigator.clipboard.writeText(sql.replace(/\\'/g, "'")).then(() => {
        btn.textContent = 'Copied!';
        setTimeout(() => { btn.textContent = 'Copy'; }, 2000);
    });
}

// ========================================
// Voice Recording
// ========================================
let mediaRecorder;
let audioChunks = [];
let isRecording = false;

async function toggleRecording() {
    const micBtn = document.getElementById('mic-btn');
    if (isRecording) {
        mediaRecorder.stop();
        micBtn.classList.remove('recording');
        isRecording = false;
        return;
    }

    try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        mediaRecorder = new MediaRecorder(stream);
        audioChunks = [];

        mediaRecorder.addEventListener('dataavailable', event => {
            audioChunks.push(event.data);
        });

        mediaRecorder.addEventListener('stop', async () => {
            const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
            await sendAudioToTranscribe(audioBlob);
            // Stop all tracks to release mic
            stream.getTracks().forEach(track => track.stop());
        });

        mediaRecorder.start();
        micBtn.classList.add('recording');
        isRecording = true;
    } catch (e) {
        console.error('Error accessing microphone:', e);
        alert('Could not access microphone. Please ensure permissions are granted.');
    }
}

async function sendAudioToTranscribe(blob) {
    const input = document.getElementById('chat-input');
    const originalPlaceholder = input.placeholder;
    input.placeholder = "Transcribing...";
    input.disabled = true;

    try {
        const formData = new FormData();
        formData.append('audio', blob, 'recording.webm');

        const res = await fetch(`${API_BASE}/api/transcribe`, {
            method: 'POST',
            body: formData
        });

        const data = await res.json();
        if (data.text) {
            input.value = data.text;
            autoResize(input);
            sendMessage();
        } else if (data.error) {
            alert('Transcription error: ' + data.error);
        }
    } catch (e) {
        console.error('Transcription failed:', e);
        alert('Failed to transcribe audio.');
    } finally {
        input.placeholder = originalPlaceholder;
        input.disabled = false;
        input.focus();
    }
}
