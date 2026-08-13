/* ================= Exports (PDF / Image / Excel / ZIP / Share) ================= */
function showSpinner(msg) {
    const o = $('loadingOverlay');
    if (o) { $('loadingOverlayMsg').textContent = msg; o.style.display = 'flex'; }
}
function hideSpinner() {
    const o = $('loadingOverlay'); if (o) o.style.display = 'none';
}

function libMissing(name) { toast('⚠ ' + name + ' needs internet the first time. Connect once and retry.'); }
function vehicleFileSuffix() {
    if (!vehicleFilter) return '';
    return '_' + (vehicleFilter === '__UNASSIGNED__' ? 'Unassigned' : vehicleFilter.replace(/[^A-Za-z0-9]+/g, ''));
}
function fileBase(kind) {
    const vs = vehicleFileSuffix();
    if (kind === 'delivery') return 'CollectionReport_' + fmtDate(curDate()) + vs;
    if (kind === 'delivery_noprice') return 'DeliveryReport_' + fmtDate(curDate()) + vs;
    return 'LoadingReport_' + fmtDate(curDate()) + vs;
}
function hasData() { if (!activeEntries().length) { toast('No entries on this day to export' + (vehicleFilter ? ' for this vehicle' : '')); return false; } return true; }
function freeReport() { $('report').innerHTML = ''; }

let shareInFlight = false;
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') shareInFlight = false; });
window.addEventListener('pageshow', e => { if (e.persisted) { shareInFlight = false; renderAll(); } });

async function shareOrDownload(blob, name, mime) {
    const file = new File([blob], name, { type: mime });
    if (!shareInFlight && navigator.canShare && navigator.canShare({ files: [file] })) {
        shareInFlight = true;
        try { await navigator.share({ files: [file], title: name }); shareInFlight = false; return; }
        catch (e) { shareInFlight = false; if (e && e.name === 'AbortError') return; }
    }
    downloadBlob(blob, name);
    toast('Saved: ' + name + ' ✔');
}
function canvasBlob(canvas, type) { return new Promise(res => canvas.toBlob(res, type)); }

/* ================= PDF Pagination via Chunking ================= */
async function exportPDF(kind) {
    if (!hasData()) return;
    if (typeof html2canvas === 'undefined' || typeof window.jspdf === 'undefined') return libMissing('PDF export');
    toast('Preparing PDF…');
    showSpinner('Generating PDF...');
    try {
        buildReport(kind);
        const pages = document.querySelectorAll('#report .report-page');
        const pdf = new window.jspdf.jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
        const pageW = 210, pageH = 297, margin = 8;
        const imgW = pageW - margin * 2;

        for (let i = 0; i < pages.length; i++) {
            const canvas = await html2canvas(pages[i], { scale: 2, backgroundColor: '#ffffff' });
            if (i > 0) pdf.addPage();

            let imgH = canvas.height * imgW / canvas.width;

            if (imgH > pageH - margin * 2) {
                imgH = pageH - margin * 2;
                const adjustedW = canvas.width * imgH / canvas.height;
                const offsetX = margin + (imgW - adjustedW) / 2;
                pdf.addImage(canvas.toDataURL('image/jpeg', 0.96), 'JPEG', offsetX, margin, adjustedW, imgH);
            } else {
                pdf.addImage(canvas.toDataURL('image/jpeg', 0.96), 'JPEG', margin, margin, imgW, imgH);
            }
        }
        freeReport();
        await shareOrDownload(pdf.output('blob'), fileBase(kind) + '.pdf', 'application/pdf');
    } catch (e) { console.error(e); toast('PDF export failed'); }
    finally { hideSpinner(); }
}

