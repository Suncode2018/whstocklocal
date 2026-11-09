let productCategoryCache=[],productRightsSignature='';
function applyProductCategoryVisibility(){
 const template=document.getElementById('prodKpiPKG')?.closest('.col-6');
 for(const code of ['SEMI','BULK'])if(template&&!document.getElementById('prodKpi'+code)){
 const card=template.cloneNode(true);card.innerHTML=card.innerHTML.replaceAll('prodKpiPKG','prodKpi'+code).replace('บรรจุภัณฑ์ (PKG)',code==='SEMI'?'กึ่งสำเร็จรูป (SEMI)':'ผลิตภัณฑ์ Bulk (BULK)');const icon=card.querySelector('.stat-icon i');if(icon)icon.className=code==='SEMI'?'bi bi-layers':'bi bi-droplet';template.parentElement.append(card);
 }
const select=document.getElementById('prodCategoryFilter');if(select){const selected=select.value,visible=productCategoryCache.filter(c=>productCategoryAllowed(c.CategoryId,'VIEW'));select.innerHTML='<option value="">ทุกหมวดที่มีสิทธิ์</option>'+visible.map(c=>'<option value="'+Number(c.CategoryId)+'">'+productHtml(c.CategoryName)+' ('+productHtml(c.CategoryCode)+')</option>').join('');select.value=visible.some(c=>String(c.CategoryId)===selected)?selected:'';select.disabled=!visible.length;}
for(const code of ['RM','PKG','FG','SEMI','BULK']){const card=document.getElementById('prodKpi'+code)?.closest('.col-6');if(card){const category=productCategoryCache.find(c=>c.CategoryCode===code);card.hidden=!category||!productCategoryAllowed(category.CategoryId,'VIEW');}}
}
window.addEventListener('wms-navigation',e=>{const menu=e.detail.menus.find(m=>m.code==='PRODUCTS'),signature=JSON.stringify({role:e.detail.user.role,categories:menu?.categories||[]});applyProductCategoryVisibility();if(signature!==productRightsSignature){productRightsSignature=signature;if(menu&&document.getElementById('productTableBody'))loadMasterProducts();}});
function productCategoryAllowed(category,action){if(typeof wmsNavigation==='undefined'||!wmsNavigation)return false;if(wmsNavigation.user.role==='ADMIN')return true;return !!wmsNavigation.menus.find(m=>m.code==='PRODUCTS')?.categories?.find(c=>Number(c.id)===Number(category))?.actions?.[action]}
function setupProductCategory(category){let el=document.getElementById('modalProductCategory');if(!el){const field=document.createElement('div');field.className='product-editor-wide';field.innerHTML='<label for="modalProductCategory" class="form-label">กลุ่มสินค้า *</label><select id="modalProductCategory" class="form-select"></select>';document.getElementById('productBasicFields').prepend(field);el=document.getElementById('modalProductCategory')}const categories=typeof wmsNavigation!=='undefined'?wmsNavigation?.menus.find(m=>m.code==='PRODUCTS')?.categories||[]:[];el.innerHTML=categories.filter(c=>productCategoryAllowed(c.id,'EDIT')).map(c=>'<option value="'+Number(c.id)+'">'+productHtml(c.name)+' ('+productHtml(c.code)+')</option>').join('');if(category)el.value=category;el.disabled=!!category;el.onchange=()=>{setupProductSupplier(null);setupProductRMSpec()};}
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
function productSearchFields(p,mode='code') {
 const source=p.SourceMaster||{};
 const codes=[p.ProductCode??p.ItemCode,p.ProID1??source.Code1,p.ProID2??source.Code2,p.ProID3??source.Code3,p.ProID4??source.Code4];
 const names=[p.ProductName??p.ItemName,p.ThaiName,p.ProductName1??source.Name1,p.ProductName2??source.Name2];
 return (mode==='name'?names:mode==='barcode'?[p.Barcode]:codes).map(productText).filter(Boolean);
}
function changeProductSearchMode(){
 const mode=document.getElementById('prodSearchMode')?.value||'code',input=document.getElementById('prodSearchInput');
 const hints={code:'ProductCode / ProID1 / ProID2 / ProID3 / ProID4',name:'ProductName / ThaiName / ProductName1 / ProductName2',barcode:'Barcode · พิมพ์หรือสแกนบาร์โค้ด'};
 if(input)input.placeholder=mode==='code'?'พิมพ์รหัสสินค้า':mode==='name'?'พิมพ์ชื่อสินค้า ไทย/อังกฤษ หรือชื่อบางส่วน':'พิมพ์หรือสแกนบาร์โค้ด';
 const help=document.getElementById('productSearchHelp');if(help)help.textContent=hints[mode]+' · ค้นหาได้หลายคำ · Enter ค้นหาทันที · Esc ล้างตัวกรอง';
 clearTimeout(productSearchTimer);renderProductResults();input?.focus();
}
function findProductResults(products, query, category, stockStatus = '', searchMode='code') {
  const q=productText(query);const words=q.split(' ').filter(Boolean);
  return products.map((p,index)=>{
    const fields=productSearchFields(p,searchMode);
    const score=q&&fields.some(value=>value===q)?0:q&&fields.some(value=>value.startsWith(q))?1:2;
    const quantity=Number(p.TotalStock ?? 0), min=Number(p.MinStock ?? 0);
    const stockMatch=!stockStatus || (p.TotalStock!=null && (stockStatus==='available'?quantity>0:stockStatus==='empty'?quantity<=0:stockStatus==='low'?min>0 && quantity<min:false));
    return {p,index,score,match:stockMatch && (!category || String(p.CategoryId)===category) && words.every(word=>fields.some(value=>value.includes(word)))};
  }).filter(row=>row.match).sort((a,b)=>a.score-b.score || a.index-b.index).map(row=>row.p);
}
async function loadMasterProducts() {
  const tbody=document.getElementById('productTableBody');if(!tbody)return;
  const version=++productLoadVersion;
  tbody.innerHTML='<tr><td colspan="'+(document.getElementById('prodStockColumn')?7:6)+'" class="text-center py-5 text-muted">กำลังโหลดข้อมูลสินค้า...</td></tr>';
  if(document.getElementById('productSearchCount'))document.getElementById('productSearchCount').textContent='กำลังโหลดสินค้า...';
  try {
    const cr=await fetch('/api/master/categories',{headers:authHeaders()});if(!cr.ok)throw Error('โหลดหมวดสินค้าไม่สำเร็จ');const cb=await cr.json();if(version!==productLoadVersion)return;productCategoryCache=cb.data;applyProductCategoryVisibility();
    const res=await fetch('/api/products',{headers:authHeaders()});
    if(!res.ok)throw Error('โหลดสินค้าไม่สำเร็จ');
    const payload=await res.json();const products=Array.isArray(payload)?payload:payload.data;
    if(!Array.isArray(products))throw Error('รูปแบบข้อมูลสินค้าไม่ถูกต้อง');
    await supplementProductReferences(products);if(version!==productLoadVersion)return;
    // Attach live stock for filters; retain the legacy category fallback for older servers.
    if(document.getElementById('prodStockFilter') || (document.getElementById('prodCategoryFilter') && products.some(p=>p.CategoryId==null))){
      const r=await fetch('/api/stock/balance',{headers:authHeaders()});
      if(!r.ok)throw Error('โหลดสถานะสต๊อกไม่สำเร็จ กรุณารีเฟรชอีกครั้ง');
      const balance=await r.json();if(balance.success===false || !Array.isArray(balance.data))throw Error('ข้อมูลสต๊อกไม่ถูกต้อง');
      const stocks=new Map(balance.data.map(p=>[p.ProductId,p]));
      products.forEach(p=>{if(p.MasterStatus==='DRAFT'){p.TotalStock=null;return;}const stock=stocks.get(p.ProductId);if(!stock){if(p.MasterStatus==='DRAFT'){p.TotalStock=null;return;}throw Error('ไม่พบยอดสต๊อกของสินค้าบางรายการ กรุณารีเฟรช');}p.TotalStock=Number(stock.TotalStock);p.TransitStock=Number(stock.TransitStock||0);p.OwnedStock=Number(stock.OwnedStock??stock.TotalStock);p.StockUOM=stock.UOM || p.PackageType || '';p.MinStock=Number(stock.MinStock || 0);if(p.CategoryId==null)p.CategoryId=stock.CategoryId;});
    }
    if(version!==productLoadVersion)return;
    masterProducts=products;renderProductResults();loadProductKPI();
  }catch(error){
    if(version!==productLoadVersion)return;
    masterProducts=[];productResults=[];
    tbody.innerHTML='<tr><td colspan="'+(document.getElementById('prodStockColumn')?7:6)+'" class="text-center py-5 text-danger">โหลดสินค้าไม่สำเร็จ กรุณากดรีเฟรช</td></tr>';
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
  if(document.getElementById('prodStockFilter'))document.getElementById('prodStockFilter').value='';
  renderProductResults();document.getElementById('prodSearchInput').focus();
}
function changeProductPage(delta){productPage+=delta;renderProductResults(true);}
function editProductFromList(id){const p=masterProducts.find(p=>Number(p.ProductId || p.Id)===id);if(p)openEditProduct(p);}
function renderProductResults(keepPage=false) {
  const tbody=document.getElementById('productTableBody');if(!tbody)return;
  const query=document.getElementById('prodSearchInput')?.value || '';
  const category=document.getElementById('prodCategoryFilter')?.value || '';
  productResults=findProductResults(masterProducts,query,category,document.getElementById('prodStockFilter')?.value || '',document.getElementById('prodSearchMode')?.value || 'code');
  if(!keepPage)productPage=1;
  const paginated=Boolean(document.getElementById('productPageInfo'));
  const size=paginated?50:Math.max(1,productResults.length);
  const pages=Math.max(1,Math.ceil(productResults.length/size));productPage=Math.max(1,Math.min(productPage,pages));
  const offset=(productPage-1)*size;
  if(document.getElementById('productSearchCount'))document.getElementById('productSearchCount').textContent='พบ '+productResults.length.toLocaleString('th-TH')+' จาก '+masterProducts.length.toLocaleString('th-TH')+' สินค้า';
  if(paginated){document.getElementById('productPageInfo').textContent='หน้า '+productPage+' / '+pages;document.getElementById('productPrev').disabled=productPage===1;document.getElementById('productNext').disabled=productPage===pages;}
  if(!productResults.length){tbody.innerHTML='<tr><td colspan="'+(document.getElementById('prodStockColumn')?7:6)+'" class="text-center py-5 text-muted">'+(masterProducts.length?'ไม่พบสินค้าที่ตรงกับ '+productHtml(query?'“'+query+'”':'ตัวกรองที่เลือก')+' · ลองใช้คำสั้นลงหรือล้างตัวกรอง':'ไม่พบข้อมูลสินค้าในระบบ')+'</td></tr>';return;}
  tbody.innerHTML=productResults.slice(offset,offset+size).map((p,index)=>{
    const id=Number(p.ProductId || p.Id);
    return '<tr><td class="text-center text-muted">'+(offset+index+1)+'</td><td>'+(p.Barcode?'<span class="barcode-pill">'+productHtml(p.Barcode)+'</span>':'—')+'</td><td>'+renderProductCodes(p)+'</td><td>'+renderProductNames(p)+'</td><td>'+productSQLValue(productSQLField(p,'ThaiName',null))+'</td>'+productStockQuantityCell(p)+'<td class="text-end">'+(document.getElementById('pane-stock')&&productCategoryAllowed(p.CategoryId,'CONFIRM')?'<button type="button" class="btn btn-sm btn-outline-warning me-1" onclick="openProductStockAdjust('+id+')" title="ปรับยอดสต๊อก"><i class="bi bi-sliders me-1"></i>Adj</button>':'')+'<button type="button" class="btn btn-sm btn-outline-primary border-0 me-1" onclick="editProductFromList('+id+')" title="แก้ไข"><i class="bi bi-pencil-square"></i></button><button type="button" class="btn btn-sm btn-outline-danger border-0" onclick="deleteProduct('+id+')" title="ลบ"><i class="bi bi-trash"></i></button></td></tr>';
  }).join('');
}
// Preserve SQL field values: fallback only when a column is absent, never for NULL/empty.
function productSQLField(p,key,fallback){const actual=Object.keys(p).find(k=>k.toLowerCase()===key.toLowerCase());return actual===undefined?fallback:p[actual]}
function productSQLValue(value){return value===null?'<span class="product-sql-empty">NULL</span>':value===undefined||String(value).trim()===''?'<span class="product-sql-empty">—</span>':productHtml(value)}
function renderProductCodes(p){
 const source=p.SourceMaster||{};
 const values=[['ProductCode',productSQLField(p,'ProductCode',p.ItemCode)],...[1,2,3,4].map(i=>['ProID'+i,productSQLField(p,'ProID'+i,source['Code'+i])])];
 return '<div class="product-code-list">'+values.map(([label,value])=>'<div class="product-code-item"><span class="'+(label==='ProductCode'?'code-tag':'product-reference-code')+'">'+productSQLValue(value)+'</span></div>').join('')+'</div>';
}
function renderProductNames(p){
 const source=p.SourceMaster||{},values=[['ProductName',productSQLField(p,'ProductName',p.ItemName)],['ProductName1',productSQLField(p,'ProductName1',source.Name1)],['ProductName2',productSQLField(p,'ProductName2',source.Name2)]];
 return '<div class="product-name-list">'+values.map(([label,value])=>'<div class="product-name-item"><div class="'+(label==='ProductName'?'fw-semibold':'product-secondary-name')+'">'+productSQLValue(value)+'</div></div>').join('')+'</div>'+(p.MasterStatus==='DRAFT'?'<span class="badge bg-warning text-dark mt-2">ร่าง</span>':'');
}
async function supplementProductReferences(products){
 // Older running Node processes may serve the previous /products response shape.
 if(products.some(p=>['ProID1','ProID2','ProID3','ProID4'].some(k=>Object.hasOwn(p,k))))return;
 if(products.some(p=>[1,2,3,4].some(i=>Object.hasOwn(p.SourceMaster||{},'Code'+i))))return;
 const response=await fetch('/api/products/source-master',{headers:authHeaders()});
 if(!response.ok)throw Error('API ยังส่งรหัสอ้างอิงไม่ครบ กรุณารีสตาร์ทเซิร์ฟเวอร์');
 const body=await response.json();if(!Array.isArray(body.data))throw Error('ข้อมูลรหัสอ้างอิงไม่ถูกต้อง');
 const byProduct=new Map();for(const entry of body.data){if(entry.ProductId!=null&&!byProduct.has(Number(entry.ProductId)))byProduct.set(Number(entry.ProductId),entry);}
 for(const product of products){const entry=byProduct.get(Number(product.ProductId));if(!entry)continue;for(let i=1;i<=4;i++)product['ProID'+i]=entry['Code'+i]||'';}
}
function productStockQuantityCell(p) {
  if(p.MasterStatus==='DRAFT')return document.getElementById('prodStockColumn')?'<td class="text-end text-muted"><span class="badge bg-light text-secondary">ร่าง · ยังไม่เปิดรับ–จ่าย</span></td>':'';
  if (!document.getElementById('prodStockColumn')) return '';
  const known = p.TotalStock != null && Number.isFinite(Number(p.TotalStock));
  const qty = known ? Number(p.TotalStock) : null;
  const color = !known ? 'text-muted' : qty <= 0 ? 'text-danger' : Number(p.MinStock)>0 && qty<Number(p.MinStock) ? 'text-warning' : 'text-success';
  return '<td class="text-end text-nowrap"><div class="fw-bold '+color+'" style="font-size:1.05rem;font-variant-numeric:tabular-nums">'+(known?qty.toLocaleString('th-TH',{maximumFractionDigits:2}):'—')+'</div><small class="text-muted">'+productHtml(p.StockUOM || p.PackageType || '')+'</small><div><button type="button" class="btn btn-sm btn-link p-0" onclick="showStockBoxDetails('+Number(p.ProductId||p.Id)+')">ดู PO / Lot / กล่อง</button></div>'+(Number(p.TransitStock)>0?'<div class="small text-warning mt-1">ระหว่างโอน '+Number(p.TransitStock).toLocaleString('th-TH')+'</div><div class="small text-muted">รวมถือครอง '+Number(p.OwnedStock).toLocaleString('th-TH')+'</div>':'')+'</td>';
}
function exportProductsToExcel() {
  clearTimeout(productSearchTimer);renderProductResults(true);
  if(!productResults.length){Swal.fire('ไม่พบข้อมูล','ไม่มีผลค้นหาสำหรับส่งออก','info');return;}
  const exportRows=productResults.filter(p=>productCategoryAllowed(p.CategoryId,'EXPORT'));
  if(!exportRows.length){Swal.fire('ไม่มีสิทธิ์ส่งออก','ไม่มีสินค้าที่อนุญาตให้ส่งออก','info');return;}
  const records=[['บาร์โค้ด','รหัสสินค้า','ชื่อสินค้า','ชื่อภาษาไทย','สต๊อกคงเหลือ (รวมทุกคลัง)','หน่วย'],...exportRows.map(p=>[p.Barcode,p.ProductCode || p.ItemCode,p.ProductName || p.ItemName,p.ThaiName,p.TotalStock ?? '',p.StockUOM || p.PackageType || ''])];
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

    for(const [code,key]of [['SEMI','TotalSEMI'],['BULK','TotalBULK']])if(document.getElementById('prodKpi'+code))document.getElementById('prodKpi'+code).textContent=Number(kpi[key]||0).toLocaleString('th-TH');
    if (document.getElementById('prodKpiTotal')) document.getElementById('prodKpiTotal').textContent = Number(kpi.TotalCount || 0).toLocaleString('th-TH');
    if (document.getElementById('prodKpiRM')) document.getElementById('prodKpiRM').textContent = Number(kpi.TotalRM || 0).toLocaleString('th-TH');
    if (document.getElementById('prodKpiPKG')) document.getElementById('prodKpiPKG').textContent = Number(kpi.TotalPKG || 0).toLocaleString('th-TH');
    if (document.getElementById('prodKpiFG')) document.getElementById('prodKpiFG').textContent = Number(kpi.TotalFG || 0).toLocaleString('th-TH');
  } catch (e) {
    console.warn('loadProductKPI Error:', e);
  }
}

