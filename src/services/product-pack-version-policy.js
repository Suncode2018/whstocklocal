'use strict';
const crypto=require('node:crypto');

const fail=(status,message)=>{throw Object.assign(Error(message),{status})};

exports.assertPackagingHierarchy=(unitCode,unitsPerPack,innerPackUnit,unitsPerInnerPack)=>{
 if(!innerPackUnit)return;
 const pack=Number(unitsPerPack),inner=Number(unitsPerInnerPack);
 if(String(unitCode||'').trim().toUpperCase()==='PCS'&&Number.isFinite(pack)&&Number.isFinite(inner)&&inner>0){
  if(!Number.isInteger(pack/inner))fail(400,'จำนวนหน่วยย่อยต่อบรรจุชั้นแรกต้องเป็นจำนวนเต็ม เช่น 1 กล่อง = 6 ซอง');
 }
};

exports.assertStockUnitLabel=(unitCode,label)=>{
 if(String(label||'').trim().toLocaleLowerCase('th-TH')!==String(unitCode||'').trim().toLocaleLowerCase('th-TH')){
  fail(400,'หน่วยฐานสต๊อกต้องตรงกับหน่วยสินค้า '+String(unitCode||''));
 }
};

exports.testPackagingVersion=(version,unitCode)=>{
 if(!version||!Number.isFinite(Number(version.UnitsPerPack))||Number(version.UnitsPerPack)<=0){
  fail(400,'รุ่นนี้ยังไม่มีอัตราบรรจุชั้นแรกที่ถูกต้อง');
 }
 exports.assertStockUnitLabel(unitCode,version.StockUnitLabel||unitCode);
 const inner=String(version.InnerPackUnit||'').trim(),innerQty=version.UnitsPerInnerPack;
 if(Boolean(inner)!==(innerQty!=null&&innerQty!==''))fail(400,'กรอกชื่อหน่วยย่อยและจำนวนให้ครบทั้งคู่ หรือเว้นว่างทั้งคู่');
 exports.assertPackagingHierarchy(unitCode,version.UnitsPerPack,inner,innerQty);
 const pack=String(version.PackUnit||'').trim();
 if(!pack)fail(400,'ระบุชื่อหน่วยบรรจุ');
 const examples=[{unit:unitCode,baseQuantity:1,expression:'1 '+unitCode+' = 1 '+unitCode}];
 if(inner)examples.push({unit:inner,baseQuantity:Number(innerQty),expression:'1 '+inner+' = '+Number(innerQty)+' '+unitCode});
 examples.push({unit:pack,baseQuantity:Number(version.UnitsPerPack),expression:'1 '+pack+' = '+Number(version.UnitsPerPack)+' '+unitCode});
 if(Boolean(version.OuterPackUnit)!==(version.PacksPerOuter!=null&&version.PacksPerOuter!==''))fail(400,'กรอกชื่อหน่วยชั้นนอกและจำนวนต่อหน่วยให้ครบทั้งคู่ หรือเว้นว่างทั้งคู่');
 if(version.OuterPackUnit){
  const n=Number(version.PacksPerOuter);
  if(!Number.isInteger(n)||n<2)fail(400,'จำนวนหน่วยชั้นแรกต่อชั้นนอกต้องเป็นจำนวนเต็มอย่างน้อย 2');
  examples.push({unit:version.OuterPackUnit,baseQuantity:n*Number(version.UnitsPerPack),expression:'1 '+version.OuterPackUnit+' = '+n+' '+pack+' = '+n*Number(version.UnitsPerPack)+' '+unitCode});
 }
 return {success:true,unitCode,examples};
};

exports.fingerprintPackagingVersion=(version,unitCode)=>{
 const source={unitCode:String(unitCode||'').trim(),stockUnitId:Number(version?.StockUnitId||0),stockUnitLabel:String(version?.StockUnitLabel||unitCode||'').trim(),innerPackUnit:String(version?.InnerPackUnit||'').trim(),unitsPerInnerPack:version?.UnitsPerInnerPack==null?null:Number(version.UnitsPerInnerPack),packUnit:String(version?.PackUnit||'').trim(),unitsPerPack:version?.UnitsPerPack==null?null:Number(version.UnitsPerPack),outerPackUnit:String(version?.OuterPackUnit||'').trim(),packsPerOuter:version?.PacksPerOuter==null?null:Number(version.PacksPerOuter)};
 return crypto.createHash('sha256').update(JSON.stringify(source),'utf8').digest('hex');
};

exports.assertPassedTest=(version,unitCode)=>{
 exports.testPackagingVersion(version,unitCode);
 const expected=exports.fingerprintPackagingVersion(version,unitCode);
 if(!version?.PackTestPassedAt||!version.PackTestFingerprint||version.PackTestFingerprint!==expected)fail(409,'ต้องทดสอบคำนวณ Version นี้ให้ผ่านอีกครั้งก่อนเปิดใช้งาน');
 return expected;
};

exports.calculateBaseQuantity=(quantity,inputUnit,version,unitCode)=>{
 const q=Number(quantity);if(!Number.isFinite(q)||q<=0)fail(400,'จำนวนที่กรอกต้องมากกว่า 0');
 const unit=String(inputUnit||'').trim(),base=String(unitCode||'').trim();let factor;
 if(unit.toLocaleLowerCase('th-TH')===base.toLocaleLowerCase('th-TH'))factor=1;
 else if(unit===String(version?.InnerPackUnit||'').trim())factor=Number(version.UnitsPerInnerPack);
 else if(unit===String(version?.PackUnit||'').trim())factor=Number(version.UnitsPerPack);
 else if(unit===String(version?.OuterPackUnit||'').trim())factor=Number(version.PacksPerOuter)*Number(version.UnitsPerPack);
 else fail(400,'หน่วยที่เลือกไม่มีอัตราใน Version นี้');
 if(!Number.isFinite(factor)||factor<=0)fail(400,'Version นี้ไม่มีอัตราแปลงหน่วยที่ถูกต้อง');
 const baseQuantity=q*factor;if(!Number.isFinite(baseQuantity)||baseQuantity>999999999999)fail(400,'ผลคำนวณเกินจำนวนที่ระบบรองรับ');
 return {inputQuantity:q,inputUnit:unit,unitsPerInput:factor,baseQuantity,calculation:'1 '+unit+' = '+factor+' '+base+'; '+q+' × '+factor+' = '+baseQuantity+' '+base};
};
