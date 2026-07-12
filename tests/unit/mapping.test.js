const { finalizeStatement, normalizeLabel, parseNumericValue } = require('../../mapping');

describe('mapping helpers', () => {
  it('normalizes common label variants', () => {
    expect(normalizeLabel('Net sales')).toBe('Total Revenue');
    expect(normalizeLabel('Cost of goods sold')).toBe('Cost of Revenue');
    expect(normalizeLabel('Selling, general and administrative')).toBe('SG&A');
  });

  it('parses negatives in parentheses', () => {
    expect(parseNumericValue('(1,234)')).toBe(-1234);
    expect(parseNumericValue('$42,287')).toBe(42287);
  });

  it('derives tax from operating profit and net profit', () => {
    const statement = finalizeStatement({
      values: {
        'Total Revenue': 100,
        'Cost of Revenue': 40,
        'Gross Profit': 60,
        'R&D': null,
        'SG&A': null,
        'Operating Expenses': 18,
        'Operating Profit': 42,
        Tax: null,
        Other: 3,
        'Net Profit': 30,
      },
      revenueBreakdown: [],
      parsedRows: [],
    });

    expect(statement.values.Tax).toBe(9);
  });
});