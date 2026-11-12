const productScope=require('../middleware/product-scope');
const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');

// 1. ดึงโมดูลเชื่อมต่อฐานข้อมูล
const {sql,poolPromise}=require('../config/db');
const JWT_SECRET = process.env.JWT_SECRET || 'super_secret_local_warehouse_jwt_key_2026';

// 2. Middleware ตรวจสอบสิทธิ์
function authenticate(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) return res.status(401).json({ success: false, message: 'กรุณาเข้าสู่ระบบ' });

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return res.status(403).json({ success: false, isExpired: true, message: 'เซสชันหมดอายุ' });
    req.user = user;
    next();
  });
}

function requireAdmin(req, res, next) {
  if (req.user?.role !== 'ADMIN') {
    return res.status(403).json({ success: false, message: 'เฉพาะผู้ดูแลระบบ (ADMIN) เท่านั้น' });
  }
  next();
}

function requireAdminOrPowerUser(req, res, next) {
  if (!['ADMIN','USER'].includes(req.user?.role)) {
    return res.status(403).json({ success: false, message: 'เฉพาะ ADMIN หรือ USER เท่านั้น' });
  }
  next();
}

router.use('/source-master', require('./product-source-master'));

// 3. GET /api/products/summary (ยอด KPI Dashboard)
router.get('/summary', authenticate, async (req, res) => {
  try {
    const pool = await poolPromise;
    const rows=productScope.filter(req,(await pool.request().query('SELECT CategoryId,IsActive FROM dbo.tblProducts')).recordset);const count=id=>rows.filter(p=>p.CategoryId===id).length;res.json({success:true,data:{TotalCount:rows.length,TotalRM:count(1),TotalPKG:count(2),TotalFG:count(3),TotalSEMI:count(4),TotalBULK:count(require('../config/navigation').catalog.find(m=>m.scopeParent==='PRODUCTS'&&m.categoryCode==='BULK')?.categoryId),TotalActive:rows.filter(p=>p.IsActive).length,TotalInactive:rows.filter(p=>!p.IsActive).length}});
  } catch (err) {
    res.status(500).json({ success: false, message: 'โหลด KPI ไม่สำเร็จ: ' + err.message });
  }
});