async function exportImage(kind) {
    if (!hasData()) return;
    if (typeof html2canvas === 'undefined') return libMissing('Image export');
    toast('Preparing image…');
    showSpinner('Generating Image...');
    try {
        buildReport(kind);
        const canvas = await html2canvas($('report'), { scale: 2, backgroundColor: '#ffffff' });
        const blob = await canvasBlob(canvas, 'image/png');
        freeReport();
        await shareOrDownload(blob, fileBase(kind) + '.png', 'image/png');
    } catch (e) { console.error(e); toast('Image export failed'); }
    finally { hideSpinner(); }
}

function exportExcel() {
    if (!hasData()) return;
    if (typeof XLSX === 'undefined') return libMissing('Excel export');
    const list = activeEntries(), agg = receiverAgg(list);
    const wb = XLSX.utils.book_new();

    const s1 = [['S.No', 'Seller / Shop', 'Total Items', 'Receiver-wise Details']];
    list.forEach((e, i) => s1.push([i + 1, e.name, entryTotal(e), e.receivers.map(r => r.code + ' (' + r.qty + ' x ' + (r.type || 'Bag') + ')').join(', ')]));
    s1.push(['', 'TOTAL', list.reduce((s, e) => s + entryTotal(e), 0), '']);
    const ws1 = XLSX.utils.aoa_to_sheet(s1);
    ws1['!cols'] = [{ wch: 6 }, { wch: 24 }, { wch: 11 }, { wch: 42 }];
    XLSX.utils.book_append_sheet(wb, ws1, 'Trip Sheet');

    const s2 = [['S.No', 'Receiver', 'Which Sellers & Split', 'Total Items delivered', 'Amount to Collect (Rs)']];
    agg.forEach((r, i) => s2.push([i + 1, r.code, sourcesText(r), r.bags, r.amount]));
    const tb = agg.reduce((s, r) => s + r.bags, 0);
    const ta = agg.reduce((s, r) => s + (r.amount || 0), 0);
    s2.push(['', 'TOTAL', '', tb, ta]);
    const ws2 = XLSX.utils.aoa_to_sheet(s2);
    ws2['!cols'] = [{ wch: 6 }, { wch: 14 }, { wch: 46 }, { wch: 8 }, { wch: 20 }];
    XLSX.utils.book_append_sheet(wb, ws2, 'Receiver Summary');

    if (typeof ledgerRows === 'function') {
        const ledger = ledgerRows();
        if (ledger && ledger.length) {
            const s3 = [['Receiver Code', 'Total Delivered (Bags)', 'Total Charges (Rs)', 'Amount Received (Rs)', 'Outstanding Balance (Rs)']];
            ledger.forEach(r => s3.push([r.code, r.bags, r.charges, r.received, r.balance]));
            const ws3 = XLSX.utils.aoa_to_sheet(s3);
            ws3['!cols'] = [{ wch: 15 }, { wch: 22 }, { wch: 22 }, { wch: 22 }, { wch: 25 }];
            XLSX.utils.book_append_sheet(wb, ws3, 'Outstanding Ledger');
        }
    }

    XLSX.writeFile(wb, 'LemonTripSheet_' + fmtDate(curDate()) + vehicleFileSuffix() + '.xlsx');
    toast('Excel downloaded ✔');
}

