/* ================= State Accessors ================= */
// Some utility for toast notifications, available globally

function toast(msg) {
    const t = $('toast'); t.textContent = msg; t.classList.add('show');
    clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove('show'), 2400);
}

/* ================= Tabs ================= */
document.querySelectorAll('nav.tabs button').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('nav.tabs button').forEach(b => b.classList.toggle('active', b === btn));
        document.querySelectorAll('.tab-page').forEach(p => p.classList.toggle('active', p.id === 'page-' + btn.dataset.tab));
        if (btn.dataset.tab === 'analytics') renderAnalytics();
        if (btn.dataset.tab === 'audit') renderAudit();
        if (btn.dataset.tab === 'expenses') renderExpensesTab();
        window.scrollTo({ top: 0 });
    });
});

/* ================= Vehicle Filter (multi-vehicle) ================= */
// '' = all vehicles, '__UNASSIGNED__' = entries with no vehicle set, otherwise exact vehicle text
let vehicleFilter = '';

function activeEntries() {
    const list = dayEntries();
    if (!vehicleFilter) return list;
    if (vehicleFilter === '__UNASSIGNED__') return list.filter(e => !e.vehicle);
    return list.filter(e => e.vehicle === vehicleFilter);
}
function vehicleFilterOptionsHTML() {
    let html = `<option value="">🔁 எல்லா வண்டிகளும் (All)</option>`;
    html += `<option value="__UNASSIGNED__">❔ குறிப்பிடப்படாதது (Unassigned)</option>`;
    allVehicles().forEach(v => html += `<option value="${esc(v)}">${esc(v)}</option>`);
    return html;
}
function syncVehicleFilterUI() {
    [$('vehicleFilterTrip'), $('vehicleFilterRecv')].forEach(sel => {
        if (!sel) return;
        sel.innerHTML = vehicleFilterOptionsHTML();
        sel.value = vehicleFilter;
    });
}
function setVehicleFilter(val) {
    vehicleFilter = val;
    syncVehicleFilterUI();
    renderDashboards();
}
if ($('vehicleFilterTrip')) $('vehicleFilterTrip').addEventListener('change', e => setVehicleFilter(e.target.value));
if ($('vehicleFilterRecv')) $('vehicleFilterRecv').addEventListener('change', e => setVehicleFilter(e.target.value));

/* ================= Entry form ================= */
function recvRowHTML(code = '', qty = '', type = '') {
    const opts = (store.itemTypes || []).map(it => {
        let isSel = type ? it.name === type : it.default;
        return `<option value="${esc(it.name)}" ${isSel ? 'selected' : ''}>${esc(it.name)}</option>`;
    }).join('');
    return `<div class="recv-row" style="flex-wrap:wrap">
    <input class="code" type="text" placeholder="Receiver (e.g. AR)" list="recvList" value="${esc(code)}" autocomplete="off" style="flex:1;min-width:130px">
    <select class="type" style="flex:1;min-width:100px;font-size:0.85rem">${opts}</select>
    <div style="display:flex;flex-direction:column;width:80px">
      <input class="qty" type="number" placeholder="Qty" min="0" inputmode="numeric" value="${esc(qty)}">
      <div class="qty-btn-group">
        <button type="button" class="qty-btn" tabindex="-1">+1</button>
        <button type="button" class="qty-btn" tabindex="-1">+5</button>
      </div>
    </div>
    <button class="del" type="button" title="Remove" tabindex="-1">✕</button>
  </div>`;
}
function addRecvRow(code = '', qty = '', type = '') {
    $('recvRows').insertAdjacentHTML('beforeend', recvRowHTML(code, qty, type));
}
$('addRecvBtn').addEventListener('click', () => { addRecvRow(); focusLastCode(); });
function focusLastCode() {
    const rows = $('recvRows').querySelectorAll('.recv-row .code');
    if (rows.length) rows[rows.length - 1].focus();
}
$('recvRows').addEventListener('click', e => {
    if (e.target.classList.contains('del')) {
        e.target.closest('.recv-row').remove();
        if (!$('recvRows').children.length) addRecvRow();
        updateFormTotal();
    } else if (e.target.classList.contains('qty-btn')) {
        e.preventDefault();
        if (navigator.vibrate) navigator.vibrate(50);
        const input = e.target.closest('.recv-row').querySelector('.qty');
        input.value = (parseInt(input.value) || 0) + parseInt(e.target.textContent);
        updateFormTotal();
    }
});
$('recvRows').addEventListener('keydown', e => {
    if (e.key === 'Enter' && e.target.classList.contains('qty')) {
        e.preventDefault();
        if (navigator.vibrate) navigator.vibrate(50);
        const code = e.target.closest('.recv-row').querySelector('.code').value.trim();
        if (code) { addRecvRow(); focusLastCode(); }
    }
});
$('recvRows').addEventListener('input', updateFormTotal);
function readForm() {
    const name = $('inName').value.trim();
    const vehicle = $('inVehicle') ? $('inVehicle').value.trim() : '';
    const receivers = [];
    $('recvRows').querySelectorAll('.recv-row').forEach(row => {
        const code = row.querySelector('.code').value.trim().toUpperCase();
        const type = row.querySelector('.type').value;
        const qty = +row.querySelector('.qty').value || 0;
        if (code && qty > 0) {
            const master = store.masters.receivers[code] || {};
            const itm = store.itemTypes.find(it => it.name === type);
            let rate = itm ? itm.rate : store.rate;
            if (typeof master.customRate === 'number') rate = master.customRate;
            receivers.push({ code, type, qty, rate });
        }
    });
    return { name, vehicle, receivers };
}
function updateFormTotal() {
    $('formTotal').textContent = readForm().receivers.reduce((s, r) => s + r.qty, 0);
}
function resetForm() {
    editIndex = -1;
    $('inName').value = '';
    // Note: vehicle field is intentionally NOT cleared here — one vehicle usually
    // carries loads from several sellers per trip, so keeping it saves re-typing.
    $('recvRows').innerHTML = '';
    addRecvRow();
    updateFormTotal();
    $('formTitle').textContent = '✏️ New Load Entry';
    $('saveBtn').textContent = '💾 Save Entry';
    $('cancelEditBtn').style.display = 'none';
    if ($('dupAlert')) $('dupAlert').classList.remove('show');
}
$('cancelEditBtn').addEventListener('click', resetForm);
$('saveBtn').addEventListener('click', () => {
    if (navigator.vibrate) navigator.vibrate(50);
    const e = readForm();
    if (!e.name) { toast('Enter the seller / shop name'); $('inName').focus(); return; }
    if (!e.receivers.length) { toast('Add at least one receiver with items'); return; }
    const d = curDate();
    if (!store.days[d]) store.days[d] = [];

    const bk = store.autoBackup ? ' · backup ⬇' : '';
    if (editIndex >= 0) { store.days[d][editIndex] = e; toast('Entry updated ✔' + bk); }
    else { store.days[d].push(e); toast(e.name + ' saved — ' + entryTotal(e) + ' items ✔' + bk); }
    save(); resetForm(); renderAll(); autoBackup();
});

const dupAlert = document.createElement('div');
dupAlert.className = 'dup-alert';
dupAlert.id = 'dupAlert';
dupAlert.innerHTML = `<span>Load exists today.</span><button type="button" id="dupEditBtn">Edit</button>`;
$('inName').insertAdjacentElement('afterend', dupAlert);

$('inName').addEventListener('input', e => {
    const name = e.target.value.trim().toLowerCase();
    const d = curDate();
    if (editIndex === -1 && store.days[d] && store.days[d].some(x => x.name.toLowerCase() === name)) dupAlert.classList.add('show');
    else dupAlert.classList.remove('show');
});

$('inName').addEventListener('blur', e => {
    if (editIndex >= 0) return;
    const name = e.target.value.trim();
    if (!name) return;
    const d = curDate();
    if (store.days[d] && store.days[d].some(x => x.name.toLowerCase() === name.toLowerCase())) return;

    const recent = getRecentReceiversForSeller(name);
    if (recent.length > 0) {
        const rows = $('recvRows').querySelectorAll('.recv-row');
        if (rows.length === 1 && !rows[0].querySelector('.code').value && !rows[0].querySelector('.qty').value) {
            $('recvRows').innerHTML = '';
            recent.forEach(r => addRecvRow(r.code, r.qty, r.type));
            updateFormTotal();
            toast('Auto-filled past receivers for ' + name);
        }
    }
});

dupAlert.querySelector('button').addEventListener('click', () => {
    const name = $('inName').value.trim().toLowerCase();
    const d = curDate();
    const idx = store.days[d].findIndex(x => x.name.toLowerCase() === name);
    if (idx !== -1) { editEntry(idx); window.scrollTo({ top: 0 }); }
});

function editEntry(i) {
    const e = dayEntries()[i]; if (!e) return;
    editIndex = i;
    $('inName').value = e.name;
    if ($('inVehicle')) $('inVehicle').value = e.vehicle || '';
    $('recvRows').innerHTML = '';
    e.receivers.forEach(r => addRecvRow(r.code, r.qty, r.type));
    updateFormTotal();
    $('formTitle').textContent = '✏️ Edit Entry #' + (i + 1);
    $('saveBtn').textContent = '💾 Update Entry';
    $('cancelEditBtn').style.display = 'block';
    document.querySelector('nav.tabs button[data-tab=entry]').click();
    window.scrollTo({ top: 0, behavior: 'smooth' });
}
function deleteEntry(i) {
    const e = dayEntries()[i]; if (!e) return;
    if (!confirm('Delete entry "' + e.name + '" (' + entryTotal(e) + ' bags)?')) return;
    store.days[curDate()].splice(i, 1);
    if (!store.days[curDate()].length) delete store.days[curDate()];
    if (editIndex === i) resetForm();
    save(); autoBackup(); renderAll(); toast('Entry deleted');
}

/* ================= Bulk paste import ================= */
function splitCSVLine(line) {
    const out = []; let cur = '', inQ = false;
    for (let i = 0; i < line.length; i++) {
        const c = line[i];
        if (c === '"') { inQ = !inQ; continue; }
        if (c === ',' && !inQ) { out.push(cur); cur = ''; continue; }
        cur += c;
    }
    out.push(cur);
    return out.map(s => s.trim());
}

