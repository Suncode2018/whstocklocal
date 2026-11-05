/* ============================================================
   admin-stock.js — Stock summary & export
   ============================================================ */

let stockAutoRefreshTimer = null;

const DESKTOP_OPERATIONS = {
  PICK:      { title: 'PICK · เบิกจ่าย', hint: 'ตัดสินค้าออกจากโลเคชั่นต้นทาง', location: 'โลเคชั่นต้นทาง', submit: 'บันทึกเบิกจ่าย' },
  CHECK:     { title: 'CHECK · ตรวจสต็อก', hint: 'บันทึกยอดที่ตรวจพบ โดยไม่ปรับยอดคงเหลือ', location: 'โลเคชั่นที่ตรวจ', qty: 'ยอดที่ตรวจพบ', submit: 'บันทึกผลตรวจ' },
  TRANSFER:  { title: 'TRANSFER · โอนย้าย', hint: 'ย้ายสินค้าออกจากต้นทางไปยังปลายทาง', location: 'โลเคชั่นต้นทาง', target: true, submit: 'บันทึกโอนย้าย' },
  LOAD:      { title: 'LOAD · โหลดสินค้า', hint: 'ตัดสินค้าจากโลเคชั่นต้นทางเพื่อโหลดขึ้นรถ', location: 'โลเคชั่นต้นทาง', submit: 'บันทึกโหลดสินค้า' },
  PUTAWAY:   { title: 'PUTAWAY · จัดเก็บ', hint: 'ย้ายสินค้าจากจุดพักไปยังโลเคชั่นจัดเก็บ', location: 'โลเคชั่นต้นทาง', target: true, submit: 'บันทึกจัดเก็บ' }
};

function setDesktopOperation(type) {
  const operation = DESKTOP_OPERATIONS[type];
  if (!operation) return;
  document.getElementById('deskMode').value = type;
  document.getElementById('deskPageTitle').textContent = operation.title;
  document.getElementById('deskPageSub').textContent = `${operation.hint} · สแกนบาร์โค้ดและระบุจำนวนเพื่อบันทึก`;
  document.getElementById('deskLocationLabel').textContent = operation.location;
  document.getElementById('deskQtyLabel').textContent = operation.qty || 'จำนวน';
  document.getElementById('deskSubmitLabel').textContent = operation.submit;
  document.getElementById('deskTargetRow').style.display = operation.target ? 'block' : 'none';
  document.getElementById('deskTargetRow').classList.toggle('d-none', !operation.target);
  document.getElementById('deskTargetLocation').required = Boolean(operation.target);
  document.getElementById('deskBarcode').value = '';
  document.getElementById('deskQty').value = '1';
  document.getElementById('deskLocation').value = '';
  document.getElementById('deskTargetLocation').value = '';
  document.getElementById('deskQty').min = type === 'CHECK' ? '0' : '1';
  document.getElementById('deskQty').placeholder = type === 'CHECK' ? 'ใส่ 0 ได้' : '';
  document.getElementById('deskLocation').placeholder = operation.target ? 'เช่น RCV-01' : (type === 'RECEIVE' ? 'เช่น RCV-01' : 'เช่น A-01-01');
  document.getElementById('deskBarcode').focus();
}