async function exportStatementPDF() {
    const code = $('stmtReceiver').value;
    const fDate = $('stmtFromDate').value;
    const tDate = $('stmtToDate').value;

    if (!code) return toast('Please select a receiver');
    if (!fDate || !tDate) return toast('Please select both From and To dates');
    if (fDate > tDate) return toast('From Date must be before To Date');

    if (typeof html2canvas === 'undefined' || typeof window.jspdf === 'undefined') return libMissing('PDF export');
    toast('Preparing Statement PDF…');
    showSpinner('Generating PDF...');
    try {
        buildStatementReport(code, fDate, tDate);
        const pages = document.querySelectorAll('#report .report-page');
        const pdf = new window.jspdf.jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
        const pageW = 210, pageH = 297, margin = 8;
        const imgW = pageW - margin * 2;

        for (let i = 0; i < pages.length; i++) {
            const canvas = await html2canvas(pages[i], { scale: 2, backgroundColor: '#ffffff' });
            if (i > 0) pdf.addPage();
            let imgH = canvas.height * imgW / canvas.width;
            if (imgH > pageH - margin * 2) {
                imgH = pageH - margin * 2;
                const adjustedW = canvas.width * imgH / canvas.height;
                const offsetX = margin + (imgW - adjustedW) / 2;
                pdf.addImage(canvas.toDataURL('image/jpeg', 0.96), 'JPEG', offsetX, margin, adjustedW, imgH);
            } else {
                pdf.addImage(canvas.toDataURL('image/jpeg', 0.96), 'JPEG', margin, margin, imgW, imgH);
            }
        }
        freeReport();
        await shareOrDownload(pdf.output('blob'), `Statement_${code}_${fDate}_to_${tDate}.pdf`, 'application/pdf');
    } catch (e) { console.error(e); toast('PDF export failed'); }
    finally { hideSpinner(); }
}

function exportStatementExcel() {
    const code = $('stmtReceiver').value;
    const fDate = $('stmtFromDate').value;
    const tDate = $('stmtToDate').value;

    if (!code) return toast('Please select a receiver');
    if (!fDate || !tDate) return toast('Please select both From and To dates');
    if (fDate > tDate) return toast('From Date must be before To Date');

    if (typeof XLSX === 'undefined') return libMissing('Excel export');

    const list = receiverStatementRows(code, fDate, tDate);
    const dateRangeStr = fmtDate(fDate) + ' to ' + fmtDate(tDate);

    const wb = XLSX.utils.book_new();
    const s = [['Ledger Statement: ' + code.toUpperCase(), 'Period: ' + dateRangeStr], []];
    s.push(['Date', 'Seller', 'Qty', 'Item Type', 'Rate', 'Amount (Rs)', 'Payment (Rs)', 'Balance (Rs)']);

    let tb = 0, ta = 0, tp = 0;
    list.forEach(r => {
        if (!r.isOpening) { tb += r.bags || 0; ta += r.amount || 0; tp += r.payment || 0; }
        s.push([r.isOpening ? '—' : fmtDate(r.date), r.seller, r.bags || '', r.type || '', r.rate || '', r.amount || '', r.payment || '', r.balance]);
    });

    const finalBal = list.length ? list[list.length - 1].balance : 0;
    s.push(['TOTAL', '', tb, '', '', ta, tp, finalBal]);

    const ws = XLSX.utils.aoa_to_sheet(s);
    ws['!cols'] = [{ wch: 12 }, { wch: 25 }, { wch: 8 }, { wch: 15 }, { wch: 8 }, { wch: 12 }, { wch: 12 }, { wch: 15 }];

    XLSX.utils.book_append_sheet(wb, ws, 'Statement');
    XLSX.writeFile(wb, `Statement_${code}_${fDate}_to_${tDate}.xlsx`);
    toast('Excel downloaded ✔');
}

/* ---------- Challan exports (non-financial) ---------- */
async function challanCanvas(code) {
    const agg = receiverAgg(activeEntries());
    const i = agg.findIndex(r => r.code === code);
    if (i < 0) return null;
    buildChallan(agg[i], i);
    const canvas = await html2canvas($('report').firstElementChild, { scale: 2, backgroundColor: '#ffffff' });
    freeReport();
    return canvas;
}
function sharePdfBlob(blob, name) { return shareOrDownload(blob, name, 'application/pdf'); }
function challanFile(code) { return 'Challan_' + code.replace(/[^A-Za-z0-9]+/g, '') + '_' + fmtDate(curDate()); }

