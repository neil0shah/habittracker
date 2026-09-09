import { parseStatementFile } from './statementParser.js';
import { renderNetWorthChart, renderAccountBars } from './charts.js';

const STORAGE_KEY = 'netWorth.v1.accounts';

const INSTITUTION_COLORS = {
  'Bank of America': '#dc2626',
  'Robinhood': '#22a06b',
  'Transamerica': '#2563eb',
  'Other': '#9ca3af',
};

/** @type {Array<{
 *   id: string, key: string, name: string, institution: string,
 *   kind: 'asset'|'liability',
 *   snapshots: Array<{id: string, date: string, balance: number, source: 'pdf'|'manual', fileName?: string}>
 * }>} */
let accounts = loadAccounts();
let fileErrors = []; // transient: [{fileName, message}]

const el = {
  dropZone: document.getElementById('drop-zone'),
  fileInput: document.getElementById('file-input'),
  fileErrors: document.getElementById('file-errors'),
  summary: document.getElementById('summary'),
  netWorthValue: document.getElementById('net-worth-value'),
  netWorthMeta: document.getElementById('net-worth-meta'),
  totalAssets: document.getElementById('total-assets'),
  assetsMeta: document.getElementById('assets-meta'),
  totalLiabilities: document.getElementById('total-liabilities'),
  liabilitiesMeta: document.getElementById('liabilities-meta'),
  chartSection: document.getElementById('chart-section'),
  netWorthChart: document.getElementById('net-worth-chart'),
  accountChart: document.getElementById('account-chart'),
  accountsSection: document.getElementById('accounts-section'),
  accountList: document.getElementById('account-list'),
  emptyState: document.getElementById('empty-state'),
  addAccountForm: document.getElementById('add-account-form'),
  newAccountInstitution: document.getElementById('new-account-institution'),
  newAccountName: document.getElementById('new-account-name'),
  newAccountKind: document.getElementById('new-account-kind'),
};

init();

function init() {
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

  el.addAccountForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const name = el.newAccountName.value.trim();
    if (!name) return;

    accounts.push({
      id: uid(),
      key: `manual:${uid()}`,
      name,
      institution: el.newAccountInstitution.value,
      kind: el.newAccountKind.value,
      snapshots: [],
    });
    saveAccounts();
    el.newAccountName.value = '';
    render();
  });

  render();
}

async function handleFiles(fileListLike) {
  const files = Array.from(fileListLike);
  fileErrors = [];

  for (const file of files) {
    const result = await parseStatementFile(file);

    if (result.error) {
      fileErrors.push({ fileName: file.name, message: result.error });
      continue;
    }

    let account = accounts.find((a) => a.key === result.accountKey);
    if (!account) {
      account = {
        id: uid(),
        key: result.accountKey,
        name: result.accountLabel,
        institution: result.institution,
        kind: result.kind,
        snapshots: [],
      };
      accounts.push(account);
    }

    upsertSnapshot(account, { date: result.date, balance: result.balance, source: 'pdf', fileName: result.fileName });
  }

  saveAccounts();
  el.fileInput.value = '';
  render();
}

// An account can only have one true balance on a given date — uploading a
// statement whose date matches an existing snapshot (e.g. re-uploading the
// same file, or a corrected restatement) replaces it rather than creating a
// second entry for that date.
function upsertSnapshot(account, snapshot) {
  const existingIdx = account.snapshots.findIndex((s) => s.date === snapshot.date);
  if (existingIdx >= 0) {
    account.snapshots[existingIdx] = { ...account.snapshots[existingIdx], ...snapshot };
  } else {
    account.snapshots.push({ id: uid(), ...snapshot });
  }
  account.snapshots.sort((a, b) => a.date.localeCompare(b.date));
}

function deleteAccount(accountId) {
  const account = accounts.find((a) => a.id === accountId);
  if (!account) return;
  if (!confirm(`Remove "${account.name}" and all ${account.snapshots.length} of its balance snapshots?`)) return;
  accounts = accounts.filter((a) => a.id !== accountId);
  saveAccounts();
  render();
}

function deleteSnapshot(accountId, snapshotId) {
  const account = accounts.find((a) => a.id === accountId);
  if (!account) return;
  account.snapshots = account.snapshots.filter((s) => s.id !== snapshotId);
  saveAccounts();
  render();
}

function renameAccount(accountId, name) {
  const account = accounts.find((a) => a.id === accountId);
  if (!account || !name.trim()) return;
  account.name = name.trim();
  saveAccounts();
}

function setAccountKind(accountId, kind) {
  const account = accounts.find((a) => a.id === accountId);
  if (!account) return;
  account.kind = kind;
  saveAccounts();
  render();
}

