# My Net Worth

A single-page, local-only web app that tracks your net worth over time from
Bank of America, Robinhood, and Transamerica statement PDFs. Nothing ever
leaves the browser: statements are parsed client-side and data is kept in
`localStorage`, entirely separate from the Spending and Budgeting app.

## Running it

No build step or server-side code — any static file server works:

```
cd net-worth
python3 -m http.server 8080
```

Then open `http://localhost:8080` in a browser. (Opening `index.html`
directly via `file://` won't work — browsers block ES module imports and
Web Workers from `file://` origins, so it needs to be served over `http://`.)

## Files

- **`index.html`** — page structure: upload area, summary stats, charts,
  and the accounts list.
- **`styles.css`** — visual styling, matching the Spending and Budgeting
  app's theme (including light/dark mode).
- **`app.js`** — the app's controller. Manages accounts and their balance
  history in `localStorage`, computes net worth over time, and renders the
  summary/charts/account list.
- **`statementParser.js`** — extracts a single balance snapshot (date +
  ending balance) from a statement PDF using
  [pdf.js](https://mozilla.github.io/pdf.js/) for text extraction.
  Institution-specific, since each one prints its balance differently:
  - **Bank of America**: "New Balance Total" (credit card, a liability), or
    for checking/savings — "Total balance" when a statement combines
    multiple deposit accounts (the common case, since BoA typically sends
    one combined statement for checking and savings together), falling
    back to a single account's "Ending balance" otherwise. Either way it's
    an asset.
  - **Robinhood**: "Portfolio Value" closing balance (an asset).
  - **Transamerica**: "Ending Balance" (retirement account, an asset).
- **`charts.js`** — the net-worth-over-time line chart and per-account
  breakdown bars, built out of plain DOM elements and inline SVG.
- **`lib/`** — a vendored copy of pdf.js, so PDF parsing works fully
  offline. See `PDFJS_LICENSE` (Apache 2.0). This is a separate copy from
  the one in `../spending-analyzer/lib/` so the two apps stay independent.

## How net worth is calculated

Each statement you upload is matched to an **account** by institution and
account number (a new account is created automatically the first time).
Every account is either an **asset** (adds to net worth) or a **liability**
(subtracts from it) — Bank of America credit cards default to liability,
everything else defaults to asset, and you can flip this per account.

Net worth at any point in time is the sum of every account's own latest
known balance as of that date (carried forward from its most recent
statement). This is what avoids double-counting a transfer between two of
your own accounts (e.g. moving money from Bank of America to Robinhood):
there's no attempt to match up transfers at all — each account's balance
already reflects money moving in or out of it, so one account's drop is
simply offset by the other's rise the next time you upload a statement for
it. The same logic means a gap in uploads doesn't create a false dip: an
account's last known balance just carries forward until you upload a newer
statement for it.

## Notes

- Which institution a statement is from is detected by its own domain or
  legal name (e.g. "bankofamerica.com", "robinhood.com"), not just any
  mention of that word — a Bank of America statement's own transaction
  list can easily contain a line like "ROBINHOOD DES:DEBITS..." for a
  transfer out to Robinhood, which shouldn't cause it to be read as a
  Robinhood statement.
- Every extracted balance and date is shown as an editable field in the
  account's history table — a misread PDF (or a number you just want to
  correct) is a one-click fix, not something you have to re-upload to fix.
- Re-uploading a statement for a date you already have replaces that
  snapshot rather than creating a duplicate.
- Accounts without a statement to upload (or where a PDF doesn't parse) can
  be added and updated by hand from the form below the accounts list.
- If a statement is auto-matched to the wrong account (rare, but possible
  if account-number formatting varies), remove the account and re-add the
  balance manually, or under the correct existing one.