// 4. ฟังก์ชันเปิดหน้าต่างเพิ่มสินค้า
async function openAddProduct() {
  editingProductId = null;
  let modalEl = document.getElementById('productModal');
  if (!modalEl) { createProductModalDOM(); modalEl = document.getElementById('productModal'); }

  setupProductMasterFields();setupProductCategory();document.getElementById('productModalTitle').textContent = 'เพิ่มสินค้าใหม่';
  document.getElementById('modalProductBarcode').value = '';
  document.getElementById('modalProductCode').value = '';
  document.getElementById('modalProductCode').disabled = false;
  document.getElementById('modalProductName').value = '';
  document.getElementById('modalProductThaiName').value = '';

  if(!await setupProductUnit(null))return;
  if(!await setupProductSupplier(null))return;if(!await setupProductRMSpec())return;setupProductVolume(null);await loadProductPackVersions(null);switchProductEditorTab('Basic');
  bootstrap.Modal.getOrCreateInstance(modalEl).show();
}

// 5. ฟังก์ชันเปิดหน้าต่างแก้ไขสินค้า
async function openEditProduct(p) {
  editingProductId = p.ProductId || p.Id;
  let modalEl = document.getElementById('productModal');
  if (!modalEl) { createProductModalDOM(); modalEl = document.getElementById('productModal'); }

  setupProductMasterFields(p);setupProductCategory(p.CategoryId);const pCode = p.ProductCode || p.ItemCode || '';
  document.getElementById('productModalTitle').textContent = 'แก้ไขสินค้า: ' + (pCode||'#'+editingProductId);
  document.getElementById('modalProductBarcode').value = p.Barcode || '';
  document.getElementById('modalProductCode').value = pCode;
  document.getElementById('modalProductCode').disabled = p.MasterStatus!=='DRAFT';
  document.getElementById('modalProductName').value = p.ProductName || p.ItemName || '';
  document.getElementById('modalProductThaiName').value = p.ThaiName || '';

  if(!await setupProductUnit(p.UnitId))return;
  if(!await setupProductSupplier(p.SupplierId))return;if(!await setupProductRMSpec(editingProductId))return;setupProductVolume(p.UnitVolumeCm3);await loadProductEditorPackVersions(editingProductId,p.UnitId);switchProductEditorTab('Basic');
  bootstrap.Modal.getOrCreateInstance(modalEl).show();
}

