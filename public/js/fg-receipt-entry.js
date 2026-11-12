/* FG entry converts packing quantities into the existing base-unit receipt flow. */
let fgEntryPack=null,fgEntryProduct=null,fgEntryVersion=0,fgEntryDate='';
function fgEntryCalculate(packs,loose,size){
  if(!Number.isSafeInteger(packs)||packs<0||!Number.isSafeInteger(loose)||loose<0||!(size>0)||!Number.isSafeInteger(size))throw Error('กรอกจำนวนเต็มตั้งแต่ 0 ขึ้นไป');
  if(loose>=size)throw Error('จำนวนเศษต้องน้อยกว่าจำนวนบรรจุต่อหนึ่งลัง');
  const total=packs*size+loose;if(!Number.isSafeInteger(total)||total<=0||total>999999999999)throw Error('จำนวนรวมต้องมากกว่า 0 และไม่เกินขอบเขตที่รับได้');return total;
}
function fgEntryPreview(){
  const preview=document.getElementById('fgEntryPreview'),quantity=document.getElementById('inboundQuantity');if(!fgEntryPack||!preview)return;
  try{const total=WmsPacking.calculate(fgEntryPack,Number(document.getElementById('fgEntryLoose').value),Number(document.getElementById('fgEntryPacks').value),Number(document.getElementById('fgEntryOuter')?.value||0));quantity.value=String(total);preview.textContent='รวมรับ '+total.toLocaleString('th-TH')+' '+(fgEntryPack.StockUnitLabel||fgEntryProduct.UOM)+' ('+fgEntryProduct.UOM+')';preview.className='fw-bold text-primary mt-2';}catch(e){quantity.value='';preview.textContent=e.message;preview.className='small text-danger mt-2';}
}
async function loadFgEntryPacking(){
  const version=++fgEntryVersion;fgEntryPack=null;fgEntryProduct=null;
  let panel=document.getElementById('fgEntryPacking');if(!panel){panel=document.createElement('section');panel.id='fgEntryPacking';panel.className='border rounded-3 p-3 my-3';document.getElementById('inboundProductionLineFields').before(panel);}
  panel.hidden=inboundSourceMode!=='PRODUCTION';const quantity=document.getElementById('inboundQuantity');quantity.readOnly=false;if(panel.hidden)return;
  const code=document.getElementById('inboundProduct').value.trim().toLowerCase(),product=inboundMaster?.products.find(p=>p.ReceiveType==='FG'&&(String(p.ProductCode).toLowerCase()===code||p.Barcode&&String(p.Barcode).toLowerCase()===code));
  if(!product){panel.innerHTML='<div class="small text-muted">เลือกสินค้า FG เพื่อระบุหน่วยรับ</div>';return;}
  const date=document.getElementById('inboundDocumentDate').value;
  if(!date){panel.innerHTML='<div class="small text-muted">ระบุวันที่เอกสารก่อน ระบบจะเลือกอัตราบรรจุที่มีผลในวันนั้น</div>';return;}
  panel.innerHTML='<div class="small text-muted">กำลังโหลดอัตราบรรจุ…</div>';
  try{const response=await fetch('/api/products/'+Number(product.ProductId)+'/pack-versions?date='+encodeURIComponent(date),{headers:authHeaders(),cache:'no-store'}),body=await response.json();if(version!==fgEntryVersion)return;if(!response.ok)throw Error(body.message||'โหลดอัตราบรรจุไม่ได้');
    const pack=body.current;
    if(!pack||body.product.UnitId!==pack.StockUnitId||!Number.isSafeInteger(Number(pack.UnitsPerPack))||product.UOM!=='PCS'){panel.innerHTML='<div class="small text-muted">ยังไม่มีอัตราบรรจุสำหรับการคีย์เป็นลังในวันที่นี้ · กรอกจำนวนหน่วยสต๊อกในช่องจำนวนที่ผลิตได้</div>';return;}
    fgEntryPack=pack;fgEntryProduct=product;fgEntryDate=date;quantity.value='';quantity.readOnly=true;
    panel.innerHTML='<h6 class="fw-bold">จำนวน FG ที่ฝ่ายผลิตส่งมอบ</h6><div class="small text-muted mb-3">1 '+inboundEsc(pack.PackUnit)+' = '+Number(pack.UnitsPerPack).toLocaleString('th-TH')+' '+inboundEsc(pack.StockUnitLabel||product.UOM)+(Number(pack.NetVolumeMlPerUnit)>0?' · หน่วยละ '+Number(pack.NetVolumeMlPerUnit).toLocaleString('th-TH')+' ml':'')+' · รุ่น V'+Number(pack.VersionNo)+'</div><div class="row g-2"><div class="col-sm-6"><label class="form-label small" for="fgEntryLoose">หน่วยย่อย / เศษ ('+inboundEsc(pack.StockUnitLabel||product.UOM)+')</label><input id="fgEntryLoose" class="form-control" type="number" min="0" step="1" value="0"></div><div class="col-sm-6"><label class="form-label small" for="fgEntryPacks">หน่วยใหญ่ ('+inboundEsc(pack.PackUnit)+')</label><input id="fgEntryPacks" class="form-control" type="number" min="0" step="1" value="0"></div></div>'+(pack.OuterPackUnit?'<div class="mt-2"><label class="form-label small" for="fgEntryOuter">'+inboundEsc(pack.OuterPackUnit)+' (1 '+inboundEsc(pack.OuterPackUnit)+' = '+Number(pack.PacksPerOuter)+' '+inboundEsc(pack.PackUnit)+')</label><input id="fgEntryOuter" class="form-control" type="number" min="0" step="1" value="0"></div>':'')+'<div id="fgEntryPreview" aria-live="polite" class="small text-muted mt-2">ระบุจำนวนรับ</div><div class="small text-muted mt-2">ระบบส่งยอดรวมเป็น '+inboundEsc(product.UOM)+' เข้ารายการใบรับ · เพิ่มสต๊อกเมื่อยืนยันตรวจรับจริง</div>';
    for(const id of ['fgEntryLoose','fgEntryPacks','fgEntryOuter'].filter(id=>document.getElementById(id)))document.getElementById(id).addEventListener('input',fgEntryPreview);
  }catch(e){if(version===fgEntryVersion)panel.innerHTML='<div class="small text-warning">'+inboundEsc(e.message)+' · ยังสามารถคีย์จำนวนหน่วยสต๊อกโดยตรงได้</div>';}
}
const fgOriginalUnit=showInboundFgUnit;
showInboundFgUnit=function(){fgOriginalUnit();loadFgEntryPacking();};
document.getElementById('inboundDocumentDate').addEventListener('change',()=>{if(inboundSourceMode==='PRODUCTION')loadFgEntryPacking();});
const fgOriginalAdd=addInboundLine;
addInboundLine=function(){if(inboundSourceMode==='PRODUCTION'&&fgEntryPack){const code=document.getElementById('inboundProduct').value.trim().toLowerCase();if(fgEntryDate!==document.getElementById('inboundDocumentDate').value||!(String(fgEntryProduct.ProductCode).toLowerCase()===code||fgEntryProduct.Barcode&&String(fgEntryProduct.Barcode).toLowerCase()===code)){loadFgEntryPacking();return;}fgEntryPreview();if(!document.getElementById('inboundQuantity').value)return;}
 const before=inboundDraft.length;fgOriginalAdd();if(inboundSourceMode==='PRODUCTION'&&fgEntryPack&&inboundDraft.length>before){document.getElementById('fgEntryLoose').value='0';document.getElementById('fgEntryPacks').value='0';if(document.getElementById('fgEntryOuter'))document.getElementById('fgEntryOuter').value='0';document.getElementById('inboundQuantity').value='';document.getElementById('fgEntryPreview').textContent='เพิ่มรายการแล้ว · ระบุจำนวนสำหรับรายการถัดไป';}};
