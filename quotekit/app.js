/* QuoteKit interface. All maths lives in lib/calc.js (unit tested); this file only handles screens and storage. */
(function () {
  'use strict';
  var Q = window.QuoteCalc;
  var KEY = 'quotekit-v1';
  var app = document.getElementById('app');

  /* ---------- small DOM helper (text always goes in as text, never as HTML) ---------- */
  function h(tag, props) {
    var el = document.createElement(tag);
    props = props || {};
    Object.keys(props).forEach(function (k) {
      var v = props[k];
      if (v == null || v === false) return;
      if (k === 'class') el.className = v;
      else if (k.slice(0, 2) === 'on') el.addEventListener(k.slice(2), v);
      else if (k === 'value') el.value = v;
      else el.setAttribute(k, v === true ? '' : v);
    });
    for (var i = 2; i < arguments.length; i++) add(el, arguments[i]);
    return el;
  }
  function add(el, c) {
    if (c == null || c === false) return;
    if (Array.isArray(c)) c.forEach(function (x) { add(el, x); });
    else if (c.nodeType) el.appendChild(c);
    else el.appendChild(document.createTextNode(String(c)));
  }
  function select(options, value, onchange, attrs) {
    var s = h('select', attrs || {});
    options.forEach(function (o) { s.appendChild(h('option', { value: o[0] }, o[1])); });
    s.value = value;
    s.addEventListener('change', onchange);
    return s;
  }

  /* ---------- formatting ---------- */
  function today() {
    var d = new Date();
    return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2);
  }
  function fmtDate(iso) {
    return new Date(iso + 'T00:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
  }
  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }
  var STATUS_LABEL = { draft: 'Draft', sent: 'Sent', accepted: 'Accepted', declined: 'Declined', paid: 'Paid', overdue: 'Overdue', expired: 'Expired' };
  var TYPE_LABEL = { quote: 'Quotation', invoice: 'Invoice' };
  function badge(status) { return h('span', { class: 'badge s-' + status }, STATUS_LABEL[status] || status); }

  var toastEl = document.getElementById('toast'), toastTimer;
  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.classList.remove('show'); }, 3500);
  }

  /* ---------- storage ---------- */
  function emptyState() { return { settings: Q.defaultSettings(), docs: [] }; }
  function load() {
    try {
      var raw = localStorage.getItem(KEY);
      if (!raw) return emptyState();
      var r = Q.sanitizeBackup(JSON.parse(raw));
      return r.ok ? r.data : emptyState();
    } catch (e) { return emptyState(); }
  }
  var state = load();
  function save() {
    try {
      localStorage.setItem(KEY, JSON.stringify({ app: 'quotekit', version: 1, settings: state.settings, docs: state.docs }));
      return true;
    } catch (e) {
      toast('Could not save: browser storage is blocked or full.');
      return false;
    }
  }
  function findDoc(id) { return state.docs.filter(function (d) { return d.id === id; })[0]; }
  function blankItem() { return { id: uid(), desc: '', qtyMilli: 1000, unitMinor: 0 }; }

  /* ---------- document actions ---------- */
  function createDoc(type) {
    var s = state.settings, t = today(), n = Q.nextNumber(type, s.counters), now = Date.now();
    s.counters = n.counters;
    var doc = {
      id: uid(), type: type, number: n.number, status: 'draft', currency: s.currency,
      issueDate: t, dueDate: Q.addDays(t, type === 'quote' ? s.validDays : s.termsDays),
      client: { name: '', email: '', address: '' }, items: [blankItem()],
      discount: { kind: 'none', value: 0 }, taxBps: s.taxBps,
      notes: type === 'quote' ? s.quoteNotes : s.invoiceNotes, convertedFrom: '', createdAt: now, updatedAt: now
    };
    state.docs.push(doc);
    save();
    return doc;
  }
  function duplicateDoc(doc) {
    var s = state.settings, t = today(), n = Q.nextNumber(doc.type, s.counters), now = Date.now();
    s.counters = n.counters;
    var copy = JSON.parse(JSON.stringify(doc));
    copy.id = uid(); copy.number = n.number; copy.status = 'draft'; copy.convertedFrom = '';
    copy.issueDate = t; copy.dueDate = Q.addDays(t, doc.type === 'quote' ? s.validDays : s.termsDays);
    copy.items.forEach(function (it) { it.id = uid(); });
    copy.createdAt = now; copy.updatedAt = now;
    state.docs.push(copy);
    save();
    return copy;
  }
  function convertToInvoice(quote) {
    var s = state.settings;
    var r = Q.quoteToInvoice(quote, s.counters, {
      id: uid(), today: today(), termsDays: s.termsDays, now: Date.now(), notes: s.invoiceNotes || undefined
    });
    s.counters = r.counters;
    state.docs.push(r.invoice);
    if (quote.status !== 'accepted') { quote.status = 'accepted'; quote.updatedAt = Date.now(); }
    save();
    return r.invoice;
  }

  function loadSample() {
    var s = state.settings, now = Date.now(), k = 0;
    function mk(type, status, client, items, o) {
      var n = Q.nextNumber(type, s.counters); s.counters = n.counters;
      var issue = Q.addDays(today(), o.offset);
      k += 1;
      state.docs.push({
        id: uid() + k, type: type, number: n.number, status: status, currency: s.currency,
        issueDate: issue, dueDate: Q.addDays(issue, o.days),
        client: { name: client[0], email: client[1], address: client[2] },
        items: items.map(function (it, i) { return { id: uid() + i, desc: it[0], qtyMilli: Q.parseQty(it[1]), unitMinor: Q.parseMoney(it[2]) }; }),
        discount: o.discount || { kind: 'none', value: 0 }, taxBps: o.tax || 0,
        notes: 'Sample data for demonstration.', convertedFrom: '', createdAt: now - k * 1000, updatedAt: now - k * 1000
      });
    }
    mk('quote', 'accepted', ['Sample Café Sdn Bhd', 'hello@samplecafe.example', '12 Jalan Contoh\n50000 Kuala Lumpur'],
      [['Website design (5 pages)', '1', '2800'], ['Mobile-friendly setup and testing', '1', '600'], ['Contact form', '1', '250']],
      { offset: -12, days: 30, discount: { kind: 'percent', value: 500 } });
    mk('invoice', 'paid', ['Sample Café Sdn Bhd', 'hello@samplecafe.example', '12 Jalan Contoh\n50000 Kuala Lumpur'],
      [['Deposit for website project', '1', '1500']], { offset: -10, days: 14 });
    mk('invoice', 'sent', ['Warung Contoh', '', 'Lot 5, Jalan Sampel\n40000 Shah Alam'],
      [['Menu page update (hours)', '3', '80'], ['Logo clean-up', '1', '150']], { offset: -30, days: 14, tax: 600 });
    mk('invoice', 'sent', ['Studio Bunga (sample)', 'studio@bunga.example', ''],
      [['Booking form', '1', '900']], { offset: -3, days: 14 });
    mk('quote', 'sent', ['Sample Fitness Club', 'admin@samplefit.example', ''],
      [['Member sign-up page', '1', '1800'], ['Monthly content updates', '3', '200']],
      { offset: -2, days: 30, discount: { kind: 'amount', value: 10000 } });
    mk('quote', 'draft', ['Sample Bakery', '', ''], [['Online order form', '1', '1200']], { offset: 0, days: 30 });
    save();
  }

  /* ---------- routing ---------- */
  function setNav(hash) {
    document.getElementById('nav-docs').setAttribute('aria-current', hash === '#/settings' ? 'false' : 'page');
    document.getElementById('nav-settings').setAttribute('aria-current', hash === '#/settings' ? 'page' : 'false');
  }
  function route() {
    var hash = location.hash || '#/';
    setNav(hash);
    var m;
    if (hash === '#/settings') viewSettings();
    else if ((m = hash.match(/^#\/new\/(quote|invoice)$/))) { location.replace('#/doc/' + createDoc(m[1]).id); return; }
    else if ((m = hash.match(/^#\/doc\/([\w-]+)$/))) viewEditor(m[1]);
    else viewList();
    window.scrollTo(0, 0);
  }
  window.addEventListener('hashchange', route);

  /* ============================== LIST ============================== */
  var ui = { q: '', type: 'all', status: 'all' };

  function viewList() {
    var t = today(), sum = Q.summarize(state.docs, t), cur = state.settings.currency;
    var s0 = sum[cur] || { outstanding: 0, paid: 0, openQuotes: 0, overdueCount: 0 };
    var others = Object.keys(sum).filter(function (c) { return c !== cur; });
    app.textContent = '';

    app.appendChild(h('div', { class: 'page-head' },
      h('h1', null, 'Documents'),
      h('div', { class: 'btn-row' },
        h('a', { class: 'btn', href: '#/new/quote' }, '+ New quotation'),
        h('a', { class: 'btn primary', href: '#/new/invoice' }, '+ New invoice'))));

    if (!state.docs.length) {
      app.appendChild(h('div', { class: 'card empty' },
        h('h1', null, 'No documents yet'),
        h('p', null, 'Create your first quotation or invoice. Everything is saved in this browser, so there is no account to set up. Want to look around first? Load a few sample documents.'),
        h('div', { class: 'btn-row' },
          h('a', { class: 'btn primary', href: '#/new/quote' }, 'Create a quotation'),
          h('button', { class: 'btn', type: 'button', onclick: function () { loadSample(); viewList(); toast('Sample documents added.'); } }, 'Load sample data'))));
      return;
    }

    app.appendChild(h('div', { class: 'summary' },
      h('div', { class: 'stat' }, h('div', { class: 'l' }, 'Waiting to be paid'), h('div', { class: 'v' }, Q.formatMoney(s0.outstanding, cur)),
        h('div', { class: 'n' + (s0.overdueCount ? ' bad' : '') }, s0.overdueCount ? s0.overdueCount + ' overdue' : 'Nothing overdue')),
      h('div', { class: 'stat' }, h('div', { class: 'l' }, 'Paid'), h('div', { class: 'v' }, Q.formatMoney(s0.paid, cur)), h('div', { class: 'n' }, 'Invoices marked paid')),
      h('div', { class: 'stat' }, h('div', { class: 'l' }, 'Open quotations'), h('div', { class: 'v' }, Q.formatMoney(s0.openQuotes, cur)), h('div', { class: 'n' }, 'Sent, waiting for an answer'))));
    if (others.length) {
      app.appendChild(h('p', { class: 'hint', style: 'margin:-6px 0 14px' }, 'Totals above are in ' + cur + '. You also have documents in ' + others.join(', ') + '.'));
    }

    var rowsBox = h('div', { class: 'rows', 'aria-live': 'polite' });
    app.appendChild(h('div', { class: 'toolbar' },
      h('input', { type: 'search', placeholder: 'Search by client or number…', 'aria-label': 'Search documents', value: ui.q, oninput: function (e) { ui.q = e.target.value; drawRows(rowsBox); } }),
      select([['all', 'All types'], ['quote', 'Quotations'], ['invoice', 'Invoices']], ui.type, function (e) { ui.type = e.target.value; drawRows(rowsBox); }, { 'aria-label': 'Filter by type' }),
      select([['all', 'All statuses']].concat(Object.keys(STATUS_LABEL).map(function (k) { return [k, STATUS_LABEL[k]]; })), ui.status,
        function (e) { ui.status = e.target.value; drawRows(rowsBox); }, { 'aria-label': 'Filter by status' })));
    app.appendChild(rowsBox);
    drawRows(rowsBox);
  }

  function drawRows(box) {
    var t = today(), q = ui.q.trim().toLowerCase();
    var list = state.docs.filter(function (d) {
      if (ui.type !== 'all' && d.type !== ui.type) return false;
      if (ui.status !== 'all' && Q.derivedStatus(d, t) !== ui.status) return false;
      if (q && (d.client.name + ' ' + d.number).toLowerCase().indexOf(q) < 0) return false;
      return true;
    }).sort(function (a, b) { return b.updatedAt - a.updatedAt; });
    box.textContent = '';
    if (!list.length) { box.appendChild(h('div', { class: 'card empty' }, h('p', null, 'No documents match your search.'))); return; }
    list.forEach(function (d) {
      var total = Q.computeTotals(d).total;
      box.appendChild(h('a', { class: 'row', href: '#/doc/' + d.id },
        h('div', { class: 'c-num' }, h('b', null, d.number), h('small', null, TYPE_LABEL[d.type])),
        h('div', { class: 'c-client' }, d.client.name || h('span', { class: 'muted' }, '(no client yet)')),
        h('div', { class: 'c-date' }, fmtDate(d.issueDate)),
        h('div', { class: 'c-total' }, Q.formatMoney(total, d.currency)),
        h('div', { class: 'c-status' }, badge(Q.derivedStatus(d, t)))));
    });
  }

  /* ============================== EDITOR ============================== */
  function viewEditor(id) {
    var doc = findDoc(id);
    app.textContent = '';
    if (!doc) {
      app.appendChild(h('div', { class: 'card empty' }, h('h1', null, 'Document not found'), h('p', null, 'It may have been deleted.'), h('a', { class: 'btn primary', href: '#/' }, 'Back to documents')));
      return;
    }
    var isInv = doc.type === 'invoice';
    function canonRaw(it) { return { qty: Q.milliToInput(it.qtyMilli), price: Q.minorToInput(it.unitMinor) }; }
    var raw = {
      items: doc.items.map(canonRaw),
      discount: doc.discount.kind === 'percent' ? Q.bpsToInput(doc.discount.value) : doc.discount.kind === 'amount' ? Q.minorToInput(doc.discount.value) : '',
      tax: Q.bpsToInput(doc.taxBps)
    };
    var bad = {};
    var amtEls = [], problemsBox = h('div', { 'aria-live': 'polite' }), paperBox = h('div'), printBtn, convertBtn, titleBadge = h('span'), discountVal, discWrap;

    function anyBad() { return Object.keys(bad).some(function (k) { return bad[k]; }); }
    function mark(input, isBad) { if (input) { if (isBad) input.setAttribute('aria-invalid', 'true'); else input.removeAttribute('aria-invalid'); } }

    function refresh() {
      doc.items.forEach(function (it, i) { if (amtEls[i]) amtEls[i].textContent = Q.formatMoney(Q.lineTotal(it), doc.currency); });
      paperBox.textContent = ''; paperBox.appendChild(renderPaper(doc));
      var errs = Q.validateDoc(doc);
      if (anyBad()) errs.unshift('Some numbers are not valid. Use digits only, like 1,250.50.');
      problemsBox.textContent = '';
      if (errs.length) problemsBox.appendChild(h('div', { class: 'problems' }, h('b', null, 'Before you print or convert:'), h('ul', null, errs.map(function (e) { return h('li', null, e); }))));
      if (printBtn) printBtn.disabled = errs.length > 0;
      if (convertBtn) convertBtn.disabled = errs.length > 0;
      titleBadge.textContent = ''; titleBadge.appendChild(badge(Q.derivedStatus(doc, today())));
    }
    function persist() { doc.updatedAt = Date.now(); save(); refresh(); }

    /* field setters: a value is only stored when it is valid, so a half-typed number never overwrites good data */
    function setItemNumber(i, key, value) {
      var it = doc.items[i], isQty = key === 'qty';
      raw.items[i][key] = value;
      var v = value.trim() === '' ? (isQty ? NaN : 0) : (isQty ? Q.parseQty(value) : Q.parseMoney(value));
      var qty = isQty ? v : it.qtyMilli, price = isQty ? it.unitMinor : v;
      var ok = !isNaN(v) && v >= 0 && qty * price <= Q.MAX_LINE_MINOR * 1000 && (isQty ? v <= 1e9 : v <= Q.MAX_LINE_MINOR);
      bad['i' + i + key] = !ok;
      if (ok) { if (isQty) it.qtyMilli = v; else it.unitMinor = v; }
      return ok;
    }
    function setDate(key, input) {
      var ok = Q.isISODate(input.value);
      bad[key] = !ok; mark(input, !ok);
      if (ok) doc[key] = input.value;
      persist();
    }

    /* ----- header ----- */
    var statusSel = select(Q.STATUSES[doc.type].map(function (s) { return [s, STATUS_LABEL[s]]; }), doc.status, function (e) { doc.status = e.target.value; persist(); }, { 'aria-label': 'Status', style: 'width:auto' });
    printBtn = h('button', { class: 'btn primary', type: 'button', onclick: function () { window.print(); } }, 'Print / Save as PDF');
    convertBtn = isInv ? null : h('button', { class: 'btn', type: 'button', onclick: function () {
      var inv = convertToInvoice(doc);
      location.hash = '#/doc/' + inv.id;
      toast('Invoice ' + inv.number + ' created from ' + doc.number + '.');
    } }, 'Convert to invoice');
    var delBtn, delTimer;
    delBtn = h('button', { class: 'btn danger', type: 'button', onclick: function () {
      if (!delBtn.classList.contains('sure')) {
        delBtn.classList.add('sure'); delBtn.textContent = 'Click again to delete';
        delTimer = setTimeout(function () { delBtn.classList.remove('sure'); delBtn.textContent = 'Delete'; }, 3000);
        return;
      }
      clearTimeout(delTimer);
      state.docs = state.docs.filter(function (d) { return d.id !== doc.id; });
      save(); location.hash = '#/'; toast(doc.number + ' deleted.');
    } }, 'Delete');

    app.appendChild(h('div', { class: 'editor-head no-print' },
      h('div', null,
        h('h1', null, TYPE_LABEL[doc.type] + ' ' + doc.number),
        h('div', { class: 'sub' }, doc.convertedFrom ? 'Created from ' + doc.convertedFrom + ' · ' : '', 'Currency: ' + doc.currency)),
      h('div', { class: 'btn-row' }, titleBadge, statusSel)));

    /* ----- form ----- */
    var form = h('div', { class: 'form' });

    var dueInput = h('input', { type: 'date', value: doc.dueDate, 'aria-label': isInv ? 'Due date' : 'Valid until', oninput: function (e) { setDate('dueDate', e.target); } });
    var issueInput = h('input', { type: 'date', value: doc.issueDate, 'aria-label': 'Issue date', oninput: function (e) { setDate('issueDate', e.target); } });
    form.appendChild(h('div', { class: 'card' }, h('h2', null, 'Dates'),
      h('div', { class: 'grid2' },
        h('label', { class: 'field' }, h('span', null, 'Issue date'), issueInput),
        h('label', { class: 'field' }, h('span', null, isInv ? 'Due date' : 'Valid until'), dueInput))));

    function textField(label, key, attrs, parent) {
      var input = h(attrs.area ? 'textarea' : 'input', Object.assign({ value: parent[key], maxlength: attrs.max, placeholder: attrs.ph || null, autocomplete: 'off',
        oninput: function (e) { parent[key] = e.target.value; persist(); } }, attrs.area ? { rows: 3 } : { type: attrs.type || 'text' }));
      return h('label', { class: 'field' }, h('span', null, label), input);
    }
    form.appendChild(h('div', { class: 'card' }, h('h2', null, 'Client'),
      textField('Name', 'name', { max: 200, ph: 'Client or company name' }, doc.client),
      h('div', { class: 'grid2' }, textField('Email', 'email', { max: 200, type: 'email', ph: 'Optional' }, doc.client)),
      textField('Address', 'address', { max: 2000, area: true, ph: 'Optional' }, doc.client)));

    /* items */
    var itemsBox = h('div', { class: 'form', style: 'gap:8px' });
    var addBtn = h('button', { class: 'btn sm', type: 'button', onclick: function () {
      if (doc.items.length >= Q.MAX_ITEMS) { toast('You can add up to ' + Q.MAX_ITEMS + ' items.'); return; }
      doc.items.push(blankItem()); raw.items = doc.items.map(canonRaw);
      drawItems(); persist();
      var rows = itemsBox.querySelectorAll('.i-desc'); rows[rows.length - 1].focus();
    } }, '+ Add item');
    function drawItems() {
      itemsBox.textContent = ''; amtEls = [];
      doc.items.forEach(function (it, i) {
        var qty = h('input', { inputmode: 'decimal', 'aria-label': 'Item ' + (i + 1) + ' quantity', value: raw.items[i].qty, autocomplete: 'off',
          oninput: function (e) { mark(e.target, !setItemNumber(i, 'qty', e.target.value)); persist(); } });
        var price = h('input', { inputmode: 'decimal', 'aria-label': 'Item ' + (i + 1) + ' unit price', value: raw.items[i].price, autocomplete: 'off',
          oninput: function (e) { mark(e.target, !setItemNumber(i, 'price', e.target.value)); persist(); } });
        var out = h('output', { 'aria-label': 'Item ' + (i + 1) + ' amount' }, Q.formatMoney(Q.lineTotal(it), doc.currency));
        amtEls.push(out);
        itemsBox.appendChild(h('div', { class: 'item-row' },
          h('input', { class: 'i-desc', maxlength: 300, placeholder: 'What are you charging for?', 'aria-label': 'Item ' + (i + 1) + ' description', value: it.desc, autocomplete: 'off',
            oninput: function (e) { it.desc = e.target.value; persist(); } }),
          h('label', { class: 'mini i-qty' }, h('span', null, 'Qty'), qty),
          h('label', { class: 'mini i-price' }, h('span', null, 'Unit price'), price),
          h('div', { class: 'mini amt' }, h('span', null, 'Amount'), out),
          h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Remove item ' + (i + 1), title: 'Remove item', onclick: function () {
            if (doc.items.length > 1) doc.items.splice(i, 1); else doc.items[0] = blankItem();
            raw.items = doc.items.map(canonRaw); // show the stored values again, dropping any half-typed text
            Object.keys(bad).forEach(function (k) { if (/^i\d/.test(k)) delete bad[k]; });
            drawItems(); persist();
          } }, '×')));
      });
    }
    drawItems();
    form.appendChild(h('div', { class: 'card' }, h('h2', null, 'Items'), itemsBox, h('div', null, addBtn)));

    /* discount + tax */
    discountVal = h('input', { inputmode: 'decimal', value: raw.discount, 'aria-label': 'Discount value', autocomplete: 'off',
      oninput: function (e) {
        raw.discount = e.target.value;
        var kind = doc.discount.kind;
        var v = e.target.value.trim() === '' ? 0 : (kind === 'percent' ? Q.parsePercent(e.target.value) : Q.parseMoney(e.target.value));
        var ok = !isNaN(v) && v >= 0 && (kind === 'percent' ? v <= 10000 : v <= 1e12);
        bad.discount = !ok; mark(e.target, !ok);
        if (ok) doc.discount.value = v;
        persist();
      } });
    discWrap = h('div', { style: doc.discount.kind === 'none' ? 'display:none' : '' }, discountVal);
    var discSel = select([['none', 'No discount'], ['percent', 'Percent (%)'], ['amount', 'Fixed amount']], doc.discount.kind, function (e) {
      doc.discount = { kind: e.target.value, value: 0 }; raw.discount = ''; discountVal.value = ''; bad.discount = false; mark(discountVal, false);
      discWrap.style.display = e.target.value === 'none' ? 'none' : '';
      discountVal.placeholder = e.target.value === 'percent' ? 'e.g. 10' : 'e.g. 50.00';
      persist();
    }, { 'aria-label': 'Discount type' });
    discountVal.placeholder = doc.discount.kind === 'percent' ? 'e.g. 10' : 'e.g. 50.00';
    var taxInput = h('input', { inputmode: 'decimal', value: raw.tax, 'aria-label': 'Tax percent', autocomplete: 'off', oninput: function (e) {
      raw.tax = e.target.value;
      var v = e.target.value.trim() === '' ? 0 : Q.parsePercent(e.target.value);
      var ok = !isNaN(v) && v >= 0 && v <= 10000;
      bad.tax = !ok; mark(e.target, !ok);
      if (ok) doc.taxBps = v;
      persist();
    } });
    form.appendChild(h('div', { class: 'card' }, h('h2', null, 'Discount and tax'),
      h('div', { class: 'disc-row' }, discSel, discWrap),
      h('label', { class: 'field' }, h('span', null, 'Tax (%) — leave at 0 if you do not charge tax'), taxInput)));

    form.appendChild(h('div', { class: 'card' }, h('h2', null, 'Notes and terms'),
      h('label', { class: 'field' }, h('span', null, 'Shown at the bottom of the document'),
        h('textarea', { rows: 4, maxlength: 2000, placeholder: isInv ? 'Payment details, bank account, thank-you note…' : 'What is included, delivery time, how to accept…', value: doc.notes,
          oninput: function (e) { doc.notes = e.target.value; persist(); } }))));

    form.appendChild(problemsBox);
    form.appendChild(h('div', { class: 'btn-row' },
      printBtn, convertBtn,
      h('button', { class: 'btn', type: 'button', onclick: function () { var c = duplicateDoc(doc); location.hash = '#/doc/' + c.id; toast('Copied as ' + c.number + '.'); } }, 'Duplicate'),
      delBtn,
      h('a', { class: 'btn', href: '#/' }, '← All documents')));

    app.appendChild(h('div', { class: 'editor-grid' }, form, h('div', { class: 'preview-wrap' }, h('h2', { class: 'no-print' }, 'Preview'), paperBox)));
    refresh();
  }

  /* the document that is shown in the preview and sent to the printer */
  function renderPaper(doc) {
    var b = state.settings.business, t = Q.computeTotals(doc), cur = doc.currency, isInv = doc.type === 'invoice';
    var disc = doc.discount;
    var rows = doc.items.map(function (it) {
      return h('tr', null, h('td', null, it.desc || h('span', { class: 'ph' }, '—')), h('td', { class: 'n' }, Q.milliToInput(it.qtyMilli)),
        h('td', { class: 'n' }, Q.formatMoney(it.unitMinor, cur)), h('td', { class: 'n' }, Q.formatMoney(Q.lineTotal(it), cur)));
    });
    var totals = [h('div', null, h('span', null, 'Subtotal'), h('span', null, Q.formatMoney(t.subtotal, cur)))];
    if (t.discount > 0) totals.push(h('div', null, h('span', null, 'Discount' + (disc.kind === 'percent' ? ' (' + Q.bpsToInput(disc.value) + '%)' : '')), h('span', null, '−' + Q.formatMoney(t.discount, cur))));
    if (doc.taxBps > 0) totals.push(h('div', null, h('span', null, 'Tax (' + Q.bpsToInput(doc.taxBps) + '%)'), h('span', null, Q.formatMoney(t.tax, cur))));
    totals.push(h('div', { class: 'grand' }, h('span', null, 'Total'), h('span', null, Q.formatMoney(t.total, cur))));

    return h('article', { class: 'paper', 'aria-label': TYPE_LABEL[doc.type] + ' preview' },
      h('div', { class: 'p-top' },
        h('div', null, h('div', { class: 'p-name' }, b.name || h('span', { class: 'ph' }, 'Your business name')),
          b.address ? h('div', { class: 'p-line' }, b.address) : null,
          (b.email || b.phone) ? h('div', { class: 'p-line' }, [b.email, b.phone].filter(Boolean).join(' · ')) : null),
        h('div', { class: 'p-title' }, h('div', { class: 'p-doc' }, isInv ? 'INVOICE' : 'QUOTATION'), h('div', { class: 'p-num' }, doc.number),
          isInv && doc.status === 'paid' ? h('div', { class: 'p-stamp' }, 'PAID') : null)),
      h('div', { class: 'p-cols' },
        h('div', { class: 'p-bill' }, h('div', { class: 'p-label' }, isInv ? 'Bill to' : 'Prepared for'),
          h('b', null, doc.client.name || h('span', { class: 'ph' }, 'Client name')),
          doc.client.address ? h('div', { class: 'p-line' }, doc.client.address) : null,
          doc.client.email ? h('div', { class: 'p-line' }, doc.client.email) : null),
        h('dl', { class: 'p-meta' }, h('dt', null, 'Issue date'), h('dd', null, fmtDate(doc.issueDate)),
          h('dt', null, isInv ? 'Due date' : 'Valid until'), h('dd', null, fmtDate(doc.dueDate)))),
      h('table', null, h('thead', null, h('tr', null, h('th', null, 'Description'), h('th', { class: 'n' }, 'Qty'), h('th', { class: 'n' }, 'Unit price'), h('th', { class: 'n' }, 'Amount'))), h('tbody', null, rows)),
      h('div', { class: 'p-totals' }, totals),
      doc.notes ? h('div', { class: 'p-notes' }, h('div', { class: 'p-label' }, 'Notes'), doc.notes) : null,
      h('div', { class: 'p-foot' }, 'Prepared with QuoteKit'));
  }

  /* ============================== SETTINGS ============================== */
  function viewSettings() {
    var s = state.settings;
    app.textContent = '';
    function biz(label, key, attrs) {
      return h('label', { class: 'field' }, h('span', null, label),
        h(attrs.area ? 'textarea' : 'input', Object.assign({ value: s.business[key], maxlength: attrs.max, placeholder: attrs.ph || null, autocomplete: 'off',
          oninput: function (e) { s.business[key] = e.target.value; save(); } }, attrs.area ? { rows: 3 } : { type: attrs.type || 'text' })));
    }
    function num(label, key, min, max, hint) {
      var input = h('input', { inputmode: 'numeric', value: String(s[key]), autocomplete: 'off', oninput: function (e) {
        var v = /^\d{1,3}$/.test(e.target.value.trim()) ? Number(e.target.value) : NaN;
        var ok = !isNaN(v) && v >= min && v <= max;
        if (ok) { s[key] = v; save(); }
        if (ok) e.target.removeAttribute('aria-invalid'); else e.target.setAttribute('aria-invalid', 'true');
      } });
      return h('label', { class: 'field' }, h('span', null, label), input, h('span', { class: 'hint' }, hint));
    }
    var taxInput = h('input', { inputmode: 'decimal', value: Q.bpsToInput(s.taxBps), autocomplete: 'off', oninput: function (e) {
      var v = e.target.value.trim() === '' ? 0 : Q.parsePercent(e.target.value);
      var ok = !isNaN(v) && v >= 0 && v <= 10000;
      if (ok) { s.taxBps = v; save(); e.target.removeAttribute('aria-invalid'); } else e.target.setAttribute('aria-invalid', 'true');
    } });
    var curSel = select(Q.CURRENCIES.map(function (c) { return [c, c]; }), s.currency, function (e) { s.currency = e.target.value; save(); });

    var importSlot = h('div');
    var fileInput = h('input', { type: 'file', accept: 'application/json,.json', 'aria-label': 'Choose a backup file', onchange: function (e) {
      var f = e.target.files[0]; if (!f) return;
      importSlot.textContent = '';
      if (f.size > 5 * 1024 * 1024) { toast('That file is too large to be a QuoteKit backup.'); return; }
      var rd = new FileReader();
      rd.onload = function () {
        var parsed;
        try { parsed = JSON.parse(String(rd.result)); } catch (err) { toast('That file is not valid JSON.'); return; }
        var r = Q.sanitizeBackup(parsed);
        if (!r.ok) { toast(r.error); return; }
        importSlot.appendChild(h('div', { class: 'import-box' },
          h('div', null, 'This backup has ' + r.data.docs.length + ' document' + (r.data.docs.length === 1 ? '' : 's') + (r.dropped ? ' (' + r.dropped + ' unusable ' + (r.dropped === 1 ? 'entry was' : 'entries were') + ' skipped)' : '') + '. Importing replaces everything currently in QuoteKit.'),
          h('div', { class: 'btn-row' },
            h('button', { class: 'btn primary', type: 'button', onclick: function () { state = r.data; if (save()) { toast('Backup imported.'); viewSettings(); } } }, 'Replace my data'),
            h('button', { class: 'btn', type: 'button', onclick: function () { importSlot.textContent = ''; fileInput.value = ''; } }, 'Cancel'))));
      };
      rd.readAsText(f);
    } });
    var wipeBtn, wipeTimer;
    wipeBtn = h('button', { class: 'btn danger', type: 'button', onclick: function () {
      if (!wipeBtn.classList.contains('sure')) {
        wipeBtn.classList.add('sure'); wipeBtn.textContent = 'Click again to erase everything';
        wipeTimer = setTimeout(function () { wipeBtn.classList.remove('sure'); wipeBtn.textContent = 'Delete all data'; }, 3500);
        return;
      }
      clearTimeout(wipeTimer); state = emptyState(); save(); toast('All data deleted.'); viewSettings();
    } }, 'Delete all data');

    app.appendChild(h('div', { class: 'page-head' }, h('h1', null, 'Settings')));
    app.appendChild(h('div', { class: 'settings' },
      h('div', { class: 'card' }, h('h2', null, 'Your business'),
        h('p', { class: 'hint' }, 'Shown at the top of every quotation and invoice.'),
        biz('Business name', 'name', { max: 200, ph: 'e.g. Aiman Web Studio' }),
        biz('Address', 'address', { max: 2000, area: true }),
        h('div', { class: 'grid2' }, biz('Email', 'email', { max: 200, type: 'email' }), biz('Phone', 'phone', { max: 60 }))),
      h('div', { class: 'card' }, h('h2', null, 'Defaults for new documents'),
        h('div', { class: 'grid2' }, h('label', { class: 'field' }, h('span', null, 'Currency'), curSel),
          h('label', { class: 'field' }, h('span', null, 'Tax (%)'), taxInput, h('span', { class: 'hint' }, 'Leave at 0 if you do not charge tax.'))),
        h('div', { class: 'grid2' }, num('Invoice due after (days)', 'termsDays', 0, 365, 'Used to set the due date.'), num('Quotation valid for (days)', 'validDays', 0, 365, 'Used to set the valid-until date.')),
        h('label', { class: 'field' }, h('span', null, 'Default quotation notes'), h('textarea', { rows: 3, maxlength: 2000, value: s.quoteNotes, oninput: function (e) { s.quoteNotes = e.target.value; save(); } })),
        h('label', { class: 'field' }, h('span', null, 'Default invoice notes'), h('textarea', { rows: 3, maxlength: 2000, placeholder: 'e.g. bank details and payment instructions', value: s.invoiceNotes, oninput: function (e) { s.invoiceNotes = e.target.value; save(); } }))),
      h('div', { class: 'card' }, h('h2', null, 'Backup'),
        h('p', { class: 'hint' }, 'Your documents live only in this browser. There is no account and no server. Download a backup now and then, and use it to move to another device.'),
        h('div', { class: 'btn-row' }, h('button', { class: 'btn primary', type: 'button', onclick: exportBackup }, 'Download backup (.json)')),
        h('label', { class: 'field' }, h('span', null, 'Restore from a backup file'), fileInput),
        importSlot),
      h('div', { class: 'card' }, h('h2', null, 'Danger zone'), h('div', { class: 'btn-row' }, wipeBtn))));
  }

  function exportBackup() {
    try {
      var json = JSON.stringify({ app: 'quotekit', version: 1, exportedAt: new Date().toISOString(), settings: state.settings, docs: state.docs }, null, 2);
      var url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
      var a = h('a', { href: url, download: 'quotekit-backup-' + today() + '.json' });
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
      toast('Backup downloaded.');
    } catch (e) { toast('Downloads are not available in this browser.'); }
  }

  route();
})();
