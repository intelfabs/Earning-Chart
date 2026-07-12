const REQUIRED_LABELS = [
  'Total Revenue',
  'Cost of Revenue',
  'Gross Profit',
  'Operating Profit',
  'Tax',
  'Net Profit',
];

const CANONICAL_LABELS = [
  'Total Revenue',
  'Product Revenue',
  'Service Revenue',
  'Cost of Revenue',
  'Gross Profit',
  'R&D',
  'SG&A',
  'Operating Expenses',
  'Operating Profit',
  'Tax',
  'Other',
  'Net Profit',
  'Ignore',
];

const LABEL_VARIANTS = {
  'Total Revenue': [
    'total revenue',
    'revenue',
    'revenues',
    'net sales',
    'sales revenue net',
    'net revenue',
    'sales',
  ],
  'Product Revenue': [
    'product revenue',
    'product sales',
    'products revenue',
    'products sales',
    'google search and other',
    'youtube ads',
    'google network',
    'google subscriptions platforms and devices',
    'google cloud',
    'other bets',
    'client computing group',
    'data center and ai',
    'network and edge',
    'mobileye',
    'intel foundry',
    'iphone',
    'mac',
    'ipad',
    'wearables home and accessories',
  ],
  'Service Revenue': [
    'service revenue',
    'services revenue',
    'services',
  ],
  'Cost of Revenue': [
    'cost of revenue',
    'cost of sales',
    'cost of goods sold',
    'cost of products sold',
    'cost of services',
    'cost of goods and services sold',
  ],
  'Gross Profit': ['gross profit', 'gross margin'],
  'R&D': [
    'research and development',
    'research development',
    'r and d',
    'rd',
  ],
  'SG&A': [
    'selling general and administrative',
    'selling general administrative',
    'selling and administrative',
    'sales and marketing',
    'general and administrative',
    'sga',
  ],
  'Operating Expenses': ['operating expenses', 'total operating expenses'],
  'Operating Profit': [
    'operating income',
    'income from operations',
    'operating profit',
    'operating income loss',
  ],
  Tax: [
    'provision for income taxes',
    'income tax expense',
    'income taxes',
    'tax expense',
    'taxes',
    'income tax benefit',
  ],
  Other: [
    'other income expense net',
    'other income',
    'other expense',
    'non operating income expense',
    'interest and other income expense net',
  ],
  'Net Profit': [
    'net income',
    'net income loss',
    'net earnings',
    'profit for the period',
    'net profit',
  ],
};

function simplifyLabel(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeLabel(label) {
  const simplified = simplifyLabel(label);
  if (!simplified) {
    return null;
  }

  for (const [canonical, variants] of Object.entries(LABEL_VARIANTS)) {
    if (variants.includes(simplified)) {
      return canonical;
    }
  }

  if (simplified.includes('income tax') || simplified.includes('tax expense') || simplified.includes('tax benefit')) {
    return 'Tax';
  }
  if (simplified.includes('net income') || simplified.includes('net earnings') || simplified.includes('net profit')) {
    return 'Net Profit';
  }
  if (simplified.includes('operating income') || simplified.includes('income from operations') || simplified.includes('operating profit')) {
    return 'Operating Profit';
  }
  if (simplified.includes('gross profit') || simplified.includes('gross margin')) {
    return 'Gross Profit';
  }
  if (simplified.includes('cost of') && (simplified.includes('revenue') || simplified.includes('sales') || simplified.includes('goods'))) {
    return 'Cost of Revenue';
  }
  if (simplified.includes('research') && simplified.includes('development')) {
    return 'R&D';
  }
  if (simplified.includes('selling') && simplified.includes('administrative')) {
    return 'SG&A';
  }
  if (simplified.includes('operating expenses')) {
    return 'Operating Expenses';
  }
  if ((simplified.includes('revenue') || simplified.includes('sales')) && simplified.includes('service')) {
    return 'Service Revenue';
  }
  if ((simplified.includes('revenue') || simplified.includes('sales')) && simplified.includes('product')) {
    return 'Product Revenue';
  }
  if (simplified.includes('other income') || simplified.includes('other expense') || simplified.includes('non operating')) {
    return 'Other';
  }
  if (simplified.includes('revenue') || simplified.includes('sales')) {
    return 'Total Revenue';
  }

  return null;
}

function detectScaleHint(text) {
  const normalized = simplifyLabel(text);
  if (normalized.includes('in billions')) {
    return 1_000_000_000;
  }
  if (normalized.includes('in millions')) {
    return 1_000_000;
  }
  if (normalized.includes('in thousands')) {
    return 1_000;
  }
  return 1;
}

function parseNumericValue(value, scale = 1) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value * scale;
  }

  const raw = String(value || '').trim();
  if (!raw || raw === '-' || raw === '—' || raw === '–') {
    return null;
  }

  const normalized = raw
    .replace(/\u00a0/g, ' ')
    .replace(/\$/g, '')
    .replace(/,/g, '')
    .replace(/\s+/g, '')
    .replace(/%/g, '');

  const negative = normalized.startsWith('(') && normalized.endsWith(')');
  const stripped = negative ? normalized.slice(1, -1) : normalized;

  if (!/^[-+]?\d*(?:\.\d+)?$/.test(stripped)) {
    return null;
  }

  const parsed = Number(stripped);
  if (!Number.isFinite(parsed)) {
    return null;
  }

  return (negative ? -parsed : parsed) * scale;
}