function parseReceivers(str) {
    const out = [];
    const defType = store.itemTypes.find(it => it.default) || store.itemTypes[0] || { name: 'Bag', rate: store.rate };
    String(str).split(',').forEach(chunk => {
        const m = chunk.trim().match(/^"?\s*([A-Za-z][A-Za-z .]*?)\s*[-(]\s*([\d+\s]+)\)?\s*"?$/);
        if (m) {
            const qty = sumPlus(m[2].replace(/\s+/g, ''));
            const code = m[1].trim().toUpperCase();
            if (qty > 0) {
                const master = store.masters.receivers[code] || {};
                const rate = typeof master.customRate === 'number' ? master.customRate : defType.rate;
                out.push({ code, qty, type: defType.name, rate });
            }
        }
    });
    return out;
}
function parseBulk(text) {
    const entries = [], errors = [];
    text.split(/\r?\n/).forEach(raw => {
        let line = raw.trim();
        if (!line) return;
        if (/s\.?\s*no/i.test(line) && /name/i.test(line)) return;
        line = line.replace(/^\s*\d+\s*[.)]?\s*/, '');
        let name = '', recvStr = '';
        if (line.split(' - ').length >= 3) {
            const parts = line.split(' - ');
            name = parts[0].trim();
            recvStr = parts.slice(2).join(' - ');
        } else if (line.includes(',')) {
            const cells = splitCSVLine(raw.trim());
            if (/^\d+$/.test(cells[0])) cells.shift();
            name = (cells[0] || '').trim();
            recvStr = cells.slice(2).join(', ');
        } else { errors.push(raw); return; }
        const receivers = parseReceivers(recvStr);
        if (name && receivers.length) entries.push({ name, receivers });
        else errors.push(raw);
    });
    return { entries, errors };
}
$('importBtn').addEventListener('click', () => {
    const txt = $('pasteBox').value;
    if (!txt.trim()) { toast('Paste some lines first'); return; }
    const { entries, errors } = parseBulk(txt);
    if (!entries.length) { toast('Could not understand any line 😕'); return; }
    const d = curDate();
    if (!store.days[d]) store.days[d] = [];
    store.days[d].push(...entries);
    save(); renderAll(); autoBackup();
    $('pasteBox').value = errors.join('\n');
    toast('Imported ' + entries.length + ' entr' + (entries.length === 1 ? 'y' : 'ies') + (errors.length ? ' · ' + errors.length + ' line(s) left in box' : ' ✔'));
});

/* ================= Rendering ================= */
function getHslColor(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) hash = str.charCodeAt(i) + ((hash << 5) - hash);
    return `hsl(${Math.abs(hash) % 360}, 65%, 85%)`;
}

function renderDatalists() {
    const sellers = allPartyNames('sellers');
    const receivers = allPartyNames('receivers');
    $('nameList').innerHTML = sellers.map(n => `<option value="${esc(n)}">`).join('');
    $('recvList').innerHTML = receivers.map(n => `<option value="${esc(n)}">`).join('');
    if ($('vehicleList')) $('vehicleList').innerHTML = allVehicles().map(v => `<option value="${esc(v)}">`).join('');
    syncVehicleFilterUI();

    let payCodeHtml = '';
    receivers.forEach(r => payCodeHtml += `<option value="${esc(r)}">${esc(r)}</option>`);
    if ($('payCode')) $('payCode').innerHTML = payCodeHtml;
    if ($('stmtReceiver')) $('stmtReceiver').innerHTML = payCodeHtml;
}
function renderEntries() {
    const list = dayEntries(), box = $('entryList');
    $('entriesDate').textContent = fmtDate(curDate());
    if (!list.length) {
        box.innerHTML = '<div class="empty"><span class="big">🍋</span>No entries yet for this day.<br>Add a load above or use bulk paste.</div>';
        return;
    }
    box.innerHTML = list.map((e, i) => `
    <div class="entry-item">
      <div class="entry-sno">${i + 1}</div>
      <div class="entry-mid">
        <div class="entry-name">${esc(e.name)} ${e.vehicle ? `<span class="chip" style="background:#eef2e3;border:1px solid #d4e0cd">🚚 ${esc(e.vehicle)}</span>` : ''} — <b>${entryTotal(e)} items</b></div>
        <div class="chips">${e.receivers.map(r => `<span class="chip" style="background:${getHslColor(r.code)}; border: 1px solid rgba(0,0,0,0.06); color: #1d2510">${esc(r.code)} · ${r.qty} × ${esc(r.type || 'Bag')}</span>`).join('')}</div>
      </div>
      <div class="entry-acts">
        <button class="icon-btn" onclick="editEntry(${i})" title="Edit">✏️</button>
        <button class="icon-btn red" onclick="deleteEntry(${i})" title="Delete">🗑️</button>
      </div>
    </div>`).join('');
}
function tripTableHTML(list) {
    if (!list.length) return '<div class="empty"><span class="big">🚚</span>Nothing loaded on this day yet.</div>';
    const total = list.reduce((s, e) => s + entryTotal(e), 0);
    return `<div class="tbl-wrap"><table>
    <thead><tr><th>#</th><th>Seller / Shop</th><th class="num">Items</th><th>Receiver-wise Split</th></tr></thead>
    <tbody>${list.map((e, i) => `<tr>
      <td>${i + 1}</td><td><b>${esc(e.name)}</b></td>
      <td class="num"><b>${entryTotal(e)}</b></td>
      <td>${e.receivers.map(r => esc(r.code) + ' (' + r.qty + ' x ' + esc(r.type || 'Bag') + ')').join(', ')}</td>
    </tr>`).join('')}</tbody>
    <tfoot><tr><td></td><td>TOTAL — ${list.length} sellers</td><td class="num">${total}</td><td></td></tr></tfoot>
  </table></div>`;
}
function recvTableHTML(agg) {
    if (!agg.length) return '<div class="empty"><span class="big">📦</span>No deliveries to show yet.</div>';
    const bags = agg.reduce((s, r) => s + r.bags, 0);
    return `<div class="tbl-wrap"><table>
    <thead><tr><th>#</th><th>Receiver &amp; From Sellers</th><th class="num">Items</th><th class="num">Amount to Collect</th></tr></thead>
    <tbody>${agg.map((r, i) => `<tr>
      <td>${i + 1}</td>
      <td><b>${esc(r.code)}</b><div class="brk">from ${esc(sourcesText(r))}</div></td>
      <td class="num"><b>${r.bags}</b></td>
      <td class="num money">${inr(r.amount)}</td>
    </tr>`).join('')}</tbody>
    <tfoot><tr><td></td><td>TOTAL — ${agg.length} receivers</td><td class="num">${bags}</td><td class="num">${inr(agg.reduce((s, r) => s + (r.amount || 0), 0))}</td></tr></tfoot>
  </table></div>`;
}
function renderDashboards() {
    const list = activeEntries(), agg = receiverAgg(list);
    const bags = list.reduce((s, e) => s + entryTotal(e), 0);
    $('tripDate').textContent = fmtDate(curDate()) + (vehicleFilter ? ' · 🚚 ' + (vehicleFilter === '__UNASSIGNED__' ? 'Unassigned' : vehicleFilter) : '');
    $('recvDate').textContent = fmtDate(curDate()) + (vehicleFilter ? ' · 🚚 ' + (vehicleFilter === '__UNASSIGNED__' ? 'Unassigned' : vehicleFilter) : '');
    $('stSellers').textContent = list.length;
    $('stBags').textContent = bags;

    let totalAmt = 0;
    list.forEach(e => e.receivers.forEach(r => {
        let appliedRate = r.rate !== undefined ? r.rate : store.rate;
        totalAmt += r.qty * appliedRate;
    }));
    $('stAmount').textContent = inr(totalAmt);

    $('tripTable').innerHTML = tripTableHTML(list);
    $('recvTable').innerHTML = recvTableHTML(agg);
    if ($('tripTypeBreakdown')) $('tripTypeBreakdown').innerHTML = bagsByTypeHTML(list);
    if ($('recvTypeBreakdown')) $('recvTypeBreakdown').innerHTML = bagsByTypeHTML(list);
    renderChallanList(agg);
}
function renderChallanList(agg) {
    const box = $('challanList');
    if (!agg.length) { box.innerHTML = '<div class="empty">Challans appear here once the day has entries.</div>'; return; }
    box.innerHTML = agg.map(r => `
    <div class="chl-row">
      <div class="who">🧾 ${esc(r.code)}<small>${r.bags} items · from ${esc(sourcesText(r))}</small></div>
      <button class="btn btn-ghost btn-sm" data-ch-pdf="${esc(r.code)}">PDF</button>
      <button class="btn btn-yellow btn-sm" data-ch-img="${esc(r.code)}">Image</button>
    </div>`).join('');
}
$('challanList').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.chPdf !== undefined) exportChallanPDF(b.dataset.chPdf);
    else if (b.dataset.chImg !== undefined) exportChallanImage(b.dataset.chImg);
});
function renderDays() {
    const days = Object.keys(store.days).sort().reverse();
    const box = $('daysList');
    if (!days.length) { box.innerHTML = '<div class="empty">No saved days yet.</div>'; return; }
    box.innerHTML = days.map(d => {
        const list = store.days[d], bags = list.reduce((s, e) => s + entryTotal(e), 0);
        const unq = new Set();
        list.forEach(e => e.receivers.forEach(r => unq.add(r.code.toUpperCase())));
        return `<div class="entry-item" style="cursor:pointer" onclick="gotoDay('${d}')">
      <div class="entry-mid">
        <div class="entry-name">📅 ${fmtDate(d)}</div>
        <div class="chips">
          <span class="chip">${list.length} sellers</span>
          <span class="chip">${bags} items</span>
          <span class="chip">${unq.size} receivers</span>
        </div>
      </div>
      <div class="entry-acts"><span style="align-self:center;color:var(--muted)">›</span></div>
    </div>`;
    }).join('');
}
function gotoDay(d) {
    $('curDate').value = d;
    renderAll();
    document.querySelector('nav.tabs button[data-tab=trip]').click();
}
let _renderAllTimer = null;
function renderAll() {
    if (_renderAllTimer) clearTimeout(_renderAllTimer);
    _renderAllTimer = setTimeout(() => {
        renderEntries(); renderDashboards(); renderDatalists(); renderDays();
        renderLedger(); renderPayments(); renderMasters();
        if (typeof renderItemTypes === 'function') renderItemTypes();
        if (typeof renderAudit === 'function') renderAudit();
        if (typeof renderExpensesTab === 'function') renderExpensesTab();
    }, 10);
}

