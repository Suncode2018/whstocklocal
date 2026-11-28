'use strict';

function normalizeTemplate(body={}){
 const FormCode=typeof body.formCode==='string'?body.formCode.trim().toUpperCase():'';
 const FormRevision=typeof body.formRevision==='string'?body.formRevision.trim():'';
 const EffectiveDate=typeof body.effectiveDate==='string'?body.effectiveDate.trim():'';
 const CompanyName=typeof body.companyName==='string'?body.companyName.trim():'';
 const DocumentTitle=typeof body.documentTitle==='string'?body.documentTitle.trim():'';
 if(!/^[A-Z0-9][A-Z0-9-]{1,29}$/.test(FormCode))throw Object.assign(Error('รหัสฟอร์มใช้ A-Z, 0-9 และ - ความยาว 2-30 ตัว'),{status:400});
 if(!/^Rev\.\d{2,3}$/.test(FormRevision))throw Object.assign(Error('Revision ต้องอยู่ในรูปแบบ Rev.00 หรือ Rev.001'),{status:400});
 const parsedDate=/^\d{4}-\d{2}-\d{2}$/.test(EffectiveDate)?new Date(`${EffectiveDate}T00:00:00Z`):null;
 if(!parsedDate||Number.isNaN(parsedDate.getTime())||parsedDate.toISOString().slice(0,10)!==EffectiveDate)throw Object.assign(Error('กรุณาระบุวันที่มีผลให้ถูกต้อง'),{status:400});
 if(!CompanyName||CompanyName.length>200)throw Object.assign(Error('กรุณาระบุชื่อบริษัทไม่เกิน 200 ตัวอักษร'),{status:400});
 if(!DocumentTitle||DocumentTitle.length>200)throw Object.assign(Error('กรุณาระบุชื่อเอกสารไม่เกิน 200 ตัวอักษร'),{status:400});
 if(typeof body.isActive!=='boolean')throw Object.assign(Error('กรุณาระบุสถานะ Revision'),{status:400});
 return{FormCode,FormRevision,EffectiveDate,CompanyName,DocumentTitle,IsActive:body.isActive};
}

module.exports={normalizeTemplate};
