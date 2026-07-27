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
        window.scrollTo({ top: 0 });
    });
});

/* ================= Entry form ================= */
function recvRowHTML(code = '', qty = '') {
    return `<div class="recv-row">
    <input class="code" type="text" placeholder="Receiver (e.g. AR)" list="recvList" value="${esc(code)}" autocomplete="off">
    <input class="qty" type="number" placeholder="Bags" min="0" inputmode="numeric" value="${esc(qty)}">
    <button class="del" type="button" title="Remove">✕</button>
  </div>`;
}
function addRecvRow(code = '', qty = '') {
    $('recvRows').insertAdjacentHTML('beforeend', recvRowHTML(code, qty));
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
    }
});
$('recvRows').addEventListener('input', updateFormTotal);
function readForm() {
    const name = $('inName').value.trim();
    const receivers = [];
    $('recvRows').querySelectorAll('.recv-row').forEach(row => {
        const code = row.querySelector('.code').value.trim().toUpperCase();
        const qty = +row.querySelector('.qty').value || 0;
        if (code && qty > 0) {
            const master = store.masters.receivers[code] || {};
            const rate = typeof master.customRate === 'number' ? master.customRate : store.rate;
            receivers.push({ code, qty, rate });
        }
    });
    return { name, receivers };
}
function updateFormTotal() {
    $('formTotal').textContent = readForm().receivers.reduce((s, r) => s + r.qty, 0);
}
function resetForm() {
    editIndex = -1;
    $('inName').value = '';
    $('recvRows').innerHTML = '';
    addRecvRow();
    updateFormTotal();
    $('formTitle').textContent = '✏️ New Load Entry';
    $('saveBtn').textContent = '💾 Save Entry';
    $('cancelEditBtn').style.display = 'none';
}
$('cancelEditBtn').addEventListener('click', resetForm);
$('saveBtn').addEventListener('click', () => {
    const e = readForm();
    if (!e.name) { toast('Enter the seller / shop name'); $('inName').focus(); return; }
    if (!e.receivers.length) { toast('Add at least one receiver with bags'); return; }
    const d = curDate();
    if (!store.days[d]) store.days[d] = [];

    if (editIndex === -1 && store.days[d].some(entry => entry.name.toLowerCase() === e.name.toLowerCase())) {
        if (!confirm(`Warning: A load for "${e.name}" already exists today.\nDo you still want to save it as a duplicate?`)) {
            return;
        }
    }

    const bk = store.autoBackup ? ' · backup ⬇' : '';
    if (editIndex >= 0) { store.days[d][editIndex] = e; toast('Entry updated ✔' + bk); }
    else { store.days[d].push(e); toast(e.name + ' saved — ' + entryTotal(e) + ' bags ✔' + bk); }
    save(); resetForm(); renderAll(); autoBackup();
});

