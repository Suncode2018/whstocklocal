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

// 3. GET /api/products/summary (ยอด KPI Dashboard)
router.get('/summary', authenticate, async (req, res) => {
  try {
    const pool = await poolPromise;
    const rows=productScope.filter(req,(await pool.request().query('SELECT CategoryId,IsActive FROM dbo.tblProducts')).recordset);const count=id=>rows.filter(p=>p.CategoryId===id).length;res.json({success:true,data:{TotalCount:rows.length,TotalRM:count(1),TotalPKG:count(2),TotalFG:count(3),TotalActive:rows.filter(p=>p.IsActive).length,TotalInactive:rows.filter(p=>!p.IsActive).length}});
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

router.get('/:id/rm-spec',authenticate,requireAdmin,async(req,res)=>{try{const id=Number(req.params.id);if(!Number.isInteger(id)||id<=0||id>2147483647)return res.status(400).json({success:false,message:'รหัสสินค้าไม่ถูกต้อง'});const p=await poolPromise,row=(await p.request().input('P',sql.Int,id).query('SELECT * FROM dbo.tblRMPackSpecs WHERE ProductId=@P')).recordset[0];res.json({success:true,data:row||null})}catch(e){res.status(500).json({success:false,message:'โหลดหน่วยบรรจุไม่สำเร็จ'})}});
router.get('/', authenticate, async (req, res) => {
  try {
    const pool = await poolPromise;
    const search = req.query.search ? req.query.search.trim() : '';

    let whereClause = 'WHERE 1=1';
    const request = pool.request();

    if (search) {
      whereClause += ` AND (p.ProductCode LIKE @search OR p.ProductName LIKE @search OR p.ThaiName LIKE @search OR p.Barcode LIKE @search)`;
      request.input('search', sql.NVarChar, `%${search}%`);
    }

    const queryStr = `
      SELECT 
        p.ProductId,
        p.ProductCode,
        p.ProductCode AS ItemCode,
        p.ProductName,
        p.ProductName AS ItemName,
        p.ThaiName,
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
    res.json(productScope.filter(req,result.recordset));
  } catch (err) {
    res.status(500).json({ success: false, message: 'โหลดข้อมูลสินค้าไม่สำเร็จ: ' + err.message });
  }
});

// 6. POST /api/products (เพิ่มสินค้าใหม่)
router.post('/',authenticate,requireAdminOrPowerUser,async(req,res)=>{let tx;try{const b=req.body||{},categoryId=Number(b.categoryId||1),fail=(status,message)=>{throw Object.assign(Error(message),{status})};if(!require('../config/navigation').catalog.some(m=>m.scopeParent==='PRODUCTS'&&m.categoryId===categoryId)||!productScope.can(req,categoryId,'EDIT'))fail(403,'ไม่มีสิทธิ์บันทึกสินค้ากลุ่มนี้');const productCode=b.productCode||b.itemCode||'',productName=b.productName||b.itemName||'',thaiName=b.thaiName||'',barcode=b.barcode||'';if([productCode,productName,thaiName,barcode].some(v=>typeof v!=='string')||!productCode.trim()||!productName.trim()||productCode.length>50||productName.length>255||thaiName.length>255||barcode.length>50)fail(400,'กรอกรหัส ชื่อสินค้า และบาร์โค้ดให้ถูกต้อง');if(!Number.isInteger(b.unitId)||b.unitId<=0||b.unitId>2147483647)fail(400,'กรุณาเลือกหน่วยนับจาก Master');tx=new sql.Transaction(await poolPromise);await tx.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);const q=()=>new sql.Request(tx);if(!(await q().input('Unit',sql.Int,b.unitId).query('SELECT UnitId FROM dbo.tblUnits WITH(HOLDLOCK) WHERE UnitId=@Unit')).recordset.length)fail(400,'ไม่พบหน่วยนับที่เลือก');const supplier=await selectedProductSupplier(q,b.supplierId,categoryId,null);if((await q().input('Code',sql.NVarChar(50),productCode.trim()).query('SELECT ProductId FROM dbo.tblProducts WITH(UPDLOCK,HOLDLOCK) WHERE ProductCode=@Code')).recordset.length)fail(400,'รหัสสินค้ามีอยู่ในระบบแล้ว');await q().input('Code',sql.NVarChar(50),productCode.trim()).input('Name',sql.NVarChar(255),productName.trim()).input('Thai',sql.NVarChar(255),thaiName.trim()||null).input('Barcode',sql.NVarChar(50),barcode.trim()||null).input('Category',sql.Int,categoryId).input('Unit',sql.Int,b.unitId).input('Supplier',sql.Int,supplier?.SupplierId||null).input('SupplierCode',sql.NVarChar(50),supplier?.SupplierCode||null).query('INSERT INTO dbo.tblProducts(ProductCode,ProductName,ThaiName,Barcode,CategoryId,UnitId,SupplierId,SupplierCode,MinStock,MaxStock,StandardCost,IsActive,CreatedAt,UpdatedAt) VALUES(@Code,@Name,@Thai,@Barcode,@Category,@Unit,@Supplier,@SupplierCode,0,0,0,1,GETDATE(),GETDATE())');const created=(await q().input('Code',sql.NVarChar(50),productCode.trim()).query('SELECT ProductId FROM dbo.tblProducts WHERE ProductCode=@Code')).recordset[0];await require('../services/product-volume')(q,created.ProductId,b.unitVolumeCm3);await require('../services/product-rm-spec').save(q,req,created.ProductId,categoryId,b.unitId,b.rmPackSpec);await tx.commit();res.json({success:true,message:'เพิ่มสินค้าเรียบร้อย'})}catch(e){if(tx)try{await tx.rollback()}catch{}res.status(e.status||500).json({success:false,message:e.status?e.message:'บันทึกสินค้าไม่สำเร็จ กรุณาตรวจ ProductSupplier.sql'})}});

// 7. PUT /api/products/:id (แก้ไขสินค้า)
router.put('/:id', authenticate, requireAdminOrPowerUser, async (req, res) => {
 let tx;try{const id=Number(req.params.id),b=req.body||{};if(!Number.isInteger(id)||id<=0||id>2147483647)return res.status(400).json({success:false,message:'รหัสสินค้าไม่ถูกต้อง'});const productName=(b.productName||b.itemName||'').trim(),thaiName=(b.thaiName||'').trim(),barcode=(b.barcode||'').trim();if(!productName)return res.status(400).json({success:false,message:'กรุณากรอกชื่อสินค้า'});if(b.unitId!==undefined&&(!Number.isInteger(b.unitId)||b.unitId<=0||b.unitId>2147483647))return res.status(400).json({success:false,message:'หน่วยนับไม่ถูกต้อง'});const pool=await poolPromise;tx=new sql.Transaction(pool);await tx.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);const q=()=>new sql.Request(tx),old=(await q().input('Id',sql.Int,id).query('SELECT CategoryId,UnitId,SupplierId,SupplierCode FROM dbo.tblProducts WITH(UPDLOCK,HOLDLOCK) WHERE ProductId=@Id')).recordset[0];const fail=(status,message)=>{throw Object.assign(Error(message),{status})};if(!old)fail(404,'ไม่พบสินค้า');if(!productScope.can(req,old.CategoryId,'EDIT'))fail(403,'ไม่มีสิทธิ์บันทึกสินค้ากลุ่มนี้');const unitId=b.unitId===undefined?old.UnitId:b.unitId;if(!(await q().input('Unit',sql.Int,unitId).query('SELECT UnitId FROM dbo.tblUnits WHERE UnitId=@Unit')).recordset.length)fail(400,'ไม่พบหน่วยนับที่เลือก');if(unitId!==old.UnitId){const inUse=(await q().input('Id',sql.Int,id).query("SELECT CASE WHEN EXISTS(SELECT 1 FROM dbWMS.dbo.tblStock WITH(HOLDLOCK) WHERE ProductId=@Id AND Quantity<>0) OR EXISTS(SELECT 1 FROM dbo.tblRMPackSpecs WHERE ProductId=@Id) OR EXISTS(SELECT 1 FROM dbo.tblBOMHeaders WHERE FGProductId=@Id) OR EXISTS(SELECT 1 FROM dbo.tblBOMLines WHERE ComponentProductId=@Id) OR EXISTS(SELECT 1 FROM dbWMS.dbo.InboundLines l JOIN dbWMS.dbo.InboundOrders h ON h.InboundId=l.InboundId WHERE l.ProductId=@Id AND h.Status<>'CLOSED') OR EXISTS(SELECT 1 FROM dbWMS.dbo.DeliveryLines l JOIN dbWMS.dbo.DeliveryOrders h ON h.DeliveryId=l.DeliveryId WHERE l.ProductId=@Id AND h.Status='DRAFT') THEN 1 ELSE 0 END AS Used")).recordset[0];if(inUse.Used)fail(409,'สินค้ามีสต๊อก งานค้าง สูตร หรือหน่วยบรรจุ RM อ้างอิงอยู่ จึงเปลี่ยนหน่วยไม่ได้ แต่แก้ชื่อและบาร์โค้ดโดยใช้หน่วยเดิมได้')}
 const supplier=await selectedProductSupplier(q,b.supplierId===undefined?old.SupplierId:b.supplierId,old.CategoryId,old.SupplierId);
 await q().input('SupplierId',sql.Int,supplier?.SupplierId||null).input('SupplierCode',sql.NVarChar(50),supplier?.SupplierCode||(b.supplierId===undefined&&old.SupplierId==null?old.SupplierCode:null)).input('Id',sql.Int,id).input('Name',sql.NVarChar(255),productName).input('Thai',sql.NVarChar(255),thaiName||null).input('Barcode',sql.NVarChar(50),barcode||null).input('Unit',sql.Int,unitId).query('UPDATE dbo.tblProducts SET ProductName=@Name,ThaiName=@Thai,Barcode=@Barcode,UnitId=@Unit,SupplierId=@SupplierId,SupplierCode=@SupplierCode,UpdatedAt=GETDATE() WHERE ProductId=@Id');await require('../services/product-volume')(q,id,b.unitVolumeCm3);await require('../services/product-rm-spec').save(q,req,id,old.CategoryId,unitId,b.rmPackSpec);await tx.commit();res.json({success:true,message:'แก้ไขข้อมูลสินค้าสำเร็จ'});
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
      .query('UPDATE dbo.tblProducts SET IsActive = 0, UpdatedAt = GETDATE() WHERE ProductId = @ProductId');

    res.json({ success: true, message: 'ลบสินค้าเรียบร้อย' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;