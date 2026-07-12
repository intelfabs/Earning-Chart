const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const cheerio = require('cheerio');
const tabula = require('tabula-js');
const {
  detectScaleHint,
  normalizeLabel,
  parseNumericValue,
  rowsToStatement,
  simplifyLabel,
} = require('./mapping');

const REVENUE_SEGMENT_HINTS = [
  /google search/i,
  /youtube/i,
  /google network/i,
  /google subscriptions/i,
  /google cloud/i,
  /other bets/i,
  /client computing group/i,
  /data center and ai/i,
  /network and edge/i,
  /mobileye/i,
  /intel foundry/i,
];

function matchesSegmentHint(label) {
  return REVENUE_SEGMENT_HINTS.some((pattern) => pattern.test(label));
}

function isCostOrExpenseLabel(label) {
  return /cost|expense|expenses|loss|operating income|operating loss/i.test(label);
}

function extractBestNumericCell(cells, scale, preferLast = false) {
  const orderedCells = preferLast ? [...cells].reverse() : cells;
  for (const cell of orderedCells) {
    const value = parseNumericValue(cell, scale);
    if (value != null) {
      return { value, rawValue: cell };
    }
  }

  return { value: null, rawValue: null };
}

function extractRevenueBreakdownRows(tableRows, scale, source) {
  return tableRows
    .map((cells, index) => {
      const label = String(cells[0] || '').replace(/\s+/g, ' ').trim();
      if (!matchesSegmentHint(label) || isCostOrExpenseLabel(label)) {
        return null;
      }

      const { value, rawValue } = extractBestNumericCell(cells.slice(1), scale, true);
      if (value == null || value <= 0) {
        return null;
      }

      return {
        id: `${source}-segment-${index + 1}`,
        originalLabel: label,
        canonicalLabel: 'Product Revenue',
        value: value * 1,
        rawValue,
        source,
      };
    })
    .filter(Boolean);
}

function splitCsvLine(line) {
  const matches = String(line || '').match(/("(?:[^"]|"")*"|[^,]+)/g) || [];
  return matches.map((part) => part.replace(/^"|"$/g, '').replace(/""/g, '"').trim());
}

function extractNumericCell(cells, scale) {
  for (const cell of cells) {
    const value = parseNumericValue(cell, scale);
    if (value != null) {
      return { value, rawValue: cell };
    }
  }

  return { value: null, rawValue: null };
}

function scoreTable(headingText, rows) {
  const keywordScore = /income|operations|earnings|results|statement/.test(headingText.toLowerCase()) ? 4 : 0;
  const mappedScore = rows.filter((row) => row.canonicalLabel && row.value != null).length * 2;
  return keywordScore + mappedScore;
}

function normalizeRows(rows, source) {
  return rows
    .filter((row) => row && row.originalLabel)
    .map((row, index) => ({
      id: row.id || `${source}-${index + 1}`,
      originalLabel: row.originalLabel,
      canonicalLabel: row.canonicalLabel || normalizeLabel(row.originalLabel) || 'Ignore',
      value: row.value,
      rawValue: row.rawValue,
      source,
    }))
    .filter((row) => row.value != null || row.canonicalLabel !== 'Ignore');
}

function buildRowsFromCells(cellRows, scale, source) {
  return normalizeRows(
    cellRows.map((cells) => {
      const [labelCell, ...valueCells] = cells;
      const label = String(labelCell || '').replace(/\s+/g, ' ').trim();
      if (!label) {
        return null;
      }

      const { value, rawValue } = extractNumericCell(valueCells, scale);
      if (value == null) {
        return null;
      }

      return {
        originalLabel: label,
        canonicalLabel: normalizeLabel(label) || 'Ignore',
        value,
        rawValue,
      };
    }),
    source,
  );
}

