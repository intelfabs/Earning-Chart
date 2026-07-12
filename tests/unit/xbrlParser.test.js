const fixture = require('../fixtures/companyfacts-aapl.json');
const { parseCompanyFactsIncomeStatement } = require('../../xbrlParser');

describe('parseCompanyFactsIncomeStatement', () => {
  it('extracts required income statement values', () => {
    const result = parseCompanyFactsIncomeStatement(fixture, {
      accessionNumber: '0000320193-26-000010',
      filingDate: '2026-08-01',
      reportDate: '2026-06-28',
      form: '10-Q',
    });

    expect(result.statement.values['Total Revenue']).toBe(94036000000);
    expect(result.statement.values['Cost of Revenue']).toBe(51749000000);
    expect(result.statement.values['Gross Profit']).toBe(42287000000);
    expect(result.statement.values['Operating Profit']).toBe(27800000000);
    expect(result.statement.values.Tax).toBe(4200000000);
    expect(result.statement.values['Net Profit']).toBe(23600000000);
  });
});