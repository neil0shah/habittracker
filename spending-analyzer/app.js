import { parsePdfFile } from './pdfParser.js';
import { categorize, CATEGORIES, CATEGORY_COLORS } from './categorizer.js';
import { renderCategoryBars, renderMonthlyBars } from './charts.js';

const STORAGE_KEY = 'spendingAnalyzer.v1.files';

/** @type {Array<{
 *   id: string, fileName: string, uploadedAt: string,
 *   accountKind: 'credit_card'|'bank_account', detectedType: string,
 *   warnings: string[],
 *   transactions: Array<{key:string, date:string, description:string,
 *     amount:number, isDebit:boolean, category:string, manualCategory:boolean}>
 * }>} */
let files = loadFiles();
let fileErrors = []; // transient, not persisted: [{fileName, message}]
let searchTerm = '';
let datePreset = 'all';
let customStart = '';
let customEnd = '';

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
  summary: document.getElementById('summary'),
  totalSpending: document.getElementById('total-spending'),
  totalMeta: document.getElementById('total-meta'),
  categoryChart: document.getElementById('category-chart'),
  monthlyChart: document.getElementById('monthly-chart'),
  chartsSection: document.getElementById('charts-section'),
  tableSection: document.getElementById('table-section'),
  txnBody: document.getElementById('txn-body'),
  emptyState: document.getElementById('empty-state'),
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
    if (confirm('Remove all uploaded statements and category edits from this browser?')) {
      files = [];
      saveFiles();
      render();
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
  const isDebit = spendIsPositive ? parsed.rawAmount > 0 : parsed.rawAmount < 0;
  const amount = Math.abs(parsed.rawAmount);
  const key = makeStableKey(parsed.date, parsed.description, amount, fileName);
  const override = findOverride(key);

  return {
    key,
    date: parsed.date,
    description: parsed.description,
    amount,
    isDebit,
    category: override || categorize(parsed.description, isDebit),
    manualCategory: !!override,
  };
}

function findOverride(key) {
  for (const f of files) {
    const match = f.transactions?.find((t) => t.key === key && t.manualCategory);
    if (match) return match.category;
  }
  return null;
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
  for (const f of files) {
    const t = f.transactions.find((x) => x.key === txnKey);
    if (t) {
      t.category = category;
      t.manualCategory = true;
      break;
    }
  }
  saveFiles();
  render();
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

  const hasFiles = files.length > 0;
  el.filterBar.hidden = !hasFiles;
  el.summary.hidden = !hasFiles;
  el.chartsSection.hidden = !hasFiles;
  el.tableSection.hidden = !hasFiles;
  el.emptyState.hidden = hasFiles;

  if (!hasFiles) return;

  const txns = filteredTransactions();
  const spendTxns = txns.filter((t) => t.isDebit && t.category !== 'Income & Transfers');
  const total = spendTxns.reduce((sum, t) => sum + t.amount, 0);

  el.totalSpending.textContent = formatCurrency(total);
  const { start, end } = computeDateBounds();
  const rangeLabel = start && end ? `${formatDateDisplay(start)} – ${formatDateDisplay(end)}` : 'all time';
  el.totalMeta.textContent = `${spendTxns.length} transaction${spendTxns.length === 1 ? '' : 's'} · ${rangeLabel}`;

  const byCategory = new Map();
  for (const t of spendTxns) {
    byCategory.set(t.category, (byCategory.get(t.category) || 0) + t.amount);
  }
  const categoryItems = [...byCategory.entries()]
    .map(([label, value]) => ({ label, value, color: CATEGORY_COLORS[label] || '#9ca3af' }))
    .sort((a, b) => b.value - a.value);
  renderCategoryBars(el.categoryChart, categoryItems, total);

  const byMonth = new Map();
  for (const t of spendTxns) {
    const ym = t.date.slice(0, 7);
    byMonth.set(ym, (byMonth.get(ym) || 0) + t.amount);
  }
  const monthItems = [...byMonth.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([ym, value]) => ({ label: monthLabel(ym), value }));
  renderMonthlyBars(el.monthlyChart, monthItems);

  renderTable(txns);
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
    td.colSpan = 5;
    td.className = 'table-empty';
    td.textContent = 'No transactions match the current filters.';
    tr.appendChild(td);
    el.txnBody.appendChild(tr);
    return;
  }

  for (const t of sorted) {
    const tr = document.createElement('tr');

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
    select.addEventListener('change', () => setCategory(t.key, select.value));
    catTd.appendChild(select);

    const amtTd = document.createElement('td');
    amtTd.className = t.isDebit ? 'amount-debit' : 'amount-credit';
    amtTd.textContent = `${t.isDebit ? '-' : '+'}${formatCurrency(t.amount)}`;

    const srcTd = document.createElement('td');
    srcTd.className = 'source-cell';
    srcTd.textContent = t.sourceFile;

    tr.append(dateTd, descTd, catTd, amtTd, srcTd);
    el.txnBody.appendChild(tr);
  }
}

function loadFiles() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
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
