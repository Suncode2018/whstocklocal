/* ============================================================
   admin-locations.js — Locations Master Management
   ============================================================ */

let locationsList = [];
let editingLocationId = null;

async function loadLocationsMaster() {
  const tbody = document.getElementById('locationsTableBody');
  if (!tbody) return;
  tbody.innerHTML = `<tr><td colspan="6" class="text-center py-4 text-muted"><span class="spinner-border spinner-border-sm me-2"></span>กำลังโหลด...</td></tr>`;

  try {
    const res = await fetch('/api/locations', { headers: authHeaders() });
    const data = await res.json();
    if (!res.ok) throw new Error(data.message || 'โหลดข้อมูลไม่สำเร็จ');

    locationsList = data.data || [];
    renderLocationsTable(locationsList);
  } catch (err) {
    console.error(err);
    tbody.innerHTML = `<tr><td colspan="6" class="text-center py-4 text-danger">โหลดข้อมูลโลเคชั่นไม่สำเร็จ</td></tr>`;
  }
}

function renderLocationsTable(items) {
  const tbody = document.getElementById('locationsTableBody');
  if (!tbody) return;

  // ✅ แก้ไขให้ตรวจสอบ items.length ให้ถูกต้อง
  if (!items || items.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" class="text-center py-4 text-muted">ไม่พบข้อมูลโลเคชั่น</td></tr>`;
    return;
  }

  tbody.innerHTML = items.map((loc, idx) => `
    <tr>
      <td>${idx + 1}</td>
      <td><strong>${loc.LocationCode}</strong></td>
      <td><span class="badge bg-secondary">${loc.Zone || '-'}</span></td>
      <td>${loc.Description || '-'}</td>
      <td>
        <span class="badge bg-${loc.IsActive ? 'success' : 'danger'}">
          ${loc.IsActive ? 'Active' : 'Inactive'}
        </span>
      </td>
      <td>
        <button class="btn btn-sm btn-outline-primary me-1" onclick="openEditLocation(${loc.LocationId})"><i class="bi bi-pencil"></i></button>
        <button class="btn btn-sm btn-outline-danger" onclick="deleteLocation(${loc.LocationId}, '${loc.LocationCode}')"><i class="bi bi-trash"></i></button>
      </td>
    </tr>
  `).join('');
}

function openAddLocation() {
  editingLocationId = null;
  document.getElementById('locModalTitle').textContent = 'เพิ่มโลเคชั่นใหม่';
  document.getElementById('modalLocCode').value = '';
  document.getElementById('modalLocCode').disabled = false;
  document.getElementById('modalLocZone').value = '';
  document.getElementById('modalLocDesc').value = '';
  document.getElementById('modalLocStatus').value = '1';

  new bootstrap.Modal(document.getElementById('locationModal')).show();
}

async function openEditLocation(id) {
  const loc = locationsList.find(l => l.LocationId === id);
  if (!loc) return;

  editingLocationId = id;
  document.getElementById('locModalTitle').textContent = 'แก้ไขโลเคชั่น';
  document.getElementById('modalLocCode').value = loc.LocationCode;
  document.getElementById('modalLocCode').disabled = true; // ห้ามแก้รหัสหลัก
  document.getElementById('modalLocZone').value = loc.Zone || '';
  document.getElementById('modalLocDesc').value = loc.Description || '';
  document.getElementById('modalLocStatus').value = loc.IsActive ? '1' : '0';

  new bootstrap.Modal(document.getElementById('locationModal')).show();
}

async function saveLocation() {
  const code = document.getElementById('modalLocCode').value.trim();
  const zone = document.getElementById('modalLocZone').value.trim();
  const desc = document.getElementById('modalLocDesc').value.trim();
  const isActive = document.getElementById('modalLocStatus').value === '1';

  if (!code && !editingLocationId) {
    Swal.fire('แจ้งเตือน', 'กรุณากรอกรหัสโลเคชั่น', 'warning');
    return;
  }

  const url = editingLocationId ? `/api/locations/${editingLocationId}` : '/api/locations';
  const method = editingLocationId ? 'PUT' : 'POST';

  try {
    const res = await fetch(url, {
      method: method,
      headers: authHeaders(),
      body: JSON.stringify({ code, zone, desc, isActive })
    });
    const data = await res.json();

    if (!res.ok) throw new Error(data.message || 'บันทึกไม่สำเร็จ');

    Swal.fire({ title: 'สำเร็จ', text: data.message, icon: 'success', timer: 1500, showConfirmButton: false });
    bootstrap.Modal.getInstance(document.getElementById('locationModal')).hide();
    loadLocationsMaster();
  } catch (err) {
    Swal.fire('Error', err.message, 'error');
  }
}

async function deleteLocation(id, code) {
  const r = await Swal.fire({
    title: `ลบโลเคชั่น [${code}]?`,
    text: 'การกระทำนี้ไม่สามารถย้อนกลับได้',
    icon: 'warning',
    showCancelButton: true,
    confirmButtonColor: '#ef4444',
    confirmButtonText: 'ลบ',
    cancelButtonText: 'ยกเลิก'
  });

  if (!r.isConfirmed) return;

  try {
    const res = await fetch(`/api/locations/${id}`, { method: 'DELETE', headers: authHeaders() });
    const data = await res.json();
    if (!res.ok) throw new Error(data.message || 'ลบไม่สำเร็จ');

    Swal.fire({ title: 'สำเร็จ', text: data.message, icon: 'success', timer: 1500, showConfirmButton: false });
    loadLocationsMaster();
  } catch (err) {
    Swal.fire('Error', err.message, 'error');
  }
}