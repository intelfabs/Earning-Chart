const { buildSankeyModel } = require('../../sankeyBuilder');

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
});