const router=require('express').Router();
const {sql,poolPromise}=require('../config/db');
const scope=require('../middleware/product-scope');
function allowed(req,code,action='VIEW'){
 if(req.navigation?.user.Role==='ADMIN')return true;
 const category=require('../config/navigation').catalog.find(x=>x.scopeParent==='PRODUCTS'&&x.categoryCode===code);
 return !!category&&scope.can(req,category.categoryId,action);
}
router.get('/',async(req,res)=>{try{
 const pool=await poolPromise;
 const rows=(await pool.request().query(`SELECT p.ProductId AS EntryId,p.ProductId,p.ProductId AS SourceRow,c.CategoryCode,p.ProID1 AS Code1,p.ProID2 AS Code2,p.ProID3 AS Code3,p.ProID4 AS Code4,p.ProductCode AS MainCode,p.ProductName1 AS Name1,p.ProductName2 AS Name2,p.ProductName AS DisplayName,p.PhysicalForm,p.MasterStatus,p.UnitId,CONVERT(varchar(18),CONVERT(varbinary(8),p.RowVersion),1) AS Revision,p.ProductCode AS StockProductCode
 FROM dbo.tblProducts p JOIN dbo.tblCategories c ON c.CategoryId=p.CategoryId`)).recordset.filter(x=>allowed(req,x.CategoryCode));
 rows.sort((a,b)=>a.SourceRow-b.SourceRow);
 res.json({success:true,data:rows.map(x=>({...x,CanEdit:allowed(req,x.CategoryCode,'EDIT')}))});
 }catch(e){res.status(500).json({success:false,message:'โหลด Master ไม่สำเร็จ กรุณาตรวจการติดตั้ง ProductSourceMaster.sql'})}});
router.put('/:id',async(req,res)=>{let tx;try{
 const id=Number(req.params.id),b=req.body||{};
 if(!Number.isInteger(id)||id<=0||id>2147483647||!/^0x[0-9A-Fa-f]{16}$/.test(b.revision||'')||!['name1','name2','displayName'].every(k=>typeof b[k]==='string'&&b[k].length<=2000)||!b.displayName.trim())return res.status(400).json({success:false,message:'กรอกชื่อแสดงผลให้ครบถ้วน (ไม่เกิน 2,000 ตัวอักษร)'});
 tx=new sql.Transaction(await poolPromise);await tx.begin();const q=()=>new sql.Request(tx);
 const row=(await q().input('I',sql.Int,id).query('SELECT p.*,c.CategoryCode,CONVERT(varchar(18),CONVERT(varbinary(8),p.RowVersion),1) AS Revision FROM dbo.tblProducts p WITH(UPDLOCK,HOLDLOCK) JOIN dbo.tblCategories c ON c.CategoryId=p.CategoryId WHERE p.ProductId=@I')).recordset[0];
 if(!row||!allowed(req,row.CategoryCode,'EDIT')){await tx.rollback();tx=null;return res.status(403).json({success:false,message:'ไม่มีสิทธิ์แก้ไขสินค้ากลุ่มนี้'})}
 if(row.Revision!==b.revision){await tx.rollback();tx=null;return res.status(409).json({success:false,message:'ข้อมูลถูกแก้ไขแล้ว กรุณารีเฟรชก่อนบันทึก'})}
 const code=b.productCode==null?row.ProductCode:String(b.productCode).trim()||null,unit=b.unitId===undefined?row.UnitId:b.unitId,status=b.masterStatus||row.MasterStatus;
 const fail=(status,message)=>{throw Object.assign(Error(message),{status})};
 if(!['DRAFT','READY','INACTIVE'].includes(status)||code!==null&&(code.length>50||!code.trim())||unit!==null&&(!Number.isInteger(unit)||unit<=0||unit>2147483647))fail(400,'รหัส หน่วยนับ หรือสถานะไม่ถูกต้อง');
 if(row.MasterStatus!=='DRAFT'&&(code!==row.ProductCode||unit!==row.UnitId))fail(409,'สินค้าที่เปิดใช้งานแล้วต้องรักษารหัสและหน่วยสต๊อกเดิม');
 if(row.MasterStatus!=='DRAFT'&&status==='DRAFT')fail(409,'สินค้าที่ใช้งานแล้วเปลี่ยนกลับเป็นร่างไม่ได้');
 if(status==='READY'&&(!code||!unit))fail(400,'ต้องกำหนดรหัสหลักและหน่วยสต๊อกก่อนเปิดใช้งาน');
 if(unit!==null&&!(await q().input('U',sql.Int,unit).query('SELECT UnitId FROM dbo.tblUnits WHERE UnitId=@U')).recordset.length)fail(400,'ไม่พบหน่วยนับ');
 if(code&&(await q().input('C',sql.NVarChar(50),code).input('I',sql.Int,id).query('SELECT ProductId FROM dbo.tblProducts WITH(UPDLOCK,HOLDLOCK) WHERE ProductCode=@C AND ProductId<>@I')).recordset.length)fail(409,'รหัสหลักซ้ำกับสินค้าอื่น กรุณาใช้รหัสที่ไม่ซ้ำ');
 const request=q().input('I',sql.Int,id).input('A',sql.NVarChar(2000),b.name1.trim()).input('B',sql.NVarChar(2000),b.name2.trim()).input('D',sql.NVarChar(2000),b.displayName.trim()).input('C',sql.NVarChar(50),code).input('U',sql.Int,unit).input('S',sql.VarChar(20),status);
 for(let i=1;i<=4;i++){const value=b['code'+i]===undefined?row['ProID'+i]:b['code'+i];if(value!==null&&(typeof value!=='string'||value.length>500))fail(400,'รหัสอ้างอิงยาวเกิน 500 ตัวอักษร');request.input('P'+i,sql.NVarChar(500),value||null)}
 const form=b.physicalForm===undefined?row.PhysicalForm:b.physicalForm;if(form!==null&&(typeof form!=='string'||form.length>50))fail(400,'ลักษณะสินค้าไม่ถูกต้อง');request.input('F',sql.NVarChar(50),form||null);
 const updated=(await request.query(`UPDATE dbo.tblProducts SET ProductName1=@A,ProductName2=@B,ProductName=@D,ProductCode=@C,UnitId=@U,MasterStatus=@S,IsActive=CASE WHEN @S='READY' THEN 1 ELSE 0 END,ProID1=@P1,ProID2=@P2,ProID3=@P3,ProID4=@P4,PhysicalForm=@F,UpdatedAt=SYSUTCDATETIME() OUTPUT CONVERT(varchar(18),CONVERT(varbinary(8),inserted.RowVersion),1) AS Revision WHERE ProductId=@I`)).recordset[0];
 await tx.commit();tx=null;res.json({success:true,revision:updated.Revision});
 }catch(e){if(tx)try{await tx.rollback()}catch{}res.status(e.status||500).json({success:false,message:e.status?e.message:'บันทึกข้อมูลสินค้าไม่สำเร็จ'})}});
module.exports=router;
