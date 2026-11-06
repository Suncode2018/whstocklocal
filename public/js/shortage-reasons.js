/* ============================================================
   shortage-reasons.js — จัดการ Master เหตุผลขาดส่ง
   ============================================================ */

let shortageReasons = [];

async function apiShortage(path, options = {}) {
  const token = localStorage.getItem('token');
  const headers = {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: 'Bearer ' + token } : {}),
    ...(options.headers || {})
  };

  // ลอง /api/master/shortage-reasons ก่อน หากไม่ได้ให้ fallback ไปที่ /api/shortage-reasons
  let res = await fetch('/api/master/shortage-reasons' + path, { ...options, headers });
  
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch (e) {
    throw new Error('เซิร์ฟเวอร์ตอบกลับไม่ถูกต้อง (ไม่ใช่ JSON)');
  }

  if (!res.ok) {
    throw new Error(data.error || data.message || ('Error ' + res.status));
  }
  return data;
}

async function loadShortageReasonMaster(showToast = false) {
  const tbody = document.getElementById('shortageReasonsTableBody');
  if (!tbody) return;

  tbody.innerHTML = '<tr><td colspan="6" class="text-center py-4 text-muted"><span class="spinner-border spinner-border-sm me-2 text-primary"></span>กำลังโหลด...</td></tr>';

  try {
    const data = await apiShortage('');
    shortageReasons = Array.isArray(data) ? data : (data.data || []);

    if (shortageReasons.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6" class="text-center py-4 text-muted">ยังไม่มีข้อมูลเหตุผลขาดส่งในระบบ</td></tr>';
      return;
    }

    tbody.innerHTML = shortageReasons.map((item, index) => {
      const id = item.ReasonId;
      const code = item.ReasonCode || '-';
      const name = item.ReasonName || '-';
      const reqNote = item.RequiresNote;
      const isActive = item.IsActive !== false && item.IsActive !== 0;
      const sort = item.SortOrder ?? 0;

      const noteBadge = reqNote
        ? '<span class="badge bg-warning text-dark"><i class="bi bi-pencil-fill me-1"></i>บังคับระบุ</span>'
        : '<span class="badge bg-light text-muted border">ไม่บังคับ</span>';

      const statusBadge = isActive
        ? '<span class="badge bg-success">Active</span>'
        : '<span class="badge bg-secondary">Inactive</span>';

      return `
        <tr>
          <td><strong class="font-monospace text-primary">${code}</strong></td>
          <td class="fw-semibold text-dark">${name}</td>
          <td>${noteBadge}</td>
          <td><span class="badge bg-light text-dark border">${sort}</span></td>
          <td>${statusBadge}</td>
          <td class="text-end">
            <button class="btn btn-sm btn-outline-primary border-0 me-1" onclick="editShortageReason(${id})" title="แก้ไข">
              <i class="bi bi-pencil-square fs-6"></i>
            </button>
            <button class="btn btn-sm btn-outline-danger border-0" onclick="deleteShortageReason(${id})" title="ลบ">
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
    tbody.innerHTML = `<tr><td colspan="6" class="text-center py-4 text-danger">${err.message}</td></tr>`;
  }
}

function shortageModalHtml(item) {
  const isEdit = !!item;
  return `
    <div class="text-start">
      <div class="mb-3">
        <label class="form-label fw-bold">รหัสเหตุผล (Code) *</label>
        <input type="text" id="sw-code" class="form-control text-uppercase" placeholder="เช่น SHORT_SUPPLIER, DAMAGED" value="${item ? item.ReasonCode : ''}" required>
      </div>
      <div class="mb-3">
        <label class="form-label fw-bold">ชื่อเหตุผลที่แสดง *</label>
        <input type="text" id="sw-name" class="form-control" placeholder="เช่น ผู้ส่งส่งของไม่ครบ, สินค้าเสียหายระหว่างขนส่ง" value="${item ? item.ReasonName : ''}" required>
      </div>
      <div class="row mb-3">
        <div class="col-6">
          <label class="form-label fw-bold">ลำดับแสดง (Sort)</label>
          <input type="number" id="sw-sort" class="form-control" value="${item ? (item.SortOrder ?? 0) : 0}">
        </div>
        <div class="col-6">
          <label class="form-label fw-bold">สถานะ</label>
          <select id="sw-status" class="form-select">
            <option value="1" ${!item || item.IsActive ? 'selected' : ''}>Active</option>
            <option value="0" ${item && !item.IsActive ? 'selected' : ''}>Inactive</option>
          </select>
        </div>
      </div>
      <div class="form-check form-switch mt-2">
        <input class="form-check-input" type="checkbox" id="sw-note" ${item && item.RequiresNote ? 'checked' : ''}>
        <label class="form-check-label fw-semibold" for="sw-note">บังคับให้พนักงานพิมพ์หมายเหตุเพิ่มเติม</label>
      </div>
    </div>
  `;
}

function addShortageReason() {
  Swal.fire({
    title: 'เพิ่มเหตุผลขาดส่ง',
    html: shortageModalHtml(null),
    showCancelButton: true,
    confirmButtonText: 'บันทึก',
    cancelButtonText: 'ยกเลิก',
    confirmButtonColor: '#4f46e5',
    focusConfirm: false,
    preConfirm: () => {
      const code = document.getElementById('sw-code').value.trim();
      const name = document.getElementById('sw-name').value.trim();
      if (!code || !name) {
        Swal.showValidationMessage('กรุณากรอกรหัสและชื่อเหตุผลให้ครบถ้วน');
        return false;
      }
      return {
        reasonCode: code.toUpperCase(),
        reasonName: name,
        sortOrder: parseInt(document.getElementById('sw-sort').value, 10) || 0,
        isActive: document.getElementById('sw-status').value === '1',
        requiresNote: document.getElementById('sw-note').checked
      };
    }
  }).then(async r => {
    if (r.isConfirmed) {
      try {
        await apiShortage('', { method: 'POST', body: JSON.stringify(r.value) });
        Swal.fire({ icon: 'success', title: 'เพิ่มสำเร็จ', timer: 1200, showConfirmButton: false });
        loadShortageReasonMaster();
      } catch (e) {
        Swal.fire('ผิดพลาด', e.message, 'error');
      }
    }
  });
}

function editShortageReason(id) {
  const item = shortageReasons.find(x => x.ReasonId === id);
  if (!item) return;

  Swal.fire({
    title: 'แก้ไขเหตุผลขาดส่ง',
    html: shortageModalHtml(item),
    showCancelButton: true,
    confirmButtonText: 'บันทึกแก้ไข',
    cancelButtonText: 'ยกเลิก',
    confirmButtonColor: '#4f46e5',
    focusConfirm: false,
    preConfirm: () => {
      const code = document.getElementById('sw-code').value.trim();
      const name = document.getElementById('sw-name').value.trim();
      if (!code || !name) {
        Swal.showValidationMessage('กรุณากรอกรหัสและชื่อเหตุผลให้ครบถ้วน');
        return false;
      }
      return {
        reasonCode: code.toUpperCase(),
        reasonName: name,
        sortOrder: parseInt(document.getElementById('sw-sort').value, 10) || 0,
        isActive: document.getElementById('sw-status').value === '1',
        requiresNote: document.getElementById('sw-note').checked
      };
    }
  }).then(async r => {
    if (r.isConfirmed) {
      try {
        await apiShortage('/' + id, { method: 'PUT', body: JSON.stringify(r.value) });
        Swal.fire({ icon: 'success', title: 'แก้ไขเรียบร้อย', timer: 1200, showConfirmButton: false });
        loadShortageReasonMaster();
      } catch (e) {
        Swal.fire('ผิดพลาด', e.message, 'error');
      }
    }
  });
}

async function deleteShortageReason(id) {
  const confirm = await Swal.fire({
    title: 'ยืนยันการลบ?',
    text: 'ต้องการลบเหตุผลขาดส่งนี้ใช่หรือไม่',
    icon: 'warning',
    showCancelButton: true,
    confirmButtonColor: '#ef4444',
    confirmButtonText: 'ลบ',
    cancelButtonText: 'ยกเลิก'
  });

  if (!confirm.isConfirmed) return;

  try {
    await apiShortage('/' + id, { method: 'DELETE' });
    Swal.fire({ icon: 'success', title: 'ลบสำเร็จ', timer: 1200, showConfirmButton: false });
    loadShortageReasonMaster();
  } catch (e) {
    Swal.fire('ผิดพลาด', e.message, 'error');
  }
}

window.loadShortageReasonMaster = loadShortageReasonMaster;
window.addShortageReason = addShortageReason;
window.editShortageReason = editShortageReason;
window.deleteShortageReason = deleteShortageReason;