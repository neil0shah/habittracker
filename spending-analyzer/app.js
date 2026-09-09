import { parsePdfFile } from './pdfParser.js';
import { categorize, CATEGORIES, CATEGORY_COLORS, NON_EXPENSE_CATEGORIES, isEssential } from './categorizer.js';
import { renderCategoryBars, renderCashFlowBars, renderTrendChart } from './charts.js';
import { loadRules, saveRules, upsertRule, applyRules, normalizeDescription } from './rules.js';

const STORAGE_KEY = 'spendingAnalyzer.v1.files';

/** @type {Array<{
 *   id: string, fileName: string, uploadedAt: string,
 *   accountKind: 'credit_card'|'bank_account', detectedType: string,
 *   warnings: string[],
 *   transactions: Array<{key:string, date:string, description:string,
 *     amount:number, isDebit:boolean, category:string, manualCategory:boolean,
 *     excluded:boolean, signFlipped:boolean, linkedId:string|null}>
 * }>} */
let files = loadFiles();
// Learned corrections (category fixes, sign fixes) — stored separately from
// `files` so they survive "Clear all data" and generalize to future uploads.
let rules = loadRules();
let fileErrors = []; // transient, not persisted: [{fileName, message}]
let fileNotices = []; // transient, not persisted: [{fileName, message}] — informational, not errors
let searchTerm = '';
let datePreset = 'all';
let customStart = '';
let customEnd = '';
let tableCategoryFilters = new Set(); // empty = no category filter (show all)
let tableTypeFilter = 'all';
let tableMinAmount = '';
let tableAmountSearch = '';
let lastTableTxnKeys = []; // keys currently shown in the table, for bulk-edit
let linkSelection = new Set(); // transient: transaction keys picked for linking
let trendPeriod = 'last12';
let fileListCollapsed = false;
let lastClearedRules = null; // snapshot for "Undo reset", cleared on next real edit
let tableSortColumn = 'date';
let tableSortDirection = 'desc';

const el = {
  dropZone: document.getElementById('drop-zone'),
  fileInput: document.getElementById('file-input'),
  fileErrors: document.getElementById('file-errors'),
  fileList: document.getElementById('file-list'),
  fileListToggle: document.getElementById('file-list-toggle'),
  fileListToggleLabel: document.getElementById('file-list-toggle-label'),
  fileListChevron: document.getElementById('file-list-chevron'),
  filterBar: document.getElementById('filter-bar'),
  datePreset: document.getElementById('date-preset'),
  customRange: document.getElementById('custom-range'),
  customStart: document.getElementById('custom-start'),
  customEnd: document.getElementById('custom-end'),
  search: document.getElementById('search'),
  clearAll: document.getElementById('clear-all'),
  resetRules: document.getElementById('reset-rules'),
  undoResetRules: document.getElementById('undo-reset-rules'),
  summary: document.getElementById('summary'),
  totalSpending: document.getElementById('total-spending'),
  totalMeta: document.getElementById('total-meta'),
  totalIncome: document.getElementById('total-income'),
  incomeMeta: document.getElementById('income-meta'),
  netCashflow: document.getElementById('net-cashflow'),
  netMeta: document.getElementById('net-meta'),
  categoryChart: document.getElementById('category-chart'),
  cashflowChart: document.getElementById('cashflow-chart'),
  chartsSection: document.getElementById('charts-section'),
  tableSection: document.getElementById('table-section'),
  txnBody: document.getElementById('txn-body'),
  emptyState: document.getElementById('empty-state'),
  tableCategoryChips: document.getElementById('table-category-chips'),
  tableTypeFilter: document.getElementById('table-type-filter'),
  tableMinAmount: document.getElementById('table-min-amount'),
  tableAmountSearch: document.getElementById('table-amount-search'),
  tableFilterClear: document.getElementById('table-filter-clear'),
  bulkEditBar: document.getElementById('bulk-edit-bar'),
  bulkEditCount: document.getElementById('bulk-edit-count'),
  bulkEditCategory: document.getElementById('bulk-edit-category'),
  bulkEditApply: document.getElementById('bulk-edit-apply'),
  linkBar: document.getElementById('link-bar'),
  linkCount: document.getElementById('link-count'),
  linkNet: document.getElementById('link-net'),
  linkApply: document.getElementById('link-apply'),
  linkClear: document.getElementById('link-clear'),
  trendSection: document.getElementById('trend-section'),
  trendCategory1: document.getElementById('trend-category-1'),
  trendCategory2: document.getElementById('trend-category-2'),
  trendCategory3: document.getElementById('trend-category-3'),
  trendPeriod: document.getElementById('trend-period'),
  trendChart: document.getElementById('trend-chart'),
};

init();

