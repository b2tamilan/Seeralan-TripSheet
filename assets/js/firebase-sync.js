'use strict';
/* =================================================================
   Firestore Data Sync — PHASE 2 (Entries + Orders)
   ------------------------------------------------------------------
   Scope of this phase: Load Entries (days) and Pickup Indents (Orders)
   sync in real-time across devices. This is the operational data that
   Owner/Admin/Driver all need to see live.

   Payments / Ledger Deductions / Expenses / Masters / Settings still
   stay localStorage-only for now (Phase 3) — those are lower-urgency
   (mostly single-operator/Owner usage) and need more careful design
   since they touch money directly.

   Design choice for "Driver must never see amounts": each day's data
   is split into TWO Firestore documents —
     days_ops/{date}  → seller, vehicle, receiver code/qty/type (no money)
     days_fin/{date}  → rate per receiver line, keyed by "entryIdx-recvIdx"
   Firestore Security Rules (already set up) let Driver read/write
   days_ops but NOT days_fin. Driver's browser therefore never even
   downloads a rate — so nothing to hide in the UI, it's just not there.

   To keep this reliable without a backend, we only keep LIVE listeners
   on a bounded set of dates: "today" + whichever date is currently open
   in the app. Older days sync on-demand the moment you navigate to them.
   ================================================================= */

let _daySubs = {};              // date -> { unsubOps, unsubFin }
let _applyingRemoteDay = {};    // date -> true while a remote update is being applied locally
let _indentSub = null;

function dayOpsRef(date) { return fbDb.collection('days_ops').doc(date); }
function dayFinRef(date) { return fbDb.collection('days_fin').doc(date); }

function entriesToOpsPayload(entries) {
  return (entries || []).map(e => ({
    name: e.name || '',
    vehicle: e.vehicle || '',
    receivers: (e.receivers || []).map(r => ({ code: r.code, qty: r.qty, type: r.type || '' }))
  }));
}
function entriesToFinPayload(entries) {
  const rates = {};
  (entries || []).forEach((e, ei) => (e.receivers || []).forEach((r, ri) => {
    if (typeof r.rate === 'number') rates[ei + '-' + ri] = r.rate;
  }));
  return rates;
}
function mergeOpsFinToEntries(opsList, finRates) {
  finRates = finRates || {};
  return (opsList || []).map((e, ei) => ({
    name: e.name,
    vehicle: e.vehicle || '',
    receivers: (e.receivers || []).map((r, ri) => {
      const rate = finRates[ei + '-' + ri];
      const base = { code: r.code, qty: r.qty, type: r.type };
      return rate !== undefined ? Object.assign(base, { rate }) : base;
    })
  }));
}

// Push local store.days[date] up to Firestore. Owner/Admin push ops+fin.
// Driver pushes ops only — they have no write permission on days_fin anyway
// (and can't compute a rate since they never receive item-type/receiver rates).
async function pushDayToCloud(date) {
  if (!fbDb || !window.currentUser || _applyingRemoteDay[date]) return;
  const entries = store.days[date] || [];
  try {
    await dayOpsRef(date).set({
      entries: entriesToOpsPayload(entries),
      updatedAt: Date.now(),
      updatedBy: window.currentUser.name || window.currentUser.role
    });
    if (window.currentUser.role === 'owner' || window.currentUser.role === 'admin') {
      await dayFinRef(date).set({ rates: entriesToFinPayload(entries), updatedAt: Date.now() });
    }
  } catch (e) {
    console.error('Cloud sync failed for ' + date, e);
    toast('⚠ Cloud sync ஆகல — internet சரிபார்க்கவும்');
  }
}

// Live-subscribe one date's ops (+fin, if this role is allowed) — merges
// cloud changes into local store.days and re-renders whenever they arrive.
function subscribeDay(date) {
  if (!fbDb || !window.currentUser || _daySubs[date]) return;
  const canFin = window.currentUser.role === 'owner' || window.currentUser.role === 'admin';
  let latestOps = null, latestFin = {}, finLoaded = !canFin;

  const applyMerge = () => {
    if (latestOps === null || !finLoaded) return;
    _applyingRemoteDay[date] = true;
    const merged = mergeOpsFinToEntries(latestOps, latestFin);
    if (merged.length) store.days[date] = merged; else delete store.days[date];
    save();
    if (typeof renderAll === 'function') renderAll();
    _applyingRemoteDay[date] = false;
  };

  const unsubOps = dayOpsRef(date).onSnapshot(snap => {
    latestOps = snap.exists ? (snap.data().entries || []) : [];
    applyMerge();
  }, e => console.error('days_ops listen failed for ' + date, e));

  let unsubFin = null;
  if (canFin) {
    unsubFin = dayFinRef(date).onSnapshot(snap => {
      latestFin = snap.exists ? (snap.data().rates || {}) : {};
      finLoaded = true;
      applyMerge();
    }, e => console.error('days_fin listen failed for ' + date, e));
  }
  _daySubs[date] = { unsubOps, unsubFin };
}

function unsubscribeDay(date) {
  const s = _daySubs[date];
  if (!s) return;
  s.unsubOps && s.unsubOps();
  s.unsubFin && s.unsubFin();
  delete _daySubs[date];
}
function unsubscribeAllDays() {
  Object.keys(_daySubs).forEach(unsubscribeDay);
}

// Call on login and whenever the visible date changes — keeps "today" +
// "currently open day" live, drops listeners for dates no longer in view.
function refreshDaySubscriptions() {
  if (!window.currentUser || typeof curDate !== 'function') return;
  const wanted = new Set([todayISO(), curDate()]);
  Object.keys(_daySubs).forEach(d => { if (!wanted.has(d)) unsubscribeDay(d); });
  wanted.forEach(subscribeDay);
}

/* ---------------- Pickup Indents (Orders) — one doc per indent ---------------- */
// No money in an indent (seller + receiver codes + rough note only), so this
// is a single shared collection — every allowed role reads/writes directly.
async function pushIndent(ind) {
  if (!fbDb) return;
  try { await fbDb.collection('indents').doc(ind.id).set(ind); }
  catch (e) { console.error('Indent sync failed', e); toast('⚠ Order cloud sync ஆகல'); }
}
async function deleteIndentCloud(id) {
  if (!fbDb) return;
  try { await fbDb.collection('indents').doc(id).delete(); }
  catch (e) { console.error('Indent delete sync failed', e); }
}
let _applyingRemoteIndents = false;
function subscribeIndents() {
  if (!fbDb || _indentSub) return;
  _indentSub = fbDb.collection('indents').onSnapshot(snap => {
    const list = [];
    snap.forEach(doc => list.push(doc.data()));
    _applyingRemoteIndents = true;
    store.indents = list;
    save();
    if (typeof renderAll === 'function') renderAll();
    _applyingRemoteIndents = false;
  }, e => console.error('indents listen failed', e));
}
function unsubscribeIndents() {
  if (_indentSub) { _indentSub(); _indentSub = null; }
}

function stopAllSync() {
  unsubscribeAllDays();
  unsubscribeIndents();
}
