const axios = require('axios');
const { CacheManager, buildCacheKey } = require('./cache');

const DEFAULT_SEC_USER_AGENT = 'EarningChartt/1.0 admin@example.com';
const SEC_RATE_LIMIT_MESSAGE = 'SEC rejected the request because the request rate threshold was exceeded. Wait a few minutes and try again, or increase SEC_MIN_INTERVAL_MS to slow automated requests.';

function normalizeAccession(accessionNumber) {
  return String(accessionNumber || '').replace(/-/g, '');
}

function isPlaceholderUserAgent(userAgent) {
  const normalized = String(userAgent || '').trim();
  return !normalized || normalized === DEFAULT_SEC_USER_AGENT;
}

function normalizeSecRequestError(error) {
  const statusCode = Number(error?.response?.status);
  const responseBody = String(error?.response?.data || '');

  if (statusCode === 403 && /request rate threshold exceeded/i.test(responseBody)) {
    const secError = new Error(SEC_RATE_LIMIT_MESSAGE);
    secError.statusCode = 503;
    secError.cause = error;
    return secError;
  }

  return error;
}

class SecClient {
  constructor(options = {}) {
    this.baseSecUrl = options.baseSecUrl || 'https://www.sec.gov';
    this.baseDataUrl = options.baseDataUrl || 'https://data.sec.gov';
    this.userAgent = String(options.userAgent || process.env.SEC_USER_AGENT || DEFAULT_SEC_USER_AGENT).trim();
    this.cache = options.cache || new CacheManager(Number(process.env.SEC_CACHE_TTL_SECONDS || 24 * 60 * 60));
    this.minIntervalMs = Number(options.minIntervalMs || process.env.SEC_MIN_INTERVAL_MS || 150);
    this.lastRequestAt = 0;
    this.http = options.http || axios.create({
      timeout: Number(process.env.SEC_HTTP_TIMEOUT_MS || 20_000),
      headers: {
        'User-Agent': this.userAgent,
        Accept: 'application/json,text/html,application/xml,application/pdf;q=0.9,*/*;q=0.8',
      },
    });
  }

  async enforceRateLimit() {
    const now = Date.now();
    const waitTime = Math.max(0, this.minIntervalMs - (now - this.lastRequestAt));
    if (waitTime > 0) {
      await new Promise((resolve) => setTimeout(resolve, waitTime));
    }
    this.lastRequestAt = Date.now();
  }

  async fetchCached(cacheKey, fetcher, ttlSeconds) {
    return this.cache.getOrSet(cacheKey, ttlSeconds, async () => {
      if (isPlaceholderUserAgent(this.userAgent)) {
        throw new Error('Set SEC_USER_AGENT to a real application name and contact email before making SEC requests.');
      }
      await this.enforceRateLimit();
      return fetcher();
    });
  }

  async fetchJson(url, ttlSeconds) {
    return this.fetchCached(buildCacheKey('json', url), async () => {
      try {
        const response = await this.http.get(url, { responseType: 'json' });
        return response.data;
      } catch (error) {
        throw normalizeSecRequestError(error);
      }
    }, ttlSeconds);
  }

  async fetchText(url, ttlSeconds) {
    return this.fetchCached(buildCacheKey('text', url), async () => {
      try {
        const response = await this.http.get(url, { responseType: 'text' });
        return response.data;
      } catch (error) {
        throw normalizeSecRequestError(error);
      }
    }, ttlSeconds);
  }

  async fetchBuffer(url, ttlSeconds) {
    return this.fetchCached(buildCacheKey('buffer', url), async () => {
      try {
        const response = await this.http.get(url, { responseType: 'arraybuffer' });
        return Buffer.from(response.data);
      } catch (error) {
        throw normalizeSecRequestError(error);
      }
    }, ttlSeconds);
  }

