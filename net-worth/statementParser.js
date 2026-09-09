// Extracts one balance snapshot (institution, account, date, balance) out of
// a Bank of America, Robinhood, or Transamerica statement PDF.
//
// Unlike the spending analyzer's line-by-line transaction parser, this only
// needs a single number per statement — the ending balance — so it looks
// for that institution's specific "ending balance" phrasing rather than
// trying to understand the whole document. Every extraction is shown to you
// before it's trusted (see app.js), since a wrong balance here silently
// skews the whole net worth trend in a way a wrong transaction category
// never would.

import * as pdfjsLib from './lib/pdf.min.mjs';

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL('./lib/pdf.worker.min.mjs', import.meta.url).href;

const MONTH_NAMES = ['january', 'february', 'march', 'april', 'may', 'june',
  'july', 'august', 'september', 'october', 'november', 'december'];

/**
 * Read a File and return a parsed balance snapshot, or { error }.
 * @param {File} file
 */
export async function parseStatementFile(file) {
  if (!/\.pdf$/i.test(file.name) && file.type && file.type !== 'application/pdf') {
    return { error: `"${file.name}" doesn't look like a PDF file.` };
  }

  let buffer;
  try {
    buffer = await file.arrayBuffer();
  } catch (e) {
    return { error: `Could not read "${file.name}" from disk.` };
  }

  let pdf;
  try {
    pdf = await pdfjsLib.getDocument({ data: buffer }).promise;
  } catch (e) {
    return {
      error: `"${file.name}" doesn't look like a valid PDF (or it's password-protected). ` +
        `Try exporting it again, or remove the password first.`,
    };
  }

  const allLines = [];
  try {
    for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
      const page = await pdf.getPage(pageNum);
      const content = await page.getTextContent();
      allLines.push(...groupItemsIntoLines(content.items));
    }
  } catch (e) {
    return { error: `Ran into a problem reading the pages of "${file.name}". The file may be corrupted.` };
  }

  const fullText = allLines.join('\n');
  if (fullText.trim().length < 40) {
    return {
      error: `"${file.name}" doesn't seem to contain selectable text — it may be a scanned ` +
        `image rather than a text-based PDF.`,
    };
  }

  // Anchored to each institution's own domain/legal name rather than a bare
  // mention of it — a Bank of America statement can easily *contain* the
  // word "Robinhood" (e.g. a transfer line like "ROBINHOOD DES:DEBITS...")
  // without being one.
  const lower = fullText.toLowerCase();
  let result;
  if (lower.includes('robinhood.com') || lower.includes('robinhood securities') || lower.includes('robinhood financial')) {
    result = parseRobinhood(fullText);
  } else if (lower.includes('transamerica.com')) {
    result = parseTransamerica(fullText);
  } else if (lower.includes('bankofamerica.com') || lower.includes('bank of america, n.a.')) {
    result = parseBankOfAmerica(fullText);
  } else {
    return {
      error: `Couldn't tell which institution "${file.name}" is from (Bank of America, Robinhood, ` +
        `and Transamerica are recognized so far). Add this account's balance by hand instead.`,
    };
  }

  if (result.error) return { error: `"${file.name}": ${result.error}` };
  return { ...result, fileName: file.name };
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

function last4(digits) {
  const clean = (digits || '').replace(/\D/g, '');
  return clean.slice(-4) || '????';
}

function toAmount(tok) {
  const value = parseFloat((tok || '').replace(/[^\d.]/g, ''));
  return isNaN(value) ? null : value;
}

