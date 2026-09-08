import { parsePdfFile } from './pdfParser.js';
import { categorize, CATEGORIES, CATEGORY_COLORS, NON_EXPENSE_CATEGORIES, isEssential } from './categorizer.js';
import { renderCategoryBars, renderCashFlowBars } from './charts.js';
import { loadRules, saveRules, upsertRule, applyRules, normalizeDescription } from './rules.js';

const STORAGE_KEY = 'spendingAnalyzer.v1.files';

/** @type {Array<{
 *   id: string, fileName: string, uploadedAt: string,
 *   accountKind: 'credit_card'|'bank_account', detectedType: string,
 *   warnings: string[],
 *   transactions: Array<{key:string, date:string, description:string,
 *     amount:number, isDebit:boolean, category:string, manualCategory:boolean,
 *     excluded:boolean, signFlipped:boolean}>
 * }>} */
let files = loadFiles();
// Learned corrections (category fixes, sign fixes) — stored separately from
// `files` so they survive "Clear all data" and generalize to future uploads.
let rules = loadRules();
let fileErrors = []; // transient, not persisted: [{fileName, message}]
let searchTerm = '';
let datePreset = 'all';
let customStart = '';
let customEnd = '';
let tableCategoryFilter = 'all';
let tableTypeFilter = 'all';
let tableMinAmount = '';
let tableMaxAmount = '';
let lastTableTxnKeys = []; // keys currently shown in the table, for bulk-edit