// 6. บันทึกข้อมูลสินค้า
async function saveProduct() {
  const barcode = document.getElementById('modalProductBarcode').value.trim();
  const productCode = document.getElementById('modalProductCode').value.trim();
  const productName = document.getElementById('modalProductName').value.trim();
  const thaiName = document.getElementById('modalProductThaiName').value.trim();

  const masterStatus=document.getElementById('modalProductStatus').value;
  if (!productName || (masterStatus==='READY'&&!productCode)) {
    switchProductEditorTab('Basic');
    Swal.fire('แจ้งเตือน', 'กรุณากรอกรหัสสินค้าและชื่อสินค้า', 'warning');
    return;
  }

  const payload = {
    ...productMasterFieldsPayload(),masterStatus,
    categoryId:Number(document.getElementById('modalProductCategory').value),
    unitId:document.getElementById('modalProductUnit').value?Number(document.getElementById('modalProductUnit').value):null,
    unitVolumeCm3:document.getElementById('productUnitVolume').value.trim()||null,
    supplierId:document.getElementById('modalProductSupplier').value?Number(document.getElementById('modalProductSupplier').value):null,
    productCode,
    productName,
    thaiName: thaiName || null,
    barcode: barcode || null
  };

  if(masterStatus==='READY'&&(!Number.isInteger(payload.unitId)||payload.unitId<=0)){await Swal.fire('เลือกหน่วยนับ','กรุณาเลือกหน่วยนับจากรายการก่อนบันทึก','warning');document.getElementById('modalProductUnit').focus();return;}
  if(document.getElementById('modalProductSupplier').disabled||document.getElementById('modalProductSupplier').dataset.ready!=='true'){await Swal.fire('โหลดผู้จำหน่ายไม่สำเร็จ','กรุณาเปิดฟอร์มใหม่เพื่อโหลดรายการผู้จำหน่ายก่อนบันทึก','warning');return;}
  if(productRMVisible()){if(!productRMSpecReady){await Swal.fire('โหลดหน่วยบรรจุไม่สำเร็จ','กรุณาเปิดฟอร์มสินค้าใหม่','warning');return;}if(document.getElementById('productRMEnabled').checked){if(!payload.unitId){switchProductEditorTab('Basic');await Swal.fire('เลือกหน่วยสต๊อก','ต้องเลือกหน่วยสต๊อกก่อนกำหนดหน่วยบรรจุ RM','warning');return;}payload.rmPackSpec={packUnit:document.getElementById('productRMPack').value.trim(),contentPerPack:document.getElementById('productRMPer').value,contentUnit:document.getElementById('productRMContentUnit').value.trim().toUpperCase(),basePerContentUnit:document.getElementById('productRMFactor').value,...(productRMSpecRevision==null?{}:{revision:productRMSpecRevision})};if(!payload.rmPackSpec.packUnit||!payload.rmPackSpec.contentUnit||!(Number(payload.rmPackSpec.contentPerPack)>0)||!(Number(payload.rmPackSpec.basePerContentUnit)>0)){switchProductEditorTab('RM');await Swal.fire('ตรวจหน่วยบรรจุ','กรอกหน่วย จำนวนต่อภาชนะ และอัตราแปลงมากกว่า 0','warning');return;}}}
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
      if((data.message||'').includes('ปริมาตร'))switchProductEditorTab('Volume');
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
function createProductModalDOM(){if(document.getElementById('productModal'))return;const div=document.createElement('div');div.innerHTML=`<div class="modal fade product-editor" id="productModal" tabindex="-1" aria-labelledby="productModalTitle"><div class="modal-dialog modal-dialog-centered modal-dialog-scrollable"><div class="modal-content"><div class="modal-header"><div class="d-flex align-items-center gap-3"><span class="product-editor-icon"><i class="bi bi-box-seam"></i></span><div><h5 class="modal-title" id="productModalTitle">จัดการข้อมูลสินค้า</h5><p class="mb-0 small text-muted mt-1">ข้อมูลหลัก หน่วยบรรจุ และปริมาตรสำหรับจัดเก็บ</p></div></div><button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="ปิดฟอร์มสินค้า"></button></div><div class="product-editor-tabs" role="tablist" aria-label="ส่วนข้อมูลสินค้า"><button type="button" id="productBasicTab" role="tab" aria-controls="productBasicPane" onclick="switchProductEditorTab('Basic')">1. ข้อมูลสินค้า</button><button type="button" id="productRefsTab" role="tab" aria-controls="productRefsPane" onclick="switchProductEditorTab('Refs')">2. รหัสอ้างอิง</button><button type="button" id="productRMTab" role="tab" aria-controls="productRMPane" onclick="switchProductEditorTab('RM')" hidden>3. หน่วยบรรจุ RM</button><button type="button" id="productPackTab" role="tab" aria-controls="productPackPane" onclick="switchProductEditorTab('Pack')">4. รุ่นอัตราบรรจุ</button><button type="button" id="productVolumeTab" role="tab" aria-controls="productVolumePane" onclick="switchProductEditorTab('Volume')">5. ปริมาตรจัดเก็บ</button></div><div class="modal-body"><section id="productBasicPane" role="tabpanel" aria-labelledby="productBasicTab"><div class="product-editor-section-title">ข้อมูลที่ใช้ค้นหาและรับสินค้า <span>* จำเป็น</span></div><div id="productBasicFields" class="product-editor-grid"><div><label for="modalProductCode" class="form-label">รหัสสินค้า *</label><input id="modalProductCode" class="form-control" placeholder="เช่น T188880078" maxlength="50" required><div class="form-text">แก้ไขรหัสไม่ได้หลังสร้างสินค้า</div></div><div><label for="modalProductBarcode" class="form-label">บาร์โค้ด <span class="text-muted fw-normal">(ถ้ามี)</span></label><input id="modalProductBarcode" class="form-control" maxlength="50" placeholder="สแกนหรือพิมพ์บาร์โค้ด"></div><div class="product-editor-wide"><label for="modalProductName" class="form-label">ชื่อแสดงผลหลัก *</label><input id="modalProductName" class="form-control" maxlength="2000" placeholder="เช่น NIACINAMIDE" required></div><div class="product-editor-wide"><label for="modalProductThaiName" class="form-label">ชื่อภาษาไทย</label><input id="modalProductThaiName" class="form-control" maxlength="255" placeholder="ชื่อภาษาไทยหรือคำอธิบายเพิ่มเติม"></div><div class="product-editor-wide"><hr class="my-1"></div><div><label for="modalProductUnit" class="form-label">หน่วยสต๊อกหลัก *</label><select id="modalProductUnit" class="form-select" onchange="updateProductRMPreview();updateProductVolumeLabel()" required aria-describedby="modalProductUnitHint"><option value="">เลือกหน่วยนับ</option></select><div id="modalProductUnitHint" class="form-text">เช่น KG · ใช้คุมยอดสต๊อกทั้งหมด สินค้าที่ใช้งานแล้วอาจเปลี่ยนหน่วยไม่ได้</div></div><div><label for="modalProductSupplier" class="form-label">ผู้จำหน่ายหลัก</label><select id="modalProductSupplier" class="form-select" aria-describedby="modalProductSupplierHint"><option value="">ไม่ระบุผู้จำหน่ายหลัก</option></select><div id="modalProductSupplierHint" class="form-text">เลือกจาก Supplier Master หรือเว้นว่างหากผลิตเอง</div></div></div></section><section id="productRefsPane" role="tabpanel" aria-labelledby="productRefsTab" hidden><div class="product-editor-section-title">รหัสอ้างอิงจาก Master</div><p class="small text-muted">ProID1–ProID4 แก้ไขได้แยกกัน ไม่เปลี่ยนรหัสหลักที่ใช้รับ–จ่าย</p><div id="productReferenceFields" class="product-editor-grid"></div></section><section id="productRMPane" role="tabpanel" aria-labelledby="productRMTab" hidden><div class="product-editor-section-title">กำหนดวิธีรับและแบ่งเบิกวัตถุดิบ</div><p class="small text-muted">ค่า Master เป็นค่าเริ่มต้น รอบรับตาม PO ระบุปริมาณจริงต่อกล่องได้แยกกัน</p></section><section id="productPackPane" role="tabpanel" aria-labelledby="productPackTab" hidden><div id="productPackVersionsRoot"></div></section><section id="productVolumePane" role="tabpanel" aria-labelledby="productVolumeTab" hidden><div class="product-editor-section-title">ตรวจพื้นที่จัดเก็บสินค้า</div><p class="small text-muted">ใช้คำนวณความจุใน PUTAWAY · สินค้าคุมเป็น KG ต้องระบุปริมาตรต่อ 1 KG</p></section></div><div class="modal-footer"><span class="product-editor-footer-note"><i class="bi bi-info-circle me-1"></i>บันทึกข้อมูลสินค้าไม่เปลี่ยนยอดสต๊อก</span><button type="button" class="btn btn-outline-secondary" data-bs-dismiss="modal">ยกเลิก</button><button type="button" class="btn btn-primary" onclick="saveProduct()"><i class="bi bi-check2 me-1"></i>บันทึกข้อมูล</button></div></div></div></div>`;document.body.appendChild(div);document.querySelector('#productModal .product-editor-tabs').addEventListener('keydown',event=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;const tabs=[...document.querySelectorAll('#productModal [role=tab]')].filter(t=>!t.hidden),index=tabs.indexOf(document.activeElement);if(index<0)return;event.preventDefault();const next=event.key==='Home'?0:event.key==='End'?tabs.length-1:(index+(event.key==='ArrowRight'?1:-1)+tabs.length)%tabs.length;tabs[next].click();tabs[next].focus();});switchProductEditorTab('Basic');}
function switchProductEditorTab(name){for(const key of ['Basic','Refs','RM','Pack','Volume']){const pane=document.getElementById('product'+key+'Pane'),tab=document.getElementById('product'+key+'Tab');if(!pane||!tab)continue;pane.hidden=key!==name;tab.setAttribute('aria-selected',String(key===name));tab.tabIndex=key===name?0:-1;}const body=document.querySelector('#productModal .modal-body');if(body)body.scrollTop=0;}
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
    await loadMasterProducts();
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

