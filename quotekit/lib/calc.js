/*
 * QuoteKit core logic: pure functions, no DOM, no storage.
 * Works in the browser (window.QuoteCalc) and in Node (require) so it can be unit tested.
 *
 * Money rule: every amount is a whole number of minor units (sen / cents).
 * Quantities are stored in thousandths, percentages in basis points (1% = 100).
 * Integer maths avoids floating point errors such as 0.1 + 0.2 = 0.30000000000000004.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.QuoteCalc = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var CURRENCIES = ['MYR', 'SGD', 'USD', 'EUR', 'GBP', 'AUD'];
  var TYPES = ['quote', 'invoice'];
  var STATUSES = {
    quote: ['draft', 'sent', 'accepted', 'declined'],
    invoice: ['draft', 'sent', 'paid']
  };
  var PREFIX = { quote: 'QUO-', invoice: 'INV-' };
  var MAX_TEXT = 2000;
  // Limits keep every intermediate value below 2^53 (about 9e15), so integer maths stays exact:
  // 100 lines x 5e9 sen = 5e11 subtotal, and 5e11 x 10000 (a 100% rate in basis points) = 5e15.
  var MAX_ITEMS = 100;
  var MAX_LINE_MINOR = 5e9; // RM 50 million per line

  /* ---------- number helpers ---------- */

  // Integer division rounded half away from zero. d must be a positive integer.
  function roundDiv(n, d) {
    if (n >= 0) return Math.floor((2 * n + d) / (2 * d));
    return 0 - Math.floor((2 * -n + d) / (2 * d)); // "0 -" keeps zero as +0, never -0
  }

  // "1,234.5" with scale 2 -> 123450. Returns NaN when the text is not a valid number.
  // Extra decimals are rounded half up ("1.005" -> 101 at scale 2).
  function parseDecimal(input, scale) {
    if (typeof input === 'number') input = String(input);
    if (typeof input !== 'string') return NaN;
    var s = input.replace(/[\s,]/g, '');
    if (!/^-?(\d+\.?\d*|\.\d+)$/.test(s)) return NaN;
    var neg = s.charAt(0) === '-';
    if (neg) s = s.slice(1);
    var parts = s.split('.');
    var whole = parts[0] || '0';
    var frac = parts[1] || '';
    if (whole.length > 12) return NaN;
    var kept = (frac + new Array(scale + 1).join('0')).slice(0, scale);
    var n = Number(whole) * Math.pow(10, scale) + (kept ? Number(kept) : 0);
    if (frac.length > scale && Number(frac.charAt(scale)) >= 5) n += 1;
    if (!Number.isSafeInteger(n)) return NaN;
    return neg ? -n : n;
  }
  var parseMoney = function (s) { return parseDecimal(s, 2); };   // -> minor units
  var parseQty = function (s) { return parseDecimal(s, 3); };     // -> thousandths
  var parsePercent = function (s) { return parseDecimal(s, 2); }; // -> basis points

  // 123450 -> "1234.50"
  function minorToInput(minor) {
    var neg = minor < 0, n = Math.abs(minor);
    var s = String(Math.floor(n / 100)) + '.' + ('0' + (n % 100)).slice(-2);
    return (neg ? '-' : '') + s;
  }
  // 1500 -> "1.5", 2000 -> "2"
  function milliToInput(milli) {
    var s = String(Math.floor(Math.abs(milli) / 1000));
    var f = ('00' + (Math.abs(milli) % 1000)).slice(-3).replace(/0+$/, '');
    return (milli < 0 ? '-' : '') + s + (f ? '.' + f : '');
  }
  // 600 -> "6", 825 -> "8.25"
  function bpsToInput(bps) {
    var s = String(Math.floor(Math.abs(bps) / 100));
    var f = ('0' + (Math.abs(bps) % 100)).slice(-2).replace(/0+$/, '');
    return (bps < 0 ? '-' : '') + s + (f ? '.' + f : '');
  }

  function formatMoney(minor, currency, locale) {
    var cur = CURRENCIES.indexOf(currency) >= 0 ? currency : 'MYR';
    try {
      return new Intl.NumberFormat(locale || 'en-MY', { style: 'currency', currency: cur }).format(minor / 100);
    } catch (e) {
      return cur + ' ' + minorToInput(minor);
    }
  }

  /* ---------- dates ---------- */

  function isISODate(s) {
    if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
    var d = new Date(s + 'T00:00:00Z');
    return !isNaN(d) && d.toISOString().slice(0, 10) === s;
  }
  function addDays(iso, days) {
    var d = new Date(iso + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
  }

  /* ---------- totals ---------- */

  function lineTotal(item) {
    return roundDiv(item.qtyMilli * item.unitMinor, 1000);
  }

  // doc.discount = { kind: 'none' | 'percent' | 'amount', value }  (percent -> bps, amount -> minor)
  function computeTotals(doc) {
    var lines = (doc.items || []).map(lineTotal);
    var subtotal = lines.reduce(function (a, b) { return a + b; }, 0);
    var discount = 0;
    var d = doc.discount || { kind: 'none', value: 0 };
    if (d.kind === 'percent') discount = roundDiv(subtotal * d.value, 10000);
    else if (d.kind === 'amount') discount = d.value;
    discount = Math.max(0, Math.min(discount, subtotal)); // never below zero, never above subtotal
    var taxable = subtotal - discount;
    var tax = roundDiv(taxable * (doc.taxBps || 0), 10000);
    return { lines: lines, subtotal: subtotal, discount: discount, taxable: taxable, tax: tax, total: taxable + tax };
  }

  /* ---------- numbering & status ---------- */

  // counters = { quote: n, invoice: n }. Returns the next number and the updated counters (input untouched).
  function nextNumber(type, counters) {
    var c = { quote: Number(counters && counters.quote) || 0, invoice: Number(counters && counters.invoice) || 0 };
    c[type] += 1;
    return { number: PREFIX[type] + ('0000' + c[type]).slice(-Math.max(4, String(c[type]).length)), counters: c };
  }

  // The stored status plus two derived ones: an unpaid sent invoice past its due date is "overdue",
  // a sent quote past its valid-until date is "expired".
  function derivedStatus(doc, todayISO) {
    if (doc.status === 'sent' && doc.dueDate && doc.dueDate < todayISO) {
      return doc.type === 'invoice' ? 'overdue' : 'expired';
    }
    return doc.status;
  }

  // Per currency: money still owed, money received, value of quotes waiting for an answer.
  function summarize(docs, todayISO) {
    var out = {};
    docs.forEach(function (doc) {
      var cur = doc.currency;
      if (!out[cur]) out[cur] = { outstanding: 0, paid: 0, openQuotes: 0, overdueCount: 0 };
      var total = computeTotals(doc).total;
      if (doc.type === 'invoice') {
        if (doc.status === 'sent') {
          out[cur].outstanding += total;
          if (derivedStatus(doc, todayISO) === 'overdue') out[cur].overdueCount += 1;
        }
        if (doc.status === 'paid') out[cur].paid += total;
      } else if (doc.status === 'sent' && derivedStatus(doc, todayISO) !== 'expired') {
        out[cur].openQuotes += total;
      }
    });
    return out;
  }

  /* ---------- conversion ---------- */

  // Builds an invoice from a quote. The caller supplies id, today and the payment terms.
  function quoteToInvoice(quote, counters, opts) {
    var n = nextNumber('invoice', counters);
    var invoice = {
      id: opts.id,
      type: 'invoice',
      number: n.number,
      status: 'draft',
      currency: quote.currency,
      issueDate: opts.today,
      dueDate: addDays(opts.today, opts.termsDays),
      client: { name: quote.client.name, email: quote.client.email, address: quote.client.address },
      items: quote.items.map(function (it, i) {
        return { id: (opts.id + '-' + i), desc: it.desc, qtyMilli: it.qtyMilli, unitMinor: it.unitMinor };
      }),
      discount: { kind: quote.discount.kind, value: quote.discount.value },
      taxBps: quote.taxBps,
      notes: opts.notes != null ? opts.notes : quote.notes,
      convertedFrom: quote.number,
      createdAt: opts.now,
      updatedAt: opts.now
    };
    return { invoice: invoice, counters: n.counters };
  }

  /* ---------- validation ---------- */

  // Returns a list of human readable problems. An empty list means the document is ready to print.
  function validateDoc(doc) {
    var errors = [];
    if (!doc.client || !String(doc.client.name || '').trim()) errors.push('Add the client name.');
    var items = doc.items || [];
    if (!items.length) errors.push('Add at least one item.');
    items.forEach(function (it, i) {
      var label = 'Item ' + (i + 1);
      if (!String(it.desc || '').trim()) errors.push(label + ' needs a description.');
      if (!(it.qtyMilli > 0)) errors.push(label + ' needs a quantity above zero.');
      if (!(it.unitMinor >= 0)) errors.push(label + ' needs a price of zero or more.');
      if (it.qtyMilli * it.unitMinor > MAX_LINE_MINOR * 1000) errors.push(label + ' total is too large.');
    });
    if (items.length > MAX_ITEMS) errors.push('Use at most ' + MAX_ITEMS + ' items.');
    if (!isISODate(doc.issueDate)) errors.push('Choose an issue date.');
    if (!isISODate(doc.dueDate)) errors.push(doc.type === 'invoice' ? 'Choose a due date.' : 'Choose a valid-until date.');
    else if (isISODate(doc.issueDate) && doc.dueDate < doc.issueDate) {
      errors.push(doc.type === 'invoice' ? 'Due date is before the issue date.' : 'Valid-until date is before the issue date.');
    }
    if (!(doc.taxBps >= 0 && doc.taxBps <= 10000)) errors.push('Tax must be between 0% and 100%.');
    var d = doc.discount || { kind: 'none', value: 0 };
    if (d.kind === 'percent' && !(d.value >= 0 && d.value <= 10000)) errors.push('Discount must be between 0% and 100%.');
    if (d.kind === 'amount' && !(d.value >= 0)) errors.push('Discount cannot be negative.');
    return errors;
  }

  /* ---------- backup import ---------- */

  function str(v, max) { return typeof v === 'string' ? v.slice(0, max || MAX_TEXT) : ''; }
  function int(v, fallback) { return Number.isSafeInteger(v) ? v : fallback; }

  function defaultSettings() {
    return {
      business: { name: '', address: '', email: '', phone: '' },
      currency: 'MYR',
      taxBps: 0,
      termsDays: 14,
      validDays: 30,
      quoteNotes: '',
      invoiceNotes: '',
      counters: { quote: 0, invoice: 0 }
    };
  }

  function sanitizeSettings(s) {
    var d = defaultSettings();
    if (!s || typeof s !== 'object') return d;
    var b = s.business || {};
    d.business = { name: str(b.name, 200), address: str(b.address), email: str(b.email, 200), phone: str(b.phone, 60) };
    d.currency = CURRENCIES.indexOf(s.currency) >= 0 ? s.currency : 'MYR';
    d.taxBps = Math.max(0, Math.min(10000, int(s.taxBps, 0)));
    d.termsDays = Math.max(0, Math.min(365, int(s.termsDays, 14)));
    d.validDays = Math.max(0, Math.min(365, int(s.validDays, 30)));
    d.quoteNotes = str(s.quoteNotes);
    d.invoiceNotes = str(s.invoiceNotes);
    var c = s.counters || {};
    d.counters = { quote: Math.max(0, int(c.quote, 0)), invoice: Math.max(0, int(c.invoice, 0)) };
    return d;
  }

  function sanitizeDoc(x) {
    if (!x || typeof x !== 'object') return null;
    if (typeof x.id !== 'string' || !x.id || x.id.length > 80) return null;
    if (TYPES.indexOf(x.type) < 0) return null;
    if (!isISODate(x.issueDate) || !isISODate(x.dueDate)) return null;
    if (!Array.isArray(x.items) || x.items.length > MAX_ITEMS) return null;
    var items = [];
    for (var i = 0; i < x.items.length; i++) {
      var it = x.items[i];
      if (!it || !Number.isSafeInteger(it.qtyMilli) || !Number.isSafeInteger(it.unitMinor)) return null;
      if (it.qtyMilli < 0 || it.unitMinor < 0 || it.qtyMilli * it.unitMinor > MAX_LINE_MINOR * 1000) return null;
      items.push({ id: str(it.id, 80) || (x.id + '-' + i), desc: str(it.desc, 300), qtyMilli: it.qtyMilli, unitMinor: it.unitMinor });
    }
    var dk = x.discount && ['none', 'percent', 'amount'].indexOf(x.discount.kind) >= 0 ? x.discount.kind : 'none';
    var dv = x.discount ? int(x.discount.value, 0) : 0;
    if (dv < 0 || dv > 1e11) dv = 0;
    if (dk === 'percent' && dv > 10000) dv = 10000;
    var cl = x.client || {};
    return {
      id: x.id,
      type: x.type,
      number: str(x.number, 40),
      status: STATUSES[x.type].indexOf(x.status) >= 0 ? x.status : 'draft',
      currency: CURRENCIES.indexOf(x.currency) >= 0 ? x.currency : 'MYR',
      issueDate: x.issueDate,
      dueDate: x.dueDate,
      client: { name: str(cl.name, 200), email: str(cl.email, 200), address: str(cl.address) },
      items: items,
      discount: { kind: dk, value: dk === 'none' ? 0 : dv },
      taxBps: Math.max(0, Math.min(10000, int(x.taxBps, 0))),
      notes: str(x.notes),
      convertedFrom: str(x.convertedFrom, 40),
      createdAt: int(x.createdAt, 0),
      updatedAt: int(x.updatedAt, 0)
    };
  }

  // Never trust an imported file: rebuild every field from scratch and drop anything unusable.
  function sanitizeBackup(obj) {
    if (!obj || typeof obj !== 'object' || obj.app !== 'quotekit') return { ok: false, error: 'This file is not a QuoteKit backup.' };
    if (obj.version !== 1) return { ok: false, error: 'This backup was made by a different version of QuoteKit.' };
    if (!Array.isArray(obj.docs) || obj.docs.length > 5000) return { ok: false, error: 'The backup has no valid document list.' };
    var docs = [], seen = {}, dropped = 0;
    obj.docs.forEach(function (raw) {
      var d = sanitizeDoc(raw);
      if (!d || seen[d.id]) { dropped += 1; return; }
      seen[d.id] = true; docs.push(d);
    });
    var settings = sanitizeSettings(obj.settings);
    // keep the counters ahead of every imported number so new documents never reuse one
    docs.forEach(function (d) {
      var m = /(\d+)$/.exec(d.number);
      if (m) settings.counters[d.type] = Math.max(settings.counters[d.type], Number(m[1]));
    });
    return { ok: true, data: { settings: settings, docs: docs }, dropped: dropped };
  }

  return {
    CURRENCIES: CURRENCIES, TYPES: TYPES, STATUSES: STATUSES, MAX_ITEMS: MAX_ITEMS, MAX_LINE_MINOR: MAX_LINE_MINOR,
    roundDiv: roundDiv, parseDecimal: parseDecimal, parseMoney: parseMoney, parseQty: parseQty, parsePercent: parsePercent,
    minorToInput: minorToInput, milliToInput: milliToInput, bpsToInput: bpsToInput, formatMoney: formatMoney,
    isISODate: isISODate, addDays: addDays,
    lineTotal: lineTotal, computeTotals: computeTotals,
    nextNumber: nextNumber, derivedStatus: derivedStatus, summarize: summarize, quoteToInvoice: quoteToInvoice,
    validateDoc: validateDoc, defaultSettings: defaultSettings, sanitizeSettings: sanitizeSettings, sanitizeBackup: sanitizeBackup
  };
});
