// Run with:  node --test quotekit/test
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../lib/calc.js');

const item = (qty, price, desc = 'Work') => ({ id: 'i', desc, qtyMilli: C.parseQty(qty), unitMinor: C.parseMoney(price) });
const doc = (extra = {}) => Object.assign({
  id: 'd1', type: 'invoice', number: 'INV-0001', status: 'draft', currency: 'MYR',
  issueDate: '2026-11-26', dueDate: '2026-12-10',
  client: { name: 'Acme Sdn Bhd', email: '', address: '' },
  items: [item('1', '100')], discount: { kind: 'none', value: 0 }, taxBps: 0, notes: '',
  convertedFrom: '', createdAt: 1, updatedAt: 1
}, extra);

test('roundDiv rounds half away from zero', () => {
  assert.equal(C.roundDiv(5, 10), 1);
  assert.equal(C.roundDiv(4, 10), 0);
  assert.equal(C.roundDiv(15, 10), 2);
  assert.equal(C.roundDiv(-5, 10), -1);
  assert.equal(C.roundDiv(-4, 10), 0);
  assert.equal(C.roundDiv(0, 7), 0);
});

test('parseMoney accepts normal input and rejects bad input', () => {
  assert.equal(C.parseMoney('0'), 0);
  assert.equal(C.parseMoney('19.99'), 1999);
  assert.equal(C.parseMoney('1,234.5'), 123450);
  assert.equal(C.parseMoney(' 7 '), 700);
  assert.equal(C.parseMoney('.5'), 50);
  assert.equal(C.parseMoney('5.'), 500);
  assert.equal(C.parseMoney('1.005'), 101, 'extra decimals round half up');
  assert.equal(C.parseMoney('1.004'), 100);
  assert.equal(C.parseMoney('-3.20'), -320);
  for (const bad of ['', 'abc', '1.2.3', '--1', '1e5', '$5', null, undefined, '1234567890123']) {
    assert.ok(Number.isNaN(C.parseMoney(bad)), 'should reject ' + JSON.stringify(bad));
  }
});

test('parseQty and parsePercent use their own scales', () => {
  assert.equal(C.parseQty('1.5'), 1500);
  assert.equal(C.parseQty('0.001'), 1);
  assert.equal(C.parsePercent('6'), 600);
  assert.equal(C.parsePercent('8.25'), 825);
});

test('input formatting round-trips', () => {
  for (const m of [0, 1, 99, 100, 123450, 5]) assert.equal(C.parseMoney(C.minorToInput(m)), m);
  for (const q of [1000, 1500, 250, 1, 12000]) assert.equal(C.parseQty(C.milliToInput(q)), q);
  for (const b of [0, 600, 825, 10000, 1]) assert.equal(C.parsePercent(C.bpsToInput(b)), b);
  assert.equal(C.milliToInput(1500), '1.5');
  assert.equal(C.milliToInput(2000), '2');
  assert.equal(C.bpsToInput(600), '6');
  assert.equal(C.minorToInput(5), '0.05');
});

test('line totals avoid floating point errors', () => {
  assert.equal(C.lineTotal(item('3', '0.10')), 30);       // 3 * 0.10 is 0.30000000000000004 in floats
  assert.equal(C.lineTotal(item('1.5', '19.99')), 2999);  // 29.985 rounds half up to 29.99
  assert.equal(C.lineTotal(item('0.333', '10')), 333);
  assert.equal(C.lineTotal(item('2', '0')), 0);
});

test('totals: no discount, no tax', () => {
  const t = C.computeTotals(doc({ items: [item('2', '50'), item('1', '25.50')] }));
  assert.deepEqual([t.subtotal, t.discount, t.tax, t.total], [12550, 0, 0, 12550]);
});

test('totals: percent discount then tax on the discounted amount', () => {
  const t = C.computeTotals(doc({
    items: [item('1', '1000')], discount: { kind: 'percent', value: 1000 }, taxBps: 600
  }));
  assert.equal(t.subtotal, 100000);
  assert.equal(t.discount, 10000);   // 10%
  assert.equal(t.taxable, 90000);
  assert.equal(t.tax, 5400);         // 6% of 900.00
  assert.equal(t.total, 95400);
});

test('totals: fixed discount is capped at the subtotal', () => {
  const t = C.computeTotals(doc({ items: [item('1', '40')], discount: { kind: 'amount', value: 9999 } }));
  assert.equal(t.discount, 4000);
  assert.equal(t.total, 0);
});

test('totals: tax rounds to the nearest sen', () => {
  const t = C.computeTotals(doc({ items: [item('1', '0.99')], taxBps: 600 })); // 5.94 sen -> 6
  assert.equal(t.tax, 6);
  assert.equal(t.total, 105);
  const half = C.computeTotals(doc({ items: [item('1', '0.50')], taxBps: 1000 })); // 5 sen exact
  assert.equal(half.tax, 5);
});

test('totals: empty list is zero', () => {
  const t = C.computeTotals(doc({ items: [] }));
  assert.equal(t.total, 0);
});

