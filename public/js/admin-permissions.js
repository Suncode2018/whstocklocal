let editingPermId = null;

async function loadPermissionsMaster(showToast = false) {
  const tbody = document.getElementById('permissionsTableBody');
  if (!tbody) return;

  tbody.innerHTML = `<tr><td colspan="6" class="text-center py-5 text-muted"><span class="spinner-border spinner-border-sm me-2 text-primary"></span>กำลังโหลด...</td></tr>`;

  try {
    const res = await fetch('/api/permissions', { headers: authHeaders() });
    if (!res.ok) throw new Error('Failed to fetch permissions');
    const json = await res.json();
    const list = json.data || json || [];

    if (!Array.isArray(list) || list.length === 0) {
      tbody.innerHTML = `<tr><td colspan="6" class="text-center py-5 text-muted">ไม่พบข้อมูลสิทธิ์เมนูในระบบ</td></tr>`;
      return;
    }

    tbody.innerHTML = list.map((item, index) => {
      const pId = item.PermissionId || item.id;
      const code = item.PermissionCode || '-';
      const name = item.PermissionName || '-';
      const desc = item.Description || '-';
      const isActive = item.IsActive !== 0 && item.IsActive !== false;

      return `
        <tr>
          <td class="text-center text-muted fw-semibold">${index + 1}</td>
          <td><span class="perm-badge">${code}</span></td>
          <td><div class="fw-semibold text-dark">${name}</div></td>
          <td><span class="text-muted small">${desc}</span></td>
          <td>${isActive ? '<span class="badge bg-success">เปิดใช้งาน</span>' : '<span class="badge bg-secondary">ปิดใช้งาน</span>'}</td>
          <td class="text-end">
            <button class="btn btn-sm btn-outline-primary border-0 me-1" onclick='openEditPermission(${JSON.stringify(item)})' title="แก้ไข"><i class="bi bi-pencil-square fs-6"></i></button>
            <button class="btn btn-sm btn-outline-danger border-0" onclick="deletePermission(${pId})" title="ลบ"><i class="bi bi-trash fs-6"></i></button>
          </td>
        </tr>
      `;
    }).join('');

    if (showToast) {
      Swal.fire({ icon: 'success', title: 'รีเฟรชข้อมูลเรียบร้อย', timer: 1000, showConfirmButton: false });
    }
  } catch (err) {
    console.error('loadPermissionsMaster Error:', err);
    tbody.innerHTML = `<tr><td colspan="6" class="text-center py-5 text-danger">โหลดข้อมูลไม่สำเร็จ: ${err.message}</td></tr>`;
  }
}

function openAddPermission() {
  editingPermId = null;
  document.getElementById('permModalTitle').textContent = 'เพิ่มสิทธิ์เมนูใหม่';
  document.getElementById('modalPermCode').value = '';
  document.getElementById('modalPermCode').disabled = false;
  document.getElementById('modalPermName').value = '';
  document.getElementById('modalPermDesc').value = '';
  document.getElementById('modalPermStatus').value = '1';
  new bootstrap.Modal(document.getElementById('permModal')).show();
}

function openEditPermission(item) {
  editingPermId = item.PermissionId || item.id;
  document.getElementById('permModalTitle').textContent = 'แก้ไขสิทธิ์เมนู: ' + item.PermissionCode;
  document.getElementById('modalPermCode').value = item.PermissionCode || '';
  document.getElementById('modalPermCode').disabled = true;
  document.getElementById('modalPermName').value = item.PermissionName || '';
  document.getElementById('modalPermDesc').value = item.Description || '';
  document.getElementById('modalPermStatus').value = (item.IsActive !== 0 && item.IsActive !== false) ? '1' : '0';
  new bootstrap.Modal(document.getElementById('permModal')).show();
}

async function savePermission() {
  const code = document.getElementById('modalPermCode').value.trim().toUpperCase();
  const name = document.getElementById('modalPermName').value.trim();
  const desc = document.getElementById('modalPermDesc').value.trim();
  const isActive = document.getElementById('modalPermStatus').value === '1';

  if (!code || !name) {
    Swal.fire('แจ้งเตือน', 'กรุณาระบุรหัสสิทธิ์และชื่อเมนู', 'warning');
    return;
  }

  const payload = { code, name, desc, isActive };
  const url = editingPermId ? `/api/permissions/${editingPermId}` : '/api/permissions';
  const method = editingPermId ? 'PUT' : 'POST';

  try {
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.message || 'บันทึกไม่สำเร็จ');

    bootstrap.Modal.getInstance(document.getElementById('permModal')).hide();
    Swal.fire({ icon: 'success', title: 'บันทึกสำเร็จ', timer: 1500, showConfirmButton: false });
    loadPermissionsMaster();
  } catch (err) {
    Swal.fire('ผิดพลาด', err.message, 'error');
  }
}

async function deletePermission(id) {
  const confirm = await Swal.fire({
    title: 'ยืนยันการลบสิทธิ์?',
    text: 'ต้องการลบสิทธิ์เมนูนี้ใช่หรือไม่',
    icon: 'warning',
    showCancelButton: true,
    confirmButtonColor: '#ef4444',
    confirmButtonText: 'ลบ',
    cancelButtonText: 'ยกเลิก'
  });

  if (!confirm.isConfirmed) return;

  try {
    const res = await fetch(`/api/permissions/${id}`, {
      method: 'DELETE',
      headers: authHeaders()
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.message || 'ลบไม่สำเร็จ');

    Swal.fire({ icon: 'success', title: 'ลบเรียบร้อย', timer: 1500, showConfirmButton: false });
    loadPermissionsMaster();
  } catch (err) {
    Swal.fire('ผิดพลาด', err.message, 'error');
  }
}