async function setupProductUnit(selected){const select=document.getElementById('modalProductUnit');select.disabled=true;select.innerHTML='<option value="">กำลังโหลดหน่วยนับ...</option>';try{const response=await fetch('/api/master/units',{headers:authHeaders(),cache:'no-store'}),body=await response.json();if(!response.ok)throw Error(body.message||'โหลดหน่วยนับไม่สำเร็จ');const rows=Array.isArray(body)?body:body.data;if(!Array.isArray(rows)||!rows.length)throw Error('ยังไม่มีหน่วยนับใน tblUnits');select.innerHTML='<option value="">เลือกหน่วยนับ</option>'+rows.map(u=>'<option value="'+Number(u.UnitId)+'">'+productHtml(u.UnitCode)+' — '+productHtml(u.UnitName||u.UnitCode)+'</option>').join('');select.value=selected==null?'':String(selected);select.disabled=false;return true}catch(e){select.innerHTML='<option value="">โหลดหน่วยนับไม่สำเร็จ</option>';await Swal.fire('โหลดหน่วยนับไม่สำเร็จ',e.message,'error');return false}}

let productSupplierLoadSeq=0;
async function setupProductSupplier(selected){const seq=++productSupplierLoadSeq,select=document.getElementById('modalProductSupplier'),hint=document.getElementById('modalProductSupplierHint'),category=Number(document.getElementById('modalProductCategory').value);setupProductSupplierSearch(select);document.getElementById('modalProductSupplierSearch').value='';document.getElementById('modalProductSupplierSearch').disabled=true;document.getElementById('modalProductSupplierCount').textContent='';select.disabled=true;select.dataset.ready='false';select.innerHTML='<option value="">กำลังโหลดผู้จำหน่าย...</option>';try{const response=await fetch('/api/products/supplier-options?categoryId='+category+(editingProductId?'&productId='+editingProductId:''),{headers:authHeaders(),cache:'no-store'}),body=await response.json();if(seq!==productSupplierLoadSeq)return false;if(!response.ok||!body.success)throw Error(body.message||'โหลดผู้จำหน่ายไม่สำเร็จ');select.innerHTML='<option value="">ไม่ระบุผู้จำหน่ายหลัก</option>'+body.data.map(x=>'<option value="'+Number(x.SupplierId)+'" '+(!x.CanSelect?'disabled ':'')+'>'+productHtml(x.SupplierCode+' · '+x.SupplierName)+(x.CanSelect?'':' (ปิดใช้งาน / ไม่รองรับกลุ่มนี้แล้ว)')+'</option>').join('');select.value=selected==null?'':String(selected);select.disabled=false;select.dataset.ready='true';select._supplierOptions=Array.from(select.options).map(o=>({value:o.value,text:o.textContent,disabled:o.disabled}));document.getElementById('modalProductSupplierSearch').disabled=false;filterProductSupplierOptions();const old=body.data.find(x=>x.SupplierId===Number(selected));hint.textContent=old&&!old.CanSelect?'ผู้จำหน่ายเดิมปิดใช้งานหรือไม่รองรับกลุ่มนี้แล้ว สามารถคงค่าเดิมหรือเลือกผู้จำหน่ายใหม่':body.data.length?'แสดงผู้จำหน่ายที่รองรับกลุ่มสินค้านี้ · เว้นว่างได้หากผลิตเอง':'ยังไม่มีผู้จำหน่ายที่รองรับกลุ่มนี้ สามารถไม่ระบุผู้จำหน่ายหลักได้';return true}catch(e){if(seq!==productSupplierLoadSeq)return false;select.innerHTML='<option value="">โหลดผู้จำหน่ายไม่สำเร็จ</option>';hint.textContent=e.message;await Swal.fire('โหลดผู้จำหน่ายไม่สำเร็จ',e.message,'error');return false}}