function monthNameDateToISO(str) {
  const m = str.match(/([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})/);
  if (!m) return null;
  const monthIdx = MONTH_NAMES.indexOf(m[1].toLowerCase());
  if (monthIdx === -1) return null;
  const day = parseInt(m[2], 10);
  const year = parseInt(m[3], 10);
  return `${year}-${String(monthIdx + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function slashDateToISO(str) {
  const m = str.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (!m) return null;
  const [, mm, dd, yyyy] = m;
  return `${yyyy}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}`;
}

// Last-resort date guess: the latest explicit calendar date anywhere in the
// statement (typically the closing/period-end date prints more often than
// the opening one).
function findLatestDate(fullText) {
  const candidates = [];
  for (const m of fullText.matchAll(/[A-Za-z]+\s+\d{1,2},\s*\d{4}/g)) {
    const iso = monthNameDateToISO(m[0]);
    if (iso) candidates.push(iso);
  }
  for (const m of fullText.matchAll(/\d{1,2}\/\d{1,2}\/\d{4}/g)) {
    const iso = slashDateToISO(m[0]);
    if (iso) candidates.push(iso);
  }
  if (candidates.length === 0) return null;
  return candidates.reduce((a, b) => (a > b ? a : b));
}

function parseRobinhood(fullText) {
  const acctMatch = fullText.match(/Account #:\s*(\d+)/i);
  const periodMatch = fullText.match(/(\d{1,2}\/\d{1,2}\/\d{4})\s+to\s+(\d{1,2}\/\d{1,2}\/\d{4})/);
  const valueMatch = fullText.match(/Portfolio Value\s+\$?([\d,]+\.\d{2})\s+\$?([\d,]+\.\d{2})/i);

  if (!valueMatch) {
    return { error: `Couldn't find a "Portfolio Value" line — this may not be a standard monthly account statement.` };
  }
  if (!periodMatch) {
    return { error: `Found a portfolio value but couldn't find the statement period (expected "MM/DD/YYYY to MM/DD/YYYY").` };
  }

  const balance = toAmount(valueMatch[2]);
  const date = slashDateToISO(periodMatch[2]);
  const accountType = fullText.match(/^(Individual|Joint|Traditional IRA|Roth IRA|Custodial)\b/im)?.[1] || 'Brokerage';
  const acctNum = acctMatch?.[1] || '';

  return {
    institution: 'Robinhood',
    accountKey: `robinhood:${acctNum ? last4(acctNum) : 'default'}`,
    accountLabel: `Robinhood ${accountType}${acctNum ? ` ····${last4(acctNum)}` : ''}`,
    kind: 'asset',
    date,
    balance,
  };
}

function parseTransamerica(fullText) {
  const periodMatch = fullText.match(/Summary for [A-Za-z]+ \d{1,2},\s*\d{4}\s*-\s*([A-Za-z]+ \d{1,2},\s*\d{4})/);
  const balanceMatch = fullText.match(/Ending Balance[^\n$]*\$?([\d,]+\.\d{2})/i);
  const planMatch = fullText.match(/^(\d{4,8})\s+\d+\s+(.+?)\s*\$[\d,]+\.\d{2}/m);

  if (!balanceMatch) {
    return { error: `Couldn't find an "Ending Balance" line — this may not be a standard quarterly/period statement.` };
  }

  const balance = toAmount(balanceMatch[1]);
  const date = periodMatch ? monthNameDateToISO(periodMatch[1]) : findLatestDate(fullText);
  if (!date) {
    return { error: `Found a balance but couldn't find the statement period end date.` };
  }

  const planNumber = planMatch?.[1];
  const planName = planMatch?.[2]?.trim();

  return {
    institution: 'Transamerica',
    accountKey: `transamerica:${planNumber || 'default'}`,
    accountLabel: planName ? `Transamerica (${planName})` : 'Transamerica Retirement Account',
    kind: 'asset',
    date,
    balance,
  };
}

const BOA_CREDIT_CARD_HINTS = ['new balance total', 'minimum payment', 'purchases and adjustments'];
const BOA_BANK_ACCOUNT_HINTS = ['ending balance', 'beginning balance', 'checking', 'savings'];