test('document numbers count up per type and never mutate the input', () => {
  const start = { quote: 0, invoice: 0 };
  const a = C.nextNumber('quote', start);
  assert.equal(a.number, 'QUO-0001');
  assert.deepEqual(start, { quote: 0, invoice: 0 });
  const b = C.nextNumber('quote', a.counters);
  assert.equal(b.number, 'QUO-0002');
  const c = C.nextNumber('invoice', b.counters);
  assert.equal(c.number, 'INV-0001');
  assert.equal(C.nextNumber('invoice', { quote: 0, invoice: 12344 }).number, 'INV-12345');
});

test('derived status: overdue invoices and expired quotes', () => {
  const inv = doc({ status: 'sent', dueDate: '2026-11-01' });
  assert.equal(C.derivedStatus(inv, '2026-11-26'), 'overdue');
  assert.equal(C.derivedStatus(inv, '2026-11-01'), 'sent', 'due today is not overdue yet');
  assert.equal(C.derivedStatus(doc({ status: 'paid', dueDate: '2026-11-01' }), '2026-11-26'), 'paid');
  assert.equal(C.derivedStatus(doc({ status: 'draft', dueDate: '2026-11-01' }), '2026-11-26'), 'draft');
  assert.equal(C.derivedStatus(doc({ type: 'quote', status: 'sent', dueDate: '2026-11-01' }), '2026-11-26'), 'expired');
});

test('summary adds up each currency separately', () => {
  const docs = [
    doc({ id: 'a', status: 'sent', items: [item('1', '100')], dueDate: '2026-12-31' }),
    doc({ id: 'b', status: 'sent', items: [item('1', '50')], dueDate: '2026-11-01' }), // overdue
    doc({ id: 'c', status: 'paid', items: [item('1', '300')] }),
    doc({ id: 'd', type: 'quote', status: 'sent', items: [item('1', '70')], dueDate: '2026-12-31' }),
    doc({ id: 'e', type: 'quote', status: 'sent', items: [item('1', '999')], dueDate: '2026-11-01' }), // expired, not counted
    doc({ id: 'f', status: 'draft', items: [item('1', '5000')] }),
    doc({ id: 'g', status: 'sent', currency: 'USD', items: [item('1', '10')], dueDate: '2026-12-31' })
  ];
  const s = C.summarize(docs, '2026-11-26');
  assert.deepEqual(s.MYR, { outstanding: 15000, paid: 30000, openQuotes: 7000, overdueCount: 1 });
  assert.deepEqual(s.USD, { outstanding: 1000, paid: 0, openQuotes: 0, overdueCount: 0 });
});

test('date helpers handle month ends and leap years', () => {
  assert.equal(C.addDays('2026-11-26', 14), '2026-12-10');
  assert.equal(C.addDays('2026-12-25', 10), '2027-01-04');
  assert.equal(C.addDays('2028-02-28', 1), '2028-02-29');
  assert.equal(C.addDays('2027-02-28', 1), '2027-03-01');
  assert.ok(C.isISODate('2028-02-29'));
  assert.ok(!C.isISODate('2027-02-29'));
  assert.ok(!C.isISODate('2026-13-01'));
  assert.ok(!C.isISODate('26-11-01'));
});

test('quote converts to a fresh invoice with the same money', () => {
  const quote = doc({
    id: 'q1', type: 'quote', number: 'QUO-0003', status: 'accepted',
    items: [item('2', '150'), item('1', '49.90')], discount: { kind: 'percent', value: 500 }, taxBps: 600, notes: 'Quote notes'
  });
  const r = C.quoteToInvoice(quote, { quote: 3, invoice: 7 }, { id: 'inv9', today: '2026-11-26', termsDays: 14, now: 99, notes: 'Pay within 14 days' });
  assert.equal(r.invoice.number, 'INV-0008');
  assert.equal(r.invoice.type, 'invoice');
  assert.equal(r.invoice.status, 'draft');
  assert.equal(r.invoice.dueDate, '2026-12-10');
  assert.equal(r.invoice.convertedFrom, 'QUO-0003');
  assert.equal(r.invoice.notes, 'Pay within 14 days');
  assert.deepEqual(r.counters, { quote: 3, invoice: 8 });
  assert.equal(C.computeTotals(r.invoice).total, C.computeTotals(quote).total);
  r.invoice.items[0].qtyMilli = 1; // must be a copy
  assert.equal(quote.items[0].qtyMilli, 2000);
});

test('validation catches the problems a customer would hit', () => {
  assert.deepEqual(C.validateDoc(doc()), []);
  const bad = doc({
    client: { name: '  ', email: '', address: '' },
    items: [{ id: 'x', desc: '', qtyMilli: 0, unitMinor: -5 }],
    dueDate: '2026-11-01', taxBps: 20000
  });
  const errs = C.validateDoc(bad);
  assert.ok(errs.includes('Add the client name.'));
  assert.ok(errs.includes('Item 1 needs a description.'));
  assert.ok(errs.includes('Item 1 needs a quantity above zero.'));
  assert.ok(errs.includes('Item 1 needs a price of zero or more.'));
  assert.ok(errs.includes('Due date is before the issue date.'));
  assert.ok(errs.includes('Tax must be between 0% and 100%.'));
  assert.ok(C.validateDoc(doc({ items: [] })).includes('Add at least one item.'));
  assert.ok(C.validateDoc(doc({ discount: { kind: 'percent', value: 10001 } })).includes('Discount must be between 0% and 100%.'));
});

