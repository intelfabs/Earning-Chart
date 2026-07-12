const fs = require('fs');
const path = require('path');
const request = require('supertest');
const fixture = require('../fixtures/companyfacts-aapl.json');
const { createApp } = require('../../server');
const { SEC_RATE_LIMIT_MESSAGE } = require('../../secClient');

const htmlFixture = fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'apple-income-statement.html'), 'utf8');

class MockSecClient {
  async resolveTicker(ticker) {
    return {
      ticker: String(ticker).toUpperCase(),
      companyName: 'Apple Inc.',
      cik: '0000320193',
      cikNumeric: '320193',
    };
  }

  async getSubmissions() {
    return {};
  }

  findLatestRelevantFiling() {
    return {
      form: '10-Q',
      accessionNumber: '0000320193-26-000010',
      primaryDocument: 'aapl-20260628x10q.htm',
      filingDate: '2026-08-01',
      reportDate: '2026-06-28',
    };
  }

  async getFilingSources() {
    return {
      htmlUrl: 'https://example.test/aapl-10q.html',
      pdfUrl: null,
      xbrlUrl: null,
    };
  }

  async getCompanyFacts() {
    return fixture;
  }

  async fetchText(url) {
    if (url.endsWith('.html')) {
      return htmlFixture;
    }
    throw new Error('Unexpected URL');
  }
}

class ThrottledSecClient {
  async resolveTicker() {
    const error = new Error(SEC_RATE_LIMIT_MESSAGE);
    error.statusCode = 503;
    throw error;
  }
}

describe('GET /sankey?ticker=XXX', () => {
  it('defaults to INTC on the landing page and empty sankey route', async () => {
    const app = createApp({ secClient: new MockSecClient() });
    const rootResponse = await request(app).get('/');
    const sankeyResponse = await request(app).get('/sankey');

    expect(rootResponse.status).toBe(200);
    expect(rootResponse.text).toContain('"ticker":"INTC"');
    expect(sankeyResponse.status).toBe(200);
    expect(sankeyResponse.text).toContain('"ticker":"INTC"');
  });

  it('returns an HTML page with an embedded sankey payload', async () => {
    const app = createApp({ secClient: new MockSecClient() });
    const response = await request(app).get('/sankey?ticker=AAPL');

    expect(response.status).toBe(200);
    expect(response.text).toContain('"companyName":"Apple Inc."');
    expect(response.text).toContain('Total Revenue');
    expect(response.text).toContain('Net Profit');
  });

  it('returns a JSON payload for the client data endpoint', async () => {
    const app = createApp({ secClient: new MockSecClient() });
    const response = await request(app).get('/api/sankey-data?ticker=AAPL');

    expect(response.status).toBe(200);
    expect(response.body.ok).toBe(true);
    expect(response.body.payload.sankey.labels).toEqual(expect.arrayContaining([
      'Total Revenue',
      'Cost of Revenue',
      'Gross Profit',
      'Operating Profit',
      'Tax',
      'Net Profit',
    ]));
  });

  it('returns a retryable error when the SEC rate threshold is exceeded', async () => {
    const app = createApp({ secClient: new ThrottledSecClient() });
    const response = await request(app).get('/api/sankey-data?ticker=AAPL');

    expect(response.status).toBe(503);
    expect(response.body).toEqual({
      ok: false,
      error: SEC_RATE_LIMIT_MESSAGE,
    });
  });
});