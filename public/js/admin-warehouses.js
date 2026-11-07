/* ============================================================
   admin-warehouses.js — จัดการข้อมูลคลังสินค้า (tblWH)
   ============================================================ */

let editingWhId = null;

async function loadWarehouses(showToast = false) {
  const tbody = document.getElementById('whTableBody');
  if (!tbody) return;

  tbody.innerHTML = `<tr><td colspan="4" class="text-center py-4 text-muted"><span class="spinner-border spinner-border-sm me-2 text-primary"></span>กำลังโหลด...</td></tr>`;

  try {
    const res = await fetch('/api/warehouses', { headers: typeof authHeaders === 'function' ? authHeaders() : {} });
    if (!res.ok) throw new Error('โหลดข้อมูลไม่สำเร็จ');
    const list = await res.json();
    const warehouseAdmin=typeof wmsNavigation!=='undefined'&&wmsNavigation?.user.role==='ADMIN';
    document.querySelectorAll('[onclick="openAddWH()"],#warehouseAccessUsers').forEach(button=>button.hidden=!warehouseAdmin);

    if (!Array.isArray(list) || list.length === 0) {
      tbody.innerHTML = `<tr><td colspan="4" class="text-center py-4 text-muted">ยังไม่มีข้อมูลคลังสินค้าในระบบ</td></tr>`;
      return;
    }

    tbody.innerHTML = list.map((item, index) => {
      const id = item.whid;
      const name = item.whname || '-';
      const desc = item.whdescription || '-';

      return `
        <tr>
          <td class="text-center text-muted fw-semibold">${index + 1}</td>
          <td><strong class="text-primary font-monospace fs-6">${name}</strong></td>
          <td>${desc}</td>
          <td class="text-end">
            <button class="btn btn-sm btn-outline-primary border-0 me-1" onclick="openEditWH(${id}, '${name}', '${desc}')" title="แก้ไข">
              <i class="bi bi-pencil-square fs-6"></i>
            </button>
            <button class="btn btn-sm btn-outline-danger border-0" onclick="deleteWH(${id})" title="ลบ">
              <i class="bi bi-trash fs-6"></i>
            </button>
          </td>
        </tr>
      `;
    }).join('');

    tbody.querySelectorAll('button').forEach(button=>button.hidden=!warehouseAdmin);
    if (showToast && typeof Swal !== 'undefined') {
      Swal.fire({ icon: 'success', title: 'รีเฟรชข้อมูลเรียบร้อย', timer: 1000, showConfirmButton: false });
    }
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="4" class="text-center py-4 text-danger">เกิดข้อผิดพลาด: ${err.message}</td></tr>`;
  }
}

function openAddWH() {
  editingWhId = null;
  document.getElementById('whModalTitle').textContent = 'เพิ่มคลังสินค้าใหม่';
  document.getElementById('modalWhName').value = '';
  document.getElementById('modalWhDesc').value = '';
  new bootstrap.Modal(document.getElementById('whModal')).show();
}

function openEditWH(id, name, desc) {
  editingWhId = id;
  document.getElementById('whModalTitle').textContent = 'แก้ไขคลังสินค้า (ID: ' + id + ')';
  document.getElementById('modalWhName').value = name;
  document.getElementById('modalWhDesc').value = desc === '-' ? '' : desc;
  new bootstrap.Modal(document.getElementById('whModal')).show();
}

async function saveWH() {
  const whname = document.getElementById('modalWhName').value.trim();
  const whdescription = document.getElementById('modalWhDesc').value.trim();

  if (!whname) {
    Swal.fire('แจ้งเตือน', 'กรุณาระบุชื่อคลังสินค้า', 'warning');
    return;
  }

  const url = editingWhId ? `/api/warehouses/${editingWhId}` : '/api/warehouses';
  const method = editingWhId ? 'PUT' : 'POST';

  try {
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json', ...(typeof authHeaders === 'function' ? authHeaders() : {}) },
      body: JSON.stringify({ whname, whdescription })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'บันทึกไม่สำเร็จ');

    bootstrap.Modal.getInstance(document.getElementById('whModal')).hide();
    Swal.fire({ icon: 'success', title: 'บันทึกสำเร็จ', timer: 1500, showConfirmButton: false });
    loadWarehouses();
  } catch (err) {
    Swal.fire('ผิดพลาด', err.message, 'error');
  }
}

async function deleteWH(id) {
  const confirm = await Swal.fire({
    title: 'ยืนยันการลบ?',
    text: 'ต้องการลบคลังสินค้านี้ใช่หรือไม่',
    icon: 'warning',
    showCancelButton: true,
    confirmButtonColor: '#ef4444',
    confirmButtonText: 'ลบ',
    cancelButtonText: 'ยกเลิก'
  });

  if (!confirm.isConfirmed) return;

  try {
    const res = await fetch(`/api/warehouses/${id}`, {
      method: 'DELETE',
      headers: typeof authHeaders === 'function' ? authHeaders() : {}
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'ลบไม่สำเร็จ');

    Swal.fire({ icon: 'success', title: 'ลบเรียบร้อย', timer: 1500, showConfirmButton: false });
    loadWarehouses();
  } catch (err) {
    Swal.fire('ผิดพลาด', err.message, 'error');
  }
}
window.addEventListener('wms-navigation',()=>{if(document.getElementById('pane-warehouses')?.style.display!=='none')loadWarehouses()});
