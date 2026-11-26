# QuoteKit

A simple quotation and invoice maker for small businesses and freelancers. Create a quote, send it, turn it into an invoice and track what has been paid. Everything runs in the browser, so there is no account, no server and no cost.

**Live demo:** https://manorazali.github.io/quotekit/

## What it does

- Quotations and invoices with automatic numbering (`QUO-0001`, `INV-0001`)
- Convert an accepted quotation into an invoice in one click
- Status tracking: Draft, Sent, Accepted or Declined (quotes), Draft, Sent or Paid (invoices)
- Overdue invoices and expired quotes are flagged automatically
- Dashboard: money waiting to be paid, money received, value of open quotations
- Discount (percent or fixed amount) and tax, with live totals
- Print or save a clean A4 PDF using the browser's print dialog
- Search and filter the document list
- Backup and restore as a JSON file
- Works on phone and desktop, in light and dark mode, with keyboard-friendly forms

## Design decisions

- **Money is whole numbers.** Amounts are stored in sen (cents), quantities in thousandths and percentages in basis points. This avoids floating point errors like `0.1 + 0.2 = 0.30000000000000004`. Rounding is half away from zero, applied once per line and once for tax.
- **Safe limits.** Up to 100 items per document and RM 50 million per line keep every intermediate value below 2^53, so the maths stays exact. A test checks the worst case against big-integer arithmetic.
- **Bad input never overwrites good data.** A half-typed number is flagged and ignored until it becomes valid.
- **Imports are not trusted.** A backup file is rebuilt field by field. Unknown fields, bad dates, oversized values and duplicate ids are dropped, and all text is rendered as text, never as HTML.
- **Logic is separate from the screen.** `lib/calc.js` has no DOM or storage code, so it can be tested in Node. `app.js` only handles screens.

## Project structure

```
quotekit/
├─ index.html        page shell
├─ styles.css        layout, themes and print styles
├─ app.js            screens: list, editor, settings, backup
├─ lib/calc.js       money, totals, numbering, status, validation, import cleaning
└─ test/calc.test.js automated tests (Node's built-in test runner)
```

## Run the tests

Needs Node 18 or newer. No packages to install.

```bash
cd quotekit
node --test
```

## Known limits (and ideas for later)

- Data is stored in the browser (`localStorage`), so it is per device. Use the backup file to move it.
- One currency per document, chosen from a short list.
- Tax is a single percentage. It does not handle tax registration rules or multiple tax rates.
- PDF output uses the browser's print dialog rather than a PDF library.
- Ideas: logo upload, client address book, recurring invoices, WhatsApp share link.

QuoteKit is a demonstration project. Check your own tax and invoicing requirements before using it for official documents.
