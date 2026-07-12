const { finalizeStatement } = require('./mapping');

const NODE_COLORS = {
  revenue: '#4f83f1',
  detail: '#82aef8',
  detailAlt: '#f5cb52',
  cost: '#ec5a5a',
  expense: '#e10600',
  expenseSoft: '#f07f7f',
  profit: '#28a745',
  profitSoft: '#98d796',
  tax: '#b91c1c',
  neutral: '#9f6f7e',
};

function withAlpha(hexColor, alpha) {
  const normalized = hexColor.replace('#', '');
  const red = parseInt(normalized.slice(0, 2), 16);
  const green = parseInt(normalized.slice(2, 4), 16);
  const blue = parseInt(normalized.slice(4, 6), 16);
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

function roundFlow(value) {
  return Number(Math.max(0, value || 0).toFixed(2));
}

function flowValue(value) {
  return roundFlow(Math.abs(value || 0));
}

function hasVisibleValue(value) {
  return Math.abs(value || 0) >= 1;
}

function formatCompactCurrency(value, outflow = false) {
  const absoluteValue = Math.abs(value || 0);
  let formatted;

  if (absoluteValue >= 1_000_000_000) {
    formatted = `$${(absoluteValue / 1_000_000_000).toFixed(1)}B`;
  } else if (absoluteValue >= 1_000_000) {
    formatted = `$${(absoluteValue / 1_000_000).toFixed(1)}M`;
  } else if (absoluteValue >= 1_000) {
    formatted = `$${(absoluteValue / 1_000).toFixed(1)}K`;
  } else {
    formatted = `$${absoluteValue.toFixed(0)}`;
  }

  return outflow ? `(${formatted})` : formatted;
}

function percentOf(total, value) {
  if (!total || !value) {
    return null;
  }
  return Math.round((Math.abs(value) / Math.abs(total)) * 100);
}

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

function spreadBetween(start, end, count) {
  if (count <= 1) {
    return [start];
  }

  const step = (end - start) / (count - 1);
  return Array.from({ length: count }, (_, index) => start + step * index);
}

function chooseRevenueDetailColor(label, index) {
  const normalized = String(label || '').toLowerCase();
  if (/cloud|service|other|play|subscription|platform|licensing/.test(normalized)) {
    return 'detailAlt';
  }
  return index % 3 === 2 ? 'detailAlt' : 'detail';
}

function buildRevenueFeeds(statement, totalRevenue) {
  const sorted = [...statement.revenueBreakdown]
    .filter((item) => item.value > 0)
    .sort((left, right) => right.value - left.value);

  if (sorted.length === 0 && hasVisibleValue(totalRevenue)) {
    return [
      {
        label: 'Reported Revenue',
        value: totalRevenue,
        colorKey: 'detail',
        annotationTitle: 'Reported revenue',
      },
    ];
  }

  const visible = sorted.slice(0, 5).map((item, index) => ({
    label: item.label,
    value: item.value,
    colorKey: chooseRevenueDetailColor(item.label, index),
    annotationTitle: item.label,
  }));

  const remainder = sorted.slice(5).reduce((sum, item) => sum + item.value, 0);
  if (remainder > 0) {
    visible.push({
      label: 'Other Revenue',
      value: remainder,
      colorKey: 'detailAlt',
      annotationTitle: 'Other revenue',
    });
  }

  return visible;
}

function buildSankeyModel(statementInput) {
  const statement = finalizeStatement(statementInput);
  const values = statement.values;
  const layoutColumns = {
    feedNodeX: 0.16,
    feedLabelX: 0.03,
    revenueNodeX: 0.38,
    grossCostNodeX: 0.58,
    operatingNodeX: 0.77,
    terminalNodeX: 0.94,
  };
  const labels = [];
  const nodes = [];
  const nodeColors = [];
  const source = [];
  const target = [];
  const value = [];
  const linkColors = [];
  const nodeIndex = new Map();

  function ensureNode(label, colorKey = 'neutral', options = {}) {
    if (!nodeIndex.has(label)) {
      nodeIndex.set(label, labels.length);
      labels.push(label);
      nodeColors.push(NODE_COLORS[colorKey] || NODE_COLORS.neutral);
      nodes.push({
        label,
        colorKey,
        x: 0.5,
        y: 0.5,
        value: 0,
        annotation: null,
        ...options,
      });
    } else {
      const existingIndex = nodeIndex.get(label);
      const existingNode = nodes[existingIndex];
      existingNode.colorKey = options.colorKey || existingNode.colorKey || colorKey;
      Object.assign(existingNode, options);
      nodeColors[existingIndex] = NODE_COLORS[existingNode.colorKey] || NODE_COLORS.neutral;
    }
    return nodeIndex.get(label);
  }

  function addLink(fromLabel, toLabel, amount, colorKey) {
    const magnitude = flowValue(amount);
    if (magnitude <= 0) {
      ensureNode(fromLabel, colorKey);
      ensureNode(toLabel, colorKey);
      return;
    }

    const fromIndex = ensureNode(fromLabel, colorKey);
    const toIndex = ensureNode(toLabel, colorKey);

    source.push(fromIndex);
    target.push(toIndex);
    value.push(magnitude);
    linkColors.push(withAlpha(NODE_COLORS[colorKey] || NODE_COLORS.neutral, 0.42));

    nodes[fromIndex].value = Math.max(nodes[fromIndex].value || 0, magnitude);
    nodes[toIndex].value = Math.max(nodes[toIndex].value || 0, magnitude);
  }

  const totalRevenue = values['Total Revenue'] || 0;
  const costOfRevenue = values['Cost of Revenue'] || 0;
  const grossProfit = values['Gross Profit'] || Math.max(totalRevenue - costOfRevenue, 0);
  const operatingExpenses = values['Operating Expenses'] || Math.max(grossProfit - (values['Operating Profit'] || 0), 0);
  const operatingProfit = values['Operating Profit'] || Math.max(grossProfit - operatingExpenses, 0);
  const tax = values.Tax != null ? values.Tax : Math.max(operatingProfit - (values['Net Profit'] || 0) - Math.max(values.Other || 0, 0), 0);
  const other = values.Other != null ? values.Other : Math.max(operatingProfit - tax - (values['Net Profit'] || 0), 0);
  const netProfit = values['Net Profit'] != null ? values['Net Profit'] : Math.max(operatingProfit - tax - other, 0);
  const expenseBranches = [
    { label: 'R&D', value: values['R&D'] || 0, colorKey: 'expenseSoft' },
    { label: 'SG&A', value: values['SG&A'] || 0, colorKey: 'expenseSoft' },
  ].filter((item) => hasVisibleValue(item.value));
  const profitBranches = [
    { label: 'Tax', value: tax, colorKey: 'tax' },
    { label: 'Other', value: other, colorKey: 'neutral' },
  ].filter((item) => hasVisibleValue(item.value));

  const revenueFeeds = buildRevenueFeeds(statement, totalRevenue);
  revenueFeeds.forEach((item) => {
    ensureNode(item.label, item.colorKey, {
      annotation: {
        title: item.annotationTitle,
        value: item.value,
        detail: percentOf(totalRevenue, item.value) ? `${percentOf(totalRevenue, item.value)}% of revenue` : null,
        color: NODE_COLORS[item.colorKey],
        variant: 'detail',
        outflow: false,
      },
      annotationPosition: {
        x: 0.02,
        y: 0.2,
        xanchor: 'left',
        yanchor: 'middle',
        align: 'left',
      },
    });
    addLink(item.label, 'Total Revenue', item.value, item.colorKey);
  });

  addLink('Total Revenue', 'Cost of Revenue', costOfRevenue, 'cost');
  addLink('Total Revenue', 'Gross Profit', grossProfit, 'revenue');
  addLink('Gross Profit', 'Operating Expenses', operatingExpenses, 'expense');
  addLink('Gross Profit', 'Operating Profit', operatingProfit, 'profit');
  expenseBranches.forEach((item) => {
    addLink('Operating Expenses', item.label, item.value, item.colorKey);
  });
  profitBranches.forEach((item) => {
    addLink('Operating Profit', item.label, item.value, item.colorKey);
  });
  addLink('Operating Profit', 'Net Profit', netProfit, 'profit');

  ['Total Revenue', 'Cost of Revenue', 'Gross Profit', 'Operating Expenses', 'Operating Profit', 'Net Profit'].forEach((label) => ensureNode(label));

  ensureNode('Total Revenue', 'revenue', {
    annotation: {
      title: 'Revenue',
      value: totalRevenue,
      detail: null,
      color: NODE_COLORS.revenue,
      variant: 'primary',
    },
    annotationPosition: {
      x: layoutColumns.revenueNodeX,
      y: 0.07,
      xanchor: 'center',
      yanchor: 'bottom',
      align: 'center',
    },
  });
  ensureNode('Gross Profit', 'profit', {
    annotation: {
      title: 'Gross Profit',
      value: grossProfit,
      detail: percentOf(totalRevenue, grossProfit) ? `${percentOf(totalRevenue, grossProfit)}% margin` : null,
      color: NODE_COLORS.profit,
      variant: 'primary',
    },
    annotationPosition: {
      x: layoutColumns.grossCostNodeX,
      y: 0.035,
      xanchor: 'center',
      yanchor: 'bottom',
      align: 'center',
    },
  });
  ensureNode('Operating Profit', 'profit', {
    annotation: {
      title: 'Operating Profit',
      value: operatingProfit,
      detail: percentOf(totalRevenue, operatingProfit) ? `${percentOf(totalRevenue, operatingProfit)}% margin` : null,
      color: NODE_COLORS.profit,
      variant: 'primary',
    },
    annotationPosition: {
      x: layoutColumns.operatingNodeX,
      y: 0.025,
      xanchor: 'center',
      yanchor: 'bottom',
      align: 'center',
    },
  });
  ensureNode('Net Profit', 'profit', {
    annotation: {
      title: 'Net Profit',
      value: netProfit,
      detail: percentOf(totalRevenue, netProfit) ? `${percentOf(totalRevenue, netProfit)}% margin` : null,
      color: NODE_COLORS.profit,
      variant: 'primary',
    },
    annotationPosition: {
      x: layoutColumns.terminalNodeX,
      y: 0.025,
      xanchor: 'center',
      yanchor: 'bottom',
      align: 'center',
    },
  });
  ensureNode('Cost of Revenue', 'cost', {
    annotation: {
      title: 'Cost of Revenue',
      value: costOfRevenue,
      detail: percentOf(totalRevenue, costOfRevenue) ? `${percentOf(totalRevenue, costOfRevenue)}% of revenue` : null,
      color: NODE_COLORS.cost,
      variant: 'secondary',
      outflow: true,
    },
    annotationPosition: {
      x: layoutColumns.grossCostNodeX,
      y: 0.71,
      xanchor: 'center',
      yanchor: 'top',
      align: 'center',
    },
  });
  ensureNode('Operating Expenses', 'expense', {
    annotation: {
      title: 'Operating Expenses',
      value: operatingExpenses,
      detail: percentOf(totalRevenue, operatingExpenses) ? `${percentOf(totalRevenue, operatingExpenses)}% of revenue` : null,
      color: NODE_COLORS.expense,
      variant: 'secondary',
      outflow: true,
    },
    annotationPosition: {
      x: 0.81,
      y: 0.6,
      xanchor: 'center',
      yanchor: 'top',
      align: 'center',
    },
  });
  const feedPositions = revenueFeeds.length === 1
    ? [0.32]
    : spreadBetween(0.16, 0.72, revenueFeeds.length);
  revenueFeeds.forEach((item, index) => {
    const position = clamp(feedPositions[index], 0.14, 0.78);
    ensureNode(item.label, item.colorKey, {
      x: layoutColumns.feedNodeX,
      y: position,
      annotationPosition: {
        x: layoutColumns.feedLabelX,
        y: position + 0.01,
        xanchor: 'left',
        yanchor: 'middle',
        align: 'left',
      },
    });
  });

  ensureNode('Total Revenue', 'revenue', { x: layoutColumns.revenueNodeX, y: 0.29 });
  ensureNode('Gross Profit', 'profit', { x: layoutColumns.grossCostNodeX, y: 0.14 });
  ensureNode('Cost of Revenue', 'cost', { x: layoutColumns.grossCostNodeX, y: 0.6 });
  ensureNode('Operating Profit', 'profit', { x: layoutColumns.operatingNodeX, y: 0.11 });
  ensureNode('Operating Expenses', 'expense', { x: layoutColumns.operatingNodeX, y: 0.54 });
  ensureNode('Net Profit', 'profit', { x: layoutColumns.terminalNodeX, y: 0.12 });

  spreadBetween(0.36, 0.48, Math.max(profitBranches.length, 1)).forEach((position, index) => {
    const branch = profitBranches[index];
    if (!branch) {
      return;
    }
    ensureNode(branch.label, branch.colorKey, {
      x: layoutColumns.terminalNodeX,
      y: position,
      annotation: {
        title: branch.label,
        value: branch.value,
        detail: null,
        color: NODE_COLORS[branch.colorKey === 'tax' ? 'tax' : 'neutral'],
        variant: 'branch',
        outflow: true,
      },
      annotationPosition: {
        x: 0.98,
        y: position + 0.01,
        xanchor: 'left',
        yanchor: 'middle',
        align: 'left',
      },
    });
  });

  spreadBetween(0.63, 0.8, Math.max(expenseBranches.length, 1)).forEach((position, index) => {
    const branch = expenseBranches[index];
    if (!branch) {
      return;
    }
    ensureNode(branch.label, branch.colorKey, {
      x: layoutColumns.terminalNodeX,
      y: position,
      annotation: {
        title: branch.label,
        value: branch.value,
        detail: null,
        color: NODE_COLORS.expense,
        variant: 'branch',
        outflow: true,
      },
      annotationPosition: {
        x: 0.98,
        y: position + 0.01,
        xanchor: 'left',
        yanchor: 'middle',
        align: 'left',
      },
    });
  });

  const annotations = nodes
    .filter((node) => node.annotation)
    .map((node) => {
      const position = node.annotationPosition || {
        x: node.x,
        y: node.y,
        xanchor: 'center',
        yanchor: 'bottom',
        align: 'center',
      };

      return {
        label: node.label,
        x: position.x,
        y: position.y,
        xanchor: position.xanchor,
        yanchor: position.yanchor,
        align: position.align,
        title: node.annotation.title,
        valueText: formatCompactCurrency(node.annotation.value, node.annotation.outflow),
        detailText: node.annotation.detail,
        color: node.annotation.color,
        variant: node.annotation.variant,
      };
    });

  return {
    labels,
    nodes,
    source,
    target,
    value,
    nodeColors,
    linkColors,
    nodeX: nodes.map((node) => node.x),
    nodeY: nodes.map((node) => node.y),
    annotations,
    metrics: {
      totalRevenue,
      costOfRevenue,
      grossProfit,
      operatingExpenses,
      operatingProfit,
      tax,
      other,
      netProfit,
    },
  };
}

module.exports = {
  buildSankeyModel,
  NODE_COLORS,
};