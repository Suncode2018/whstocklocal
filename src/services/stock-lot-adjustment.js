const fail=message=>{throw Object.assign(Error(message),{status:400})};
function validate(body){
 const b=body||{},integer=n=>Number.isInteger(n)&&n>0&&n<=2147483647;
 if(!integer(b.productId)||!integer(b.whid)||typeof b.locationCode!=='string'||!b.locationCode.trim()||b.locationCode.length>50)fail('ระบุสินค้า คลัง และโลเคชั่นให้ถูกต้อง');
 if(!Number.isInteger(b.throughTransId)||b.throughTransId<0||!Number.isInteger(b.version)||b.version<0)fail('กรุณาโหลดข้อมูลล่าสุด');
 if(typeof b.reason!=='string'||!b.reason.trim()||b.reason.length>500)fail('ระบุเหตุผลไม่เกิน 500 ตัวอักษร');
 if(!Array.isArray(b.rows)||!b.rows.length||b.rows.length>100)fail('ระบุรายการ ANA / LOT 1–100 รายการ');
 const rows=b.rows.map(r=>{
  if(!r||['AnaNo','LotNo'].some(k=>r[k]!=null&&(typeof r[k]!=='string'||r[k].length>100)))fail('ANA / LOT ต้องไม่เกิน 100 ตัวอักษร');
  if(r.PackVersionId!=null&&r.PackVersionId!==''&&(!Number.isInteger(Number(r.PackVersionId))||Number(r.PackVersionId)<=0||Number(r.PackVersionId)>2147483647))fail('Version บรรจุไม่ถูกต้อง');
  if(!['number','string'].includes(typeof r.Quantity)||!/^\d{1,12}(?:\.\d{1,2})?$/.test(String(r.Quantity))||Number(r.Quantity)<=0)fail('จำนวนต้องมากกว่า 0 และทศนิยมไม่เกิน 2 ตำแหน่ง');
  return {AnaNo:r.AnaNo?.trim()||null,LotNo:r.LotNo?.trim()||null,PackVersionId:r.PackVersionId==null||r.PackVersionId===''?null:Number(r.PackVersionId),Quantity:Number(r.Quantity)};
 });
 if(new Set(rows.map(r=>JSON.stringify([r.AnaNo,r.LotNo]))).size!==rows.length)fail('มี ANA / LOT ซ้ำ กรุณารวมเป็นรายการเดียว');
 const cents=rows.reduce((n,r)=>n+Math.round(r.Quantity*100),0);if(!Number.isSafeInteger(cents))fail('จำนวนรวมเกินช่วงที่รองรับ');
 return {...b,locationCode:b.locationCode.trim(),reason:b.reason.trim(),rows,cents};
}
module.exports={validate};