function renderItemTypes() {
    const list = $('itemTypesList');
    if (!list) return;
    list.innerHTML = store.itemTypes.map((it, i) => `
    <div style="display:flex; flex-wrap:wrap; gap:8px; align-items:center; background:var(--chip); padding:8px 12px; border-radius:10px;">
      <input type="radio" name="defaultItemType" ${it.default ? 'checked' : ''} onchange="setDefaultItemType(${i})" title="Set as default">
      <input type="text" value="${esc(it.name)}" onchange="updateItemType(${i}, 'name', this.value)" style="flex:1;min-width:110px" placeholder="Item Name (e.g. 50 Kg Bag)">
      <div style="display:flex;align-items:center;background:#fff;border-radius:10px;border:1.5px solid var(--line);overflow:hidden" title="Collection rate charged to receiver">
        <span style="padding:0 8px;color:var(--muted);font-size:.75rem;border-right:1.5px solid var(--line)">₹/collect</span>
        <input type="number" value="${it.rate}" onchange="updateItemType(${i}, 'rate', this.value)" style="width:60px;border:none;border-radius:0;text-align:right" min="0">
      </div>
      <div style="display:flex;align-items:center;background:#fff;border-radius:10px;border:1.5px solid var(--line);overflow:hidden" title="Load Man wage per unit loaded">
        <span style="padding:0 8px;color:var(--muted);font-size:.75rem;border-right:1.5px solid var(--line)">₹/loadman</span>
        <input type="number" value="${it.loadManRate || 0}" onchange="updateItemType(${i}, 'loadManRate', this.value)" style="width:60px;border:none;border-radius:0;text-align:right" min="0">
      </div>
      <button class="icon-btn red" onclick="deleteItemType(${i})" title="Delete" style="flex:0 0 34px">🗑️</button>
    </div>
    `).join('');
}

function updateItemType(i, field, val) {
    if (field === 'rate') store.itemTypes[i].rate = +val;
    if (field === 'loadManRate') store.itemTypes[i].loadManRate = +val;
    if (field === 'name') store.itemTypes[i].name = val;
    save(); autoBackup();
    toast('Item type updated');
}

function setDefaultItemType(i) {
    store.itemTypes.forEach(it => it.default = false);
    store.itemTypes[i].default = true;
    save(); autoBackup();
    toast(store.itemTypes[i].name + ' set as default');
}

function addItemType() {
    store.itemTypes.push({ name: 'New Item Type', rate: 100 });
    renderItemTypes();
    save(); autoBackup();
}

function deleteItemType(i) {
    if (store.itemTypes.length <= 1) return toast('You must have at least one item type.');
    if (confirm('Delete item type "' + store.itemTypes[i].name + '"?')) {
        const wasDefault = store.itemTypes[i].default;
        store.itemTypes.splice(i, 1);
        if (wasDefault) store.itemTypes[0].default = true;
        renderItemTypes();
        save(); autoBackup();
    }
}

let chartObj = { recv: null, sell: null };
let _rATimer = null;
function renderAnalytics() {
    if (!$('page-analytics').classList.contains('active')) return;
    if (_rATimer) clearTimeout(_rATimer);
    _rATimer = setTimeout(() => {
        const { allSellers, allReceivers } = analyticsAgg();

        const sortSellers = Object.entries(allSellers).sort((a, b) => b[1] - a[1]);
        $('topSellers').innerHTML = sortSellers.slice(0, 3).map(([n, b], i) => `<li>${i + 1}. ${esc(n)} (${b} bags)</li>`).join('') || '<li>No data</li>';

        const sortReceivers = Object.entries(allReceivers).sort((a, b) => b[1] - a[1]);
        $('topReceivers').innerHTML = sortReceivers.slice(0, 3).map(([n, b], i) => `<li>${i + 1}. ${esc(n)} (${b} bags)</li>`).join('') || '<li>No data</li>';

        const balances = ledgerRows().filter(r => r.balance > 0).sort((a, b) => b.balance - a.balance);
        $('analyticsBalances').innerHTML = balances.length
            ? `<ul style="font-size:.85rem;color:var(--danger);font-weight:700;line-height:1.6;list-style:none;margin-left:14px">${balances.map(r => `<li>${esc(r.code)}: ${inr(r.balance)}</li>`).join('')}</ul>`
            : '<div class="empty" style="padding:10px">No pending balances.</div>';

        if (chartObj.recv) chartObj.recv.destroy();
        if (chartObj.sell) chartObj.sell.destroy();

        if (typeof Chart === 'undefined') return;

        const ctxRecv = $('bagsPerReceiverChart').getContext('2d');
        chartObj.recv = new Chart(ctxRecv, {
            type: 'bar',
            data: {
                labels: sortReceivers.slice(0, 10).map(x => x[0]),
                datasets: [{ label: 'Bags Delivered', data: sortReceivers.slice(0, 10).map(x => x[1]), backgroundColor: 'rgba(62,124,43,0.7)' }]
            },
            options: { maintainAspectRatio: false, scales: { y: { beginAtZero: true, ticks: { precision: 0 } } } }
        });

        const ctxSell = $('bagsPerSellerChart').getContext('2d');
        chartObj.sell = new Chart(ctxSell, {
            type: 'pie',
            data: {
                labels: sortSellers.slice(0, 10).map(x => x[0]),
                datasets: [{
                    label: 'Bags Loaded',
                    data: sortSellers.slice(0, 10).map(x => x[1]),
                    backgroundColor: sortSellers.slice(0, 10).map(x => getHslColor(x[0]))
                }]
            },
            options: { maintainAspectRatio: false }
        });

        // Generate daily bag trend chart
        if (!$('bagTrendChart')) {
            const trCtn = `<div class="card"><h2 style="font-size:1.2rem;margin-bottom:10px;color:var(--leaf-dark)">📈 Daily Load Trend (Last 7 Days)</h2><div style="position:relative;height:240px;width:100%"><canvas id="bagTrendChart"></canvas></div></div>`;
            $('bagsPerSellerChart').closest('.card').insertAdjacentHTML('afterend', trCtn);
        }
        if (chartObj.trend) chartObj.trend.destroy();
        const trendCtx = $('bagTrendChart').getContext('2d');
        const trends = dailyTrendAgg(7);
        chartObj.trend = new Chart(trendCtx, {
            type: 'line',
            data: {
                labels: trends.map(t => t.date.slice(5)),
                datasets: [{ label: 'Items Loaded', data: trends.map(t => t.items), borderColor: '#3e7c2b', tension: 0.2, fill: true, backgroundColor: 'rgba(62,124,43,0.1)' }]
            },
            options: { maintainAspectRatio: false, scales: { y: { beginAtZero: true } } }
        });

    }, 50);
}

/* ================= Audit (multi-vehicle, multi-day consolidated) ================= */
function renderAudit() {
    if (!$('page-audit') || !$('page-audit').classList.contains('active')) return;
    if (!$('auditFromDate').value) $('auditFromDate').value = curDate();
    if (!$('auditToDate').value) $('auditToDate').value = curDate();
    const f = $('auditFromDate').value, t = $('auditToDate').value;
    if (f > t) { toast('From Date must be before To Date'); return; }

    const rows = auditVehicleAgg(f, t);
    const totalSellers = rows.reduce((s, r) => s + r.sellers, 0);
    const totalBags = rows.reduce((s, r) => s + r.bags, 0);
    const totalAmt = rows.reduce((s, r) => s + r.amount, 0);

    $('auditStats').innerHTML = `
      <div class="stat"><div class="v">${rows.length}</div><div class="l">Vehicles</div></div>
      <div class="stat"><div class="v">${totalBags}</div><div class="l">Total Bags</div></div>
      <div class="stat"><div class="v">${inr(totalAmt)}</div><div class="l">Total Amount</div></div>`;

    const typeRows = auditItemTypeAgg(f, t);
    $('auditTypeTable').innerHTML = typeRows.length ? `<div class="tbl-wrap"><table>
      <thead><tr><th>Item Type</th><th class="num">Total Qty</th></tr></thead>
      <tbody>${typeRows.map(r => `<tr><td><b>${esc(r.type)}</b></td><td class="num">${r.qty}</td></tr>`).join('')}</tbody>
      <tfoot><tr><td>TOTAL</td><td class="num">${typeRows.reduce((s, r) => s + r.qty, 0)}</td></tr></tfoot>
    </table></div>` : '<div class="empty">தரவு இல்லை.</div>';

    $('auditVehicleTable').innerHTML = rows.length ? `<div class="tbl-wrap"><table>
      <thead><tr><th>#</th><th>Vehicle</th><th class="num">Seller Loads</th><th class="num">Bags</th><th class="num">Amount</th></tr></thead>
      <tbody>${rows.map((r, i) => `<tr>
        <td>${i + 1}</td><td><b>🚚 ${esc(r.vehicle)}</b></td>
        <td class="num">${r.sellers}</td><td class="num">${r.bags}</td><td class="num money">${inr(r.amount)}</td>
      </tr>`).join('')}</tbody>
      <tfoot><tr><td></td><td>TOTAL — ${rows.length} vehicles</td><td class="num">${totalSellers}</td><td class="num">${totalBags}</td><td class="num">${inr(totalAmt)}</td></tr></tfoot>
    </table></div>` : '<div class="empty"><span class="big">🔍</span>தேர்ந்தெடுத்த காலகட்டத்தில் தரவு இல்லை.</div>';
}

