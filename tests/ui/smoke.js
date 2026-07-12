const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const { chromium } = require('playwright');
const fixture = require('../fixtures/companyfacts-aapl.json');
const { createApp } = require('../../server');

function createMockSecClient(htmlFixture) {
  return {
    async resolveTicker(ticker) {
      return {
        ticker: String(ticker).toUpperCase(),
        companyName: 'Apple Inc.',
        cik: '0000320193',
        cikNumeric: '320193',
      };
    },

    async getSubmissions() {
      return {};
    },

    findLatestRelevantFiling() {
      return {
        form: '10-Q',
        accessionNumber: '0000320193-26-000010',
        primaryDocument: 'aapl-20260628x10q.htm',
        filingDate: '2026-08-01',
        reportDate: '2026-06-28',
      };
    },

    async getFilingSources() {
      return {
        htmlUrl: 'https://example.test/aapl-10q.html',
        pdfUrl: null,
        xbrlUrl: null,
      };
    },

    async getCompanyFacts() {
      return fixture;
    },

    async fetchText(url) {
      if (url.endsWith('.html')) {
        return htmlFixture;
      }
      throw new Error(`Unexpected fixture URL: ${url}`);
    },
  };
}

async function startFixtureServer() {
  if (process.env.UI_SMOKE_URL) {
    return {
      baseUrl: process.env.UI_SMOKE_URL.replace(/\/$/, ''),
      close: async () => {},
    };
  }

  const htmlFixture = await fs.readFile(path.join(__dirname, '..', 'fixtures', 'apple-income-statement.html'), 'utf8');
  const app = createApp({ secClient: createMockSecClient(htmlFixture) });
  const server = await new Promise((resolve) => {
    const instance = app.listen(0, () => resolve(instance));
  });

  return {
    baseUrl: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

async function ensureButtonEnabled(page, selector) {
  await page.waitForFunction(
    (buttonSelector) => {
      const button = document.querySelector(buttonSelector);
      return Boolean(button && !button.disabled);
    },
    selector,
  );
}

async function ensureChartReady(page) {
  await page.waitForFunction(
    () => {
      const chart = document.getElementById('chart');
      const title = document.getElementById('chart-title');
      const loader = document.getElementById('chart-loading');
      return Boolean(
        chart
        && title
        && title.textContent.includes('Income Statement Flow')
        && !chart.textContent.includes('No chart available')
        && loader
        && loader.classList.contains('hidden'),
      );
    },
    { timeout: 30000 },
  );
  await ensureButtonEnabled(page, '#download-png-button');
}

async function assertNoVisibleAnnotationOverlap(page) {
  const overlaps = await page.evaluate(() => {
    const annotations = Array.from(document.querySelectorAll('#chart .annotation'));
    const boxes = annotations
      .map((annotation) => {
        const rect = annotation.getBoundingClientRect();
        return {
          text: annotation.textContent.replace(/\s+/g, ' ').trim(),
          left: rect.left,
          right: rect.right,
          top: rect.top,
          bottom: rect.bottom,
        };
      });

    const hits = [];
    for (let outer = 0; outer < boxes.length; outer += 1) {
      for (let inner = outer + 1; inner < boxes.length; inner += 1) {
        const left = Math.max(boxes[outer].left, boxes[inner].left);
        const right = Math.min(boxes[outer].right, boxes[inner].right);
        const top = Math.max(boxes[outer].top, boxes[inner].top);
        const bottom = Math.min(boxes[outer].bottom, boxes[inner].bottom);
        if (right - left > 2 && bottom - top > 2) {
          hits.push(`${boxes[outer].text} overlaps ${boxes[inner].text}`);
        }
      }
    }
    return hits;
  });

  if (overlaps.length > 0) {
    throw new Error(`Visible chart annotations overlap: ${overlaps.join('; ')}`);
  }
}

async function assertFileLooksValid(filePath, expectations) {
  const stats = await fs.stat(filePath);
  if (stats.size <= 1024) {
    throw new Error(`${path.basename(filePath)} is unexpectedly small (${stats.size} bytes).`);
  }

  if (expectations.format === 'svg') {
    const text = await fs.readFile(filePath, 'utf8');
    if (!text.includes('<svg')) {
      throw new Error('SVG download did not contain an <svg> root element.');
    }
  } else {
    const buffer = await fs.readFile(filePath);
    const signature = buffer.subarray(0, 8).toString('hex');
    if (signature !== '89504e470d0a1a0a') {
      throw new Error('PNG download did not start with a PNG signature.');
    }
  }
}

async function run() {
  const fixtureServer = await startFixtureServer();
  const browser = await chromium.launch({ headless: true });
  const downloadDir = await fs.mkdtemp(path.join(os.tmpdir(), 'earning-chart-ui-'));
  const context = await browser.newContext({
    acceptDownloads: true,
    viewport: { width: 1440, height: 1400 },
  });

  await context.addInitScript(() => {
    window.__pageErrors = [];
    window.__clipboardWrites = [];
    class ClipboardItemShim {
      constructor(items) {
        this.items = items;
        this.types = Object.keys(items);
      }
    }

    window.ClipboardItem = ClipboardItemShim;

    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        write: async (items) => {
          const formats = items.map((entry) => {
            if (entry.items) {
              return Object.keys(entry.items);
            }
            if (entry.types) {
              return Array.from(entry.types);
            }
            return Object.keys(entry);
          });
          window.__clipboardWrites.push(formats);
        },
      },
    });
  });

  const page = await context.newPage();
  const browserErrors = [];
  page.on('pageerror', (error) => {
    browserErrors.push(error.message);
    console.error('Page error:', error.message);
  });
  page.on('console', (message) => {
    if (message.type() === 'error') {
      browserErrors.push(message.text());
      console.error('Console error:', message.text());
    }
  });
  try {
    await page.goto(`${fixtureServer.baseUrl}/sankey?ticker=AAPL`, { waitUntil: 'networkidle' });
    await ensureChartReady(page);

    await page.click('[data-ticker="MSFT"]');
    await page.waitForFunction(() => document.getElementById('ticker-input').value === 'MSFT');
    await ensureChartReady(page);

    const pngDownloadPromise = page.waitForEvent('download');
    await page.click('#download-png-button');
    const pngDownload = await pngDownloadPromise;
    const pngPath = path.join(downloadDir, 'chart.png');
    await pngDownload.saveAs(pngPath);
    await assertFileLooksValid(pngPath, { format: 'png' });

    const svgDownloadPromise = page.waitForEvent('download');
    await page.click('#download-svg-button');
    const svgDownload = await svgDownloadPromise;
    const svgPath = path.join(downloadDir, 'chart.svg');
    await svgDownload.saveAs(svgPath);
    await assertFileLooksValid(svgPath, { format: 'svg' });

    await page.click('#copy-button');
    await page.waitForFunction(() => Array.isArray(window.__clipboardWrites) && window.__clipboardWrites.length > 0);
    const clipboardFormats = await page.evaluate(() => window.__clipboardWrites.at(-1));
    if (!clipboardFormats.flat().includes('image/png')) {
      throw new Error('Copy action did not attempt to write an image/png clipboard payload.');
    }

    await page.click('#edit-mapping-button');
    await page.waitForSelector('#mapping-modal:not(.hidden)');
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => document.getElementById('mapping-modal')?.classList.contains('hidden'));

    const desktopScreenshotPath = path.join(downloadDir, 'desktop-ui.png');
    await page.screenshot({ path: desktopScreenshotPath, fullPage: true });

    await page.setViewportSize({ width: 390, height: 1000 });
    await ensureChartReady(page);
    await assertNoVisibleAnnotationOverlap(page);
    const mobileScreenshotPath = path.join(downloadDir, 'mobile-ui.png');
    await page.screenshot({ path: mobileScreenshotPath, fullPage: true });

    if (browserErrors.length > 0) {
      throw new Error(`Browser errors were reported: ${browserErrors.join('; ')}`);
    }

    console.log(`UI smoke passed. Artifacts: ${downloadDir}`);
  } finally {
    await browser.close();
    await fixtureServer.close();
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
