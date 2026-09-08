# Spending Analyzer

A single-page, local-only web app that turns PDF bank/credit-card statements
into a spending summary — categorized, chartable, and filterable by date.
Nothing ever leaves the browser: PDFs are parsed client-side and data is
kept in `localStorage`.

## Running it

No build step or server-side code — any static file server works:

```
cd spending-analyzer
python3 -m http.server 8080
```

Then open `http://localhost:8080` in a browser. (Opening `index.html`
directly via `file://` will *not* work — browsers block ES module imports
and Web Workers from `file://` origins, so it needs to be served over
`http://`.)

## Files

- **`index.html`** — page structure: upload area, filter controls, summary
  card, chart containers, and the transaction table. No inline logic.
- **`styles.css`** — all visual styling, including light/dark theme
  variables that follow the OS/browser color scheme.
- **`app.js`** — the app's controller. Handles file uploads, persists
  parsed transactions and category edits to `localStorage`, computes date
  filters and totals, and renders the summary/charts/table.
- **`pdfParser.js`** — turns a PDF `File` into transaction rows using
  [pdf.js](https://mozilla.github.io/pdf.js/) for text extraction. It
  reconstructs visual lines from positioned text fragments, then looks for
  lines that start with a date and end with a dollar amount. It also
  detects whether a statement is a bank account or credit card (they use
  opposite sign conventions for "money out") and infers transaction years
  when a statement only prints `MM/DD`.
- **`categorizer.js`** — a keyword-matching function that assigns each
  transaction a category (Groceries, Dining & Coffee, Subscriptions, etc.)
  based on its description text.
- **`charts.js`** — small dependency-free bar charts (category breakdown +
  monthly spending) built out of plain DOM elements.
- **`lib/`** — a vendored copy of pdf.js (`pdf.min.mjs` + its web worker),
  so PDF parsing works fully offline with no CDN dependency. See
  `PDFJS_LICENSE` (Apache 2.0).

## Notes

- Statement type (bank account vs. credit card) is auto-detected per file
  and can be flipped manually from the dropdown next to each uploaded file
  if amounts look inverted.
- Any transaction's category can be changed by hand from its row in the
  table; edits are remembered even if you re-upload the same statement
  later.
- "Clear all data" wipes everything this app has stored in the browser.