function parseHtmlIncomeStatement(htmlText, options = {}) {
  const $ = cheerio.load(htmlText);
  const scale = detectScaleHint($.root().text());
  const tableResults = [];
  const revenueBreakdownCandidates = [];

  $('table').each((tableIndex, tableElement) => {
    const table = $(tableElement);
    const headingText = table.prevAll('h1, h2, h3, strong, p, div').slice(0, 3).text().replace(/\s+/g, ' ').trim();
    const rows = [];

    table.find('tr').each((rowIndex, rowElement) => {
      const cells = $(rowElement)
        .find('th, td')
        .map((_, cell) => $(cell).text().replace(/\s+/g, ' ').trim())
        .get()
        .filter(Boolean);

      if (cells.length < 2) {
        return;
      }

      rows.push(cells);
    });

    const normalizedRows = buildRowsFromCells(rows, scale, `html-table-${tableIndex + 1}`);
    const breakdownRows = extractRevenueBreakdownRows(rows, scale, `html-table-${tableIndex + 1}`);
    if (breakdownRows.length > 0) {
      revenueBreakdownCandidates.push(...breakdownRows);
    }
    tableResults.push({
      headingText,
      rows: normalizedRows,
      score: scoreTable(headingText, normalizedRows),
    });
  });

  const bestTable = tableResults.sort((left, right) => right.score - left.score)[0];
  if (!bestTable || bestTable.score <= 0) {
    return {
      sourceType: options.sourceType || 'html',
      statement: rowsToStatement([]),
      parsedRows: [],
      issues: ['No likely income statement table was found in the HTML filing.'],
    };
  }

  const statement = rowsToStatement([...bestTable.rows, ...revenueBreakdownCandidates]);
  return {
    sourceType: options.sourceType || 'html',
    statement,
    parsedRows: [...bestTable.rows, ...revenueBreakdownCandidates],
    issues: [],
    tableHeading: bestTable.headingText,
  };
}

function parseCsvRows(csvRows, source = 'pdf') {
  const scale = detectScaleHint(csvRows.join(' '));
  const cellRows = csvRows
    .map(splitCsvLine)
    .filter((cells) => cells.length >= 2);

  const parsedRows = buildRowsFromCells(cellRows, scale, source);
  return {
    sourceType: source,
    statement: rowsToStatement(parsedRows),
    parsedRows,
    issues: parsedRows.length === 0 ? ['No numeric table rows were extracted from the PDF.'] : [],
  };
}

async function extractTabulaCsv(filePath, options = {}) {
  return new Promise((resolve, reject) => {
    tabula(filePath, {
      pages: options.pages || '1',
      guess: options.guess !== false,
      spreadsheet: Boolean(options.spreadsheet),
      silent: true,
    }).extractCsv((error, rows) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(rows || []);
    });
  });
}

async function parsePdfIncomeStatement(filePath, options = {}) {
  try {
    let rows = await extractTabulaCsv(filePath, { guess: true, spreadsheet: false });
    let parsed = parseCsvRows(rows, options.sourceType || 'pdf');

    if (parsed.parsedRows.length === 0) {
      rows = await extractTabulaCsv(filePath, { guess: true, spreadsheet: true });
      parsed = parseCsvRows(rows, options.sourceType || 'pdf');
    }

    if (parsed.parsedRows.length === 0) {
      parsed.issues.push('Tabula did not extract a usable table. Verify that Java and tabula-java are available.');
    }

    return parsed;
  } catch (error) {
    return {
      sourceType: options.sourceType || 'pdf',
      statement: rowsToStatement([]),
      parsedRows: [],
      issues: [`PDF extraction failed: ${error.message}`],
    };
  }
}

async function parsePdfBuffer(pdfBuffer, options = {}) {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'earning-chart-'));
  const tempPath = path.join(tempDir, options.fileName || 'upload.pdf');

  try {
    await fs.writeFile(tempPath, pdfBuffer);
    return await parsePdfIncomeStatement(tempPath, options);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

module.exports = {
  parseCsvRows,
  parseHtmlIncomeStatement,
  parsePdfBuffer,
  parsePdfIncomeStatement,
};