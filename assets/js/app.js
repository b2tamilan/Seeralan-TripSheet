'use strict';
/* ================= State ================= */
const LS_KEY = 'lemonTripSheet_v1';
let store = { rate: 250, autoBackup: true, days: {}, masters: { sellers: {}, receivers: {} }, payments: [] };
let editIndex = -1;
let editPaymentIndex = -1;
function load() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) { const s = JSON.parse(raw); if (s && typeof s === 'object') { store = Object.assign({ rate: 250, days: {} }, s); } }
  } catch (e) { console.warn('load failed', e); }
  if (typeof store.rate !== 'number' || !(store.rate >= 0)) store.rate = 250;
  if (typeof store.autoBackup !== 'boolean') store.autoBackup = true;
  if (!store.days || typeof store.days !== 'object') store.days = {};
  if (!store.masters || typeof store.masters !== 'object') store.masters = {};
  if (!store.masters.sellers || typeof store.masters.sellers !== 'object') store.masters.sellers = {};
  if (!store.masters.receivers || typeof store.masters.receivers !== 'object') store.masters.receivers = {};
  if (!Array.isArray(store.payments)) store.payments = [];
}
function save() { localStorage.setItem(LS_KEY, JSON.stringify(store)); }

/* ================= Helpers ================= */
const $ = id => document.getElementById(id);
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function todayISO() { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
function fmtDate(iso) { if (!iso) return ''; const [y, m, d] = iso.split('-'); return d + '-' + MONTHS[+m - 1] + '-' + y; }
function inr(n) { return '₹' + Number(n || 0).toLocaleString('en-IN'); }
function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function curDate() { return $('curDate').value || todayISO(); }
function dayEntries() { return store.days[curDate()] || []; }

function entryTotal(e) { return e.receivers.reduce((s, r) => s + (+r.qty || 0), 0); }

function receiverAgg(entries) {
  const map = new Map();
  entries.forEach(e => e.receivers.forEach(r => {
    const code = (r.code || '').toUpperCase();
    const qty = +r.qty || 0;
    const appliedRate = r.rate || store.rate;
    if (!code || !qty) return;
    if (!map.has(code)) map.set(code, { bags: 0, amount: 0, sources: [] });
    const rec = map.get(code);
    rec.bags += qty;
    rec.amount += qty * appliedRate;
    const src = rec.sources.find(s => s.name === e.name);
    if (src) {
      src.qty += qty;
      src.amount = (src.amount || 0) + (qty * appliedRate);
    } else {
      rec.sources.push({ name: e.name, qty, rate: appliedRate, amount: qty * appliedRate });
    }
  }));
  return [...map.entries()].map(([code, v]) => ({ code, bags: v.bags, amount: v.amount, sources: v.sources }))
    .sort((a, b) => b.bags - a.bags || a.code.localeCompare(b.code));
}

function sourcesText(r) { return r.sources.map(s => s.name + ' (' + s.qty + (s.rate && s.rate !== store.rate ? ` @ ₹${s.rate}` : '') + ')').join(', '); }

function sumPlus(s) { return String(s).split('+').reduce((t, x) => t + (parseInt(x, 10) || 0), 0); }

/* ================= Backup Helpers ================= */
function backupStamp() {
  const d = new Date(), p = n => String(n).padStart(2, '0');
  return fmtDate(todayISO()) + '_' + p(d.getHours()) + '-' + p(d.getMinutes()) + '-' + p(d.getSeconds());
}
function downloadBlob(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 800);
}

/* ================= Parties Helpers ================= */
function allPartyNames(type) {
  const names = new Set(Object.keys(store.masters[type]));
  Object.values(store.days).forEach(list => list.forEach(e => {
    if (type === 'sellers') names.add(e.name);
    else e.receivers.forEach(r => names.add(r.code.toUpperCase()));
  }));
  if (type === 'receivers') store.payments.forEach(p => names.add(p.code));
  return [...names].sort();
}