async function loadSummaryStock(isSilent = false) {
  if (document.querySelector('[data-stock-report="true"]')) return loadAdminStockReport();
  const tbody = document.getElementById('stockTableBody');
  const countEl = document.getElementById('stockCount');
  const updatedEl = document.getElementById('stockUpdated');

  if (!isSilent && tbody) {
    tbody.innerHTML = `<tr><td colspan="7" class="text-center py-4 text-muted"><span class="spinner-border spinner-border-sm me-2"></span>กำลังโหลด...</td></tr>`;
  }

  try {
    const res  = await fetch('/api/stock/balance', { headers: authHeaders() });
    const data = await res.json();
    
    const stockList = Array.isArray(data) ? data : (data.data || []);

    if (countEl) {
      countEl.textContent = `${stockList.length} รายการ`;
    }
    if (updatedEl) {
      updatedEl.textContent = `อัปเดตล่าสุด: ${new Date().toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`;
    }

    if (!stockList.length) {
      if (tbody) tbody.innerHTML = `<tr><td colspan="7" class="text-center py-4 text-muted">ไม่มีข้อมูลสต็อก</td></tr>`;
      return;
    }

    // กรองข้อมูลผ่านช่อง Search
    const searchInput = document.getElementById('stockSearch');
    const keyword = searchInput ? searchInput.value.toLowerCase().trim() : '';

    const filteredList = stockList.filter(item => {
      if (!keyword) return true;
      const barcode = (item.Barcode || '').toLowerCase();
      const code = (item.ItemCode || '').toLowerCase();
      const name = (item.ItemName || '').toLowerCase();
      const loc = (item.LocationDetails || '').toLowerCase();
      return barcode.includes(keyword) || code.includes(keyword) || name.includes(keyword) || loc.includes(keyword);
    });

    if (filteredList.length === 0) {
      if (tbody) tbody.innerHTML = `<tr><td colspan="7" class="text-center py-4 text-muted">ไม่พบข้อมูลที่ค้นหา</td></tr>`;
      return;
    }

    if (tbody) {
      tbody.innerHTML = filteredList.map((item, i) => {
        const qty = item.TotalStock ?? item.Quantity ?? 0;
        const minStock = item.MinStock ?? 0;
        const cls = qty <= 0 ? 'danger' : (minStock > 0 && qty <= minStock) ? 'low' : '';
        
        // 💡 ดึงเวลาจริงจาก LastUpdated ของฐานข้อมูล (ที่ส่งมาจาก MAX(s.LastUpdated))
        const timeVal = item.LastUpdated || item.lastUpdated;

        let formattedTime = '-';
        if (timeVal) {
          try {
            const d = new Date(timeVal);
            if (!isNaN(d.getTime())) {
              formattedTime = d.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
            } else {
              formattedTime = timeVal;
            }
          } catch {
            formattedTime = timeVal;
          }
        }

        return `
          <tr>
            <td>${i + 1}</td>
            <td><code class="text-indigo">${item.Barcode || '-'}</code></td>
            <td><strong>${item.ItemCode || '-'}</strong></td>
            <td>${item.ItemName || '-'}</td>
            <td>${item.LocationDetails || '-'}</td>
            <td><span class="qty-badge ${cls}">${qty} ${item.UOM || ''}</span></td>
            <td class="text-muted" style="font-size:.8rem">${formattedTime}</td>
          </tr>`;
      }).join('');
    }
  } catch (e) {
    if (tbody) tbody.innerHTML = `<tr><td colspan="7" class="text-center text-danger py-3">โหลดข้อมูลไม่สำเร็จ</td></tr>`;
    if (updatedEl) updatedEl.textContent = 'รีเฟรชไม่สำเร็จ';
    console.error(e);
  }
}

/* ── Auto Refresh ทุกๆ 15 วินาทีเมื่ออยู่หน้า Stock ── */
function startStockAutoRefresh() {
  stopStockAutoRefresh();
  stockAutoRefreshTimer = setInterval(() => {
    loadSummaryStock(true);
  }, 15000);
}

function stopStockAutoRefresh() {
  if (stockAutoRefreshTimer) {
    clearInterval(stockAutoRefreshTimer);
    stockAutoRefreshTimer = null;
  }
}

/* ── Event Listener สำหรับช่องค้นหา Stock ── */
document.addEventListener('DOMContentLoaded', () => {
  const stockSearchInput = document.getElementById('stockSearch');
  if (stockSearchInput) {
    stockSearchInput.addEventListener('input', () => {
      loadSummaryStock(true);
    });
  }
});

async function exportToExcel() {
  try {
    const res  = await fetch('/api/stock/export', { headers: authHeaders() });
    if (!res.ok) { toast('error', 'Export ไม่สำเร็จ'); return; }
    const blob = await res.blob();
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url;
    a.download = `stock_export_${new Date().toISOString().slice(0,10)}.xlsx`;
    a.click(); URL.revokeObjectURL(url);
    toast('success', 'Export สำเร็จ');
  } catch { toast('error', 'เกิดข้อผิดพลาด'); }
}