function init() {
  // Derive initial filter state from the DOM instead of duplicating the
  // default here, so the dropdown's selected option and the actual filter
  // applied can never drift apart.
  datePreset = el.datePreset.value;

  el.fileInput.addEventListener('change', (e) => handleFiles(e.target.files));

  ['dragenter', 'dragover'].forEach((evt) =>
    el.dropZone.addEventListener(evt, (e) => {
      e.preventDefault();
      el.dropZone.classList.add('drag-over');
    })
  );
  ['dragleave', 'drop'].forEach((evt) =>
    el.dropZone.addEventListener(evt, (e) => {
      e.preventDefault();
      el.dropZone.classList.remove('drag-over');
    })
  );
  el.dropZone.addEventListener('drop', (e) => {
    if (e.dataTransfer?.files?.length) handleFiles(e.dataTransfer.files);
  });
  el.dropZone.addEventListener('click', () => el.fileInput.click());
  el.dropZone.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); el.fileInput.click(); }
  });

  el.datePreset.addEventListener('change', () => {
    datePreset = el.datePreset.value;
    el.customRange.hidden = datePreset !== 'custom';
    render();
  });
  el.customStart.addEventListener('change', () => { customStart = el.customStart.value; render(); });
  el.customEnd.addEventListener('change', () => { customEnd = el.customEnd.value; render(); });
  el.search.addEventListener('input', () => { searchTerm = el.search.value.trim().toLowerCase(); render(); });

  el.clearAll.addEventListener('click', () => {
    if (files.length === 0) return;
    if (confirm('Remove all uploaded statements from this browser? Your learned category/sign corrections will be kept and applied to whatever you upload next.')) {
      files = [];
      saveFiles();
      render();
    }
  });

  el.resetRules.addEventListener('click', () => {
    if (rules.length === 0) return;
    if (confirm(`Forget all ${rules.length} learned category/sign correction${rules.length === 1 ? '' : 's'}?`)) {
      lastClearedRules = rules;
      rules = [];
      saveRules(rules);
      render();
    }
  });
  el.undoResetRules.addEventListener('click', () => {
    if (!lastClearedRules) return;
    rules = lastClearedRules;
    lastClearedRules = null;
    saveRules(rules);
    render();
  });

  el.fileListToggle.addEventListener('click', () => {
    fileListCollapsed = !fileListCollapsed;
    render();
  });

  CATEGORIES.forEach((c) => {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'chip';
    chip.textContent = c;
    chip.style.setProperty('--chip-color', CATEGORY_COLORS[c] || '#9ca3af');
    chip.addEventListener('click', () => {
      if (tableCategoryFilters.has(c)) tableCategoryFilters.delete(c);
      else tableCategoryFilters.add(c);
      render();
    });
    el.tableCategoryChips.appendChild(chip);

    const opt2 = document.createElement('option');
    opt2.value = c;
    opt2.textContent = c;
    el.bulkEditCategory.appendChild(opt2);
  });

  // Trend chart is about spending, so only offer expense categories.
  const trendCategoryOptions = CATEGORIES.filter((c) => !NON_EXPENSE_CATEGORIES.includes(c));
  const trendSelects = [el.trendCategory1, el.trendCategory2, el.trendCategory3];
  const trendDefaults = ['Dining & Coffee', 'none', 'none'];
  trendSelects.forEach((select, i) => {
    const noneOpt = document.createElement('option');
    noneOpt.value = 'none';
    noneOpt.textContent = 'None';
    select.appendChild(noneOpt);
    trendCategoryOptions.forEach((c) => {
      const opt = document.createElement('option');
      opt.value = c;
      opt.textContent = c;
      select.appendChild(opt);
    });
    select.value = trendDefaults[i];
    select.addEventListener('change', render);
  });
  el.trendPeriod.addEventListener('change', () => {
    trendPeriod = el.trendPeriod.value;
    render();
  });

  el.tableTypeFilter.addEventListener('change', () => {
    tableTypeFilter = el.tableTypeFilter.value;
    render();
  });
  el.tableMinAmount.addEventListener('input', () => {
    tableMinAmount = el.tableMinAmount.value;
    render();
  });
  el.tableAmountSearch.addEventListener('input', () => {
    tableAmountSearch = el.tableAmountSearch.value;
    render();
  });
  el.tableFilterClear.addEventListener('click', () => {
    tableCategoryFilters.clear();
    tableTypeFilter = 'all';
    tableMinAmount = '';
    tableAmountSearch = '';
    el.tableTypeFilter.value = 'all';
    el.tableMinAmount.value = '';
    el.tableAmountSearch.value = '';
    render();
  });

  document.querySelectorAll('th.sortable').forEach((th) => {
    th.addEventListener('click', () => {
      const column = th.dataset.sort;
      if (tableSortColumn === column) {
        tableSortDirection = tableSortDirection === 'asc' ? 'desc' : 'asc';
      } else {
        tableSortColumn = column;
        // Newest/largest first reads more naturally for date and amount;
        // A-Z reads more naturally for text columns.
        tableSortDirection = column === 'date' || column === 'amount' ? 'desc' : 'asc';
      }
      render();
    });
  });

  el.bulkEditApply.addEventListener('click', () => {
    const keys = lastTableTxnKeys;
    const category = el.bulkEditCategory.value;
    if (keys.length === 0) return;
    if (confirm(`Set category to "${category}" for ${keys.length} shown transaction${keys.length === 1 ? '' : 's'}?`)) {
      bulkSetCategory(keys, category);
    }
  });

  el.linkApply.addEventListener('click', () => {
    if (linkSelection.size < 2) return;
    if (confirm(`Link these ${linkSelection.size} transactions together? Their combined net amount will count as one entry in your totals instead of each counting separately.`)) {
      linkSelected();
    }
  });
  el.linkClear.addEventListener('click', () => {
    linkSelection.clear();
    render();
  });

  render();
}