let productRMSpecRevision=null,productRMSpecReady=false,productRMLoad=0;
function productRMVisible(){if(typeof wmsNavigation==='undefined'||wmsNavigation?.user.role!=='ADMIN')return false;const id=Number(document.getElementById('modalProductCategory').value);return wmsNavigation.menus.find(m=>m.code==='PRODUCTS')?.categories?.some(c=>c.id===id&&c.code==='RM')}
async function setupProductRMSpec(id){const seq=++productRMLoad;let section=document.getElementById('productRMSection');if(!section){section=document.createElement('section');section.id='productRMSection';section.className='border rounded-3 p-3 mt-3 bg-light';section.innerHTML='<h6 class="fw-bold mb-1"><i class="bi bi-box-seam me-2"></i>หน่วยบรรจุและการเบิก RM</h6><p class="small text-muted mb-3">กำหนดราย SKU · 1.1 เบิกเป็นกล่องเต็ม · 1.2 เบิกตามหน่วยใช้งานจริง</p><label class="form-check mb-3"><input id="productRMEnabled" class="form-check-input" type="checkbox" onchange="updateProductRMPreview()"><span class="form-check-label">กำหนดอัตราบรรจุสินค้านี้</span></label><div id="productRMInputs" hidden><div class="row g-2"><div class="col-sm-6"><label for="productRMPack" class="form-label small">หน่วยเบิกใหญ่ *</label><input id="productRMPack" class="form-control" maxlength="30" placeholder="เช่น กล่อง / ถัง / กระสอบ" oninput="updateProductRMPreview()"></div><div class="col-sm-6"><label for="productRMPer" class="form-label small">ปริมาณต่อภาชนะ *</label><input id="productRMPer" class="form-control" type="number" step="0.000001" min="0.000001" placeholder="เช่น 25" oninput="updateProductRMPreview()"></div><div class="col-sm-6"><label for="productRMContentUnit" class="form-label small">หน่วยเบิกย่อย *</label><input id="productRMContentUnit" class="form-control" list="productRMUnitChoices" maxlength="30" placeholder="เช่น KG หรือ L" oninput="updateProductRMPreview()"><datalist id="productRMUnitChoices"><option value="KG"></option><option value="L"></option><option value="G"></option></datalist></div><div class="col-sm-6"><label for="productRMFactor" class="form-label small">หน่วยสต๊อกต่อ 1 หน่วยเบิกย่อย *</label><input id="productRMFactor" class="form-control" type="number" step="0.000001" min="0.000001" value="1" oninput="updateProductRMPreview()"></div></div><div id="productRMPreview" class="small bg-white border rounded-3 p-3 mt-3" aria-live="polite"></div><p class="small text-muted mt-2 mb-0">หน่วยเบิกย่อยตรงกับหน่วยสต๊อก ใช้อัตราแปลง 1 · ถ้าต่างหน่วย เช่น L กับ KG ต้องระบุอัตราแปลงรายสินค้าให้ถูกต้อง</p></div><p class="small text-muted mt-3 mb-0">ตั้งอัตราบรรจุไม่เพิ่มยอดสต๊อก · กล่องเต็มที่พร้อมเบิกต้องอ้างอิงทะเบียนภาชนะจริง ห้ามเปลี่ยนอัตราขณะมีภาชนะคงเหลือหรืองานโอนค้าง</p>';document.getElementById('productRMPane').append(section)}section.hidden=!productRMVisible();document.getElementById('productRMTab').hidden=section.hidden;if(section.hidden&&!document.getElementById('productRMPane').hidden)switchProductEditorTab('Basic');productRMSpecRevision=null;productRMSpecReady=false;document.getElementById('productRMEnabled').checked=false;document.getElementById('productRMEnabled').disabled=false;for(const [key,value]of [['productRMPack',''],['productRMPer',''],['productRMContentUnit',''],['productRMFactor','1']])document.getElementById(key).value=value;updateProductRMPreview();if(section.hidden){productRMSpecReady=true;return true}try{if(id){const response=await fetch('/api/products/'+id+'/rm-spec',{headers:authHeaders(),cache:'no-store'}),body=await response.json();if(seq!==productRMLoad)return false;if(!response.ok)throw Error(body.message||'โหลดหน่วยบรรจุไม่สำเร็จ');const spec=body.data;if(spec){productRMSpecRevision=spec.Revision;document.getElementById('productRMEnabled').checked=true;document.getElementById('productRMEnabled').disabled=true;for(const [key,value]of [['productRMPack',spec.PackUnit],['productRMPer',spec.ContentPerPack],['productRMContentUnit',spec.ContentUnit],['productRMFactor',spec.BasePerContentUnit]])document.getElementById(key).value=value}}productRMSpecReady=true;updateProductRMPreview();return true}catch(e){await Swal.fire('โหลดหน่วยบรรจุไม่สำเร็จ',e.message,'error');return false}}
function updateProductRMPreview(){const enabled=document.getElementById('productRMEnabled');if(!enabled)return;document.getElementById('productRMInputs').hidden=!enabled.checked;const unit=document.getElementById('modalProductUnit'),base=unit.selectedOptions?.[0]?.textContent?.split(' — ')[0]||'หน่วยสต๊อก',pack=document.getElementById('productRMPack').value.trim()||'ภาชนะ',per=Number(document.getElementById('productRMPer').value),content=document.getElementById('productRMContentUnit').value.trim().toUpperCase()||'หน่วยเบิกย่อย',factor=Number(document.getElementById('productRMFactor').value),preview=document.getElementById('productRMPreview');if(!(per>0)||!(factor>0)){preview.textContent='ตัวอย่าง: 1 กล่อง = 25 KG · เบิกใหญ่ 1 กล่อง โอน 25 KG · เบิกย่อยใช้จริงเป็น KG';return}preview.textContent='1 '+pack+' = '+per+' '+content+' = '+(per*factor).toLocaleString('th-TH',{maximumFractionDigits:6})+' '+base+' · อนุมัติ 1 '+pack+' จาก WH01 ไป WH04 แล้วเบิกย่อยตาม '+content;}