test('backup import: a clean backup comes back intact', () => {
  const settings = C.defaultSettings();
  settings.business.name = 'My Studio';
  const d = doc({ number: 'INV-0005' });
  const r = C.sanitizeBackup({ app: 'quotekit', version: 1, settings, docs: [d] });
  assert.ok(r.ok);
  assert.equal(r.data.docs.length, 1);
  assert.equal(r.data.settings.business.name, 'My Studio');
  assert.equal(r.data.settings.counters.invoice, 5, 'counters move past imported numbers');
  assert.equal(r.dropped, 0);
});

test('backup import: rejects strangers and repairs or drops bad data', () => {
  assert.equal(C.sanitizeBackup(null).ok, false);
  assert.equal(C.sanitizeBackup({ app: 'other', version: 1, docs: [] }).ok, false);
  assert.equal(C.sanitizeBackup({ app: 'quotekit', version: 2, docs: [] }).ok, false);
  assert.equal(C.sanitizeBackup({ app: 'quotekit', version: 1, docs: 'nope' }).ok, false);

  const good = doc({ id: 'ok' });
  const dup = doc({ id: 'ok' });
  const badDate = doc({ id: 'b1', issueDate: 'yesterday' });
  const badItem = doc({ id: 'b2', items: [{ qtyMilli: 'many', unitMinor: 1 }] });
  const weird = doc({ id: 'w', status: 'hacked', currency: 'XXX', taxBps: 999999, notes: 'x'.repeat(5000) });
  const r = C.sanitizeBackup({ app: 'quotekit', version: 1, docs: [good, dup, badDate, badItem, weird, 5, null] });
  assert.ok(r.ok);
  assert.equal(r.data.docs.length, 2);
  assert.equal(r.dropped, 5);
  const w = r.data.docs.find((x) => x.id === 'w');
  assert.equal(w.status, 'draft');
  assert.equal(w.currency, 'MYR');
  assert.equal(w.taxBps, 10000);
  assert.equal(w.notes.length, 2000);
});

test('backup import keeps only known fields (no prototype pollution or extras)', () => {
  const evil = doc({ id: 'e' });
  evil.__proto__ = { polluted: true };
  evil.extra = '<img src=x onerror=alert(1)>';
  const r = C.sanitizeBackup(JSON.parse(JSON.stringify({ app: 'quotekit', version: 1, docs: [evil] })));
  assert.ok(r.ok);
  assert.equal(r.data.docs[0].extra, undefined);
  assert.equal(({}).polluted, undefined);
});

test('formatMoney shows the currency and falls back safely', () => {
  assert.match(C.formatMoney(123456, 'MYR', 'en-MY'), /1,234\.56/);
  assert.match(C.formatMoney(5, 'USD', 'en-US'), /0\.05/);
  assert.match(C.formatMoney(100, 'NOPE', 'en-MY'), /1\.00/);
});

test('worst-case sizes stay exact (no precision loss)', () => {
  const big = { id: 'i', desc: 'x', qtyMilli: 1000, unitMinor: C.MAX_LINE_MINOR }; // 1 unit at the max price
  const full = doc({ items: new Array(C.MAX_ITEMS).fill(big), discount: { kind: 'percent', value: 1 }, taxBps: 10000 });
  const t = C.computeTotals(full);
  const sub = BigInt(C.MAX_ITEMS) * BigInt(C.MAX_LINE_MINOR);
  const disc = (2n * sub * 1n + 10000n) / 20000n;      // exact big-integer reference
  const taxable = sub - disc;
  const tax = (2n * taxable * 10000n + 10000n) / 20000n;
  assert.equal(BigInt(t.subtotal), sub);
  assert.equal(BigInt(t.discount), disc);
  assert.equal(BigInt(t.tax), tax);
  assert.equal(BigInt(t.total), taxable + tax);
  assert.ok(Number.isSafeInteger(t.subtotal * 10000), 'largest intermediate product is a safe integer');
});

test('oversized lines and too many items are refused', () => {
  const huge = { id: 'h', desc: 'x', qtyMilli: 1e9, unitMinor: 1e9 };
  assert.ok(C.validateDoc(doc({ items: [huge] })).includes('Item 1 total is too large.'));
  const many = doc({ items: new Array(C.MAX_ITEMS + 1).fill(item('1', '1')) });
  assert.ok(C.validateDoc(many).some((e) => /at most/.test(e)));
  const r = C.sanitizeBackup({ app: 'quotekit', version: 1, docs: [doc({ id: 'a', items: [huge] }), many] });
  assert.equal(r.data.docs.length, 0);
  assert.equal(r.dropped, 2);
});