function buildAuditReport(kind, fromD, toD) {
    const dateRangeStr = fmtDate(fromD) + ' to ' + fmtDate(toD);
    const hidePrice = kind === 'delivery_noprice';
    let title, headRow, rowsHtml = [], totalBags = 0, totalAmt = 0, vehicleCount = 0;

    if (kind === 'loading') {
        title = '🍋 Consolidated Loading Report — All Vehicles';
        headRow = `<tr><th>Date</th><th>Vehicle</th><th>Seller / Shop</th><th class="num">Bags</th><th>Receiver Split</th></tr>`;
        const rows = auditLoadingRows(fromD, toD);
        const vehicles = [...new Set(rows.map(r => r.vehicle))];
        vehicleCount = vehicles.length;
        vehicles.forEach(v => {
            rowsHtml.push(`<tr style="background:#eef2e3"><td colspan="5"><b>🚚 ${esc(v)}</b></td></tr>`);
            let subBags = 0;
            rows.filter(r => r.vehicle === v).forEach(r => {
                subBags += r.bags;
                rowsHtml.push(`<tr><td>${fmtDate(r.date)}</td><td></td><td><b>${esc(r.name)}</b></td><td class="num">${r.bags}</td>
                  <td>${r.receivers.map(x => esc(x.code) + ' (' + x.qty + ' x ' + esc(x.type || 'Bag') + ')').join(', ')}</td></tr>`);
            });
            rowsHtml.push(`<tr style="font-weight:700"><td colspan="3" style="text-align:right">${esc(v)} Subtotal</td><td class="num">${subBags}</td><td></td></tr>`);
            totalBags += subBags;
        });
    } else {
        title = hidePrice ? '🍋 Consolidated Delivery Report — All Vehicles' : '🍋 Consolidated Delivery &amp; Collection — All Vehicles';
        headRow = hidePrice
            ? `<tr><th>Vehicle</th><th>Receiver</th><th class="num">Bags</th></tr>`
            : `<tr><th>Vehicle</th><th>Receiver</th><th class="num">Bags</th><th class="num">Amount</th></tr>`;
        const rows = auditDeliveryRows(fromD, toD);
        const vehicles = [...new Set(rows.map(r => r.vehicle))];
        vehicleCount = vehicles.length;
        vehicles.forEach(v => {
            rowsHtml.push(`<tr style="background:#eef2e3"><td colspan="${hidePrice ? 3 : 4}"><b>🚚 ${esc(v)}</b></td></tr>`);
            let subBags = 0, subAmt = 0;
            rows.filter(r => r.vehicle === v).forEach(r => {
                subBags += r.bags; subAmt += r.amount;
                rowsHtml.push(hidePrice
                    ? `<tr><td></td><td><b>${esc(r.code)}</b></td><td class="num">${r.bags}</td></tr>`
                    : `<tr><td></td><td><b>${esc(r.code)}</b></td><td class="num">${r.bags}</td><td class="num money">${inr(r.amount)}</td></tr>`);
            });
            rowsHtml.push(hidePrice
                ? `<tr style="font-weight:700"><td colspan="2" style="text-align:right">${esc(v)} Subtotal</td><td class="num">${subBags}</td></tr>`
                : `<tr style="font-weight:700"><td colspan="2" style="text-align:right">${esc(v)} Subtotal</td><td class="num">${subBags}</td><td class="num">${inr(subAmt)}</td></tr>`);
            totalBags += subBags; totalAmt += subAmt;
        });
    }

    if (!rowsHtml.length) {
        $('report').innerHTML = `<div class="report-page">
          <div class="repband"><div><h1>${title}</h1><div class="sub">Audit — Multi-Vehicle Consolidated</div></div><div class="datebox"><small>PERIOD</small>${dateRangeStr}</div></div>
          <div class="empty" style="padding:40px 0">தேர்ந்தெடுத்த காலகட்டத்தில் தரவு இல்லை.</div>
          ${repFoot()}
        </div>`;
        return $('report');
    }

    let pagesHtml = '';
    const maxFirst = 16, maxNext = 24;
    let idx = 0, pageNum = 1;
    while (idx < rowsHtml.length) {
        const isFirst = pageNum === 1;
        const limit = isFirst ? maxFirst : maxNext;
        const chunk = rowsHtml.slice(idx, idx + limit);
        idx += limit;
        const isLast = idx >= rowsHtml.length;

        let footRow = '';
        if (isLast) {
            if (kind === 'loading') footRow = `<tfoot><tr><td colspan="3">GRAND TOTAL — ${vehicleCount} vehicles</td><td class="num">${totalBags}</td><td></td></tr></tfoot>`;
            else if (hidePrice) footRow = `<tfoot><tr><td colspan="2">GRAND TOTAL — ${vehicleCount} vehicles</td><td class="num">${totalBags}</td></tr></tfoot>`;
            else footRow = `<tfoot><tr><td colspan="2">GRAND TOTAL — ${vehicleCount} vehicles</td><td class="num">${totalBags}</td><td class="num">${inr(totalAmt)}</td></tr></tfoot>`;
        }

        pagesHtml += `
      <div class="report-page">
        ${isFirst ? `
          <div class="repband">
            <div><h1>${title}</h1><div class="sub">Audit — Multi-Vehicle Consolidated</div></div>
            <div class="datebox"><small>PERIOD</small>${dateRangeStr}</div>
          </div>
          <div class="repstats">
            <div class="repstat"><div class="v">${vehicleCount}</div><div class="l">Vehicles</div></div>
            <div class="repstat"><div class="v">${totalBags}</div><div class="l">Total Bags</div></div>
            ${kind !== 'loading' && !hidePrice ? `<div class="repstat gold"><div class="v">${inr(totalAmt)}</div><div class="l">Total Amount</div></div>` : ''}
          </div>
          <div class="chips" style="margin-bottom:14px">${auditItemTypeAgg(fromD, toD).map(r => `<span class="chip">📦 ${esc(r.type)}: <b>${r.qty}</b></span>`).join('')}</div>
        ` : `
          <div style="font-size:0.9rem; font-weight:bold; margin-bottom:10px; color:var(--leaf-dark); display:flex; justify-content:space-between;">
            <span>${title} (Page ${pageNum})</span><span>${dateRangeStr}</span>
          </div>
        `}
        <div class="tbl-wrap"><table>
          <thead>${headRow}</thead>
          <tbody>${chunk.join('')}</tbody>
          ${footRow}
        </table></div>
        ${isLast ? repFoot() : ''}
      </div>`;
        pageNum++;
    }
    $('report').innerHTML = pagesHtml;
    return $('report');
}

/* ================= Expenses / Salary / Profit & Loss ================= */
function vehicleSelectOptionsHTML(includeAll) {
    let html = includeAll ? `<option value="">🔁 எல்லா வண்டிகளும் (All)</option>` : '';
    html += `<option value="">❔ குறிப்பிடப்படாதது (Unassigned)</option>`;
    allVehicles().forEach(v => html += `<option value="${esc(v)}">${esc(v)}</option>`);
    return html;
}
function renderExpensesTab() {
    if (!$('page-expenses') || !$('page-expenses').classList.contains('active')) return;
    const d = curDate();
    $('salDateLabel').textContent = fmtDate(d);
    $('expDateLabel').textContent = fmtDate(d);
    $('expListDate').textContent = fmtDate(d);

    // Vehicle selects (Unassigned + known vehicles). Keep current selection if still valid.
    [['salVehicle', false], ['expVehicle', false], ['plVehicle', true]].forEach(([id, includeAll]) => {
        const sel = $(id); if (!sel) return;
        const prev = sel.value;
        sel.innerHTML = vehicleSelectOptionsHTML(includeAll);
        if ([...sel.options].some(o => o.value === prev)) sel.value = prev;
    });

    // Trip salary form reflects existing saved value for date+vehicle
    const sv = $('salVehicle').value;
    const ts = getTripSalary(d, sv);
    $('salDriver').value = ts.driver || '';
    $('salCleaner').value = ts.cleaner || '';

    // Load man wages for today (all vehicles, or filtered by trip tab's vehicleFilter if set)
    const todayEntries = dayEntries();
    const lm = loadManWage(todayEntries);
    const byType = bagsByType(todayEntries);
    $('loadManToday').innerHTML = byType.length ? `<div class="tbl-wrap"><table>
      <thead><tr><th>Item Type</th><th class="num">Qty</th><th class="num">₹/unit</th><th class="num">Amount</th></tr></thead>
      <tbody>${byType.map(r => {
        const itm = store.itemTypes.find(it => it.name === r.type);
        const rate = itm ? (itm.loadManRate || 0) : 0;
        return `<tr><td>${esc(r.type)}</td><td class="num">${r.qty}</td><td class="num">${rate}</td><td class="num money">${inr(r.qty * rate)}</td></tr>`;
    }).join('')}</tbody>
      <tfoot><tr><td colspan="3">TOTAL Load Man Wage — ${fmtDate(d)}</td><td class="num">${inr(lm)}</td></tr></tfoot>
    </table></div>` : '<div class="empty">இன்று entries இல்லை.</div>';

    renderExpenseList();

    if (!$('plFromDate').value) $('plFromDate').value = d;
    if (!$('plToDate').value) $('plToDate').value = d;
    renderProfitLoss();
}
function saveTripSalary() {
    const d = curDate(), v = $('salVehicle').value;
    setTripSalary(d, v, $('salDriver').value, $('salCleaner').value);
    save(); autoBackup();
    toast('Trip salary saved for ' + fmtDate(d) + (v ? ' · 🚚 ' + v : ' · Unassigned') + ' ✔');
    renderExpensesTab();
}
function saveExpense() {
    const amt = +$('expAmt').value;
    if (!(amt > 0)) { toast('Enter a valid amount'); $('expAmt').focus(); return; }
    store.expenses.push({
        date: curDate(),
        vehicle: $('expVehicle').value,
        type: $('expType').value,
        amount: amt,
        note: $('expNote').value.trim()
    });
    save(); autoBackup();
    $('expAmt').value = ''; $('expNote').value = '';
    toast('Expense saved ✔');
    renderExpensesTab();
}
function deleteExpense(i) {
    const x = store.expenses[i]; if (!x) return;
    if (!confirm('Delete this ' + inr(x.amount) + ' expense?')) return;
    store.expenses.splice(i, 1);
    save(); autoBackup();
    renderExpensesTab();
}
function renderExpenseList() {
    const d = curDate();
    const rows = store.expenses.map((x, i) => ({ ...x, i })).filter(x => x.date === d);
    const box = $('expList');
    if (!rows.length) { box.innerHTML = '<div class="empty">இன்றைக்கு expenses இல்லை.</div>'; return; }
    const typeLabel = k => (EXPENSE_TYPES.find(t => t.key === k) || {}).label || k;
    box.innerHTML = rows.map(x => `
    <div class="chl-row">
      <div class="who">${typeLabel(x.type)} — <span class="money">${inr(x.amount)}</span>
        <small>${x.vehicle ? '🚚 ' + esc(x.vehicle) : 'Unassigned'}${x.note ? ' · ' + esc(x.note) : ''}</small></div>
      <button class="icon-btn red" onclick="deleteExpense(${x.i})" title="Delete">🗑️</button>
    </div>`).join('');
}
function renderProfitLoss() {
    const f = $('plFromDate').value, t = $('plToDate').value, v = $('plVehicle').value;
    if (!f || !t) return;
    if (f > t) { $('plReport').innerHTML = '<div class="empty">From Date must be before To Date</div>'; return; }
    const r = profitLossReport(f, t, v);
    const typeLabel = k => (EXPENSE_TYPES.find(x => x.key === k) || {}).label || k;
    $('plReport').innerHTML = `
    <div class="stats" style="grid-template-columns:repeat(2,1fr)">
      <div class="stat"><div class="v">${inr(r.collection)}</div><div class="l">Total Collection</div></div>
      <div class="stat"><div class="v">${inr(r.totalCost)}</div><div class="l">Total Cost</div></div>
    </div>
    <div class="tbl-wrap"><table>
      <thead><tr><th>Head</th><th class="num">Amount (₹)</th></tr></thead>
      <tbody>
        <tr><td>💰 Total Collection (Receiver-wise)</td><td class="num money">${inr(r.collection)}</td></tr>
        <tr><td>👷 Load Man Wages</td><td class="num" style="color:var(--danger)">− ${inr(r.loadMan)}</td></tr>
        <tr><td>🧑‍✈️ Driver Salary</td><td class="num" style="color:var(--danger)">− ${inr(r.driverTotal)}</td></tr>
        <tr><td>🧹 Cleaner Salary</td><td class="num" style="color:var(--danger)">− ${inr(r.cleanerTotal)}</td></tr>
        ${EXPENSE_TYPES.map(x => `<tr><td>${typeLabel(x.key)}</td><td class="num" style="color:var(--danger)">− ${inr(r.expByType[x.key] || 0)}</td></tr>`).join('')}
      </tbody>
      <tfoot><tr><td>${r.profit >= 0 ? '✅ Net Profit' : '⚠️ Net Loss'}</td><td class="num" style="color:${r.profit >= 0 ? 'var(--leaf-dark)' : 'var(--danger)'};font-size:1.05rem">${inr(Math.abs(r.profit))}</td></tr></tfoot>
    </table></div>`;
}
['salVehicle'].forEach(id => { if ($(id)) $(id).addEventListener('change', () => { const d = curDate(); const ts = getTripSalary(d, $(id).value); $('salDriver').value = ts.driver || ''; $('salCleaner').value = ts.cleaner || ''; }); });
if ($('plFromDate')) $('plFromDate').addEventListener('change', renderProfitLoss);
if ($('plToDate')) $('plToDate').addEventListener('change', renderProfitLoss);
if ($('plVehicle')) $('plVehicle').addEventListener('change', renderProfitLoss);

