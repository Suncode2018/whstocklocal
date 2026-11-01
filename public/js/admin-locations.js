/* ============================================================
   admin-locations.js — จัดการข้อมูลโลเคชั่น (Locations Master)
   ============================================================ */

let editingLocationId = null;

async function loadLocationsMaster() {
  const tbody = document.getElementById('locationsTableBody');
  if (!tbody) return;

  tbody.innerHTML = `<tr><td colspan="6" class="text-center py-4 text-muted"><span class="spinner-border spinner-border-sm me-2"></span>กำลังโหลด...</td></tr>`;

  try {
    const res = await fetch('/api/locations', { headers: authHeaders() });
    if (!res.ok) throw new Error('Failed to fetch locations');
    const payload = await res.json();
    const locations = Array.isArray(payload) ? payload : (Array.isArray(payload.data) ? payload.data : []);

    if (!Array.isArray(locations) || locations.length === 0) {
      tbody.innerHTML = `<tr><td colspan="6" class="text-center py-4 text-muted">ไม่พบข้อมูลโลเคชั่นในระบบ</td></tr>`;
      return;
    }

    // ตรวจสอบสิทธิ์: เฉพาะ ADMIN เท่านั้นที่จะแสดงปุ่มลบ
    const currentUser = JSON.parse(localStorage.getItem('user') || '{}');
    const isAdmin = currentUser.role === 'ADMIN';

    tbody.innerHTML = locations.map((loc, index) => {
      const locId = loc.LocationId || loc.Id;
      const locationCode = loc.LocationCode || loc.Code || '';
      const description = loc.Description || loc.Desc || '-';
      const statusBadge = loc.IsActive !== false && loc.IsActive !== 0
        ? '<span class="badge bg-success">Active</span>'
        : '<span class="badge bg-secondary">Inactive</span>';

      const deleteButton = isAdmin
        ? `<button class="btn btn-sm btn-outline-danger" onclick="deleteLocation(${locId})"><i class="bi bi-trash"></i></button>`
        : '';

      return `
        <tr>
          <td>${index + 1}</td>
          <td><strong class="text-dark">${locationCode}</strong></td>
          <td>${loc.Zone || '-'}</td>
          <td>${description}</td>
          <td>${statusBadge}</td>
          <td>
            <button class="btn btn-sm btn-outline-primary me-1" onclick='openEditLocation(${JSON.stringify(loc)})'><i class="bi bi-pencil"></i></button>
            ${deleteButton}
          </td>
        </tr>
      `;
    }).join('');
  } catch (err) {
    console.error('loadLocationsMaster Error:', err);
    tbody.innerHTML = `<tr><td colspan="6" class="text-center py-4 text-danger">โหลดข้อมูลไม่สำเร็จ</td></tr>`;
  }
}

function openAddLocation() {
  editingLocationId = null;
  let modalEl = document.getElementById('locationModal');
  if (!modalEl) { createLocationModalDOM(); modalEl = document.getElementById('locationModal'); }

  document.getElementById('locationModalTitle').textContent = 'เพิ่มโลเคชั่นใหม่';
  document.getElementById('modalLocationCode').value = '';
  document.getElementById('modalLocationCode').disabled = false;
  document.getElementById('modalLocationZone').value = '';
  document.getElementById('modalLocationDesc').value = '';
  document.getElementById('modalLocationStatus').value = '1';

  new bootstrap.Modal(modalEl).show();
}

function openEditLocation(loc) {
  editingLocationId = loc.LocationId || loc.Id;
  let modalEl = document.getElementById('locationModal');
  if (!modalEl) { createLocationModalDOM(); modalEl = document.getElementById('locationModal'); }

  document.getElementById('locationModalTitle').textContent = 'แก้ไขโลเคชั่น: ' + (loc.LocationCode || loc.Code);
  document.getElementById('modalLocationCode').value = loc.LocationCode || loc.Code || '';
  document.getElementById('modalLocationCode').disabled = true;
  document.getElementById('modalLocationZone').value = loc.Zone || '';
  document.getElementById('modalLocationDesc').value = loc.Description || '';
  document.getElementById('modalLocationStatus').value = (loc.IsActive !== false && loc.IsActive !== 0) ? '1' : '0';

  new bootstrap.Modal(modalEl).show();
}

