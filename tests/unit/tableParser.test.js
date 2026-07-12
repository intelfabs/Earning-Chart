const fs = require('fs');
const path = require('path');
const { parseHtmlIncomeStatement } = require('../../tableParser');

describe('parseHtmlIncomeStatement', () => {
  it('reads a consolidated statements table and normalizes values', () => {
    const html = fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'apple-income-statement.html'), 'utf8');
    const result = parseHtmlIncomeStatement(html);

    expect(result.parsedRows.length).toBeGreaterThan(5);
    expect(result.statement.values['Total Revenue']).toBe(94036000000);
    expect(result.statement.values['Cost of Revenue']).toBe(51749000000);
    expect(result.statement.values['Gross Profit']).toBe(42287000000);
  });

  it('extracts revenue segments without pulling in cost rows from earnings exhibits', () => {
    const html = `
      <html>
        <body>
          <h2>Alphabet Financial Highlights</h2>
          <p>(In millions)</p>
          <table>
            <tbody>
              <tr><td>Google Search &amp; other</td><td>50,702</td><td>60,399</td></tr>
              <tr><td>YouTube ads</td><td>8,927</td><td>9,883</td></tr>
              <tr><td>Google Network</td><td>7,256</td><td>6,971</td></tr>
              <tr><td>Google subscriptions, platforms, and devices</td><td>10,379</td><td>12,384</td></tr>
              <tr><td>Google Cloud</td><td>12,260</td><td>20,028</td></tr>
              <tr><td>Other Bets</td><td>450</td><td>411</td></tr>
              <tr><td>Total Google Cloud costs and expenses</td><td>10,083</td><td>13,430</td></tr>
              <tr><td>Revenues</td><td>89,974</td><td>109,876</td></tr>
              <tr><td>Cost of revenues</td><td>40,000</td><td>52,200</td></tr>
              <tr><td>Operating income</td><td>19,500</td><td>27,200</td></tr>
              <tr><td>Net income</td><td>15,000</td><td>22,100</td></tr>
            </tbody>
          </table>
        </body>
      </html>
    `;

    const result = parseHtmlIncomeStatement(html);
    const breakdownLabels = result.statement.revenueBreakdown.map((item) => item.label);

    expect(breakdownLabels).toEqual(expect.arrayContaining([
      'Google Search & other',
      'YouTube ads',
      'Google Network',
      'Google subscriptions, platforms, and devices',
      'Google Cloud',
      'Other Bets',
    ]));
    expect(breakdownLabels).not.toContain('Total Google Cloud costs and expenses');
  });
});