// UUID v4 uses secure random bytes on LAN HTTP where randomUUID is unavailable.
function wmsUuid(){
 const source=globalThis.crypto;
 if(typeof source?.randomUUID==='function')return source.randomUUID();
 if(typeof source?.getRandomValues!=='function')throw new Error('เบราว์เซอร์นี้ไม่รองรับการสร้างรหัสคำขอ กรุณาใช้ Chrome หรือ Edge รุ่นปัจจุบัน');
 const bytes=new Uint8Array(16);source.getRandomValues(bytes);
 bytes[6]=(bytes[6]&15)|64;bytes[8]=(bytes[8]&63)|128;
 const hex=Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');
 return hex.slice(0,8)+'-'+hex.slice(8,12)+'-'+hex.slice(12,16)+'-'+hex.slice(16,20)+'-'+hex.slice(20);
}

/* ============================================================
   common.js — ฟังก์ชันกลางสำหรับระบบ WMS
   ============================================================ */

// ตรวจสอบ Token และสิทธิ์การเข้าใช้งานหน้าเว็บ
function requireAuth(allowedRoles = []) {
  const token = localStorage.getItem('token');
  const userStr = localStorage.getItem('user');

  if (!token || !userStr) {
    window.location.href = '/index.html?msg=' + encodeURIComponent('กรุณาเข้าสู่ระบบก่อน');
    return null;
  }

  try {
    const user = JSON.parse(userStr);
    const segment=token.split('.')[1];const claims=JSON.parse(atob(segment.replace(/-/g,'+').replace(/_/g,'/')));if(claims.exp&&claims.exp*1000<=Date.now()){logout();return null;}
    if (allowedRoles.length > 0 && !allowedRoles.includes(user.role)) {
      window.location.href = '/index.html?msg=' + encodeURIComponent('ไม่มีสิทธิ์เข้าถึงหน้านี้');
      return null;
    }
    return user;
  } catch (err) {
    console.error('Auth parse error:', err);
    logout();
    return null;
  }
}

// สร้าง Header สำหรับแนบไปกับคำขอ API ที่ต้องใช้สิทธิ์
function authHeaders() {
  const token = localStorage.getItem('token');
  return {
    'Authorization': 'Bearer ' + (token || ''),
    'Content-Type': 'application/json'
  };
}

