/* Cycle Count UI shared by Admin and Power User */
let cycleCountSessions = [];
let cycleCountLocations = [];
let selectedCycleCountId = null;

const cycleEsc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

async function cycleApi(path, options = {}) {
  const response = await fetch(`/api/cycle-counts${path}`, {
    ...options,
    headers: { ...authHeaders(), ...(options.headers || {}) }
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.message || 'ทำรายการ Cycle Count ไม่สำเร็จ');
  return payload;
}

async function loadCycleCounts() {
  const tbody = document.getElementById('cycleCountTableBody');
  if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="9" class="text-center py-4 text-muted">กำลังโหลดรอบตรวจนับ...</td></tr>';
  try {
    const payload = await cycleApi('');
    cycleCountSessions = payload.data || [];
    const role = JSON.parse(localStorage.getItem('user') || '{}').role;
    const workArea = document.getElementById('cycleCountWorkArea');

    if (role === 'ADMIN') {
      tbody.innerHTML = cycleCountSessions.length ? cycleCountSessions.map(s => `
        <tr>
          <td><code>${cycleEsc(s.SessionCode)}</code></td><td>${cycleEsc(s.SessionName)}</td>
          <td>${cycleEsc(s.ScopeType === 'ZONE' ? 'โซน' : 'โลเคชั่น')} ${cycleEsc(s.ScopeValue)}</td>
          <td>${Number(s.CountedItems || 0)} / ${Number(s.TotalItems || 0)}</td>
          <td>${Number(s.VarianceItems || 0)} รายการ</td>
          <td><span class="badge ${s.Status === 'OPEN' ? 'bg-warning text-dark' : s.Status === 'EXPIRED' ? 'bg-secondary' : 'bg-success'}">${s.Status === 'OPEN' ? 'กำลังตรวจ' : s.Status === 'EXPIRED' ? 'หมดอายุ' : 'ปิดรอบแล้ว'}</span></td>
          <td>${s.ExpiresAt ? new Date(s.ExpiresAt).toLocaleString('th-TH') : '-'}</td>
          <td>${cycleEsc(s.CreatedByName)}</td>
          <td class="text-nowrap"><button class="btn btn-sm btn-outline-primary" onclick="viewCycleCount(${s.SessionId})">ดูผล</button> ${s.Status === 'OPEN' ? `<button class="btn btn-sm btn-outline-danger" onclick="closeCycleCount(${s.SessionId})">ปิดรอบ</button>` : ''}</td>
        </tr>`).join('') : '<tr><td colspan="9" class="text-center py-4 text-muted">ยังไม่มีรอบตรวจนับ กด “เริ่มรอบตรวจนับ” เพื่อสร้างรอบแรก</td></tr>';
      if (workArea) workArea.innerHTML = '';
      return;
    }

    const openSessions = cycleCountSessions.filter(s => s.Status === 'OPEN');
    if (workArea) {
      workArea.innerHTML = openSessions.length ? `
        <div class="border rounded-3 p-3 bg-light">
          <div class="row g-2 align-items-end">
            <div class="col-lg-4"><label class="form-label-wms" for="cycleSessionSelect">รอบที่กำลังตรวจ</label><select id="cycleSessionSelect" class="form-select form-control-wms" onchange="selectCycleCount(this.value)">${openSessions.map(s => `<option value="${s.SessionId}" ${Number(s.SessionId) === Number(selectedCycleCountId || openSessions[0].SessionId) ? 'selected' : ''}>${cycleEsc(s.SessionCode)} · ${cycleEsc(s.SessionName)} (${cycleEsc(s.ScopeValue)})</option>`).join('')}</select></div>
            <div class="col-lg-2"><label class="form-label-wms" for="cycleBarcode">สแกนบาร์โค้ด</label><input id="cycleBarcode" class="form-control form-control-wms" autocomplete="off" placeholder="บาร์โค้ดสินค้า"></div>
            <div class="col-lg-2"><label class="form-label-wms" for="cycleLocation">โลเคชั่น</label><input id="cycleLocation" class="form-control form-control-wms" autocomplete="off" placeholder="A-01-01"></div>
            <div class="col-lg-2"><label class="form-label-wms" for="cycleQty">ยอดนับจริง</label><input id="cycleQty" type="number" min="0" inputmode="numeric" class="form-control form-control-wms" value="1"></div>
            <div class="col-lg-2"><button class="btn btn-indigo w-100" onclick="submitCycleCount()"><i class="bi bi-check2-circle me-1"></i>บันทึกผลนับ</button></div>
          </div>
          <div class="hint">สแกนสินค้าแล้วระบุโลเคชั่นและยอดจริง จากนั้นกดบันทึก ระบบจะคำนวณผลต่างจากยอด ณ เวลาเริ่มรอบ</div>
        </div>` : '<div class="alert alert-info">ยังไม่มีรอบเปิดสำหรับตรวจนับ ให้ Admin เริ่มรอบก่อน</div>';
    }
    if (openSessions.length) {
      if (!openSessions.some(s => Number(s.SessionId) === Number(selectedCycleCountId))) {
        selectedCycleCountId = Number(openSessions[0].SessionId);
      }
      await viewCycleCount(selectedCycleCountId);
      const barcode = document.getElementById('cycleBarcode');
      if (barcode) barcode.focus();
    } else {
      tbody.innerHTML = cycleCountSessions.length ? '<tr><td colspan="7" class="text-center py-4 text-muted">ไม่มีรอบที่เปิดอยู่</td></tr>' : '<tr><td colspan="7" class="text-center py-4 text-muted">ยังไม่มีรอบตรวจนับ</td></tr>';
    }
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="8" class="text-center text-danger py-4">${cycleEsc(err.message)}</td></tr>`;
  }
}

async function openCycleCountSession() {
  try {
    const locationRes = await fetch('/api/locations', { headers: authHeaders() });
    const locationResponse = await locationRes.json();
    if (!locationRes.ok) throw new Error(locationResponse.message || 'โหลดโลเคชั่นไม่สำเร็จ');
    cycleCountLocations = locationResponse.data || locationResponse || [];
    const active = cycleCountLocations.filter(l => l.IsActive !== false && l.IsActive !== 0);
    const zones = [...new Set(active.map(l => l.Zone).filter(Boolean))];
    if (!active.length) throw new Error('ไม่พบโลเคชั่นที่เปิดใช้งาน');
    const result = await Swal.fire({
      title: 'เริ่มรอบตรวจนับ',
      html: `<div class="text-start mb-3"><label class="form-label-wms">ชื่อรอบ</label><input id="cc-name" class="form-control" placeholder="เช่น Cycle Count ประจำเดือน"></div>
        <div class="text-start mb-3"><label class="form-label-wms">ขอบเขตการตรวจ</label><select id="cc-scope-type" class="form-select" onchange="updateCycleScopeOptions()"><option value="ZONE">ทั้งโซน</option><option value="LOCATION">โลเคชั่นเดียว</option></select></div>
        <div class="text-start"><label class="form-label-wms">เลือกโซน / โลเคชั่น</label><select id="cc-scope-value" class="form-select">${zones.map(z => `<option value="${cycleEsc(z)}">${cycleEsc(z)}</option>`).join('')}</select></div>
        <div class="alert alert-warning text-start small mt-3 mb-0">รอบมีอายุ 24 ชั่วโมงนับจากเวลาสร้าง ระบบจะบันทึกยอดคงเหลือเป็นยอดคาดหมาย การปิดรอบจะปรับยอดสต็อกตามผลตรวจนับ</div>`,
      showCancelButton: true, confirmButtonText: 'เริ่มรอบ', cancelButtonText: 'ยกเลิก', confirmButtonColor: '#4f46e5',
      didOpen: () => { window.updateCycleScopeOptions = updateCycleScopeOptions; },
      preConfirm: () => {
        const sessionName = document.getElementById('cc-name').value.trim();
        if (!sessionName) return Swal.showValidationMessage('กรุณาตั้งชื่อรอบตรวจนับ');
        return { sessionName, scopeType: document.getElementById('cc-scope-type').value, scopeValue: document.getElementById('cc-scope-value').value };
      }
    });
    if (!result.isConfirmed) return;
    const created = await cycleApi('', { method: 'POST', body: JSON.stringify(result.value) });
    await Swal.fire({ icon: 'success', title: 'เริ่มรอบแล้ว', text: created.sessionCode, timer: 1400, showConfirmButton: false });
    loadCycleCounts();
  } catch (err) { Swal.fire({ icon: 'error', title: 'เริ่มรอบไม่สำเร็จ', text: err.message }); }
}

function updateCycleScopeOptions() {
  const type = document.getElementById('cc-scope-type')?.value;
  const select = document.getElementById('cc-scope-value');
  if (!select) return;
  const active = cycleCountLocations.filter(l => l.IsActive !== false && l.IsActive !== 0);
  const values = type === 'ZONE' ? [...new Set(active.map(l => l.Zone).filter(Boolean))] : active.map(l => l.LocationCode);
  select.innerHTML = values.map(value => `<option value="${cycleEsc(value)}">${cycleEsc(value)}</option>`).join('');
}

async function selectCycleCount(id) { selectedCycleCountId = Number(id); await viewCycleCount(selectedCycleCountId); }

async function viewCycleCount(id) {
  selectedCycleCountId = Number(id);
  const role = JSON.parse(localStorage.getItem('user') || '{}').role;
  const tbody = document.getElementById('cycleCountTableBody');
  if (!tbody) return;
  try {
    const payload = await cycleApi(`/${id}/items`);
    const items = payload.data || [];
    if (!items.length) {
      tbody.innerHTML = `<tr><td colspan="${role === 'ADMIN' ? 8 : 7}" class="text-center py-4 text-muted">รอบนี้ไม่มีรายการตรวจนับ</td></tr>`;
      return;
    }
    if (role === 'ADMIN') {
      // Keep admin on the session summary. Detailed result is shown in a dialog.
      const session = cycleCountSessions.find(s => Number(s.SessionId) === Number(id));
      Swal.fire({ title: cycleEsc(session?.SessionName || 'ผลตรวจนับ'), width: 1000, html: `<div class="table-responsive"><table class="table table-sm"><thead><tr><th>บาร์โค้ด</th><th>สินค้า</th><th>โลเคชั่น</th><th>คาดหมาย</th><th>ตรวจนับ</th><th>ผลต่าง</th><th>ผู้ตรวจ</th></tr></thead><tbody>${items.map(i => `<tr><td>${cycleEsc(i.Barcode)}</td><td>${cycleEsc(i.ItemName)}</td><td>${cycleEsc(i.LocationCode)}</td><td>${i.ExpectedQuantity}</td><td>${i.CountedQuantity ?? 'รอตรวจ'}</td><td>${i.Variance ?? '-'}</td><td>${cycleEsc(i.CountedByName || '-')}</td></tr>`).join('')}</tbody></table></div>`, confirmButtonText: 'ปิด' });
      return;
    }
    tbody.innerHTML = items.map(i => `<tr><td><code>${cycleEsc(i.Barcode)}</code></td><td><strong>${cycleEsc(i.ItemCode)}</strong><div>${cycleEsc(i.ItemName)}</div></td><td>${cycleEsc(i.LocationCode)}</td><td>${i.ExpectedQuantity} ${cycleEsc(i.UOM)}</td><td>${i.CountedQuantity ?? '<span class="text-muted">รอตรวจ</span>'}</td><td>${i.Variance == null ? '-' : `<span class="badge ${i.Variance === 0 ? 'bg-success' : 'bg-danger'}">${i.Variance > 0 ? '+' : ''}${i.Variance}</span>`}</td><td>${cycleEsc(i.CountedByName || '-')}<div class="small text-muted">${i.CountedAt ? new Date(i.CountedAt).toLocaleString('th-TH') : ''}</div></td></tr>`).join('');
  } catch (err) { tbody.innerHTML = `<tr><td colspan="8" class="text-center text-danger py-4">${cycleEsc(err.message)}</td></tr>`; }
}

async function submitCycleCount() {
  const barcodeInput = document.getElementById('cycleBarcode');
  const locationInput = document.getElementById('cycleLocation');
  const qtyInput = document.getElementById('cycleQty');
  const barcode = barcodeInput?.value.trim();
  const locationCode = locationInput?.value.trim().toUpperCase();
  const countedQuantity = Number.parseInt(qtyInput?.value, 10);
  if (!selectedCycleCountId || !barcode || !locationCode || !Number.isInteger(countedQuantity) || countedQuantity < 0) {
    return Swal.fire({ icon: 'warning', title: 'ข้อมูลไม่ครบ', text: 'กรุณาสแกนสินค้า ระบุโลเคชั่น และยอดนับจริง (ใส่ 0 ได้)' });
  }
  try {
    const result = await cycleApi(`/${selectedCycleCountId}/count`, { method: 'POST', body: JSON.stringify({ barcode, locationCode, countedQuantity }) });
    barcodeInput.value = '';
    qtyInput.value = '1';
    await loadCycleCounts();
    const nextBarcode = document.getElementById('cycleBarcode');
    if (nextBarcode) nextBarcode.focus();
    if (window.toast) toast('success', result.message);
  } catch (err) { Swal.fire({ icon: 'error', title: 'บันทึกไม่สำเร็จ', text: err.message }); }
}

async function closeCycleCount(id) {
  const result = await Swal.fire({ title: 'ปิดรอบตรวจนับ?', text: 'ยอดคงเหลือจะถูกปรับเป็นยอดตรวจนับ ระบบปิดรอบไม่ได้หากยังมีรายการที่รอตรวจ', icon: 'warning', showCancelButton: true, confirmButtonText: 'ปิดรอบและปรับสต็อก', cancelButtonText: 'ยกเลิก', confirmButtonColor: '#dc2626' });
  if (!result.isConfirmed) return;
  try {
    const response = await cycleApi(`/${id}/close`, { method: 'POST' });
    await Swal.fire({ icon: 'success', title: 'รอบปิดแล้ว', text: response.message });
    loadCycleCounts();
  } catch (err) { Swal.fire({ icon: 'error', title: 'ปิดรอบไม่สำเร็จ', text: err.message }); }
}

document.addEventListener('keydown', event => {
  if (event.key === 'Enter' && event.target?.id === 'cycleQty') {
    event.preventDefault();
    submitCycleCount();
  }
});
