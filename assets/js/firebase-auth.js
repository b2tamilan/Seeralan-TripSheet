'use strict';
/* =================================================================
   Firebase Auth + Role-Based Access — PHASE 1
   ------------------------------------------------------------------
   This phase adds: login gate, role lookup (users/{uid} in Firestore),
   and role-based UI restrictions (which tabs show, amounts hidden for
   Driver, Orders filtered to own seller for Seller role).

   Data itself (days/payments/indents/etc.) still lives in localStorage
   only at this stage — cross-device sync comes in Phase 2. This phase
   is safe to ship and test on its own: it establishes who's allowed to
   see what on whichever device they're using.
   ================================================================= */

const firebaseConfig = {
  apiKey: "AIzaSyABRPNd8TcrPSRWeiA06qfWnY7RFnlfwKs",
  authDomain: "seeralan-trip-sheet.firebaseapp.com",
  projectId: "seeralan-trip-sheet",
  storageBucket: "seeralan-trip-sheet.firebasestorage.app",
  messagingSenderId: "218762752145",
  appId: "1:218762752145:web:5ef96769cea76f99628f30",
  measurementId: "G-QP4HBJYVT7"
};

let fbAuth = null, fbDb = null;
try {
  firebase.initializeApp(firebaseConfig);
  fbAuth = firebase.auth();
  fbDb = firebase.firestore();
} catch (e) { console.error('Firebase init failed', e); }

window.currentUser = null; // { uid, role, name, linkedSeller }

// null = every tab visible (Owner/Admin). Otherwise the exact list of
// data-tab values that role may see.
const ROLE_TABS = {
  owner: null,
  admin: null,
  driver: ['entry', 'trip', 'recv', 'orders'],
  seller: ['orders']
};

function showLoginScreen(msg) {
  const el = $('fbLoginScreen');
  if (el) el.style.display = 'flex';
  const err = $('fbLoginError');
  if (err) err.textContent = msg || '';
  document.body.classList.add('fb-locked');
}
function hideLoginScreen() {
  const el = $('fbLoginScreen');
  if (el) el.style.display = 'none';
  document.body.classList.remove('fb-locked');
}

function applyRoleUI(user) {
  document.body.classList.remove('role-owner', 'role-admin', 'role-driver', 'role-seller');
  document.body.classList.add('role-' + user.role);

  const allowed = ROLE_TABS[user.role];
  const navButtons = document.querySelectorAll('nav.tabs button');
  let firstAllowedBtn = null;
  navButtons.forEach(btn => {
    const tab = btn.dataset.tab;
    const ok = !allowed || allowed.includes(tab);
    btn.style.display = ok ? '' : 'none';
    if (ok && !firstAllowedBtn) firstAllowedBtn = btn;
  });

  // If the tab currently open isn't permitted for this role, jump to the
  // first tab that is (e.g. a Driver reloading on the Parties tab).
  const activeBtn = document.querySelector('nav.tabs button.active');
  if (allowed && (!activeBtn || activeBtn.style.display === 'none') && firstAllowedBtn) {
    firstAllowedBtn.click();
  }

  // Seller: lock the Pickup Indent form's seller-name field to their own
  // name so they can never file an order under someone else's name.
  if (user.role === 'seller' && $('ordSeller')) {
    $('ordSeller').value = user.linkedSeller || '';
    $('ordSeller').setAttribute('readonly', 'readonly');
  }

  const tag = $('fbUserTag');
  if (tag) tag.textContent = '👤 ' + (user.name || user.role) + ' · ' + user.role;
}

// renderOrders() (ui.js) reads pendingIndents()/doneIndents() to build the
// Orders tab. For a Seller we restrict those two functions, in place, to
// only that seller's own indents — every other tab/report is unaffected.
let indentFilterWrapped = false;
function wrapIndentFilteringForSeller() {
  if (indentFilterWrapped || typeof pendingIndents !== 'function') return;
  indentFilterWrapped = true;
  const origPending = pendingIndents, origDone = doneIndents;
  window.pendingIndents = function () {
    let list = origPending();
    if (window.currentUser && window.currentUser.role === 'seller') {
      list = list.filter(x => x.sellerName === window.currentUser.linkedSeller);
    }
    return list;
  };
  window.doneIndents = function () {
    let list = origDone();
    if (window.currentUser && window.currentUser.role === 'seller') {
      list = list.filter(x => x.sellerName === window.currentUser.linkedSeller);
    }
    return list;
  };
}

if (fbAuth) {
  fbAuth.onAuthStateChanged(async (user) => {
    if (!user) {
      window.currentUser = null;
      if (typeof stopAllSync === 'function') stopAllSync();
      showLoginScreen();
      return;
    }
    try {
      const doc = await fbDb.collection('users').doc(user.uid).get();
      if (!doc.exists) {
        showLoginScreen('இந்த account-க்கு role assign ஆகவில்லை. Admin-ஐ தொடர்பு கொள்ளவும்.');
        fbAuth.signOut();
        return;
      }
      const data = doc.data();
      window.currentUser = {
        uid: user.uid,
        role: data.role,
        name: data.name || '',
        linkedSeller: data.linkedSeller || ''
      };
      hideLoginScreen();
      wrapIndentFilteringForSeller();
      applyRoleUI(window.currentUser);
      if (typeof renderAll === 'function') renderAll();
      // One-time reconciliation: push whatever is already sitting in this
      // device's localStorage for "today" BEFORE we start listening, so an
      // empty cloud doc (first login after this update) can never overwrite
      // entries someone already made locally today.
      if (typeof pushDayToCloud === 'function' && store.days[todayISO()] && store.days[todayISO()].length) {
        await pushDayToCloud(todayISO());
      }
      if (typeof refreshDaySubscriptions === 'function') refreshDaySubscriptions();
      if (typeof subscribeIndents === 'function') subscribeIndents();
    } catch (e) {
      console.error(e);
      showLoginScreen('Login-ல் தவறு நடந்தது — மறுபடியும் முயற்சிக்கவும்.');
    }
  });
} else {
  showLoginScreen('Firebase இணைக்க முடியவில்லை — internet சரிபார்க்கவும்.');
}

if ($('fbLoginForm')) {
  $('fbLoginForm').addEventListener('submit', (e) => {
    e.preventDefault();
    if (!fbAuth) return;
    const email = $('fbEmail').value.trim();
    const pass = $('fbPassword').value;
    $('fbLoginError').textContent = '';
    fbAuth.signInWithEmailAndPassword(email, pass).catch(err => {
      $('fbLoginError').textContent = 'தவறான email/password.';
      console.error(err);
    });
  });
}
if ($('logoutBtn')) {
  $('logoutBtn').addEventListener('click', () => {
    if (!fbAuth) return;
    if (confirm('Logout செய்யலாமா?')) fbAuth.signOut();
  });
}