// ฟังก์ชันออกจากระบบ
function logout() {
  localStorage.removeItem('token');
  localStorage.removeItem('user');
  localStorage.removeItem('wms_navigation');
  window.location.href = '/index.html';
}
/* Shared themed dialogs for Admin, Desktop and Handheld. */
let wmsDialogPending=false;
function wmsDialog(options={}){
 if(wmsDialogPending)return Promise.resolve({confirmed:false,value:null});
 wmsDialogPending=true;
 const previous=document.activeElement,d=document.createElement('dialog');d.className='wms-dialog';d.setAttribute('aria-labelledby','wmsDialogTitle');d.setAttribute('aria-describedby','wmsDialogText');
 const icon=document.createElement('div');icon.className='wms-dialog-icon';icon.textContent=options.input?'✎':options.alert?'i':'?';icon.setAttribute('aria-hidden','true');
 const title=document.createElement('h2');title.id='wmsDialogTitle';title.textContent=options.title||'ยืนยันการทำรายการ';
 const text=document.createElement('p');text.id='wmsDialogText';text.textContent=String(options.message||'');
 d.append(icon,title,text);let input,validation;
 if(options.input){const label=document.createElement('label');label.textContent='เหตุผล *';label.htmlFor='wmsDialogInput';input=document.createElement('textarea');input.id='wmsDialogInput';input.rows=3;input.maxLength=255;input.placeholder='ระบุเหตุผลเพื่อเก็บในประวัติ';validation=document.createElement('p');validation.className='wms-dialog-validation';validation.setAttribute('role','alert');d.append(label,input,validation)}
 const actions=document.createElement('div');actions.className='wms-dialog-actions';const cancel=document.createElement('button');cancel.type='button';cancel.className='wms-dialog-back';cancel.textContent=options.cancelText||'กลับไปตรวจสอบ';const ok=document.createElement('button');ok.type='button';ok.className=options.danger?'wms-dialog-danger':'wms-dialog-primary';ok.textContent=options.confirmText||'ยืนยัน';if(!options.alert)actions.append(cancel);actions.append(ok);d.append(actions);document.body.append(d);
 return new Promise(resolve=>{let finished=false;const finish=(confirmed,value=null)=>{if(finished)return;finished=true;d.close();d.remove();wmsDialogPending=false;if(previous?.isConnected)previous.focus();resolve({confirmed,value})};cancel.onclick=()=>finish(false);ok.onclick=()=>{if(input&&!input.value.trim()){validation.textContent='กรุณาระบุเหตุผลก่อนยืนยัน';input.focus();return}finish(true,input?.value.trim()||null)};d.addEventListener('cancel',e=>{e.preventDefault();finish(false)});d.showModal();(input||(!options.alert?cancel:ok)).focus()});
}
async function wmsConfirm(message,confirmText,cancelText){const discard=/ละทิ้ง|ถูกล้าง/.test(message);let label=confirmText||(discard?'ทิ้งการเปลี่ยนแปลง':/เปิดใช้สูตร/.test(message)?'เปิดใช้สูตร':/ยืนยันย้าย/.test(message)?'ยืนยันโอนย้าย':/ปรับยอด|ปรับสต๊อก/.test(message)?'ยืนยันปรับยอด':/ยกเลิก/.test(message)?'ยืนยันยกเลิก':/ส่งตรวจ/.test(message)?'ส่งตรวจผลต่าง':'ยืนยันรายการ');return(await wmsDialog({title:discard?'มีการแก้ไขที่ยังไม่บันทึก':'ตรวจสอบก่อนยืนยัน',message,confirmText:label,cancelText:cancelText||(discard?'แก้ไขต่อ':'กลับไปตรวจสอบ'),danger:discard||/ยกเลิก/.test(message)})).confirmed}
async function wmsPrompt(message){const result=await wmsDialog({title:'ระบุเหตุผลยกเลิก',message,input:true,danger:true,confirmText:'ยืนยันยกเลิก',cancelText:'กลับไปตรวจสอบ'});return result.confirmed?result.value:null}
async function wmsAlert(message){await wmsDialog({title:'แจ้งเตือน',message,alert:true,confirmText:'รับทราบ'})}
(()=>{if(!document.getElementById('wmsDialogTheme')){const link=document.createElement('link');link.id='wmsDialogTheme';link.rel='stylesheet';link.href='/css/dialogs.css?v=20261107-1';document.head.append(link)}const themeSwal=()=>{if(window.Swal&&!window.Swal.wmsThemed){window.Swal=window.Swal.mixin({confirmButtonText:'รับทราบ',cancelButtonText:'กลับไปตรวจสอบ',confirmButtonColor:'#5540df',cancelButtonColor:'#667085',customClass:{popup:'wms-swal',confirmButton:'wms-swal-confirm',cancelButton:'wms-swal-cancel'}});window.Swal.wmsThemed=true}};themeSwal();document.addEventListener('DOMContentLoaded',themeSwal,{once:true})})();

// Share identical simultaneous reads only. No persistent cache of stock or permissions.
const wmsPendingReads=new Map();
let wmsReadEpoch=0;
function wmsFetch(input,options={}){
 const method=String(options.method||'GET').toUpperCase();
 if(method!=='GET'){wmsReadEpoch++;wmsPendingReads.clear();return fetch(input,options);}
 if(typeof input!=='string'||options.signal)return fetch(input,options);
 const url=new URL(input,window.location.href);
 if(url.origin!==window.location.origin||!url.pathname.startsWith('/api/'))return fetch(input,options);
 const headers=[...new Headers(options.headers||{}).entries()].sort((a,b)=>a[0].localeCompare(b[0]));
 const key=JSON.stringify([wmsReadEpoch,url.href,headers,options.credentials||'same-origin',options.cache||'default']);
 let pending=wmsPendingReads.get(key);
 if(!pending){pending=fetch(input,options);wmsPendingReads.set(key,pending);const clear=()=>{if(wmsPendingReads.get(key)===pending)wmsPendingReads.delete(key)};pending.then(clear,clear);}
 return pending.then(response=>response.clone());
}
