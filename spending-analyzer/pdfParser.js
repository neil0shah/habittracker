// Extracts transaction rows out of bank/credit-card statement PDFs.
//
// Everything here runs client-side using a vendored copy of pdf.js
// (see lib/). No file contents or parsed data ever leave the browser.
//
// Strategy: PDF.js gives us positioned text fragments per page. We
// reconstruct visual "lines" by clustering fragments that share a
// baseline, then run a fairly permissive line-based parser over the
// result: any line that starts with a date and contains a trailing
// dollar amount is treated as a transaction row. This works across very
// different statement layouts (checking accounts, credit cards, etc.)
// without needing a template per bank.

import * as pdfjsLib from './lib/pdf.min.mjs';

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL('./lib/pdf.worker.min.mjs', import.meta.url).href;

// Some statements print a credit's minus sign with a space before the
// digits (e.g. "- 51.96" for a refund) instead of right against them
// ("-51.96") — the optional \s* on both sides catches that without
// affecting statements that don't do this.
const AMOUNT_RE = /-?\s*\$?\(?\d{1,3}(?:,\d{3})*\.\d{2}\)?\s*-?/g;
const LEADING_DATE_RE = /^(\d{1,2}\/\d{1,2}(?:\/\d{2,4})?|\d{4}-\d{2}-\d{2})\b/;
const MONTH_NAME_DATE_RE = /([A-Z][a-z]+ \d{1,2},\s*\d{4})/g;
const SLASH_FULL_DATE_RE = /(\d{1,2}\/\d{1,2}\/\d{4})/g;

const MONTH_NAMES = ['january', 'february', 'march', 'april', 'may', 'june',
  'july', 'august', 'september', 'october', 'november', 'december'];

const CREDIT_CARD_HINTS = [
  'new balance total', 'minimum payment', 'credit line',
  'purchases and adjustments', 'annual percentage rate',
  'statement closing date', 'payment due date',
];
const BANK_ACCOUNT_HINTS = [
  'deposits and other additions', 'withdrawals and other subtractions',
  'beginning balance', 'ending balance', 'checking', 'savings',
];

const HEADER_SKIP_RE = /^(total|subtotal|totals?\s|date\s+description|transaction\s+date)/i;

/**
 * Read a File and return { transactions, statementType, warnings, error }.
 * On failure `error` is a user-facing message and transactions is [].
 */
export async function parsePdfFile(file) {
  const warnings = [];

  if (!/\.pdf$/i.test(file.name) && file.type && file.type !== 'application/pdf') {
    return { error: `"${file.name}" doesn't look like a PDF file.`, transactions: [] };
  }

  let buffer;
  try {
    buffer = await file.arrayBuffer();
  } catch (e) {
    return { error: `Could not read "${file.name}" from disk.`, transactions: [] };
  }

  let pdf;
  try {
    pdf = await pdfjsLib.getDocument({ data: buffer }).promise;
  } catch (e) {
    return {
      error: `"${file.name}" doesn't look like a valid PDF (or it's password-protected). ` +
        `Try exporting it again from your bank, or remove the password first.`,
      transactions: [],
    };
  }

  const allLines = [];
  let totalChars = 0;

  try {
    for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
      const page = await pdf.getPage(pageNum);
      const content = await page.getTextContent();
      const lines = groupItemsIntoLines(content.items);
      for (const line of lines) totalChars += line.length;
      allLines.push(...lines);
    }
  } catch (e) {
    return {
      error: `Ran into a problem reading the pages of "${file.name}". The file may be corrupted.`,
      transactions: [],
    };
  }

  if (totalChars < 40) {
    return {
      error: `"${file.name}" doesn't seem to contain selectable text — it may be a scanned ` +
        `image rather than a text-based PDF. This app can't read scanned statements.`,
      transactions: [],
    };
  }

  const fullText = allLines.join('\n');
  const statementType = detectStatementType(fullText);
  const { year: refYear, month: refMonth, guessed } = findReferenceDate(fullText);
  if (guessed) {
    warnings.push('Could not find a statement date in this file, so transaction years were guessed. Double-check the dates below.');
  }

  const transactions = [];
  for (const line of allLines) {
    const row = parseLine(line, refYear, refMonth);
    if (row) transactions.push(row);
  }

  if (transactions.length === 0) {
    return {
      error: `We couldn't find any transaction rows in "${file.name}". The layout may not be ` +
        `one this app recognizes yet — statements with a clear "Date ... Description ... Amount" ` +
        `layout work best.`,
      transactions: [],
    };
  }

  return { transactions, statementType, warnings, fileName: file.name };
}

