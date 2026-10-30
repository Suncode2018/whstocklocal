/* ============================================================
   admin-permissions.js — Permissions Master CRUD
   ============================================================ */

let currentEditingPermId = null;

// 1. โหลดข้อมูลสิทธิ์ทั้งหมดมาแสดงในตาราง
async function loadPermissionsMaster() {
  const tbody = document.getElementById('permissionsTableBody');
  if (!tbody) return;

  tbody.innerHTML = `<tr><td colspan="6" class="text-center py-4 text-muted"><span class="spinner-border spinner-border-sm me-2"></span>กำลังโหลดข้อมูลสิทธิ์...</td></tr>`;

  try {
    const res = await fetch('/api/permissions', { headers: authHeaders() });
    const data = await res.json();
    const list = Array.isArray(data) ? data : (data.data || []);

    if (!list.length) {
      tbody.innerHTML = `<tr><td colspan="6" class="text-center py-4 text-muted">ไม่พบข้อมูลสิทธิ์เมนูในระบบ</td></tr>`;
      return;
    }

    tbody.innerHTML = list.map((item, i) => {
      const statusBadge = item.IsActive 
        ? '<span class="badge bg-success">เปิดใช้งาน</span>' 
        : '<span class="badge bg-secondary">ปิดใช้งาน</span>';

      return `
        <tr>
          <td>${i + 1}</td>
          <td><code>${item.PermissionCode}</code></td>
          <td><strong>${item.PermissionName}</strong></td>
          <td>${item.Description || '-'}</td>
          <td>${statusBadge}</td>
          <td>
            <button class="btn btn-sm btn-outline-primary me-1" onclick="editPermission('${item.PermissionId}')" title="แก้ไข"><i class="bi bi-pencil"></i></button>
            <button class="btn btn-sm btn-outline-danger" onclick="deletePermission('${item.PermissionId}')" title="ลบ"><i class="bi bi-trash"></i></button>
          </td>
        </tr>`;
    }).join('');
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="6" class="text-center text-danger py-3">โหลดข้อมูลสิทธิ์ไม่สำเร็จ</td></tr>`;
    console.error(err);
  }
}

// 2. เปิด Modal เพิ่มสิทธิ์เมนูใหม่
function openAddPermission() {
  currentEditingPermId = null;
  document.getElementById('permModalTitle').textContent = 'เพิ่มสิทธิ์เมนูใหม่';
  document.getElementById('modalPermCode').value = '';
  document.getElementById('modalPermCode').disabled = false;
  document.getElementById('modalPermName').value = '';
  document.getElementById('modalPermDesc').value = '';
  document.getElementById('modalPermStatus').value = '1';

  const modal = new bootstrap.Modal(document.getElementById('permModal'));
  modal.show();
}

// 3. เปิด Modal แก้ไขข้อมูลสิทธิ์เมนูเดิม
async function editPermission(id) {
  currentEditingPermId = id;
  document.getElementById('permModalTitle').textContent = 'แก้ไขข้อมูลสิทธิ์เมนู';
  document.getElementById('modalPermCode').disabled = true; // ล็อคไม่ให้แก้รหัส Code

  try {
    const res = await fetch(`/api/permissions/${id}`, { headers: authHeaders() });
    const data = await res.json();
    const item = data.data || data;

    document.getElementById('modalPermCode').value = item.PermissionCode || '';
    document.getElementById('modalPermName').value = item.PermissionName || '';
    document.getElementById('modalPermDesc').value = item.Description || '';
    document.getElementById('modalPermStatus').value = item.IsActive ? '1' : '0';

    const modal = new bootstrap.Modal(document.getElementById('permModal'));
    modal.show();
  } catch (err) {
    Swal.fire({ icon: 'error', title: 'Error', text: 'ไม่สามารถโหลดข้อมูลสิทธิ์ได้' });
    console.error(err);
  }
}

// 4. บันทึกข้อมูล (Create / Update)
async function savePermission() {
  const code = document.getElementById('modalPermCode').value.trim();
  const name = document.getElementById('modalPermName').value.trim();
  const desc = document.getElementById('modalPermDesc').value.trim();
  const isActive = document.getElementById('modalPermStatus').value === '1';

  if (!code || !name) {
    Swal.fire({ icon: 'warning', title: 'แจ้งเตือน', text: 'กรุณากรอกรหัสสิทธิ์และชื่อเมนูให้ครบถ้วน' });
    return;
  }

  const payload = { code, name, desc, isActive };

  try {
    const url = currentEditingPermId ? `/api/permissions/${currentEditingPermId}` : '/api/permissions';
    const method = currentEditingPermId ? 'PUT' : 'POST';

    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify(payload)
    });
    const data = await res.json();

    if (!res.ok) {
      Swal.fire({ icon: 'error', title: 'บันทึกไม่สำเร็จ', text: data.message || 'เกิดข้อผิดพลาด' });
      return;
    }

    Swal.fire({ icon: 'success', title: 'สำเร็จ', text: 'บันทึกข้อมูลสิทธิ์เรียบร้อย', timer: 1500, showConfirmButton: false });
    bootstrap.Modal.getInstance(document.getElementById('permModal')).hide();
    loadPermissionsMaster();
  } catch (err) {
    Swal.fire({ icon: 'error', title: 'Error', text: 'เกิดข้อผิดพลาดในการบันทึก' });
    console.error(err);
  }
}

// 5. ลบสิทธิ์เมนู
async function deletePermission(id) {
  const result = await Swal.fire({
    title: 'ยืนยันการลบสิทธิ์เมนู?',
    text: 'การกระทำนี้จะไม่สามารถย้อนกลับได้',
    icon: 'warning',
    showCancelButton: true,
    confirmButtonColor: '#ef4444',
    cancelButtonColor: '#6b7280',
    confirmButtonText: 'ลบ',
    cancelButtonText: 'ยกเลิก'
  });

  if (!result.isConfirmed) return;

  try {
    const res = await fetch(`/api/permissions/${id}`, {
      method: 'DELETE',
      headers: authHeaders()
    });
    const data = await res.json();

    if (!res.ok) {
      Swal.fire({ icon: 'error', title: 'ลบไม่สำเร็จ', text: data.message || 'เกิดข้อผิดพลาด' });
      return;
    }

    Swal.fire({ icon: 'success', title: 'สำเร็จ', text: 'ลบสิทธิ์เมนูเรียบร้อย', timer: 1500, showConfirmButton: false });
    loadPermissionsMaster();
  } catch (err) {
    Swal.fire({ icon: 'error', title: 'Error', text: 'เกิดข้อผิดพลาดในการลบ' });
    console.error(err);
  }
}