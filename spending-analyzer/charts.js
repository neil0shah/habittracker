// Small dependency-free bar charts built out of plain DOM elements
// (no canvas/SVG library needed). Kept intentionally simple so they're
// easy to restyle and stay crisp at any zoom level.

function formatCurrency(n) {
  return n.toLocaleString(undefined, { style: 'currency', currency: 'USD' });
}

/**
 * Horizontal bar chart: one row per category, sorted by the caller.
 * @param {HTMLElement} container
 * @param {{label: string, value: number, color: string}[]} items
 * @param {number} totalForPercent
 */
export function renderCategoryBars(container, items, totalForPercent) {
  container.innerHTML = '';

  if (items.length === 0) {
    container.innerHTML = '<p class="chart-empty">No spending in this range yet.</p>';
    return;
  }

  const max = Math.max(...items.map((i) => i.value));
  const list = document.createElement('div');
  list.className = 'cat-bars';

  items.forEach((item) => {
    const row = document.createElement('div');
    row.className = 'cat-bar-row';

    const label = document.createElement('div');
    label.className = 'cat-bar-label';
    const dot = document.createElement('span');
    dot.className = 'cat-dot';
    dot.style.background = item.color;
    label.appendChild(dot);
    label.append(item.label);

    const track = document.createElement('div');
    track.className = 'cat-bar-track';
    const fill = document.createElement('div');
    fill.className = 'cat-bar-fill';
    fill.style.width = `${max > 0 ? (item.value / max * 100).toFixed(1) : 0}%`;
    fill.style.background = item.color;
    track.appendChild(fill);

    const val = document.createElement('div');
    val.className = 'cat-bar-value';
    const pct = totalForPercent > 0 ? (item.value / totalForPercent * 100) : 0;
    val.textContent = `${formatCurrency(item.value)} · ${pct.toFixed(0)}%`;

    row.append(label, track, val);
    list.appendChild(row);
  });

  container.appendChild(list);
}

/**
 * Grouped vertical bar chart: one income bar + one expense bar per month,
 * with the net (income − expense) shown above each pair.
 * @param {HTMLElement} container
 * @param {{label: string, income: number, expense: number}[]} items
 */
export function renderCashFlowBars(container, items) {
  container.innerHTML = '';

  if (items.length === 0) {
    container.innerHTML = '<p class="chart-empty">No transactions in this range yet.</p>';
    return;
  }

  const max = Math.max(...items.map((i) => Math.max(i.income, i.expense)), 1);

  const legend = document.createElement('div');
  legend.className = 'cashflow-legend';
  legend.innerHTML = `
    <span class="legend-item"><span class="legend-dot legend-income"></span>Income</span>
    <span class="legend-item"><span class="legend-dot legend-expense"></span>Expenses</span>
  `;
  container.appendChild(legend);

  const wrap = document.createElement('div');
  wrap.className = 'month-bars';

  items.forEach((item) => {
    const col = document.createElement('div');
    col.className = 'month-bar-col';

    const net = item.income - item.expense;
    const netEl = document.createElement('div');
    netEl.className = 'month-bar-net ' + (net >= 0 ? 'amount-credit' : 'amount-debit');
    netEl.textContent = `${net >= 0 ? '+' : '-'}${formatCurrency(Math.abs(net))}`;

    const track = document.createElement('div');
    track.className = 'month-bar-track month-bar-track-grouped';

    const incomeBar = document.createElement('div');
    incomeBar.className = 'month-bar-fill month-bar-income';
    incomeBar.style.height = `${(item.income / max * 100).toFixed(1)}%`;
    incomeBar.title = `${item.label} income: ${formatCurrency(item.income)}`;

    const expenseBar = document.createElement('div');
    expenseBar.className = 'month-bar-fill month-bar-expense';
    expenseBar.style.height = `${(item.expense / max * 100).toFixed(1)}%`;
    expenseBar.title = `${item.label} expenses: ${formatCurrency(item.expense)}`;

    track.append(incomeBar, expenseBar);

    const label = document.createElement('div');
    label.className = 'month-bar-label';
    label.textContent = item.label;

    col.append(netEl, track, label);
    wrap.appendChild(col);
  });

  container.appendChild(wrap);
}