function groupItemsIntoLines(items) {
  if (items.length === 0) return [];

  const positioned = items
    .filter((it) => it.str && it.str.trim().length > 0)
    .map((it) => ({ str: it.str, x: it.transform[4], y: it.transform[5] }));

  positioned.sort((a, b) => b.y - a.y || a.x - b.x);

  const rows = [];
  let currentRow = [];
  let currentY = null;
  const TOLERANCE = 2.5;

  for (const item of positioned) {
    if (currentY === null || Math.abs(item.y - currentY) <= TOLERANCE) {
      currentRow.push(item);
      currentY = currentY === null ? item.y : currentY;
    } else {
      rows.push(currentRow);
      currentRow = [item];
      currentY = item.y;
    }
  }
  if (currentRow.length) rows.push(currentRow);

  return rows.map((row) => {
    row.sort((a, b) => a.x - b.x);
    return row.map((it) => it.str).join(' ').replace(/\s+/g, ' ').trim();
  });
}

function detectStatementType(fullText) {
  const lower = fullText.toLowerCase();
  const ccScore = CREDIT_CARD_HINTS.filter((h) => lower.includes(h)).length;
  const bankScore = BANK_ACCOUNT_HINTS.filter((h) => lower.includes(h)).length;

  if (ccScore === 0 && bankScore === 0) return 'unknown';
  return ccScore >= bankScore ? 'credit_card' : 'bank_account';
}

function findReferenceDate(fullText) {
  const candidates = [];

  for (const m of fullText.matchAll(MONTH_NAME_DATE_RE)) {
    const d = new Date(m[1].replace(/,\s*/, ', '));
    if (!isNaN(d)) candidates.push({ year: d.getFullYear(), month: d.getMonth() + 1 });
  }
  for (const m of fullText.matchAll(SLASH_FULL_DATE_RE)) {
    const [mm, , yyyy] = m[1].split('/');
    const year = parseInt(yyyy, 10);
    const month = parseInt(mm, 10);
    if (year > 1900 && month >= 1 && month <= 12) candidates.push({ year, month });
  }

  if (candidates.length === 0) {
    const now = new Date();
    return { year: now.getFullYear(), month: now.getMonth() + 1, guessed: true };
  }

  candidates.sort((a, b) => (b.year * 12 + b.month) - (a.year * 12 + a.month));
  return { year: candidates[0].year, month: candidates[0].month, guessed: false };
}

function resolveDate(dateStr, refYear, refMonth) {
  let year, month, day;

  if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    [year, month, day] = dateStr.split('-').map((n) => parseInt(n, 10));
  } else {
    const parts = dateStr.split('/').map((n) => parseInt(n, 10));
    month = parts[0];
    day = parts[1];
    if (parts.length === 3) {
      year = parts[2];
      if (year < 100) year = year < 70 ? 2000 + year : 1900 + year;
    } else {
      year = refYear;
      if (month > refMonth) year = refYear - 1;
    }
  }

  if (month < 1 || month > 12 || day < 1 || day > 31) return null;

  const iso = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  const d = new Date(iso + 'T00:00:00');
  if (isNaN(d)) return null;
  return iso;
}

function parseAmountToken(tok) {
  const negative = tok.startsWith('-') || tok.endsWith('-') || (tok.startsWith('(') && tok.endsWith(')'));
  const cleaned = tok.replace(/[^\d.]/g, '');
  const value = parseFloat(cleaned);
  if (isNaN(value)) return null;
  return negative ? -value : value;
}

function parseLine(line, refYear, refMonth) {
  const trimmed = line.trim();
  if (!trimmed || HEADER_SKIP_RE.test(trimmed)) return null;

  const dateMatch = trimmed.match(LEADING_DATE_RE);
  if (!dateMatch) return null;

  let rest = trimmed.slice(dateMatch[0].length).trim();

  // Some statements list a second "posting date" column right after the
  // transaction date — consume it too, but we don't use it.
  const secondDateMatch = rest.match(LEADING_DATE_RE);
  if (secondDateMatch) {
    rest = rest.slice(secondDateMatch[0].length).trim();
  }

  const amounts = rest.match(AMOUNT_RE);
  if (!amounts || amounts.length === 0) return null;

  const amountToken = amounts[amounts.length - 1];
  const lastIndex = rest.lastIndexOf(amountToken);
  let description = rest.slice(0, lastIndex).trim();

  // Strip trailing bare numeric columns (reference #, account # etc.)
  // that sit between the description and the amount in some layouts.
  let stripped = 0;
  while (stripped < 2) {
    const m = description.match(/\s(\d{1,6})$/);
    if (!m) break;
    description = description.slice(0, m.index).trim();
    stripped++;
  }

  if (!description || description.length < 2) return null;
  if (/^(description|amount)$/i.test(description)) return null;

  // Some "Checks" sections list only a check number in place of a real
  // description (Date, Check #, Amount) — label it so it's not just a
  // bare number in the transaction list.
  if (/^\d{1,6}$/.test(description)) {
    description = `Check #${description}`;
  }

  const rawAmount = parseAmountToken(amountToken);
  if (rawAmount === null) return null;

  const isoDate = resolveDate(dateMatch[0], refYear, refMonth);
  if (!isoDate) return null;

  return { date: isoDate, description, rawAmount };
}
