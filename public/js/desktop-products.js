/* ============================================================
   poweruser-products.js — จัดการข้อมูลสินค้า (Power User Master)
   คอลัมน์: #, บาร์โค้ด, รหัสสินค้า, ชื่อสากล, ชื่อไทย, จัดการ
   ============================================================ */

let editingProductId = null;

// 1. ดึงรายการสินค้ามาแสดงผลในตาราง
async function loadMasterProducts() {
  const tbody = document.getElementById('productTableBody');
  if (!tbody) return;

  tbody.innerHTML = `<tr><td colspan="6" class="text-center py-5 text-muted"><span class="spinner-border spinner-border-sm me-2 text-primary"></span>กำลังโหลดข้อมูลสินค้า...</td></tr>`;

  try {
    const res = await fetch('/api/products', { headers: authHeaders() });
    if (!res.ok) throw new Error('Failed to fetch products');
    const payload = await res.json();
    const products = Array.isArray(payload) ? payload : (Array.isArray(payload.data) ? payload.data : []);

    if (!Array.isArray(products) || products.length === 0) {
      tbody.innerHTML = `<tr><td colspan="6" class="text-center py-5 text-muted">ไม่พบข้อมูลสินค้าในระบบ</td></tr>`;
      return;
    }

    tbody.innerHTML = products.map((p, index) => {
      const pId = p.ProductId || p.Id;
      const itemCode = p.ProductCode || p.ItemCode || '-';
      const itemName = p.ProductName || p.ItemName || '-';
      
      // ดึงชื่อภาษาไทย ถ้าไม่มีค่าให้ขึ้นเป็น -
      const rawThai = p.ThaiName ?? p.thaiName ?? '';
      const thaiName = (rawThai && String(rawThai).trim() !== '') 
        ? `<span class="text-dark fw-medium">${rawThai}</span>` 
        : '<span class="text-muted small">-</span>';

      const barcode = p.Barcode ? `<span class="barcode-pill">${p.Barcode}</span>` : '<span class="text-muted small">-</span>';

      // 6 คอลัมน์ตรงกับ thead ตัดช่องขนาดออกเรียบร้อย
      return `
        <tr>
          <td class="text-center text-muted fw-semibold">${index + 1}</td>
          <td>${barcode}</td>
          <td><span class="code-tag">${itemCode}</span></td>
          <td><div class="fw-semibold text-dark">${itemName}</div></td>
          <td>${thaiName}</td>
          <td class="text-end">
            <button class="btn btn-sm btn-outline-primary border-0 me-1" onclick='openEditProduct(${JSON.stringify(p)})' title="แก้ไข"><i class="bi bi-pencil-square fs-6"></i></button>
          </td>
        </tr>
      `;
    }).join('');

    // เรียกดึงยอด KPI ให้แสดงตัวเลขทันที
    loadProductKPI();
  } catch (err) {
    console.error('loadMasterProducts Error:', err);
    tbody.innerHTML = `<tr><td colspan="6" class="text-center py-5 text-danger">โหลดข้อมูลไม่สำเร็จ</td></tr>`;
  }
}