function ledgerRows() {
  const bags = {};
  const chargesObj = {};
  Object.values(store.days).forEach(list => list.forEach(e => e.receivers.forEach(r => {
    const c = r.code.toUpperCase();
    bags[c] = (bags[c] || 0) + (+r.qty || 0);
    chargesObj[c] = (chargesObj[c] || 0) + ((+r.qty || 0) * (r.rate || store.rate));
  })));
  const paid = {};
  store.payments.forEach(p => paid[p.code] = (paid[p.code] || 0) + (+p.amount || 0));
  const codes = new Set([...Object.keys(bags), ...Object.keys(paid)]);
  return [...codes].map(code => {
    const b = bags[code] || 0, charges = chargesObj[code] || 0, received = paid[code] || 0;
    return { code, bags: b, charges, received, balance: charges - received };
  }).sort((a, b) => b.balance - a.balance || a.code.localeCompare(b.code));
}

function receiverStatementRows(code, fromD, toD) {
  const c = code.toUpperCase();
  let rows = [];

  let openingBags = 0, openingAmount = 0, openingPayment = 0;

  Object.keys(store.days).forEach(date => {
    store.days[date].forEach(e => e.receivers.forEach(r => {
      if (r.code.toUpperCase() === c) {
        const qty = +r.qty || 0;
        const appliedRate = r.rate || store.rate;
        const amt = qty * appliedRate;
        if (date < fromD) {
          openingBags += qty;
          openingAmount += amt;
        } else if (date <= toD) {
          rows.push({
            date: date,
            seller: e.name,
            bags: qty,
            rate: appliedRate,
            amount: amt,
            payment: 0
          });
        }
      }
    }));
  });

  store.payments.forEach(p => {
    if (p.code.toUpperCase() === c) {
      const amt = +p.amount || 0;
      if (p.date < fromD) {
        openingPayment += amt;
      } else if (p.date <= toD) {
        rows.push({
          date: p.date,
          seller: 'Payment ' + (p.note ? `(${p.note})` : ''),
          bags: null,
          rate: null,
          amount: 0,
          payment: amt
        });
      }
    }
  });

  const openingBalance = openingAmount - openingPayment;
  if (openingBalance !== 0 || openingBags !== 0 || openingPayment !== 0) {
    rows.push({
      date: '0000-00-00',
      isOpening: true,
      seller: 'Opening Balance',
      bags: null,
      rate: null,
      amount: 0,
      payment: 0,
      balance: openingBalance
    });
  }

  rows.sort((a, b) => a.date.localeCompare(b.date));

  let bal = openingBalance;
  rows.forEach(r => {
    if (!r.isOpening) {
      bal += r.amount - r.payment;
      r.balance = bal;
    }
  });

  return rows;
}

/* ================= Analytics ================= */
function analyticsAgg() {
  const allSellers = {};
  const allReceivers = {};
  Object.values(store.days).forEach(list => {
    list.forEach(e => {
      const seller = e.name;
      const bagsLoaded = entryTotal(e);
      allSellers[seller] = (allSellers[seller] || 0) + bagsLoaded;
      e.receivers.forEach(r => {
        const rc = r.code.toUpperCase();
        allReceivers[rc] = (allReceivers[rc] || 0) + (+r.qty || 0);
      });
    });
  });
  return { allSellers, allReceivers };
}

/* ================= Manual Actions (Clear & Backup) ================= */
function backupJSON() {
  downloadBlob(new Blob([JSON.stringify(store, null, 2)], { type: 'application/json' }), 'LemonTripSheet_backup_' + backupStamp() + '.json');
}

function autoBackup() {
  if (store.autoBackup) {
    try { downloadBlob(new Blob([JSON.stringify(store)]), 'LemonTripSheet_auto_' + backupStamp() + '.json'); } catch (e) { }
  }
}

function clearDay() {
  let cd = curDate();
  if (!store.days[cd]) return toast('No data for ' + fmtDate(cd));
  if (confirm('Permanently delete all entries for ' + fmtDate(cd) + '?')) {
    delete store.days[cd];
    save(); resetForm(); renderAll();
    toast('Day erased');
  }
}

function clearAll() {
  if (confirm('WARNING!!! This deletes ALL records for ALL days forever! Are you absolutely sure?')) {
    if (confirm('Final confirmation: Type yes to delete all. If you made a backup, say OK.')) {
      store.days = {}; store.payments = [];
      save(); resetForm(); renderAll();
      toast('Everything erased!');
    }
  }
}
