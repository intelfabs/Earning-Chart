const fs = require('fs');
const path = require('path');
const express = require('express');
const multer = require('multer');
const rateLimit = require('express-rate-limit');
require('dotenv').config();

const { CacheManager, buildCacheKey } = require('./cache');
const { calculateConfidence } = require('./confidence');
const {
  CANONICAL_LABELS,
  applyOverrides,
  finalizeStatement,
  hasRequiredLineItems,
  mergeStatements,
  rowsToStatement,
} = require('./mapping');
const { SecClient } = require('./secClient');
const { buildSankeyModel } = require('./sankeyBuilder');
const {
  parseHtmlIncomeStatement,
  parsePdfBuffer,
  parsePdfIncomeStatement,
} = require('./tableParser');
const {
  parseCompanyFactsIncomeStatement,
  parseXbrlInstance,
} = require('./xbrlParser');

const PUBLIC_DIR = path.join(__dirname, 'public');
const INDEX_TEMPLATE = fs.readFileSync(path.join(PUBLIC_DIR, 'index.html'), 'utf8');
const DEFAULT_TICKER = (process.env.DEFAULT_TICKER || 'INTC').toUpperCase();

function renderIndex(initialState = null) {
  const serializedState = initialState
    ? `<script>window.__INITIAL_STATE__ = ${JSON.stringify(initialState).replace(/</g, '\\u003c')};</script>`
    : '';

  return INDEX_TEMPLATE.replace('<!--__BOOTSTRAP__-->', serializedState);
}

function createStatementPayload({ company, filing, parseResult, sourceAttempted }) {
  const confidence = calculateConfidence(parseResult);
  const sankey = buildSankeyModel(parseResult.statement);

  return {
    ticker: company.ticker,
    companyName: company.companyName,
    cik: company.cik,
    filing: {
      form: filing.form,
      filingDate: filing.filingDate,
      reportDate: filing.reportDate,
      accessionNumber: filing.accessionNumber,
      primaryDocument: filing.primaryDocument,
      sourceAttempted,
    },
    sourceType: parseResult.sourceType,
    confidence,
    sankey,
    parsedRows: parseResult.parsedRows,
    statement: finalizeStatement(parseResult.statement),
    mappingOptions: CANONICAL_LABELS,
    issues: parseResult.issues,
  };
}

function chooseBestParseResult(results) {
  const scored = results
    .filter(Boolean)
    .map((result) => ({ result, confidence: calculateConfidence(result) }))
    .sort((left, right) => right.confidence.score - left.confidence.score);

  return scored[0]?.result || null;
}

function mergeParseResults(primary, secondaryResults, options = {}) {
  return secondaryResults.reduce((combined, result) => ({
    sourceType: combined.sourceType,
    statement: mergeStatements(combined.statement, result.statement),
    parsedRows: [...combined.parsedRows, ...result.parsedRows],
    issues: options.includeIssues ? [...combined.issues, ...result.issues] : combined.issues,
  }), {
    sourceType: primary.sourceType,
    statement: primary.statement,
    parsedRows: [...primary.parsedRows],
    issues: [...primary.issues],
  });
}

function resolveStatusCode(error) {
  if (Number.isInteger(error?.statusCode)) {
    return error.statusCode;
  }

  const message = String(error?.message || '').toLowerCase();
  if (message.includes('ticker is required')) {
    return 400;
  }
  if (message.includes('was not found in the sec company list')) {
    return 404;
  }
  return 500;
}

function createUploadMetadata(file) {
  return {
    ticker: 'UPLOAD',
    companyName: 'Manual Upload',
    cik: 'N/A',
    filing: {
      form: file.mimetype === 'application/pdf' ? 'PDF Upload' : 'HTML Upload',
      filingDate: new Date().toISOString().slice(0, 10),
      reportDate: null,
      accessionNumber: 'UPLOAD',
      primaryDocument: file.originalname,
      sourceAttempted: file.mimetype,
    },
  };
}

