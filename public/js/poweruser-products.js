/* ============================================================
   poweruser-products.js — จัดการข้อมูลสินค้า (สำหรับ Power User)
   ============================================================ */

let editingProductId = null;

async function loadMasterProducts() {
  const tbody = document.getElementById('productTableBody');
  if (!tbody) return;

  tbody.innerHTML = `<tr><td colspan="7" class="text-center py-4 text-muted"><span class="spinner-border spinner-border-sm me-2"></span>กำลังโหลด...</td></tr>`;

  try {
    const res = await fetch('/api/products', { headers: authHeaders() });
    if (!res.ok) throw new Error('Failed to fetch products');
    const payload = await res.json();
    const products = Array.isArray(payload) ? payload : (Array.isArray(payload.data) ? payload.data : []);

    if (!Array.isArray(products) || products.length === 0) {
      tbody.innerHTML = `<tr><td colspan="7" class="text-center py-4 text-muted">ไม่พบข้อมูลสินค้าในระบบ</td></tr>`;
      return;
    }

    // แสดงเฉพาะปุ่มแก้ไข
    tbody.innerHTML = products.map((p, index) => {
      const itemCode = p.ItemCode || p.ProductCode || '';
      const itemName = p.ItemName || p.ProductName || '';
      const unit = p.UOM || p.Unit || '-';
      const hasDimensions = p.UnitWidthCm != null && p.UnitLengthCm != null && p.UnitHeightCm != null;
      const dimensions = hasDimensions ? `${p.UnitWidthCm} × ${p.UnitLengthCm} × ${p.UnitHeightCm} cm` : 'ยังไม่ระบุขนาด';
      const volume = p.UnitVolumeCm3 == null ? '' : `${Number(p.UnitVolumeCm3).toLocaleString('th-TH')} cm³`;
      return `
        <tr>
          <td>${index + 1}</td>
          <td><strong class="text-indigo">${p.Barcode || ''}</strong></td>
          <td>${itemCode}</td>
          <td>${itemName}</td>
          <td>${unit}</td>
          <td>${dimensions}<div class="small text-muted">${volume ? `${volume} ต่อ 1 ${unit}` : `ปริมาตรต่อ 1 ${unit} ยังไม่ระบุ`}</div></td>
          <td>
            <button class="btn btn-sm btn-outline-primary" onclick='openEditProduct(${JSON.stringify(p)})'><i class="bi bi-pencil"></i></button>
          </td>
        </tr>
      `;
    }).join('');
  } catch (err) {
    console.error('loadMasterProducts Error:', err);
    tbody.innerHTML = `<tr><td colspan="7" class="text-center py-4 text-danger">โหลดข้อมูลไม่สำเร็จ</td></tr>`;
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
  ['Width','Length','Height'].forEach(dimension => { document.getElementById(`modalProduct${dimension}`).value = ''; });
  updateProductVolumePreview();
  
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
  document.getElementById('modalProductWidth').value = p.UnitWidthCm == null ? '' : p.UnitWidthCm;
  document.getElementById('modalProductLength').value = p.UnitLengthCm == null ? '' : p.UnitLengthCm;
  document.getElementById('modalProductHeight').value = p.UnitHeightCm == null ? '' : p.UnitHeightCm;
  updateProductVolumePreview();
  
  new bootstrap.Modal(modalEl).show();
}

async function saveProduct() {
  const barcode = document.getElementById('modalProductBarcode').value.trim();
  const productCode = document.getElementById('modalProductCode').value.trim();
  const productName = document.getElementById('modalProductName').value.trim();
  const unit = document.getElementById('modalProductUnit').value.trim();
  const unitWidthCm = document.getElementById('modalProductWidth').value;
  const unitLengthCm = document.getElementById('modalProductLength').value;
  const unitHeightCm = document.getElementById('modalProductHeight').value;

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
      body: JSON.stringify({ itemCode: productCode, barcode, itemName: productName, uom: unit, unitWidthCm, unitLengthCm, unitHeightCm })
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

function createProductModalDOM() {
  if (document.getElementById('productModal')) return;
  const div = document.createElement('div');
  div.innerHTML = `
    <div class="modal fade" id="productModal" tabindex="-1">
      <div class="modal-dialog modal-lg modal-dialog-centered modal-dialog-scrollable">
        <div class="modal-content">
          <div class="modal-header bg-indigo text-white">
            <h5 class="modal-title" id="productModalTitle">จัดการข้อมูลสินค้า</h5>
            <button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal"></button>
          </div>
          <div class="modal-body">
            <div class="mb-3">
              <label class="form-label" for="modalProductBarcode">บาร์โค้ด (Barcode) *</label>
              <input type="text" id="modalProductBarcode" class="form-control" maxlength="50" placeholder="สแกนหรือพิมพ์บาร์โค้ด..." required>
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
              <input type="text" id="modalProductUnit" class="form-control" value="BOX" maxlength="20">
            </div>
            <div class="mb-3">
              <label class="form-label">ขนาดต่อ 1 หน่วยสินค้า (cm)</label>
              <div class="row g-2">
                <div class="col-4"><label class="form-label small mb-1" for="modalProductWidth">กว้าง</label><input type="number" id="modalProductWidth" class="form-control" min="0.001" step="0.001" placeholder="เช่น 20" oninput="updateProductVolumePreview()"></div>
                <div class="col-4"><label class="form-label small mb-1" for="modalProductLength">ยาว</label><input type="number" id="modalProductLength" class="form-control" min="0.001" step="0.001" placeholder="เช่น 30" oninput="updateProductVolumePreview()"></div>
                <div class="col-4"><label class="form-label small mb-1" for="modalProductHeight">สูง</label><input type="number" id="modalProductHeight" class="form-control" min="0.001" step="0.001" placeholder="เช่น 15" oninput="updateProductVolumePreview()"></div>
              </div>
              <div class="form-text" id="productVolumePreview">ปริมาตรต่อ 1 หน่วยจะแสดงเมื่อกรอกครบทั้งสามด้าน</div>
              <div class="form-text">วัดต่อ 1 หน่วย UOM เช่น BOX ให้วัด 1 กล่อง · ใช้ตรวจความจุช่อง PUTAWAY A/B</div>
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
  ['modalProductWidth','modalProductLength','modalProductHeight'].forEach(id => document.getElementById(id).addEventListener('input', updateProductVolumePreview));
  document.getElementById('modalProductUnit').addEventListener('input', updateProductVolumePreview);
}

function updateProductVolumePreview() {
  const ids = ['modalProductWidth','modalProductLength','modalProductHeight'];
  const fields = ids.map(id => document.getElementById(id));
  if (fields.some(field => !field)) return;
  const values = fields.map(field => Number(field.value));
  const preview = document.getElementById('productVolumePreview');
  if (!preview) return;
  if (fields.some(field => field.value === '') || values.some(value => !Number.isFinite(value) || value <= 0)) {
    preview.textContent = 'ปริมาตรต่อ 1 หน่วยจะแสดงเมื่อกรอกครบทั้งสามด้าน';
    return;
  }
  preview.textContent = `ปริมาตรโดยประมาณ ${values.reduce((total, value) => total * value, 1).toLocaleString('th-TH', { maximumFractionDigits: 3 })} cm³ ต่อ 1 ${document.getElementById('modalProductUnit').value || 'หน่วย'}`;
}