async function handleFiles(fileListLike) {
  const pdfFiles = Array.from(fileListLike);
  fileErrors = [];
  fileNotices = [];

  // Transactions already on file (across every uploaded statement) — used to
  // catch both a whole document re-uploaded by mistake and individual
  // transactions that show up again in a different statement (e.g. an
  // overlapping date range between two exports).
  const seenSignatures = new Set(
    allTransactions().map((t) => dupSignature(t.date, t.description, t.amount, t.isDebit))
  );

  for (const file of pdfFiles) {
    const result = await parsePdfFile(file);

    if (result.error) {
      fileErrors.push({ fileName: file.name, message: result.error });
      continue;
    }

    const accountKind = result.statementType === 'unknown' ? 'bank_account' : result.statementType;
    const parsedTransactions = result.transactions.map((t) => buildTransaction(t, accountKind, file.name));

    const transactions = [];
    let duplicateCount = 0;
    for (const t of parsedTransactions) {
      const sig = dupSignature(t.date, t.description, t.amount, t.isDebit);
      if (seenSignatures.has(sig)) {
        duplicateCount++;
        continue;
      }
      seenSignatures.add(sig);
      transactions.push(t);
    }

    if (parsedTransactions.length > 0 && transactions.length === 0) {
      fileNotices.push({
        fileName: result.fileName,
        message: `This looks like a duplicate of a statement you've already uploaded — all ${parsedTransactions.length} transaction${parsedTransactions.length === 1 ? '' : 's'} were already recorded, so nothing new was added.`,
      });
      continue;
    }

    const warnings = [...(result.warnings || [])];
    if (duplicateCount > 0) {
      warnings.push(
        `Skipped ${duplicateCount} duplicate transaction${duplicateCount === 1 ? '' : 's'} that ${duplicateCount === 1 ? 'was' : 'were'} already recorded from another statement.`
      );
    }

    files.push({
      id: uid(),
      fileName: result.fileName,
      uploadedAt: new Date().toISOString(),
      accountKind,
      detectedType: result.statementType,
      warnings,
      transactions,
    });
  }

  saveFiles();
  el.fileInput.value = '';
  render();
}

// A duplicate is the same date, description, and amount (sign included) —
// regardless of which statement it came from. Used both to skip re-uploaded
// documents and to catch the same transaction appearing in two overlapping
// statements.
function dupSignature(date, description, amount, isDebit) {
  return `${date}|${amount.toFixed(2)}|${isDebit ? 'D' : 'C'}|${normalizeDescription(description)}`;
}

function buildTransaction(parsed, accountKind, fileName) {
  const spendIsPositive = accountKind === 'credit_card';
  const baseIsDebit = spendIsPositive ? parsed.rawAmount > 0 : parsed.rawAmount < 0;
  const amount = Math.abs(parsed.rawAmount);
  const key = makeStableKey(parsed.date, parsed.description, amount, fileName);

  // Learned corrections (from past edits, persisted independently of any
  // uploaded statement) take priority over the built-in keyword guesses.
  const ruleResult = applyRules(rules, parsed.description, baseIsDebit);
  const isDebit = ruleResult.isDebit;
  const category = ruleResult.category || categorize(parsed.description, isDebit);

  return {
    key,
    date: parsed.date,
    description: parsed.description,
    amount,
    isDebit,
    category,
    manualCategory: ruleResult.category !== null,
    excluded: false,
    signFlipped: isDebit !== baseIsDebit,
    linkedId: null,
  };
}

function findTxn(txnKey) {
  for (const f of files) {
    const t = f.transactions.find((x) => x.key === txnKey);
    if (t) return t;
  }
  return null;
}

/**
 * Retroactively apply a just-learned rule to every already-loaded
 * transaction that matches it (not just the one(s) the user just edited),
 * so a correction takes effect across all currently uploaded statements
 * immediately, not only on the next upload.
 */
function applyRuleToLoadedTransactions(rule) {
  for (const f of files) {
    for (const t of f.transactions) {
      const norm = normalizeDescription(t.description);
      const matches = rule.matchType === 'exact' ? norm === rule.pattern : norm.includes(rule.pattern);
      if (!matches) continue;
      if (rule.flipSign && !t.signFlipped) {
        t.isDebit = !t.isDebit;
        t.signFlipped = true;
      }
      if (rule.category) {
        t.category = rule.category;
        t.manualCategory = true;
      }
    }
  }
}

function makeStableKey(date, description, amount, fileName) {
  const norm = description.trim().toUpperCase().replace(/\s+/g, ' ').slice(0, 80);
  return `${fileName}|${date}|${amount.toFixed(2)}|${norm}`;
}

function setAccountKind(fileId, newKind) {
  const file = files.find((f) => f.id === fileId);
  if (!file || file.accountKind === newKind) return;

  // Bank-account and credit-card statements use opposite sign conventions
  // for "money out" vs "money in", so flipping the kind flips every
  // transaction's debit/credit interpretation.
  file.accountKind = newKind;
  file.transactions.forEach((t) => {
    t.isDebit = !t.isDebit;
    if (!t.manualCategory) {
      t.category = categorize(t.description, t.isDebit);
    }
  });

  saveFiles();
  render();
}