function setupProductVolume(value){let section=document.getElementById('productVolumeSection');if(!section){section=document.createElement('section');section.id='productVolumeSection';section.className='border rounded-3 p-3 mt-3';section.innerHTML='<h6 class="fw-bold mb-2"><i class="bi bi-bounding-box me-2"></i>ปริมาตรสินค้า สำหรับจัดเก็บ</h6><label id="productVolumeLabel" for="productUnitVolume" class="form-label small">ปริมาตรต่อ 1 หน่วยสต๊อก (cm³)</label><input id="productUnitVolume" class="form-control" type="number" step="0.001" min="0.001" placeholder="ยังไม่ระบุปริมาตร"><div class="small text-muted mt-2">PUTAWAY ใช้จำนวนสต๊อก × ปริมาตรนี้ เทียบกับความจุโลเคชั่น · เว้นว่างได้ แต่จะตรวจความจุไม่ได้</div><details class="mt-3"><summary class="small text-primary">คำนวณจากขนาดกล่อง / ภาชนะ</summary><div class="row g-2 mt-2"><div class="col-4"><label for="volumeWidth" class="form-label small">กว้าง (ซม.)</label><input id="volumeWidth" type="number" min="0.001" step="0.001" class="form-control" oninput="calculateProductVolume()"></div><div class="col-4"><label for="volumeLength" class="form-label small">ยาว (ซม.)</label><input id="volumeLength" type="number" min="0.001" step="0.001" class="form-control" oninput="calculateProductVolume()"></div><div class="col-4"><label for="volumeHeight" class="form-label small">สูง (ซม.)</label><input id="volumeHeight" type="number" min="0.001" step="0.001" class="form-control" oninput="calculateProductVolume()"></div><div class="col-12"><label id="volumeBasisLabel" for="volumeBasis" class="form-label small">จำนวนหน่วยสต๊อกในกล่องนี้</label><input id="volumeBasis" type="number" min="0.001" step="0.001" class="form-control" placeholder="เช่น กล่องบรรจุ 25 KG ใส่ 25" oninput="calculateProductVolume()"></div></div><div id="volumeCalcResult" class="small text-muted mt-2" aria-live="polite"></div><button type="button" id="volumeUseCalculation" class="btn btn-sm btn-outline-primary mt-2" onclick="useCalculatedProductVolume()" disabled>ใช้ค่าที่คำนวณ</button></details><div class="small text-muted mt-3">กรอกขนาดจริงเท่านั้น · ตัวช่วยนี้ไม่เปลี่ยนจำนวนกล่องหรือยอด KG</div>';document.getElementById('productVolumePane').append(section)}document.getElementById('productUnitVolume').value=value??'';for(const id of ['volumeWidth','volumeLength','volumeHeight','volumeBasis'])document.getElementById(id).value='';updateProductVolumeLabel();calculateProductVolume();}
function updateProductVolumeLabel(){const select=document.getElementById('modalProductUnit'),unit=select.selectedOptions?.[0]?.textContent?.split(' — ')[0]||'หน่วยสต๊อก';const label=document.getElementById('productVolumeLabel');if(label)label.textContent='ปริมาตรต่อ 1 '+unit+' (cm³)';const basis=document.getElementById('volumeBasisLabel');if(basis)basis.textContent='จำนวน '+unit+' ที่บรรจุในกล่อง / ภาชนะนี้';}
function calculateProductVolume(){const dims=['volumeWidth','volumeLength','volumeHeight','volumeBasis'].map(id=>Number(document.getElementById(id).value)),button=document.getElementById('volumeUseCalculation'),result=document.getElementById('volumeCalcResult');button.disabled=dims.some(x=>!Number.isFinite(x)||x<=0);if(button.disabled){result.textContent='ปริมาตรต่อหน่วย = กว้าง × ยาว × สูง ÷ จำนวนหน่วยสต๊อกในกล่อง';return null}const value=Math.ceil(dims[0]*dims[1]*dims[2]/dims[3]*1000)/1000;if(!Number.isFinite(value)||value<=0||value>=1e12){button.disabled=true;result.textContent='ค่าคำนวณเกินช่วงที่รองรับ';return null}result.textContent=dims[0]+' × '+dims[1]+' × '+dims[2]+' ÷ '+dims[3]+' = '+value.toLocaleString('th-TH',{maximumFractionDigits:3})+' cm³ ต่อหน่วยสต๊อก (ปัดขึ้น 3 ตำแหน่ง)';return value;}
function useCalculatedProductVolume(){const value=calculateProductVolume();if(value!=null)document.getElementById('productUnitVolume').value=value;}

