'use strict';
/* ================= State ================= */
const LS_KEY = 'lemonTripSheet_v1';
let store = { rate: 250, autoBackup: true, days: {}, masters: { sellers: {}, receivers: {} }, payments: [], itemTypes: [], signature: null, driverInfo: {}, tripSalaries: {}, expenses: [], indents: [], adjustments: [] };
let editIndex = -1;
let editPaymentIndex = -1;
let editAdjustmentIndex = -1;
function load() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) { const s = JSON.parse(raw); if (s && typeof s === 'object') { store = Object.assign({ rate: 250, days: {} }, s); } }
  } catch (e) { console.warn('load failed', e); }
  if (typeof store.rate !== 'number' || !(store.rate >= 0)) store.rate = 250;

  if (!store.itemTypes || !Array.isArray(store.itemTypes) || store.itemTypes.length === 0) {
    store.itemTypes = [
      { name: "50 Kg Bag", rate: 250, loadManRate: 20 },
      { name: "45 Kg Bag", rate: 250, default: true, loadManRate: 20 },
      { name: "40 Kg Bag", rate: 200, loadManRate: 20 },
      { name: "25 Kg Bag", rate: 100, loadManRate: 10 },
      { name: "Crate (டிப்பர்)", rate: 100, loadManRate: 10 }
    ];
  }

  if (typeof store.autoBackup !== 'boolean') store.autoBackup = true;
  if (!store.days || typeof store.days !== 'object') store.days = {};
  if (!store.masters || typeof store.masters !== 'object') store.masters = {};
  if (!store.masters.sellers || typeof store.masters.sellers !== 'object') store.masters.sellers = {};
  if (!store.masters.receivers || typeof store.masters.receivers !== 'object') store.masters.receivers = {};
  if (!Array.isArray(store.payments)) store.payments = [];
  if (!store.driverInfo || typeof store.driverInfo !== 'object') store.driverInfo = {};
  if (!store.tripSalaries || typeof store.tripSalaries !== 'object') store.tripSalaries = {};
  if (!Array.isArray(store.expenses)) store.expenses = [];
  if (!Array.isArray(store.indents)) store.indents = [];
  if (!Array.isArray(store.adjustments)) store.adjustments = [];

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

/* ================= Receiver-wise, Item-Type-wise Custom Rates ================= */
// Rate priority for a given receiver code + item type:
//   1) master.customRates[type]   — new per-item-type override
//   2) master.customRate          — legacy single "all items" override (kept for old data)
//   3) itemTypes[].rate           — item type's own default rate
//   4) store.rate                 — final fallback
function getReceiverItemRate(code, type) {
  const master = store.masters.receivers[(code || '').toUpperCase()] || {};
  if (master.customRates && typeof master.customRates[type] === 'number') return master.customRates[type];
  if (typeof master.customRate === 'number') return master.customRate;
  const itm = (store.itemTypes || []).find(it => it.name === type);
  return itm ? itm.rate : store.rate;
}
// Human-readable summary of a receiver's custom rates, for the Parties list view
function receiverRateSummaryText(m) {
  const rates = (m && m.customRates) || {};
  const keys = Object.keys(rates).filter(k => typeof rates[k] === 'number');
  if (keys.length) return keys.map(k => esc(k) + ': ₹' + rates[k]).join(', ') + '/unit';
  if (m && typeof m.customRate === 'number') return '₹' + m.customRate + '/unit (all items — legacy)';
  return '';
}

