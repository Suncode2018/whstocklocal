/* ============================================================
   admin-products.js — จัดการข้อมูลสินค้า (Admin Master)
   ฟีเจอร์:
   1. แสดงคอลัมน์: #, บาร์โค้ด, รหัสสินค้า, ชื่อสากล, ชื่อภาษาไทย, จัดการ
   2. ปุ่ม Export ส่งออก Excel / CSV UTF-8 (ภาษาไทยไม่เพี้ยน)
   3. ฟอร์มเพิ่ม/แก้ไข รองรับชื่อภาษาไทย (Thai Name)
   ============================================================ */

let editingProductId = null;

let masterProducts = [];
let productResults = [];
let productPage = 1;
let productSearchTimer;
let productSearchComposing = false;
let productLoadVersion = 0;
const productText = value => String(value ?? '').normalize('NFKC').replace(/[\u200B-\u200D\uFEFF]/g,'').toLocaleLowerCase().trim().replace(/\s+/g,' ');
const productHtml = value => String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function findProductResults(products, query, category) {
  const q=productText(query);const words=q.split(' ').filter(Boolean);
  return products.map((p,index)=>{
    const code=productText(p.ProductCode || p.ItemCode),barcode=productText(p.Barcode);
    const text=[code,barcode,productText(p.ProductName || p.ItemName),productText(p.ThaiName)].join(' ');
    const score=q && (code===q || barcode===q)?0:q && (code.startsWith(q) || barcode.startsWith(q))?1:2;
    return {p,index,score,match:(!category || String(p.CategoryId)===category) && words.every(word=>text.includes(word))};
  }).filter(row=>row.match).sort((a,b)=>a.score-b.score || a.index-b.index).map(row=>row.p);
}
async function loadMasterProducts() {
  const tbody=document.getElementById('productTableBody');if(!tbody)return;
  const version=++productLoadVersion;
  tbody.innerHTML='<tr><td colspan="6" class="text-center py-5 text-muted">กำลังโหลดข้อมูลสินค้า...</td></tr>';
  if(document.getElementById('productSearchCount'))document.getElementById('productSearchCount').textContent='กำลังโหลดสินค้า...';
  try {
    const res=await fetch('/api/products',{headers:authHeaders()});
    if(!res.ok)throw Error('โหลดสินค้าไม่สำเร็จ');
    const payload=await res.json();const products=Array.isArray(payload)?payload:payload.data;
    if(!Array.isArray(products))throw Error('รูปแบบข้อมูลสินค้าไม่ถูกต้อง');
    // Compatibility with a running server that has not reloaded the new CategoryId field yet.
    if(document.getElementById('prodCategoryFilter') && products.some(p=>p.CategoryId==null)){
      const r=await fetch('/api/stock/balance',{headers:authHeaders()});
      if(!r.ok)throw Error('โหลดหมวดสินค้าไม่สำเร็จ กรุณารีเฟรชอีกครั้ง');
      const b=await r.json();const categories=new Map((b.data||[]).map(p=>[p.ProductId,p.CategoryId]));
      products.forEach(p=>{if(p.CategoryId==null)p.CategoryId=categories.get(p.ProductId);});
    }
    if(version!==productLoadVersion)return;
    masterProducts=products;renderProductResults();loadProductKPI();
  }catch(error){
    if(version!==productLoadVersion)return;
    masterProducts=[];productResults=[];
    tbody.innerHTML='<tr><td colspan="6" class="text-center py-5 text-danger">โหลดสินค้าไม่สำเร็จ กรุณากดรีเฟรช</td></tr>';
    if(document.getElementById('productSearchCount'))document.getElementById('productSearchCount').textContent='โหลดข้อมูลไม่สำเร็จ';
    ['productPrev','productNext'].forEach(id=>{if(document.getElementById(id))document.getElementById(id).disabled=true;});
  }
}
function scheduleProductSearch(event) {
  clearTimeout(productSearchTimer);
  if(productSearchComposing || event?.isComposing)return;
  productSearchTimer=setTimeout(()=>renderProductResults(),180);
}
function handleProductSearchKey(event) {
  if(event.isComposing || productSearchComposing)return;
  if(event.key==='Enter'){event.preventDefault();clearTimeout(productSearchTimer);renderProductResults();}
  if(event.key==='Escape'){event.preventDefault();clearProductSearch();}
}
function clearProductSearch() {
  clearTimeout(productSearchTimer);
  document.getElementById('prodSearchInput').value='';
  if(document.getElementById('prodCategoryFilter'))document.getElementById('prodCategoryFilter').value='';
  renderProductResults();document.getElementById('prodSearchInput').focus();
}
function changeProductPage(delta){productPage+=delta;renderProductResults(true);}
function editProductFromList(id){const p=masterProducts.find(p=>Number(p.ProductId || p.Id)===id);if(p)openEditProduct(p);}
function renderProductResults(keepPage=false) {
  const tbody=document.getElementById('productTableBody');if(!tbody)return;
  const query=document.getElementById('prodSearchInput')?.value || '';
  const category=document.getElementById('prodCategoryFilter')?.value || '';
  productResults=findProductResults(masterProducts,query,category);
  if(!keepPage)productPage=1;
  const paginated=Boolean(document.getElementById('productPageInfo'));
  const size=paginated?50:Math.max(1,productResults.length);
  const pages=Math.max(1,Math.ceil(productResults.length/size));productPage=Math.max(1,Math.min(productPage,pages));
  const offset=(productPage-1)*size;
  if(document.getElementById('productSearchCount'))document.getElementById('productSearchCount').textContent='พบ '+productResults.length.toLocaleString('th-TH')+' จาก '+masterProducts.length.toLocaleString('th-TH')+' สินค้า';
  if(paginated){document.getElementById('productPageInfo').textContent='หน้า '+productPage+' / '+pages;document.getElementById('productPrev').disabled=productPage===1;document.getElementById('productNext').disabled=productPage===pages;}
  if(!productResults.length){tbody.innerHTML='<tr><td colspan="6" class="text-center py-5 text-muted">'+(masterProducts.length?'ไม่พบสินค้าที่ตรงกับ '+productHtml(query?'“'+query+'”':'หมวดที่เลือก')+' · ลองใช้คำสั้นลงหรือล้างตัวกรอง':'ไม่พบข้อมูลสินค้าในระบบ')+'</td></tr>';return;}
  tbody.innerHTML=productResults.slice(offset,offset+size).map((p,index)=>{
    const id=Number(p.ProductId || p.Id);
    return '<tr><td class="text-center text-muted">'+(offset+index+1)+'</td><td>'+(p.Barcode?'<span class="barcode-pill">'+productHtml(p.Barcode)+'</span>':'—')+'</td><td><span class="code-tag">'+productHtml(p.ProductCode || p.ItemCode || '—')+'</span></td><td class="fw-semibold">'+productHtml(p.ProductName || p.ItemName || '—')+'</td><td>'+productHtml(p.ThaiName || '—')+'</td><td class="text-end">'+(document.getElementById('pane-stock')?'<button type="button" class="btn btn-sm btn-outline-warning me-1" onclick="openProductStockAdjust('+id+')" title="ปรับยอดสต๊อก"><i class="bi bi-sliders me-1"></i>Adj</button>':'')+'<button type="button" class="btn btn-sm btn-outline-primary border-0 me-1" onclick="editProductFromList('+id+')" title="แก้ไข"><i class="bi bi-pencil-square"></i></button><button type="button" class="btn btn-sm btn-outline-danger border-0" onclick="deleteProduct('+id+')" title="ลบ"><i class="bi bi-trash"></i></button></td></tr>';
  }).join('');
}
function exportProductsToExcel() {
  clearTimeout(productSearchTimer);renderProductResults(true);
  if(!productResults.length){Swal.fire('ไม่พบข้อมูล','ไม่มีผลค้นหาสำหรับส่งออก','info');return;}
  const records=[['บาร์โค้ด','รหัสสินค้า','ชื่อสินค้า','ชื่อภาษาไทย'],...productResults.map(p=>[p.Barcode,p.ProductCode || p.ItemCode,p.ProductName || p.ItemName,p.ThaiName])];
  const cell=value=>'"'+String(value??'').replace(/^(\s*[=+@-]|[\t\r\n])/,"'$&").replace(/"/g,'""')+'"';
  const blob=new Blob(['\uFEFF'+records.map(row=>row.map(cell).join(',')).join('\r\n')],{type:'text/csv;charset=utf-8;'});
  const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='Product_Master_'+new Date().toISOString().slice(0,10)+'.csv';document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
}

// 3. โหลด KPI ภาพรวมสินค้า
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

// 4. ฟังก์ชันเปิดหน้าต่างเพิ่มสินค้า
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

// 5. ฟังก์ชันเปิดหน้าต่างแก้ไขสินค้า
function openEditProduct(p) {
  editingProductId = p.ProductId || p.Id;
  let modalEl = document.getElementById('productModal');
  if (!modalEl) { createProductModalDOM(); modalEl = document.getElementById('productModal'); }

  const pCode = p.ProductCode || p.ItemCode || '';
  document.getElementById('productModalTitle').textContent = 'แก้ไขสินค้า: ' + pCode;
  document.getElementById('modalProductBarcode').value = p.Barcode || '';
  document.getElementById('modalProductCode').value = pCode;
  document.getElementById('modalProductCode').disabled = true; // ล็อคไม่ให้แก้รหัสสินค้า
  document.getElementById('modalProductName').value = p.ProductName || p.ItemName || '';
  document.getElementById('modalProductThaiName').value = p.ThaiName || '';

  new bootstrap.Modal(modalEl).show();
}

// 6. บันทึกข้อมูลสินค้า
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

// 7. ลบสินค้า (เฉพาะ ADMIN)
async function deleteProduct(id) {
  const r = await Swal.fire({
    title: 'ยืนยันการลบสินค้า?',
    text: 'คุณต้องการปิดใช้งานสินค้านี้ใช่หรือไม่',
    icon: 'warning',
    showCancelButton: true,
    confirmButtonColor: '#ef4444',
    cancelButtonColor: '#6b7280',
    confirmButtonText: 'ลบ',
    cancelButtonText: 'ยกเลิก'
  });

  if (!r.isConfirmed) return;

  try {
    const res = await fetch(`/api/products/${id}`, { method: 'DELETE', headers: authHeaders() });
    const data = await res.json();

    if (!res.ok) {
      Swal.fire('ผิดพลาด', data.message || data.error || 'ลบไม่สำเร็จ', 'error');
      return;
    }

    Swal.fire({ icon: 'success', title: 'ลบสำเร็จ', timer: 1500, showConfirmButton: false });
    loadMasterProducts();
  } catch (err) {
    console.error('deleteProduct Error:', err);
    Swal.fire('ผิดพลาด', 'เกิดข้อผิดพลาดในการเชื่อมต่อ', 'error');
  }
}

// 8. สร้าง DOM Modal จัดการสินค้า
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
              <input type="text" id="modalProductName" class="form-control" placeholder="เช่น LALIZA CLEAR PORE MICELLAR..." required>
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
// Stock adjustment from the Admin product list.
let productAdjustmentContext = null;
let productAdjustmentSaving = false;
let productAdjustmentRequest = 0;
function createStockAdjustmentModal() {
  if (document.getElementById('productStockAdjustModal')) return;
  const container = document.createElement('div');
  container.innerHTML = `<div class="modal fade" id="productStockAdjustModal" tabindex="-1" aria-labelledby="productStockAdjustTitle" data-bs-backdrop="static" data-bs-keyboard="false"><div class="modal-dialog modal-dialog-centered modal-dialog-scrollable"><form class="modal-content" onsubmit="saveProductStockAdjustment(event)">
    <div class="modal-header"><div><h5 class="modal-title fw-bold" id="productStockAdjustTitle">ปรับยอดสต๊อก</h5><div class="adj-caption">ระบุจำนวนที่ตรวจนับได้จริงในตำแหน่งที่เลือก</div></div><button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="ปิด" data-adjust-dismiss></button></div>
    <div class="modal-body">
      <div class="adj-product"><span class="adj-product-icon"><i class="bi bi-box-seam"></i></span><div><div class="fw-semibold" id="adjProductLabel">กำลังโหลดสินค้า...</div><div class="adj-caption" id="adjProductInfo"></div></div></div>
      <div id="adjFeedback" class="small text-muted" role="status" aria-live="polite"></div>
      <fieldset id="adjFields" disabled>
        <div class="adj-step-title"><span>1</span> เลือกตำแหน่งสินค้า</div>
        <div class="row g-2"><div class="col-sm-5"><label for="adjWarehouseSelect" class="form-label">คลังสินค้า</label><select id="adjWarehouseSelect" class="form-select" onchange="updateAdjustmentLocations()" required></select></div><div class="col-sm-7"><label for="adjLocationSelect" class="form-label">ตำแหน่งจัดเก็บ</label><select id="adjLocationSelect" class="form-select" onchange="updateAdjustmentQuantity()" required></select></div></div>
        <div class="adj-step-title"><span>2</span> ระบุยอดคงเหลือใหม่</div>
        <div class="adj-quantity-grid"><div class="adj-quantity-card"><label for="adjPreviousQty" class="form-label">ยอดในระบบ</label><input id="adjPreviousQty" value="0.00" readonly tabindex="-1"></div><div class="adj-quantity-card adj-quantity-new"><label for="adjNewQuantity" class="form-label">ยอดที่นับได้จริง *</label><input id="adjNewQuantity" type="number" min="0" max="999999999999.99" step="0.01" inputmode="decimal" required oninput="updateAdjustmentDifference()" placeholder="ใส่จำนวน" aria-describedby="adjQuantityHelp"></div><div class="adj-quantity-card"><label for="adjQuantityDifference" class="form-label">ปรับเพิ่ม / ลด</label><input id="adjQuantityDifference" value="—" readonly tabindex="-1" aria-live="polite"></div></div>
        <div id="adjQuantityHelp" class="adj-caption mt-2">ใส่ยอดสุดท้ายที่ต้องการให้เหลือ เช่น นับได้ 25 ให้ใส่ 25</div>
        <div class="adj-step-title"><span>3</span> ระบุเหตุผล</div>
        <div class="d-flex flex-wrap gap-2 mb-2" aria-label="เหตุผลที่ใช้บ่อย"><button type="button" class="adj-reason-chip" onclick="setAdjustmentReason('ตั้งยอดยกมา')">ตั้งยอดยกมา</button><button type="button" class="adj-reason-chip" onclick="setAdjustmentReason('ปรับตามผลตรวจนับจริง')">ตรวจนับจริง</button><button type="button" class="adj-reason-chip" onclick="setAdjustmentReason('สินค้าชำรุด / เสียหาย')">สินค้าชำรุด</button></div>
        <label for="adjReason" class="visually-hidden">เหตุผลการปรับยอด *</label><textarea id="adjReason" class="form-control" rows="2" maxlength="255" required placeholder="เลือกเหตุผลด้านบน หรือพิมพ์เหตุผลอื่น..."></textarea>
        <details id="adjReferenceDetails" class="mt-3"><summary class="adj-caption">เพิ่มเลขที่เอกสารอ้างอิง (ถ้ามี)</summary><label for="adjReference" class="visually-hidden">เลขที่เอกสารอ้างอิง</label><input id="adjReference" class="form-control mt-2" maxlength="60" placeholder="เลขที่เอกสาร"></details>
      </fieldset>
    </div>
    <div class="modal-footer"><div id="adjSaveSummary" class="adj-caption me-auto" role="status" aria-live="polite">ยังไม่ระบุยอดใหม่</div><button type="button" class="btn btn-outline-secondary" data-bs-dismiss="modal" data-adjust-dismiss>ยกเลิก</button><button id="adjSaveButton" type="submit" class="btn btn-primary" disabled><i class="bi bi-check2 me-1"></i>บันทึกยอดใหม่</button></div>
  </form></div></div>`;
  document.body.appendChild(container);
}
async function openProductStockAdjust(productId) {
  if (productAdjustmentSaving) return;
  createStockAdjustmentModal();
  const request = ++productAdjustmentRequest;
  productAdjustmentContext = null;
  document.getElementById('adjFields').disabled = true;
  document.getElementById('adjSaveButton').disabled = true;
  document.getElementById('adjProductLabel').textContent = 'กำลังโหลดสินค้า...';
  document.getElementById('adjProductInfo').textContent = '';
  document.getElementById('adjFeedback').textContent = 'กำลังโหลดคลัง โลเคชั่น และยอดปัจจุบัน...';
  document.getElementById('adjReason').value = '';
  document.getElementById('adjReference').value = '';
  document.getElementById('adjReferenceDetails').open = false;
  document.getElementById('adjSaveSummary').textContent = 'ยังไม่ระบุยอดใหม่';
  bootstrap.Modal.getOrCreateInstance(document.getElementById('productStockAdjustModal')).show();
  try {
    const response = await fetch('/api/stock/adjustment-context/' + productId, {headers: authHeaders()});
    const data = await response.json().catch(() => ({}));
    if (request !== productAdjustmentRequest) return;
    if (!response.ok || !data.success) throw new Error(data.message || 'โหลดข้อมูลไม่สำเร็จ กรุณารีสตาร์ทเซิร์ฟเวอร์และลองอีกครั้ง');
    productAdjustmentContext = data;
    document.getElementById('adjProductLabel').textContent = data.product.ProductCode + ' · ' + data.product.ProductName;
    document.getElementById('adjProductInfo').textContent = [data.product.ThaiName, data.product.Barcode, data.product.UOM].filter(Boolean).join(' · ');
    const warehouses = document.getElementById('adjWarehouseSelect'); warehouses.replaceChildren();
    data.warehouses.forEach(w => warehouses.add(new Option(w.whname, w.whid)));
    document.getElementById('adjFields').disabled = !data.product.IsActive;
    document.getElementById('adjSaveButton').disabled = !data.product.IsActive;
    document.getElementById('adjFeedback').className = 'small text-muted';
    document.getElementById('adjFeedback').textContent = data.product.IsActive ? '' : 'สินค้าถูกปิดใช้งาน ไม่สามารถปรับยอดได้';
    updateAdjustmentLocations();
  } catch (error) { if (request===productAdjustmentRequest) {document.getElementById('adjFeedback').className='small text-danger';document.getElementById('adjFeedback').textContent=error.message;} }
}
function updateAdjustmentLocations() {
  if (!productAdjustmentContext) return;
  const whid = Number(document.getElementById('adjWarehouseSelect').value);
  const select = document.getElementById('adjLocationSelect'); select.replaceChildren();
  productAdjustmentContext.locations.filter(loc => loc.whid===whid).forEach(loc => select.add(new Option(loc.LocationCode,loc.LocationCode)));
  if (!select.options.length) select.add(new Option('ไม่มีโลเคชั่นที่เปิดใช้งาน',''));
  document.getElementById('adjSaveButton').disabled = !select.value || !productAdjustmentContext.product.IsActive;
  updateAdjustmentQuantity();
}
function updateAdjustmentQuantity() {
  if (!productAdjustmentContext) return;
  const whid = Number(document.getElementById('adjWarehouseSelect').value);
  const location = document.getElementById('adjLocationSelect').value;
  const row = productAdjustmentContext.stock.find(s => s.whid===whid && s.LocationCode===location);
  document.getElementById('adjPreviousQty').value = Number(row?.Quantity || 0).toFixed(2);
  document.getElementById('adjNewQuantity').value = '';
  updateAdjustmentDifference();
}
function updateAdjustmentDifference() {
  const text = document.getElementById('adjNewQuantity').value;
  const diff = Number(text) - Number(document.getElementById('adjPreviousQty').value);
  document.getElementById('adjQuantityDifference').value = text==='' || !Number.isFinite(diff) ? '—' : (diff>0?'+':'') + diff.toFixed(2);
  const valid = text !== '' && Number.isFinite(Number(text)) && Number(text) >= 0;
  const summary = document.getElementById('adjSaveSummary');
  if (summary) summary.textContent = valid ? 'ยอดใหม่ ' + Number(text).toLocaleString('th-TH') + ' · ' + (diff > 0 ? 'เพิ่ม ' : diff < 0 ? 'ลด ' : 'เท่าเดิม ') + Math.abs(diff).toLocaleString('th-TH') : 'ยังไม่ระบุยอดใหม่';
  document.getElementById('adjQuantityDifference').style.color = diff > 0 ? '#15803d' : diff < 0 ? '#b91c1c' : '#64748b';
}
function setAdjustmentReason(reason) {
  document.getElementById('adjReason').value = reason;
  document.getElementById('adjReason').focus();
}
async function saveProductStockAdjustment(event) {
  event.preventDefault();
  if (!productAdjustmentContext || productAdjustmentSaving) return;
  const payload = {productId:productAdjustmentContext.product.ProductId,whid:Number(document.getElementById('adjWarehouseSelect').value),locationCode:document.getElementById('adjLocationSelect').value,quantity:document.getElementById('adjNewQuantity').value,expectedQuantity:document.getElementById('adjPreviousQty').value,remark:document.getElementById('adjReason').value.trim(),referenceNo:document.getElementById('adjReference').value.trim()};
  if (!payload.remark || !/^\d{1,12}(?:\.\d{1,2})?$/.test(payload.quantity) || !payload.locationCode) {document.getElementById('adjFeedback').textContent='กรุณาระบุยอดใหม่ไม่ติดลบ ทศนิยมไม่เกิน 2 ตำแหน่ง และเหตุผล';return;}
  productAdjustmentSaving = true;
  document.getElementById('adjFields').disabled = true;
  document.getElementById('adjSaveButton').disabled = true;
  document.querySelectorAll('[data-adjust-dismiss]').forEach(b=>b.disabled=true);
  const feedback = document.getElementById('adjFeedback'); feedback.className='small mb-3 text-muted'; feedback.textContent='กำลังบันทึก...';
  try {
    const response = await fetch('/api/stock/adjust',{method:'POST',headers:authHeaders(),body:JSON.stringify(payload)});
    const data = await response.json().catch(()=>({}));
    if (!response.ok || !data.success) throw new Error(data.message || 'บันทึกไม่สำเร็จ กรุณาปิดและเปิดฟอร์มใหม่เพื่อตรวจยอดล่าสุด');
    // Reload authoritative balance before allowing another adjustment.
    bootstrap.Modal.getInstance(document.getElementById('productStockAdjustModal')).hide();
    productAdjustmentContext = null;
    if (typeof adminReportReady !== 'undefined') adminReportReady = false;
    Swal.fire({icon:'success',title:data.changed?'ปรับยอดสต๊อกสำเร็จ':'ยอดเท่าเดิม ไม่มีการเปลี่ยนแปลง',text:'ยอดใหม่ ' + Number(data.newQuantity).toLocaleString('th-TH') + ' · ผลต่าง ' + Number(data.change).toLocaleString('th-TH')});
  } catch (error) {
    feedback.className='small mb-3 text-danger';feedback.textContent=error.message;
    // Close and reopen to obtain a fresh expected balance after conflict/network errors.
    productAdjustmentContext=null;
  } finally {
    productAdjustmentSaving=false;
    document.querySelectorAll('[data-adjust-dismiss]').forEach(b=>b.disabled=false);
  }
}