async function buildFilingPayload(ticker, dependencies) {
  const cacheKey = buildCacheKey('payload', ticker.toUpperCase());
  return dependencies.payloadCache.getOrSet(cacheKey, 24 * 60 * 60, async () => {
    const company = await dependencies.secClient.resolveTicker(ticker);
    const submissions = await dependencies.secClient.getSubmissions(company.cik);
    const filing = dependencies.secClient.findLatestRelevantFiling(submissions);
    const sources = await dependencies.secClient.getFilingSources(company, filing);
    const attempts = [];
    const sourceAttempted = [];

    try {
      const companyFacts = await dependencies.secClient.getCompanyFacts(company.cik);
      attempts.push(parseCompanyFactsIncomeStatement(companyFacts, filing));
      sourceAttempted.push('companyfacts');
    } catch (error) {
      attempts.push({ sourceType: 'xbrl-companyfacts', statement: rowsToStatement([]), parsedRows: [], issues: [`Company facts fetch failed: ${error.message}`] });
    }

    if (sources.xbrlUrl) {
      try {
        const xbrlText = await dependencies.secClient.fetchText(sources.xbrlUrl, 24 * 60 * 60);
        attempts.push(parseXbrlInstance(xbrlText));
        sourceAttempted.push('xbrl-instance');
      } catch (error) {
        attempts.push({ sourceType: 'xbrl-instance', statement: rowsToStatement([]), parsedRows: [], issues: [`XBRL instance fetch failed: ${error.message}`] });
      }
    }

    if (sources.htmlUrl) {
      try {
        const html = await dependencies.secClient.fetchText(sources.htmlUrl, 24 * 60 * 60);
        attempts.push(parseHtmlIncomeStatement(html, { sourceType: 'html' }));
        sourceAttempted.push('html');
      } catch (error) {
        attempts.push({ sourceType: 'html', statement: rowsToStatement([]), parsedRows: [], issues: [`HTML filing fetch failed: ${error.message}`] });
      }
    }

    if (sources.pdfUrl) {
      try {
        const pdfBuffer = await dependencies.secClient.fetchBuffer(sources.pdfUrl, 24 * 60 * 60);
        attempts.push(await parsePdfBuffer(pdfBuffer, { sourceType: 'pdf', fileName: 'filing.pdf' }));
        sourceAttempted.push('pdf');
      } catch (error) {
        attempts.push({ sourceType: 'pdf', statement: rowsToStatement([]), parsedRows: [], issues: [`PDF filing fetch failed: ${error.message}`] });
      }
    }

    const best = chooseBestParseResult(attempts);
    if (!best) {
      throw new Error('Unable to parse the latest SEC filing into an income statement.');
    }

    const supplementalAttempts = attempts.filter((result) => result !== best);
    const enrichedBest = mergeParseResults(best, supplementalAttempts, { includeIssues: false });
    const mergedWithIssues = mergeParseResults(best, supplementalAttempts, { includeIssues: true });

    const selected = hasRequiredLineItems(best.statement)
      ? enrichedBest
      : calculateConfidence(mergedWithIssues).score > calculateConfidence(enrichedBest).score
        ? mergedWithIssues
        : enrichedBest;
    const payload = createStatementPayload({
      company,
      filing,
      parseResult: selected,
      sourceAttempted,
    });

    console.info(`[income-flows] ${company.ticker} confidence=${payload.confidence.score} source=${payload.sourceType}`);
    return payload;
  });
}