function removeFile(fileId) {
  files = files.filter((f) => f.id !== fileId);
  saveFiles();
  render();
}

function setCategory(txnKey, category) {
  const t = findTxn(txnKey);
  if (!t) return;

  t.category = category;
  t.manualCategory = true;

  const rule = upsertRule(rules, { matchType: 'exact', pattern: t.description, category });
  lastClearedRules = null; // new work on top of a reset shouldn't be discardable by "Undo reset"
  saveRules(rules);
  applyRuleToLoadedTransactions(rule);

  saveFiles();
  render();
}

function setExcluded(txnKey, excluded) {
  const t = findTxn(txnKey);
  if (!t) return;
  t.excluded = excluded;
  saveFiles();
  render();
}

function flipSign(txnKey) {
  const t = findTxn(txnKey);
  if (!t) return;

  t.isDebit = !t.isDebit;
  t.signFlipped = true;
  // The category the flipped sign implies may no longer fit — re-derive it
  // from the built-in rules unless this transaction has its own category
  // correction on file.
  if (!t.manualCategory) {
    t.category = categorize(t.description, t.isDebit);
  }

  const rule = upsertRule(rules, { matchType: 'exact', pattern: t.description, flipSign: true });
  lastClearedRules = null;
  saveRules(rules);
  applyRuleToLoadedTransactions(rule);

  saveFiles();
  render();
}

function bulkSetCategory(txnKeys, category) {
  const keySet = new Set(txnKeys);
  const targets = [];
  for (const f of files) {
    for (const t of f.transactions) {
      if (keySet.has(t.key)) {
        t.category = category;
        t.manualCategory = true;
        targets.push(t);
      }
    }
  }

  if (searchTerm) {
    // The search term is exactly the generalization the user intended —
    // remember it as a keyword rule so it applies to future statements too.
    const rule = upsertRule(rules, { matchType: 'keyword', pattern: searchTerm, category });
    applyRuleToLoadedTransactions(rule);
  } else {
    // No keyword to generalize from (bulk edit via the category/type/amount
    // filters alone) — remember each affected transaction individually.
    for (const t of targets) {
      upsertRule(rules, { matchType: 'exact', pattern: t.description, category });
    }
  }
  lastClearedRules = null;
  saveRules(rules);

  saveFiles();
  render();
}

// Whether a transaction counts toward the totals/charts above the table on
// its own — excluded transactions never do, debits count only when their
// category isn't Income/Transfers, and credits count only when categorized
// Income. Linked transactions are handled separately in renderTable (see
// computeEffectiveTransactions) since a link's members count together, not
// individually — that's a different situation from simply not counting.
function affectsTotals(t) {
  if (t.excluded) return false;
  if (t.isDebit) return !NON_EXPENSE_CATEGORIES.includes(t.category);
  return t.category === 'Income';
}

/**
 * Collapses linked transactions (e.g. a rent payment + a roommate's Venmo
 * reimbursement, or a purchase + its refund) into one synthetic entry per
 * link, whose amount is the group's net (debits minus credits) and whose
 * category/date are borrowed from its largest-magnitude member — so a
 * fully-offset link contributes nothing, and a partially-offset one
 * contributes only the leftover. Unlinked transactions pass through as-is.
 */
function computeEffectiveTransactions(txns) {
  const linked = new Map();
  const result = [];

  for (const t of txns) {
    if (t.linkedId) {
      if (!linked.has(t.linkedId)) linked.set(t.linkedId, []);
      linked.get(t.linkedId).push(t);
    } else {
      result.push(t);
    }
  }

  for (const [linkedId, members] of linked) {
    if (members.length === 1) {
      result.push(members[0]);
      continue;
    }
    const primary = members.reduce((a, b) => (Math.abs(b.amount) > Math.abs(a.amount) ? b : a));
    const net = members.reduce((sum, m) => sum + (m.isDebit ? m.amount : -m.amount), 0);
    result.push({
      ...primary,
      key: `linked:${linkedId}`,
      amount: Math.abs(net),
      isDebit: net >= 0,
      linkedId,
      linkedMembers: members,
    });
  }

  return result;
}

function linkSelected() {
  if (linkSelection.size < 2) return;
  const id = uid();
  for (const key of linkSelection) {
    const t = findTxn(key);
    if (t) t.linkedId = id;
  }
  linkSelection.clear();
  saveFiles();
  render();
}

function unlink(txnKey) {
  const t = findTxn(txnKey);
  if (!t) return;
  t.linkedId = null;
  saveFiles();
  render();
}

function applyTableFilters(txns) {
  const min = tableMinAmount === '' ? null : parseFloat(tableMinAmount);
  const exact = tableAmountSearch === '' ? null : parseFloat(tableAmountSearch);

  return txns.filter((t) => {
    if (tableCategoryFilters.size > 0 && !tableCategoryFilters.has(t.category)) return false;
    if (tableTypeFilter === 'debit' && !t.isDebit) return false;
    if (tableTypeFilter === 'credit' && t.isDebit) return false;
    if (tableTypeFilter === 'linked' && !t.linkedId) return false;
    if (min !== null && !isNaN(min) && t.amount < min) return false;
    if (exact !== null && !isNaN(exact) && t.amount.toFixed(2) !== exact.toFixed(2)) return false;
    return true;
  });
}

