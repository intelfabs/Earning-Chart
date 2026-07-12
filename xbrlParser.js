const { XMLParser } = require('fast-xml-parser');
const {
  finalizeStatement,
  parseNumericValue,
} = require('./mapping');

const CONCEPTS = {
  'Total Revenue': [
    'RevenueFromContractWithCustomerExcludingAssessedTax',
    'SalesRevenueNet',
    'Revenues',
    'RevenueFromContractWithCustomerIncludingAssessedTax',
  ],
  'Cost of Revenue': [
    'CostOfRevenue',
    'CostOfGoodsSold',
    'CostOfGoodsAndServicesSold',
    'CostOfSales',
  ],
  'Gross Profit': ['GrossProfit'],
  'R&D': ['ResearchAndDevelopmentExpense'],
  'SG&A': ['SellingGeneralAndAdministrativeExpense'],
  'Operating Expenses': ['OperatingExpenses'],
  'Operating Profit': ['OperatingIncomeLoss'],
  Tax: ['IncomeTaxExpenseBenefit'],
  Other: [
    'OtherNonoperatingIncomeExpense',
    'NonoperatingIncomeExpense',
    'InterestAndOtherIncomeExpense',
  ],
  'Net Profit': ['NetIncomeLoss'],
};

function normalizeAccession(value) {
  return String(value || '').replace(/-/g, '');
}

function flattenUnitEntries(units) {
  return Object.values(units || {}).flatMap((entries) => entries || []);
}

function scoreFact(entry, filingInfo) {
  let score = 0;

  if (filingInfo.accessionNumber && normalizeAccession(entry.accn) === normalizeAccession(filingInfo.accessionNumber)) {
    score += 8;
  }
  if (filingInfo.filingDate && entry.filed === filingInfo.filingDate) {
    score += 4;
  }
  if (filingInfo.reportDate && entry.end === filingInfo.reportDate) {
    score += 4;
  }
  if (filingInfo.form && entry.form === filingInfo.form) {
    score += 2;
  }
  if (entry.start && entry.end) {
    score += 1;
  }

  return score;
}

function pickBestFact(entries, filingInfo) {
  return [...entries]
    .sort((left, right) => {
      const scoreDelta = scoreFact(right, filingInfo) - scoreFact(left, filingInfo);
      if (scoreDelta !== 0) {
        return scoreDelta;
      }

      const rightDate = right.end || right.filed || '';
      const leftDate = left.end || left.filed || '';
      return rightDate.localeCompare(leftDate);
    })[0];
}

