/* ============================================================
   admin-locations.js — จัดการข้อมูลโลเคชั่น (Locations Master)
   ============================================================ */

let editingLocationId = null;

async function loadLocationsMaster() {
  const tbody = document.getElementById('locationsTableBody');
  if (!tbody) return;

  tbody.innerHTML = `<tr><td colspan="7" class="text-center py-4 text-muted"><span class="spinner-border spinner-border-sm me-2"></span>กำลังโหลด...</td></tr>`;

  try {
    const res = await fetch('/api/locations', { headers: authHeaders() });
    if (!res.ok) throw new Error('Failed to fetch locations');
    const payload = await res.json();
    const locations = Array.isArray(payload) ? payload : (Array.isArray(payload.data) ? payload.data : []);

    if (!Array.isArray(locations) || locations.length === 0) {
      tbody.innerHTML = `<tr><td colspan="7" class="text-center py-4 text-muted">ไม่พบข้อมูลโลเคชั่นในระบบ</td></tr>`;
      return;
    }

    // ตรวจสอบสิทธิ์: เฉพาะ ADMIN เท่านั้นที่จะแสดงปุ่มลบ
    const currentUser = JSON.parse(localStorage.getItem('user') || '{}');
    const isAdmin = currentUser.role === 'ADMIN';

    tbody.innerHTML = locations.map((loc, index) => {
      const locId = loc.LocationId || loc.Id;
      const locationCode = loc.LocationCode || loc.Code || '';
      const description = loc.Description || loc.Desc || '-';
      const code = String(locationCode).toUpperCase();
      const locationType = code.startsWith('RCV-') ? 'รับเข้า · RECEIVING' : (code.startsWith('OUT-') ? 'พักรอจ่าย · SHIPPING' : (code.startsWith('A-') ? 'จัดเก็บ · ZONE-A' : (code.startsWith('B-') ? 'จัดเก็บ · ZONE-B' : (loc.Zone || 'อื่น ๆ'))));
      const isStorage = code.startsWith('A-') || code.startsWith('B-');
      const used = Number(loc.UsedVolumeCm3 || 0);
      const reserved = Number(loc.ReservedVolumeCm3 || 0);
      const capacity = loc.CapacityVolumeCm3 == null ? null : Number(loc.CapacityVolumeCm3);
      const occupied = used + reserved;
      const hasCapacityDimensions = loc.CapacityWidthCm != null && loc.CapacityLengthCm != null && loc.CapacityHeightCm != null;
      const capacityDimensions = hasCapacityDimensions ? `${loc.CapacityWidthCm} × ${loc.CapacityLengthCm} × ${loc.CapacityHeightCm} cm` : 'ยังไม่ระบุขนาดช่อง';
      const capacityText = !isStorage ? '—' : (capacity == null ? capacityDimensions : `${capacityDimensions}<div class="small text-muted">${capacity.toLocaleString('th-TH')} cm³ · ใช้/จอง ${occupied.toLocaleString('th-TH')} · ว่าง ${Math.max(0, capacity - occupied).toLocaleString('th-TH')} cm³</div>`);
      const unknownText = Number(loc.UnmeasuredProducts || 0) > 0 ? `<div class="small text-warning">สินค้าไม่ระบุปริมาตร ${Number(loc.UnmeasuredProducts)} รายการ</div>` : '';
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
          <td>${locationType}</td>
          <td>${capacityText}${unknownText}</td>
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
    tbody.innerHTML = `<tr><td colspan="7" class="text-center py-4 text-danger">โหลดข้อมูลไม่สำเร็จ</td></tr>`;
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
  ['Width','Length','Height'].forEach(dimension => { document.getElementById(`modalLocationCapacity${dimension}`).value = ''; });
  document.getElementById('locationCapacityUsage').textContent = '';
  configureLocationCodeFields();
  updateLocationCapacityPreview();

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
  document.getElementById('modalLocationCapacityWidth').value = loc.CapacityWidthCm == null ? '' : loc.CapacityWidthCm;
  document.getElementById('modalLocationCapacityLength').value = loc.CapacityLengthCm == null ? '' : loc.CapacityLengthCm;
  document.getElementById('modalLocationCapacityHeight').value = loc.CapacityHeightCm == null ? '' : loc.CapacityHeightCm;
  const used = Number(loc.UsedVolumeCm3 || 0);
  const reserved = Number(loc.ReservedVolumeCm3 || 0);
  const usageElement = document.getElementById('locationCapacityUsage');
  usageElement.dataset.used = String(used);
  usageElement.dataset.reserved = String(reserved);
  usageElement.textContent = `${used.toLocaleString('th-TH')} cm³ ใช้จริง · ${reserved.toLocaleString('th-TH')} cm³ จองใน PUTAWAY${Number(loc.UnmeasuredProducts || 0) ? ` · มีสินค้าไม่ทราบปริมาตร ${loc.UnmeasuredProducts} รายการ` : ''}${Number(loc.UnmeasuredReservations || 0) ? ` · ใบงานไม่ทราบปริมาตร ${loc.UnmeasuredReservations} รายการ` : ''}`;
  configureLocationCodeFields();
  updateLocationCapacityPreview();

  new bootstrap.Modal(modalEl).show();
}

async function saveLocation() {
  const code = document.getElementById('modalLocationCode').value.trim();
  const zone = document.getElementById('modalLocationZone').value.trim();
  const description = document.getElementById('modalLocationDesc').value.trim();
  const isActive = document.getElementById('modalLocationStatus').value === '1';
  const capacityWidthCm = document.getElementById('modalLocationCapacityWidth').value;
  const capacityLengthCm = document.getElementById('modalLocationCapacityLength').value;
  const capacityHeightCm = document.getElementById('modalLocationCapacityHeight').value;

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
      body: JSON.stringify({ locationCode: code, zone, description, desc: description, isActive, capacityWidthCm, capacityLengthCm, capacityHeightCm })
    });
    const data = await res.json();

    if (!res.ok) {
      Swal.fire('ผิดพลาด', data.message || data.error || 'บันทึกไม่สำเร็จ', 'error');
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

function configureLocationCodeFields() {
  const code = document.getElementById('modalLocationCode').value.trim().toUpperCase();
  const zone = document.getElementById('modalLocationZone');
  const capacityGroup = document.getElementById('locationCapacityGroup');
  const capacityFields = ['modalLocationCapacityWidth','modalLocationCapacityLength','modalLocationCapacityHeight'].map(id => document.getElementById(id));
  const hint = document.getElementById('locationTypeHint');
  let type = 'OTHER', zoneValue = '';
  if (code.startsWith('RCV-')) { type = 'จุดรับสินค้า · RECEIVING'; zoneValue = 'RECEIVING'; }
  else if (code.startsWith('OUT-')) { type = 'จุดพักรอจ่าย · SHIPPING'; zoneValue = 'SHIPPING'; }
  else if (code.startsWith('A-')) { type = 'พื้นที่จัดเก็บ · ZONE-A'; zoneValue = 'ZONE-A'; }
  else if (code.startsWith('B-')) { type = 'พื้นที่จัดเก็บ · ZONE-B'; zoneValue = 'ZONE-B'; }
  const storage = code.startsWith('A-') || code.startsWith('B-');
  hint.textContent = `ประเภทโลเคชั่น: ${type}${storage ? ' · กรอกขนาดภายในช่อง กว้าง × ยาว × สูง (cm)' : ''}`;
  capacityGroup.style.display = storage ? 'block' : 'none';
  capacityFields.forEach(field => { field.required = storage; });
  if (zoneValue) { zone.value = zoneValue; zone.disabled = true; }
  else zone.disabled = false;
  updateLocationCapacityPreview();
}

function updateLocationCapacityPreview() {
  const ids = ['modalLocationCapacityWidth','modalLocationCapacityLength','modalLocationCapacityHeight'];
  const fields = ids.map(id => document.getElementById(id));
  const preview = document.getElementById('locationCapacityPreview');
  if (!preview || fields.some(field => !field)) return;
  const values = fields.map(field => Number(field.value));
  if (fields.every(field => field.value === '')) {
    preview.textContent = 'กรอกขนาดภายในช่อง เพื่อคำนวณความจุและตรวจสอบ PUTAWAY';
    return;
  }
  if (fields.some(field => field.value === '') || values.some(value => !Number.isFinite(value) || value <= 0)) {
    preview.textContent = 'กรอกกว้าง ยาว และสูงให้ครบทุกช่อง';
    return;
  }
  const volume = values.reduce((total, value) => total * value, 1);
  const used = Number((document.getElementById('locationCapacityUsage').dataset.used || 0));
  const reserved = Number((document.getElementById('locationCapacityUsage').dataset.reserved || 0));
  const committed = used + reserved;
  preview.textContent = `ความจุ ${volume.toLocaleString('th-TH', { maximumFractionDigits: 3 })} cm³ · ใช้/จอง ${committed.toLocaleString('th-TH')} cm³ · คงเหลือ ${Math.max(0, volume - committed).toLocaleString('th-TH', { maximumFractionDigits: 3 })} cm³`;
  preview.classList.toggle('text-danger', volume < committed);
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
    if (!res.ok) { Swal.fire('ผิดพลาด', data.message || data.error || 'ลบไม่สำเร็จ', 'error'); return; }

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
      <div class="modal-dialog modal-dialog-centered modal-dialog-scrollable">
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
              <div class="alert alert-info py-2 small" id="locationTypeHint">ประเภทโลเคชั่นจะกำหนดจากรหัส</div>
            </div>
            <div class="mb-3">
              <label class="form-label">โซน (Zone)</label>
              <input type="text" id="modalLocationZone" class="form-control" placeholder="เช่น ZONE-A">
            </div>
            <div class="mb-3" id="locationCapacityGroup" style="display:none">
              <label class="form-label">ขนาดภายในช่องจัดเก็บ (cm) *</label>
              <div class="row g-2">
                <div class="col-4"><label class="form-label small mb-1" for="modalLocationCapacityWidth">กว้าง</label><input type="number" id="modalLocationCapacityWidth" class="form-control" min="0.001" step="0.001" placeholder="เช่น 100" oninput="updateLocationCapacityPreview()"></div>
                <div class="col-4"><label class="form-label small mb-1" for="modalLocationCapacityLength">ยาว</label><input type="number" id="modalLocationCapacityLength" class="form-control" min="0.001" step="0.001" placeholder="เช่น 120" oninput="updateLocationCapacityPreview()"></div>
                <div class="col-4"><label class="form-label small mb-1" for="modalLocationCapacityHeight">สูง</label><input type="number" id="modalLocationCapacityHeight" class="form-control" min="0.001" step="0.001" placeholder="เช่น 150" oninput="updateLocationCapacityPreview()"></div>
              </div>
              <div class="form-text" id="locationCapacityPreview">กรอกขนาดภายในช่อง เพื่อคำนวณความจุและตรวจสอบ PUTAWAY</div>
              <div class="form-text" id="locationCapacityUsage"></div>
              <div class="form-text">ระบบคำนวณความจุจาก กว้าง × ยาว × สูง และหักพื้นที่ที่ใช้/จองใน PUTAWAY</div>
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
  document.getElementById('modalLocationCode').addEventListener('input', configureLocationCodeFields);
  ['modalLocationCapacityWidth','modalLocationCapacityLength','modalLocationCapacityHeight'].forEach(id => document.getElementById(id).addEventListener('input', updateLocationCapacityPreview));
}
