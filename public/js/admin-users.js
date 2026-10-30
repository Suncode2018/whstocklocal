/* ============================================================
   admin-users.js — User Management & Dynamic Permissions Checkbox
   ============================================================ */

let currentEditingUserId = null;

// 1. โหลด รายการผู้ใช้งาน ทั้งหมดมาแสดงในตาราง
// 1. โหลด รายการผู้ใช้งาน ทั้งหมดมาแสดงในตาราง
async function loadUsers() {
  const tbody = document.getElementById('usersTableBody');
  if (!tbody) return;

  tbody.innerHTML = `<tr><td colspan="6" class="text-center py-4 text-muted"><span class="spinner-border spinner-border-sm me-2"></span>กำลังโหลดข้อมูลผู้ใช้งาน...</td></tr>`;

  try {
    const res = await fetch('/api/users', { headers: authHeaders() });
    const data = await res.json();
    const list = Array.isArray(data) ? data : (data.data || []);

    if (!list.length) {
      tbody.innerHTML = `<tr><td colspan="6" class="text-center py-4 text-muted">ไม่พบข้อมูลผู้ใช้งานในระบบ</td></tr>`;
      return;
    }

    tbody.innerHTML = list.map((u, i) => {
      const roleBadge = u.Role === 'ADMIN' 
        ? '<span class="badge bg-danger">ADMIN</span>' 
        : '<span class="badge bg-secondary">OPERATOR</span>';

      const statusBadge = u.IsActive 
        ? '<span class="badge bg-success">ใช้งานปกติ</span>' 
        : '<span class="badge bg-danger">ระงับใช้งาน</span>';

      const isMasterAdmin = (u.Username || '').toLowerCase() === 'admin';
      const fullNameText = u.FullName || u.Fullname || u.fullname || '-';

      return `
        <tr>
          <td>${i + 1}</td>
          <td><strong>${u.Username}</strong></td>
          <td>${fullNameText}</td>
          <td>${roleBadge}</td>
          <td>${statusBadge}</td>
          <td>
            <button class="btn btn-sm btn-outline-primary me-1" onclick="openEditUser('${u.UserId}')" title="แก้ไข"><i class="bi bi-pencil"></i></button>
            ${!isMasterAdmin ? `<button class="btn btn-sm btn-outline-danger" onclick="deleteUser('${u.UserId}')" title="ลบ"><i class="bi bi-trash"></i></button>` : '<span class="text-muted ms-2">-</span>'}
          </td>
        </tr>`;
    }).join('');
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="6" class="text-center text-danger py-3">เกิดข้อผิดพลาดในการโหลดข้อมูลผู้ใช้งาน</td></tr>`;
    console.error('loadUsers Error:', err);
  }
}

// 2. ดึงสิทธิ์ทั้งหมดจากตาราง Permissions (SQL Server) มาสร้าง Checkbox ใน Modal แบบ Dynamic
async function loadPermissionsCheckboxes(assignedPerms = []) {
  const container = document.getElementById('permissionsContainer');
  if (!container) return;

  container.innerHTML = `<div class="text-muted small py-2"><span class="spinner-border spinner-border-sm me-2"></span>กำลังโหลดรายการสิทธิ์จากฐานข้อมูล...</div>`;

  try {
    // 💡 ยิง API ไปดึงข้อมูลสดจากตาราง Permissions
    const res = await fetch('/api/permissions/all', { headers: authHeaders() });
    const data = await res.json();
    const allMenus = Array.isArray(data) ? data : (data.data || []);

    if (!allMenus.length) {
      container.innerHTML = `<div class="text-danger small">ไม่พบข้อมูลสิทธิ์ในระบบ</div>`;
      return;
    }

    // แปลงสิทธิ์เดิมของผู้ใช้ให้อยู่ในรูปแบบ Array
    let assignedList = [];
    if (typeof assignedPerms === 'string') {
      assignedList = assignedPerms.split(',').map(s => s.trim().toUpperCase());
    } else if (Array.isArray(assignedPerms)) {
      assignedList = assignedPerms.map(s => s.trim().toUpperCase());
    }

    // สร้าง Checkbox 2 คอลัมน์ แบบไดนามิกตามจำนวนสิทธิ์ในฐานข้อมูลจริง (RECEIVE, PICK, CHECK, TRANSFER, LOAD, PUTAWAY ฯลฯ)
    container.innerHTML = `
      <div class="row g-2">
        ${allMenus.map(menu => {
          const code = (menu.PermissionCode || '').trim().toUpperCase();
          const name = menu.PermissionName || code;
          
          // ตรวจสอบว่าผู้ใช้มีสิทธิ์นี้อยู่แล้วหรือไม่ เพื่อติ๊ก Checked
          const isChecked = assignedList.includes(code) || assignedList.includes(name.toUpperCase()) ? 'checked' : '';
          
          return `
            <div class="col-md-6">
              <div class="form-check">
                <input class="form-check-input perm-checkbox" type="checkbox" value="${code}" id="perm_${code}" ${isChecked}>
                <label class="form-check-label fw-semibold" for="perm_${code}" style="cursor: pointer;">
                  ${name}
                </label>
              </div>
            </div>`;
        }).join('')}
      </div>`;
  } catch (err) {
    container.innerHTML = `<div class="text-danger small">เกิดข้อผิดพลาดในการโหลดสิทธิ์จากเซิร์ฟเวอร์</div>`;
    console.error('loadPermissionsCheckboxes Error:', err);
  }
}

// 3. ควบคุมการซ่อน/แสดง ส่วนกำหนดสิทธิ์ Handheld ตามบทบาท (ADMIN ให้ซ่อน, OPERATOR ให้แสดง)
function syncPermVisibility() {
  const roleSelect = document.getElementById('modalRole');
  const permSection = document.getElementById('permSection');
  if (roleSelect && permSection) {
    permSection.style.display = roleSelect.value === 'OPERATOR' ? 'block' : 'none';
  }
}

// 4. เปิด Modal เพิ่มผู้ใช้งานใหม่
function openAddUser() {
  currentEditingUserId = null;
  document.getElementById('userModalTitle').textContent = 'เพิ่มผู้ใช้งานใหม่';
  
  const usernameInput = document.getElementById('modalUsername');
  usernameInput.value = '';
  usernameInput.disabled = false;
  
  document.getElementById('modalFullname').value = '';
  document.getElementById('modalPassword').value = '';
  document.getElementById('modalRole').value = 'OPERATOR';
  document.getElementById('modalStatus').value = '1';
  
  syncPermVisibility();
  loadPermissionsCheckboxes([]); // โหลด Checkbox เปล่า

  const modal = new bootstrap.Modal(document.getElementById('userModal'));
  modal.show();
}

// 5. เปิด Modal แก้ไขผู้ใช้งานเดิม
async function openEditUser(id) {
  currentEditingUserId = id;
  document.getElementById('userModalTitle').textContent = 'แก้ไขข้อมูลผู้ใช้งาน';
  
  const usernameInput = document.getElementById('modalUsername');
  usernameInput.disabled = true;

  try {
    const res = await fetch(`/api/users/${id}`, { headers: authHeaders() });
    const json = await res.json();
    
    // 💡 แก้ไขจุดสำคัญ: ดึง json.user ตามที่ routes/users.js ส่งมา
    const user = json.user || json.data || json;

    if (!user) {
      Swal.fire({ icon: 'error', title: 'Error', text: 'ไม่พบข้อมูลผู้ใช้งานนี้ในระบบ' });
      return;
    }

    // เติมข้อมูลลงฟอร์ม
    usernameInput.value = user.Username || user.username || '';
    document.getElementById('modalFullname').value = user.Fullname || user.FullName || user.fullname || '';
    document.getElementById('modalPassword').value = ''; 
    document.getElementById('modalRole').value = user.Role || user.role || 'OPERATOR';
    
    const statusValue = (user.Status !== undefined) ? user.Status : (user.IsActive ? 1 : 0);
    document.getElementById('modalStatus').value = String(statusValue);

    syncPermVisibility();
    
    // ดึงสิทธิ์เดิมของผู้ใช้ส่งให้ Checkbox (รองรับทั้ง Array และ String)
    const userPerms = user.Permissions || user.permissions || [];
    loadPermissionsCheckboxes(userPerms);

    const modal = new bootstrap.Modal(document.getElementById('userModal'));
    modal.show();
  } catch (err) {
    Swal.fire({ icon: 'error', title: 'Error', text: 'ไม่สามารถดึงข้อมูลผู้ใช้งานได้' });
    console.error('openEditUser Error:', err);
  }
}

// 6. บันทึกข้อมูลผู้ใช้งาน (Create / Update)
async function saveUser() {
  const username = document.getElementById('modalUsername').value.trim();
  const fullname = document.getElementById('modalFullname').value.trim();
  const password = document.getElementById('modalPassword').value.trim();
  const role = document.getElementById('modalRole').value;
  const isActive = document.getElementById('modalStatus').value === '1';

  if (!username && !currentEditingUserId) {
    Swal.fire({ icon: 'warning', title: 'แจ้งเตือน', text: 'กรุณากรอกชื่อผู้ใช้ (Username)' });
    return;
  }

  // รวบรวมสิทธิ์ที่ถูกเลือกจาก Checkbox
  let permissions = [];
  if (role === 'OPERATOR') {
    const checkboxes = document.querySelectorAll('.perm-checkbox:checked');
    checkboxes.forEach(cb => permissions.push(cb.value));
  } else {
    permissions = ['ALL']; // สำหรับ ADMIN
  }

  const payload = {
    username,
    fullname,
    role,
    isActive,
    permissions: permissions.join(',') // แปลง Array เป็น Comma-separated String
  };

  if (password) payload.password = password;

  try {
    const url = currentEditingUserId ? `/api/users/${currentEditingUserId}` : '/api/users';
    const method = currentEditingUserId ? 'PUT' : 'POST';

    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify(payload)
    });
    const data = await res.json();

    if (!res.ok) {
      Swal.fire({ icon: 'error', title: 'บันทึกไม่สำเร็จ', text: data.message || 'เกิดข้อผิดพลาดในการบันทึก' });
      return;
    }

    Swal.fire({ icon: 'success', title: 'สำเร็จ', text: 'บันทึกข้อมูลผู้ใช้งานเรียบร้อย', timer: 1500, showConfirmButton: false });
    
    const modalEl = document.getElementById('userModal');
    const modal = bootstrap.Modal.getInstance(modalEl);
    if (modal) modal.hide();

    loadUsers();
  } catch (err) {
    Swal.fire({ icon: 'error', title: 'Error', text: 'เกิดข้อผิดพลาดในการเชื่อมต่อเซิร์ฟเวอร์' });
    console.error('saveUser Error:', err);
  }
}

// 7. ลบผู้ใช้งาน
async function deleteUser(id) {
  const result = await Swal.fire({
    title: 'ยืนยันการลบผู้ใช้งาน?',
    text: 'เมื่อลบแล้วจะไม่สามารถกู้คืนข้อมูลผู้ใช้คนนี้ได้',
    icon: 'warning',
    showCancelButton: true,
    confirmButtonColor: '#ef4444',
    cancelButtonColor: '#6b7280',
    confirmButtonText: 'ลบข้อมูล',
    cancelButtonText: 'ยกเลิก'
  });

  if (!result.isConfirmed) return;

  try {
    const res = await fetch(`/api/users/${id}`, {
      method: 'DELETE',
      headers: authHeaders()
    });
    const data = await res.json();

    if (!res.ok) {
      Swal.fire({ icon: 'error', title: 'ลบไม่สำเร็จ', text: data.message || 'เกิดข้อผิดพลาด' });
      return;
    }

    Swal.fire({ icon: 'success', title: 'สำเร็จ', text: 'ลบผู้ใช้งานเรียบร้อย', timer: 1500, showConfirmButton: false });
    loadUsers();
  } catch (err) {
    Swal.fire({ icon: 'error', title: 'Error', text: 'เกิดข้อผิดพลาดในการลบข้อมูล' });
    console.error('deleteUser Error:', err);
  }
}