function setupProductSupplierSearch(select){if(document.getElementById('modalProductSupplierSearch'))return;const input=document.createElement('input');input.id='modalProductSupplierSearch';input.type='search';input.className='form-control mb-2';input.placeholder='พิมพ์ชื่อหรือรหัสผู้จำหน่ายเพื่อค้นหา';input.setAttribute('aria-label','ค้นหาผู้จำหน่ายด้วยชื่อหรือรหัส');input.autocomplete='off';const count=document.createElement('div');count.id='modalProductSupplierCount';count.className='form-text mb-1';count.setAttribute('role','status');select.before(input);select.after(count);input.addEventListener('input',filterProductSupplierOptions);input.addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();select.focus();}if(event.key==='Escape'&&input.value){event.preventDefault();event.stopPropagation();input.value='';filterProductSupplierOptions();}});}
function filterProductSupplierOptions(){const select=document.getElementById('modalProductSupplier'),input=document.getElementById('modalProductSupplierSearch');if(!select?._supplierOptions)return;const selected=select.value,tokens=input.value.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean),matches=select._supplierOptions.filter(o=>o.value&&tokens.every(t=>o.text.toLocaleLowerCase().includes(t)));const visible=select._supplierOptions.filter(o=>!o.value||o.value===selected||matches.includes(o));select.replaceChildren(...visible.map(o=>{const option=new Option(o.text,o.value);option.disabled=o.disabled;return option;}));select.value=selected;document.getElementById('modalProductSupplierCount').textContent='พบ '+matches.length+' ผู้จำหน่าย'+(tokens.length&&selected&&!matches.some(o=>o.value===selected)?' · คงรายการที่เลือกไว้':'');}

