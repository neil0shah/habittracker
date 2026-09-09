# Spending and Budgeting

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
  based on its description text, plus which categories count as
  "essential" for the essential/non-essential breakdown.
- **`rules.js`** — the "learned corrections" store: category and sign fixes
  you make by hand, saved under their own `localStorage` key so they
  survive "Clear all data" and apply automatically to future uploads —
  fixing one Sweetgreen transaction, for example, fixes all of them, not
  just that one row.
- **`charts.js`** — small dependency-free charts (category breakdown, monthly
  cash flow, and a multi-line category trend chart) built out of plain DOM
  elements and inline SVG.
- **`lib/`** — a vendored copy of pdf.js (`pdf.min.mjs` + its web worker),
  so PDF parsing works fully offline with no CDN dependency. See
  `PDFJS_LICENSE` (Apache 2.0).
- **`data-monitoring.html` / `data-monitoring.js` / `data-monitoring.css`** —
  a separate page reusing `categorizer.js` and `rules.js` directly (no
  duplicated logic) to list every learned correction against what the
  built-in categorizer would guess today, for reviewing accuracy and
  spotting patterns. See "Data Monitoring" below.

## Notes

- Statement type (bank account vs. credit card) is auto-detected per file
  and can be flipped manually from the dropdown next to each uploaded file
  if amounts look inverted.
- Credit card refunds under "Payments and Other Credits" (or similarly
  named sections) are parsed as positive transactions, same as any other
  credit — including statements that print the minus sign with a space
  before the amount (e.g. "- 51.96"). A recurring autopay line from a
  linked checking/savings account (e.g. "…FROM CHK 1234") is categorized
  as a Transfer rather than Income, since it's money moving between your
  own accounts, not money coming in.
- Any transaction's category can be changed by hand from its row, or in
  bulk for every transaction matching a search term — either way it's
  remembered for future uploads (see `rules.js` above), not just applied
  to what's currently on screen.
- If a statement gets a transaction's sign wrong (rare, but happens with
  some reward/cashback line items), click the ⇄ next to its amount to
  flip it. That correction is remembered the same way category edits are.
- The uploaded-statements list can be collapsed (click the "N statements
  uploaded" toggle) once you've got a few files loaded and don't need to
  see them all the time.
- Table filters: click category chips to filter by one or more categories
  at once (e.g. Rent + Other together), plus Type, a minimum amount, and
  an "Amount is exactly" search to find a specific transaction by its
  dollar amount.
- "Clear all data" wipes uploaded statements only; learned corrections are
  kept. The "Reset N learned corrections" link lives below the
  Transactions table (deliberately away from the frequently-used controls
  above it) and comes with an "Undo reset" link right next to it in case
  you click it by mistake — undo only works until you make another
  category/sign edit, since that edit would otherwise be lost too.
- The "Category trends" chart plots up to 3 categories' spending month by
  month over a period you choose — independent of the date range at the
  top, so you can compare, say, "Dining & Coffee this year" without it
  changing your overall totals.
- Check "Link" on two or more transactions to combine them into one net
  amount instead of counting each separately — for a shared expense you
  paid in full and got reimbursed for (link the payment with the
  reimbursement), or a purchase and its refund (link them so they cancel
  out). The combined net counts under whichever linked transaction's
  category is largest; unlink any of them from its row to undo. Set the
  "Type" filter to "Linked only" to see just the transactions you've linked.
- Duplicate transactions are detected automatically. Re-uploading a
  statement you've already added is skipped entirely (with a note saying
  so), and any transaction that matches another one already on file —
  same date, description, and amount, even from a different statement —
  is kept only once. This also cleans up any duplicates already sitting
  in your data from before this check existed, the first time the page
  loads. Because the match is exact, two genuinely separate purchases for
  the same amount, at the same place, on the same day will also collapse
  into one — if that happens, the raw statement is unaffected, only what's
  shown/counted here.
- Click any Transactions column header (Date, Description, Category,
  Amount) to sort by it, Excel-style; click it again to reverse the
  direction. The active column is highlighted with an arrow showing which
  way it's sorted.

## Data Monitoring

A separate page (linked at the bottom of the main Transactions table) for
auditing every learned correction you've made. For each one it shows the
category the built-in categorizer would guess today next to what you
corrected it to (or the sign it would guess vs. what you flipped it to),
plus exactly which currently-loaded transactions the correction is
governing right now — so you can confirm a fix was right, catch one that
wasn't, and edit the category or sign directly from that page (applied to
every matching transaction immediately). A "Corrections by category" panel
sums how many corrections and transactions land in each category, which is
the fastest way to spot a pattern worth turning into a permanent keyword in
`categorizer.js`. A correction that matches zero currently-loaded
transactions is marked stale — usually because the statement it corrected
was removed — and can be deleted without affecting anything still on
screen; deleting any correction only stops it from applying to future
uploads; it doesn't undo transactions it already corrected.
