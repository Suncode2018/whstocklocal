function loadSummaryStock(){ if(document.querySelector('[data-stock-report="true"]')) return loadAdminStockReport(); }
function exportToExcel(){exportAdminStockCsv();}
let adminReportRows = [];
let adminReportReady = false;
let adminReportLoading = false;
let adminReportPage = 1;
const reportEscape = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const reportNumber = value => Number.isFinite(Number(value)) ? Number(value) : 0;
const reportFormat = value => Number(value).toLocaleString('th-TH', {maximumFractionDigits: 3});
function adminReportFiltered() {
  const q = document.getElementById('reportSearch').value.trim().toLowerCase();
  const zone = document.getElementById('reportZone').value;
  const status = document.getElementById('reportStatus').value;
  return adminReportRows.filter(row => (!q || [row.code,row.barcode,row.name,row.thaiName,row.location].join(' ').toLowerCase().includes(q)) && (!zone || row.locations.some(loc => loc.toUpperCase().startsWith(zone))) && (!status || (status === 'available' ? row.qty > 0 : status === 'empty' ? row.qty <= 0 : row.min > 0 && row.qty < row.min)));
}
async function loadAdminStockReport() {
  if (adminReportLoading) return;
  adminReportLoading = true;
  document.getElementById('reportRefresh').disabled = true;
  ['reportPrev','reportNext'].forEach(id => document.getElementById(id).disabled = true);
  adminReportReady = false;
  document.getElementById('reportExport').disabled = true;
  const notice = document.getElementById('reportNotice');
  notice.className = 'small text-muted mb-3';
  notice.textContent = 'กำลังโหลดข้อมูลสต๊อก...';
  document.getElementById('stockTableBody').innerHTML = '<tr><td colspan="9" class="text-center py-5"><span class="spinner-border spinner-border-sm me-2"></span>กำลังโหลด...</td></tr>';
  try {
    const response = await fetch('/api/stock/balance', {headers: authHeaders(), signal: AbortSignal.timeout(20000)});
    if (response.status === 401) {
      throw new Error('เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่');
    }
    if (!response.ok) throw new Error(response.status === 404 ? 'บริการรายงานยังไม่พร้อมใช้งาน กรุณารีสตาร์ทเซิร์ฟเวอร์แล้วลองอีกครั้ง' : 'โหลดข้อมูลไม่สำเร็จ (HTTP ' + response.status + ')');
    const data = await response.json();
    const rows = Array.isArray(data) ? data : data.data;
    if (data.success === false || !Array.isArray(rows)) throw new Error('รูปแบบข้อมูลรายงานไม่ถูกต้อง');
    adminReportRows = rows.map(item => {
      const location = String(item.LocationDetails || item.LocationCode || '');
      return {id: item.ProductId, code: String(item.ItemCode || item.ProductCode || ''), barcode: String(item.Barcode || ''), name: String(item.ItemName || item.ProductName || ''), thaiName: String(item.ThaiName || ''), location, locations: location.split(',').map(loc => loc.replace(/\s*\([^)]*\)\s*$/, '').trim()).filter(loc => loc && loc !== 'N/A' && loc !== '-'), qty: reportNumber(item.TotalStock ?? item.Quantity), transit:reportNumber(item.TransitStock), owned:reportNumber(item.OwnedStock??item.TotalStock), min: reportNumber(item.MinStock), unit: String(item.UOM || item.PackageType || ''), updated: item.LastUpdated || item.lastUpdated};
    });
    const products = new Map();
    adminReportRows.forEach(row => {const key = row.id ?? (row.code || row.barcode); const p = products.get(key) || {qty:0,min:row.min}; p.qty += row.qty; products.set(key,p);});
    document.getElementById('reportSku').textContent = reportFormat(products.size);
    document.getElementById('reportQty').textContent = reportFormat(adminReportRows.reduce((sum,row) => sum + row.qty,0));
    document.getElementById('reportLocations').textContent = reportFormat(new Set(adminReportRows.filter(row => row.qty > 0).flatMap(row => row.locations)).size);
    const hasMin = rows.every(row => row.MinStock != null);
    document.getElementById('reportLow').textContent = hasMin ? reportFormat([...products.values()].filter(p => p.min > 0 && p.qty < p.min).length) : '—';
    notice.textContent = hasMin ? 'ยอดรวมอาจประกอบด้วยสินค้าหลายหน่วยนับ กรุณาดูหน่วยในแต่ละรายการ' : 'ยังไม่มีข้อมูลเกณฑ์ Min สำหรับคำนวณ · ยอดรวมอาจมีหลายหน่วยนับ';
    document.getElementById('reportUpdated').textContent = 'โหลดล่าสุด: ' + new Date().toLocaleString('en-GB',{timeZone:'Asia/Bangkok',calendar:'gregory',day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false});
    adminReportReady = true;
    renderAdminStockReport();
  } catch (error) {
    adminReportRows = [];
    ['reportSku','reportQty','reportLocations','reportLow'].forEach(id => document.getElementById(id).textContent = '—');
    notice.className = 'small text-danger mb-3';
    notice.textContent = error.name === 'TimeoutError' ? 'การโหลดข้อมูลใช้เวลานานเกินไป กรุณาลองอีกครั้ง' : error.message;
    document.getElementById('stockTableBody').innerHTML = '<tr><td colspan="9" class="text-center py-5 text-danger">ไม่สามารถโหลดรายงานได้ กรุณาลองรีเฟรชอีกครั้ง</td></tr>';
    document.getElementById('reportCount').textContent = 'ไม่มีข้อมูลสำหรับแสดง';
    document.getElementById('reportUpdated').textContent = 'โหลดข้อมูลไม่สำเร็จ';
  } finally {adminReportLoading = false; document.getElementById('reportRefresh').disabled = false;}
}
function renderAdminStockReport(keepPage = false) {
  if (!adminReportReady) return;
  const rows = adminReportFiltered();
  if (!keepPage) adminReportPage = 1;
  const pageSize = Number(document.getElementById('reportPageSize').value) || 50;
  const pages = Math.max(1, Math.ceil(rows.length / pageSize));
  adminReportPage = Math.max(1, Math.min(adminReportPage, pages));
  const offset = (adminReportPage - 1) * pageSize;
  const visible = rows.slice(offset, offset + pageSize);
  document.getElementById('reportPrev').disabled = adminReportPage === 1;
  document.getElementById('reportNext').disabled = adminReportPage === pages;
  document.getElementById('reportPageInfo').textContent = 'หน้า ' + adminReportPage + ' / ' + pages;
  document.getElementById('reportExport').disabled = rows.length === 0;
  document.getElementById('reportCount').textContent = 'พบ ' + reportFormat(rows.length) + ' จาก ' + reportFormat(adminReportRows.length) + ' รายการ';
  document.getElementById('stockTableBody').innerHTML = rows.length ? visible.map((row,i) => {
    const status = row.qty <= 0 ? ['danger','หมดสต๊อก'] : row.min > 0 && row.qty < row.min ? ['warning','ต่ำกว่า Min'] : ['success','มีสินค้า'];
    const date = row.updated ? new Date(row.updated) : null;
    const time = date && !Number.isNaN(date.getTime()) ? date.toLocaleString('en-GB',{timeZone:'Asia/Bangkok',calendar:'gregory',day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false}) : '—';
    return '<tr><td>' + (offset+i+1) + '</td><td><code>' + reportEscape(row.barcode || '—') + '</code></td><td class="fw-semibold">' + reportEscape(row.code || '—') + '</td><td>' + reportEscape(row.name || '—') + (row.thaiName && row.thaiName !== row.name ? '<div class="small text-muted">' + reportEscape(row.thaiName) + '</div>' : '') + '</td><td>' + reportEscape(row.location || 'ยังไม่มีตำแหน่งจัดเก็บ') + '</td><td class="text-end fw-bold">' + reportFormat(row.qty) + '<div><button type="button" class="btn btn-sm btn-link p-0" onclick="showStockBoxDetails('+Number(row.id)+')">ดู PO / Lot / กล่อง</button></div></td><td>' + reportEscape(row.unit || '—') + '</td><td><span class="badge bg-' + status[0] + '-subtle text-' + status[0] + '">' + status[1] + '</span></td><td class="small text-muted">' + reportEscape(time) + '</td></tr>';
  }).join('') : '<tr><td colspan="9" class="text-center py-5 text-muted">' + (adminReportRows.length ? 'ไม่พบรายการตามตัวกรอง' : 'ไม่มีข้อมูลสต๊อก') + '</td></tr>';
}
function changeAdminStockPage(delta) {
  if (!adminReportReady) return;
  adminReportPage += delta;
  renderAdminStockReport(true);
}
function clearAdminStockFilters() {
  ['reportSearch','reportZone','reportStatus'].forEach(id => document.getElementById(id).value = '');
  renderAdminStockReport();
}
function exportAdminStockCsv() {
  if (!adminReportReady) return;
  const rows = adminReportFiltered();
  if (!rows.length) return;
  const cell = value => '"' + String(value ?? '').replace(/^(\s*[=+@-]|[\t\r\n])/, "'$&").replace(/"/g, '""') + '"';
  const records = [['บาร์โค้ด','รหัสสินค้า','ชื่อสินค้า','ตำแหน่งจัดเก็บ','ยอดคงเหลือ','ระหว่างโอน RM','รวมถือครอง','หน่วย','Min','อัปเดตล่าสุด'], ...rows.map(row => [row.barcode,row.code,row.name,row.location,row.qty,row.transit,row.owned,row.unit,row.min,row.updated || ''])];
  const blob = new Blob(['\uFEFF' + records.map(row => row.map(cell).join(',')).join('\r\n')], {type:'text/csv;charset=utf-8;'});
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url; link.download = 'Stock_Report_' + wmsToday() + '.csv';
  document.body.appendChild(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url),1000);
}