async function clearCurrentRound() {
  const result = await Swal.fire({
    title: 'ล้างนับสต็อกรอบปัจจุบัน?',
    text: 'ข้อมูลการนับสต็อกรอบนี้จะถูกล้างทั้งหมด ดำเนินการต่อ?',
    icon: 'warning', showCancelButton: true,
    confirmButtonColor: '#ef4444', cancelButtonColor: '#6b7280',
    confirmButtonText: 'ล้างข้อมูล', cancelButtonText: 'ยกเลิก'
  });
  if (!result.isConfirmed) return;
  try {
    const res = await fetch('/api/stock/clear-round', { method: 'POST', headers: authHeaders() });
    if (!res.ok) { toast('error', 'ไม่สำเร็จ'); return; }
    toast('success', 'ล้างข้อมูลรอบเรียบร้อย');
    loadSummaryStock();
  } catch { toast('error', 'เกิดข้อผิดพลาด'); }
}

/* ── Desktop scan (tab สแกนนับสต็อก บน Admin) ── */
async function submitDesktopScan() {
  const barcode      = document.getElementById('deskBarcode')?.value.trim();
  const qtyText      = document.getElementById('deskQty')?.value;
  const qty          = Number.parseInt(qtyText, 10);
  const locationCode = document.getElementById('deskLocation')?.value.trim();
  const targetLocationCode = document.getElementById('deskTargetLocation')?.value.trim();
  const type         = document.getElementById('deskMode')?.value || 'PICK';

  if (!barcode) { toast('warning', 'กรุณาสแกนหรือกรอกบาร์โค้ด'); return; }
  if (!Number.isInteger(qty) || qty < 0 || (type !== 'CHECK' && qty === 0)) { toast('warning', type === 'CHECK' ? 'จำนวนต้องเป็น 0 หรือมากกว่า' : 'จำนวนต้องมากกว่า 0'); return; }
  if (!locationCode) { toast('warning', 'กรุณาระบุตำแหน่งจัดเก็บ'); return; }
  if (['TRANSFER', 'PUTAWAY'].includes(type) && !targetLocationCode) { toast('warning', 'กรุณาระบุโลเคชั่นปลายทาง'); return; }

  try {
    const res  = await fetch('/api/transactions/execute', {
      method: 'POST', headers: authHeaders(),
      body: JSON.stringify({ barcode, quantity: qty, locationCode, targetLocationCode, type })
    });
    const data = await res.json();
    if (!res.ok) { toast('error', data.message || 'บันทึกไม่สำเร็จ'); return; }
    beepOK();
    const summary = type === 'CHECK'
      ? `${type} สำเร็จ — ${data.item?.ItemName || barcode}: ตรวจพบ ${qty}, ในระบบ ${data.stockQuantity ?? 0}`
      : `${type} สำเร็จ — ${data.item?.ItemName || barcode} x${qty}`;
    toast('success', summary);
    document.getElementById('deskBarcode').value = '';
    document.getElementById('deskQty').value = '1';
    document.getElementById('deskBarcode').focus();
  } catch { toast('error', 'เกิดข้อผิดพลาด'); }
}