// 4. GET /api/products/lookup/:code (สแกนบาร์โค้ด Handheld)
router.get('/lookup/:code', authenticate, async (req, res) => {
  try {
    const pool = await poolPromise;
    const code = (req.params.code || '').trim();
    const result = await pool.request()
      .input('code', sql.NVarChar(50), code)
      .query(`
        SELECT TOP 1
          p.ProductId, p.ProductCode, p.ProductName, p.ThaiName,
          p.Barcode, p.CategoryId, p.Specification, p.PackageType AS UOM,
          p.UnitWidthCm, p.UnitLengthCm, p.UnitHeightCm, p.UnitVolumeCm3,
          p.StandardCost, p.IsActive
        FROM dbo.tblProducts p
        WHERE (p.Barcode = @code OR p.ProductCode = @code) AND p.IsActive = 1
      `);

    if (result.recordset.length === 0) {
      return res.status(404).json({ success: false, message: `ไม่พบสินค้า "${code}"` });
    }
    if(!productScope.can(req,result.recordset[0]?.CategoryId))return res.status(403).json({success:false,message:'ไม่มีสิทธิ์ดูสินค้ากลุ่มนี้'});res.json({ success: true, data: result.recordset[0] });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// 5. GET /api/products (ดึงรายการสินค้า รวมทั้งชื่อภาษาไทย)
// Supplier choices follow product-edit rights; do not expose supplier contact/tax data.
router.get('/supplier-options',authenticate,async(req,res)=>{try{const category=Number(req.query.categoryId),productId=req.query.productId==null?null:Number(req.query.productId);if(!Number.isInteger(category)||!productScope.can(req,category,'EDIT'))return res.status(403).json({success:false,message:'ไม่มีสิทธิ์บันทึกสินค้ากลุ่มนี้'});const p=await poolPromise;let current=null;if(productId!=null){if(!Number.isInteger(productId)||productId<=0||productId>2147483647)return res.status(400).json({success:false,message:'รหัสสินค้าไม่ถูกต้อง'});const row=(await p.request().input('Id',sql.Int,productId).query('SELECT CategoryId,SupplierId FROM dbo.tblProducts WHERE ProductId=@Id')).recordset[0];if(!row||row.CategoryId!==category)return res.status(403).json({success:false,message:'ไม่พบสินค้าที่แก้ไขได้ในกลุ่มนี้'});current=row.SupplierId}const c=require('../config/navigation').catalog.find(c=>c.scopeParent==='PRODUCTS'&&c.categoryId===category)?.categoryCode;if(!c)return res.status(400).json({success:false,message:'ไม่พบกลุ่มสินค้า'});const rows=(await p.request().query('SELECT SupplierId,SupplierCode,SupplierName,SupplyTypes,IsActive FROM dbo.tblSuppliers ORDER BY SupplierCode')).recordset.filter(x=>x.SupplierId===current||x.IsActive&&String(x.SupplyTypes).split(',').map(t=>t.trim().toUpperCase()).includes(c)).map(x=>({SupplierId:x.SupplierId,SupplierCode:x.SupplierCode,SupplierName:x.SupplierName,CanSelect:!!x.IsActive&&String(x.SupplyTypes).split(',').map(t=>t.trim().toUpperCase()).includes(c)}));res.json({success:true,data:rows})}catch(e){res.status(500).json({success:false,message:'โหลดผู้จำหน่ายไม่สำเร็จ กรุณาตรวจ ProductSupplier.sql'})}});
async function selectedProductSupplier(q,value,category,current){if(value==null||value==='')return null;if(!Number.isInteger(value)||value<=0||value>2147483647)throw Object.assign(Error('ผู้จำหน่ายไม่ถูกต้อง'),{status:400});const row=(await q().input('Supplier',sql.Int,value).query('SELECT SupplierId,SupplierCode,SupplyTypes,IsActive FROM dbo.tblSuppliers WITH(HOLDLOCK) WHERE SupplierId=@Supplier')).recordset[0];const code=require('../config/navigation').catalog.find(c=>c.scopeParent==='PRODUCTS'&&c.categoryId===category)?.categoryCode;if(!row||(value!==current&&(!row.IsActive||!String(row.SupplyTypes).split(',').map(t=>t.trim().toUpperCase()).includes(code))))throw Object.assign(Error('ผู้จำหน่ายปิดใช้งานหรือไม่รองรับกลุ่มสินค้านี้'),{status:400});return row}

router.get('/:id/pack-versions',authenticate,async(req,res)=>{try{const id=Number(req.params.id);if(!Number.isInteger(id)||id<=0||id>2147483647)return res.status(400).json({success:false,message:'รหัสสินค้าไม่ถูกต้อง'});const date=req.query.date||new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Bangkok'}).format(new Date());if(typeof date!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(Date.parse(date))||new Date(date).toISOString().slice(0,10)!==date)return res.status(400).json({success:false,message:'วันที่อ้างอิงไม่ถูกต้อง'});const p=await poolPromise,product=(await p.request().input('I',sql.Int,id).query('SELECT p.ProductId,p.ProductCode,p.ProductName,p.CategoryId,p.UnitId,u.UnitCode,u.UnitName FROM dbo.tblProducts p JOIN dbo.tblUnits u ON u.UnitId=p.UnitId WHERE ProductId=@I')).recordset[0];if(!product)return res.status(404).json({success:false,message:'ไม่พบสินค้า'});if(!productScope.can(req,product.CategoryId,'VIEW'))return res.status(403).json({success:false,message:'ไม่มีสิทธิ์ดูกลุ่มสินค้านี้'});const rows=(await p.request().input('I',sql.Int,id).query('SELECT v.*,u.UnitCode FROM dbo.tblProductPackVersions v JOIN dbo.tblUnits u ON u.UnitId=v.StockUnitId WHERE ProductId=@I ORDER BY EffectiveFrom DESC,VersionNo DESC')).recordset;res.set('Cache-Control','no-store');res.json({success:true,product,asOf:date,data:rows,current:rows.find(v=>v.IsActive&&String(v.EffectiveFrom.toISOString()).slice(0,10)<=date)||null})}catch(e){res.status(500).json({success:false,message:'โหลดรุ่นอัตราบรรจุไม่สำเร็จ กรุณาติดตั้ง ProductPackVersions.sql'})}});
router.post('/:id/pack-versions',authenticate,requireAdmin,async(req,res)=>{let tx;try{const id=Number(req.params.id),b=req.body||{},fail=(status,message)=>{throw Object.assign(Error(message),{status})};if(!Number.isInteger(id)||id<=0||id>2147483647)fail(400,'รหัสสินค้าไม่ถูกต้อง');if(typeof b.effectiveFrom!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(b.effectiveFrom)||!Number.isFinite(Date.parse(b.effectiveFrom))||new Date(b.effectiveFrom).toISOString().slice(0,10)!==b.effectiveFrom||typeof b.packUnit!=='string'||!b.packUnit.trim()||b.packUnit.length>30||!/^\d{1,12}(?:\.\d{1,6})?$/.test(String(b.unitsPerPack))||Number(b.unitsPerPack)<=0||b.note!=null&&(typeof b.note!=='string'||b.note.length>255))fail(400,'กรอกวันเริ่มใช้ หน่วยกล่อง และจำนวนบรรจุให้ถูกต้อง');if(b.netWeightGramsPerUnit!=null&&b.netWeightGramsPerUnit!==''&&(!/^\d{1,12}(?:\.\d{1,6})?$/.test(String(b.netWeightGramsPerUnit))||Number(b.netWeightGramsPerUnit)<=0))fail(400,'น้ำหนักสุทธิต่อหน่วยต้องมากกว่า 0');if(b.stockUnitLabel!=null&&(typeof b.stockUnitLabel!=='string'||!b.stockUnitLabel.trim()||b.stockUnitLabel.trim().length>30))fail(400,'ระบุชื่อหน่วยนับไม่เกิน 30 ตัวอักษร');if(b.netVolumeMlPerUnit!=null&&b.netVolumeMlPerUnit!==''&&(!/^\d{1,12}(?:\.\d{1,6})?$/.test(String(b.netVolumeMlPerUnit))||Number(b.netVolumeMlPerUnit)<=0))fail(400,'ปริมาตรสุทธิต่อหน่วยต้องมากกว่า 0 ทศนิยมไม่เกิน 6 ตำแหน่ง');if(b.outerPackUnit||b.packsPerOuter!=null){if(typeof b.outerPackUnit!=='string'||!b.outerPackUnit.trim()||b.outerPackUnit.length>30||b.outerPackUnit.trim()===b.packUnit.trim()||!/^\d{1,6}$/.test(String(b.packsPerOuter))||Number(b.packsPerOuter)<2||Number(b.packsPerOuter)>999999||!Number.isSafeInteger(Number(b.unitsPerPack))||Number(b.unitsPerPack)*Number(b.packsPerOuter)>999999999999)fail(400,'ระดับลัง: ระบุชื่อหน่วยต่างจากกล่อง และจำนวนเต็ม 2–999999 กล่องต่อลัง');}tx=new sql.Transaction(await poolPromise);await tx.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);const q=()=>new sql.Request(tx),product=(await q().input('I',sql.Int,id).query('SELECT p.UnitId,u.UnitCode FROM dbo.tblProducts p WITH(UPDLOCK,HOLDLOCK) JOIN dbo.tblUnits u ON u.UnitId=p.UnitId WHERE ProductId=@I')).recordset[0];if(!product)fail(404,'ไม่พบสินค้า');if(product.UnitCode==='PCS'&&!Number.isInteger(Number(b.unitsPerPack)))fail(400,'สินค้าหน่วย PCS ต้องบรรจุเป็นจำนวนเต็ม');if((await q().input('I',sql.Int,id).input('D',sql.Date,b.effectiveFrom).query('SELECT PackVersionId FROM dbo.tblProductPackVersions WITH(UPDLOCK,HOLDLOCK) WHERE ProductId=@I AND EffectiveFrom=@D')).recordset.length)fail(409,'มีรุ่นเริ่มใช้ในวันที่นี้แล้ว กรุณาเลือกวันอื่น');const row=(await q().input('I',sql.Int,id).input('D',sql.Date,b.effectiveFrom).input('Pack',sql.NVarChar(30),b.packUnit.trim()).input('Qty',sql.Decimal(18,6),b.unitsPerPack).input('U',sql.Int,product.UnitId).input('Weight',sql.Decimal(18,6),b.netWeightGramsPerUnit==null||b.netWeightGramsPerUnit===''?null:b.netWeightGramsPerUnit).input('UnitLabel',sql.NVarChar(30),b.stockUnitLabel?.trim()||null).input('Volume',sql.Decimal(18,6),b.netVolumeMlPerUnit==null||b.netVolumeMlPerUnit===''?null:b.netVolumeMlPerUnit).input('Outer',sql.NVarChar(30),b.outerPackUnit?.trim()||null).input('Packs',sql.Int,b.outerPackUnit?Number(b.packsPerOuter):null).input('Note',sql.NVarChar(255),b.note?.trim()||null).input('By',sql.NVarChar(100),String(req.user.username||req.user.id).slice(0,100)).query('INSERT dbo.tblProductPackVersions(ProductId,VersionNo,EffectiveFrom,PackUnit,UnitsPerPack,StockUnitId,NetWeightGramsPerUnit,StockUnitLabel,NetVolumeMlPerUnit,OuterPackUnit,PacksPerOuter,Note,CreatedBy) OUTPUT inserted.PackVersionId SELECT @I,COALESCE(MAX(VersionNo),0)+1,@D,@Pack,@Qty,@U,@Weight,@UnitLabel,@Volume,@Outer,@Packs,@Note,@By FROM dbo.tblProductPackVersions WHERE ProductId=@I')).recordset[0];await tx.commit();res.status(201).json({success:true,PackVersionId:row.PackVersionId})}catch(e){if(tx)try{await tx.rollback()}catch{}res.status(e.status||500).json({success:false,message:e.status?e.message:'บันทึกรุ่นอัตราบรรจุไม่สำเร็จ'})}});
router.get('/:id/rm-spec',authenticate,requireAdmin,async(req,res)=>{try{const id=Number(req.params.id);if(!Number.isInteger(id)||id<=0||id>2147483647)return res.status(400).json({success:false,message:'รหัสสินค้าไม่ถูกต้อง'});const p=await poolPromise,row=(await p.request().input('P',sql.Int,id).query('SELECT * FROM dbo.tblRMPackSpecs WHERE ProductId=@P')).recordset[0];res.json({success:true,data:row||null})}catch(e){res.status(500).json({success:false,message:'โหลดหน่วยบรรจุไม่สำเร็จ'})}});
router.get('/', authenticate, async (req, res) => {
  try {
    const pool = await poolPromise;
    const search = req.query.search ? req.query.search.trim() : '';

    let whereClause = 'WHERE 1=1';
    const request = pool.request();

    if (search) {
      whereClause += ` AND (p.ProductCode LIKE @search OR p.ProductName LIKE @search OR p.ThaiName LIKE @search OR p.Barcode LIKE @search OR p.ProductName1 LIKE @search OR p.ProductName2 LIKE @search OR p.ProID1 LIKE @search OR p.ProID2 LIKE @search OR p.ProID3 LIKE @search OR p.ProID4 LIKE @search)`;
      request.input('search', sql.NVarChar, `%${search}%`);
    }

    const queryStr = `
      SELECT 
        p.ProductId,
        p.ProductCode,
        p.ProductCode AS ItemCode,
        p.ProductName,
        p.ProductName AS ItemName,
        p.ThaiName,p.ProductName1,p.ProductName2,p.ProID1,p.ProID2,p.ProID3,p.ProID4,p.PhysicalForm,p.MasterStatus,CONVERT(varchar(18),CONVERT(varbinary(8),p.RowVersion),1) AS Revision,
        p.Barcode,
        p.PackageType,
        p.UnitId,
        p.UnitVolumeCm3,
        p.SupplierId,
        p.SupplierCode,
        p.CategoryId,
        p.IsActive,
        p.CreatedAt
      FROM dbo.tblProducts p
      ${whereClause}
      ORDER BY p.ProductId DESC
    `;

    const result = await request.query(queryStr);
    const scoped=productScope.filter(req,result.recordset);
    res.json(scoped.map(x=>({...x,SourceMaster:{Name1:x.ProductName1,Name2:x.ProductName2,Code1:x.ProID1,Code2:x.ProID2,Code3:x.ProID3,Code4:x.ProID4}})));
  } catch (err) {
    res.status(500).json({ success: false, message: 'โหลดข้อมูลสินค้าไม่สำเร็จ: ' + err.message });
  }
});

// 6. POST /api/products (เพิ่มสินค้าใหม่)
router.post('/',authenticate,requireAdminOrPowerUser,async(req,res)=>{let tx;try{const b=req.body||{},categoryId=Number(b.categoryId||1),fail=(status,message)=>{throw Object.assign(Error(message),{status})};if(!require('../config/navigation').catalog.some(m=>m.scopeParent==='PRODUCTS'&&m.categoryId===categoryId)||!productScope.can(req,categoryId,'EDIT'))fail(403,'ไม่มีสิทธิ์บันทึกสินค้ากลุ่มนี้');const productCode=b.productCode||b.itemCode||'',productName=b.productName||b.itemName||'',thaiName=b.thaiName||'',barcode=b.barcode||'';if([productCode,productName,thaiName,barcode].some(v=>typeof v!=='string')||!productCode.trim()||!productName.trim()||productCode.length>50||productName.length>2000||thaiName.length>255||barcode.length>50)fail(400,'กรอกรหัส ชื่อสินค้า และบาร์โค้ดให้ถูกต้อง');if(!Number.isInteger(b.unitId)||b.unitId<=0||b.unitId>2147483647)fail(400,'กรุณาเลือกหน่วยนับจาก Master');tx=new sql.Transaction(await poolPromise);await tx.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);const q=()=>new sql.Request(tx);if(!(await q().input('Unit',sql.Int,b.unitId).query('SELECT UnitId FROM dbo.tblUnits WITH(HOLDLOCK) WHERE UnitId=@Unit')).recordset.length)fail(400,'ไม่พบหน่วยนับที่เลือก');const supplier=await selectedProductSupplier(q,b.supplierId,categoryId,null);if((await q().input('Code',sql.NVarChar(50),productCode.trim()).query('SELECT ProductId FROM dbo.tblProducts WITH(UPDLOCK,HOLDLOCK) WHERE ProductCode=@Code')).recordset.length)fail(400,'รหัสสินค้ามีอยู่ในระบบแล้ว');await q().input('Code',sql.NVarChar(50),productCode.trim()).input('Name',sql.NVarChar(2000),productName.trim()).input('Thai',sql.NVarChar(255),thaiName.trim()||null).input('Barcode',sql.NVarChar(50),barcode.trim()||null).input('Category',sql.Int,categoryId).input('Unit',sql.Int,b.unitId).input('Supplier',sql.Int,supplier?.SupplierId||null).input('SupplierCode',sql.NVarChar(50),supplier?.SupplierCode||null).query('INSERT INTO dbo.tblProducts(ProductCode,ProductName,ThaiName,Barcode,CategoryId,UnitId,SupplierId,SupplierCode,MinStock,MaxStock,StandardCost,IsActive,CreatedAt,UpdatedAt) VALUES(@Code,@Name,@Thai,@Barcode,@Category,@Unit,@Supplier,@SupplierCode,0,0,0,1,GETDATE(),GETDATE())');const created=(await q().input('Code',sql.NVarChar(50),productCode.trim()).query('SELECT ProductId FROM dbo.tblProducts WHERE ProductCode=@Code')).recordset[0];await require('../services/product-master-fields')(q,created.ProductId,b);await require('../services/product-volume')(q,created.ProductId,b.unitVolumeCm3);await require('../services/product-rm-spec').save(q,req,created.ProductId,categoryId,b.unitId,b.rmPackSpec);await tx.commit();res.json({success:true,message:'เพิ่มสินค้าเรียบร้อย'})}catch(e){if(tx)try{await tx.rollback()}catch{}res.status(e.status||500).json({success:false,message:e.status?e.message:'บันทึกสินค้าไม่สำเร็จ กรุณาตรวจ ProductSupplier.sql'})}});

// 7. PUT /api/products/:id (แก้ไขสินค้า)
router.put('/:id', authenticate, requireAdminOrPowerUser, async (req,res)=>{
 let tx;try{
 const id=Number(req.params.id),b=req.body||{},fail=(status,message)=>{throw Object.assign(Error(message),{status})};
 if(!Number.isInteger(id)||id<=0||id>2147483647)fail(400,'รหัสสินค้าไม่ถูกต้อง');
 const productName=b.productName??b.itemName??'',thaiName=b.thaiName??'',barcode=b.barcode??'';
 if(typeof productName!=='string'||!productName.trim()||productName.length>2000||typeof thaiName!=='string'||thaiName.length>255||typeof barcode!=='string'||barcode.length>50)fail(400,'ตรวจชื่อสินค้า ชื่อภาษาไทย และบาร์โค้ด');
 tx=new sql.Transaction(await poolPromise);await tx.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);const q=()=>new sql.Request(tx);
 const old=(await q().input('Id',sql.Int,id).query('SELECT ProductCode,MasterStatus,CategoryId,UnitId,SupplierId,SupplierCode,CONVERT(varchar(18),CONVERT(varbinary(8),RowVersion),1) Revision FROM dbo.tblProducts WITH(UPDLOCK,HOLDLOCK) WHERE ProductId=@Id')).recordset[0];
 if(!old)fail(404,'ไม่พบสินค้า');if(!productScope.can(req,old.CategoryId,'EDIT'))fail(403,'ไม่มีสิทธิ์บันทึกสินค้ากลุ่มนี้');
 if(b.masterRevision!==undefined&&b.masterRevision!==old.Revision)fail(409,'ข้อมูลถูกแก้ไขแล้ว กรุณารีเฟรชก่อนบันทึก');
 const status=b.masterStatus??old.MasterStatus,unitId=b.unitId===undefined?old.UnitId:b.unitId;
 if(!['DRAFT','READY','INACTIVE'].includes(status)||old.MasterStatus!=='DRAFT'&&status==='DRAFT')fail(400,'สถานะสินค้าไม่ถูกต้อง');
 if(b.productCode!==undefined&&b.productCode!==null&&typeof b.productCode!=='string')fail(400,'รหัสสินค้าต้องเป็นข้อความ');
 const code=b.productCode===undefined?old.ProductCode:b.productCode?.trim()||null;
 if(code!==null&&code.length>50)fail(400,'รหัสสินค้ายาวเกิน 50 ตัวอักษร');
 if(old.MasterStatus!=='DRAFT'&&code!==old.ProductCode)fail(409,'สินค้าที่ใช้งานแล้วไม่สามารถเปลี่ยนรหัสหลักได้');
 if(unitId!==null&&(!Number.isInteger(unitId)||unitId<=0||unitId>2147483647))fail(400,'หน่วยนับไม่ถูกต้อง');
 if(status==='READY'&&(!code||!unitId))fail(400,'กำหนดรหัสสินค้าและหน่วยสต๊อกก่อนเปิดใช้งาน');
 if(unitId!==null&&!(await q().input('Unit',sql.Int,unitId).query('SELECT UnitId FROM dbo.tblUnits WHERE UnitId=@Unit')).recordset.length)fail(400,'ไม่พบหน่วยนับที่เลือก');
 if(code&&(await q().input('Code',sql.NVarChar(50),code).input('Id',sql.Int,id).query('SELECT ProductId FROM dbo.tblProducts WITH(UPDLOCK,HOLDLOCK) WHERE ProductCode=@Code AND ProductId<>@Id')).recordset.length)fail(409,'รหัสสินค้าซ้ำ กรุณาใช้รหัสหลักที่ไม่ซ้ำ');
 if(unitId!==old.UnitId){if((await q().input('P',sql.Int,id).query('SELECT TOP 1 PackVersionId FROM dbo.tblProductPackVersions WHERE ProductId=@P')).recordset.length)fail(409,'มีรุ่นอัตราบรรจุอ้างอิงหน่วยนี้แล้ว จึงเปลี่ยนหน่วยสต๊อกไม่ได้');const inUse=(await q().input('Id',sql.Int,id).query("SELECT CASE WHEN EXISTS(SELECT 1 FROM dbWMS.dbo.tblStock WITH(HOLDLOCK) WHERE ProductId=@Id AND Quantity<>0) OR EXISTS(SELECT 1 FROM dbo.tblRMPackSpecs WHERE ProductId=@Id) OR EXISTS(SELECT 1 FROM dbo.tblBOMHeaders WHERE FGProductId=@Id) OR EXISTS(SELECT 1 FROM dbo.tblBOMLines WHERE ComponentProductId=@Id) OR EXISTS(SELECT 1 FROM dbWMS.dbo.InboundLines l JOIN dbWMS.dbo.InboundOrders h ON h.InboundId=l.InboundId WHERE l.ProductId=@Id AND h.Status<>'CLOSED') OR EXISTS(SELECT 1 FROM dbWMS.dbo.DeliveryLines l JOIN dbWMS.dbo.DeliveryOrders h ON h.DeliveryId=l.DeliveryId WHERE l.ProductId=@Id AND h.Status='DRAFT') THEN 1 ELSE 0 END AS Used")).recordset[0];if(inUse.Used)fail(409,'สินค้ามีสต๊อก งานค้าง สูตร หรือหน่วยบรรจุ RM อ้างอิงอยู่ จึงเปลี่ยนหน่วยไม่ได้ แต่แก้ชื่อและบาร์โค้ดโดยใช้หน่วยเดิมได้')}
 const supplier=await selectedProductSupplier(q,b.supplierId===undefined?old.SupplierId:b.supplierId,old.CategoryId,old.SupplierId);
 await q().input('Id',sql.Int,id).input('Code',sql.NVarChar(50),code).input('State',sql.VarChar(20),status).input('Name',sql.NVarChar(2000),productName.trim()).input('Thai',sql.NVarChar(255),thaiName.trim()||null).input('Barcode',sql.NVarChar(50),barcode.trim()||null).input('Unit',sql.Int,unitId).input('SupplierId',sql.Int,supplier?.SupplierId||null).input('SupplierCode',sql.NVarChar(50),supplier?.SupplierCode||(b.supplierId===undefined&&old.SupplierId==null?old.SupplierCode:null)).query("UPDATE dbo.tblProducts SET ProductCode=@Code,MasterStatus=@State,IsActive=CASE WHEN @State='READY' THEN 1 ELSE 0 END,ProductName=@Name,ThaiName=@Thai,Barcode=@Barcode,UnitId=@Unit,SupplierId=@SupplierId,SupplierCode=@SupplierCode,UpdatedAt=SYSUTCDATETIME() WHERE ProductId=@Id");
 await require('../services/product-master-fields')(q,id,b);await require('../services/product-volume')(q,id,b.unitVolumeCm3);await require('../services/product-rm-spec').save(q,req,id,old.CategoryId,unitId,b.rmPackSpec);
 await tx.commit();tx=null;res.json({success:true,message:'แก้ไขข้อมูลสินค้าสำเร็จ'});
 }catch(e){if(tx)try{await tx.rollback()}catch{}res.status(e.status||500).json({success:false,message:e.status?e.message:'บันทึกข้อมูลสินค้าไม่สำเร็จ'})}
});

// 8. DELETE /api/products/:id (ลบสินค้า)
router.delete('/:id', authenticate, requireAdmin, async (req, res) => {
  const prodId = parseInt(req.params.id, 10);
  if (isNaN(prodId)) return res.status(400).json({ success: false, message: 'รหัสสินค้าไม่ถูกต้อง' });

  try {
    const pool = await poolPromise;
    await pool.request()
      .input('ProductId', sql.Int, prodId)
      .query("UPDATE dbo.tblProducts SET IsActive = 0, MasterStatus='INACTIVE', UpdatedAt = GETDATE() WHERE ProductId = @ProductId");

    res.json({ success: true, message: 'ลบสินค้าเรียบร้อย' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;