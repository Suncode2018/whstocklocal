/* ============================================================
   admin-products.js — จัดการข้อมูลสินค้า (สำหรับ Admin)
   ============================================================ */

let editingProductId = null;

async function loadMasterProducts() {
  const tbody = document.getElementById('productTableBody');
  if (!tbody) return;

  tbody.innerHTML = `<tr><td colspan="6" class="text-center py-4 text-muted"><span class="spinner-border spinner-border-sm me-2"></span>กำลังโหลด...</td></tr>`;

  try {
    const res = await fetch('/api/products', { headers: authHeaders() });
    if (!res.ok) throw new Error('Failed to fetch products');
    const payload = await res.json();
    const products = Array.isArray(payload) ? payload : (Array.isArray(payload.data) ? payload.data : []);

    if (!Array.isArray(products) || products.length === 0) {
      tbody.innerHTML = `<tr><td colspan="6" class="text-center py-4 text-muted">ไม่พบข้อมูลสินค้าในระบบ</td></tr>`;
      return;
    }

    tbody.innerHTML = products.map((p, index) => {
      const pId = p.ProductId || p.Id;
      const itemCode = p.ItemCode || p.ProductCode || '';
      const itemName = p.ItemName || p.ProductName || '';
      const unit = p.UOM || p.Unit || '-';
      return `
        <tr>
          <td>${index + 1}</td>
          <td><strong class="text-indigo">${p.Barcode || ''}</strong></td>
          <td>${itemCode}</td>
          <td>${itemName}</td>
          <td>${unit}</td>
          <td>
            <button class="btn btn-sm btn-outline-primary me-1" onclick='openEditProduct(${JSON.stringify(p)})'><i class="bi bi-pencil"></i></button>
            <button class="btn btn-sm btn-outline-danger" onclick="deleteProduct(${pId})"><i class="bi bi-trash"></i></button>
          </td>
        </tr>
      `;
    }).join('');
  } catch (err) {
    console.error('loadMasterProducts Error:', err);
    tbody.innerHTML = `<tr><td colspan="6" class="text-center py-4 text-danger">โหลดข้อมูลไม่สำเร็จ</td></tr>`;
  }
}

function openAddProduct() {
  editingProductId = null;
  let modalEl = document.getElementById('productModal');
  if (!modalEl) { createProductModalDOM(); modalEl = document.getElementById('productModal'); }

  document.getElementById('productModalTitle').textContent = 'เพิ่มสินค้าใหม่';
  document.getElementById('modalProductBarcode').value = '';
  document.getElementById('modalProductCode').value = '';
  document.getElementById('modalProductName').value = '';
  document.getElementById('modalProductUnit').value = 'BOX';

  new bootstrap.Modal(modalEl).show();
}

function openEditProduct(p) {
  editingProductId = p.ProductId || p.Id;
  let modalEl = document.getElementById('productModal');
  if (!modalEl) { createProductModalDOM(); modalEl = document.getElementById('productModal'); }

  document.getElementById('productModalTitle').textContent = 'แก้ไขสินค้า: ' + (p.ItemCode || p.ProductCode || '');
  document.getElementById('modalProductBarcode').value = p.Barcode || '';
  document.getElementById('modalProductCode').value = p.ItemCode || p.ProductCode || '';
  document.getElementById('modalProductName').value = p.ItemName || p.ProductName || '';
  document.getElementById('modalProductUnit').value = p.UOM || p.Unit || 'BOX';

  new bootstrap.Modal(modalEl).show();
}

async function saveProduct() {
  const barcode = document.getElementById('modalProductBarcode').value.trim();
  const productCode = document.getElementById('modalProductCode').value.trim();
  const productName = document.getElementById('modalProductName').value.trim();
  const unit = document.getElementById('modalProductUnit').value.trim();

  if (!productCode || !productName) {
    Swal.fire('แจ้งเตือน', 'กรุณากรอกรหัสสินค้าและชื่อสินค้า', 'warning');
    return;
  }

  const url = editingProductId ? `/api/products/${editingProductId}` : '/api/products';
  const method = editingProductId ? 'PUT' : 'POST';

  try {
    const res = await fetch(url, {
      method: method,
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ itemCode: productCode, barcode, itemName: productName, uom: unit })
    });
    const data = await res.json();

    if (!res.ok) {
      Swal.fire('ผิดพลาด', data.error || 'บันทึกไม่สำเร็จ', 'error');
      return;
    }

    const modalEl = document.getElementById('productModal');
    if (modalEl) {
      const modalInstance = bootstrap.Modal.getInstance(modalEl);
      if (modalInstance) modalInstance.hide();
    }

    Swal.fire({ icon: 'success', title: 'บันทึกสำเร็จ', timer: 1500, showConfirmButton: false });
    loadMasterProducts();
  } catch (err) {
    console.error('saveProduct Error:', err);
    Swal.fire('ผิดพลาด', 'เกิดข้อผิดพลาดในการเชื่อมต่อ', 'error');
  }
}

async function deleteProduct(id) {
  const r = await Swal.fire({
    title: 'ยืนยันการลบ?', text: 'คุณต้องการลบสินค้านี้ใช่หรือไม่',
    icon: 'warning', showCancelButton: true,
    confirmButtonColor: '#ef4444', cancelButtonColor: '#6b7280',
    confirmButtonText: 'ลบ', cancelButtonText: 'ยกเลิก'
  });

  if (!r.isConfirmed) return;

  try {
    const res = await fetch(`/api/products/${id}`, { method: 'DELETE', headers: authHeaders() });
    const data = await res.json();
    if (!res.ok) { Swal.fire('ผิดพลาด', data.error || 'ลบไม่สำเร็จ', 'error'); return; }

    Swal.fire({ icon: 'success', title: 'ลบสำเร็จ', timer: 1500, showConfirmButton: false });
    loadMasterProducts();
  } catch (err) {
    console.error('deleteProduct Error:', err);
    Swal.fire('ผิดพลาด', 'เกิดข้อผิดพลาดในการเชื่อมต่อ', 'error');
  }
}

function createProductModalDOM() {
  if (document.getElementById('productModal')) return;
  const div = document.createElement('div');
  div.innerHTML = `
    <div class="modal fade" id="productModal" tabindex="-1">
      <div class="modal-dialog">
        <div class="modal-content">
          <div class="modal-header bg-indigo text-white">
            <h5 class="modal-title" id="productModalTitle">จัดการข้อมูลสินค้า</h5>
            <button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal"></button>
          </div>
          <div class="modal-body">
            <div class="mb-3">
              <label class="form-label">บาร์โค้ด (Barcode)</label>
              <input type="text" id="modalProductBarcode" class="form-control" placeholder="สแกนหรือพิมพ์บาร์โค้ด...">
            </div>
            <div class="mb-3">
              <label class="form-label">รหัสสินค้า (Product Code) *</label>
              <input type="text" id="modalProductCode" class="form-control" placeholder="เช่น ITM001">
            </div>
            <div class="mb-3">
              <label class="form-label">ชื่อสินค้า (Product Name) *</label>
              <input type="text" id="modalProductName" class="form-control" placeholder="ชื่อสินค้า...">
            </div>
            <div class="mb-3">
              <label class="form-label">หน่วย (Unit)</label>
              <input type="text" id="modalProductUnit" class="form-control" value="BOX">
            </div>
          </div>
          <div class="modal-footer">
            <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">ยกเลิก</button>
            <button type="button" class="btn btn-indigo" onclick="saveProduct()">บันทึก</button>
          </div>
        </div>
      </div>
    </div>`;
  document.body.appendChild(div);
}