function createApp(options = {}) {
  const app = express();
  const secClient = options.secClient || new SecClient();
  const payloadCache = options.payloadCache || new CacheManager();
  const dependencies = { secClient, payloadCache };
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

  app.set('json spaces', 2);
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true }));
  app.use('/assets/plotly', express.static(path.join(__dirname, 'node_modules', 'plotly.js-dist-min')));
  app.use(express.static(PUBLIC_DIR, { index: false }));

  const apiLimiter = rateLimit({
    windowMs: Number(process.env.APP_RATE_LIMIT_WINDOW_MS || 15 * 60 * 1000),
    max: Number(process.env.APP_RATE_LIMIT_MAX || 60),
    standardHeaders: true,
    legacyHeaders: false,
  });

  app.get('/health', (_request, response) => {
    response.json({ ok: true });
  });

  app.get('/', async (_request, response) => {
    try {
      const payload = await buildFilingPayload(DEFAULT_TICKER, dependencies);
      response.type('html').send(renderIndex({ ok: true, payload }));
    } catch (error) {
      response.status(resolveStatusCode(error)).type('html').send(renderIndex({
        ok: false,
        error: error.message,
      }));
    }
  });

  app.get('/sankey', async (request, response) => {
    const ticker = String(request.query.ticker || DEFAULT_TICKER);

    try {
      const payload = await buildFilingPayload(ticker, dependencies);
      response.type('html').send(renderIndex({ ok: true, payload }));
    } catch (error) {
      response.status(resolveStatusCode(error)).type('html').send(renderIndex({
        ok: false,
        error: error.message,
      }));
    }
  });

  app.get('/api/sankey-data', apiLimiter, async (request, response) => {
    try {
      const payload = await buildFilingPayload(String(request.query.ticker || ''), dependencies);
      response.json({ ok: true, payload });
    } catch (error) {
      response.status(resolveStatusCode(error)).json({ ok: false, error: error.message });
    }
  });

  app.post('/api/rebuild', apiLimiter, (request, response) => {
    try {
      const parsedRows = Array.isArray(request.body.parsedRows) ? request.body.parsedRows : [];
      const overrides = request.body.overrides || {};
      const remappedRows = applyOverrides(parsedRows, overrides);
      const statement = rowsToStatement(remappedRows);
      const parseResult = {
        sourceType: request.body.sourceType || 'html',
        statement,
        parsedRows: remappedRows,
        issues: [],
      };

      response.json({
        ok: true,
        sankey: buildSankeyModel(statement),
        statement: finalizeStatement(statement),
        parsedRows: remappedRows,
        confidence: calculateConfidence(parseResult),
        issues: parseResult.issues,
      });
    } catch (error) {
      response.status(400).json({ ok: false, error: error.message });
    }
  });

  app.post('/api/upload', apiLimiter, upload.single('filing'), async (request, response) => {
    if (!request.file) {
      response.status(400).json({ ok: false, error: 'Upload a filing HTML or PDF file.' });
      return;
    }

    try {
      let parseResult;
      if (request.file.mimetype === 'application/pdf' || request.file.originalname.toLowerCase().endsWith('.pdf')) {
        parseResult = await parsePdfBuffer(request.file.buffer, { sourceType: 'upload-pdf', fileName: request.file.originalname });
      } else {
        parseResult = parseHtmlIncomeStatement(request.file.buffer.toString('utf8'), { sourceType: 'upload-html' });
      }

      const metadata = createUploadMetadata(request.file);
      const payload = {
        ...metadata,
        sourceType: parseResult.sourceType,
        confidence: calculateConfidence(parseResult),
        sankey: buildSankeyModel(parseResult.statement),
        parsedRows: parseResult.parsedRows,
        statement: finalizeStatement(parseResult.statement),
        mappingOptions: CANONICAL_LABELS,
        issues: parseResult.issues,
      };

      response.json({ ok: true, payload });
    } catch (error) {
      response.status(500).json({ ok: false, error: error.message });
    }
  });

  app.use((error, _request, response, _next) => {
    response.status(500).json({ ok: false, error: error.message });
  });

  return app;
}

if (require.main === module) {
  const app = createApp();
  const port = Number(process.env.PORT || 3000);
  app.listen(port, () => {
    console.info(`Income Flows listening on http://localhost:${port}`);
  });
}

module.exports = {
  buildFilingPayload,
  createApp,
};