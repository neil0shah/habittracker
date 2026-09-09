// Small dependency-free charts, matching the style used in the spending
// analyzer (see ../spending-analyzer/charts.js) so the two apps feel like
// one product.

function formatCurrency(n) {
  return n.toLocaleString(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
}

function niceCeiling(v) {
  if (v <= 0) return 1;
  const mag = Math.pow(10, Math.floor(Math.log10(v)));
  const norm = v / mag;
  const niceNorm = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10;
  return niceNorm * mag;
}

function niceFloor(v) {
  if (v >= 0) return 0;
  return -niceCeiling(-v);
}

function formatCurrencyShort(n) {
  const abs = Math.abs(n);
  const sign = n < 0 ? '-' : '';
  if (abs >= 1000) return `${sign}$${(abs / 1000).toFixed(abs % 1000 === 0 ? 0 : 1)}k`;
  return `${sign}$${Math.round(abs)}`;
}

function monthYearShort(iso) {
  const [y, m] = iso.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString(undefined, { month: 'short', year: 'numeric' });
}

// Picks which checkpoints get an axis label so they land roughly every 6
// calendar months apart (e.g. "Jan 2025", "Jun 2025", "Dec 2025") instead
// of every Nth data point — checkpoint dates are real statement dates, not
// evenly-spaced months, so an index-based step would drift.
function pickTickIndices(points) {
  const ym = (iso) => {
    const [y, m] = iso.split('-').map(Number);
    return y * 12 + (m - 1);
  };

  const indices = [];
  let lastTickYM = null;
  points.forEach((p, i) => {
    const cur = ym(p.key);
    if (lastTickYM === null || cur - lastTickYM >= 6) {
      indices.push(i);
      lastTickYM = cur;
    }
  });

  const lastIdx = points.length - 1;
  if (indices[indices.length - 1] !== lastIdx) {
    if (ym(points[lastIdx].key) - lastTickYM >= 2) {
      indices.push(lastIdx);
    } else {
      indices[indices.length - 1] = lastIdx;
    }
  }
  return new Set(indices);
}

const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * Multi-line trend chart over a sequence of checkpoint dates.
 * @param {HTMLElement} container
 * @param {{key: string, label: string}[]} points
 * @param {{label: string, color: string, values: number[], dashed?: boolean}[]} series
 */
export function renderNetWorthChart(container, points, series) {
  container.innerHTML = '';

  if (points.length === 0) {
    container.innerHTML = '<p class="chart-empty">Upload or add a balance to see your net worth over time.</p>';
    return;
  }
  if (points.length === 1) {
    container.innerHTML = '<p class="chart-empty">Add at least one more balance snapshot to see a trend.</p>';
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

  const W = 760, H = 280;
  const padLeft = 64, padRight = 16, padTop = 16, padBottom = 30;
  const plotW = W - padLeft - padRight;
  const plotH = H - padTop - padBottom;

  const allValues = series.flatMap((s) => s.values);
  const maxVal = niceCeiling(Math.max(...allValues, 1));
  const minVal = niceFloor(Math.min(...allValues, 0));
  const range = maxVal - minVal || 1;

  const xFor = (i) => padLeft + (points.length === 1 ? plotW / 2 : (i / (points.length - 1)) * plotW);
  const yFor = (v) => padTop + plotH - ((v - minVal) / range) * plotH;

  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.setAttribute('class', 'trend-svg');
  svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');

  const gridCount = 4;
  for (let g = 0; g <= gridCount; g++) {
    const val = minVal + (range * g) / gridCount;
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

  if (minVal < 0 && maxVal > 0) {
    const zeroLine = document.createElementNS(SVG_NS, 'line');
    zeroLine.setAttribute('x1', padLeft); zeroLine.setAttribute('x2', W - padRight);
    zeroLine.setAttribute('y1', yFor(0)); zeroLine.setAttribute('y2', yFor(0));
    zeroLine.setAttribute('class', 'trend-zero-line');
    svg.appendChild(zeroLine);
  }

  const tickIndices = pickTickIndices(points);
  points.forEach((p, i) => {
    if (!tickIndices.has(i)) return;
    const text = document.createElementNS(SVG_NS, 'text');
    text.setAttribute('x', xFor(i)); text.setAttribute('y', H - 8);
    text.setAttribute('class', 'trend-axis-label');
    text.setAttribute('text-anchor', 'middle');
    text.textContent = monthYearShort(p.key);
    svg.appendChild(text);
  });

  series.forEach((s) => {
    const linePoints = s.values.map((v, i) => `${xFor(i)},${yFor(v)}`).join(' ');
    const poly = document.createElementNS(SVG_NS, 'polyline');
    poly.setAttribute('points', linePoints);
    poly.setAttribute('class', 'trend-line' + (s.dashed ? ' trend-line-dashed' : ''));
    poly.style.stroke = s.color;
    svg.appendChild(poly);

    s.values.forEach((v, i) => {
      const c = document.createElementNS(SVG_NS, 'circle');
      c.setAttribute('cx', xFor(i)); c.setAttribute('cy', yFor(v)); c.setAttribute('r', 3);
      c.setAttribute('class', 'trend-dot');
      c.style.fill = s.color;
      const title = document.createElementNS(SVG_NS, 'title');
      title.textContent = `${s.label} · ${points[i].label}: ${formatCurrency(v)}`;
      c.appendChild(title);
      svg.appendChild(c);
    });
  });

  container.appendChild(svg);
}

/**
 * Horizontal bar chart of each account's current balance, grouped by
 * assets vs. liabilities.
 * @param {HTMLElement} container
 * @param {{label: string, value: number, color: string}[]} assetItems
 * @param {{label: string, value: number, color: string}[]} liabilityItems
 */
export function renderAccountBars(container, assetItems, liabilityItems) {
  container.innerHTML = '';

  if (assetItems.length === 0 && liabilityItems.length === 0) {
    container.innerHTML = '<p class="chart-empty">No accounts with a balance yet.</p>';
    return;
  }

  const allValues = [...assetItems, ...liabilityItems].map((i) => i.value);
  const max = Math.max(...allValues, 1);

  const groups = [['Assets', assetItems], ['Liabilities', liabilityItems]];

  for (const [groupLabel, items] of groups) {
    if (items.length === 0) continue;

    const groupTotal = items.reduce((sum, i) => sum + i.value, 0);
    const header = document.createElement('div');
    header.className = 'cat-group-header';
    header.innerHTML = `<span>${groupLabel}</span><span class="cat-group-total">${formatCurrency(groupTotal)}</span>`;
    container.appendChild(header);

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
      val.textContent = formatCurrency(item.value);

      row.append(label, track, val);
      list.appendChild(row);
    });
    container.appendChild(list);
  }
}
