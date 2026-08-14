'use strict';
/* ================= State ================= */
const LS_KEY = 'lemonTripSheet_v1';
let store = { rate: 250, autoBackup: true, days: {}, masters: { sellers: {}, receivers: {} }, payments: [], itemTypes: [], driverInfo: {}, tripSalaries: {}, expenses: [], indents: [], adjustments: [], trips: [], invoices: [] };
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
  if (!Array.isArray(store.trips)) store.trips = [];
  if (!Array.isArray(store.invoices)) store.invoices = [];
}
function save() {
  try {
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

/* ================= Invoices (formal, printable — no GST) =================
   An Invoice is a numbered, editable SNAPSHOT of a receiver's delivery lines
   for a date. It does NOT change ledger math — ledgerRows()/receiverStatementRows()
   keep computing directly from store.days as before, so there's one source of
   truth for money owed. The Invoice is purely the printable/record layer on
   top of that — you can tweak its lines for presentation without touching the
   underlying trip entry. Deleting an Invoice never affects the ledger. */
function newInvoiceId() {
  const nums = (store.invoices || []).map(i => parseInt((i.id || '').replace('INV-', ''), 10)).filter(n => !isNaN(n));
  const next = (nums.length ? Math.max(...nums) : 0) + 1;
  return 'INV-' + String(next).padStart(6, '0');
}
// Pull today's (or any date's) actual delivery lines for one receiver, at the
// rate that was actually applied that day — this is what pre-fills a new invoice.
function invoiceLinesFromDay(date, code) {
  const entries = store.days[date] || [];
  const lines = [];
  entries.forEach(e => (e.receivers || []).forEach(r => {
    if ((r.code || '').toUpperCase() !== code.toUpperCase()) return;
    const qty = +r.qty || 0;
    if (!qty) return;
    const rate = r.rate !== undefined ? r.rate : store.rate;
    lines.push({ seller: e.name, type: r.type || 'Bag', qty, rate, amount: qty * rate });
  }));
  return lines;
}
function invoiceTotal(inv) {
  return (inv.lines || []).reduce((s, l) => s + (+l.amount || 0), 0);
}
function findInvoice(id) { return (store.invoices || []).find(x => x.id === id); }
function createInvoice(date, code) {
  const inv = {
    id: newInvoiceId(),
    date,
    code: code.toUpperCase(),
    lines: invoiceLinesFromDay(date, code),
    note: '',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  if (!store.invoices) store.invoices = [];
  store.invoices.push(inv);
  return inv;
}
function invoicesForCode(code) {
  return (store.invoices || []).filter(x => x.code === code.toUpperCase()).sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id));
}
function allInvoicesSorted() {
  return (store.invoices || []).slice().sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id));
}
function deleteInvoiceRecord(id) {
  const i = (store.invoices || []).findIndex(x => x.id === id);
  if (i >= 0) store.invoices.splice(i, 1);
}

/* ================= Credit Notes (formal doc on top of a Deduction) =================
   Reuses the existing "adjustments" (Damage/Shortage/Discount) ledger entries as
   the single source of truth for the balance math — a Credit Note just assigns
   that deduction a formal sequential number the first time it's printed, so the
   receiver gets a proper document instead of a bare ledger line. */
function ensureCreditNoteNo(adj) {
  if (adj.cnNo) return adj.cnNo;
  const nums = (store.adjustments || []).map(a => parseInt((a.cnNo || '').replace('CN-', ''), 10)).filter(n => !isNaN(n));
  const next = (nums.length ? Math.max(...nums) : 0) + 1;
  adj.cnNo = 'CN-' + String(next).padStart(6, '0');
  return adj.cnNo;
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
  if (typeof deleteIndentCloud === 'function') deleteIndentCloud(id);
}

/* ================= Vehicles (multi-vehicle support) ================= */
// Vehicles are free-text (no master list needed — they change daily per user's workflow).
// We just collect distinct values seen across all days for datalist/filter suggestions.
function allVehicles() {
  const set = new Set();
  Object.values(store.days).forEach(list => list.forEach(e => { if (e.vehicle) set.add(e.vehicle); }));
  (store.trips || []).forEach(t => { if (t.vehicle) set.add(t.vehicle); });
  return [...set].sort();
}

