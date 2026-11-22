/* Optional third level; all stock quantities remain in the existing base unit. */
window.WmsPacking=(()=>{
 const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 function calculate(pack,loose,boxes,outers=0){
  const size=Number(pack.UnitsPerPack),factor=Number(pack.PacksPerOuter||0);
  if(![loose,boxes,outers,size].every(Number.isSafeInteger)||loose<0||loose>=size||boxes<0||outers<0||size<=0||outers&&(!pack.OuterPackUnit||!Number.isSafeInteger(factor)||factor<2))throw Error('กรอกจำนวนเต็ม · จำนวนเศษต้องน้อยกว่าบรรจุต่อหนึ่งลัง');
  const total=loose+size*boxes+size*factor*outers;
  if(!Number.isSafeInteger(total)||total<=0||total>999999999999)throw Error('จำนวนรวมต้องมากกว่า 0 และไม่เกินขอบเขตที่รองรับ');return total;
 }
 function equivalent(n,p,base){
  let rest=Number(n),size=Number(p?.UnitsPerPack),result=[];if(!(size>0)||rest<0)return '—';
  const outer=Number(p.PacksPerOuter);if(p.OuterPackUnit&&outer>=2){const full=Math.floor(rest/(size*outer));result.push(full.toLocaleString('th-TH')+' '+p.OuterPackUnit);rest-=full*size*outer;}
  const boxes=Math.floor(rest/size);if(boxes||!result.length)result.push(boxes.toLocaleString('th-TH')+' '+p.PackUnit);rest=Number((rest-boxes*size).toFixed(6));if(rest)result.push(rest.toLocaleString('th-TH')+' '+(p.StockUnitLabel||base||''));return result.join(' + ');
 }
 const versions=new WeakMap(),handlers=new WeakMap(),entries=new WeakMap(),panels=new WeakMap();
 function clear(input){const old=handlers.get(input);if(old){input.removeEventListener('input',old);handlers.delete(input);}versions.set(input,(versions.get(input)||0)+1);panels.get(input)?.remove();panels.delete(input);input.readOnly=false;entries.delete(input);}
 async function mount(input,id,date){
  clear(input);const seq=versions.get(input);if(!id)return;
  const panel=document.createElement('div');panel.dataset.packingFor=input.id;panel.className='border rounded-3 p-3 mt-2';panel.textContent='กำลังโหลดหน่วยบรรจุ…';panels.set(input,panel);const row=input.closest('.row');if(row&&row.contains(input))row.after(panel);else input.after(panel);
  try{const query=date?'?date='+encodeURIComponent(date):'',res=await fetch('/api/products/'+Number(id)+'/pack-versions'+query,{headers:authHeaders(),cache:'no-store'}),b=await res.json();if(versions.get(input)!==seq)return;if(!res.ok)throw Error(b.message);const p=b.current;if(!p||!Number.isSafeInteger(Number(p.UnitsPerPack))||b.product.UnitCode!=='PCS'){panel.remove();panels.delete(input);return;}
   const labels=[p.StockUnitLabel||b.product.UnitCode,p.PackUnit,...(p.OuterPackUnit?[p.OuterPackUnit]:[])];
   panel.innerHTML='<div class="small fw-bold mb-2">กรอกจำนวนตามบรรจุภัณฑ์ · รุ่น V'+Number(p.VersionNo)+'</div><div class="small text-muted mb-2">กรอกได้ทั้งหน่วยย่อย กล่อง และลัง ระบบจะรวมเป็นหน่วยสต๊อกก่อนบันทึก</div><div class="row g-2">'+labels.map((l,i)=>'<div class="col"><label class="small">จำนวน '+esc(l)+'<input aria-label="จำนวน '+esc(l)+'" data-pack-index="'+i+'" type="number" min="0" step="1" value="0" class="form-control"></label></div>').join('')+'</div><div class="small mt-2" role="status" aria-live="polite"></div>';
   // Direct base-unit entry remains available; helper fields are optional.
   panel.addEventListener('input',()=>{if(input.disabled||input.closest('fieldset[disabled]'))return;try{const v=[...panel.querySelectorAll('input')].map(x=>Number(x.value));input.value=String(calculate(p,v[0],v[1],v[2]||0));const source=v.map((n,i)=>n?Number(n).toLocaleString('th-TH')+' '+labels[i]:null).filter(Boolean).join(' + ');entries.set(input,source+' = '+Number(input.value).toLocaleString('th-TH')+' '+labels[0]);panel.lastElementChild.textContent=entries.get(input);input.dispatchEvent(new Event('input',{bubbles:true}));}catch(e){input.value='';entries.delete(input);panel.lastElementChild.textContent=e.message;}});
   const directHandler=()=>{if(document.activeElement===input&&panel.isConnected){panel.querySelectorAll('input').forEach(x=>x.value='0');entries.delete(input);panel.lastElementChild.textContent='กรอกยอดรวมโดยตรง '+input.value+' '+labels[0];}};handlers.set(input,directHandler);input.addEventListener('input',directHandler);
  }catch(e){if(versions.get(input)===seq)panel.textContent='โหลดหน่วยบรรจุไม่ได้ · กรอกยอดหน่วยหลักได้ตามเดิม';}
 }
 return {calculate,equivalent,mount,clear,describe:input=>entries.get(input)||''};
})();