function allTransactions() {
  const out = [];
  for (const f of files) {
    for (const t of f.transactions) out.push({ ...t, sourceFile: f.fileName });
  }
  return out;
}

function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function addDaysISO(iso, days) {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + days);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}

function computeDateBounds() {
  const today = todayISO();
  switch (datePreset) {
    case 'last30': return { start: addDaysISO(today, -29), end: today };
    case 'last90': return { start: addDaysISO(today, -89), end: today };
    case 'thisMonth': return { start: today.slice(0, 8) + '01', end: today };
    case 'thisYear': return { start: today.slice(0, 4) + '-01-01', end: today };
    case 'lastYear': {
      const y = parseInt(today.slice(0, 4), 10) - 1;
      return { start: `${y}-01-01`, end: `${y}-12-31` };
    }
    case 'custom': return { start: customStart || null, end: customEnd || null };
    default: return { start: null, end: null };
  }
}

function filteredTransactions() {
  const { start, end } = computeDateBounds();
  return allTransactions().filter((t) => {
    if (start && t.date < start) return false;
    if (end && t.date > end) return false;
    if (searchTerm && !t.description.toLowerCase().includes(searchTerm)) return false;
    return true;
  });
}

function formatCurrency(n) {
  return n.toLocaleString(undefined, { style: 'currency', currency: 'USD' });
}