function stockIdentifier(value){return value==null||String(value).trim()===''?'—':String(value).trim();}
function stockLocationLotsHtml(data,r) {
 const lots=(data.lots||[]).filter(l=>Number(l.whid)===Number(r.whid)&&l.LocationCode===r.LocationCode);
 const unit=reportEscape(data.product.UnitCode||'');
 const equivalent=(n,pack)=>pack&&window.WmsPacking?reportEscape(WmsPacking.equivalent(n,pack,data.product.UnitCode)):'—';
 return '<details class="mt-2"><summary class="text-primary small">ดู ANA / LOT และ Version ('+lots.length+' รายการ)</summary><table class="table table-sm small mt-2 mb-0"><thead><tr><th>ANA No.</th><th>LOT No.</th><th>Version</th><th class="text-end">คงเหลือ</th><th class="text-end">หน่วยใหญ่โดยประมาณ</th></tr></thead><tbody>'+lots.map(l=>{const pack=(data.packings||[]).find(v=>Number(v.PackVersionId)===Number(l.PackVersionId));return '<tr><td>'+reportEscape(stockIdentifier(l.AnaNo))+'</td><td>'+reportEscape(stockIdentifier(l.LotNo))+'</td><td>'+(pack?'V'+reportFormat(pack.VersionNo):'— ไม่ระบุ')+'</td><td class="text-end">'+reportFormat(l.Quantity)+' '+unit+'</td><td class="text-end">'+equivalent(Number(l.Quantity),pack)+'</td></tr>';}).join('')+'</tbody></table><div class="small text-muted">Version อ้างจาก LOT ที่รับเข้า · “ไม่ระบุ” คือข้อมูลย้อนหลังที่ระบบไม่มีหลักฐานให้ผูก Version</div></details>';
}
function stockLocationSummaryHtml(data) {
  const pack=data.packing, size=Number(pack?.UnitsPerPack), unit=reportEscape(pack?.StockUnitLabel||data.product.UnitCode||'');
  const equivalent=n=> {
    if(window.WmsPacking&&pack)return reportEscape(WmsPacking.equivalent(n,pack,data.product.UnitCode));
    if(!(size>0))return '<span class="text-muted">ยังไม่กำหนดอัตราบรรจุ</span>';
    if(n<0)return '<span class="text-danger">ยอดติดลบ · ตรวจสอบข้อมูล</span>';
    const full=Math.floor(n/size),remainder=Number((n-full*size).toFixed(6));
    return reportFormat(full)+' '+reportEscape(pack.PackUnit)+(remainder?' + '+reportFormat(remainder)+' '+unit:'');
  };
  const rows=(data.stock||[]).filter(r=>Number(r.Quantity)!==0), warehouses=new Map(rows.map(r=>[String(r.whid),r.whname+' · '+(r.whdescription||'')]));
  return '<section class="border rounded-3 p-3 my-3"><h6 class="fw-bold">คงเหลือแยกคลังและโลเคชั่น</h6><div class="row g-2 my-2"><div class="col-sm-6"><label class="small" for="stockDetailWarehouse">คลังสินค้า</label><select class="form-select" id="stockDetailWarehouse"><option value="">ทุกคลังที่มีสิทธิ์</option>'+[...warehouses].map(([id,name])=>'<option value="'+reportEscape(id)+'">'+reportEscape(name)+'</option>').join('')+'</select></div><div class="col-sm-6"><label class="small" for="stockDetailLocation">โลเคชั่น</label><select class="form-select" id="stockDetailLocation"><option value="">ทุกโลเคชั่น</option></select></div></div><div class="table-responsive"><table class="table table-sm align-middle"><thead><tr><th>คลังสินค้า</th><th>โลเคชั่น</th><th class="text-end">คงเหลือหน่วยย่อย</th><th class="text-end">หน่วยใหญ่เทียบเท่า</th></tr></thead><tbody id="stockDetailRows">'+rows.map(r=>'<tr data-stock-wh="'+reportEscape(r.whid)+'" data-stock-location="'+reportEscape(r.LocationCode||'')+'" data-stock-quantity="'+Number(r.Quantity)+'"><td>'+reportEscape(r.whname||r.whid)+'<div class="small text-muted">'+reportEscape(r.whdescription||'')+'</div></td><td>'+reportEscape(r.LocationCode||'ไม่ระบุตำแหน่ง')+(r.LocationDescription?' · '+reportEscape(r.LocationDescription):'')+(r.IsDamage?'<div class="badge bg-warning-subtle text-warning-emphasis">DAMAGE · นำออกเฉพาะ ADMIN</div>':'')+stockLocationLotsHtml(data,r)+'</td><td class="text-end fw-bold">'+reportFormat(r.Quantity)+' '+unit+'</td><td class="text-end">'+equivalent(Number(r.Quantity))+'</td></tr>').join('')+'</tbody><tfoot><tr class="fw-bold"><td colspan="2">รวมตามตัวกรอง</td><td class="text-end" id="stockDetailTotal"></td><td class="text-end" id="stockDetailEquivalent"></td></tr></tfoot></table></div><div id="stockDetailEmpty" class="small text-muted" hidden>ไม่พบยอดในตำแหน่งที่เลือก</div><div class="small text-muted">รวมยอดทุกโซน รวม RCV และ OUT · หน่วยใหญ่คำนวณตาม Master ที่มีผลวันนี้ ไม่ใช่จำนวนกล่องเต็มจริง และไม่ยืนยันอัตราของ Lot เก่า</div></section>';
}
function bindStockLocationSummary(data) {
  const warehouse=document.getElementById('stockDetailWarehouse'), location=document.getElementById('stockDetailLocation');
  const rows=[...document.querySelectorAll('#stockDetailRows > tr')],pack=data.packing,size=Number(pack?.UnitsPerPack),unit=pack?.StockUnitLabel||data.product.UnitCode||'';
  function render(){let total=0,count=0;for(const r of rows){r.hidden=!!(warehouse.value&&r.dataset.stockWh!==warehouse.value||location.value&&r.dataset.stockLocation!==location.value);if(!r.hidden){total+=Number(r.dataset.stockQuantity);count++;}}total=Number(total.toFixed(6));document.getElementById('stockDetailTotal').textContent=reportFormat(total)+' '+unit;const full=Math.floor(total/size),rest=Number((total-full*size).toFixed(6));document.getElementById('stockDetailEquivalent').textContent=window.WmsPacking&&pack?WmsPacking.equivalent(total,pack,unit):size>0&&total>=0?reportFormat(full)+' '+pack.PackUnit+(rest?' + '+reportFormat(rest)+' '+unit:''):'—';document.getElementById('stockDetailEmpty').hidden=count>0;}
  function resetLocations(){location.innerHTML='<option value="">ทุกโลเคชั่น</option>'+[...new Set((data.stock||[]).filter(r=>Number(r.Quantity)!==0&&(!warehouse.value||String(r.whid)===warehouse.value)).map(r=>r.LocationCode||''))].sort().map(code=>'<option value="'+reportEscape(code)+'">'+reportEscape(code||'ไม่ระบุตำแหน่ง')+((data.stock||[]).find(r=>r.LocationCode===code&&(!warehouse.value||String(r.whid)===warehouse.value))?.LocationDescription?' · '+reportEscape((data.stock||[]).find(r=>r.LocationCode===code&&(!warehouse.value||String(r.whid)===warehouse.value)).LocationDescription):'')+'</option>').join('');render();}
  warehouse.addEventListener('change',resetLocations);location.addEventListener('change',render);resetLocations();
}

