/* ============================================================
   admin-products.js — Master Data (Products) CRUD
   ============================================================ */

let editingProductId = null;

async function loadMasterProducts() {
  const tbody = document.getElementById('productTableBody');
  const countEl = document.getElementById('productCount');
  tbody.innerHTML = `<tr><td colspan="6" class="text-center py-4 text-muted"><span class="spinner-border spinner-border-sm me-2"></span>กำลังโหลด...</td></tr>`;
  
  try {
    const res  = await fetch('/api/products', { headers: authHeaders() });
    const data = await res.json();
    
    // 💡 รองรับทั้งกรณี API ส่งข้อมูลมาเป็นอาเรย์ตรงๆ หรืออยู่ภายใต้ object { success: true, data: [...] }
    const productList = Array.isArray(data) ? data : (data.data || []);
    
    if (countEl) {
      countEl.textContent = `${productList.length} รายการ`;
    }

    if (!productList.length) {
      tbody.innerHTML = `<tr><td colspan="6" class="text-center py-4 text-muted">ไม่มีข้อมูลสินค้า</td></tr>`;
      return;
    }

    tbody.innerHTML = productList.map((p, i) => {
      const id       = p.ProductId || p.id || p.Id;
      const barcode  = p.Barcode || p.barcode || '-';
      const prodCode = p.ItemCode || p.itemCode || p.ProdCode || '-';
      const prodName = p.ItemName || p.itemName || p.ProdName || '-';
      const unit     = p.UOM || p.uom || p.Unit || '-';

      return `
        <tr>
          <td>${i + 1}</td>
          <td><code class="text-indigo">${barcode}</code></td>
          <td><strong>${prodCode}</strong></td>
          <td>${prodName}</td>
          <td>${unit}</td>
          <td>
            <button class="btn btn-sm btn-outline-secondary me-1" onclick="openEditProduct(${id})" title="แก้ไข"><i class="bi bi-pencil"></i></button>
            <button class="btn btn-sm btn-outline-danger" onclick="deleteProduct(${id}, '${prodName}')" title="ลบ"><i class="bi bi-trash"></i></button>
          </td>
        </tr>`;
    }).join('');
  } catch (e) {
    tbody.innerHTML = `<tr><td colspan="6" class="text-center text-danger py-3">โหลดข้อมูลไม่สำเร็จ</td></tr>`;
    if (countEl) countEl.textContent = `0 รายการ`;
    console.error(e);
  }
}

function openAddProduct() {
  editingProductId = null;
  document.getElementById('productModalTitle').textContent = 'เพิ่มสินค้าใหม่';
  document.getElementById('prodBarcode').value  = '';
  document.getElementById('prodCode').value     = '';
  document.getElementById('prodName').value     = '';
  document.getElementById('prodUnit').value     = '';
  new bootstrap.Modal(document.getElementById('productModal')).show();
}

async function openEditProduct(id) {
  editingProductId = id;
  try {
    const res  = await fetch(`/api/products/${id}`, { headers: authHeaders() });
    const result = await res.json();
    const prod = result.data || result;
    
    document.getElementById('productModalTitle').textContent = 'แก้ไขสินค้า';
    document.getElementById('prodBarcode').value  = prod.Barcode || prod.barcode || '';
    document.getElementById('prodCode').value     = prod.ItemCode || prod.itemCode || prod.ProdCode || '';
    document.getElementById('prodName').value     = prod.ItemName || prod.itemName || prod.ProdName || '';
    document.getElementById('prodUnit').value     = prod.UOM || prod.uom || prod.Unit || '';
    new bootstrap.Modal(document.getElementById('productModal')).show();
  } catch { toast('error', 'โหลดข้อมูลไม่สำเร็จ'); }
}

async function saveProduct() {
  const barcode  = document.getElementById('prodBarcode').value.trim();
  const itemCode = document.getElementById('prodCode').value.trim();
  const itemName = document.getElementById('prodName').value.trim();
  const uom      = document.getElementById('prodUnit').value.trim();

  if (!itemCode || !itemName) { toast('warning', 'กรุณากรอก รหัสสินค้า และ ชื่อสินค้า'); return; }

  const url    = editingProductId ? `/api/products/${editingProductId}` : '/api/products';
  const method = editingProductId ? 'PUT' : 'POST';

  try {
    const res  = await fetch(url, { method, headers: authHeaders(), body: JSON.stringify({ itemCode, barcode, itemName, uom }) });
    const data = await res.json();
    if (!res.ok) { toast('error', data.message || data.error || 'บันทึกไม่สำเร็จ'); return; }
    bootstrap.Modal.getInstance(document.getElementById('productModal'))?.hide();
    toast('success', editingProductId ? 'แก้ไขสินค้าเรียบร้อย' : 'เพิ่มสินค้าเรียบร้อย');
    loadMasterProducts();
  } catch { toast('error', 'เกิดข้อผิดพลาด'); }
}

async function deleteProduct(id, name) {
  const result = await Swal.fire({
    title: 'ยืนยันการลบ?', text: `ลบสินค้า "${name}"`,
    icon: 'warning', showCancelButton: true,
    confirmButtonColor: '#ef4444', cancelButtonColor: '#6b7280',
    confirmButtonText: 'ลบเลย', cancelButtonText: 'ยกเลิก'
  });
  if (!result.isConfirmed) return;
  try {
    const res = await fetch(`/api/products/${id}`, { method: 'DELETE', headers: authHeaders() });
    if (!res.ok) { toast('error', 'ลบไม่สำเร็จ'); return; }
    toast('success', `ลบ "${name}" แล้ว`);
    loadMasterProducts();
  } catch { toast('error', 'เกิดข้อผิดพลาด'); }
}