async function exportChallanPDF(code) {
    if (!hasData()) return;
    if (typeof html2canvas === 'undefined' || typeof window.jspdf === 'undefined') return libMissing('PDF export');
    toast('Preparing challan…');
    showSpinner('Generating Challan...');
    try {
        const canvas = await challanCanvas(code);
        if (!canvas) return;
        const pdf = new window.jspdf.jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
        const pageW = 210, pageH = 297, margin = 8;
        const imgW = pageW - margin * 2;
        let imgH = canvas.height * imgW / canvas.width;

        if (imgH > pageH - margin * 2) {
            imgH = pageH - margin * 2;
            const adjustedW = canvas.width * imgH / canvas.height;
            const offsetX = margin + (imgW - adjustedW) / 2;
            pdf.addImage(canvas.toDataURL('image/jpeg', 0.96), 'JPEG', offsetX, margin, adjustedW, imgH);
        } else {
            pdf.addImage(canvas.toDataURL('image/jpeg', 0.96), 'JPEG', margin, margin, imgW, imgH);
        }
        await sharePdfBlob(pdf.output('blob'), challanFile(code) + '.pdf');
    } catch (e) { console.error(e); toast('Challan export failed'); }
    finally { hideSpinner(); }
}

/* ---------- Generic single-report-page PDF helper (Invoice / Credit Note) ---------- */
async function singlePagePdf(filename) {
    const canvas = await html2canvas($('report').firstElementChild, { scale: 2, backgroundColor: '#ffffff' });
    freeReport();
    const pdf = new window.jspdf.jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
    const pageW = 210, pageH = 297, margin = 8;
    const imgW = pageW - margin * 2;
    let imgH = canvas.height * imgW / canvas.width;
    if (imgH > pageH - margin * 2) {
        imgH = pageH - margin * 2;
        const adjustedW = canvas.width * imgH / canvas.height;
        const offsetX = margin + (imgW - adjustedW) / 2;
        pdf.addImage(canvas.toDataURL('image/jpeg', 0.96), 'JPEG', offsetX, margin, adjustedW, imgH);
    } else {
        pdf.addImage(canvas.toDataURL('image/jpeg', 0.96), 'JPEG', margin, margin, imgW, imgH);
    }
    await sharePdfBlob(pdf.output('blob'), filename);
}

async function exportInvoicePDF(id) {
    const inv = findInvoice(id);
    if (!inv) { toast('Invoice கிடைக்கல'); return; }
    if (typeof html2canvas === 'undefined' || typeof window.jspdf === 'undefined') return libMissing('PDF export');
    toast('Preparing invoice…');
    showSpinner('Generating Invoice...');
    try {
        buildInvoiceReport(inv);
        await singlePagePdf(inv.id + '_' + inv.code + '.pdf');
    } catch (e) { console.error(e); toast('Invoice export failed'); }
    finally { hideSpinner(); }
}

async function exportCreditNotePDF(i) {
    const adj = store.adjustments[i];
    if (!adj || !adj.cnNo) { toast('Credit Note number இல்லை'); return; }
    if (typeof html2canvas === 'undefined' || typeof window.jspdf === 'undefined') return libMissing('PDF export');
    toast('Preparing credit note…');
    showSpinner('Generating Credit Note...');
    try {
        buildCreditNoteReport(adj);
        await singlePagePdf(adj.cnNo + '_' + adj.code + '.pdf');
    } catch (e) { console.error(e); toast('Credit Note export failed'); }
    finally { hideSpinner(); }
}

async function exportChallanImage(code) {
    if (!hasData()) return;
    if (typeof html2canvas === 'undefined') return libMissing('Image export');
    toast('Preparing challan image…');
    showSpinner('Generating Challan Image...');
    try {
        const canvas = await challanCanvas(code);
        if (!canvas) return;
        const blob = await canvasBlob(canvas, 'image/png');
        await shareOrDownload(blob, challanFile(code) + '.png', 'image/png');
    } catch (e) { console.error(e); toast('Challan export failed'); }
    finally { hideSpinner(); }
}

