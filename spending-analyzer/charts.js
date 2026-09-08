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
 * Vertical bar chart: one column per month.
 * @param {HTMLElement} container
 * @param {{label: string, value: number}[]} items
 */
export function renderMonthlyBars(container, items) {
  container.innerHTML = '';

  if (items.length === 0) {
    container.innerHTML = '<p class="chart-empty">No spending in this range yet.</p>';
    return;
  }

  const max = Math.max(...items.map((i) => i.value), 1);
  const wrap = document.createElement('div');
  wrap.className = 'month-bars';

  items.forEach((item) => {
    const col = document.createElement('div');
    col.className = 'month-bar-col';

    const amt = document.createElement('div');
    amt.className = 'month-bar-amount';
    amt.textContent = item.value > 0 ? formatCurrency(item.value) : '';

    const track = document.createElement('div');
    track.className = 'month-bar-track';
    const fill = document.createElement('div');
    fill.className = 'month-bar-fill';
    fill.style.height = `${(item.value / max * 100).toFixed(1)}%`;
    fill.title = `${item.label}: ${formatCurrency(item.value)}`;
    track.appendChild(fill);

    const label = document.createElement('div');
    label.className = 'month-bar-label';
    label.textContent = item.label;

    col.append(amt, track, label);
    wrap.appendChild(col);
  });

  container.appendChild(wrap);
}
