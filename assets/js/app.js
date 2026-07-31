'use strict';
/* ================= State ================= */
const LS_KEY = 'lemonTripSheet_v1';
let store = { rate: 250, autoBackup: true, days: {}, masters: { sellers: {}, receivers: {} }, payments: [], itemTypes: [], signature: null, driverInfo: {} };
let editIndex = -1;
let editPaymentIndex = -1;
function load() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) { const s = JSON.parse(raw); if (s && typeof s === 'object') { store = Object.assign({ rate: 250, days: {} }, s); } }
  } catch (e) { console.warn('load failed', e); }
  if (typeof store.rate !== 'number' || !(store.rate >= 0)) store.rate = 250;

  if (!store.itemTypes || !Array.isArray(store.itemTypes) || store.itemTypes.length === 0) {
    store.itemTypes = [
      { name: "50 Kg Bag", rate: 250 },
      { name: "45 Kg Bag", rate: 250, default: true },
      { name: "40 Kg Bag", rate: 200 },
      { name: "25 Kg Bag", rate: 100 },
      { name: "Crate (டிப்பர்)", rate: 100 }
    ];
  }

  if (typeof store.autoBackup !== 'boolean') store.autoBackup = true;
  if (!store.days || typeof store.days !== 'object') store.days = {};
  if (!store.masters || typeof store.masters !== 'object') store.masters = {};
  if (!store.masters.sellers || typeof store.masters.sellers !== 'object') store.masters.sellers = {};
  if (!store.masters.receivers || typeof store.masters.receivers !== 'object') store.masters.receivers = {};
  if (!Array.isArray(store.payments)) store.payments = [];
  if (!store.driverInfo || typeof store.driverInfo !== 'object') store.driverInfo = {};

  if (store.signature) {
    window.signDataUrl = store.signature;
  }
}
function save() {
  try {
    if (window.signDataUrl !== undefined) {
      store.signature = window.signDataUrl;
    }
    localStorage.setItem(LS_KEY, JSON.stringify(store));
  } catch (e) {
    if (e.name === 'QuotaExceededError' || (e.message && e.message.toLowerCase().includes('quota'))) {
      alert('Storage full! Please backup and clear old days.');
    } else {
      console.error('Failed to save to localStorage:', e);
    }
  }
}

/* ================= Helpers ================= */
async function hashPin(pin) {
  const msgUint8 = new TextEncoder().encode(pin);
  const hashBuffer = await crypto.subtle.digest('SHA-256', msgUint8);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}
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
    const appliedRate = r.rate !== undefined ? r.rate : store.rate;
    const type = r.type || 'Bag';
    if (!code || !qty) return;
    const key = code;
    if (!map.has(key)) map.set(key, { code, bags: 0, amount: 0, sources: [] });
    const rec = map.get(key);
    rec.bags += qty;
    rec.amount += qty * appliedRate;
    const src = rec.sources.find(s => s.name === e.name && s.type === type);
    if (src) {
      src.qty += qty;
      src.amount = (src.amount || 0) + (qty * appliedRate);
    } else {
      rec.sources.push({ name: e.name, qty, rate: appliedRate, type: type, amount: qty * appliedRate });
    }
  }));
  return [...map.values()]
    .sort((a, b) => a.code.localeCompare(b.code) || b.bags - a.bags);
}

function sourcesText(r) {
  const def = (store.itemTypes || []).find(it => it.default);
  const defType = def ? def.name : '45 Kg Bag';
  return r.sources.map(s => s.name + ' (' + s.qty + (s.type && s.type !== defType && s.type !== 'Bag' ? ` @ ${s.type}` : '') + ')').join(', ');
}

function getRecentReceiversForSeller(name) {
  if (!name) return [];
  const lookBack = 7;
  const now = new Date();

  for (let i = 0; i < lookBack; i++) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const dateStr = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');

    if (store.days[dateStr]) {
      const entry = store.days[dateStr].find(e => e.name.toLowerCase() === name.toLowerCase());
      if (entry && entry.receivers.length > 0) {
        return entry.receivers.map(r => ({ code: r.code, type: r.type, qty: r.qty }));
      }
    }
  }
  return [];
}

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
  const map = {};
  Object.keys(store.days).forEach(date => {
    store.days[date].forEach(e => e.receivers.forEach(r => {
      const c = r.code.toUpperCase();
      const appliedRate = r.rate !== undefined ? r.rate : store.rate;
      if (!map[c]) map[c] = { bags: 0, charges: [], received: 0 };
      map[c].bags += (+r.qty || 0);
      map[c].charges.push({ date: new Date(date), amount: (+r.qty || 0) * appliedRate });
    }));
  });
  store.payments.forEach(p => {
    const c = p.code.toUpperCase();
    if (!map[c]) map[c] = { bags: 0, charges: [], received: 0 };
    map[c].received += (+p.amount || 0);
  });

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  return Object.keys(map).map(code => {
    const data = map[code];
    let totalCharges = data.charges.reduce((s, x) => s + x.amount, 0);
    let balance = totalCharges - data.received;

    let remainingPayment = data.received;
    data.charges.sort((a, b) => a.date - b.date);
    let oldestDate = null;

    if (balance > 0) {
      for (const chg of data.charges) {
        if (remainingPayment >= chg.amount) {
          remainingPayment -= chg.amount;
        } else {
          oldestDate = chg.date;
          break;
        }
      }
    }

    let agingDays = 0;
    if (oldestDate) {
      const diffTime = today - oldestDate;
      agingDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
    }

    return { code, bags: data.bags, charges: totalCharges, received: data.received, balance, agingDays };
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
        const appliedRate = r.rate !== undefined ? r.rate : store.rate;
        const type = r.type || 'Bag';
        const amt = qty * appliedRate;
        if (date < fromD) {
          openingBags += qty;
          openingAmount += amt;
        } else if (date <= toD) {
          rows.push({
            date: date,
            seller: e.name,
            bags: qty,
            type: type,
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

function dailyTrendAgg(daysToLookBack = 15) {
  const trends = [];
  const now = new Date();
  for (let i = daysToLookBack - 1; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const dateStr = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    let totalItems = 0;
    if (store.days[dateStr]) {
      totalItems = store.days[dateStr].reduce((sum, e) => sum + entryTotal(e), 0);
    }
    trends.push({ date: dateStr, items: totalItems });
  }
  return trends;
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