function editEntry(i) {
    const e = dayEntries()[i]; if (!e) return;
    editIndex = i;
    $('inName').value = e.name;
    $('recvRows').innerHTML = '';
    e.receivers.forEach(r => addRecvRow(r.code, r.qty));
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
    String(str).split(',').forEach(chunk => {
        const m = chunk.trim().match(/^"?\s*([A-Za-z][A-Za-z .]*?)\s*[-(]\s*([\d+\s]+)\)?\s*"?$/);
        if (m) {
            const qty = sumPlus(m[2].replace(/\s+/g, ''));
            const code = m[1].trim().toUpperCase();
            if (qty > 0) {
                const master = store.masters.receivers[code] || {};
                const rate = typeof master.customRate === 'number' ? master.customRate : store.rate;
                out.push({ code, qty, rate });
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
        <div class="entry-name">${esc(e.name)} — <b>${entryTotal(e)} bags</b></div>
        <div class="chips">${e.receivers.map(r => `<span class="chip" style="background:${getHslColor(r.code)}; border: 1px solid rgba(0,0,0,0.06); color: #1d2510">${esc(r.code)} · ${r.qty} ${r.rate && r.rate !== store.rate ? `<i>@ ₹${r.rate}</i>` : ''}</span>`).join('')}</div>
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
    <thead><tr><th>#</th><th>Seller / Shop</th><th class="num">Bags</th><th>Receiver-wise Split</th></tr></thead>
    <tbody>${list.map((e, i) => `<tr>
      <td>${i + 1}</td><td><b>${esc(e.name)}</b></td>
      <td class="num"><b>${entryTotal(e)}</b></td>
      <td>${e.receivers.map(r => esc(r.code) + ' (' + r.qty + (r.rate && r.rate !== store.rate ? ` @ ₹${r.rate}` : '') + ')').join(', ')}</td>
    </tr>`).join('')}</tbody>
    <tfoot><tr><td></td><td>TOTAL — ${list.length} sellers</td><td class="num">${total}</td><td></td></tr></tfoot>
  </table></div>`;
}
function recvTableHTML(agg) {
    if (!agg.length) return '<div class="empty"><span class="big">📦</span>No deliveries to show yet.</div>';
    const bags = agg.reduce((s, r) => s + r.bags, 0);
    return `<div class="tbl-wrap"><table>
    <thead><tr><th>#</th><th>Receiver &amp; From Sellers</th><th class="num">Bags</th><th class="num">Amount to Collect</th></tr></thead>
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
    const list = dayEntries(), agg = receiverAgg(list);
    const bags = list.reduce((s, e) => s + entryTotal(e), 0);
    $('tripDate').textContent = fmtDate(curDate());
    $('recvDate').textContent = fmtDate(curDate());
    $('rateShow').textContent = store.rate;
    $('stSellers').textContent = list.length;
    $('stBags').textContent = bags;
    $('stAmount').textContent = inr(bags * store.rate);
    $('tripTable').innerHTML = tripTableHTML(list);
    $('recvTable').innerHTML = recvTableHTML(agg);
    renderChallanList(agg);
}
function renderChallanList(agg) {
    const box = $('challanList');
    if (!agg.length) { box.innerHTML = '<div class="empty">Challans appear here once the day has entries.</div>'; return; }
    box.innerHTML = agg.map(r => `
    <div class="chl-row">
      <div class="who">🧾 ${esc(r.code)}<small>${r.bags} bags · from ${esc(sourcesText(r))}</small></div>
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
          <span class="chip">${bags} bags</span>
          <span class="chip">${unq.size} receivers</span>
          <span class="chip" style="background:#fdf6d8">${inr(bags * store.rate)}</span>
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
function renderAll() {
    renderEntries(); renderDashboards(); renderDatalists(); renderDays();
    renderLedger(); renderPayments(); renderMasters();
}

let chartObj = { recv: null, sell: null };
function renderAnalytics() {
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
}

/* ================= Report DOMs (for PDF / image) ================= */
function repFoot() { return `<div class="rep-foot">Generated on ${fmtDate(todayISO())} · Lemon Trip Sheet app</div>`; }

function buildLoadingReport() {
    const list = dayEntries();
    const totalBags = list.reduce((s, e) => s + entryTotal(e), 0);

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
      <td>${e.receivers.map(r => esc(r.code) + ' (' + r.qty + ')').join(', ')}</td>
    </tr>`).join('');

        let isLast = currentIdx >= list.length;
        let footRow = isLast ? `<tfoot><tr><td></td><td>TOTAL — ${list.length} sellers</td><td class="num">${totalBags}</td><td></td></tr></tfoot>` : '';

        pagesHtml += `
      <div class="report-page">
        ${isFirst ? `
          <div class="repband">
            <div><h1>🍋 Loading Report</h1><div class="sub">Seller-wise loading summary · Mahindra Veero</div></div>
            <div class="datebox"><small>TRIP DATE</small>${fmtDate(curDate())}</div>
          </div>
          <div class="repstats">
            <div class="repstat"><div class="v">${list.length}</div><div class="l">Sellers</div></div>
            <div class="repstat"><div class="v">${totalBags}</div><div class="l">Bags Loaded</div></div>
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
    const list = dayEntries(), agg = receiverAgg(list);
    const totalBags = agg.reduce((s, r) => s + r.bags, 0);

    let headerBandClass = hidePrice ? "" : "gold";
    let headerTitle = hidePrice
        ? `<h1>🍋 Delivery Report</h1><div class="sub">Receiver-wise delivery summary (Goods Only)</div>`
        : `<h1>🍋 Delivery &amp; Collection Report</h1><div class="sub">Receiver-wise delivery · cash to collect @ ₹${store.rate} per bag</div>`;

    let repStatsHtml = hidePrice
        ? `<div class="repstat"><div class="v">${agg.length}</div><div class="l">Receivers</div></div>
       <div class="repstat"><div class="v">${totalBags}</div><div class="l">Bags Delivered</div></div>`
        : `<div class="repstat"><div class="v">${agg.length}</div><div class="l">Receivers</div></div>
       <div class="repstat"><div class="v">${totalBags}</div><div class="l">Bags Delivered</div></div>
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
          <td><span class="rcode">${esc(r.code)}</span><div class="brk">${r.sources.map(s => esc(s.name) + ' (' + s.qty + ')').join(' &nbsp;·&nbsp; ')}</div></td>
          <td class="num"><b>${r.bags}</b></td>
        </tr>`;
            } else {
                return `<tr>
          <td>${idx}</td>
          <td><span class="rcode">${esc(r.code)}</span><div class="brk">${r.sources.map(s => esc(s.name) + ' (' + s.qty + ')').join(' &nbsp;·&nbsp; ')}</div></td>
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
    const no = 'DC-' + curDate().replace(/-/g, '') + '-' + String(idx + 1).padStart(2, '0');
    $('report').innerHTML = `
    <div class="report-page ch-wrap">
      <div class="ch-top">
        <div><h1>🍋 Delivery Challan</h1><div class="sub">Goods delivery confirmation · Mahindra Veero</div></div>
        <div class="ch-meta">Challan No: <b>${no}</b><br>Date: <b>${fmtDate(curDate())}</b></div>
      </div>
      <div class="ch-to">
        <div><div class="lbl">Delivered To</div><div class="who">${esc(r.code)}</div></div>
        <div class="bags"><div class="n">${r.bags}</div><div class="t">Bags of Lemons</div></div>
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
    document.querySelectorAll('.rateShow2').forEach(el => el.textContent = store.rate);
    if (!rows.length) { $('ledgerTable').innerHTML = '<div class="empty"><span class="big">💰</span>No deliveries or payments yet.</div>'; return; }
    const tb = rows.reduce((s, r) => ({ bags: s.bags + r.bags, charges: s.charges + r.charges, received: s.received + r.received, balance: s.balance + r.balance }), { bags: 0, charges: 0, received: 0, balance: 0 });
    $('ledgerTable').innerHTML = `<div class="tbl-wrap"><table>
    <thead><tr><th>Receiver</th><th class="num">Bags</th><th class="num">Charges</th><th class="num">Received</th><th class="num">Balance</th><th></th></tr></thead>
    <tbody>${rows.map(r => `<tr>
      <td><b>${esc(r.code)}</b></td>
      <td class="num">${r.bags}</td>
      <td class="num">${inr(r.charges)}</td>
      <td class="num" style="color:var(--leaf)">${inr(r.received)}</td>
      <td class="num" style="font-weight:800;color:${r.balance > 0 ? 'var(--danger)' : 'var(--leaf)'}">${inr(r.balance)}</td>
      <td>${r.balance > 0 ? `<button class="icon-btn" data-remind="${esc(r.code)}" title="WhatsApp reminder">💬</button>` : '✅'}</td>
    </tr>`).join('')}</tbody>
    <tfoot><tr><td>TOTAL</td><td class="num">${tb.bags}</td><td class="num">${inr(tb.charges)}</td><td class="num">${inr(tb.received)}</td><td class="num">${inr(tb.balance)}</td><td></td></tr></tfoot>
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
    $('rateInput').value = store.rate;
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
        setTimeout(() => {
            if (settingPinMode) {
                if (!tempPin) {
                    tempPin = enteredPin;
                    enteredPin = '';
                    renderPinDots();
                    $('lockScreen').querySelector('h1').textContent = 'Confirm PIN';
                } else {
                    if (tempPin === enteredPin) {
                        store.pin = btoa(enteredPin);
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
                if (btoa(enteredPin) === store.pin) {
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
syncRateInput();
resetForm();
checkLockScreen();
syncSecurityUI();
renderAll();