async function exportAllChallans() {
    if (!hasData()) return;
    if (typeof html2canvas === 'undefined' || typeof window.jspdf === 'undefined') return libMissing('PDF export');
    const agg = receiverAgg(activeEntries());
    if (!agg.length) { toast('No receivers on this day'); return; }
    toast('Preparing ' + agg.length + ' challans…');
    showSpinner('Generating All Challans...');
    try {
        const pdf = new window.jspdf.jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
        const pageW = 210, pageH = 297, margin = 8;
        const imgW = pageW - margin * 2;
        for (let i = 0; i < agg.length; i++) {
            buildChallan(agg[i], i);
            const canvas = await html2canvas($('report').firstElementChild, { scale: 2, backgroundColor: '#ffffff' });
            if (i > 0) pdf.addPage();

            let imgH = canvas.height * imgW / canvas.width;
            if (imgH > pageH - margin * 2) {
                imgH = pageH - margin * 2;
                const adjustedW = canvas.width * imgH / canvas.height;
                const offsetX = margin + (imgW - adjustedW) / 2;
                pdf.addImage(canvas.toDataURL('image/jpeg', 0.96), 'JPEG', offsetX, margin, adjustedW, imgH);
            } else {
                pdf.addImage(canvas.toDataURL('image/jpeg', 0.96), 'JPEG', margin, margin, imgW, imgH);
            }
        }
        freeReport();
        await sharePdfBlob(pdf.output('blob'), 'Challans_' + fmtDate(curDate()) + vehicleFileSuffix() + '.pdf');
    } catch (e) { console.error(e); toast('Challan export failed'); }
    finally { hideSpinner(); }
}

async function exportAllChallanImages() {
    if (!hasData()) return;
    if (typeof html2canvas === 'undefined' || typeof JSZip === 'undefined') return libMissing('ZIP export');
    const agg = receiverAgg(activeEntries());
    if (!agg.length) { toast('No receivers on this day'); return; }
    toast('Preparing ' + agg.length + ' challan images…');
    showSpinner('Zipping Images...');
    try {
        const zip = new JSZip();
        for (let i = 0; i < agg.length; i++) {
            buildChallan(agg[i], i);
            const canvas = await html2canvas($('report').firstElementChild, { scale: 2, backgroundColor: '#ffffff' });
            const blob = await canvasBlob(canvas, 'image/png');
            zip.file(challanFile(agg[i].code) + '.png', blob);
        }
        freeReport();
        const zipBlob = await zip.generateAsync({ type: 'blob' });
        await shareOrDownload(zipBlob, 'Challans_Images_' + fmtDate(curDate()) + vehicleFileSuffix() + '.zip', 'application/zip');
    } catch (e) { console.error(e); toast('ZIP export failed'); }
    finally { hideSpinner(); }
}

function whatsAppText(kind) {
    const list = activeEntries(), agg = receiverAgg(list);
    const bags = list.reduce((s, e) => s + entryTotal(e), 0);
    const vehTag = vehicleFilter ? ' 🚚 (' + (vehicleFilter === '__UNASSIGNED__' ? 'Unassigned' : vehicleFilter) + ')' : '';
    const L = [];
    if (kind === 'delivery' || kind === 'delivery_noprice') {
        L.push('🍋 *Delivery & Collection — ' + fmtDate(curDate()) + vehTag + '*');
        L.push('_₹' + store.rate + ' per bag_');
        L.push('');
        agg.forEach(r => {
            L.push('*' + r.code + '*: ' + r.bags + ' items = *₹' + (r.amount || 0).toLocaleString('en-IN') + '*');
            L.push('   ↳ from ' + sourcesText(r));
        });
        L.push('');
        L.push('*Total items: ' + bags + '  — collect ₹' + agg.reduce((s, x) => s + (x.amount || 0), 0).toLocaleString('en-IN') + '*');
    } else {
        L.push('🍋 *Loading Report — ' + fmtDate(curDate()) + vehTag + '*');
        L.push('');
        list.forEach((e, i) => L.push((i + 1) + '. ' + e.name + ' — ' + entryTotal(e) + ' [' + e.receivers.map(r => r.code + ' (' + r.qty + ' x ' + (r.type || 'Bag') + ')').join(', ') + ']'));
        L.push('');
        L.push('*Total loaded: ' + bags + ' items (' + list.length + ' sellers)*');
    }
    return L.join('\n');
}
function shareWhatsApp(kind) {
    if (!hasData()) return;
    window.open('https://wa.me/?text=' + encodeURIComponent(whatsAppText(kind)), '_blank');
}