function editSnapshot(accountId, snapshotId, field, value) {
  const account = accounts.find((a) => a.id === accountId);
  const snapshot = account?.snapshots.find((s) => s.id === snapshotId);
  if (!snapshot) return;

  if (field === 'balance') {
    const num = parseFloat(value);
    if (isNaN(num) || num < 0) return;
    snapshot.balance = num;
  } else if (field === 'date') {
    if (!value) return;
    snapshot.date = value;
    account.snapshots.sort((a, b) => a.date.localeCompare(b.date));
  }
  saveAccounts();
  render();
}

function addManualSnapshot(accountId, date, balance) {
  const account = accounts.find((a) => a.id === accountId);
  if (!account || !date) return;
  const num = parseFloat(balance);
  if (isNaN(num) || num < 0) return;
  upsertSnapshot(account, { date, balance: num, source: 'manual' });
  saveAccounts();
  render();
}

// The latest known balance for an account as of (on or before) `date`,
// carried forward from its most recent snapshot. This — not trying to
// match up transfers between accounts — is what keeps a transfer from
// being double-counted: each account's own balance already reflects money
// moving in or out of it, so summing accounts' latest balances at a given
// moment is already the correct total.
function balanceAsOf(account, date) {
  let latest = null;
  for (const s of account.snapshots) {
    if (s.date <= date && (!latest || s.date > latest.date)) latest = s;
  }
  return latest ? latest.balance : null;
}

function computeCheckpoints() {
  const allDates = new Set();
  accounts.forEach((a) => a.snapshots.forEach((s) => allDates.add(s.date)));
  const sorted = [...allDates].sort();

  return sorted.map((date) => {
    let assets = 0, liabilities = 0;
    for (const account of accounts) {
      const bal = balanceAsOf(account, date);
      if (bal === null) continue;
      if (account.kind === 'liability') liabilities += bal;
      else assets += bal;
    }
    return { date, assets, liabilities, netWorth: assets - liabilities };
  });
}

function formatCurrency(n) {
  return n.toLocaleString(undefined, { style: 'currency', currency: 'USD' });
}

