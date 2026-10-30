/* ============================================================
   admin-stock.js — Stock summary & export
   ============================================================ */

let stockAutoRefreshTimer = null;

async function loadSummaryStock(isSilent = false) {
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
  const qty          = parseInt(document.getElementById('deskQty')?.value) || 0;
  const locationCode = document.getElementById('deskLocation')?.value.trim();
  const type         = document.getElementById('deskMode')?.value || 'RECEIVE';

  if (!barcode) { toast('warning', 'กรุณาสแกนหรือกรอกบาร์โค้ด'); return; }
  if (qty <= 0) { toast('warning', 'จำนวนต้องมากกว่า 0'); return; }
  if (!locationCode) { toast('warning', 'กรุณาระบุตำแหน่งจัดเก็บ'); return; }

  try {
    const res  = await fetch('/api/transactions/execute', {
      method: 'POST', headers: authHeaders(),
      body: JSON.stringify({ barcode, quantity: qty, locationCode, type })
    });
    const data = await res.json();
    if (!res.ok) { toast('error', data.message || 'บันทึกไม่สำเร็จ'); return; }
    beepOK();
    toast('success', `${type} สำเร็จ — ${data.item?.ItemName || barcode} x${qty}`);
    document.getElementById('deskBarcode').value = '';
    document.getElementById('deskQty').value = '1';
    document.getElementById('deskBarcode').focus();
  } catch { toast('error', 'เกิดข้อผิดพลาด'); }
}