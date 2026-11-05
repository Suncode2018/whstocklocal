/* ============================================================
   admin-locations.js — จัดการข้อมูลโลเคชั่นเชื่อมโยงกับคลังสินค้า (tblWH)
   ============================================================ */

let editingLocationId = null;
let warehousesCache = [];

// ฟังก์ชัน Fetch แบบปลอดภัย (ลองทั้ง 2 Path กรณีตั้ง Route ต่างกัน)
async function fetchSafeLocations() {
  const headers = typeof authHeaders === 'function' ? authHeaders() : {};
  let res = await fetch('/api/master/locations', { headers });
  if (!res.ok) {
    res = await fetch('/api/locations', { headers });
  }
  return res;
}

// 1. โหลดรายชื่อคลังสินค้า
async function loadWarehouseDropdowns() {
  try {
    const res = await fetch('/api/warehouses', { headers: typeof authHeaders === 'function' ? authHeaders() : {} });
    if (!res.ok) return;
    warehousesCache = await res.json();

    const filterSelect = document.getElementById('locWarehouseFilter');
    if (filterSelect) {
      const cur = filterSelect.value;
      filterSelect.innerHTML = '<option value="">ทุกคลังสินค้า (All Warehouses)</option>' + 
        warehousesCache.map(w => `<option value="${w.whid}">${w.whname} — ${w.whdescription || ''}</option>`).join('');
      filterSelect.value = cur;
    }

    const modalSelect = document.getElementById('modalLocWhId');
    if (modalSelect) {
      modalSelect.innerHTML = warehousesCache.map(w => `<option value="${w.whid}">${w.whname} — ${w.whdescription || ''}</option>`).join('');
    }
  } catch (err) {
    console.warn('โหลดรายชื่อคลังสินค้าไม่สำเร็จ:', err);
  }
}

