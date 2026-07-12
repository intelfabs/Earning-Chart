const { buildSankeyModel, NODE_COLORS } = require('../../sankeyBuilder');

describe('buildSankeyModel', () => {
  it('includes the required canonical nodes', () => {
    const sankey = buildSankeyModel({
      values: {
        'Total Revenue': 100,
        'Cost of Revenue': 40,
        'Gross Profit': 60,
        'R&D': 10,
        'SG&A': 8,
        'Operating Expenses': 18,
        'Operating Profit': 42,
        Tax: 9,
        Other: 3,
        'Net Profit': 30,
      },
      revenueBreakdown: [],
      parsedRows: [],
    });

    ['Total Revenue', 'Cost of Revenue', 'Gross Profit', 'Operating Profit', 'Tax', 'Net Profit'].forEach((label) => {
      expect(sankey.labels).toContain(label);
    });
    expect(sankey.value.length).toBeGreaterThan(0);
  });

  it('preserves negative signs for profit annotations and link displays', () => {
    const sankey = buildSankeyModel({
      values: {
        'Total Revenue': 100,
        'Cost of Revenue': 40,
        'Gross Profit': 60,
        'Operating Expenses': 55,
        'Operating Profit': 5,
        Tax: 0,
        Other: 10,
        'Net Profit': -5,
      },
      revenueBreakdown: [],
      parsedRows: [],
    });

    const netProfitAnnotation = sankey.annotations.find((item) => item.label === 'Net Profit');
    const costOfRevenueAnnotation = sankey.annotations.find((item) => item.label === 'Cost of Revenue');
    const netProfitNodeIndex = sankey.labels.indexOf('Net Profit');
    const netProfitLinkIndex = sankey.source.findIndex((fromIndex, index) => (
      sankey.labels[fromIndex] === 'Operating Profit' && sankey.labels[sankey.target[index]] === 'Net Profit'
    ));

    expect(netProfitAnnotation?.valueText).toBe('-$5');
    expect(netProfitAnnotation?.detailText).toBe('-5% margin');
    expect(netProfitAnnotation?.color).toBe(NODE_COLORS.loss);
    expect(costOfRevenueAnnotation?.valueText).toBe('($40)');
    expect(netProfitNodeIndex).toBeGreaterThanOrEqual(0);
    expect(sankey.nodeColors[netProfitNodeIndex]).toBe(NODE_COLORS.loss);
    expect(netProfitLinkIndex).toBeGreaterThanOrEqual(0);
    expect(sankey.linkSignedValue[netProfitLinkIndex]).toBe(-5);
    expect(sankey.linkColors[netProfitLinkIndex]).toBe('rgba(245, 158, 11, 0.42)');
  });
});