/* ================= Report DOMs (for PDF / image) ================= */
function repFoot() { return `<div class="rep-foot">Generated on ${fmtDate(todayISO())} · Lemon Trip Sheet app</div>`; }

function buildLoadingReport() {
    const list = activeEntries();
    const totalBags = list.reduce((s, e) => s + entryTotal(e), 0);
    const vehLabel = vehicleFilter ? (vehicleFilter === '__UNASSIGNED__' ? 'Unassigned' : vehicleFilter) : '';

    let pagesHtml = '';
    const maxFirst = 14;
    const maxNext = 20;
    let currentIdx = 0;
    let pageNum = 1;

    while (currentIdx < list.length || currentIdx === 0) {
        let isFirst = (pageNum === 1);
        let limit = isFirst ? maxFirst : maxNext;
        let chunk = list.slice(currentIdx, currentIdx + limit);
        currentIdx += limit;

        let bodyRows = chunk.map((e, idx) => `<tr>
      <td>${currentIdx - limit + idx + 1}</td><td><b>${esc(e.name)}</b></td>
      <td class="num"><b>${entryTotal(e)}</b></td>
      <td>${e.receivers.map(r => esc(r.code) + ' (' + r.qty + ' x ' + esc(r.type || 'Bag') + ')').join(', ')}</td>
    </tr>`).join('');

        let isLast = currentIdx >= list.length;
        let footRow = isLast ? `<tfoot><tr><td></td><td>TOTAL — ${list.length} sellers</td><td class="num">${totalBags}</td><td></td></tr></tfoot>` : '';

        pagesHtml += `
      <div class="report-page">
        ${isFirst ? `
          <div class="repband">
            <div><h1>🍋 Loading Report</h1><div class="sub">Seller-wise loading summary${vehLabel ? ' · 🚚 ' + esc(vehLabel) : ''}</div></div>
            <div class="datebox"><small>TRIP DATE</small>${fmtDate(curDate())}</div>
          </div>
          <div class="repstats">
            <div class="repstat"><div class="v">${list.length}</div><div class="l">Sellers</div></div>
            <div class="repstat"><div class="v">${totalBags}</div><div class="l">Items Loaded</div></div>
          </div>
        ` : `
          <div style="font-size:0.9rem; font-weight:bold; margin-bottom:10px; color:var(--leaf-dark); display:flex; justify-content:space-between;">
            <span>🍋 Loading Report (Page ${pageNum})</span>
            <span>${fmtDate(curDate())}</span>
          </div>
        `}
        <div class="tbl-wrap"><table>
          <thead><tr><th>#</th><th>Seller / Shop</th><th class="num">Bags</th><th>Receiver-wise Split</th></tr></thead>
          <tbody>${bodyRows}</tbody>
           ${footRow}
        </table></div>
        ${isLast ? repFoot() : ''}
      </div>
    `;
        pageNum++;
    }
    $('report').innerHTML = pagesHtml;
    return $('report');
}

function buildDeliveryReport(hidePrice = false) {
    const list = activeEntries(), agg = receiverAgg(list);
    const totalBags = agg.reduce((s, r) => s + r.bags, 0);
    const vehLabel = vehicleFilter ? (vehicleFilter === '__UNASSIGNED__' ? 'Unassigned' : vehicleFilter) : '';
    const vehSuffix = vehLabel ? ' · 🚚 ' + esc(vehLabel) : '';

    let headerBandClass = hidePrice ? "" : "gold";
    let headerTitle = hidePrice
        ? `<h1>🍋 Delivery Report</h1><div class="sub">Receiver-wise delivery summary (Goods Only)${vehSuffix}</div>`
        : `<h1>🍋 Delivery &amp; Collection Report</h1><div class="sub">Receiver-wise delivery · cash to collect @ ₹${store.rate} per bag${vehSuffix}</div>`;

    let repStatsHtml = hidePrice
        ? `<div class="repstat"><div class="v">${agg.length}</div><div class="l">Receivers</div></div>
       <div class="repstat"><div class="v">${totalBags}</div><div class="l">Items Delivered</div></div>`
        : `<div class="repstat"><div class="v">${agg.length}</div><div class="l">Receivers</div></div>
       <div class="repstat"><div class="v">${totalBags}</div><div class="l">Items Delivered</div></div>
       <div class="repstat gold"><div class="v">${inr(agg.reduce((s, r) => s + (r.amount || 0), 0))}</div><div class="l">Total to Collect</div></div>`;

    let headRow = hidePrice
        ? `<tr><th>#</th><th>Receiver — From Which Seller</th><th class="num">Bags</th></tr>`
        : `<tr><th>#</th><th>Receiver — From Which Seller</th><th class="num">Bags</th><th class="num">Amount to Collect</th><th style="text-align:center">Paid ✓</th></tr>`;

    let pagesHtml = '';
    const maxFirst = 13;
    const maxNext = 18;
    let currentIdx = 0;
    let pageNum = 1;

    while (currentIdx < agg.length || currentIdx === 0) {
        let isFirst = (pageNum === 1);
        let limit = isFirst ? maxFirst : maxNext;
        let chunk = agg.slice(currentIdx, currentIdx + limit);
        currentIdx += limit;

        let bodyRows = chunk.map((r, i) => {
            let idx = currentIdx - limit + i + 1;
            if (hidePrice) {
                return `<tr>
          <td>${idx}</td>
          <td><span class="rcode">${esc(r.code)}</span><div class="brk">from ${esc(sourcesText(r))}</div></td>
          <td class="num"><b>${r.bags}</b></td>
        </tr>`;
            } else {
                return `<tr>
          <td>${idx}</td>
          <td><span class="rcode">${esc(r.code)}</span><div class="brk">from ${esc(sourcesText(r))}</div></td>
          <td class="num"><b>${r.bags}</b></td>
          <td class="num money">${inr(r.amount)}</td>
          <td style="text-align:center"><span class="collbox"></span></td>
        </tr>`;
            }
        }).join('');

        let isLast = currentIdx >= agg.length;
        let footRow = '';
        if (isLast) {
            footRow = hidePrice
                ? `<tfoot><tr><td></td><td>TOTAL — ${agg.length} receivers</td><td class="num">${totalBags}</td></tr></tfoot>`
                : `<tfoot><tr><td></td><td>TOTAL — ${agg.length} receivers</td><td class="num">${totalBags}</td><td class="num">${inr(agg.reduce((s, x) => s + (x.amount || 0), 0))}</td><td></td></tr></tfoot>`;
        }

        pagesHtml += `
      <div class="report-page">
        ${isFirst ? `
          <div class="repband ${headerBandClass}">
            <div>${headerTitle}</div>
            <div class="datebox"><small>TRIP DATE</small>${fmtDate(curDate())}</div>
          </div>
          <div class="repstats">${repStatsHtml}</div>
        ` : `
          <div style="font-size:0.9rem; font-weight:bold; margin-bottom:10px; color:var(--leaf-dark); display:flex; justify-content:space-between;">
            <span>🍋 ${hidePrice ? 'Delivery Report' : 'Delivery & Collection Report'} (Page ${pageNum})</span>
            <span>${fmtDate(curDate())}</span>
          </div>
        `}
        <div class="tbl-wrap"><table>
          <thead>${headRow}</thead>
          <tbody>${bodyRows}</tbody>
          ${footRow}
        </table></div>
        ${isLast ? repFoot() : ''}
      </div>
    `;
        pageNum++;
    }
    $('report').innerHTML = pagesHtml;
    return $('report');
}

function buildReport(kind) {
    if (kind === 'loading') return buildLoadingReport();
    if (kind === 'delivery') return buildDeliveryReport(false);
    if (kind === 'delivery_noprice') return buildDeliveryReport(true);
}

function buildConsolidatedReport(fromStr, toStr) {
    const list = consolidatedLedgerRows(fromStr, toStr);
    const dateRangeStr = fmtDate(fromStr) + ' to ' + fmtDate(toStr);

    let pagesHtml = '';
    const maxFirst = 14;
    const maxNext = 20;

    let tc = 0, tp = 0, tb = 0;
    list.forEach(r => { tc += r.charges; tp += r.received; tb += r.balance; });

    let currentIdx = 0;
    let pageNum = 1;

    while (currentIdx < list.length || currentIdx === 0) {
        let isFirst = (pageNum === 1);
        let limit = isFirst ? maxFirst : maxNext;
        let chunk = list.slice(currentIdx, currentIdx + limit);
        currentIdx += limit;

        let bodyRows = chunk.map((r, i) => `<tr>
          <td>${currentIdx - limit + i + 1}</td>
          <td><b>${esc(r.code)}</b> <div class="brk">${r.bags} total bags</div></td>
          <td class="num">${inr(r.charges)}</td>
          <td class="num">${inr(r.received)}</td>
          <td class="num" style="font-weight:800;color:${r.balance > 0 ? 'var(--danger)' : r.balance < 0 ? 'var(--leaf)' : 'inherit'}">${inr(r.balance)}</td>
        </tr>`).join('');

        let isLast = currentIdx >= list.length;
        let footRow = isLast ? `<tfoot><tr><td></td><td style="text-align:right">TOTAL — ${list.length} parties</td><td class="num">${inr(tc)}</td><td class="num">${inr(tp)}</td><td class="num">${inr(tb)}</td></tr></tfoot>` : '';

        pagesHtml += `
      <div class="report-page">
        ${isFirst ? `
          <div class="repband">
            <div><h1>🍋 Consolidated Ledger</h1><div class="sub">Multi-Day Outstanding Balances</div></div>
            <div class="datebox"><small>PERIOD</small>${dateRangeStr}</div>
          </div>
          <div class="repstats">
            <div class="repstat"><div class="v">${list.length}</div><div class="l">Receivers</div></div>
            <div class="repstat"><div class="v">${inr(tc)}</div><div class="l">Total Charges</div></div>
            <div class="repstat"><div class="v">${inr(tb)}</div><div class="l">Total Outstanding</div></div>
          </div>
        ` : `
          <div style="font-size:0.9rem; font-weight:bold; margin-bottom:10px; color:var(--leaf-dark); display:flex; justify-content:space-between;">
            <span>🍋 Consolidated Ledger (Page ${pageNum})</span>
            <span>${dateRangeStr}</span>
          </div>
        `}
        <div class="tbl-wrap"><table>
          <thead><tr><th>#</th><th>Receiver</th><th class="num">Charges</th><th class="num">Paid</th><th class="num">Balance (₹)</th></tr></thead>
          <tbody>${bodyRows}</tbody>
           ${footRow}
        </table></div>
        ${isLast ? repFoot() : ''}
      </div>
    `;
        pageNum++;
    }
    $('report').innerHTML = pagesHtml;
    return $('report');
}