// 2. ดึงรายการ Locations ทั้งหมด
async function loadLocationsMaster(showToast = false) {
  const tbody = document.getElementById('locationsTableBody');
  if (!tbody) return;

  tbody.innerHTML = `<tr><td colspan="9" class="text-center py-4 text-muted"><span class="spinner-border spinner-border-sm me-2 text-primary"></span>กำลังโหลดข้อมูลโลเคชั่น...</td></tr>`;

  await loadWarehouseDropdowns();

  try {
    const res = await fetchSafeLocations();
    if (!res.ok) throw new Error('API เส้นทาง locations ไม่ตอบสนอง (HTTP ' + res.status + ')');
    const data = await res.json();
    const locations = Array.isArray(data) ? data : (data.data || []);

    if (locations.length === 0) {
      tbody.innerHTML = `<tr><td colspan="9" class="text-center py-4 text-muted">ยังไม่มีข้อมูลโลเคชั่นในระบบ</td></tr>`;
      return;
    }

    tbody.innerHTML = locations.map((loc, index) => {
      const id = loc.LocationId || loc.id;
      const whName = loc.whname || warehousesCache.find(w => w.whid === loc.whid)?.whname || `WH-${loc.whid || 1}`;
      const code = loc.LocationCode || '-';
      const zone = loc.Zone || '-';
      const desc = loc.Description || '-';
      const isActive = loc.IsActive !== false && loc.IsActive !== 0;

      const w = loc.CapacityWidthCm ? parseFloat(loc.CapacityWidthCm) : 0;
      const l = loc.CapacityLengthCm ? parseFloat(loc.CapacityLengthCm) : 0;
      const h = loc.CapacityHeightCm ? parseFloat(loc.CapacityHeightCm) : 0;
      const vol = loc.CapacityVolumeCm3 ? parseFloat(loc.CapacityVolumeCm3).toLocaleString() : (w * l * h > 0 ? (w * l * h).toLocaleString() : '-');

      const statusBadge = isActive 
        ? `<span class="badge bg-success">Active</span>` 
        : `<span class="badge bg-secondary">Inactive</span>`;

      const locDataStr = JSON.stringify(loc).replace(/'/g, "&apos;");

      return `
        <tr data-whid="${loc.whid || ''}">
          <td class="text-center text-muted fw-semibold">${index + 1}</td>
          <td><span class="badge bg-secondary-subtle text-dark border">${whName}</span></td>
          <td><strong class="text-indigo font-monospace fs-6">${code}</strong></td>
          <td><span class="badge bg-light text-dark border">${zone}</span></td>
          <td><span class="small">${vol} cm³</span></td>
          <td><span class="text-muted small">${w && l && h ? `${w}×${l}×${h} cm` : '-'}</span></td>
          <td>${desc}</td>
          <td>${statusBadge}</td>
          <td class="text-end">
            <button class="btn btn-sm btn-outline-primary border-0 me-1" onclick='openEditLocation(${locDataStr})' title="แก้ไข">
              <i class="bi bi-pencil-square fs-6"></i>
            </button>
            <button class="btn btn-sm btn-outline-danger border-0" onclick="deleteLocation(${id})" title="ลบ">
              <i class="bi bi-trash fs-6"></i>
            </button>
          </td>
        </tr>
      `;
    }).join('');

    if (showToast && typeof Swal !== 'undefined') {
      Swal.fire({ icon: 'success', title: 'รีเฟรชข้อมูลเรียบร้อย', timer: 1000, showConfirmButton: false });
    }
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="9" class="text-center py-4 text-danger">เกิดข้อผิดพลาด: ${err.message}</td></tr>`;
  }
}

// 3. กรองตาราง
function filterLocationTable() {
  const q = (document.getElementById('locSearchInput')?.value || '').trim().toLowerCase();
  const whFilter = document.getElementById('locWarehouseFilter')?.value || '';

  document.querySelectorAll('#locationsTableBody tr').forEach(tr => {
    const rowWhId = tr.getAttribute('data-whid') || '';
    const matchWh = !whFilter || rowWhId === whFilter;
    const matchQ = !q || tr.textContent.toLowerCase().includes(q);
    tr.style.display = (matchWh && matchQ) ? '' : 'none';
  });
}

// 4. Modal จัดการ Location
function openAddLocation() {
  editingLocationId = null;
  document.getElementById('locModalTitle').textContent = 'เพิ่มโลเคชั่นใหม่';
  if (warehousesCache.length > 0) document.getElementById('modalLocWhId').value = warehousesCache[0].whid;
  document.getElementById('modalLocCode').value = '';
  document.getElementById('modalLocZone').value = '';
  document.getElementById('modalLocDesc').value = '';
  document.getElementById('modalLocWidth').value = '';
  document.getElementById('modalLocLength').value = '';
  document.getElementById('modalLocHeight').value = '';
  document.getElementById('modalLocStatus').value = '1';
  new bootstrap.Modal(document.getElementById('locModal')).show();
}

function openEditLocation(loc) {
  editingLocationId = loc.LocationId || loc.id;
  document.getElementById('locModalTitle').textContent = 'แก้ไขโลเคชั่น: ' + (loc.LocationCode || '');
  document.getElementById('modalLocWhId').value = loc.whid || (warehousesCache[0]?.whid || 1);
  document.getElementById('modalLocCode').value = loc.LocationCode || '';
  document.getElementById('modalLocZone').value = loc.Zone || '';
  document.getElementById('modalLocDesc').value = loc.Description || '';
  document.getElementById('modalLocWidth').value = loc.CapacityWidthCm || '';
  document.getElementById('modalLocLength').value = loc.CapacityLengthCm || '';
  document.getElementById('modalLocHeight').value = loc.CapacityHeightCm || '';
  document.getElementById('modalLocStatus').value = (loc.IsActive === false || loc.IsActive === 0) ? '0' : '1';
  new bootstrap.Modal(document.getElementById('locModal')).show();
}

async function saveLocation() {
  const whid = parseInt(document.getElementById('modalLocWhId').value, 10);
  const locationCode = document.getElementById('modalLocCode').value.trim().toUpperCase();
  const zone = document.getElementById('modalLocZone').value.trim().toUpperCase();
  const description = document.getElementById('modalLocDesc').value.trim();
  const isActive = document.getElementById('modalLocStatus').value === '1';

  const w = parseFloat(document.getElementById('modalLocWidth').value) || null;
  const l = parseFloat(document.getElementById('modalLocLength').value) || null;
  const h = parseFloat(document.getElementById('modalLocHeight').value) || null;

  if (!whid || !locationCode || !zone) {
    Swal.fire('แจ้งเตือน', 'กรุณาระบุคลังสินค้า, รหัสโลเคชั่น และโซน', 'warning');
    return;
  }

  if ((w || l || h) && (!w || !l || !h || w <= 0 || l <= 0 || h <= 0)) {
    Swal.fire('แจ้งเตือน', 'หากระบุมิติความจุ ต้องระบุทั้ง กว้าง, ยาว, สูง และต้องมากกว่า 0', 'warning');
    return;
  }

  const payload = {
    whid,
    locationCode,
    zone,
    description,
    isActive,
    capacityWidthCm: w,
    capacityLengthCm: l,
    capacityHeightCm: h,
    capacityVolumeCm3: (w && l && h) ? (w * l * h) : null
  };

  // ใช้ Path ตรงตามที่ระบบเปิดไว้
  const baseUrl = '/api/master/locations';
  const url = editingLocationId ? `${baseUrl}/${editingLocationId}` : baseUrl;
  const method = editingLocationId ? 'PUT' : 'POST';

  try {
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json', ...(typeof authHeaders === 'function' ? authHeaders() : {}) },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'บันทึกไม่สำเร็จ');

    bootstrap.Modal.getInstance(document.getElementById('locModal')).hide();
    Swal.fire({ icon: 'success', title: 'บันทึกสำเร็จ', timer: 1500, showConfirmButton: false });
    loadLocationsMaster();
  } catch (err) {
    Swal.fire('ผิดพลาด', err.message, 'error');
  }
}

async function deleteLocation(id) {
  const confirm = await Swal.fire({
    title: 'ยืนยันการลบ?',
    text: 'ต้องการลบโลเคชั่นนี้ใช่หรือไม่',
    icon: 'warning',
    showCancelButton: true,
    confirmButtonColor: '#ef4444',
    confirmButtonText: 'ลบ',
    cancelButtonText: 'ยกเลิก'
  });

  if (!confirm.isConfirmed) return;

  try {
    const res = await fetch(`/api/master/locations/${id}`, {
      method: 'DELETE',
      headers: typeof authHeaders === 'function' ? authHeaders() : {}
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'ลบไม่สำเร็จ');

    Swal.fire({ icon: 'success', title: 'ลบเรียบร้อย', timer: 1500, showConfirmButton: false });
    loadLocationsMaster();
  } catch (err) {
    Swal.fire('ผิดพลาด', err.message, 'error');
  }
}