/* ================= Trips (formal vehicle-trip object) ================= */
// A Trip formalizes "this vehicle, this date" — Trip ID, driver/cleaner name,
// start/end KM, and a status flow (Loading → In-Transit → Delivered → Closed).
// Closing a trip snapshots collection/costs/profit at that moment and locks
// them, so later edits to entries/expenses for that date+vehicle don't quietly
// change a trip that's already been settled and reported on.
const TRIP_STATUS_ORDER = ['loading', 'in_transit', 'delivered', 'closed'];
function newTripId(dateStr) {
  const [y, m, d] = dateStr.split('-');
  const stamp = d + MONTHS[+m - 1] + y.slice(2);
  const seq = (store.trips || []).filter(t => t.id && t.id.startsWith('TRP-' + stamp)).length + 1;
  return 'TRP-' + stamp + '-' + String(seq).padStart(2, '0');
}
function tripStatusLabel(s) {
  return { loading: '🟡 Loading', in_transit: '🔵 In-Transit', delivered: '🟢 Delivered', closed: '⚪ Closed' }[s] || s;
}
function tripStatusNext(s) {
  const i = TRIP_STATUS_ORDER.indexOf(s);
  return (i >= 0 && i < TRIP_STATUS_ORDER.length - 1) ? TRIP_STATUS_ORDER[i + 1] : null;
}
function findTrip(date, vehicle) {
  return (store.trips || []).find(t => t.date === date && t.vehicle === vehicle);
}
function getOrCreateTrip(date, vehicle) {
  let t = findTrip(date, vehicle);
  if (!t) {
    t = { id: newTripId(date), date, vehicle, driver: '', cleaner: '', startKm: '', endKm: '', status: 'loading', createdAt: new Date().toISOString(), closedAt: null, locked: null };
    if (!store.trips) store.trips = [];
    store.trips.push(t);
  }
  return t;
}
// Live figures for a date+vehicle — same math profitLossReport() uses, just
// scoped to a single day+vehicle instead of a date range.
function tripSnapshot(date, vehicle) {
  const entries = entriesInRange(date, date, vehicle);
  const agg = receiverAgg(entries);
  const collection = agg.reduce((s, r) => s + (r.amount || 0), 0);
  const bags = entries.reduce((s, e) => s + entryTotal(e), 0);
  const loadMan = loadManWage(entries);
  const ts = getTripSalary(date, vehicle);
  const exps = expensesInRange(date, date, vehicle);
  const fuel = exps.filter(x => x.type === 'diesel' || x.type === 'petrol').reduce((s, x) => s + (+x.amount || 0), 0);
  const otherExp = exps.filter(x => x.type !== 'diesel' && x.type !== 'petrol').reduce((s, x) => s + (+x.amount || 0), 0);
  const driverSalary = ts.driver || 0, cleanerSalary = ts.cleaner || 0;
  const totalCost = loadMan + driverSalary + cleanerSalary + fuel + otherExp;
  return { collection, bags, loadMan, driverSalary, cleanerSalary, fuel, otherExp, totalCost, profit: collection - totalCost };
}
function closeTrip(id) {
  const t = (store.trips || []).find(x => x.id === id); if (!t) return;
  t.locked = tripSnapshot(t.date, t.vehicle);
  t.status = 'closed';
  t.closedAt = new Date().toISOString();
}
function reopenTrip(id) {
  const t = (store.trips || []).find(x => x.id === id); if (!t) return;
  t.locked = null;
  t.status = 'delivered';
  t.closedAt = null;
}
function allTrips() {
  return (store.trips || []).slice().sort((a, b) => (b.date + b.createdAt).localeCompare(a.date + a.createdAt));
}
function deleteTrip(id) {
  const i = (store.trips || []).findIndex(x => x.id === id);
  if (i < 0) return;
  store.trips.splice(i, 1);
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
