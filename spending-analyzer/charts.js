// Small dependency-free bar charts built out of plain DOM elements
// (no canvas/SVG library needed). Kept intentionally simple so they're
// easy to restyle and stay crisp at any zoom level.

function formatCurrency(n) {
  return n.toLocaleString(undefined, { style: 'currency', currency: 'USD' });
}

function buildCatBarRow(item, max, totalForPercent) {
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
  return row;
}

/**
 * Horizontal bar chart grouped into "Essential" and "Non-Essential"
 * sections, each with its own subtotal, sorted by the caller.
 * @param {HTMLElement} container
 * @param {{label: string, value: number, color: string}[]} essentialItems
 * @param {{label: string, value: number, color: string}[]} nonEssentialItems
 * @param {number} totalForPercent
 */
export function renderCategoryBars(container, essentialItems, nonEssentialItems, totalForPercent) {
  container.innerHTML = '';

  if (essentialItems.length === 0 && nonEssentialItems.length === 0) {
    container.innerHTML = '<p class="chart-empty">No spending in this range yet.</p>';
    return;
  }

  const allValues = [...essentialItems, ...nonEssentialItems].map((i) => i.value);
  const max = Math.max(...allValues);

  const groups = [
    ['Essential', essentialItems],
    ['Non-Essential', nonEssentialItems],
  ];

  for (const [groupLabel, items] of groups) {
    if (items.length === 0) continue;

    const groupTotal = items.reduce((sum, i) => sum + i.value, 0);
    const header = document.createElement('div');
    header.className = 'cat-group-header';
    const pct = totalForPercent > 0 ? (groupTotal / totalForPercent * 100) : 0;
    header.innerHTML = `<span>${groupLabel}</span><span class="cat-group-total">${formatCurrency(groupTotal)} · ${pct.toFixed(0)}%</span>`;
    container.appendChild(header);

    const list = document.createElement('div');
    list.className = 'cat-bars';
    items.forEach((item) => list.appendChild(buildCatBarRow(item, max, totalForPercent)));
    container.appendChild(list);
  }
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

function niceCeiling(v) {
  if (v <= 0) return 1;
  const mag = Math.pow(10, Math.floor(Math.log10(v)));
  const norm = v / mag;
  const niceNorm = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10;
  return niceNorm * mag;
}

function formatCurrencyShort(n) {
  if (n >= 1000) return `$${(n / 1000).toFixed(n % 1000 === 0 ? 0 : 1)}k`;
  return `$${Math.round(n)}`;
}

const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * Multi-line trend chart: one line per category across a sequence of
 * months.
 * @param {HTMLElement} container
 * @param {{key: string, label: string}[]} months
 * @param {{label: string, color: string, values: number[]}[]} series
 */
export function renderTrendChart(container, months, series) {
  container.innerHTML = '';

  if (series.length === 0) {
    container.innerHTML = '<p class="chart-empty">Pick 1–3 categories to see their trend over time.</p>';
    return;
  }
  const hasData = months.length > 0 && series.some((s) => s.values.some((v) => v > 0));
  if (!hasData) {
    container.innerHTML = '<p class="chart-empty">No spending in the selected categories for this period.</p>';
    return;
  }

  const legend = document.createElement('div');
  legend.className = 'cashflow-legend';
  series.forEach((s) => {
    const item = document.createElement('span');
    item.className = 'legend-item';
    const dot = document.createElement('span');
    dot.className = 'legend-dot';
    dot.style.background = s.color;
    item.append(dot, s.label);
    legend.appendChild(item);
  });
  container.appendChild(legend);

  const W = 760, H = 260;
  const padLeft = 56, padRight = 16, padTop = 16, padBottom = 30;
  const plotW = W - padLeft - padRight;
  const plotH = H - padTop - padBottom;

  const maxVal = niceCeiling(Math.max(...series.flatMap((s) => s.values), 1));
  const xFor = (i) => padLeft + (months.length === 1 ? plotW / 2 : (i / (months.length - 1)) * plotW);
  const yFor = (v) => padTop + plotH - (v / maxVal) * plotH;

  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.setAttribute('class', 'trend-svg');
  svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');

  const gridCount = 4;
  for (let g = 0; g <= gridCount; g++) {
    const val = maxVal * (g / gridCount);
    const y = yFor(val);

    const line = document.createElementNS(SVG_NS, 'line');
    line.setAttribute('x1', padLeft); line.setAttribute('x2', W - padRight);
    line.setAttribute('y1', y); line.setAttribute('y2', y);
    line.setAttribute('class', 'trend-gridline');
    svg.appendChild(line);

    const text = document.createElementNS(SVG_NS, 'text');
    text.setAttribute('x', padLeft - 8); text.setAttribute('y', y + 4);
    text.setAttribute('class', 'trend-axis-label');
    text.setAttribute('text-anchor', 'end');
    text.textContent = formatCurrencyShort(val);
    svg.appendChild(text);
  }

  const step = months.length > 18 ? 3 : months.length > 9 ? 2 : 1;
  months.forEach((m, i) => {
    if (i % step !== 0 && i !== months.length - 1) return;
    const text = document.createElementNS(SVG_NS, 'text');
    text.setAttribute('x', xFor(i)); text.setAttribute('y', H - 8);
    text.setAttribute('class', 'trend-axis-label');
    text.setAttribute('text-anchor', 'middle');
    text.textContent = m.label;
    svg.appendChild(text);
  });

  series.forEach((s) => {
    const points = s.values.map((v, i) => `${xFor(i)},${yFor(v)}`).join(' ');
    const poly = document.createElementNS(SVG_NS, 'polyline');
    poly.setAttribute('points', points);
    poly.setAttribute('class', 'trend-line');
    poly.style.stroke = s.color;
    svg.appendChild(poly);

    s.values.forEach((v, i) => {
      const c = document.createElementNS(SVG_NS, 'circle');
      c.setAttribute('cx', xFor(i)); c.setAttribute('cy', yFor(v)); c.setAttribute('r', 3);
      c.setAttribute('class', 'trend-dot');
      c.style.fill = s.color;
      const title = document.createElementNS(SVG_NS, 'title');
      title.textContent = `${s.label} · ${months[i].label}: ${formatCurrency(v)}`;
      c.appendChild(title);
      svg.appendChild(c);
    });
  });

  container.appendChild(svg);
}