function createEmptyStatement() {
  return {
    values: {
      'Total Revenue': null,
      'Cost of Revenue': null,
      'Gross Profit': null,
      'R&D': null,
      'SG&A': null,
      'Operating Expenses': null,
      'Operating Profit': null,
      Tax: null,
      Other: null,
      'Net Profit': null,
    },
    revenueBreakdown: [],
    parsedRows: [],
  };
}

function cloneStatement(statement) {
  return {
    values: { ...statement.values },
    revenueBreakdown: [...statement.revenueBreakdown],
    parsedRows: [...statement.parsedRows],
  };
}

function choosePreferredValue(existingValue, nextValue) {
  if (existingValue === null || existingValue === undefined) {
    return nextValue;
  }
  return Math.abs(nextValue) > Math.abs(existingValue) ? nextValue : existingValue;
}

function rowsToStatement(rows) {
  const statement = createEmptyStatement();

  rows.forEach((row, index) => {
    if (!row || row.canonicalLabel === 'Ignore' || row.value === null || row.value === undefined) {
      return;
    }

    const normalizedRow = {
      id: row.id || `row-${index + 1}`,
      originalLabel: row.originalLabel,
      canonicalLabel: row.canonicalLabel,
      value: Number(row.value),
      rawValue: row.rawValue ?? row.value,
      source: row.source || 'unknown',
    };

    statement.parsedRows.push(normalizedRow);

    if (normalizedRow.canonicalLabel === 'Product Revenue' || normalizedRow.canonicalLabel === 'Service Revenue') {
      statement.revenueBreakdown.push({
        label: normalizedRow.originalLabel,
        canonicalLabel: normalizedRow.canonicalLabel,
        value: Math.abs(normalizedRow.value),
      });
      return;
    }

    if (Object.prototype.hasOwnProperty.call(statement.values, normalizedRow.canonicalLabel)) {
      statement.values[normalizedRow.canonicalLabel] = choosePreferredValue(
        statement.values[normalizedRow.canonicalLabel],
        normalizedRow.value,
      );
    }
  });

  return finalizeStatement(statement);
}

function finalizeStatement(statement) {
  const next = cloneStatement(statement);
  const values = next.values;

  if (values['Total Revenue'] == null && next.revenueBreakdown.length > 0) {
    values['Total Revenue'] = next.revenueBreakdown.reduce((sum, item) => sum + Math.abs(item.value || 0), 0);
  }

  if (values['Gross Profit'] == null && values['Total Revenue'] != null && values['Cost of Revenue'] != null) {
    values['Gross Profit'] = values['Total Revenue'] - values['Cost of Revenue'];
  }

  if (values['Operating Expenses'] == null) {
    const summedExpenses = [values['R&D'], values['SG&A']]
      .filter((value) => value != null)
      .reduce((sum, value) => sum + value, 0);

    if (summedExpenses > 0) {
      values['Operating Expenses'] = summedExpenses;
    } else if (values['Gross Profit'] != null && values['Operating Profit'] != null) {
      values['Operating Expenses'] = values['Gross Profit'] - values['Operating Profit'];
    }
  }

  if (values['Operating Profit'] == null && values['Gross Profit'] != null && values['Operating Expenses'] != null) {
    values['Operating Profit'] = values['Gross Profit'] - values['Operating Expenses'];
  }

  if (values['Tax'] == null && values['Operating Profit'] != null && values['Net Profit'] != null) {
    values['Tax'] = Math.max(values['Operating Profit'] - values['Net Profit'] - Math.max(values.Other || 0, 0), 0);
  }

  if (values.Other == null && values['Operating Profit'] != null && values['Tax'] != null && values['Net Profit'] != null) {
    values.Other = values['Operating Profit'] - values['Tax'] - values['Net Profit'];
  }

  if (values['Net Profit'] == null && values['Operating Profit'] != null) {
    const tax = values.Tax || 0;
    const other = values.Other || 0;
    values['Net Profit'] = values['Operating Profit'] - tax - other;
  }

  return next;
}

function mergeStatements(primary, secondary) {
  const merged = cloneStatement(primary || createEmptyStatement());
  const addition = secondary || createEmptyStatement();

  Object.keys(merged.values).forEach((label) => {
    if (merged.values[label] == null && addition.values[label] != null) {
      merged.values[label] = addition.values[label];
    }
  });

  const seenBreakdown = new Set(merged.revenueBreakdown.map((item) => `${item.canonicalLabel}:${simplifyLabel(item.label)}`));
  addition.revenueBreakdown.forEach((item) => {
    const key = `${item.canonicalLabel}:${simplifyLabel(item.label)}`;
    if (!seenBreakdown.has(key)) {
      seenBreakdown.add(key);
      merged.revenueBreakdown.push(item);
    }
  });

  merged.parsedRows = [...merged.parsedRows, ...addition.parsedRows];
  return finalizeStatement(merged);
}

function applyOverrides(rows, overrides = {}) {
  return rows.map((row) => ({
    ...row,
    canonicalLabel: overrides[row.id] || row.canonicalLabel,
  }));
}

function listMissingLineItems(statement, labels = REQUIRED_LABELS) {
  return labels.filter((label) => statement.values[label] == null);
}

function hasRequiredLineItems(statement, labels = REQUIRED_LABELS) {
  return listMissingLineItems(statement, labels).length === 0;
}

module.exports = {
  CANONICAL_LABELS,
  REQUIRED_LABELS,
  applyOverrides,
  createEmptyStatement,
  detectScaleHint,
  finalizeStatement,
  hasRequiredLineItems,
  listMissingLineItems,
  mergeStatements,
  normalizeLabel,
  parseNumericValue,
  rowsToStatement,
  simplifyLabel,
};