/* Admin report: keep the existing Power User summary workflow unchanged. */
let adminReportRows = [];
let adminReportReady = false;
let adminReportLoading = false;
let adminReportPage = 1;
const reportEscape = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const reportNumber = value => Number.isFinite(Number(value)) ? Number(value) : 0;
const reportFormat = value => Number(value).toLocaleString('th-TH', {maximumFractionDigits: 3});
function adminReportFiltered() {
  const q = document.getElementById('reportSearch').value.trim().toLowerCase();
  const zone = document.getElementById('reportZone').value;
  const status = document.getElementById('reportStatus').value;
  return adminReportRows.filter(row => (!q || [row.code,row.barcode,row.name,row.thaiName,row.location].join(' ').toLowerCase().includes(q)) && (!zone || row.locations.some(loc => loc.toUpperCase().startsWith(zone))) && (!status || (status === 'available' ? row.qty > 0 : status === 'empty' ? row.qty <= 0 : row.min > 0 && row.qty < row.min)));
}
async function loadAdminStockReport() {
  if (adminReportLoading) return;
  adminReportLoading = true;
  document.getElementById('reportRefresh').disabled = true;
  ['reportPrev','reportNext'].forEach(id => document.getElementById(id).disabled = true);
  adminReportReady = false;
  document.getElementById('reportExport').disabled = true;
  const notice = document.getElementById('reportNotice');
  notice.className = 'small text-muted mb-3';
  notice.textContent = 'กำลังโหลดข้อมูลสต๊อก...';
  document.getElementById('stockTableBody').innerHTML = '<tr><td colspan="9" class="text-center py-5"><span class="spinner-border spinner-border-sm me-2"></span>กำลังโหลด...</td></tr>';
  try {
    const response = await fetch('/api/stock/balance', {headers: authHeaders(), signal: AbortSignal.timeout(20000)});
    if (response.status === 401) {
      throw new Error('เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่');
    }
    if (!response.ok) throw new Error(response.status === 404 ? 'บริการรายงานยังไม่พร้อมใช้งาน กรุณารีสตาร์ทเซิร์ฟเวอร์แล้วลองอีกครั้ง' : 'โหลดข้อมูลไม่สำเร็จ (HTTP ' + response.status + ')');
    const data = await response.json();
    const rows = Array.isArray(data) ? data : data.data;
    if (data.success === false || !Array.isArray(rows)) throw new Error('รูปแบบข้อมูลรายงานไม่ถูกต้อง');
    adminReportRows = rows.map(item => {
      const location = String(item.LocationDetails || item.LocationCode || '');
      return {id: item.ProductId, code: String(item.ItemCode || item.ProductCode || ''), barcode: String(item.Barcode || ''), name: String(item.ItemName || item.ProductName || ''), thaiName: String(item.ThaiName || ''), location, locations: location.split(',').map(loc => loc.replace(/\s*\([^)]*\)\s*$/, '').trim()).filter(loc => loc && loc !== 'N/A' && loc !== '-'), qty: reportNumber(item.TotalStock ?? item.Quantity), min: reportNumber(item.MinStock), unit: String(item.UOM || item.PackageType || ''), updated: item.LastUpdated || item.lastUpdated};
    });
    const products = new Map();
    adminReportRows.forEach(row => {const key = row.id ?? (row.code || row.barcode); const p = products.get(key) || {qty:0,min:row.min}; p.qty += row.qty; products.set(key,p);});
    document.getElementById('reportSku').textContent = reportFormat(products.size);
    document.getElementById('reportQty').textContent = reportFormat(adminReportRows.reduce((sum,row) => sum + row.qty,0));
    document.getElementById('reportLocations').textContent = reportFormat(new Set(adminReportRows.filter(row => row.qty > 0).flatMap(row => row.locations)).size);
    const hasMin = rows.every(row => row.MinStock != null);
    document.getElementById('reportLow').textContent = hasMin ? reportFormat([...products.values()].filter(p => p.min > 0 && p.qty < p.min).length) : '—';
    notice.textContent = hasMin ? 'ยอดรวมอาจประกอบด้วยสินค้าหลายหน่วยนับ กรุณาดูหน่วยในแต่ละรายการ' : 'ยังไม่มีข้อมูลเกณฑ์ Min สำหรับคำนวณ · ยอดรวมอาจมีหลายหน่วยนับ';
    document.getElementById('reportUpdated').textContent = 'โหลดล่าสุด: ' + new Date().toLocaleString('th-TH');
    adminReportReady = true;
    renderAdminStockReport();
  } catch (error) {
    adminReportRows = [];
    ['reportSku','reportQty','reportLocations','reportLow'].forEach(id => document.getElementById(id).textContent = '—');
    notice.className = 'small text-danger mb-3';
    notice.textContent = error.name === 'TimeoutError' ? 'การโหลดข้อมูลใช้เวลานานเกินไป กรุณาลองอีกครั้ง' : error.message;
    document.getElementById('stockTableBody').innerHTML = '<tr><td colspan="9" class="text-center py-5 text-danger">ไม่สามารถโหลดรายงานได้ กรุณาลองรีเฟรชอีกครั้ง</td></tr>';
    document.getElementById('reportCount').textContent = 'ไม่มีข้อมูลสำหรับแสดง';
    document.getElementById('reportUpdated').textContent = 'โหลดข้อมูลไม่สำเร็จ';
  } finally {adminReportLoading = false; document.getElementById('reportRefresh').disabled = false;}
}
function renderAdminStockReport(keepPage = false) {
  if (!adminReportReady) return;
  const rows = adminReportFiltered();
  if (!keepPage) adminReportPage = 1;
  const pageSize = Number(document.getElementById('reportPageSize').value) || 50;
  const pages = Math.max(1, Math.ceil(rows.length / pageSize));
  adminReportPage = Math.max(1, Math.min(adminReportPage, pages));
  const offset = (adminReportPage - 1) * pageSize;
  const visible = rows.slice(offset, offset + pageSize);
  document.getElementById('reportPrev').disabled = adminReportPage === 1;
  document.getElementById('reportNext').disabled = adminReportPage === pages;
  document.getElementById('reportPageInfo').textContent = 'หน้า ' + adminReportPage + ' / ' + pages;
  document.getElementById('reportExport').disabled = rows.length === 0;
  document.getElementById('reportCount').textContent = 'พบ ' + reportFormat(rows.length) + ' จาก ' + reportFormat(adminReportRows.length) + ' รายการ';
  document.getElementById('stockTableBody').innerHTML = rows.length ? visible.map((row,i) => {
    const status = row.qty <= 0 ? ['danger','หมดสต๊อก'] : row.min > 0 && row.qty < row.min ? ['warning','ต่ำกว่า Min'] : ['success','มีสินค้า'];
    const date = row.updated ? new Date(row.updated) : null;
    const time = date && !Number.isNaN(date.getTime()) ? date.toLocaleString('th-TH') : '—';
    return '<tr><td>' + (offset+i+1) + '</td><td><code>' + reportEscape(row.barcode || '—') + '</code></td><td class="fw-semibold">' + reportEscape(row.code || '—') + '</td><td>' + reportEscape(row.name || '—') + (row.thaiName && row.thaiName !== row.name ? '<div class="small text-muted">' + reportEscape(row.thaiName) + '</div>' : '') + '</td><td>' + reportEscape(row.location || 'ยังไม่มีตำแหน่งจัดเก็บ') + '</td><td class="text-end fw-bold">' + reportFormat(row.qty) + '</td><td>' + reportEscape(row.unit || '—') + '</td><td><span class="badge bg-' + status[0] + '-subtle text-' + status[0] + '">' + status[1] + '</span></td><td class="small text-muted">' + reportEscape(time) + '</td></tr>';
  }).join('') : '<tr><td colspan="9" class="text-center py-5 text-muted">' + (adminReportRows.length ? 'ไม่พบรายการตามตัวกรอง' : 'ไม่มีข้อมูลสต๊อก') + '</td></tr>';
}
function changeAdminStockPage(delta) {
  if (!adminReportReady) return;
  adminReportPage += delta;
  renderAdminStockReport(true);
}
function clearAdminStockFilters() {
  ['reportSearch','reportZone','reportStatus'].forEach(id => document.getElementById(id).value = '');
  renderAdminStockReport();
}
function exportAdminStockCsv() {
  if (!adminReportReady) return;
  const rows = adminReportFiltered();
  if (!rows.length) return;
  const cell = value => '"' + String(value ?? '').replace(/^(\s*[=+@-]|[\t\r\n])/, "'$&").replace(/"/g, '""') + '"';
  const records = [['บาร์โค้ด','รหัสสินค้า','ชื่อสินค้า','ตำแหน่งจัดเก็บ','ยอดคงเหลือ','หน่วย','Min','อัปเดตล่าสุด'], ...rows.map(row => [row.barcode,row.code,row.name,row.location,row.qty,row.unit,row.min,row.updated || ''])];
  const blob = new Blob(['\uFEFF' + records.map(row => row.map(cell).join(',')).join('\r\n')], {type:'text/csv;charset=utf-8;'});
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url; link.download = 'Stock_Report_' + new Date().toISOString().slice(0,10) + '.csv';
  document.body.appendChild(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url),1000);
}
