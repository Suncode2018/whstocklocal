/* ============================================================
   admin-roles.js — จัดการข้อมูล Roles Master
   ============================================================ */

let editingRoleId = null;

async function loadRolesMaster() {
  const tbody = document.getElementById('rolesTableBody');
  if (!tbody) return;

  tbody.innerHTML = `<tr><td colspan="6" class="text-center py-4 text-muted"><span class="spinner-border spinner-border-sm me-2"></span>กำลังโหลด...</td></tr>`;

  try {
    const res = await fetch('/api/roles', { headers: typeof authHeaders === 'function' ? authHeaders() : {} });
    if (!res.ok) throw new Error('Failed to fetch roles');
    const data = await res.json();
    const roles = Array.isArray(data) ? data : (data.data || []);

    if (roles.length === 0) {
      tbody.innerHTML = `<tr><td colspan="6" class="text-center py-4 text-muted">ไม่พบข้อมูล Role ในระบบ</td></tr>`;
      return;
    }

    tbody.innerHTML = roles.map((r, index) => {
      const roleId = r.RoleId || r.id || (index + 1);
      const roleCode = r.RoleCode || r.role || '-';
      const roleName = r.RoleName || r.name || '';
      const description = r.Description || r.description || '-';
      const isActive = r.IsActive !== false && r.IsActive !== 0;

      return `
        <tr>
          <td>${index + 1}</td>
          <td><strong class="text-indigo">${roleCode}</strong></td>
          <td>${roleName}</td>
          <td>${description}</td>
          <td><span class="badge ${isActive ? 'bg-success' : 'bg-secondary'}">${isActive ? 'Active' : 'Inactive'}</span></td>
          <td>
            <button class="btn btn-sm btn-outline-primary me-1" onclick="openEditRole(${roleId}, '${roleCode}', '${roleName}', '${description}', ${isActive ? 1 : 0})"><i class="bi bi-pencil"></i></button>
            <button class="btn btn-sm btn-outline-danger" onclick="deleteRole(${roleId})"><i class="bi bi-trash"></i></button>
          </td>
        </tr>
      `;
    }).join('');
  } catch (err) {
    console.error('loadRolesMaster Error:', err);
    tbody.innerHTML = `<tr><td colspan="6" class="text-center py-4 text-danger">โหลดข้อมูลไม่สำเร็จ: ${err.message}</td></tr>`;
  }
}

// ผูก Alias ให้เรียกผ่าน loadRoles() ได้โดยไม่เกิด Error
const loadRoles = loadRolesMaster;

function openAddRole() {
  editingRoleId = null;
  document.getElementById('roleModalTitle').textContent = 'เพิ่ม Role ใหม่';
  document.getElementById('modalRoleCode').value = '';
  document.getElementById('modalRoleCode').disabled = false;
  document.getElementById('modalRoleName').value = '';
  document.getElementById('modalRoleDesc').value = '';
  document.getElementById('modalRoleStatus').value = '1';
  new bootstrap.Modal(document.getElementById('roleModal')).show();
}

function openEditRole(id, code, name, desc, isActive) {
  editingRoleId = id;
  document.getElementById('roleModalTitle').textContent = 'แก้ไข Role: ' + code;
  document.getElementById('modalRoleCode').value = code;
  document.getElementById('modalRoleCode').disabled = true; // ห้ามแก้ไขรหัส RoleCode ซ้ำ
  document.getElementById('modalRoleName').value = name;
  document.getElementById('modalRoleDesc').value = desc;
  document.getElementById('modalRoleStatus').value = isActive ? '1' : '0';
  new bootstrap.Modal(document.getElementById('roleModal')).show();
}

async function saveRole() {
  const roleCode = document.getElementById('modalRoleCode').value.trim();
  const roleName = document.getElementById('modalRoleName').value.trim();
  const description = document.getElementById('modalRoleDesc').value.trim();
  const isActive = document.getElementById('modalRoleStatus').value === '1';

  if (!roleCode || !roleName) {
    Swal.fire('แจ้งเตือน', 'กรุณากรอกรหัสและชื่อบทบาท', 'warning');
    return;
  }

  const url = editingRoleId ? `/api/roles/${editingRoleId}` : '/api/roles';
  const method = editingRoleId ? 'PUT' : 'POST';

  try {
    const res = await fetch(url, {
      method: method,
      headers: { 'Content-Type': 'application/json', ...(typeof authHeaders === 'function' ? authHeaders() : {}) },
      body: JSON.stringify({ roleCode, roleName, description, isActive })
    });
    const data = await res.json();

    if (!res.ok) {
      Swal.fire('ผิดพลาด', data.error || data.message || 'บันทึกไม่สำเร็จ', 'error');
      return;
    }

    bootstrap.Modal.getInstance(document.getElementById('roleModal')).hide();
    Swal.fire({ icon: 'success', title: 'บันทึกสำเร็จ', timer: 1500, showConfirmButton: false });
    loadRolesMaster();
  } catch (err) {
    console.error('saveRole Error:', err);
    Swal.fire('ผิดพลาด', 'เกิดข้อผิดพลาดในการเชื่อมต่อ', 'error');
  }
}

async function deleteRole(id) {
  const r = await Swal.fire({
    title: 'ยืนยันการลบ?', 
    text: 'คุณต้องการลบ Role นี้ใช่หรือไม่',
    icon: 'warning', 
    showCancelButton: true,
    confirmButtonColor: '#ef4444', 
    cancelButtonColor: '#6b7280',
    confirmButtonText: 'ลบ', 
    cancelButtonText: 'ยกเลิก'
  });

  if (!r.isConfirmed) return;

  try {
    const res = await fetch(`/api/roles/${id}`, { 
      method: 'DELETE', 
      headers: typeof authHeaders === 'function' ? authHeaders() : {} 
    });
    const data = await res.json();
    if (!res.ok) { 
      Swal.fire('ผิดพลาด', data.error || data.message || 'ลบไม่สำเร็จ', 'error'); 
      return; 
    }

    Swal.fire({ icon: 'success', title: 'ลบสำเร็จ', timer: 1500, showConfirmButton: false });
    loadRolesMaster();
  } catch (err) {
    console.error('deleteRole Error:', err);
    Swal.fire('ผิดพลาด', 'เกิดข้อผิดพลาดในการเชื่อมต่อ', 'error');
  }
}