function formatDateDisplay(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function monthLabel(ym) {
  const [y, m] = ym.split('-').map(Number);
  return new Date(y, m - 1, 15).toLocaleDateString(undefined, { month: 'short', year: 'numeric' });
}

function render() {
  renderFileErrors();
  renderFileList();
  renderRulesControl();
  renderCategoryChips();

  const hasFiles = files.length > 0;
  el.filterBar.hidden = !hasFiles;
  el.summary.hidden = !hasFiles;
  el.chartsSection.hidden = !hasFiles;
  el.trendSection.hidden = !hasFiles;
  el.tableSection.hidden = !hasFiles;
  el.emptyState.hidden = hasFiles;

  if (!hasFiles) return;

  try {
    renderSummaryAndTable();
  } catch (e) {
    console.error('Failed to render transactions', e);
    const banner = document.createElement('div');
    banner.className = 'banner banner-error';
    banner.textContent = `Something went wrong rendering your transactions (${e.message}). ` +
      `Try "Clear all data" and re-uploading your statements. If that doesn't help, please report this.`;
    el.fileErrors.appendChild(banner);
  }
}

function renderSummaryAndTable() {
  const txns = filteredTransactions();
  const included = txns.filter((t) => !t.excluded);
  const excludedCount = txns.length - included.length;
  // Linked transactions (e.g. rent + a roommate's reimbursement) count as
  // one net entry, not as separate expense and transfer amounts.
  const effective = computeEffectiveTransactions(included);

  const expenseTxns = effective.filter((t) => t.isDebit && !NON_EXPENSE_CATEGORIES.includes(t.category));
  const incomeTxns = effective.filter((t) => !t.isDebit && t.category === 'Income');
  const transferTxns = effective.filter((t) => t.category === 'Transfers');

  const totalExpense = expenseTxns.reduce((sum, t) => sum + t.amount, 0);
  const totalIncome = incomeTxns.reduce((sum, t) => sum + t.amount, 0);
  const totalTransfers = transferTxns.reduce((sum, t) => sum + t.amount, 0);
  const net = totalIncome - totalExpense;

  const { start, end } = computeDateBounds();
  const rangeLabel = start && end ? `${formatDateDisplay(start)} – ${formatDateDisplay(end)}` : 'all time';
  const excludedNote = excludedCount > 0 ? ` · ${excludedCount} excluded` : '';

  el.totalSpending.textContent = formatCurrency(totalExpense);
  el.totalMeta.textContent = `${expenseTxns.length} transaction${expenseTxns.length === 1 ? '' : 's'} · ${rangeLabel}${excludedNote}`;

  el.totalIncome.textContent = formatCurrency(totalIncome);
  el.incomeMeta.textContent = `${incomeTxns.length} transaction${incomeTxns.length === 1 ? '' : 's'} · ${rangeLabel}`;

  el.netCashflow.textContent = `${net >= 0 ? '+' : '-'}${formatCurrency(Math.abs(net))}`;
  el.netCashflow.className = 'summary-value ' + (net >= 0 ? 'value-credit' : 'value-debit');
  el.netMeta.textContent = totalTransfers > 0
    ? `${formatCurrency(totalTransfers)} moved in transfers (not counted as income or spending)`
    : rangeLabel;

  const byCategory = new Map();
  for (const t of expenseTxns) {
    byCategory.set(t.category, (byCategory.get(t.category) || 0) + t.amount);
  }
  const toChartItem = ([label, value]) => ({ label, value, color: CATEGORY_COLORS[label] || '#9ca3af' });
  const essentialItems = [...byCategory.entries()]
    .filter(([label]) => isEssential(label)).map(toChartItem).sort((a, b) => b.value - a.value);
  const nonEssentialItems = [...byCategory.entries()]
    .filter(([label]) => !isEssential(label)).map(toChartItem).sort((a, b) => b.value - a.value);
  renderCategoryBars(el.categoryChart, essentialItems, nonEssentialItems, totalExpense);

  const byMonth = new Map();
  for (const t of expenseTxns) {
    const ym = t.date.slice(0, 7);
    entry(byMonth, ym).expense += t.amount;
  }
  for (const t of incomeTxns) {
    const ym = t.date.slice(0, 7);
    entry(byMonth, ym).income += t.amount;
  }
  const monthItems = [...byMonth.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([ym, v]) => ({ label: monthLabel(ym), income: v.income, expense: v.expense }));
  renderCashFlowBars(el.cashflowChart, monthItems);

  const tableTxns = applyTableFilters(txns);
  lastTableTxnKeys = tableTxns.map((t) => t.key);
  renderBulkEditBar(tableTxns);
  renderLinkBar();
  renderTable(tableTxns);
  renderTrendSection();
}

function renderBulkEditBar(tableTxns) {
  const narrowed = searchTerm !== '' || tableCategoryFilters.size > 0 || tableTypeFilter !== 'all' ||
    tableMinAmount !== '' || tableAmountSearch !== '';

  el.bulkEditBar.hidden = !narrowed || tableTxns.length === 0;
  if (!el.bulkEditBar.hidden) {
    el.bulkEditCount.textContent = `${tableTxns.length} transaction${tableTxns.length === 1 ? '' : 's'} shown —`;
  }
}

function renderLinkBar() {
  const selected = [...linkSelection].map(findTxn).filter(Boolean);
  el.linkBar.hidden = selected.length < 2;
  if (selected.length < 2) return;

  const net = selected.reduce((sum, t) => sum + (t.isDebit ? t.amount : -t.amount), 0);
  const primary = selected.reduce((a, b) => (Math.abs(b.amount) > Math.abs(a.amount) ? b : a));

  el.linkCount.textContent = `${selected.length} transactions selected —`;
  el.linkNet.textContent = `net ${net >= 0 ? '-' : '+'}${formatCurrency(Math.abs(net))} as ${primary.category}`;
}

function addMonthsYM(ym, delta) {
  let [y, m] = ym.split('-').map(Number);
  m += delta;
  while (m < 1) { m += 12; y -= 1; }
  while (m > 12) { m -= 12; y += 1; }
  return `${y}-${String(m).padStart(2, '0')}`;
}

function computeTrendMonths(period, expenseTxns) {
  const curYM = todayISO().slice(0, 7);
  let startYM, endYM;

  switch (period) {
    case 'last6': startYM = addMonthsYM(curYM, -5); endYM = curYM; break;
    case 'last12': startYM = addMonthsYM(curYM, -11); endYM = curYM; break;
    case 'thisYear': startYM = curYM.slice(0, 4) + '-01'; endYM = curYM; break;
    case 'lastYear': {
      const y = parseInt(curYM.slice(0, 4), 10) - 1;
      startYM = `${y}-01`; endYM = `${y}-12`;
      break;
    }
    case 'all':
    default: {
      if (expenseTxns.length === 0) return [];
      const yms = expenseTxns.map((t) => t.date.slice(0, 7));
      startYM = yms.reduce((a, b) => (a < b ? a : b));
      endYM = yms.reduce((a, b) => (a > b ? a : b));
      break;
    }
  }

  const months = [];
  for (let cursor = startYM; cursor <= endYM; cursor = addMonthsYM(cursor, 1)) months.push(cursor);
  return months;
}

function renderTrendSection() {
  const selectedCategories = [el.trendCategory1.value, el.trendCategory2.value, el.trendCategory3.value]
    .filter((c) => c !== 'none');

  // Independent of the top date-range/search filter — this chart has its
  // own period control — but still respects exclusions and links.
  const effective = computeEffectiveTransactions(allTransactions().filter((t) => !t.excluded));
  const expenseTxns = effective.filter((t) => t.isDebit && !NON_EXPENSE_CATEGORIES.includes(t.category));

  const months = computeTrendMonths(trendPeriod, expenseTxns);

  const byCategoryMonth = new Map();
  for (const t of expenseTxns) {
    if (!selectedCategories.includes(t.category)) continue;
    if (!byCategoryMonth.has(t.category)) byCategoryMonth.set(t.category, new Map());
    const m = byCategoryMonth.get(t.category);
    const ym = t.date.slice(0, 7);
    m.set(ym, (m.get(ym) || 0) + t.amount);
  }

  const series = selectedCategories.map((cat) => ({
    label: cat,
    color: CATEGORY_COLORS[cat] || '#9ca3af',
    values: months.map((ym) => byCategoryMonth.get(cat)?.get(ym) || 0),
  }));
  const monthObjs = months.map((ym) => ({ key: ym, label: monthLabel(ym) }));

  renderTrendChart(el.trendChart, monthObjs, series);
}

function entry(map, key) {
  if (!map.has(key)) map.set(key, { income: 0, expense: 0 });
  return map.get(key);
}

function renderRulesControl() {
  el.resetRules.hidden = rules.length === 0;
  if (!el.resetRules.hidden) {
    el.resetRules.textContent = `Reset ${rules.length} learned correction${rules.length === 1 ? '' : 's'}`;
  }
  el.undoResetRules.hidden = !lastClearedRules;
}

function renderCategoryChips() {
  for (const chip of el.tableCategoryChips.children) {
    chip.classList.toggle('active', tableCategoryFilters.has(chip.textContent));
  }
}

function renderFileErrors() {
  el.fileErrors.innerHTML = '';
  fileErrors.forEach((err) => {
    const div = document.createElement('div');
    div.className = 'banner banner-error';
    div.textContent = `${err.fileName}: ${err.message}`;
    el.fileErrors.appendChild(div);
  });
  fileNotices.forEach((note) => {
    const div = document.createElement('div');
    div.className = 'banner banner-info';
    div.textContent = `${note.fileName}: ${note.message}`;
    el.fileErrors.appendChild(div);
  });
}

function renderFileList() {
  el.fileListToggle.hidden = files.length === 0;
  if (files.length > 0) {
    el.fileListToggleLabel.textContent =
      `${files.length} statement${files.length === 1 ? '' : 's'} uploaded`;
    el.fileListChevron.textContent = fileListCollapsed ? '▸' : '▾';
  }
  el.fileList.hidden = files.length > 0 && fileListCollapsed;

  el.fileList.innerHTML = '';
  files.forEach((f) => {
    const row = document.createElement('div');
    row.className = 'file-row';

    const info = document.createElement('div');
    info.className = 'file-info';
    const name = document.createElement('span');
    name.className = 'file-name';
    name.textContent = f.fileName;
    const count = document.createElement('span');
    count.className = 'file-count';
    count.textContent = `${f.transactions.length} transaction${f.transactions.length === 1 ? '' : 's'}`;
    info.append(name, count);

    if (f.warnings?.length) {
      const warn = document.createElement('div');
      warn.className = 'file-warning';
      warn.textContent = f.warnings.join(' ');
      info.appendChild(warn);
    }

    const kindSelect = document.createElement('select');
    kindSelect.className = 'kind-select';
    kindSelect.title = 'Statement type — flip this if amounts look inverted';
    [['bank_account', 'Bank / checking account'], ['credit_card', 'Credit card']].forEach(([val, label]) => {
      const opt = document.createElement('option');
      opt.value = val;
      opt.textContent = label;
      if (f.accountKind === val) opt.selected = true;
      kindSelect.appendChild(opt);
    });
    kindSelect.addEventListener('change', () => setAccountKind(f.id, kindSelect.value));

    const removeBtn = document.createElement('button');
    removeBtn.className = 'icon-btn danger';
    removeBtn.textContent = '✕';
    removeBtn.title = 'Remove this statement';
    removeBtn.addEventListener('click', () => removeFile(f.id));

    row.append(info, kindSelect, removeBtn);
    el.fileList.appendChild(row);
  });
}

function compareTxnsBy(a, b, column) {
  switch (column) {
    case 'description': return a.description.localeCompare(b.description);
    case 'category': return a.category.localeCompare(b.category);
    case 'amount': return a.amount - b.amount;
    case 'date':
    default: return a.date.localeCompare(b.date);
  }
}

function renderSortIndicators() {
  document.querySelectorAll('th.sortable').forEach((th) => {
    const active = th.dataset.sort === tableSortColumn;
    th.classList.toggle('sort-active', active);
    th.querySelector('.sort-indicator').textContent = active ? (tableSortDirection === 'asc' ? '▲' : '▼') : '';
  });
}

function renderTable(txns) {
  el.txnBody.innerHTML = '';
  renderSortIndicators();
  const dir = tableSortDirection === 'asc' ? 1 : -1;
  const sorted = [...txns].sort((a, b) => dir * compareTxnsBy(a, b, tableSortColumn));

  if (sorted.length === 0) {
    const tr = document.createElement('tr');
    const td = document.createElement('td');
    td.colSpan = 7;
    td.className = 'table-empty';
    td.textContent = 'No transactions match the current filters.';
    tr.appendChild(td);
    el.txnBody.appendChild(tr);
    return;
  }

  for (const t of sorted) {
    const tr = document.createElement('tr');
    const counted = !t.linkedId && affectsTotals(t);
    const classes = [];
    if (t.linkedId) classes.push('row-linked');
    else if (!counted) classes.push('row-not-counted');
    if (t.excluded) classes.push('row-excluded');
    if (classes.length) tr.className = classes.join(' ');

    const dateTd = document.createElement('td');
    dateTd.textContent = formatDateDisplay(t.date);

    const descTd = document.createElement('td');
    descTd.className = 'desc-cell';
    descTd.textContent = t.description;
    descTd.title = t.description;

    const catTd = document.createElement('td');
    const select = document.createElement('select');
    select.className = 'category-select';
    CATEGORIES.forEach((c) => {
      const opt = document.createElement('option');
      opt.value = c;
      opt.textContent = c;
      if (t.category === c) opt.selected = true;
      select.appendChild(opt);
    });
    applyCategoryColor(select, t.category);
    select.addEventListener('change', () => {
      applyCategoryColor(select, select.value);
      setCategory(t.key, select.value);
    });
    catTd.appendChild(select);

    const amtTd = document.createElement('td');
    amtTd.className = counted ? (t.isDebit ? 'amount-debit' : 'amount-credit') : 'amount-neutral';
    const amtText = document.createElement('span');
    amtText.textContent = `${t.isDebit ? '-' : '+'}${formatCurrency(t.amount)}`;
    const flipBtn = document.createElement('button');
    flipBtn.className = 'flip-sign-btn';
    flipBtn.textContent = '⇄';
    flipBtn.title = `Flip to ${t.isDebit ? '+' : '-'}${formatCurrency(t.amount)} — use this if the statement got the sign wrong`;
    flipBtn.setAttribute('aria-label', `Flip the sign of "${t.description}"`);
    flipBtn.addEventListener('click', () => flipSign(t.key));
    amtTd.append(amtText, flipBtn);

    const inclTd = document.createElement('td');
    inclTd.className = 'include-cell';
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = !t.excluded;
    checkbox.title = 'Include in totals and charts above';
    checkbox.setAttribute('aria-label', `Include "${t.description}" in totals`);
    checkbox.addEventListener('change', () => setExcluded(t.key, !checkbox.checked));
    inclTd.appendChild(checkbox);

    const linkTd = document.createElement('td');
    linkTd.className = 'link-cell';
    if (t.linkedId) {
      const others = allTransactions().filter((x) => x.linkedId === t.linkedId && x.key !== t.key);
      const othersDesc = others
        .map((o) => `${o.description} (${o.isDebit ? '-' : '+'}${formatCurrency(o.amount)})`)
        .join('; ');
      const unlinkBtn = document.createElement('button');
      unlinkBtn.className = 'unlink-btn';
      unlinkBtn.textContent = '🔗';
      unlinkBtn.title = `Linked with: ${othersDesc}. Click to remove this transaction from the link.`;
      unlinkBtn.setAttribute('aria-label', `Unlink "${t.description}"`);
      unlinkBtn.addEventListener('click', () => unlink(t.key));
      linkTd.appendChild(unlinkBtn);
    } else {
      const linkCheckbox = document.createElement('input');
      linkCheckbox.type = 'checkbox';
      linkCheckbox.checked = linkSelection.has(t.key);
      linkCheckbox.title = 'Select to link with another transaction (e.g. a reimbursement or a refund)';
      linkCheckbox.setAttribute('aria-label', `Select "${t.description}" for linking`);
      linkCheckbox.addEventListener('change', () => {
        if (linkCheckbox.checked) linkSelection.add(t.key);
        else linkSelection.delete(t.key);
        renderLinkBar();
      });
      linkTd.appendChild(linkCheckbox);
    }

    const srcTd = document.createElement('td');
    srcTd.className = 'source-cell';
    srcTd.textContent = t.sourceFile;

    tr.append(dateTd, descTd, catTd, amtTd, inclTd, linkTd, srcTd);
    el.txnBody.appendChild(tr);
  }
}

function applyCategoryColor(select, category) {
  const color = CATEGORY_COLORS[category] || '#9ca3af';
  select.style.borderLeft = `4px solid ${color}`;
  select.style.background = `color-mix(in srgb, ${color} 16%, var(--bg))`;
}

function loadFiles() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    let migrated = false;

    const RETIRED_CATEGORIES = {
      'Income & Transfers': 'Transfers',
      'Bills & Utilities': 'Utilities',
      'Health & Fitness': 'Health Expense',
    };

    parsed.forEach((f) => f.transactions?.forEach((t) => {
      if (t.excluded === undefined) {
        t.excluded = false;
        migrated = true;
      }
      if (t.signFlipped === undefined) {
        t.signFlipped = false;
        migrated = true;
      }
      if (t.linkedId === undefined) {
        t.linkedId = null;
        migrated = true;
      }
      // Earlier versions of this app used category names that have since
      // been split into more specific ones; re-derive them for anything
      // auto-categorized (we can't know which sub-category was meant for
      // a manually-set one, so fall back to a reasonable default there).
      const fallback = RETIRED_CATEGORIES[t.category];
      if (fallback) {
        t.category = t.manualCategory ? fallback : categorize(t.description, t.isDebit);
        migrated = true;
      }
    }));

    // One-time cleanup: collapse exact duplicates (same date, description,
    // and amount) that may already be sitting in storage from before
    // duplicate detection existed — e.g. the same statement uploaded twice,
    // or the same transaction appearing in two overlapping exports. The
    // first occurrence (in file-upload order) wins; later ones are dropped.
    const seenSignatures = new Set();
    parsed.forEach((f) => {
      const before = f.transactions.length;
      f.transactions = f.transactions.filter((t) => {
        const sig = dupSignature(t.date, t.description, t.amount, t.isDebit);
        if (seenSignatures.has(sig)) return false;
        seenSignatures.add(sig);
        return true;
      });
      if (f.transactions.length !== before) migrated = true;
    });

    if (migrated) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(parsed));
    }

    return parsed;
  } catch (e) {
    console.error('Failed to load saved statements', e);
    return [];
  }
}

function saveFiles() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(files));
  } catch (e) {
    console.error('Failed to save statements to localStorage', e);
  }
}

function uid() {
  return 'f_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
}