function buildStatementReport(code, fromStr, toStr) {
    const list = receiverStatementRows(code, fromStr, toStr);
    const dateRangeStr = fmtDate(fromStr) + ' to ' + fmtDate(toStr);

    let pagesHtml = '';
    const maxFirst = 15;
    const maxNext = 22;

    let tb = 0, ta = 0, tp = 0;
    list.forEach(r => { tb += r.bags; ta += r.amount; tp += r.payment; });
    const finalBal = list.length ? list[list.length - 1].balance : 0;

    let currentIdx = 0;
    let pageNum = 1;

    while (currentIdx < list.length || currentIdx === 0) {
        let isFirst = (pageNum === 1);
        let limit = isFirst ? maxFirst : maxNext;
        let chunk = list.slice(currentIdx, currentIdx + limit);
        currentIdx += limit;

        let bodyRows = chunk.map(r => `<tr>
          <td>${r.isOpening ? '—' : fmtDate(r.date)}</td>
          <td><b>${esc(r.seller)}</b></td>
          <td class="num">${r.bags || '-'}</td>
          <td class="num">${r.rate || '-'}</td>
          <td class="num">${(r.amount || !r.isOpening) ? (r.amount ? inr(r.amount) : '-') : '-'}</td>
          <td class="num" style="color:var(--leaf-dark)">${(r.payment || !r.isOpening) ? (r.payment ? inr(r.payment) : '-') : '-'}</td>
          <td class="num" style="font-weight:800;color:${r.balance > 0 ? 'var(--danger)' : r.balance < 0 ? 'var(--leaf)' : 'inherit'}">${inr(r.balance)}</td>
        </tr>`).join('');

        let isLast = currentIdx >= list.length;
        let footRow = isLast ? `<tfoot><tr><td colspan="2" style="text-align:right">TOTAL:</td><td class="num">${tb}</td><td></td><td class="num">${inr(ta)}</td><td class="num">${inr(tp)}</td><td class="num">${inr(finalBal)}</td></tr></tfoot>` : '';

        pagesHtml += `
      <div class="report-page">
        ${isFirst ? `
          <div class="repband gold">
            <div><h1>🧾 Ledger Statement</h1><div class="sub">Receiver: <b style="font-size:1.1rem">${esc(code.toUpperCase())}</b></div></div>
            <div class="datebox"><small>PERIOD</small>${dateRangeStr}</div>
          </div>
          <div class="repstats">
            <div class="repstat"><div class="v">${tb}</div><div class="l">Total Bags</div></div>
            <div class="repstat"><div class="v">${inr(ta)}</div><div class="l">Total Billed</div></div>
            <div class="repstat"><div class="v">${inr(tp)}</div><div class="l">Total Paid</div></div>
          </div>
        ` : `
          <div style="font-size:0.9rem; font-weight:bold; margin-bottom:10px; color:var(--leaf-dark); display:flex; justify-content:space-between;">
            <span>🧾 Statement for ${esc(code.toUpperCase())} (Page ${pageNum})</span>
            <span>${dateRangeStr}</span>
          </div>
        `}
        <div class="tbl-wrap"><table>
          <thead><tr><th>Date</th><th>Seller / Details</th><th class="num">Bags</th><th class="num">Rate</th><th class="num">Amount (₹)</th><th class="num">Payment (₹)</th><th class="num">Balance (₹)</th></tr></thead>
          <tbody>${bodyRows}</tbody>
           ${footRow}
        </table></div>
        ${isLast ? repFoot() : ''}
      </div>
    `;
        pageNum++;
    }
    $('report').innerHTML = pagesHtml;
    return $('report');
}

function buildChallan(r, idx) {
    const vShort = (vehicleFilter && vehicleFilter !== '__UNASSIGNED__') ? '-' + vehicleFilter.replace(/[^A-Za-z0-9]/g, '').slice(-4).toUpperCase() : '';
    const no = 'DC-' + curDate().replace(/-/g, '') + vShort + '-' + String(idx + 1).padStart(2, '0');
    $('report').innerHTML = `
    <div class="report-page ch-wrap">
      <div class="ch-top">
        <div><h1>🍋 Delivery Challan</h1><div class="sub">Goods delivery confirmation</div></div>
        <div class="ch-meta">Challan No: <b>${no}</b><br>Date: <b>${fmtDate(curDate())}</b>${(vehicleFilter && vehicleFilter !== '__UNASSIGNED__') ? '<br>Vehicle: <b>' + esc(vehicleFilter) + '</b>' : ''}</div>
      </div>
      <div class="ch-to">
        <div><div class="lbl">Delivered To</div><div class="who">${esc(r.code)}</div></div>
        <div class="bags"><div class="n">${r.bags}</div><div class="t">x ${esc(r.type || 'Bag')}</div></div>
      </div>
      <div class="ch-line">You have received these bags from:</div>
      <div class="tbl-wrap"><table>
        <thead><tr><th>#</th><th>From Seller / Shop</th><th class="num">Bags</th></tr></thead>
        <tbody>${r.sources.map((s, i) => `<tr><td>${i + 1}</td><td><b>${esc(s.name)}</b></td><td class="num"><b>${s.qty}</b></td></tr>`).join('')}</tbody>
        <tfoot><tr><td></td><td>TOTAL BAGS RECEIVED</td><td class="num">${r.bags}</td></tr></tfoot>
      </table></div>
      <div class="ch-sign">
        <div>Delivered by (sign)
          ${window.signDataUrl ? `<br><img src="${window.signDataUrl}" style="height:60px;margin-top:10px">` : ''}
        </div>
        <div>Received by (sign)</div>
      </div>
      <div class="ch-note">This challan confirms physical delivery of goods only. It is not an invoice and contains no payment details.</div>
    </div>`;
    return $('report');
}

/* ================= Parties UI, payments, masters ================= */
function waLink(phone, text) {
    let d = String(phone || '').replace(/\D/g, '');
    if (!d) return null;
    if (d.length === 10) d = '91' + d;
    return 'https://wa.me/' + d + (text ? '?text=' + encodeURIComponent(text) : '');
}
function remindReceiver(code) {
    const row = ledgerRows().find(r => r.code === code); if (!row) return;
    const m = store.masters.receivers[code] || {};
    const text = '🍋 *Balance reminder — ' + code + '*\n'
        + 'Bags delivered: ' + row.bags + ' × ₹' + store.rate + ' = ₹' + row.charges.toLocaleString('en-IN') + '\n'
        + 'Paid so far: ₹' + row.received.toLocaleString('en-IN') + '\n'
        + '*Balance pending: ₹' + row.balance.toLocaleString('en-IN') + '*\n'
        + '(as on ' + fmtDate(todayISO()) + ') — please arrange payment. Thank you! 🙏';
    const url = waLink(m.phone, text) || 'https://wa.me/?text=' + encodeURIComponent(text);
    window.open(url, '_blank');
}
function renderLedger() {
    const rows = ledgerRows();
    if (!rows.length) { $('ledgerTable').innerHTML = '<div class="empty"><span class="big">💰</span>No deliveries or payments yet.</div>'; return; }
    const tb = rows.reduce((s, r) => ({ bags: s.bags + r.bags, charges: s.charges + r.charges, received: s.received + r.received, balance: s.balance + r.balance }), { bags: 0, charges: 0, received: 0, balance: 0 });

    $('ledgerTable').innerHTML = `<div class="tbl-wrap"><table>
      <thead><tr><th>#</th><th>Receiver</th><th class="num">Items</th><th class="num">Charges</th><th class="num">Received</th><th class="num">Balance</th><th>Aging</th></tr></thead>
      <tbody>${rows.map((r, i) => {
        let agingBadge = '';
        if (r.balance > 0) {
            if (r.agingDays > 30) agingBadge = `<span class="badge-aging aging-danger">${r.agingDays}d</span>`;
            else if (r.agingDays > 15) agingBadge = `<span class="badge-aging aging-warn">${r.agingDays}d</span>`;
            else agingBadge = `<span class="badge-aging aging-good">${r.agingDays}d</span>`;
        }
        return `<tr>
        <td>${i + 1}</td>
        <td><a href="#" onclick="showStatement('${esc(r.code)}');return false"><b>${esc(r.code)}</b></a></td>
        <td class="num">${r.bags}</td>
        <td class="num money">${inr(r.charges)}</td>
        <td class="num money" style="color:var(--leaf-dark)">${inr(r.received)}</td>
        <td class="num money" style="color:var(--danger)"><b>${inr(r.balance)}</b></td>
        <td>${agingBadge}</td>
      </tr>`}).join('')}</tbody>
      <tfoot><tr><td></td><td>TOTAL</td><td class="num">${tb.bags}</td><td class="num money">${inr(tb.charges)}</td><td class="num money">${inr(tb.received)}</td><td class="num money">${inr(tb.balance)}</td><td></td></tr></tfoot>
    </table></div>`;
}
$('ledgerTable').addEventListener('click', e => {
    const b = e.target.closest('button[data-remind]');
    if (b) remindReceiver(b.dataset.remind);
});
function editPay(i) {
    const p = store.payments[i];
    $('payCode').value = p.code;
    $('payDate').value = p.date;
    $('payAmt').value = p.amount;
    $('payNote').value = p.note || '';
    editPaymentIndex = i;
    $('payActionBlock').innerHTML = `
      <div style="display:flex;gap:8px">
        <button class="btn btn-green btn-block" style="flex:1" onclick="savePayment()">✏️ Update</button>
        <button class="btn btn-ghost btn-block" style="flex:1" onclick="cancelPayEdit()">Cancel</button>
      </div>`;
    window.scrollTo({ top: $('payCode').offsetTop - 60, behavior: 'smooth' });
}