const el = {
  dropZone: document.getElementById('drop-zone'),
  fileInput: document.getElementById('file-input'),
  fileErrors: document.getElementById('file-errors'),
  fileList: document.getElementById('file-list'),
  filterBar: document.getElementById('filter-bar'),
  datePreset: document.getElementById('date-preset'),
  customRange: document.getElementById('custom-range'),
  customStart: document.getElementById('custom-start'),
  customEnd: document.getElementById('custom-end'),
  search: document.getElementById('search'),
  clearAll: document.getElementById('clear-all'),
  resetRules: document.getElementById('reset-rules'),
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
  tableCategoryFilter: document.getElementById('table-category-filter'),
  tableTypeFilter: document.getElementById('table-type-filter'),
  tableMinAmount: document.getElementById('table-min-amount'),
  tableMaxAmount: document.getElementById('table-max-amount'),
  tableFilterClear: document.getElementById('table-filter-clear'),
  bulkEditBar: document.getElementById('bulk-edit-bar'),
  bulkEditCount: document.getElementById('bulk-edit-count'),
  bulkEditCategory: document.getElementById('bulk-edit-category'),
  bulkEditApply: document.getElementById('bulk-edit-apply'),
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
    if (confirm(`Forget all ${rules.length} learned category/sign correction${rules.length === 1 ? '' : 's'}? This can't be undone.`)) {
      rules = [];
      saveRules(rules);
      render();
    }
  });

  CATEGORIES.forEach((c) => {
    const opt1 = document.createElement('option');
    opt1.value = c;
    opt1.textContent = c;
    el.tableCategoryFilter.appendChild(opt1);

    const opt2 = document.createElement('option');
    opt2.value = c;
    opt2.textContent = c;
    el.bulkEditCategory.appendChild(opt2);
  });

  el.tableCategoryFilter.addEventListener('change', () => {
    tableCategoryFilter = el.tableCategoryFilter.value;
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
  el.tableMaxAmount.addEventListener('input', () => {
    tableMaxAmount = el.tableMaxAmount.value;
    render();
  });
  el.tableFilterClear.addEventListener('click', () => {
    tableCategoryFilter = 'all';
    tableTypeFilter = 'all';
    tableMinAmount = '';
    tableMaxAmount = '';
    el.tableCategoryFilter.value = 'all';
    el.tableTypeFilter.value = 'all';
    el.tableMinAmount.value = '';
    el.tableMaxAmount.value = '';
    render();
  });

  el.bulkEditApply.addEventListener('click', () => {
    const keys = lastTableTxnKeys;
    const category = el.bulkEditCategory.value;
    if (keys.length === 0) return;
    if (confirm(`Set category to "${category}" for ${keys.length} shown transaction${keys.length === 1 ? '' : 's'}?`)) {
      bulkSetCategory(keys, category);
    }
  });

  render();
}

async function handleFiles(fileListLike) {
  const pdfFiles = Array.from(fileListLike);
  fileErrors = [];

  for (const file of pdfFiles) {
    const result = await parsePdfFile(file);

    if (result.error) {
      fileErrors.push({ fileName: file.name, message: result.error });
      continue;
    }

    const accountKind = result.statementType === 'unknown' ? 'bank_account' : result.statementType;
    const transactions = result.transactions.map((t) => buildTransaction(t, accountKind, file.name));

    files.push({
      id: uid(),
      fileName: result.fileName,
      uploadedAt: new Date().toISOString(),
      accountKind,
      detectedType: result.statementType,
      warnings: result.warnings || [],
      transactions,
    });
  }

  saveFiles();
  el.fileInput.value = '';
  render();
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
  saveRules(rules);

  saveFiles();
  render();
}

// Whether a transaction counts toward the totals/charts above the table —
// excluded transactions never do, debits count only when their category
// isn't Income/Transfers, and credits count only when categorized Income.
function affectsTotals(t) {
  if (t.excluded) return false;
  if (t.isDebit) return !NON_EXPENSE_CATEGORIES.includes(t.category);
  return t.category === 'Income';
}

function applyTableFilters(txns) {
  const min = tableMinAmount === '' ? null : parseFloat(tableMinAmount);
  const max = tableMaxAmount === '' ? null : parseFloat(tableMaxAmount);

  return txns.filter((t) => {
    if (tableCategoryFilter !== 'all' && t.category !== tableCategoryFilter) return false;
    if (tableTypeFilter === 'debit' && !t.isDebit) return false;
    if (tableTypeFilter === 'credit' && t.isDebit) return false;
    if (min !== null && !isNaN(min) && t.amount < min) return false;
    if (max !== null && !isNaN(max) && t.amount > max) return false;
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

  const hasFiles = files.length > 0;
  el.filterBar.hidden = !hasFiles;
  el.summary.hidden = !hasFiles;
  el.chartsSection.hidden = !hasFiles;
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

  const expenseTxns = included.filter((t) => t.isDebit && !NON_EXPENSE_CATEGORIES.includes(t.category));
  const incomeTxns = included.filter((t) => !t.isDebit && t.category === 'Income');
  const transferTxns = included.filter((t) => t.category === 'Transfers');

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
  renderTable(tableTxns);
}

function renderBulkEditBar(tableTxns) {
  const narrowed = searchTerm !== '' || tableCategoryFilter !== 'all' || tableTypeFilter !== 'all' ||
    tableMinAmount !== '' || tableMaxAmount !== '';

  el.bulkEditBar.hidden = !narrowed || tableTxns.length === 0;
  if (!el.bulkEditBar.hidden) {
    el.bulkEditCount.textContent = `${tableTxns.length} transaction${tableTxns.length === 1 ? '' : 's'} shown —`;
  }
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
}

function renderFileErrors() {
  el.fileErrors.innerHTML = '';
  if (fileErrors.length === 0) return;
  fileErrors.forEach((err) => {
    const div = document.createElement('div');
    div.className = 'banner banner-error';
    div.textContent = `${err.fileName}: ${err.message}`;
    el.fileErrors.appendChild(div);
  });
}

function renderFileList() {
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

function renderTable(txns) {
  el.txnBody.innerHTML = '';
  const sorted = [...txns].sort((a, b) => b.date.localeCompare(a.date));

  if (sorted.length === 0) {
    const tr = document.createElement('tr');
    const td = document.createElement('td');
    td.colSpan = 6;
    td.className = 'table-empty';
    td.textContent = 'No transactions match the current filters.';
    tr.appendChild(td);
    el.txnBody.appendChild(tr);
    return;
  }

  for (const t of sorted) {
    const tr = document.createElement('tr');
    const counted = affectsTotals(t);
    const classes = [];
    if (!counted) classes.push('row-not-counted');
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

    const srcTd = document.createElement('td');
    srcTd.className = 'source-cell';
    srcTd.textContent = t.sourceFile;

    tr.append(dateTd, descTd, catTd, amtTd, inclTd, srcTd);
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
