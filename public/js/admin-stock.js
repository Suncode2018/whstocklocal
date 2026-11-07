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
    document.getElementById('reportUpdated').textContent = 'โหลดล่าสุด: ' + new Date().toLocaleString('th-TH');
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
    const time = date && !Number.isNaN(date.getTime()) ? date.toLocaleString('th-TH') : '—';
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
  link.href = url; link.download = 'Stock_Report_' + new Date().toISOString().slice(0,10) + '.csv';
  document.body.appendChild(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url),1000);
}

async function showStockBoxDetails(id){try{const response=await fetch('/api/stock/containers/'+Number(id),{headers:authHeaders(),cache:'no-store'}),b=await response.json();if(!response.ok)throw Error(b.message||'โหลดรายละเอียดไม่ได้');const boxes=b.containers||[],total=b.stock.reduce((n,s)=>n+Number(s.Quantity),0),tracked=boxes.reduce((n,c)=>n+Number(c.RemainingBase),0),groups=new Map();for(const c of boxes){const key=JSON.stringify([c.WhId,c.LocationCode,c.PONo,c.LotNo,c.CapacityBase,c.PackUnit]);if(!groups.has(key))groups.set(key,{...c,count:0,total:0,open:0});const g=groups.get(key);g.count++;g.total+=Number(c.RemainingBase);if(c.Status==='OPEN')g.open++;}const unit=reportEscape(b.product.UnitCode||'');await Swal.fire({title:'รายละเอียดสต๊อก',width:1150,html:'<div class="text-start"><strong>'+reportEscape(b.product.ProductCode+' · '+b.product.ProductName)+'</strong><div class="row g-2 my-3"><div class="col-sm-4"><div class="p-3 border rounded-3 small">ยอดคงเหลือ<br><strong>'+reportFormat(total)+' '+unit+'</strong></div></div><div class="col-sm-4"><div class="p-3 border rounded-3 small">กล่องเต็ม / ภาชนะเต็ม<br><strong>'+boxes.filter(c=>c.Status==='SEALED').length+' ใบ</strong></div></div><div class="col-sm-4"><div class="p-3 border rounded-3 small">เปิดใช้แล้ว<br><strong>'+boxes.filter(c=>c.Status==='OPEN').length+' ใบ</strong></div></div></div>'+(Math.abs(total-tracked)>0.005?'<div class="alert alert-warning small">ยอดที่ยังไม่ตรงทะเบียนกล่อง '+reportFormat(total-tracked)+' '+unit+' · ตรวจทะเบียนยอดเดิมก่อนจ่ายเป็นกล่อง</div>':'')+'<h6 class="fw-bold mt-3">แยกตาม PO / Lot / อัตราบรรจุจริง</h6><div class="table-responsive"><table class="table table-sm align-middle"><thead><tr><th>คลัง / ตำแหน่ง</th><th>PO / Lot</th><th>บรรจุต่อกล่อง</th><th>จำนวนภาชนะคงเหลือ</th><th>น้ำหนักคงเหลือ</th></tr></thead><tbody>'+[...groups.values()].map(g=>'<tr><td>'+reportEscape(g.whname+' · '+(g.whdescription||''))+'<div class="small text-muted">'+reportEscape(g.LocationCode)+'</div></td><td>'+reportEscape(g.PONo||'ยอดเดิม / ยังไม่ผูก PO')+'<div class="small">Lot '+reportEscape(g.LotNo)+'</div></td><td>1 '+reportEscape(g.PackUnit)+' = '+reportFormat(g.CapacityBase)+' '+unit+'</td><td>'+g.count+' '+reportEscape(g.PackUnit)+'<div class="small text-muted">เปิดใช้ '+g.open+'</div></td><td class="fw-bold">'+reportFormat(g.total)+' '+unit+'</td></tr>').join('')+'</tbody></table></div><details class="mt-3"><summary>ดูรหัสทุกกล่อง เรียงรับเข้าก่อน (FIFO)</summary><div class="table-responsive mt-2" style="max-height:350px;overflow:auto"><table class="table table-sm"><thead><tr><th>รหัสกล่อง / PO</th><th>รับจริง</th><th>Lot / หมดอายุ</th><th>สถานะ</th><th>ตั้งต้น → คงเหลือ</th></tr></thead><tbody>'+boxes.map(c=>'<tr><td class="small">'+reportEscape(c.ContainerCode)+'<br>'+reportEscape(c.PONo||'ยังไม่ผูก PO')+'</td><td class="small">'+new Date(c.ReceivedAt).toLocaleString('th-TH')+'</td><td class="small">'+reportEscape(c.LotNo)+'<br>'+reportEscape(c.ExpiryDate?String(c.ExpiryDate).slice(0,10):'ไม่ระบุวันหมดอายุ')+'</td><td>'+(c.Status==='SEALED'?'ยังไม่เปิด':'เปิดใช้')+'</td><td>'+reportFormat(c.CapacityBase)+' → '+reportFormat(c.RemainingBase)+' '+unit+'</td></tr>').join('')+'</tbody></table></div></details>'+(!boxes.length?'<p class="small text-muted">ไม่มีภาชนะคงเหลือที่ลงทะเบียนในคลังที่มีสิทธิ์</p>':'')+'</div>',confirmButtonText:'ปิด'})}catch(e){await Swal.fire('โหลดรายละเอียดไม่ได้',e.message,'error')}}