let productMasterRevision;
function setupProductMasterFields(p={}){
 const root=document.getElementById('productBasicFields');
 if(!document.getElementById('modalName1')){
 const names=document.createElement('div');names.className='product-editor-wide';names.innerHTML='<div class="product-editor-section-title mt-2">ชื่อสินค้าในฐานข้อมูล</div><div class="row g-3"><div class="col-md-6"><label for="modalName1" class="form-label">PRODUCT NAME1</label><textarea id="modalName1" class="form-control" rows="2" maxlength="2000" placeholder="ชื่อหลักจาก Master ช่องที่ 1"></textarea></div><div class="col-md-6"><label for="modalName2" class="form-label">PRODUCT NAME2</label><textarea id="modalName2" class="form-control" rows="2" maxlength="2000" placeholder="ชื่อเพิ่มเติมจาก Master ช่องที่ 2"></textarea></div></div>';root.insertBefore(names,document.getElementById('modalProductUnit').parentElement);
 document.getElementById('productReferenceFields').innerHTML=[1,2,3,4].map(i=>'<div><label for="modalProID'+i+'" class="form-label">ProID'+i+'</label><input id="modalProID'+i+'" class="form-control" maxlength="500" placeholder="รหัสอ้างอิงช่องที่ '+i+'"></div>').join('')+'<div><label for="modalPhysicalForm" class="form-label">ลักษณะสินค้า</label><input id="modalPhysicalForm" class="form-control" maxlength="50" list="editorPhysicalForms"><datalist id="editorPhysicalForms"><option value="Liquid"><option value="Powder"><option value="Solid"><option value="Semi-Liquid"><option value="Semi-Solid"></datalist></div>';
 const status=document.createElement('div');status.className='product-editor-wide product-editor-state';status.innerHTML='<div><span class="small text-muted">สถานะข้อมูลสินค้า</span><p id="productEditorStatusHint" class="small mb-0"></p></div><div><label for="modalProductStatus" class="visually-hidden">สถานะข้อมูลสินค้า</label><select id="modalProductStatus" class="form-select" onchange="updateProductEditorState()"><option value="DRAFT">ร่าง</option><option value="READY">พร้อมใช้งาน</option><option value="INACTIVE">ปิดใช้งาน</option></select></div>';root.prepend(status);
 }
 productMasterRevision=p.Revision;
 document.getElementById('modalName1').value=p.ProductName1||'';document.getElementById('modalName2').value=p.ProductName2||'';
 for(let i=1;i<=4;i++)document.getElementById('modalProID'+i).value=p['ProID'+i]||'';
 document.getElementById('modalPhysicalForm').value=p.PhysicalForm||'';
 const status=document.getElementById('modalProductStatus');status.disabled=!p.ProductId;status.value=p.MasterStatus||'READY';status.querySelector('option[value="DRAFT"]').disabled=!!p.ProductId&&p.MasterStatus!=='DRAFT';
 updateProductEditorState();
}
function updateProductEditorState(){
 const draft=document.getElementById('modalProductStatus').value==='DRAFT';
 document.getElementById('productEditorStatusHint').textContent=draft?'บันทึกข้อมูลก่อนได้ · กำหนดรหัสและหน่วยนับให้ครบก่อนเปิดรับ–จ่าย':'พร้อมใช้งานต้องมีรหัสหลักที่ไม่ซ้ำและหน่วยสต๊อก';
 document.getElementById('modalProductCode').required=!draft;document.getElementById('modalProductUnit').required=!draft;
}
async function loadProductEditorPackVersions(id,unitId){
 if(!unitId){await loadProductPackVersions(null);document.getElementById('productPackVersionsRoot').innerHTML='<div class="p-4 border rounded-3 bg-light"><h6>กำหนดหน่วยสต๊อกก่อนเพิ่มรุ่นอัตราบรรจุ</h6><p class="small text-muted mb-0">เลือกหน่วยในแท็บข้อมูลสินค้า แล้วบันทึกและเปิดแก้ไขอีกครั้ง</p></div>';return;}
 await loadProductPackVersions(id);
}

function productMasterFieldsPayload(){return{...(productMasterRevision?{masterRevision:productMasterRevision}:{}),productName1:document.getElementById('modalName1').value,productName2:document.getElementById('modalName2').value,...Object.fromEntries([1,2,3,4].map(i=>['proID'+i,document.getElementById('modalProID'+i).value])),physicalForm:document.getElementById('modalPhysicalForm').value}}

function toggleProductSummary(){
 const cards=document.getElementById('productSummaryCards'),button=document.getElementById('productSummaryToggle');
 if(!cards||!button)return;
 const expanded=button.getAttribute('aria-expanded')!=='true';
 cards.hidden=!expanded;button.setAttribute('aria-expanded',String(expanded));
 button.querySelector('span').textContent=expanded?'ซ่อนสรุป':'แสดงสรุป';
 button.querySelector('i').className=expanded?'bi bi-eye-slash':'bi bi-eye';
 button.querySelector('.product-summary-chevron').className='bi product-summary-chevron '+(expanded?'bi-chevron-up':'bi-chevron-down');
}