async function saveLocation() {
  const code = document.getElementById('modalLocationCode').value.trim();
  const zone = document.getElementById('modalLocationZone').value.trim();
  const description = document.getElementById('modalLocationDesc').value.trim();
  const isActive = document.getElementById('modalLocationStatus').value === '1';

  if (!code) {
    Swal.fire('แจ้งเตือน', 'กรุณากรอกรหัสโลเคชั่น', 'warning');
    return;
  }

  const url = editingLocationId ? `/api/locations/${editingLocationId}` : '/api/locations';
  const method = editingLocationId ? 'PUT' : 'POST';

  try {
    const res = await fetch(url, {
      method: method,
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ locationCode: code, zone, description, desc: description, isActive })
    });
    const data = await res.json();

    if (!res.ok) {
      Swal.fire('ผิดพลาด', data.error || 'บันทึกไม่สำเร็จ', 'error');
      return;
    }

    const modalEl = document.getElementById('locationModal');
    if (modalEl) {
      const modalInstance = bootstrap.Modal.getInstance(modalEl);
      if (modalInstance) modalInstance.hide();
    }

    Swal.fire({ icon: 'success', title: 'บันทึกสำเร็จ', timer: 1500, showConfirmButton: false });
    loadLocationsMaster();
  } catch (err) {
    console.error('saveLocation Error:', err);
    Swal.fire('ผิดพลาด', 'เกิดข้อผิดพลาดในการเชื่อมต่อ', 'error');
  }
}

async function deleteLocation(id) {
  const currentUser = JSON.parse(localStorage.getItem('user') || '{}');
  if (currentUser.role !== 'ADMIN') {
    Swal.fire('ไม่มีสิทธิ์', 'เฉพาะผู้ดูแลระบบ (Admin) เท่านั้นที่สามารถลบข้อมูลได้', 'warning');
    return;
  }

  const r = await Swal.fire({
    title: 'ยืนยันการลบ?', text: 'คุณต้องการลบโลเคชั่นนี้ใช่หรือไม่',
    icon: 'warning', showCancelButton: true,
    confirmButtonColor: '#ef4444', cancelButtonColor: '#6b7280',
    confirmButtonText: 'ลบ', cancelButtonText: 'ยกเลิก'
  });

  if (!r.isConfirmed) return;

  try {
    const res = await fetch(`/api/locations/${id}`, { method: 'DELETE', headers: authHeaders() });
    const data = await res.json();
    if (!res.ok) { Swal.fire('ผิดพลาด', data.error || 'ลบไม่สำเร็จ', 'error'); return; }

    Swal.fire({ icon: 'success', title: 'ลบสำเร็จ', timer: 1500, showConfirmButton: false });
    loadLocationsMaster();
  } catch (err) {
    console.error('deleteLocation Error:', err);
    Swal.fire('ผิดพลาด', 'เกิดข้อผิดพลาดในการเชื่อมต่อ', 'error');
  }
}

function createLocationModalDOM() {
  if (document.getElementById('locationModal')) return;
  const div = document.createElement('div');
  div.innerHTML = `
    <div class="modal fade" id="locationModal" tabindex="-1">
      <div class="modal-dialog">
        <div class="modal-content">
          <div class="modal-header bg-indigo text-white">
            <h5 class="modal-title" id="locationModalTitle">จัดการโลเคชั่น</h5>
            <button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal"></button>
          </div>
          <div class="modal-body">
            <div class="mb-3">
              <label class="form-label">รหัสโลเคชั่น (Location Code) *</label>
              <input type="text" id="modalLocationCode" class="form-control" placeholder="เช่น A-01-01">
            </div>
            <div class="mb-3">
              <label class="form-label">โซน (Zone)</label>
              <input type="text" id="modalLocationZone" class="form-control" placeholder="เช่น ZONE-A">
            </div>
            <div class="mb-3">
              <label class="form-label">คำอธิบาย (Description)</label>
              <textarea id="modalLocationDesc" class="form-control" rows="2" placeholder="รายละเอียดตำแหน่ง..."></textarea>
            </div>
            <div class="mb-3">
              <label class="form-label">สถานะ</label>
              <select id="modalLocationStatus" class="form-select">
                <option value="1">Active (ใช้งาน)</option>
                <option value="0">Inactive (ปิดใช้งาน)</option>
              </select>
            </div>
          </div>
          <div class="modal-footer">
            <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">ยกเลิก</button>
            <button type="button" class="btn btn-indigo" onclick="saveLocation()">บันทึก</button>
          </div>
        </div>
      </div>
    </div>`;
  document.body.appendChild(div);
}