  async resolveTicker(ticker) {
    const normalizedTicker = String(ticker || '').trim().toUpperCase();
    if (!normalizedTicker) {
      throw new Error('Ticker is required.');
    }

    const companies = await this.fetchJson(`${this.baseSecUrl}/files/company_tickers.json`, 24 * 60 * 60);
    const match = Object.values(companies).find((company) => String(company.ticker || '').toUpperCase() === normalizedTicker);
    if (!match) {
      throw new Error(`Ticker ${normalizedTicker} was not found in the SEC company list.`);
    }

    return {
      ticker: normalizedTicker,
      companyName: match.title,
      cik: String(match.cik_str).padStart(10, '0'),
      cikNumeric: String(Number(match.cik_str)),
    };
  }

  async getCompanyFacts(cik) {
    return this.fetchJson(`${this.baseDataUrl}/api/xbrl/companyfacts/CIK${cik}.json`, 24 * 60 * 60);
  }

  async getSubmissions(cik) {
    return this.fetchJson(`${this.baseDataUrl}/submissions/CIK${cik}.json`, 24 * 60 * 60);
  }

  findLatestRelevantFiling(submissions) {
    const recent = submissions?.filings?.recent;
    if (!recent?.form?.length) {
      throw new Error('SEC submissions feed did not include recent filings.');
    }

    const filings = recent.form.map((form, index) => ({
      form,
      accessionNumber: recent.accessionNumber[index],
      primaryDocument: recent.primaryDocument[index],
      primaryDocDescription: recent.primaryDocDescription[index],
      filingDate: recent.filingDate[index],
      reportDate: recent.reportDate[index],
      items: recent.items?.[index],
      acceptanceDateTime: recent.acceptanceDateTime?.[index],
    }));

    const isEarnings8K = (filing) => {
      const text = `${filing.primaryDocDescription || ''} ${filing.items || ''}`.toLowerCase();
      return filing.form === '8-K' && (text.includes('2.02') || text.includes('earnings') || text.includes('results of operations'));
    };

    const isQuarterly = (filing) => filing.form === '10-Q';
    const isAnnual = (filing) => filing.form === '10-K';

    return filings.find(isQuarterly)
      || filings.find(isEarnings8K)
      || filings.find(isAnnual)
      || filings[0];
  }

  async getFilingIndex(cikNumeric, accessionNumber) {
    const accessionPlain = normalizeAccession(accessionNumber);
    return this.fetchJson(`${this.baseSecUrl}/Archives/edgar/data/${cikNumeric}/${accessionPlain}/index.json`, 24 * 60 * 60);
  }

  async getFilingSources(company, filing) {
    const index = await this.getFilingIndex(company.cikNumeric, filing.accessionNumber);
    const items = index?.directory?.item || [];
    const accessionPlain = normalizeAccession(filing.accessionNumber);
    const basePath = `${this.baseSecUrl}/Archives/edgar/data/${company.cikNumeric}/${accessionPlain}`;

    const isExhibit991 = (item) => /99\.1|exhibit991|ex99|ex-99/i.test(item.name || '');
    const htmlDocument = (filing.form === '8-K'
      ? items.find((item) => /\.html?$/i.test(item.name) && isExhibit991(item))
      : null)
      || items.find((item) => /\.html?$/.test(item.name) && item.name.toLowerCase() === String(filing.primaryDocument || '').toLowerCase())
      || items.find((item) => /\.html?$/.test(item.name));
    const pdfDocument = items.find((item) => isExhibit991(item) && /\.pdf$/i.test(item.name))
      || items.find((item) => /\.pdf$/i.test(item.name));
    const xbrlDocument = items.find((item) => /instance|_htm\.xml|\.xml$/i.test(item.name) && !/index\.xml$/i.test(item.name));

    return {
      htmlUrl: htmlDocument ? `${basePath}/${htmlDocument.name}` : null,
      pdfUrl: pdfDocument ? `${basePath}/${pdfDocument.name}` : null,
      xbrlUrl: xbrlDocument ? `${basePath}/${xbrlDocument.name}` : null,
      index,
    };
  }
}

module.exports = {
  DEFAULT_SEC_USER_AGENT,
  SEC_RATE_LIMIT_MESSAGE,
  SecClient,
  isPlaceholderUserAgent,
  normalizeSecRequestError,
  normalizeAccession,
};