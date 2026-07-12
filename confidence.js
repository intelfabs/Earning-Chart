const { listMissingLineItems } = require('./mapping');

const SOURCE_BASE_SCORES = {
  'xbrl-companyfacts': 0.8,
  'xbrl-instance': 0.72,
  html: 0.58,
  'upload-html': 0.62,
  pdf: 0.42,
  'upload-pdf': 0.46,
};

function nearlyEqual(left, right, tolerance = 0.02) {
  if (left == null || right == null) {
    return false;
  }
  const denominator = Math.max(Math.abs(left), Math.abs(right), 1);
  return Math.abs(left - right) / denominator <= tolerance;
}

function scoreLabel(score) {
  if (score >= 0.85) {
    return 'High';
  }
  if (score >= 0.65) {
    return 'Medium';
  }
  return 'Low';
}

function calculateConfidence(parseResult) {
  const statement = parseResult.statement;
  const values = statement.values;
  const issues = [...(parseResult.issues || [])];
  const missing = listMissingLineItems(statement);

  let score = SOURCE_BASE_SCORES[parseResult.sourceType] ?? 0.35;
  const completeness = 1 - missing.length / 6;
  score += completeness * 0.18;

  if (nearlyEqual(values['Gross Profit'], (values['Total Revenue'] ?? 0) - (values['Cost of Revenue'] ?? 0))) {
    score += 0.04;
  } else if (values['Gross Profit'] != null && values['Total Revenue'] != null && values['Cost of Revenue'] != null) {
    issues.push('Gross profit does not exactly match revenue minus cost of revenue.');
  }

  if (nearlyEqual(values['Operating Profit'], (values['Gross Profit'] ?? 0) - (values['Operating Expenses'] ?? 0))) {
    score += 0.04;
  } else if (values['Operating Profit'] != null && values['Gross Profit'] != null && values['Operating Expenses'] != null) {
    issues.push('Operating profit does not exactly match gross profit minus operating expenses.');
  }

  if (missing.length > 0) {
    issues.push(`Missing canonical items: ${missing.join(', ')}.`);
  }

  const boundedScore = Math.max(0.05, Math.min(0.99, Number(score.toFixed(2))));
  return {
    score: boundedScore,
    label: scoreLabel(boundedScore),
    issues,
    missing,
  };
}

module.exports = {
  calculateConfidence,
};