// 2. ฟังก์ชัน Export Excel / CSV พร้อม UTF-8 BOM รองรับภาษาไทย
function exportProductsToExcel() {
  const table = document.querySelector('.table-modern');
  if (!table) return;

  const rows = Array.from(table.querySelectorAll('tr'));
  const csvContent = rows.map(row => {
    const cells = Array.from(row.querySelectorAll('th, td'));
    return cells.slice(0, -1).map(cell => {
      let text = cell.innerText.replace(/"/g, '""').trim();
      return `"${text}"`;
    }).join(',');
  }).join('\r\n');

  const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `Product_Master_${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

// 3. ดึงยอด KPI ด้านบน
async function loadProductKPI() {
  try {
    const res = await fetch('/api/products/summary', { headers: authHeaders() });
    if (!res.ok) return;
    const json = await res.json();
    const kpi = json.data || json;

    if (document.getElementById('prodKpiTotal')) document.getElementById('prodKpiTotal').textContent = Number(kpi.TotalCount || 0).toLocaleString('th-TH');
    if (document.getElementById('prodKpiRM')) document.getElementById('prodKpiRM').textContent = Number(kpi.TotalRM || 0).toLocaleString('th-TH');
    if (document.getElementById('prodKpiPKG')) document.getElementById('prodKpiPKG').textContent = Number(kpi.TotalPKG || 0).toLocaleString('th-TH');
    if (document.getElementById('prodKpiFG')) document.getElementById('prodKpiFG').textContent = Number(kpi.TotalFG || 0).toLocaleString('th-TH');
  } catch (e) {
    console.warn('loadProductKPI Error:', e);
  }
}

// 4. หน้าต่างเพิ่มสินค้า
function openAddProduct() {
  editingProductId = null;
  let modalEl = document.getElementById('productModal');
  if (!modalEl) { createProductModalDOM(); modalEl = document.getElementById('productModal'); }

  document.getElementById('productModalTitle').textContent = 'เพิ่มสินค้าใหม่';
  document.getElementById('modalProductBarcode').value = '';
  document.getElementById('modalProductCode').value = '';
  document.getElementById('modalProductCode').disabled = false;
  document.getElementById('modalProductName').value = '';
  document.getElementById('modalProductThaiName').value = '';

  new bootstrap.Modal(modalEl).show();
}

// 5. หน้าต่างแก้ไขสินค้า
function openEditProduct(p) {
  editingProductId = p.ProductId || p.Id;
  let modalEl = document.getElementById('productModal');
  if (!modalEl) { createProductModalDOM(); modalEl = document.getElementById('productModal'); }

  const pCode = p.ProductCode || p.ItemCode || '';
  document.getElementById('productModalTitle').textContent = 'แก้ไขสินค้า: ' + pCode;
  document.getElementById('modalProductBarcode').value = p.Barcode || '';
  document.getElementById('modalProductCode').value = pCode;
  document.getElementById('modalProductCode').disabled = true;
  document.getElementById('modalProductName').value = p.ProductName || p.ItemName || '';
  document.getElementById('modalProductThaiName').value = p.ThaiName || '';

  new bootstrap.Modal(modalEl).show();
}

// 6. บันทึกข้อมูล
async function saveProduct() {
  const barcode = document.getElementById('modalProductBarcode').value.trim();
  const productCode = document.getElementById('modalProductCode').value.trim();
  const productName = document.getElementById('modalProductName').value.trim();
  const thaiName = document.getElementById('modalProductThaiName').value.trim();

  if (!productCode || !productName) {
    Swal.fire('แจ้งเตือน', 'กรุณากรอกรหัสสินค้าและชื่อสินค้า', 'warning');
    return;
  }

  const payload = {
    productCode,
    productName,
    thaiName: thaiName || null,
    barcode: barcode || null
  };

  const url = editingProductId ? `/api/products/${editingProductId}` : '/api/products';
  const method = editingProductId ? 'PUT' : 'POST';

  try {
    const res = await fetch(url, {
      method: method,
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify(payload)
    });
    const data = await res.json();

    if (!res.ok) {
      Swal.fire('ผิดพลาด', data.message || data.error || 'บันทึกไม่สำเร็จ', 'error');
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

// 7. สร้าง Modal DOM
function createProductModalDOM() {
  if (document.getElementById('productModal')) return;
  const div = document.createElement('div');
  div.innerHTML = `
    <div class="modal fade" id="productModal" tabindex="-1">
      <div class="modal-dialog modal-dialog-centered">
        <div class="modal-content">
          <div class="modal-header bg-indigo text-white">
            <h5 class="modal-title" id="productModalTitle">จัดการข้อมูลสินค้า</h5>
            <button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal"></button>
          </div>
          <div class="modal-body">
            <div class="mb-3">
              <label class="form-label" for="modalProductBarcode">บาร์โค้ด (Barcode)</label>
              <input type="text" id="modalProductBarcode" class="form-control" maxlength="50" placeholder="สแกนหรือพิมพ์บาร์โค้ด...">
            </div>
            <div class="mb-3">
              <label class="form-label">รหัสสินค้า (Product Code) *</label>
              <input type="text" id="modalProductCode" class="form-control" placeholder="เช่น T588880125" required>
            </div>
            <div class="mb-3">
              <label class="form-label">ชื่อสินค้า (อังกฤษ / สากล) *</label>
              <input type="text" id="modalProductName" class="form-control" placeholder="ชื่อสินค้า..." required>
            </div>
            <div class="mb-3">
              <label class="form-label">ชื่อภาษาไทย (Thai Name)</label>
              <input type="text" id="modalProductThaiName" class="form-control" placeholder="ระบุชื่อภาษาไทยของสินค้า...">
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