/* ================= Audit exports (multi-vehicle, multi-day consolidated) ================= */
function auditDateRange() {
    const fD = $('auditFromDate') ? $('auditFromDate').value : '';
    const tD = $('auditToDate') ? $('auditToDate').value : '';
    if (!fD || !tD) { toast('From/To date தேர்ந்தெடுக்கவும்'); return null; }
    if (fD > tD) { toast('From Date must be before To Date'); return null; }
    return { fD, tD };
}
function auditFileBase(kind, fD, tD) {
    const base = kind === 'loading' ? 'Audit_Loading' : kind === 'delivery' ? 'Audit_Collection' : 'Audit_Delivery';
    return base + '_' + fmtDate(fD) + '_to_' + fmtDate(tD);
}

async function exportAuditPDF(kind) {
    const range = auditDateRange(); if (!range) return;
    const { fD, tD } = range;
    if (typeof html2canvas === 'undefined' || typeof window.jspdf === 'undefined') return libMissing('PDF export');
    toast('Preparing Audit PDF…');
    showSpinner('Generating Audit PDF...');
    try {
        buildAuditReport(kind, fD, tD);
        const pages = document.querySelectorAll('#report .report-page');
        const pdf = new window.jspdf.jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
        const pageW = 210, pageH = 297, margin = 8;
        const imgW = pageW - margin * 2;
        for (let i = 0; i < pages.length; i++) {
            const canvas = await html2canvas(pages[i], { scale: 2, backgroundColor: '#ffffff' });
            if (i > 0) pdf.addPage();
            let imgH = canvas.height * imgW / canvas.width;
            if (imgH > pageH - margin * 2) {
                imgH = pageH - margin * 2;
                const adjustedW = canvas.width * imgH / canvas.height;
                const offsetX = margin + (imgW - adjustedW) / 2;
                pdf.addImage(canvas.toDataURL('image/jpeg', 0.96), 'JPEG', offsetX, margin, adjustedW, imgH);
            } else {
                pdf.addImage(canvas.toDataURL('image/jpeg', 0.96), 'JPEG', margin, margin, imgW, imgH);
            }
        }
        freeReport();
        await shareOrDownload(pdf.output('blob'), auditFileBase(kind, fD, tD) + '.pdf', 'application/pdf');
    } catch (e) { console.error(e); toast('Audit PDF export failed'); }
    finally { hideSpinner(); }
}

