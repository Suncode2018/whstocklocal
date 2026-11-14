function bad(message){throw Object.assign(Error(message),{status:400});}
function date(value){if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value)||!Number.isFinite(Date.parse(value))||new Date(value).toISOString().slice(0,10)!==value)bad('วันที่ไม่ถูกต้อง');return value;}
function decimal(value,optional=false){if(optional&&(value==null||value===''))return null;if(!/^\d{1,9}(?:\.\d{1,3})?$/.test(String(value))||Number(value)<=0)bad('ขนาดและน้ำหนักต้องมากกว่า 0 ทศนิยมไม่เกิน 3 ตำแหน่ง');return String(value);}
function validate(b){
 const code=typeof b.configurationCode==='string'?b.configurationCode.trim().toUpperCase():'';
 if(!/^[A-Z0-9_-]{1,30}$/.test(code))bad('รหัสรูปแบบใช้ A-Z, 0-9, _ หรือ - ไม่เกิน 30 ตัวอักษร');
 if(!Number.isInteger(b.packVersionId)||b.packVersionId<=0||b.packVersionId>2147483647)bad('เลือกรุ่นอัตราบรรจุ');
 if(!['PACK','OUTER'].includes(b.handlingLevel))bad('เลือกหน่วยที่จัดเรียง');
 const ti=Number(b.ti),hi=Number(b.hi);
 if(!Number.isInteger(ti)||ti<1||ti>10000||!Number.isInteger(hi)||hi<1||hi>1000)bad('Ti ต้องเป็นจำนวนเต็ม 1–10000 และ Hi 1–1000');
 if(b.note!=null&&(typeof b.note!=='string'||b.note.length>500))bad('หมายเหตุไม่เกิน 500 ตัวอักษร');
 const result={configurationCode:code,effectiveFrom:date(b.effectiveFrom),packVersionId:b.packVersionId,handlingLevel:b.handlingLevel,ti,hi,note:b.note?.trim()||null};
 for(const field of ['caseWidthCm','caseLengthCm','caseHeightCm','palletWidthCm','palletLengthCm'])result[field]=decimal(b[field]);
 for(const field of ['caseGrossWeightKg','palletHeightCm'])result[field]=decimal(b[field],true);
 return result;
}
function current(rows,asOf){const seen=new Set();return rows.filter(r=>{if(!r.IsActive||String(r.EffectiveFrom instanceof Date?r.EffectiveFrom.toISOString():r.EffectiveFrom).slice(0,10)>asOf||seen.has(r.ConfigurationCode))return false;seen.add(r.ConfigurationCode);return true;});}
module.exports={date,validate,current};