async function showStockBoxDetails(id) {
 const esc=reportEscape;
 async function get(detail){const r=await fetch('/api/stock/containers/'+Number(id)+'?detail='+detail,{headers:authHeaders(),cache:'no-store'});const b=await r.json();if(!r.ok)throw Error(b.message||'โหลดรายละเอียดไม่ได้');return b;}
 try {
 const b=await get('summary'), unit=b.packing?.StockUnitLabel||b.product.UnitCode||'', total=b.stock.reduce((n,r)=>n+Number(r.Quantity),0), damage=b.stock.filter(r=>r.IsDamage).reduce((n,r)=>n+Number(r.Quantity),0);
 const equivalent=n=>b.packing&&window.WmsPacking?WmsPacking.equivalent(n,b.packing,b.product.UnitCode):'ยังไม่กำหนดอัตราบรรจุ';
 let active='locations',locationScope=null;const cache={},pending={};
 const style=`<style>
 .stock-dialog.swal2-popup{height:min(90dvh,850px);max-height:90dvh;display:flex!important;flex-direction:column;padding:0!important;overflow:hidden;border-radius:20px}
 .stock-dialog .swal2-title{font-size:22px;text-align:left;padding:20px 56px 10px 24px;margin:0}
 .stock-dialog .swal2-html-container{display:flex!important;flex:1;min-height:0;overflow:hidden!important;margin:0!important;text-align:left}
 .stock-dialog .swal2-actions{margin:0;padding:10px 24px;border-top:1px solid #e4e5ef;justify-content:flex-end}
 .stock-dialog .swal2-close{position:absolute;right:12px;top:12px}
 .sd-shell{display:flex;flex-direction:column;min-height:0;width:100%}.sd-top{padding:0 24px 12px;border-bottom:1px solid #e4e5ef}.sd-summary{display:flex;gap:12px;flex-wrap:wrap;background:#f6f4ff;border-radius:12px;padding:12px;margin:10px 0}.sd-summary strong{font-size:20px}.sd-tabs{display:flex;gap:8px;margin-top:12px;flex-wrap:wrap}.sd-tabs button{border:1px solid #ded8ff;background:white;color:#5144bd;border-radius:9px;padding:9px 14px}.sd-tabs button[aria-selected=true]{background:#5144dd;color:white}.sd-body{overflow:auto;min-height:0;flex:1;padding:12px 24px;overscroll-behavior:contain}.sd-body thead th{position:sticky;top:0;background:#f6f7fc;z-index:1}.sd-body .table-responsive{overflow:visible}.sd-body td{padding:12px 8px}.sd-body section{margin:0!important;border:0!important;padding:0!important}.sd-body table{width:100%}.sd-body .small{font-size:12px}
 @media(max-width:600px){.sd-top,.sd-body{padding-left:12px;padding-right:12px}.sd-body table{font-size:12px}.sd-tabs button{padding:8px}.stock-dialog.swal2-popup{width:96vw!important}}
 </style>`;
 const table=(headers,rows)=>'<table class="table table-sm align-middle"><thead><tr>'+headers.map(h=>'<th>'+h+'</th>').join('')+'</tr></thead><tbody>'+rows+'</tbody></table>';
 function locations(){let html=stockLocationSummaryHtml(b);html=html.replace(/<details[\s\S]*?<\/details>/g,'');for(const r of b.stock.filter(r=>Number(r.Quantity)!==0)){const code=esc(r.LocationCode||'ไม่ระบุตำแหน่ง');const marker=code+(r.LocationDescription?' · '+esc(r.LocationDescription):'');html=html.replace('<td>'+marker,'<td>'+marker+'<div><button type="button" class="btn btn-link btn-sm p-0 sd-lots" data-wh="'+esc(r.whid)+'" data-location="'+esc(r.LocationCode||'')+'">ดู ANA / LOT</button>'+(b.canAdjustLots?'<button type="button" class="btn btn-outline-warning btn-sm ms-2 sd-adj-lots" data-wh="'+esc(r.whid)+'" data-location="'+esc(r.LocationCode||'')+'">Adj ANA / LOT</button>':'')+'</div>');}return html;}
 async function editLots(scope){
 active='adjust';const body=document.getElementById('sdBody');body.innerHTML='<p>กำลังโหลด ANA / LOT…</p>';
 try{
  const params=new URLSearchParams({productId:id,whid:scope.wh,locationCode:scope.code});
  const response=await fetch('/api/stock/lot-adjustments?'+params,{headers:authHeaders(),cache:'no-store'}),context=await response.json();
  if(!response.ok)throw Error(context.message||'โหลดไม่สำเร็จ');if(active!=='adjust')return;
  body.innerHTML='<h6>Adj ANA / LOT · '+esc(scope.code)+'</h6><p>ยอดคงเหลือ '+reportFormat(context.quantity)+' '+esc(unit)+' · ผลรวมจำนวนทุกล็อตต้องเท่ากับยอดนี้</p><form id="sdLotForm"><div class="table-responsive"><table class="table table-sm"><thead><tr><th>ANA No.</th><th>LOT No.</th><th>Version บรรจุ</th><th>จำนวน (หน่วยฐาน)</th><th></th></tr></thead><tbody id="sdLotEditRows"></tbody></table></div><button type="button" class="btn btn-outline-primary btn-sm" id="sdAddLot">เพิ่มล็อต</button><label class="d-block mt-3">เหตุผล *<input name="reason" class="form-control" maxlength="500" required></label><div id="sdLotError" class="text-danger my-2" role="alert"></div><button class="btn btn-primary" type="submit">บันทึก ANA / LOT</button> <button type="button" class="btn btn-outline-secondary" id="sdCancelLot">กลับ</button></form><details class="mt-3"><summary>ประวัติการปรับล็อต</summary>'+context.history.map(h=>'<div class="border-bottom py-2">'+esc(wmsDate(h.CreatedAt))+' · '+esc(h.CreatedBy)+'<div>'+esc(h.Reason)+'</div><div>'+JSON.parse(h.RowsJson).map(r=>esc(stockIdentifier(r.AnaNo))+' / '+esc(stockIdentifier(r.LotNo))+' : '+reportFormat(r.Quantity)).join('<br>')+'</div></div>').join('')+'</details>';
  const rows=document.getElementById('sdLotEditRows');
  function add(row={}){const tr=document.createElement('tr');tr.innerHTML='<td><input aria-label="ANA No." class="form-control ana" maxlength="100" value="'+esc(row.AnaNo||'')+'"></td><td><input aria-label="LOT No." class="form-control lot" maxlength="100" value="'+esc(row.LotNo||'')+'"></td><td><select aria-label="Version บรรจุ" class="form-select version"><option value="">ไม่ระบุ</option>'+context.packVersions.map(v=>'<option value="'+Number(v.PackVersionId)+'">V'+Number(v.VersionNo)+' · '+esc(v.PackUnit)+' ('+(v.IsActive?'เปิด':'ปิด')+')</option>').join('')+'</select></td><td><input aria-label="จำนวนหน่วยฐาน" class="form-control qty" type="number" min="0.01" step="0.01" required value="'+esc(row.Quantity??'')+'"></td><td><button type="button" class="btn btn-outline-danger btn-sm">ลบ</button></td>';tr.querySelector('.version').value=row.PackVersionId?String(row.PackVersionId):'';tr.querySelector('button').onclick=()=>tr.remove();rows.append(tr);}
  context.rows.forEach(add);if(!context.rows.length)add({Quantity:context.quantity});
  document.getElementById('sdAddLot').onclick=()=>add();document.getElementById('sdCancelLot').onclick=()=>show('lots',scope);
  document.getElementById('sdLotForm').onsubmit=async event=>{event.preventDefault();const form=event.currentTarget,save=form.querySelector('[type=submit]'),error=document.getElementById('sdLotError');save.disabled=true;error.textContent='';
   try{const payload={productId:Number(id),whid:Number(scope.wh),locationCode:scope.code,throughTransId:context.throughTransId,version:context.version,reason:form.elements.reason.value,rows:[...rows.children].map(tr=>({AnaNo:tr.querySelector('.ana').value,LotNo:tr.querySelector('.lot').value,PackVersionId:tr.querySelector('.version').value||null,Quantity:tr.querySelector('.qty').value}))};
    const r=await fetch('/api/stock/lot-adjustments',{method:'POST',headers:{...authHeaders(),'Content-Type':'application/json'},body:JSON.stringify(payload)}),data=await r.json();if(!r.ok)throw Error(data.message||'บันทึกไม่สำเร็จ');
    delete cache.lots;delete pending.lots;await show('lots',scope);
   }catch(e){error.textContent=e.message;save.disabled=false;}
  };
 }catch(e){if(active==='adjust'){body.innerHTML='<p class="text-danger">'+esc(e.message)+'</p><button class="btn btn-outline-secondary" id="sdBackLots">กลับ</button>';document.getElementById('sdBackLots').onclick=()=>show('lots',scope);}}
 }
 async function show(tab,scope=null){active=tab;locationScope=scope;document.querySelectorAll('.sd-tabs button').forEach(el=>el.setAttribute('aria-selected',String(el.dataset.tab===tab)));const body=document.getElementById('sdBody');if(tab==='locations'){body.innerHTML=locations();bindStockLocationSummary(b);body.querySelectorAll('.sd-lots').forEach(el=>el.onclick=()=>show('lots',{wh:el.dataset.wh,code:el.dataset.location}));body.querySelectorAll('.sd-adj-lots').forEach(el=>el.onclick=()=>editLots({wh:el.dataset.wh,code:el.dataset.location}));return;}
 body.innerHTML='<p role="status">กำลังโหลดข้อมูล…</p>';
 try{if(!cache[tab]){pending[tab] ||=get(tab);cache[tab]=await pending[tab];}if(active!==tab||locationScope!==scope)return;const d=cache[tab];
 if(tab==='lots'){const rows=(d.lots||[]).filter(r=>!scope||(String(r.whid)===scope.wh&&r.LocationCode===scope.code));body.innerHTML=(scope?'<div class="d-flex justify-content-between mb-2"><strong>'+esc(scope.code)+'</strong><button class="btn btn-sm btn-outline-secondary" id="sdAllLots">ดูทุกตำแหน่ง</button></div>':'')+table(['คลัง / โลเคชั่น','ANA No.','LOT No.','คงเหลือ','หน่วยใหญ่เทียบเท่า'],rows.map(r=>'<tr><td>'+esc((b.stock.find(s=>String(s.whid)===String(r.whid))?.whname||r.whid)+' · '+r.LocationCode)+'</td><td>'+esc(stockIdentifier(r.AnaNo))+'</td><td>'+esc(stockIdentifier(r.LotNo))+'</td><td>'+reportFormat(r.Quantity)+' '+esc(unit)+'</td><td>'+esc(equivalent(Number(r.Quantity)))+'</td></tr>').join(''))+(!rows.length?'<p class="text-muted">ไม่พบข้อมูลล็อต</p>':'')+'<p class="small text-muted">“—” หมายถึงไม่มีข้อมูล ANA / LOT หรือระบุย้อนจากประวัติเดิมไม่ได้</p>';const all=document.getElementById('sdAllLots');if(all)all.onclick=()=>show('lots');if(b.canAdjustLots){const positions=[...new Map(rows.map(r=>[JSON.stringify([r.whid,r.LocationCode]),{wh:String(r.whid),code:r.LocationCode}])).values()];const controls=document.createElement('div');controls.className='d-flex flex-wrap gap-2 mt-2';for(const position of positions){const button=document.createElement('button');button.type='button';button.className='btn btn-outline-warning btn-sm';button.textContent='Adj ANA / LOT · '+position.code;button.onclick=()=>editLots(position);controls.append(button);}body.append(controls);}
 }else{const boxes=d.containers||[],tracked=boxes.reduce((n,r)=>n+Number(r.RemainingBase),0);body.innerHTML='<div class="mb-3">ภาชนะเต็ม '+boxes.filter(r=>r.Status==='SEALED').length+' · เปิดใช้แล้ว '+boxes.filter(r=>r.Status==='OPEN').length+'</div>'+(Math.abs(total-tracked)>0.005?'<div class="alert alert-warning small">ยอดที่ยังไม่ลงทะเบียนภาชนะ '+reportFormat(total-tracked)+' '+esc(unit)+'</div>':'')+table(['รหัสภาชนะ / PO','คลัง / โลเคชั่น','LOT','รับจริง','สถานะ','ตั้งต้น → คงเหลือ'],boxes.map(r=>'<tr><td>'+esc(r.ContainerCode)+'<div class="small">'+esc(r.PONo||'ยังไม่ผูก PO')+'</div></td><td>'+esc(r.whname||r.WhId)+'<div>'+esc(r.LocationCode)+'</div></td><td>'+esc(r.LotNo||'—')+'</td><td>'+esc(wmsDate(r.ReceivedAt))+'</td><td>'+(r.Status==='SEALED'?'ยังไม่เปิด':'เปิดใช้')+'</td><td>'+reportFormat(r.CapacityBase)+' → '+reportFormat(r.RemainingBase)+' '+esc(unit)+'</td></tr>').join(''))+(!boxes.length?'<p class="text-muted">ยังไม่มีภาชนะลงทะเบียน ยอดสต๊อกแสดงในแท็บคลัง / โลเคชั่น</p>':'');}
 }catch(e){delete pending[tab];if(active===tab){body.innerHTML='<p class="text-danger">'+esc(e.message)+'</p><button class="btn btn-outline-primary" id="sdRetry">ลองอีกครั้ง</button>';document.getElementById('sdRetry').onclick=()=>show(tab,scope);}}
 }
 await Swal.fire({title:'รายละเอียดสต๊อก',width:1150,customClass:{popup:'stock-dialog'},showCloseButton:true,confirmButtonText:'ปิด',html:style+'<div class="sd-shell"><div class="sd-top"><strong>'+esc(b.product.ProductCode+' · '+b.product.ProductName)+'</strong><div class="sd-summary"><div>คงเหลือ <strong>'+reportFormat(total)+' '+esc(unit)+'</strong></div><div>สินค้าดี '+reportFormat(total-damage)+' · ชำรุด '+reportFormat(damage)+' '+esc(unit)+'</div><div>เทียบเท่า '+esc(equivalent(total))+'</div></div>'+(b.packing?'<div class="small text-muted">1 '+esc(b.packing.PackUnit)+' = '+reportFormat(b.packing.UnitsPerPack)+' '+esc(unit)+(Number(b.packing.PacksPerOuter)>0?' · 1 '+esc(b.packing.OuterPackUnit)+' = '+reportFormat(b.packing.PacksPerOuter)+' '+esc(b.packing.PackUnit):'')+' · จำนวนเทียบเท่าตาม Master วันนี้</div>':'')+'<div class="sd-tabs" role="tablist" aria-label="รายละเอียดสต๊อก"><button role="tab" data-tab="locations" aria-selected="true">คลัง / โลเคชั่น</button><button role="tab" data-tab="lots" aria-selected="false">ANA / LOT</button><button role="tab" data-tab="containers" aria-selected="false">กล่อง / ภาชนะ</button></div></div><div class="sd-body" id="sdBody" role="tabpanel"></div></div>',didOpen:()=>{document.querySelectorAll('.sd-tabs button').forEach(el=>el.onclick=()=>show(el.dataset.tab));show('locations');}});
 }catch(e){await Swal.fire('โหลดรายละเอียดไม่ได้',e.message,'error');}
}