function cancelPayEdit() {
    editPaymentIndex = -1;
    $('payCode').value = '';
    $('payDate').value = '';
    $('payAmt').value = '';
    $('payNote').value = '';
    $('payActionBlock').innerHTML = `<button class="btn btn-green btn-block" onclick="savePayment()">💾 Save Payment</button>`;
}

function savePayment() {
    const code = $('payCode').value;
    const amount = +$('payAmt').value;
    const date = $('payDate').value || todayISO();
    if (!code) { toast('Choose a receiver'); return; }
    if (!(amount > 0)) { toast('Enter the amount received'); $('payAmt').focus(); return; }

    if (editPaymentIndex >= 0) {
        store.payments[editPaymentIndex] = { date, code, amount, note: $('payNote').value.trim() };
        toast('Payment updated!');
        cancelPayEdit();
    } else {
        store.payments.push({ date, code, amount, note: $('payNote').value.trim() });
        const bal = ledgerRows().find(r => r.code === code);
        toast(inr(amount) + ' from ' + code + ' saved ✔ Balance: ' + inr(bal ? bal.balance : 0) + (store.autoBackup ? ' · backup ⬇' : ''));
        $('payAmt').value = ''; $('payNote').value = '';
    }
    save(); autoBackup();
    renderAll();
}

function deletePayment(i) {
    const p = store.payments[i]; if (!p) return;
    if (!confirm('Delete payment of ' + inr(p.amount) + ' from ' + p.code + ' on ' + fmtDate(p.date) + '?')) return;
    store.payments.splice(i, 1);
    if (editPaymentIndex === i) cancelPayEdit();
    save(); autoBackup(); renderAll(); toast('Payment deleted');
}

function renderPayments() {
    const sel = $('payCode');
    const codes = allPartyNames('receivers');
    sel.innerHTML = '<option value="">— choose receiver —</option>' + codes.map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join('');
    const box = $('payList');
    if (!store.payments.length) { box.innerHTML = '<div class="empty">No payments recorded yet.</div>'; return; }
    const idx = store.payments.map((p, i) => i).sort((a, b) => store.payments[b].date.localeCompare(store.payments[a].date) || b - a).slice(0, 30);
    box.innerHTML = idx.map(i => {
        const p = store.payments[i];
        return `<div class="chl-row">
      <div class="who">${esc(p.code)} — <span class="money">${inr(p.amount)}</span>
        <small>${fmtDate(p.date)}${p.note ? ' · ' + esc(p.note) : ''}</small></div>
      <div style="white-space:nowrap">
        <button class="icon-btn" onclick="editPay(${i})" title="Edit">✏️</button>
        <button class="icon-btn red" onclick="deletePayment(${i})" title="Delete">🗑️</button>
      </div>
    </div>`;
    }).join('');
}

let editingMaster = null;
function masterAdd(type) {
    let name = prompt(type === 'sellers' ? 'Seller / shop name:' : 'Receiver code (e.g. AR):');
    if (!name) return;
    name = name.trim(); if (!name) return;
    if (type === 'receivers') name = name.toUpperCase();
    if (!store.masters[type][name]) store.masters[type][name] = { address: '', phone: '' };
    editingMaster = { type, name };
    renderMasters();
}
function masterEdit(type, name) { editingMaster = { type, name }; renderMasters(); }
function masterCancel() { editingMaster = null; renderMasters(); }
function masterUsage(type, name) {
    let trips = 0, pays = 0;
    Object.values(store.days).forEach(list => list.forEach(e => {
        if (type === 'sellers') { if (e.name === name) trips++; }
        else e.receivers.forEach(r => { if (r.code.toUpperCase() === name) trips++; });
    }));
    if (type === 'receivers') pays = store.payments.filter(p => p.code === name).length;
    return { trips, pays, total: trips + pays };
}
function masterSave(type, oldName) {
    const card = type === 'sellers' ? $('sellerMasters') : $('recvMasters');
    let newName = card.querySelector('.m-name').value.trim();
    if (type === 'receivers') newName = newName.toUpperCase();
    if (!newName) { toast('Name cannot be empty'); return; }
    const details = {
        address: card.querySelector('.m-addr').value.trim(),
        phone: card.querySelector('.m-phone').value.trim()
    };
    if (type === 'receivers') {
        const rateVal = card.querySelector('.m-rate').value;
        if (rateVal) details.customRate = parseFloat(rateVal);
    }
    if (newName !== oldName) {
        if (allPartyNames(type).includes(newName)) { toast('"' + newName + '" already exists — pick a different name'); return; }
        const u = masterUsage(type, oldName);
        if (u.total) {
            const what = u.trips + ' trip line(s)' + (u.pays ? ' and ' + u.pays + ' payment(s)' : '');
            if (!confirm('Rename "' + oldName + '" to "' + newName + '"?\n' + what + ' will be updated to the new name.')) return;
            Object.values(store.days).forEach(list => list.forEach(e => {
                if (type === 'sellers') { if (e.name === oldName) e.name = newName; }
                else e.receivers.forEach(r => { if (r.code.toUpperCase() === oldName) r.code = newName; });
            }));
            if (type === 'receivers') store.payments.forEach(p => { if (p.code === oldName) p.code = newName; });
        }
        delete store.masters[type][oldName];
    }
    store.masters[type][newName] = details;
    editingMaster = null;
    save(); autoBackup(); renderAll();
    toast(newName + ' saved ✔' + (store.autoBackup ? ' · backup ⬇' : ''));
}
function masterDelete(type, name) {
    const u = masterUsage(type, name);
    if (u.total) {
        const what = [u.trips ? u.trips + ' trip line(s)' : '', u.pays ? u.pays + ' payment(s)' : ''].filter(Boolean).join(' and ');
        toast('❌ Cannot delete "' + name + '" — used in ' + what + '. Remove those first.');
        return;
    }
    if (!confirm('Delete ' + (type === 'sellers' ? 'seller' : 'receiver') + ' "' + name + '" from masters?')) return;
    delete store.masters[type][name];
    editingMaster = null;
    save(); autoBackup(); renderAll();
    toast('"' + name + '" deleted' + (store.autoBackup ? ' · backup ⬇' : ''));
}
function masterRowHTML(type, name) {
    const m = store.masters[type][name] || { address: '', phone: '' };
    if (editingMaster && editingMaster.type === type && editingMaster.name === name) {
        return `<div class="chl-row" style="flex-wrap:wrap">
      <div class="who" style="flex-basis:100%">✏️ Editing: ${esc(name)}</div>
      <div style="flex-basis:100%;display:grid;gap:8px;margin-top:6px">
        <input type="text" class="m-name" placeholder="Name${type === 'receivers' ? ' / code' : ''}" value="${esc(name)}">
        <input type="text" class="m-addr" placeholder="Address / place" value="${esc(m.address)}">
        <input type="text" class="m-phone" placeholder="WhatsApp number (10 digits)" inputmode="tel" value="${esc(m.phone)}">
        ${type === 'receivers' ? `<input type="number" class="m-rate" min="0" placeholder="Custom Rate / bag (optional)" value="${m.customRate || ''}">` : ''}
        <div style="display:flex;gap:8px">
          <button class="btn btn-green btn-sm" data-msave="${esc(name)}">💾 Save</button>
          <button class="btn btn-ghost btn-sm" data-mcancel="1">Cancel</button>
          <button class="btn btn-danger btn-sm" style="margin-left:auto" data-mdel="${esc(name)}">🗑️ Delete</button>
        </div>
      </div>
    </div>`;
    }
    const wa = waLink(m.phone);
    return `<div class="chl-row">
    <div class="who">${esc(name)}
      <small>${m.address ? esc(m.address) : '<i>no address</i>'} · ${m.phone ? esc(m.phone) : '<i>no number</i>'}
      ${type === 'receivers' && typeof m.customRate === 'number' ? ' · <br>💰 ₹' + m.customRate + '/bag' : ''}</small></div>
    ${wa ? `<a class="icon-btn" style="text-decoration:none;display:flex;align-items:center;justify-content:center;background:#e7f8ec" href="${wa}" target="_blank" title="WhatsApp chat">💬</a>` : ''}
    <button class="icon-btn" data-medit="${esc(name)}" title="Edit">✏️</button>
  </div>`;
}
function renderMasters() {
    const q = ($('partiesSearch')?.value || '').toLowerCase().trim();
    const allSel = allPartyNames('sellers').filter(n => {
        const m = store.masters.sellers[n] || {};
        return n.toLowerCase().includes(q) || (m.phone || '').includes(q) || (m.address || '').toLowerCase().includes(q);
    });
    $('sellerMasters').innerHTML = allSel.map(n => masterRowHTML('sellers', n)).join('') || '<div class="empty">No matches found.</div>';

    const allRecv = allPartyNames('receivers').filter(n => {
        const m = store.masters.receivers[n] || {};
        return n.toLowerCase().includes(q) || (m.phone || '').includes(q) || (m.address || '').toLowerCase().includes(q);
    });
    $('recvMasters').innerHTML = allRecv.map(n => masterRowHTML('receivers', n)).join('') || '<div class="empty">No matches found.</div>';
}
[['sellerMasters', 'sellers'], ['recvMasters', 'receivers']].forEach(([id, type]) => {
    $(id).addEventListener('click', e => {
        const b = e.target.closest('button'); if (!b) return;
        if (b.dataset.medit !== undefined) masterEdit(type, b.dataset.medit);
        else if (b.dataset.msave !== undefined) masterSave(type, b.dataset.msave);
        else if (b.dataset.mdel !== undefined) masterDelete(type, b.dataset.mdel);
        else if (b.dataset.mcancel !== undefined) masterCancel();
    });
});
if ($('partiesSearch')) $('partiesSearch').addEventListener('input', renderMasters);

function syncRateInput() {
    if ($('rateInput')) $('rateInput').value = store.rate;
    $('autoBackupChk').checked = store.autoBackup;
}
$('autoBackupChk').addEventListener('change', e => {
    store.autoBackup = e.target.checked; save();
    toast(store.autoBackup ? 'Auto-backup ON — JSON downloads after every save' : 'Auto-backup OFF');
});
$('restoreFile').addEventListener('change', ev => {
    const f = ev.target.files[0]; if (!f) return;
    const rd = new FileReader();
    rd.onload = () => {
        try {
            const inc = JSON.parse(rd.result);
            if (!inc || typeof inc !== 'object' || !inc.days) throw new Error('bad');
            const nDays = Object.keys(inc.days).length;
            if (!confirm('Restore ' + nDays + ' day(s) from this backup? Same dates will be replaced by the backup.')) return;
            Object.assign(store.days, inc.days);
            if (typeof inc.rate === 'number') store.rate = inc.rate;
            if (typeof inc.autoBackup === 'boolean') store.autoBackup = inc.autoBackup;
            if (inc.masters) {
                Object.assign(store.masters.sellers, inc.masters.sellers || {});
                Object.assign(store.masters.receivers, inc.masters.receivers || {});
            }
            if (Array.isArray(inc.payments)) store.payments = inc.payments;
            if (inc.tripSalaries) Object.assign(store.tripSalaries, inc.tripSalaries);
            if (Array.isArray(inc.expenses)) {
                const seen = new Set(store.expenses.map(x => JSON.stringify(x)));
                inc.expenses.forEach(x => { const k = JSON.stringify(x); if (!seen.has(k)) { store.expenses.push(x); seen.add(k); } });
            }
            save(); syncRateInput(); renderAll();
            toast('Restored ' + nDays + ' day(s) ✔');
        } catch (e) { toast('Not a valid backup file'); }
        finally { ev.target.value = ''; }
    };
    rd.readAsText(f);
});

