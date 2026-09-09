import { categorize, CATEGORIES, CATEGORY_COLORS } from './categorizer.js';
import { loadRules, saveRules, normalizeDescription } from './rules.js';

const FILES_STORAGE_KEY = 'spendingAnalyzer.v1.files';

let rules = loadRules();
let files = loadFilesRaw();
let expandedRules = new Set();

const el = {
  summary: document.getElementById('summary'),
  totalRules: document.getElementById('total-rules'),
  totalAffected: document.getElementById('total-affected'),
  totalStale: document.getElementById('total-stale'),
  byCategorySection: document.getElementById('by-category-section'),
  byCategoryList: document.getElementById('by-category-list'),
  rulesSection: document.getElementById('rules-section'),
  rulesBody: document.getElementById('rules-body'),
  emptyState: document.getElementById('empty-state'),
};

render();

function loadFilesRaw() {
  try {
    const raw = localStorage.getItem(FILES_STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (e) {
    console.error('Failed to load statements', e);
    return [];
  }
}

function saveFilesRaw() {
  try {
    localStorage.setItem(FILES_STORAGE_KEY, JSON.stringify(files));
  } catch (e) {
    console.error('Failed to save statements', e);
  }
}

function allTransactions() {
  const out = [];
  for (const f of files) {
    for (const t of f.transactions || []) out.push(t);
  }
  return out;
}

// Mirrors rules.js's applyRules() priority: an exact match wins over any
// keyword match, and among keyword matches the most recently created (last
// in the array) wins. This is what decides which rule is actually
// governing a transaction right now, not just any rule whose pattern
// happens to appear in it.
function findAppliedRule(description) {
  const norm = normalizeDescription(description);
  const exact = rules.find((r) => r.matchType === 'exact' && r.pattern === norm);
  if (exact) return exact;
  let match = null;
  for (const r of rules) {
    if (r.matchType === 'keyword' && norm.includes(r.pattern)) match = r;
  }
  return match;
}

function baseIsDebit(t) {
  return t.signFlipped ? !t.isDebit : t.isDebit;
}

// What the built-in keyword categorizer would guess today, with the
// learned correction set aside — the "before" half of the comparison.
function originalCategoryFor(t) {
  return categorize(t.description, baseIsDebit(t));
}

function updateRuleCategory(ruleId, newCategory) {
  const rule = rules.find((r) => r.id === ruleId);
  if (!rule) return;
  rule.category = newCategory;
  saveRules(rules);

  for (const t of allTransactions()) {
    if (findAppliedRule(t.description)?.id === ruleId) {
      t.category = newCategory;
      t.manualCategory = true;
    }
  }
  saveFilesRaw();
  render();
}

function toggleRuleFlipSign(ruleId, enabled) {
  const rule = rules.find((r) => r.id === ruleId);
  if (!rule) return;
  rule.flipSign = enabled;
  saveRules(rules);

  for (const t of allTransactions()) {
    if (findAppliedRule(t.description)?.id === ruleId) {
      const base = baseIsDebit(t);
      t.isDebit = enabled ? !base : base;
      t.signFlipped = enabled;
      if (!t.manualCategory) t.category = categorize(t.description, t.isDebit);
    }
  }
  saveFilesRaw();
  render();
}

function deleteRule(ruleId) {
  const rule = rules.find((r) => r.id === ruleId);
  if (!rule) return;
  if (!confirm(
    `Remove this correction (${rule.matchType === 'exact' ? 'exact match' : 'keyword'} "${rule.pattern}")? ` +
    `Transactions it already corrected won't change, but it won't apply to future uploads.`
  )) return;
  rules = rules.filter((r) => r.id !== ruleId);
  saveRules(rules);
  render();
}

function formatCurrency(n) {
  return n.toLocaleString(undefined, { style: 'currency', currency: 'USD' });
}

function formatDateDisplay(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function render() {
  const txns = allTransactions();
  const appliedByKey = new Map();
  for (const t of txns) {
    const r = findAppliedRule(t.description);
    if (r) appliedByKey.set(t.key, r.id);
  }
  const txnsByRule = new Map();
  for (const t of txns) {
    const ruleId = appliedByKey.get(t.key);
    if (!ruleId) continue;
    if (!txnsByRule.has(ruleId)) txnsByRule.set(ruleId, []);
    txnsByRule.get(ruleId).push(t);
  }

  const hasRules = rules.length > 0;
  el.summary.hidden = !hasRules;
  el.byCategorySection.hidden = !hasRules;
  el.rulesSection.hidden = !hasRules;
  el.emptyState.hidden = hasRules;
  if (!hasRules) return;

  renderSummary(txnsByRule);
  renderByCategory(txnsByRule);
  renderRulesTable(txnsByRule);
}

function renderSummary(txnsByRule) {
  el.totalRules.textContent = String(rules.length);

  const affectedKeys = new Set();
  for (const list of txnsByRule.values()) list.forEach((t) => affectedKeys.add(t.key));
  el.totalAffected.textContent = String(affectedKeys.size);

  const staleCount = rules.filter((r) => !(txnsByRule.get(r.id)?.length)).length;
  el.totalStale.textContent = String(staleCount);
}

function renderByCategory(txnsByRule) {
  const byCategory = new Map(); // category -> { ruleCount, txnCount }
  for (const rule of rules) {
    if (!rule.category) continue;
    const entry = byCategory.get(rule.category) || { ruleCount: 0, txnCount: 0 };
    entry.ruleCount += 1;
    entry.txnCount += txnsByRule.get(rule.id)?.length || 0;
    byCategory.set(rule.category, entry);
  }

  el.byCategoryList.innerHTML = '';
  const entries = [...byCategory.entries()].sort((a, b) => b[1].txnCount - a[1].txnCount);
  if (entries.length === 0) {
    el.byCategoryList.innerHTML = '<p class="chart-empty">No category corrections yet.</p>';
    return;
  }

  const maxTxn = Math.max(...entries.map(([, v]) => v.txnCount), 1);
  entries.forEach(([category, v]) => {
    const row = document.createElement('div');
    row.className = 'by-category-row';

    const label = document.createElement('div');
    label.className = 'by-category-label';
    const dot = document.createElement('span');
    dot.className = 'cat-dot';
    dot.style.background = CATEGORY_COLORS[category] || '#9ca3af';
    label.append(dot, category);

    const track = document.createElement('div');
    track.className = 'by-category-track';
    const fill = document.createElement('div');
    fill.className = 'by-category-fill';
    fill.style.width = `${((v.txnCount / maxTxn) * 100).toFixed(1)}%`;
    fill.style.background = CATEGORY_COLORS[category] || '#9ca3af';
    track.appendChild(fill);

    const count = document.createElement('div');
    count.className = 'by-category-count';
    count.textContent = `${v.txnCount} txn${v.txnCount === 1 ? '' : 's'} · ${v.ruleCount} rule${v.ruleCount === 1 ? '' : 's'}`;

    row.append(label, track, count);
    el.byCategoryList.appendChild(row);
  });
}

function renderRulesTable(txnsByRule) {
  el.rulesBody.innerHTML = '';
  const sorted = [...rules].sort(
    (a, b) => (txnsByRule.get(b.id)?.length || 0) - (txnsByRule.get(a.id)?.length || 0)
  );

  for (const rule of sorted) {
    const matches = txnsByRule.get(rule.id) || [];
    const isStale = matches.length === 0;
    const expanded = expandedRules.has(rule.id);

    const tr = document.createElement('tr');
    tr.className = 'rule-row' + (isStale ? ' stale-row' : '');
    tr.addEventListener('click', (e) => {
      if (e.target.closest('select, label, button, input')) return;
      if (expandedRules.has(rule.id)) expandedRules.delete(rule.id);
      else expandedRules.add(rule.id);
      render();
    });

    const toggleTd = document.createElement('td');
    const toggleBtn = document.createElement('button');
    toggleBtn.className = 'rule-toggle';
    toggleBtn.type = 'button';
    toggleBtn.textContent = expanded ? '▾' : '▸';
    toggleBtn.title = expanded ? 'Collapse' : 'Expand';
    toggleTd.appendChild(toggleBtn);

    const patternTd = document.createElement('td');
    patternTd.className = 'rule-pattern';
    const matchTypeSpan = document.createElement('span');
    matchTypeSpan.className = 'match-type';
    matchTypeSpan.textContent = rule.matchType;
    const patternSpan = document.createElement('span');
    patternSpan.className = 'pattern-text';
    patternSpan.textContent = rule.pattern;
    patternTd.append(matchTypeSpan, patternSpan);

    const categoryTd = document.createElement('td');
    categoryTd.className = 'correction-cell';
    if (rule.category) {
      const sample = matches[0];
      const original = sample ? originalCategoryFor(sample) : categorize(rule.pattern, false);
      const origSpan = document.createElement('span');
      origSpan.textContent = original;
      const arrow = document.createElement('span');
      arrow.className = 'correction-arrow';
      arrow.textContent = '→';
      const select = document.createElement('select');
      CATEGORIES.forEach((c) => {
        const opt = document.createElement('option');
        opt.value = c;
        opt.textContent = c;
        if (c === rule.category) opt.selected = true;
        select.appendChild(opt);
      });
      select.addEventListener('change', () => updateRuleCategory(rule.id, select.value));
      categoryTd.append(origSpan, arrow, select);
    } else {
      const none = document.createElement('span');
      none.className = 'correction-none';
      none.textContent = '—';
      categoryTd.appendChild(none);
    }

    const signTd = document.createElement('td');
    signTd.className = 'correction-cell';
    const signLabel = document.createElement('label');
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = !!rule.flipSign;
    checkbox.addEventListener('change', () => toggleRuleFlipSign(rule.id, checkbox.checked));
    signLabel.append(checkbox, document.createTextNode(' Flip sign'));
    signTd.appendChild(signLabel);

    const affectsTd = document.createElement('td');
    const affectsSpan = document.createElement('span');
    affectsSpan.className = 'affects-count' + (matches.length === 0 ? ' zero' : '');
    affectsSpan.textContent = matches.length === 0 ? 'none currently' : `${matches.length} txn${matches.length === 1 ? '' : 's'}`;
    affectsTd.appendChild(affectsSpan);

    const createdTd = document.createElement('td');
    createdTd.className = 'source-cell';
    createdTd.textContent = rule.createdAt ? formatDateDisplay(rule.createdAt.slice(0, 10)) : '—';

    const deleteTd = document.createElement('td');
    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'icon-btn danger';
    deleteBtn.textContent = '✕';
    deleteBtn.title = 'Remove this correction';
    deleteBtn.addEventListener('click', () => deleteRule(rule.id));
    deleteTd.appendChild(deleteBtn);

    tr.append(toggleTd, patternTd, categoryTd, signTd, affectsTd, createdTd, deleteTd);
    el.rulesBody.appendChild(tr);

    if (expanded) {
      const detailTr = document.createElement('tr');
      detailTr.className = 'rule-detail-row';
      const detailTd = document.createElement('td');
      detailTd.colSpan = 7;
      detailTd.appendChild(buildDetailContent(rule, matches));
      detailTr.appendChild(detailTd);
      el.rulesBody.appendChild(detailTr);
    }
  }
}

function buildDetailContent(rule, matches) {
  if (matches.length === 0) {
    const p = document.createElement('p');
    p.className = 'detail-empty';
    p.textContent = 'No currently-loaded transactions match this correction.';
    return p;
  }

  const table = document.createElement('table');
  table.className = 'detail-table';
  const thead = document.createElement('thead');
  thead.innerHTML = '<tr><th>Date</th><th>Description</th><th>Amount</th><th>Auto-detected</th><th>Corrected to</th></tr>';
  table.appendChild(thead);

  const tbody = document.createElement('tbody');
  [...matches].sort((a, b) => b.date.localeCompare(a.date)).forEach((t) => {
    const tr = document.createElement('tr');

    const dateTd = document.createElement('td');
    dateTd.textContent = formatDateDisplay(t.date);

    const descTd = document.createElement('td');
    descTd.textContent = t.description;

    const amtTd = document.createElement('td');
    amtTd.textContent = `${t.isDebit ? '-' : '+'}${formatCurrency(t.amount)}`;

    const autoTd = document.createElement('td');
    let autoText = originalCategoryFor(t);
    if (rule.flipSign) {
      autoText += ` (${baseIsDebit(t) ? '-' : '+'} → ${t.isDebit ? '-' : '+'})`;
    }
    autoTd.textContent = autoText;

    const correctedTd = document.createElement('td');
    correctedTd.textContent = t.category;

    tr.append(dateTd, descTd, amtTd, autoTd, correctedTd);
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  return table;
}