function exportAuditExcel() {
    const range = auditDateRange(); if (!range) return;
    const { fD, tD } = range;
    if (typeof XLSX === 'undefined') return libMissing('Excel export');

    const wb = XLSX.utils.book_new();

    const loadRows = auditLoadingRows(fD, tD);
    const s1 = [['Date', 'Vehicle', 'Seller / Shop', 'Bags', 'Receiver Split']];
    loadRows.forEach(r => s1.push([fmtDate(r.date), r.vehicle, r.name, r.bags, r.receivers.map(x => x.code + ' (' + x.qty + ' x ' + (x.type || 'Bag') + ')').join(', ')]));
    const tb1 = loadRows.reduce((s, r) => s + r.bags, 0);
    s1.push(['', '', 'TOTAL', tb1, '']);
    const ws1 = XLSX.utils.aoa_to_sheet(s1);
    ws1['!cols'] = [{ wch: 12 }, { wch: 16 }, { wch: 22 }, { wch: 8 }, { wch: 42 }];
    XLSX.utils.book_append_sheet(wb, ws1, 'Consolidated Loading');

    const delRows = auditDeliveryRows(fD, tD);
    const s2 = [['Vehicle', 'Receiver', 'Bags', 'Amount (Rs)']];
    delRows.forEach(r => s2.push([r.vehicle, r.code, r.bags, r.amount]));
    const tb2 = delRows.reduce((s, r) => s + r.bags, 0);
    const ta2 = delRows.reduce((s, r) => s + r.amount, 0);
    s2.push(['', 'TOTAL', tb2, ta2]);
    const ws2 = XLSX.utils.aoa_to_sheet(s2);
    ws2['!cols'] = [{ wch: 16 }, { wch: 14 }, { wch: 8 }, { wch: 14 }];
    XLSX.utils.book_append_sheet(wb, ws2, 'Consolidated Delivery');

    const vehRows = auditVehicleAgg(fD, tD);
    const s3 = [['Vehicle', 'Seller Loads', 'Bags', 'Amount (Rs)']];
    vehRows.forEach(r => s3.push([r.vehicle, r.sellers, r.bags, r.amount]));
    const ws3 = XLSX.utils.aoa_to_sheet(s3);
    ws3['!cols'] = [{ wch: 16 }, { wch: 14 }, { wch: 10 }, { wch: 14 }];
    XLSX.utils.book_append_sheet(wb, ws3, 'Vehicle Summary');

    const typeRows = auditItemTypeAgg(fD, tD);
    const s4 = [['Item Type', 'Total Qty']];
    typeRows.forEach(r => s4.push([r.type, r.qty]));
    s4.push(['TOTAL', typeRows.reduce((s, r) => s + r.qty, 0)]);
    const ws4 = XLSX.utils.aoa_to_sheet(s4);
    ws4['!cols'] = [{ wch: 20 }, { wch: 12 }];
    XLSX.utils.book_append_sheet(wb, ws4, 'Item Type Breakdown');

    const s5 = [['Profit & Loss — ' + fmtDate(fD) + ' to ' + fmtDate(tD)], []];
    const allV = ['', ...allVehicles()];
    s5.push(['Vehicle', 'Collection (Rs)', 'Load Man Wages (Rs)', 'Driver Salary (Rs)', 'Cleaner Salary (Rs)',
        ...EXPENSE_TYPES.map(t => t.label + ' (Rs)'), 'Total Cost (Rs)', 'Net Profit/Loss (Rs)']);
    allV.forEach(v => {
        const r = profitLossReport(fD, tD, v);
        if (r.collection === 0 && r.totalCost === 0) return;
        s5.push([v || 'Unassigned', r.collection, r.loadMan, r.driverTotal, r.cleanerTotal,
            ...EXPENSE_TYPES.map(t => r.expByType[t.key] || 0), r.totalCost, r.profit]);
    });
    const grand = profitLossReport(fD, tD, '');
    s5.push(['GRAND TOTAL (All Vehicles)', grand.collection, grand.loadMan, grand.driverTotal, grand.cleanerTotal,
        ...EXPENSE_TYPES.map(t => grand.expByType[t.key] || 0), grand.totalCost, grand.profit]);
    const ws5 = XLSX.utils.aoa_to_sheet(s5);
    ws5['!cols'] = [{ wch: 16 }, { wch: 14 }, { wch: 16 }, { wch: 14 }, { wch: 14 }, { wch: 12 }, { wch: 12 }, { wch: 16 }, { wch: 10 }, { wch: 12 }, { wch: 14 }, { wch: 16 }];
    XLSX.utils.book_append_sheet(wb, ws5, 'Profit & Loss');

    XLSX.writeFile(wb, 'Audit_' + fmtDate(fD) + '_to_' + fmtDate(tD) + '.xlsx');
    toast('Audit Excel downloaded ✔');
}
