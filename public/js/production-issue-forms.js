'use strict';

let issueFormRows=[],issueFormEditing=null,issueFormSaving=false;
const ife=id=>document.getElementById(id);
const issueFormEscape=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));

async function issueFormRequest(path,options={}){
 const response=await wmsFetch('/api/production-issue-forms'+path,{headers:{...authHeaders(),...(options.body?{'Content-Type':'application/json'}:{})},cache:'no-store',...options});
 const body=await response.json().catch(()=>({}));
 if(!response.ok||!body.success)throw Error(body.message||'จัดการ Revision ฟอร์มไม่สำเร็จ');
 return body;
}

async function loadIssueForms(){
 const notice=ife('issueFormNotice');if(!notice)return;
 notice.textContent='กำลังโหลด Revision ฟอร์ม…';notice.className='muted';
 try{const result=await issueFormRequest('/');issueFormRows=result.data||[];notice.textContent='';renderIssueForms();}
 catch(error){notice.textContent=error.message;notice.className='text-danger';ife('issueFormBody').innerHTML='<tr><td colspan="6" class="text-center text-muted py-5">โหลดข้อมูลไม่สำเร็จ</td></tr>';}
}

function filteredIssueForms(){
 const words=(ife('issueFormSearch')?.value||'').trim().toLocaleLowerCase().split(/\s+/).filter(Boolean),status=ife('issueFormFilter')?.value||'';
 return issueFormRows.filter(row=>words.every(word=>[row.FormCode,row.FormRevision,row.CompanyName,row.DocumentTitle].join(' ').toLocaleLowerCase().includes(word))&&(!status||String(Number(row.IsActive))===status));
}

function issueFormDate(value){
 const match=/^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value||''));
 return match?`${match[3]}/${match[2]}/${Number(match[1])+543}`:'—';
}

function renderIssueForms(){
 const body=ife('issueFormBody');if(!body)return;
 const rows=filteredIssueForms();
 const activeCount=issueFormRows.filter(row=>row.IsActive).length,notice=ife('issueFormNotice');
 ife('issueFormTotal').textContent=issueFormRows.length.toLocaleString('th-TH');
 ife('issueFormActive').textContent=activeCount.toLocaleString('th-TH');
 ife('issueFormInactive').textContent=issueFormRows.filter(row=>!row.IsActive).length.toLocaleString('th-TH');
 if(activeCount===0){notice.textContent='ยังไม่มี Revision ที่เปิดใช้งาน ระบบจะยังสร้างใบเบิกผลิตใหม่ไม่ได้';notice.className='alert alert-warning py-2';}
 else if(notice.classList.contains('alert-warning')){notice.textContent='';notice.className='';}
 body.innerHTML=rows.map(row=>'<tr><td><strong>'+issueFormEscape(row.FormCode)+'</strong></td><td>'+issueFormEscape(row.FormRevision)+'</td><td>'+issueFormDate(row.EffectiveDate)+'</td><td><div>'+issueFormEscape(row.CompanyName)+'</div><small class="muted">'+issueFormEscape(row.DocumentTitle)+'</small></td><td><span class="badge '+(row.IsActive?'bg-success':'bg-secondary')+'">'+(row.IsActive?'ใช้งาน':'ปิดใช้งาน')+'</span></td><td class="text-end text-nowrap"><button type="button" class="btn btn-outline-primary btn-sm" data-edit="'+row.FormTemplateId+'">แก้ไข</button> '+(row.IsActive?'':'<button type="button" class="btn btn-outline-success btn-sm" data-enable="'+row.FormTemplateId+'">เปิดใช้</button>')+' <button type="button" class="btn btn-outline-danger btn-sm" data-disable="'+row.FormTemplateId+'" '+(!row.IsActive?'disabled':'')+'>ปิดใช้</button></td></tr>').join('')||'<tr><td colspan="6" class="text-center text-muted py-5">ไม่พบ Revision ที่ตรงกับเงื่อนไข</td></tr>';
 body.querySelectorAll('[data-edit]').forEach(button=>button.addEventListener('click',()=>openIssueForm(Number(button.dataset.edit))));
 body.querySelectorAll('[data-enable]').forEach(button=>button.addEventListener('click',()=>activateIssueForm(Number(button.dataset.enable))));
 body.querySelectorAll('[data-disable]').forEach(button=>button.addEventListener('click',()=>deactivateIssueForm(Number(button.dataset.disable))));
}