function formatDateDisplay(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function render() {
  renderFileErrors();

  const hasAccounts = accounts.length > 0;
  el.summary.hidden = !hasAccounts;
  el.chartSection.hidden = !hasAccounts;
  el.accountsSection.hidden = !hasAccounts;
  el.emptyState.hidden = hasAccounts;

  if (!hasAccounts) return;

  const checkpoints = computeCheckpoints();
  renderSummary(checkpoints);
  renderCharts(checkpoints);
  renderAccountList();
}

function renderSummary(checkpoints) {
  const latest = checkpoints[checkpoints.length - 1];
  const asOf = latest ? `as of ${formatDateDisplay(latest.date)}` : 'no balances yet';

  el.netWorthValue.textContent = latest ? formatCurrency(latest.netWorth) : '$0.00';
  el.netWorthValue.className = 'summary-value ' + (latest && latest.netWorth < 0 ? 'value-debit' : 'value-credit');
  el.netWorthMeta.textContent = asOf;

  el.totalAssets.textContent = latest ? formatCurrency(latest.assets) : '$0.00';
  el.assetsMeta.textContent = asOf;

  el.totalLiabilities.textContent = latest ? formatCurrency(latest.liabilities) : '$0.00';
  el.liabilitiesMeta.textContent = asOf;
}

function renderCharts(checkpoints) {
  const points = checkpoints.map((c) => ({ key: c.date, label: formatDateDisplay(c.date) }));
  const series = [
    { label: 'Net Worth', color: '#4f46e5', values: checkpoints.map((c) => c.netWorth) },
    { label: 'Assets', color: '#22a06b', values: checkpoints.map((c) => c.assets), dashed: true },
    { label: 'Liabilities', color: '#dc2626', values: checkpoints.map((c) => c.liabilities), dashed: true },
  ];
  renderNetWorthChart(el.netWorthChart, points, series);

  const latest = checkpoints[checkpoints.length - 1];
  const toItem = (a) => ({
    label: a.name,
    value: balanceAsOf(a, latest.date) || 0,
    color: INSTITUTION_COLORS[a.institution] || INSTITUTION_COLORS.Other,
  });
  const assetItems = accounts.filter((a) => a.kind === 'asset' && balanceAsOf(a, latest.date)).map(toItem)
    .sort((a, b) => b.value - a.value);
  const liabilityItems = accounts.filter((a) => a.kind === 'liability' && balanceAsOf(a, latest.date)).map(toItem)
    .sort((a, b) => b.value - a.value);
  renderAccountBars(el.accountChart, assetItems, liabilityItems);
}

function renderAccountList() {
  el.accountList.innerHTML = '';

  const sorted = [...accounts].sort((a, b) => a.name.localeCompare(b.name));

  for (const account of sorted) {
    const card = document.createElement('div');
    card.className = 'account-card';

    const header = document.createElement('div');
    header.className = 'account-header';

    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.className = 'account-name-input';
    nameInput.value = account.name;
    nameInput.maxLength = 60;
    nameInput.addEventListener('change', () => renameAccount(account.id, nameInput.value));

    const badge = document.createElement('span');
    badge.className = 'institution-badge';
    badge.style.setProperty('--badge-color', INSTITUTION_COLORS[account.institution] || INSTITUTION_COLORS.Other);
    badge.textContent = account.institution;

    const kindSelect = document.createElement('select');
    kindSelect.className = 'kind-select';
    [['asset', 'Asset'], ['liability', 'Liability']].forEach(([val, label]) => {
      const opt = document.createElement('option');
      opt.value = val;
      opt.textContent = label;
      if (account.kind === val) opt.selected = true;
      kindSelect.appendChild(opt);
    });
    kindSelect.addEventListener('change', () => setAccountKind(account.id, kindSelect.value));

    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'icon-btn danger';
    deleteBtn.textContent = '✕';
    deleteBtn.title = 'Remove this account';
    deleteBtn.addEventListener('click', () => deleteAccount(account.id));

    header.append(nameInput, badge, kindSelect, deleteBtn);
    card.appendChild(header);

    const latestBalance = account.snapshots[account.snapshots.length - 1];
    const currentEl = document.createElement('div');
    currentEl.className = 'account-current';
    currentEl.textContent = latestBalance
      ? `${formatCurrency(latestBalance.balance)} as of ${formatDateDisplay(latestBalance.date)}`
      : 'No balance yet';
    card.appendChild(currentEl);

    if (account.snapshots.length > 0) {
      const table = document.createElement('table');
      table.className = 'snapshot-table';
      const thead = document.createElement('thead');
      thead.innerHTML = '<tr><th>Date</th><th>Balance</th><th>Source</th><th></th></tr>';
      table.appendChild(thead);

      const tbody = document.createElement('tbody');
      [...account.snapshots].reverse().forEach((s) => {
        const tr = document.createElement('tr');

        const dateTd = document.createElement('td');
        const dateInput = document.createElement('input');
        dateInput.type = 'date';
        dateInput.value = s.date;
        dateInput.addEventListener('change', () => editSnapshot(account.id, s.id, 'date', dateInput.value));
        dateTd.appendChild(dateInput);

        const balTd = document.createElement('td');
        const balInput = document.createElement('input');
        balInput.type = 'number';
        balInput.min = '0';
        balInput.step = '0.01';
        balInput.value = s.balance.toFixed(2);
        balInput.addEventListener('change', () => editSnapshot(account.id, s.id, 'balance', balInput.value));
        balTd.appendChild(balInput);

        const srcTd = document.createElement('td');
        srcTd.className = 'source-cell';
        srcTd.textContent = s.source === 'pdf' ? (s.fileName || 'PDF') : 'Manual';

        const delTd = document.createElement('td');
        const delBtn = document.createElement('button');
        delBtn.className = 'icon-btn danger';
        delBtn.textContent = '✕';
        delBtn.title = 'Remove this balance snapshot';
        delBtn.addEventListener('click', () => deleteSnapshot(account.id, s.id));
        delTd.appendChild(delBtn);

        tr.append(dateTd, balTd, srcTd, delTd);
        tbody.appendChild(tr);
      });
      table.appendChild(tbody);
      card.appendChild(table);
    }

    const addForm = document.createElement('form');
    addForm.className = 'add-snapshot-form';
    addForm.innerHTML = `
      <input type="date" class="snap-date" required>
      <input type="number" class="snap-balance" placeholder="Balance" min="0" step="0.01" required>
      <button type="submit" class="btn btn-outline">Add balance</button>
    `;
    addForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const date = addForm.querySelector('.snap-date').value;
      const balance = addForm.querySelector('.snap-balance').value;
      addManualSnapshot(account.id, date, balance);
    });
    card.appendChild(addForm);

    el.accountList.appendChild(card);
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
}

function loadAccounts() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (e) {
    console.error('Failed to load saved accounts', e);
    return [];
  }
}

function saveAccounts() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(accounts));
  } catch (e) {
    console.error('Failed to save accounts to localStorage', e);
  }
}

function uid() {
  return 'a_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
}