function parseBankOfAmerica(fullText) {
  const lower = fullText.toLowerCase();
  const isCreditCard = BOA_CREDIT_CARD_HINTS.some((h) => lower.includes(h));
  const isBankAccount = !isCreditCard && BOA_BANK_ACCOUNT_HINTS.some((h) => lower.includes(h));

  const acctMatch = fullText.match(/Account\s*#?:?\s*([\d ]{8,25})\b/i);
  const acctNum = acctMatch?.[1] || '';

  if (isCreditCard) {
    const balanceMatch = fullText.match(/New Balance Total\s*\$?\s*([\d,]+\.\d{2})/i);
    if (!balanceMatch) {
      return { error: `Recognized this as a Bank of America credit card statement but couldn't find "New Balance Total".` };
    }
    const dateMatch = fullText.match(/Statement Closing Date\s+(\d{1,2}\/\d{1,2}\/\d{4})/i);
    const date = dateMatch ? slashDateToISO(dateMatch[1]) : findLatestDate(fullText);
    if (!date) return { error: `Found a balance but couldn't find the statement closing date.` };

    return {
      institution: 'Bank of America',
      accountKey: `boa:${last4(acctNum)}`,
      accountLabel: `Bank of America Credit Card ····${last4(acctNum)}`,
      kind: 'liability',
      date,
      balance: toAmount(balanceMatch[1]),
    };
  }

  // Bank account (checking/savings), or unrecognized BoA layout. BoA often
  // sends one "combined statement" covering several deposit accounts (e.g.
  // checking + savings) at once — in that case "Total balance" is the sum
  // across all of them, and using any single account's "Ending balance"
  // instead would silently drop the others. So look for a combined total
  // first, and only fall back to a single account's ending balance when
  // there isn't one.
  const totalMatch = fullText.match(/Total balance\s*\$?\s*([\d,]+\.\d{2})/i);
  if (totalMatch) {
    const periodMatch = fullText.match(/for [A-Za-z]+ \d{1,2},\s*\d{4}\s+to\s+([A-Za-z]+ \d{1,2},\s*\d{4})/i);
    const date = periodMatch ? monthNameDateToISO(periodMatch[1]) : findLatestDate(fullText);
    if (!date) return { error: `Found a "Total balance" but couldn't find the statement period end date.` };

    return {
      institution: 'Bank of America',
      accountKey: 'boa:deposits',
      accountLabel: 'Bank of America Checking & Savings',
      kind: 'asset',
      date,
      balance: toAmount(totalMatch[1]),
    };
  }

  const balanceMatch = fullText.match(
    /Ending balance(?:\s+on\s+(\d{1,2}\/\d{1,2}\/\d{2,4}|[A-Za-z]+ \d{1,2},\s*\d{4}))?\s*\$?\s*([\d,]+\.\d{2})/i
  );
  if (!balanceMatch) {
    return {
      error: isBankAccount
        ? `Recognized this as a Bank of America deposit account statement but couldn't find a "Total balance" or "Ending balance" line.`
        : `Recognized this as a Bank of America statement but couldn't tell if it's a card or a deposit account, ` +
          `and couldn't find a balance line either way.`,
    };
  }

  let date = null;
  if (balanceMatch[1]?.includes('/')) {
    const [mm, dd, yy] = balanceMatch[1].split('/');
    const year = yy.length === 2 ? (parseInt(yy, 10) < 70 ? `20${yy}` : `19${yy}`) : yy;
    date = `${year}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}`;
  } else if (balanceMatch[1]) {
    date = monthNameDateToISO(balanceMatch[1]);
  }
  if (!date) date = findLatestDate(fullText);
  if (!date) return { error: `Found a balance but couldn't find the statement date.` };

  return {
    institution: 'Bank of America',
    accountKey: `boa:${last4(acctNum)}`,
    accountLabel: `Bank of America Account ····${last4(acctNum)}`,
    kind: 'asset',
    date,
    balance: toAmount(balanceMatch[2]),
  };
}
