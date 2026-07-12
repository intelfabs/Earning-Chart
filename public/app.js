(function () {
  const state = {
    payload: null,
    overrides: {},
    busy: false,
    lastFocusedElement: null,
  };

  const elements = {
    tickerForm: document.getElementById('ticker-form'),
    tickerInput: document.getElementById('ticker-input'),
    loadTickerButton: document.getElementById('load-ticker-button'),
    uploadForm: document.getElementById('upload-form'),
    uploadInput: document.getElementById('upload-input'),
    uploadButton: document.getElementById('upload-button'),
    chartTitle: document.getElementById('chart-title'),
    chartSubtitle: document.getElementById('chart-subtitle'),
    chart: document.getElementById('chart'),
    chartLoading: document.getElementById('chart-loading'),
    loadingMessage: document.getElementById('loading-message'),
    confidencePill: document.getElementById('confidence-pill'),
    statusMessage: document.getElementById('status-message'),
    issuesList: document.getElementById('issues-list'),
    metricsGrid: document.getElementById('metrics-grid'),
    sourceLabel: document.getElementById('source-label'),
    editMappingButton: document.getElementById('edit-mapping-button'),
    copyButton: document.getElementById('copy-button'),
    downloadPngButton: document.getElementById('download-png-button'),
    downloadSvgButton: document.getElementById('download-svg-button'),
    mappingModal: document.getElementById('mapping-modal'),
    mappingTableBody: document.getElementById('mapping-table-body'),
    closeMappingButton: document.getElementById('close-mapping-button'),
    applyMappingButton: document.getElementById('apply-mapping-button'),
    quickTickerButtons: Array.from(document.querySelectorAll('[data-ticker]')),
  };

  function modalIsOpen() {
    return !elements.mappingModal.classList.contains('hidden');
  }

  function formatCurrency(value) {
    if (value == null || Number.isNaN(Number(value))) {
      return 'n/a';
    }

    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      maximumFractionDigits: 0,
    }).format(Number(value));
  }

  function formatCompactCurrency(value) {
    if (value == null || Number.isNaN(Number(value))) {
      return 'n/a';
    }

    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      notation: 'compact',
      maximumFractionDigits: 1,
    }).format(Number(value));
  }

  function setStatus(message, tone) {
    elements.statusMessage.textContent = message;
    elements.statusMessage.dataset.tone = tone || 'default';
  }

  function setBusy(isBusy, message) {
    state.busy = isBusy;
    elements.chartLoading.classList.toggle('hidden', !isBusy);
    elements.chartLoading.setAttribute('aria-hidden', String(!isBusy));
    if (message) {
      elements.loadingMessage.textContent = message;
    }

    if (elements.tickerInput) {
      elements.tickerInput.disabled = isBusy;
    }
    if (elements.loadTickerButton) {
      elements.loadTickerButton.disabled = isBusy;
    }
    if (elements.uploadInput) {
      elements.uploadInput.disabled = isBusy;
    }
    if (elements.uploadButton) {
      elements.uploadButton.disabled = isBusy;
    }
    elements.applyMappingButton.disabled = isBusy;
    elements.quickTickerButtons.forEach((button) => {
      button.disabled = isBusy;
    });
  }

  function resetHeader() {
    elements.chartTitle.textContent = 'Income Statement Flow Explorer';
    elements.chartSubtitle.textContent = 'Fetch the latest SEC filing and turn it into an interactive revenue-to-profit flow.';
    elements.sourceLabel.textContent = 'Source: none';
    elements.confidencePill.textContent = 'No data';
    elements.confidencePill.className = 'confidence-pill muted';
    elements.metricsGrid.innerHTML = '';
  }

  function renderIssues(issues) {
    elements.issuesList.innerHTML = '';
    (issues || []).forEach((issue) => {
      const item = document.createElement('li');
      item.textContent = issue;
      elements.issuesList.appendChild(item);
    });
  }

  function renderMetrics(metrics) {
    const ordered = [
      ['Total Revenue', metrics.totalRevenue],
      ['Cost of Revenue', metrics.costOfRevenue],
      ['Gross Profit', metrics.grossProfit],
      ['Operating Expenses', metrics.operatingExpenses],
      ['Operating Profit', metrics.operatingProfit],
      ['Tax', metrics.tax],
      ['Other', metrics.other],
      ['Net Profit', metrics.netProfit],
    ];

    elements.metricsGrid.innerHTML = '';

    ordered.forEach(([label, value]) => {
      const item = document.createElement('div');
      item.className = 'metric-item';
      item.setAttribute('role', 'listitem');

      const labelNode = document.createElement('span');
      labelNode.className = 'metric-label';
      labelNode.textContent = label;

      const valueNode = document.createElement('span');
      valueNode.className = 'metric-value';
      valueNode.textContent = formatCompactCurrency(value);

      item.appendChild(labelNode);
      item.appendChild(valueNode);
      elements.metricsGrid.appendChild(item);
    });
  }

  function setButtonsEnabled(enabled) {
    [
      elements.editMappingButton,
      elements.copyButton,
      elements.downloadPngButton,
      elements.downloadSvgButton,
    ].forEach((button) => {
      button.disabled = !enabled;
    });
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function buildChartAnnotations(sankey) {
    return (sankey.annotations || []).map((annotation) => {
      const titleSize = annotation.variant === 'primary' ? 15 : annotation.variant === 'secondary' ? 13 : 12;
      const valueSize = annotation.variant === 'primary' ? 20 : annotation.variant === 'secondary' ? 16 : 14;
      const detail = annotation.detailText
        ? `<span style="font-size:11px;color:#8b9bb8;font-weight:600">${escapeHtml(annotation.detailText)}</span>`
        : '';

      return {
        xref: 'paper',
        yref: 'paper',
        x: annotation.x,
        y: 1 - annotation.y,
        xanchor: annotation.xanchor,
        yanchor: annotation.yanchor,
        align: annotation.align,
        showarrow: false,
        bgcolor: 'rgba(12,18,32,0.92)',
        bordercolor: 'rgba(148,163,184,0.18)',
        borderwidth: 1,
        borderpad: annotation.variant === 'branch' ? 3 : 5,
        text: [
          `<span style="font-size:${titleSize}px;font-weight:700;color:${escapeHtml(annotation.color)}">${escapeHtml(annotation.title)}</span>`,
          `<span style="font-size:${valueSize}px;font-weight:700;color:${escapeHtml(annotation.color)}">${escapeHtml(annotation.valueText)}</span>`,
          detail,
        ].filter(Boolean).join('<br>'),
      };
    });
  }

  function renderChart(sankey) {
    const isMobile = window.matchMedia('(max-width: 920px)').matches;
    const isConstrained = window.matchMedia('(max-width: 860px)').matches;
    const annotations = buildChartAnnotations(sankey);

    const trace = {
      type: 'sankey',
      arrangement: 'fixed',
      textfont: {
        color: 'rgba(0,0,0,0)',
        size: 1,
      },
      node: {
        label: sankey.labels,
        color: sankey.nodeColors,
        x: sankey.nodeX,
        y: sankey.nodeY,
        pad: isMobile ? 24 : 26,
        thickness: isMobile ? 15 : 18,
        line: {
          color: 'rgba(255,255,255,0)',
          width: 0,
        },
        hovertemplate: '%{label}<extra></extra>',
      },
      link: {
        source: sankey.source,
        target: sankey.target,
        value: sankey.value,
        color: sankey.linkColors,
        hovertemplate: '%{source.label} → %{target.label}<br>%{value:$,.0f}<extra></extra>',
      },
    };

    const layout = {
      paper_bgcolor: '#0a101c',
      plot_bgcolor: '#0a101c',
      width: isConstrained ? 920 : undefined,
      height: isConstrained ? 780 : isMobile ? 920 : 840,
      font: {
        family: 'DM Sans, Segoe UI, Arial, sans-serif',
        size: 14,
        color: '#e8eef9',
      },
      annotations,
      margin: isConstrained
        ? { l: 72, r: 128, t: 142, b: 34 }
        : isMobile
          ? { l: 46, r: 92, t: 132, b: 34 }
          : { l: 90, r: 130, t: 146, b: 36 },
      hoverlabel: {
        bgcolor: '#162033',
        bordercolor: '#334155',
        font: {
          family: 'DM Sans, Segoe UI, Arial, sans-serif',
          color: '#e8eef9',
        },
      },
    };

    return Plotly.react(elements.chart, [trace], layout, { responsive: true, displayModeBar: false }).then(() => {
      if (isConstrained) {
        const frame = elements.chart.parentElement;
        frame.scrollLeft = Math.max(0, (elements.chart.scrollWidth - frame.clientWidth) * 0.34);
      }
    });
  }

  function renderPayload(payload, options = {}) {
    state.payload = payload;
    if (!options.preserveOverrides) {
      state.overrides = {};
    }
    setBusy(false);

    elements.chartTitle.textContent = `${payload.companyName} Income Statement Flow`;
    elements.chartSubtitle.textContent = `${payload.filing.form} filed ${payload.filing.filingDate}${payload.filing.reportDate ? `, reporting period ${payload.filing.reportDate}` : ''}`;
    elements.confidencePill.textContent = `${payload.confidence.label} confidence (${Math.round(payload.confidence.score * 100)}%)`;
    elements.confidencePill.className = `confidence-pill confidence-${payload.confidence.label.toLowerCase()}`;
    elements.sourceLabel.textContent = `Source: ${payload.sourceType}`;
    setStatus('Chart ready. Review confidence notes if the parser used a fallback.', 'success');
    renderIssues([...(payload.issues || []), ...(payload.confidence.issues || [])]);
    renderMetrics(payload.sankey.metrics);
    setButtonsEnabled(true);
    renderChart(payload.sankey);
  }

  function clearChartSurface() {
    if (window.Plotly) {
      Plotly.purge(elements.chart);
    }
    elements.chart.innerHTML = '';
  }

  function renderEmptyState({ icon, title, message, detail, error }) {
    clearChartSurface();

    const wrap = document.createElement('div');
    wrap.className = `empty-state${error ? ' empty-state-error' : ' empty-state-rich'}`;

    const inner = document.createElement('div');
    inner.className = 'empty-state-inner';

    const iconNode = document.createElement('div');
    iconNode.className = 'empty-state-icon';
    iconNode.setAttribute('aria-hidden', 'true');
    iconNode.textContent = icon;

    const titleNode = document.createElement('strong');
    titleNode.textContent = title;

    const messageNode = document.createElement('p');
    messageNode.textContent = message;

    inner.appendChild(iconNode);
    inner.appendChild(titleNode);
    inner.appendChild(messageNode);

    if (detail) {
      const detailNode = document.createElement('p');
      detailNode.textContent = detail;
      inner.appendChild(detailNode);
    }

    wrap.appendChild(inner);
    elements.chart.appendChild(wrap);
  }

  function renderError(message) {
    setBusy(false);
    setStatus(message, 'error');
    renderIssues([]);
    setButtonsEnabled(false);
    resetHeader();
    renderEmptyState({
      icon: '!',
      title: 'We could not build a chart for that request.',
      message,
      detail: 'Try another ticker or upload an HTML or PDF filing manually.',
      error: true,
    });
  }

  function renderIdle(message) {
    setBusy(false);
    setStatus(message, 'default');
    renderIssues([]);
    setButtonsEnabled(false);
    resetHeader();
    renderEmptyState({
      icon: '↗',
      title: 'Start with a live filing or your own document.',
      message: 'Use the ticker box for the latest SEC earnings release, or upload an HTML or PDF filing when automatic fetch is not enough.',
    });
  }

  async function requestJson(url, options) {
    const response = await fetch(url, options);
    let payload;
    try {
      payload = await response.json();
    } catch {
      throw new Error(response.ok ? 'Unexpected response from server.' : `Request failed (${response.status}).`);
    }
    if (!response.ok || !payload.ok) {
      throw new Error(payload.error || 'Request failed.');
    }
    return payload;
  }

  async function loadTicker(ticker) {
    const normalized = String(ticker || '').trim().toUpperCase();
    if (!normalized) {
      setStatus('Enter a public company ticker.', 'error');
      return;
    }

    if (elements.tickerInput) {
      elements.tickerInput.value = normalized;
    }

    setBusy(true, `Loading latest SEC filing for ${normalized}...`);
    setStatus(`Loading latest SEC filing for ${normalized}...`);
    const result = await requestJson(`/api/sankey-data?ticker=${encodeURIComponent(normalized)}`);
    renderPayload(result.payload);
    history.replaceState({}, '', `/sankey?ticker=${encodeURIComponent(normalized)}`);
  }

  function getFocusableModalElements() {
    return Array.from(
      elements.mappingModal.querySelectorAll('button, select, input, textarea, [href], [tabindex]:not([tabindex="-1"])'),
    ).filter((element) => !element.disabled && element.offsetParent !== null);
  }

  function openMappingModal() {
    if (!state.payload) {
      return;
    }

    state.lastFocusedElement = document.activeElement;

    elements.mappingTableBody.innerHTML = '';
    state.payload.parsedRows.forEach((row) => {
      const tableRow = document.createElement('tr');

      const labelCell = document.createElement('td');
      labelCell.textContent = row.originalLabel;

      const valueCell = document.createElement('td');
      valueCell.textContent = formatCurrency(row.value);

      const selectCell = document.createElement('td');
      const select = document.createElement('select');
      state.payload.mappingOptions.forEach((optionLabel) => {
        const option = document.createElement('option');
        option.value = optionLabel;
        option.textContent = optionLabel;
        if ((state.overrides[row.id] || row.canonicalLabel) === optionLabel) {
          option.selected = true;
        }
        select.appendChild(option);
      });
      select.addEventListener('change', (event) => {
        state.overrides[row.id] = event.target.value;
      });
      selectCell.appendChild(select);

      tableRow.appendChild(labelCell);
      tableRow.appendChild(valueCell);
      tableRow.appendChild(selectCell);
      elements.mappingTableBody.appendChild(tableRow);
    });

    elements.mappingModal.classList.remove('hidden');
    elements.mappingModal.setAttribute('aria-hidden', 'false');
    const focusableElements = getFocusableModalElements();
    (focusableElements[0] || elements.closeMappingButton).focus();
  }

  function closeMappingModal() {
    elements.mappingModal.classList.add('hidden');
    elements.mappingModal.setAttribute('aria-hidden', 'true');
    if (state.lastFocusedElement && typeof state.lastFocusedElement.focus === 'function') {
      state.lastFocusedElement.focus();
    }
  }

  async function applyMapping() {
    if (!state.payload) {
      return;
    }

    setBusy(true, 'Rebuilding chart with updated mapping...');
    setStatus('Rebuilding chart with updated mapping...');
    const result = await requestJson('/api/rebuild', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        parsedRows: state.payload.parsedRows,
        overrides: state.overrides,
        sourceType: state.payload.sourceType,
      }),
    });

    state.payload = {
      ...state.payload,
      sankey: result.sankey,
      statement: result.statement,
      confidence: result.confidence,
      parsedRows: result.parsedRows || state.payload.parsedRows,
      issues: result.issues || [],
    };

    renderPayload(state.payload);
    closeMappingModal();
  }

  function dataUrlToBlob(dataUrl) {
    const [header, body] = dataUrl.split(',');
    const mimeMatch = header.match(/data:(.*?);base64/);
    if (!mimeMatch || !body) {
      throw new Error('Could not export chart image.');
    }
    const mimeType = mimeMatch[1];
    const bytes = atob(body);
    const array = new Uint8Array(bytes.length);
    for (let index = 0; index < bytes.length; index += 1) {
      array[index] = bytes.charCodeAt(index);
    }
    return new Blob([array], { type: mimeType });
  }

  async function downloadImage(format) {
    const dataUrl = await Plotly.toImage(elements.chart, {
      format,
      width: 1600,
      height: 900,
      scale: 2,
    });

    const link = document.createElement('a');
    link.href = dataUrl;
    link.download = `${(state.payload?.ticker || 'earning-chart').toLowerCase()}-income-statement.${format}`;
    link.click();
  }

  async function copyImage() {
    if (!navigator.clipboard || typeof window.ClipboardItem === 'undefined') {
      throw new Error('This browser does not support copying images to the clipboard.');
    }

    const dataUrl = await Plotly.toImage(elements.chart, {
      format: 'png',
      width: 1600,
      height: 900,
      scale: 2,
    });
    const blob = dataUrlToBlob(dataUrl);
    await navigator.clipboard.write([
      new window.ClipboardItem({
        'image/png': blob,
      }),
    ]);
  }

  if (elements.tickerForm && elements.tickerInput) {
    elements.tickerInput.addEventListener('input', () => {
      const caret = elements.tickerInput.selectionStart;
      elements.tickerInput.value = elements.tickerInput.value.toUpperCase().replace(/[^A-Z0-9.-]/g, '');
      if (typeof caret === 'number') {
        elements.tickerInput.setSelectionRange(caret, caret);
      }
    });

    elements.tickerForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (state.busy) {
        return;
      }

      const ticker = elements.tickerInput.value.trim().toUpperCase();
      if (!ticker) {
        setStatus('Enter a public company ticker.', 'error');
        return;
      }

      try {
        await loadTicker(ticker);
      } catch (error) {
        renderError(error.message);
      }
    });
  }

  if (elements.uploadForm && elements.uploadInput) {
    elements.uploadForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (state.busy) {
        return;
      }

      if (!elements.uploadInput.files.length) {
        setStatus('Choose an HTML or PDF filing first.', 'error');
        return;
      }

      const formData = new FormData();
      formData.append('filing', elements.uploadInput.files[0]);

      try {
        setBusy(true, 'Uploading and parsing filing...');
        setStatus('Uploading and parsing filing...');
        const response = await fetch('/api/upload', {
          method: 'POST',
          body: formData,
        });
        let result;
        try {
          result = await response.json();
        } catch {
          throw new Error(response.ok ? 'Unexpected response from server.' : `Upload failed (${response.status}).`);
        }
        if (!response.ok || !result.ok) {
          throw new Error(result.error || 'Upload parsing failed.');
        }
        renderPayload(result.payload);
      } catch (error) {
        renderError(error.message);
      }
    });
  }

  elements.quickTickerButtons.forEach((button) => {
    button.addEventListener('click', async () => {
      if (state.busy) {
        return;
      }

      const ticker = button.dataset.ticker;
      try {
        await loadTicker(ticker);
      } catch (error) {
        renderError(error.message);
      }
    });
  });

  elements.editMappingButton.addEventListener('click', openMappingModal);
  elements.closeMappingButton.addEventListener('click', closeMappingModal);
  elements.applyMappingButton.addEventListener('click', async () => {
    try {
      await applyMapping();
    } catch (error) {
      setBusy(false);
      setStatus(error.message, 'error');
    }
  });
  elements.mappingModal.addEventListener('click', (event) => {
    if (event.target.dataset.closeModal === 'true') {
      closeMappingModal();
    }
  });

  document.addEventListener('keydown', (event) => {
    if (!modalIsOpen()) {
      return;
    }

    if (event.key === 'Escape') {
      event.preventDefault();
      closeMappingModal();
      return;
    }

    if (event.key !== 'Tab') {
      return;
    }

    const focusableElements = getFocusableModalElements();
    if (focusableElements.length === 0) {
      return;
    }

    const first = focusableElements[0];
    const last = focusableElements[focusableElements.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  });

  elements.downloadPngButton.addEventListener('click', async () => {
    try {
      await downloadImage('png');
      setStatus('PNG export downloaded.', 'success');
    } catch (error) {
      setStatus(error.message, 'error');
    }
  });

  elements.downloadSvgButton.addEventListener('click', async () => {
    try {
      await downloadImage('svg');
      setStatus('SVG export downloaded.', 'success');
    } catch (error) {
      setStatus(error.message, 'error');
    }
  });

  elements.copyButton.addEventListener('click', async () => {
    try {
      await copyImage();
      setStatus('Image copied to clipboard.', 'success');
    } catch (error) {
      setStatus(error.message, 'error');
    }
  });

  window.addEventListener('resize', () => {
    if (state.payload?.sankey && !state.busy) {
      renderChart(state.payload.sankey);
    }
  });

  const initialState = window.__INITIAL_STATE__;
  const queryTicker = new URLSearchParams(window.location.search).get('ticker');
  if (queryTicker && elements.tickerInput) {
    elements.tickerInput.value = queryTicker.toUpperCase();
  } else if (initialState?.payload?.ticker && elements.tickerInput) {
    elements.tickerInput.value = initialState.payload.ticker.toUpperCase();
  }

  if (initialState?.ok && initialState.payload) {
    renderPayload(initialState.payload);
  } else if (initialState?.error) {
    renderError(initialState.error);
  } else {
    renderIdle('Load a ticker or upload a filing to begin.');
  }
})();