/* ================= Item-Type-wise Breakdown (50/45/40/25 Kg Bags, Crates, ...) ================= */
// Returns [{type, qty}] sorted by qty desc, across a list of load entries (each entry has .receivers[])
function bagsByType(entries) {
  const map = new Map();
  entries.forEach(e => e.receivers.forEach(r => {
    const type = r.type || (store.itemTypes.find(it => it.default) || {}).name || 'Bag';
    const qty = +r.qty || 0;
    if (!qty) return;
    map.set(type, (map.get(type) || 0) + qty);
  }));
  return [...map.entries()].map(([type, qty]) => ({ type, qty })).sort((a, b) => b.qty - a.qty);
}
function bagsByTypeHTML(entries) {
  const rows = bagsByType(entries);
  if (!rows.length) return '';
  return `<div class="chips" style="margin-bottom:10px">${rows.map(r => `<span class="chip">📦 ${esc(r.type)}: <b>${r.qty}</b></span>`).join('')}</div>`;
}

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
      if (!map[c]) map[c] = { bags: 0, charges: [], received: 0, deducted: 0 };
      map[c].bags += (+r.qty || 0);
      map[c].charges.push({ date: new Date(date), amount: (+r.qty || 0) * appliedRate });
    }));
  });
  store.payments.forEach(p => {
    const c = p.code.toUpperCase();
    if (!map[c]) map[c] = { bags: 0, charges: [], received: 0, deducted: 0 };
    map[c].received += (+p.amount || 0);
  });
  (store.adjustments || []).forEach(a => {
    const c = a.code.toUpperCase();
    if (!map[c]) map[c] = { bags: 0, charges: [], received: 0, deducted: 0 };
    map[c].deducted += (+a.amount || 0);
  });

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  return Object.keys(map).map(code => {
    const data = map[code];
    let totalCharges = data.charges.reduce((s, x) => s + x.amount, 0);
    let balance = totalCharges - data.received - data.deducted;

    // Payments AND deductions both reduce outstanding age (a damage write-off
    // settles that portion of the bill just like cash received would).
    let remainingSettled = data.received + data.deducted;
    data.charges.sort((a, b) => a.date - b.date);
    let oldestDate = null;

    if (balance > 0) {
      for (const chg of data.charges) {
        if (remainingSettled >= chg.amount) {
          remainingSettled -= chg.amount;
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

    return { code, bags: data.bags, charges: totalCharges, received: data.received, deducted: data.deducted, balance, agingDays };
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

  const ADJ_LABELS = { damage: 'Damage', shortage: 'Shortage', discount: 'Discount', other: 'Deduction' };
  (store.adjustments || []).forEach(a => {
    if (a.code.toUpperCase() === c) {
      const amt = +a.amount || 0;
      const label = (ADJ_LABELS[a.type] || 'Deduction') + (a.note ? ` (${a.note})` : '');
      if (a.date < fromD) {
        openingPayment += amt;
      } else if (a.date <= toD) {
        rows.push({
          date: a.date,
          seller: '🔻 ' + label,
          bags: null,
          rate: null,
          amount: 0,
          payment: amt,
          isDeduction: true
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

/* ================= Pickup Indents (Transport Orders) ================= */
// A "Pickup Indent" is created the moment a seller calls in with a rough order
// (seller + which receivers), before anyone knows exact bag/crate counts.
// It gets "converted" into a real load Entry once the vehicle physically reaches
// the seller's shop and items are counted — at which point its status flips to 'loaded'.
function newIndentId() {
  const d = new Date();
  const p = n => String(n).padStart(2, '0');
  const stamp = d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate());
  const seq = (store.indents || []).filter(x => x.id && x.id.startsWith('IND-' + stamp)).length + 1;
  return 'IND-' + stamp + '-' + String(seq).padStart(2, '0');
}
function indentStatusLabel(status) {
  return { pending: '🟡 Pending Pickup', loaded: '🔵 Loaded / Trip Started', closed: '⚪ Closed' }[status] || status;
}
function indentReceiverText(ind) {
  return (ind.receivers || []).map(r => r.code + (r.note ? ' (' + r.note + ')' : '')).join(', ') || '—';
}
function pendingIndents() {
  return (store.indents || []).filter(x => x.status === 'pending').sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || ''));
}
function doneIndents() {
  return (store.indents || []).filter(x => x.status !== 'pending').sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || '')).slice(0, 20);
}
function deleteIndent(id) {
  const i = (store.indents || []).findIndex(x => x.id === id);
  if (i < 0) return;
  if (!confirm('இந்த pickup indent-ஐ நீக்கலாமா?')) return;
  store.indents.splice(i, 1);
  save(); autoBackup(); renderAll();
  toast('Indent deleted');
}

/* ================= Vehicles (multi-vehicle support) ================= */
// Vehicles are free-text (no master list needed — they change daily per user's workflow).
// We just collect distinct values seen across all days for datalist/filter suggestions.
function allVehicles() {
  const set = new Set();
  Object.values(store.days).forEach(list => list.forEach(e => { if (e.vehicle) set.add(e.vehicle); }));
  return [...set].sort();
}

/* ================= Audit (multi-vehicle, multi-day consolidated) ================= */
function auditItemTypeAgg(fromD, toD) {
  const entries = [];
  Object.keys(store.days).forEach(date => {
    if (date < fromD || date > toD) return;
    store.days[date].forEach(e => entries.push(e));
  });
  return bagsByType(entries);
}
function auditVehicleAgg(fromD, toD) {
  const map = new Map();
  Object.keys(store.days).forEach(date => {
    if (date < fromD || date > toD) return;
    store.days[date].forEach(e => {
      const v = e.vehicle || 'Unassigned';
      if (!map.has(v)) map.set(v, { vehicle: v, sellers: 0, bags: 0, amount: 0 });
      const rec = map.get(v);
      rec.sellers++;
      rec.bags += entryTotal(e);
      e.receivers.forEach(r => {
        const rate = r.rate !== undefined ? r.rate : store.rate;
        rec.amount += (+r.qty || 0) * rate;
      });
    });
  });
  return [...map.values()].sort((a, b) => a.vehicle.localeCompare(b.vehicle));
}

function auditLoadingRows(fromD, toD) {
  const rows = [];
  Object.keys(store.days).sort().forEach(date => {
    if (date < fromD || date > toD) return;
    store.days[date].forEach(e => {
      rows.push({ date, vehicle: e.vehicle || 'Unassigned', name: e.name, bags: entryTotal(e), receivers: e.receivers });
    });
  });
  rows.sort((a, b) => a.vehicle.localeCompare(b.vehicle) || a.date.localeCompare(b.date));
  return rows;
}

function auditDeliveryRows(fromD, toD) {
  const map = new Map();
  Object.keys(store.days).forEach(date => {
    if (date < fromD || date > toD) return;
    store.days[date].forEach(e => {
      const vehicle = e.vehicle || 'Unassigned';
      e.receivers.forEach(r => {
        const code = (r.code || '').toUpperCase();
        const qty = +r.qty || 0;
        if (!code || !qty) return;
        const rate = r.rate !== undefined ? r.rate : store.rate;
        const key = vehicle + '||' + code;
        if (!map.has(key)) map.set(key, { vehicle, code, bags: 0, amount: 0 });
        const rec = map.get(key);
        rec.bags += qty;
        rec.amount += qty * rate;
      });
    });
  });
  return [...map.values()].sort((a, b) => a.vehicle.localeCompare(b.vehicle) || a.code.localeCompare(b.code));
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

/* ================= Salary, Expenses & Profit/Loss ================= */
const EXPENSE_TYPES = [
  { key: 'diesel', label: 'Diesel ⛽' },
  { key: 'petrol', label: 'Petrol ⛽' },
  { key: 'vehicle', label: 'Vehicle Maintenance 🔧' },
  { key: 'food', label: 'Food 🍱' },
  { key: 'other', label: 'Other 📝' }
];
function tsKey(date, vehicle) { return date + '||' + (vehicle || '__UNASSIGNED__'); }
function getTripSalary(date, vehicle) {
  return store.tripSalaries[tsKey(date, vehicle)] || { driver: 0, cleaner: 0 };
}
function setTripSalary(date, vehicle, driver, cleaner) {
  store.tripSalaries[tsKey(date, vehicle)] = { driver: +driver || 0, cleaner: +cleaner || 0 };
}
// Load Man wage for a set of load entries, using each item type's configured loadManRate
function loadManWage(entries) {
  let total = 0;
  entries.forEach(e => e.receivers.forEach(r => {
    const type = r.type || (store.itemTypes.find(it => it.default) || {}).name;
    const itm = store.itemTypes.find(it => it.name === type);
    const rate = itm ? (itm.loadManRate || 0) : 0;
    total += (+r.qty || 0) * rate;
  }));
  return total;
}
function entriesInRange(fromD, toD, vehicle) {
  const out = [];
  Object.keys(store.days).forEach(date => {
    if (date < fromD || date > toD) return;
    store.days[date].forEach(e => {
      const v = e.vehicle || '';
      if (vehicle !== undefined && vehicle !== '' && v !== vehicle) return;
      out.push(Object.assign({ __date: date }, e));
    });
  });
  return out;
}
function expensesInRange(fromD, toD, vehicle) {
  return store.expenses.filter(x => {
    if (x.date < fromD || x.date > toD) return false;
    if (vehicle !== undefined && vehicle !== '' && (x.vehicle || '') !== vehicle) return false;
    return true;
  });
}
function salariesInRange(fromD, toD, vehicle) {
  const out = [];
  Object.keys(store.tripSalaries).forEach(k => {
    const idx = k.lastIndexOf('||');
    const date = k.slice(0, idx);
    let v = k.slice(idx + 2);
    if (v === '__UNASSIGNED__') v = '';
    if (date < fromD || date > toD) return;
    if (vehicle !== undefined && vehicle !== '' && v !== vehicle) return;
    const s = store.tripSalaries[k];
    if ((s.driver || 0) + (s.cleaner || 0) > 0) out.push({ date, vehicle: v, driver: s.driver || 0, cleaner: s.cleaner || 0 });
  });
  return out.sort((a, b) => a.date.localeCompare(b.date));
}
// Full Profit & Loss for a date range (optionally filtered to one vehicle)
function profitLossReport(fromD, toD, vehicle) {
  const entries = entriesInRange(fromD, toD, vehicle);
  const agg = receiverAgg(entries);
  const collection = agg.reduce((s, r) => s + (r.amount || 0), 0);
  const bags = agg.reduce((s, r) => s + (r.bags || 0), 0);
  const loadMan = loadManWage(entries);
  const sal = salariesInRange(fromD, toD, vehicle);
  const driverTotal = sal.reduce((s, x) => s + x.driver, 0);
  const cleanerTotal = sal.reduce((s, x) => s + x.cleaner, 0);
  const exps = expensesInRange(fromD, toD, vehicle);
  const expByType = {};
  EXPENSE_TYPES.forEach(t => expByType[t.key] = 0);
  exps.forEach(x => { expByType[x.type] = (expByType[x.type] || 0) + (+x.amount || 0); });
  const expTotal = Object.values(expByType).reduce((s, v) => s + v, 0);
  const totalCost = loadMan + driverTotal + cleanerTotal + expTotal;
  const profit = collection - totalCost;
  return { collection, bags, loadMan, driverTotal, cleanerTotal, expByType, expTotal, totalCost, profit };
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