/* ================= PWA ================= */
if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
    navigator.serviceWorker.register('sw.js').catch(e => console.warn('SW registration failed', e));
}
let deferredInstall = null;
window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault();
    deferredInstall = e;
    $('installBtn').style.display = 'block';
    $('installHint').style.display = 'none';
});
window.addEventListener('appinstalled', () => {
    deferredInstall = null;
    $('installBtn').style.display = 'none';
    toast('App installed 🎉 Find it on your home screen');
});
async function installApp() {
    if (!deferredInstall) { toast('Use Chrome menu (⋮) → Add to Home screen'); return; }
    deferredInstall.prompt();
    await deferredInstall.userChoice;
    deferredInstall = null;
    $('installBtn').style.display = 'none';
}

/* ================= Security Settings ================= */
let enteredPin = '';
let settingPinMode = false;
let tempPin = '';

function checkLockScreen() {
    if (store.pin) {
        $('lockScreen').style.display = 'flex';
        enteredPin = '';
        renderPinDots();
        $('lockScreen').querySelector('h1').textContent = 'Enter PIN';
    } else {
        $('lockScreen').style.display = 'none';
    }
}

function renderPinDots() {
    const dots = $('pinDots').querySelectorAll('.dot');
    for (let i = 0; i < 4; i++) dots[i].className = i < enteredPin.length ? 'dot filled' : 'dot';
}

function handleDialpad(val) {
    if (val === 'C') { enteredPin = ''; renderPinDots(); return; }
    if (enteredPin.length < 4) enteredPin += val;
    renderPinDots();

    if (enteredPin.length === 4) {
        setTimeout(async () => {
            if (settingPinMode) {
                if (!tempPin) {
                    tempPin = enteredPin;
                    enteredPin = '';
                    renderPinDots();
                    $('lockScreen').querySelector('h1').textContent = 'Confirm PIN';
                } else {
                    if (tempPin === enteredPin) {
                        store.pin = await hashPin(enteredPin);
                        save();
                        toast('PIN saved successfully!');
                        $('lockScreen').style.display = 'none';
                        syncSecurityUI();
                    } else {
                        toast('PINs do not match. Try again.');
                        tempPin = '';
                        enteredPin = '';
                        renderPinDots();
                        $('lockScreen').querySelector('h1').textContent = 'Enter new PIN';
                    }
                }
            } else {
                const hashed = await hashPin(enteredPin);
                if (hashed === store.pin || btoa(enteredPin) === store.pin) {
                    if (btoa(enteredPin) === store.pin) {
                        store.pin = hashed;
                        save();
                    }
                    $('lockScreen').style.display = 'none';
                    enteredPin = '';
                } else {
                    toast('Incorrect PIN');
                    enteredPin = '';
                    renderPinDots();
                    $('lockScreen').style.animation = 'shake 0.4s';
                    setTimeout(() => $('lockScreen').style.animation = '', 400);
                }
            }
        }, 150);
    }
}
if ($('dialpad')) {
    $('dialpad').addEventListener('click', e => {
        if (e.target.tagName === 'BUTTON') handleDialpad(e.target.textContent);
    });
}

function syncSecurityUI() {
    if ($('removePinBtn')) $('removePinBtn').style.display = store.pin ? 'block' : 'none';
}
if ($('setPinBtn')) {
    $('setPinBtn').addEventListener('click', () => {
        settingPinMode = true;
        tempPin = '';
        enteredPin = '';
        renderPinDots();
        $('lockScreen').querySelector('h1').textContent = 'Enter new PIN';
        $('lockScreen').style.display = 'flex';
    });
}
if ($('removePinBtn')) {
    $('removePinBtn').addEventListener('click', () => {
        if (confirm('Are you sure you want to remove the PIN lock?')) {
            store.pin = null;
            save();
            toast('PIN removed');
            syncSecurityUI();
        }
    });
}

/* ================= Signature Pad ================= */
window.signDataUrl = null;
let isSigning = false;
let signCtx = null;

function canvasBlob(canvas, type) {
    return new Promise(resolve => canvas.toBlob(blob => resolve(blob), type));
}

// Inject WhatsApp Backup share button
const backupRow = $('page-backup').querySelector('.filerow');
if (backupRow) {
    backupRow.insertAdjacentHTML('beforeend', `<button class="btn" style="background:#25D366;color:#fff;margin-top:8px;width:100%" onclick="shareBackupWhatsApp()"><span class="ico">💬</span> Share Backup to WhatsApp</button>`);
}

async function shareBackupWhatsApp() {
    const jsonStr = JSON.stringify(store, null, 2);
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const dt = new Date();
    const ts = dt.getDate() + '-' + MONTHS[dt.getMonth()] + '-' + dt.getFullYear() + '_' + String(dt.getHours()).padStart(2, '0') + '-' + String(dt.getMinutes()).padStart(2, '0');
    const fn = 'LemonTripSheet_backup_' + ts + '.json';
    const file = new File([blob], fn, { type: 'application/json' });

    // Many mobile browsers accept navigator.canShare({files}) for images/PDF/text
    // but silently refuse .json — so we verify canShare AND actually attempt share,
    // falling back to download + WhatsApp text (no file, but reliable) on any failure.
    let shared = false;
    try {
        if (navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
            await navigator.share({
                files: [file],
                title: 'Lemon Trip Sheet Backup',
                text: 'Here is the backup file from ' + fmtDate(curDate()) + '!'
            });
            shared = true;
        }
    } catch (e) {
        if (e && e.name === 'AbortError') { shared = true; /* user cancelled, don't fall back */ }
    }
    if (!shared) {
        // Fallback: download the file locally, then open WhatsApp so the user can attach it manually.
        downloadBlob(blob, fn);
        toast('இந்த phone-ல் WhatsApp-க்கு நேரடியாக file அனுப்ப முடியவில்லை. "' + fn + '" downloads-ல் சேமிக்கப்பட்டது — WhatsApp திறந்து 📎 Document ஆக attach செய்யவும்.');
        setTimeout(() => window.open('https://wa.me/?text=' + encodeURIComponent('🍋 Lemon Trip Sheet backup (' + fmtDate(curDate()) + ') — attaching file separately.'), '_blank'), 1200);
    }
}

if ($('signPad')) {
    const canvas = $('signPad');
    signCtx = canvas.getContext('2d');

    function resizeCanvas() {
        const rect = canvas.parentElement.getBoundingClientRect();
        if (rect.width === 0) return;
        canvas.width = rect.width;
        canvas.height = rect.height;
        if (window.signDataUrl) {
            let img = new Image();
            img.onload = () => signCtx.drawImage(img, 0, 0);
            img.src = window.signDataUrl;
        } else {
            signCtx.fillStyle = '#fff';
            signCtx.fillRect(0, 0, canvas.width, canvas.height);
        }
    }
    setTimeout(resizeCanvas, 300);
    window.addEventListener('resize', resizeCanvas);

    const getPos = (e) => {
        const rect = canvas.getBoundingClientRect();
        const evt = e.touches ? e.touches[0] : e;
        return { x: evt.clientX - rect.left, y: evt.clientY - rect.top };
    };

    const startSign = (e) => {
        if (window.signDataUrl) return;
        isSigning = true;
        const p = getPos(e);
        signCtx.beginPath();
        signCtx.moveTo(p.x, p.y);
        e.preventDefault();
    };
    const moveSign = (e) => {
        if (!isSigning) return;
        const p = getPos(e);
        signCtx.lineTo(p.x, p.y);
        signCtx.strokeStyle = '#2d5c1f';
        signCtx.lineWidth = 2.5;
        signCtx.lineCap = 'round';
        signCtx.lineJoin = 'round';
        signCtx.stroke();
        e.preventDefault();
    };
    const stopSign = (e) => { isSigning = false; };

    canvas.addEventListener('mousedown', startSign);
    canvas.addEventListener('mousemove', moveSign);
    window.addEventListener('mouseup', stopSign);

    canvas.addEventListener('touchstart', startSign, { passive: false });
    canvas.addEventListener('touchmove', moveSign, { passive: false });
    window.addEventListener('touchend', stopSign);
}

if ($('clearSignBtn')) {
    $('clearSignBtn').addEventListener('click', () => {
        if (!signCtx) return;
        const c = $('signPad');
        signCtx.fillStyle = '#fff';
        signCtx.fillRect(0, 0, c.width, c.height);
        window.signDataUrl = null;
        toast('Signature cleared');
    });
}
if ($('saveSignBtn')) {
    $('saveSignBtn').addEventListener('click', () => {
        if (!signCtx) return;
        window.signDataUrl = $('signPad').toDataURL('image/png');
        toast('Signature locked for Challans ✔');
    });
}

/* ================= Initialization ================= */
load();
$('curDate').value = todayISO();
$('payDate').value = todayISO();
$('curDate').addEventListener('change', () => { resetForm(); renderAll(); });
if ($('prevDayBtn')) {
    $('prevDayBtn').addEventListener('click', () => changeDayBy(-1));
    $('nextDayBtn').addEventListener('click', () => changeDayBy(1));
    $('todayBtn').addEventListener('click', () => gotoDay(todayISO()));
}
function changeDayBy(offset) {
    let d = new Date($('curDate').value || todayISO());
    d.setDate(d.getDate() + offset);
    let zeroPad = n => String(n).padStart(2, '0');
    gotoDay(d.getFullYear() + '-' + zeroPad(d.getMonth() + 1) + '-' + zeroPad(d.getDate()));
}
if ($('auditFromDate')) {
    $('auditFromDate').value = todayISO();
    $('auditToDate').value = todayISO();
    $('auditFromDate').addEventListener('change', renderAudit);
    $('auditToDate').addEventListener('change', renderAudit);
}
syncRateInput();
resetForm();
checkLockScreen();
syncSecurityUI();
renderAll();