function parseCompanyFactsIncomeStatement(companyFacts, filingInfo = {}) {
  const factsByNamespace = companyFacts?.facts || {};
  const statement = {
    values: {
      'Total Revenue': null,
      'Cost of Revenue': null,
      'Gross Profit': null,
      'R&D': null,
      'SG&A': null,
      'Operating Expenses': null,
      'Operating Profit': null,
      Tax: null,
      Other: null,
      'Net Profit': null,
    },
    revenueBreakdown: [],
    parsedRows: [],
  };

  Object.entries(CONCEPTS).forEach(([canonicalLabel, conceptNames]) => {
    const candidates = [];

    Object.entries(factsByNamespace).forEach(([namespace, namespaceFacts]) => {
      conceptNames.forEach((conceptName) => {
        const concept = namespaceFacts?.[conceptName];
        if (!concept?.units) {
          return;
        }

        flattenUnitEntries(concept.units).forEach((entry) => {
          if (entry?.val == null) {
            return;
          }

          candidates.push({
            namespace,
            conceptName,
            label: concept.label || conceptName,
            ...entry,
          });
        });
      });
    });

    if (candidates.length === 0) {
      return;
    }

    const best = pickBestFact(candidates, filingInfo);
    const value = parseNumericValue(best.val);
    if (value == null) {
      return;
    }

    statement.values[canonicalLabel] = value;
    statement.parsedRows.push({
      id: `xbrl-${canonicalLabel}`,
      originalLabel: best.label,
      canonicalLabel,
      value,
      rawValue: best.val,
      source: `xbrl:${best.namespace}:${best.conceptName}`,
    });
  });

  Object.entries(factsByNamespace).forEach(([namespace, namespaceFacts]) => {
    if (namespace === 'us-gaap') {
      return;
    }

    Object.entries(namespaceFacts || {}).forEach(([conceptName, concept]) => {
      const lowerConcept = conceptName.toLowerCase();
      if (!/revenue|sales/.test(lowerConcept)) {
        return;
      }

      const label = concept.label || conceptName;
      const lowerLabel = label.toLowerCase();
      if (!/product|service/.test(lowerConcept) && !/product|service/.test(lowerLabel)) {
        return;
      }

      const best = pickBestFact(flattenUnitEntries(concept.units || {}), filingInfo);
      if (!best) {
        return;
      }

      const value = parseNumericValue(best.val);
      if (value == null) {
        return;
      }

      statement.revenueBreakdown.push({
        label,
        canonicalLabel: /service/.test(lowerConcept) || /service/.test(lowerLabel) ? 'Service Revenue' : 'Product Revenue',
        value: Math.abs(value),
      });
      statement.parsedRows.push({
        id: `xbrl-breakdown-${conceptName}`,
        originalLabel: label,
        canonicalLabel: /service/.test(lowerConcept) || /service/.test(lowerLabel) ? 'Service Revenue' : 'Product Revenue',
        value,
        rawValue: best.val,
        source: `xbrl:${namespace}:${conceptName}`,
      });
    });
  });

  return {
    sourceType: 'xbrl-companyfacts',
    statement: finalizeStatement(statement),
    parsedRows: statement.parsedRows,
    issues: [],
  };
}

function parseXbrlInstance(xmlText) {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    parseTagValue: false,
    trimValues: true,
  });
  const parsed = parser.parse(xmlText);
  const collected = [];

  function walk(node, tagName) {
    if (Array.isArray(node)) {
      node.forEach((item) => walk(item, tagName));
      return;
    }

    if (node && typeof node === 'object') {
      Object.entries(node).forEach(([childTag, childValue]) => {
        walk(childValue, childTag);
      });
      return;
    }

    if (typeof node !== 'string' || !tagName) {
      return;
    }

    const conceptName = tagName.includes(':') ? tagName.split(':').pop() : tagName;
    const canonicalLabel = Object.entries(CONCEPTS).find(([, conceptNames]) => conceptNames.includes(conceptName))?.[0];
    if (!canonicalLabel) {
      return;
    }

    const value = parseNumericValue(node);
    if (value == null) {
      return;
    }

    collected.push({
      canonicalLabel,
      value,
      originalLabel: conceptName,
      source: `xbrl-instance:${tagName}`,
    });
  }

  walk(parsed, null);

  const statement = {
    values: {
      'Total Revenue': null,
      'Cost of Revenue': null,
      'Gross Profit': null,
      'R&D': null,
      'SG&A': null,
      'Operating Expenses': null,
      'Operating Profit': null,
      Tax: null,
      Other: null,
      'Net Profit': null,
    },
    revenueBreakdown: [],
    parsedRows: [],
  };

  collected.forEach((item, index) => {
    if (statement.values[item.canonicalLabel] == null || Math.abs(item.value) > Math.abs(statement.values[item.canonicalLabel])) {
      statement.values[item.canonicalLabel] = item.value;
    }
    statement.parsedRows.push({
      id: `instance-${index + 1}`,
      ...item,
      rawValue: item.value,
    });
  });

  return {
    sourceType: 'xbrl-instance',
    statement: finalizeStatement(statement),
    parsedRows: statement.parsedRows,
    issues: [],
  };
}

module.exports = {
  parseCompanyFactsIncomeStatement,
  parseXbrlInstance,
};