function openIssueForm(id=null){
 issueFormEditing=issueFormRows.find(row=>row.FormTemplateId===id)||null;
 ife('issueFormTitle').textContent=issueFormEditing?'แก้ไข Revision ฟอร์ม':'เพิ่ม Revision ฟอร์ม';
 ife('issueFormCode').value=issueFormEditing?.FormCode||'FR-PD-02';
 ife('issueFormCode').readOnly=!!issueFormEditing;
 ife('issueFormRevision').value=issueFormEditing?.FormRevision||'';
 ife('issueFormDate').value=issueFormEditing?.EffectiveDate||new Date().toISOString().slice(0,10);
 ife('issueFormCompany').value=issueFormEditing?.CompanyName||'บริษัท รวยมั่งคั่ง 69 จำกัด';
 ife('issueFormDocumentTitle').value=issueFormEditing?.DocumentTitle||'ใบเบิกสินค้าเพื่อผลิต';
 ife('issueFormEnabled').value=issueFormEditing?.IsActive?'1':'0';
 ife('issueFormError').textContent='';ife('issueFormDialog').showModal();
}

async function saveIssueForm(event){
 event.preventDefault();if(issueFormSaving)return;
 issueFormSaving=true;ife('issueFormSave').disabled=true;ife('issueFormError').textContent='';
 const data={formCode:ife('issueFormCode').value.trim(),formRevision:ife('issueFormRevision').value.trim(),effectiveDate:ife('issueFormDate').value,companyName:ife('issueFormCompany').value.trim(),documentTitle:ife('issueFormDocumentTitle').value.trim(),isActive:ife('issueFormEnabled').value==='1',...(issueFormEditing?{version:issueFormEditing.Version}:{})};
 try{await issueFormRequest(issueFormEditing?'/'+issueFormEditing.FormTemplateId:'/',{method:issueFormEditing?'PUT':'POST',body:JSON.stringify(data)});ife('issueFormDialog').close();await loadIssueForms();}
 catch(error){ife('issueFormError').textContent=error.message;}
 finally{issueFormSaving=false;ife('issueFormSave').disabled=false;}
}

async function activateIssueForm(id){
 const row=issueFormRows.find(item=>item.FormTemplateId===id);if(!row)return;
 try{await issueFormRequest('/'+id,{method:'PUT',body:JSON.stringify({formCode:row.FormCode,formRevision:row.FormRevision,effectiveDate:row.EffectiveDate,companyName:row.CompanyName,documentTitle:row.DocumentTitle,isActive:true,version:row.Version})});await loadIssueForms();}
 catch(error){ife('issueFormNotice').textContent=error.message;ife('issueFormNotice').className='text-danger';}
}

async function deactivateIssueForm(id){
 const row=issueFormRows.find(item=>item.FormTemplateId===id);if(!row||!row.IsActive)return;
 const confirmed=window.Swal?await Swal.fire({title:'ปิดใช้ Revision นี้?',text:'เอกสารเดิมจะเก็บ Revision ที่บันทึกไว้ ส่วนใบเบิกใหม่จะต้องเลือก Revision ที่เปิดใช้งาน',icon:'warning',showCancelButton:true,confirmButtonText:'ปิดใช้',cancelButtonText:'ยกเลิก'}).then(result=>result.isConfirmed):window.confirm('ปิดใช้ '+row.FormRevision+' หรือไม่?');
 if(!confirmed)return;
 try{await issueFormRequest('/'+id,{method:'DELETE',headers:{...authHeaders(),'Content-Type':'application/json'},body:JSON.stringify({version:row.Version})});await loadIssueForms();}
 catch(error){ife('issueFormNotice').textContent=error.message;ife('issueFormNotice').className='text-danger';}
}

window.addEventListener('wms-navigation',()=>{if(ife('pane-issue-forms')?.style.display!=='none')loadIssueForms();});
