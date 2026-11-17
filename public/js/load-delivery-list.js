// The Load page fetches only the requested slice of delivery headers. Details stay on demand.
const shipListState={tab:'today',page:1,search:'',status:'',from:'',to:'',context:'',sequence:0};
function shipToday(){const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Bangkok',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());const part=t=>parts.find(p=>p.type===t).value;return `${part('year')}-${part('month')}-${part('day')}`;}
function chooseShipTab(tab){if(!['today','open','history'].includes(tab))return;shipListState.tab=tab;shipListState.page=1;renderDeliveryOrders();}
function searchShipList(){shipListState.search=document.getElementById('shipSearch').value.trim();shipListState.status=document.getElementById('shipStatus').value;shipListState.from=document.getElementById('shipDateFrom').value;shipListState.to=document.getElementById('shipDateTo').value;shipListState.page=1;renderDeliveryOrders();}
function clearShipList(){const s=shipListState;s.search=s.status='';s.from=s.to=shipToday();s.page=1;document.getElementById('shipSearch').value='';document.getElementById('shipStatus').value='';document.getElementById('shipDateFrom').value=s.from;document.getElementById('shipDateTo').value=s.to;renderDeliveryOrders();}
function pageShipList(delta){shipListState.page+=delta;renderDeliveryOrders();}
window.renderDeliveryOrders=async function(){
 const s=shipListState,body=document.getElementById('shipOrders');if(!deliveryData||!body)return;
 const context=deliveryCategory+':'+deliveryType;if(s.context!==context){s.context=context;s.page=1;}
 if(!s.from){s.from=s.to=shipToday();document.getElementById('shipDateFrom').value=s.from;document.getElementById('shipDateTo').value=s.to;}
 document.getElementById('shipDateFilters').hidden=s.tab!=='history';document.querySelectorAll('[data-ship-tab]').forEach(b=>{b.classList.toggle('btn-primary',b.dataset.shipTab===s.tab);b.classList.toggle('btn-outline-primary',b.dataset.shipTab!==s.tab);b.setAttribute('aria-selected',String(b.dataset.shipTab===s.tab));});
 if(s.tab==='history'&&(!s.from||!s.to||s.from>s.to)){shipMessage('กรุณาเลือกช่วงวันที่ให้ถูกต้อง',true);return;}
 const seq=++s.sequence;document.getElementById('shipPrevious').disabled=true;document.getElementById('shipNext').disabled=true;body.innerHTML='<tr><td colspan="4" class="text-center py-4">กำลังโหลดใบส่ง…</td></tr>';
 try{const query=new URLSearchParams({category:deliveryCategory,type:deliveryType,tab:s.tab,page:s.page,search:s.search,status:s.status,from:s.from,to:s.to});const result=await deliveryApi('/list?'+query);if(seq!==s.sequence)return;deliveryData.orders=result.data;
  document.getElementById('shipTodayCount').textContent=result.counts.today;document.getElementById('shipOpenCount').textContent=result.counts.open;
  document.getElementById('shipListStatus').textContent=s.tab==='today'?'ใบส่งที่สร้างวันนี้ '+wmsDate(shipToday()):s.tab==='open'?'ร่างและใบส่งที่รอผู้รับ รวมวันก่อนหน้า':'ใบส่งที่สร้าง '+wmsDate(s.from)+(s.from===s.to?'':' ถึง '+wmsDate(s.to));
  renderDeliveryOrdersBase();const rules={prepareDelivery:'CONFIRM',dispatchDelivery:'CONFIRM',receiveDelivery:'CONFIRM',cancelDelivery:'EDIT',printDelivery:'EXPORT',downloadDeliveryPdf:'EXPORT'};body.querySelectorAll('button[onclick]').forEach(b=>{const name=b.getAttribute('onclick').split('(')[0];if(rules[name])b.hidden=!deliveryCategoryCan(deliveryCategory,rules[name]);});
  document.getElementById('shipPageInfo').textContent=`${result.total} ใบส่ง · หน้า ${s.page} / ${Math.max(1,Math.ceil(result.total/25))}`;document.getElementById('shipPrevious').disabled=s.page<=1;document.getElementById('shipNext').disabled=s.page*25>=result.total;
 }catch(e){if(seq!==s.sequence)return;body.innerHTML='<tr><td colspan="4" class="text-center text-danger py-4">'+shipEsc(e.message)+'</td></tr>';document.getElementById('shipPageInfo').textContent='';}
};
