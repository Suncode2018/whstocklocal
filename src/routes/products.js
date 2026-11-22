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
router.use('/:id/pallet-versions',authenticate,require('./product-pallets'));

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
          p.ProductId, p.ProductCode, p.ProductName, p.Nickname,
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

router.get('/:id/pack-versions',authenticate,async(req,res)=>{try{const id=Number(req.params.id);if(!Number.isInteger(id)||id<=0||id>2147483647)return res.status(400).json({success:false,message:'รหัสสินค้าไม่ถูกต้อง'});const p=await poolPromise,product=(await p.request().input('I',sql.Int,id).query('SELECT p.ProductId,p.ProductCode,p.ProductName,p.CategoryId,p.UnitId,u.UnitCode,u.UnitName FROM dbo.tblProducts p JOIN dbo.tblUnits u ON u.UnitId=p.UnitId WHERE ProductId=@I')).recordset[0];if(!product)return res.status(404).json({success:false,message:'ไม่พบสินค้า'});if(!productScope.can(req,product.CategoryId,'VIEW'))return res.status(403).json({success:false,message:'ไม่มีสิทธิ์ดูกลุ่มสินค้านี้'});const rows=(await p.request().input('I',sql.Int,id).query(`SELECT v.*,u.UnitCode,CAST(CASE WHEN EXISTS(SELECT 1 FROM dbo.tblProductPalletVersions pv WHERE pv.PackVersionId=v.PackVersionId) OR EXISTS(SELECT 1 FROM dbWMS.dbo.InboundReceipts ir WHERE ir.PackVersionId=v.PackVersionId) OR EXISTS(SELECT 1 FROM dbWMS.dbo.tblStockTransactions st WHERE st.PackVersionId=v.PackVersionId) OR (v.LegacyUsageUnknown=1 AND (EXISTS(SELECT 1 FROM dbWMS.dbo.InboundLines l WHERE l.ProductId=v.ProductId) OR EXISTS(SELECT 1 FROM dbWMS.dbo.DeliveryLines l WHERE l.ProductId=v.ProductId))) THEN 0 ELSE 1 END AS bit) CanEdit,CAST(CASE WHEN NOT EXISTS(SELECT 1 FROM dbo.tblProductPalletVersions pv WHERE pv.PackVersionId=v.PackVersionId) AND NOT EXISTS(SELECT 1 FROM dbWMS.dbo.InboundReceipts ir WHERE ir.PackVersionId=v.PackVersionId) AND NOT EXISTS(SELECT 1 FROM dbWMS.dbo.tblStockTransactions st WHERE st.PackVersionId=v.PackVersionId) THEN 1 ELSE 0 END AS bit) CanDelete FROM dbo.tblProductPackVersions v JOIN dbo.tblUnits u ON u.UnitId=v.StockUnitId WHERE v.ProductId=@I AND v.IsDeleted=0 ORDER BY v.VersionNo DESC`)).recordset.map(v=>({...v,PackTestPassed:Boolean(v.PackTestPassedAt&&v.PackTestFingerprint&&v.PackTestFingerprint===require('../services/product-pack-version-policy').fingerprintPackagingVersion(v,v.UnitCode))}));const usage=(await p.request().input('I',sql.Int,id).query(`SELECT (SELECT COUNT_BIG(*) FROM dbWMS.dbo.InboundLines WHERE ProductId=@I) InboundLines,(SELECT COUNT_BIG(*) FROM dbWMS.dbo.DeliveryLines WHERE ProductId=@I) DeliveryLines,CAST(CASE WHEN OBJECT_ID(N'dbo.ProductPackVersionDeleteAudit',N'U') IS NULL THEN 0 ELSE 1 END AS bit) DeleteAuditReady`)).recordset[0];res.set('Cache-Control','no-store');res.json({success:true,product,usage,data:rows,activeVersions:rows.filter(v=>v.IsActive),current:rows.filter(v=>v.IsActive).length===1?rows.find(v=>v.IsActive):null})}catch(e){const schemaMissing=e.number===207||e.number===208;res.status(500).json({success:false,message:schemaMissing?'ฐานข้อมูลยังไม่มีโครงสร้าง Version ล่าสุด กรุณาติดตั้ง mssql/ProductPackVersionLotBinding.sql':'โหลดรุ่นอัตราบรรจุไม่สำเร็จ กรุณาลองใหม่'})}});
const savePackVersion=async(req,res)=>{let tx;try{const id=Number(req.params.id),b=req.body||{},fail=(status,message)=>{throw Object.assign(Error(message),{status})};if(!Number.isInteger(id)||id<=0||id>2147483647)fail(400,'รหัสสินค้าไม่ถูกต้อง');b.effectiveFrom=b.effectiveFrom||new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Bangkok'}).format(new Date());if(typeof b.effectiveFrom!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(b.effectiveFrom)||!Number.isFinite(Date.parse(b.effectiveFrom))||new Date(b.effectiveFrom).toISOString().slice(0,10)!==b.effectiveFrom||typeof b.packUnit!=='string'||!b.packUnit.trim()||b.packUnit.length>30||!/^\d{1,12}(?:\.\d{1,6})?$/.test(String(b.unitsPerPack))||Number(b.unitsPerPack)<=0||b.note!=null&&(typeof b.note!=='string'||b.note.length>255))fail(400,'กรอกวันเริ่มใช้ หน่วยกล่อง และจำนวนบรรจุให้ถูกต้อง');if(b.netWeightGramsPerUnit!=null&&b.netWeightGramsPerUnit!==''&&(!/^\d{1,12}(?:\.\d{1,6})?$/.test(String(b.netWeightGramsPerUnit))||Number(b.netWeightGramsPerUnit)<=0))fail(400,'น้ำหนักสุทธิต่อหน่วยต้องมากกว่า 0');if(b.stockUnitLabel!=null&&(typeof b.stockUnitLabel!=='string'||!b.stockUnitLabel.trim()||b.stockUnitLabel.trim().length>30))fail(400,'ระบุชื่อหน่วยนับไม่เกิน 30 ตัวอักษร');if(b.netVolumeMlPerUnit!=null&&b.netVolumeMlPerUnit!==''&&(!/^\d{1,12}(?:\.\d{1,6})?$/.test(String(b.netVolumeMlPerUnit))||Number(b.netVolumeMlPerUnit)<=0))fail(400,'ปริมาตรสุทธิต่อหน่วยต้องมากกว่า 0 ทศนิยมไม่เกิน 6 ตำแหน่ง');if(b.outerPackUnit||b.packsPerOuter!=null){if(typeof b.outerPackUnit!=='string'||!b.outerPackUnit.trim()||b.outerPackUnit.length>30||b.outerPackUnit.trim()===b.packUnit.trim()||!/^\d{1,6}$/.test(String(b.packsPerOuter))||Number(b.packsPerOuter)<2||Number(b.packsPerOuter)>999999||!Number.isSafeInteger(Number(b.unitsPerPack))||Number(b.unitsPerPack)*Number(b.packsPerOuter)>999999999999)fail(400,'ระดับลัง: ระบุชื่อหน่วยต่างจากกล่อง และจำนวนเต็ม 2–999999 กล่องต่อลัง');}const hasInnerName=b.innerPackUnit!=null&&String(b.innerPackUnit).trim()!=='';const hasInnerQty=b.unitsPerInnerPack!=null&&String(b.unitsPerInnerPack).trim()!=='';if(hasInnerName!==hasInnerQty)fail(400,'หน่วยย่อยเป็นตัวเลือก: กรอกทั้งชื่อหน่วยและจำนวนต่อหน่วย หรือเว้นว่างทั้งคู่');if(hasInnerName&&(typeof b.innerPackUnit!=='string'||b.innerPackUnit.trim().length>30||!/^[0-9]{1,12}(?:\.[0-9]{1,6})?$/.test(String(b.unitsPerInnerPack))||Number(b.unitsPerInnerPack)<=0||b.innerPackUnit.trim()===b.packUnit.trim()||b.innerPackUnit.trim()===String(b.outerPackUnit||'').trim()))fail(400,'ระดับหน่วยย่อย: ระบุชื่อหน่วยและจำนวนต่อหน่วยให้ถูกต้อง และห้ามซ้ำกับหน่วยบรรจุอื่น');tx=new sql.Transaction(await poolPromise);await tx.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);const q=()=>new sql.Request(tx),product=(await q().input('I',sql.Int,id).query('SELECT p.UnitId,u.UnitCode FROM dbo.tblProducts p WITH(UPDLOCK,HOLDLOCK) JOIN dbo.tblUnits u ON u.UnitId=p.UnitId WHERE ProductId=@I')).recordset[0];if(!product)fail(404,'ไม่พบสินค้า');if(product.UnitCode==='PCS'&&!Number.isInteger(Number(b.unitsPerPack)))fail(400,'สินค้าหน่วย PCS ต้องบรรจุเป็นจำนวนเต็ม');if(hasInnerName){const innerName=b.innerPackUnit.trim().toLocaleLowerCase('th-TH'),baseNames=[product.UnitCode,b.stockUnitLabel||product.UnitCode,b.packUnit,b.outerPackUnit].filter(Boolean).map(x=>String(x).trim().toLocaleLowerCase('th-TH'));if(baseNames.includes(innerName))fail(400,'ชื่อหน่วยย่อยต้องไม่ซ้ำกับหน่วยสต๊อก กล่อง หรือลัง');if(product.UnitCode==='PCS'&&!Number.isInteger(Number(b.unitsPerInnerPack)))fail(400,'สินค้าหน่วย PCS ต้องกำหนดจำนวนต่อหน่วยย่อยเป็นจำนวนเต็ม');if(Number(b.unitsPerInnerPack)>Number(b.unitsPerPack))fail(400,'จำนวนต่อหน่วยย่อยต้องไม่มากกว่าจำนวนต่อหน่วยบรรจุชั้นแรก');}require('../services/product-pack-version-policy').assertStockUnitLabel(product.UnitCode,b.stockUnitLabel);require('../services/product-pack-version-policy').assertPackagingHierarchy(product.UnitCode,b.unitsPerPack,hasInnerName?b.innerPackUnit:null,hasInnerName?b.unitsPerInnerPack:null);if(req.method==='PUT'){await require('../services/product-pack-edit').save(q,req,id,b,product);await tx.commit();return res.json({success:true,PackVersionId:Number(req.params.versionId)})}const row=(await q().input('I',sql.Int,id).input('D',sql.Date,b.effectiveFrom).input('Pack',sql.NVarChar(30),b.packUnit.trim()).input('Qty',sql.Decimal(18,6),b.unitsPerPack).input('U',sql.Int,product.UnitId).input('Weight',sql.Decimal(18,6),b.netWeightGramsPerUnit==null||b.netWeightGramsPerUnit===''?null:b.netWeightGramsPerUnit).input('UnitLabel',sql.NVarChar(30),b.stockUnitLabel?.trim()||null).input('Volume',sql.Decimal(18,6),b.netVolumeMlPerUnit==null||b.netVolumeMlPerUnit===''?null:b.netVolumeMlPerUnit).input('Inner',sql.NVarChar(30),b.innerPackUnit?.trim()||null).input('InnerQty',sql.Decimal(18,6),b.innerPackUnit?b.unitsPerInnerPack:null).input('Outer',sql.NVarChar(30),b.outerPackUnit?.trim()||null).input('Packs',sql.Int,b.outerPackUnit?Number(b.packsPerOuter):null).input('Note',sql.NVarChar(255),b.note?.trim()||null).input('By',sql.NVarChar(100),String(req.user.username||req.user.id).slice(0,100)).query('INSERT dbo.tblProductPackVersions(ProductId,VersionNo,EffectiveFrom,PackUnit,UnitsPerPack,StockUnitId,NetWeightGramsPerUnit,StockUnitLabel,NetVolumeMlPerUnit,InnerPackUnit,UnitsPerInnerPack,OuterPackUnit,PacksPerOuter,Note,CreatedBy,IsActive,LegacyUsageUnknown) OUTPUT inserted.PackVersionId SELECT @I,COALESCE(MAX(VersionNo),0)+1,@D,@Pack,@Qty,@U,@Weight,@UnitLabel,@Volume,@Inner,@InnerQty,@Outer,@Packs,@Note,@By,0,0 FROM dbo.tblProductPackVersions WHERE ProductId=@I')).recordset[0];await tx.commit();res.status(201).json({success:true,PackVersionId:row.PackVersionId})}catch(e){if(tx)try{await tx.rollback()}catch{}res.status(e.status||500).json({success:false,message:e.status?e.message:'บันทึกรุ่นอัตราบรรจุไม่สำเร็จ'})}};
router.post('/:id/pack-versions',authenticate,requireAdmin,savePackVersion);
router.put('/:id/pack-versions/:versionId',authenticate,requireAdmin,savePackVersion);
router.delete('/:id/pack-versions/:versionId',authenticate,requireAdmin,async(req,res)=>{let tx;try{const id=Number(req.params.id),versionId=Number(req.params.versionId),reason=String(req.body?.reason||'').trim();if(!Number.isInteger(id)||id<=0||!Number.isInteger(versionId)||versionId<=0||!reason||reason.length>500)return res.status(400).json({success:false,message:'ระบุ Version และเหตุผลการลบไม่เกิน 500 ตัวอักษร'});tx=new sql.Transaction(await poolPromise);await tx.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);const q=()=>new sql.Request(tx),row=(await q().input('P',sql.Int,id).input('V',sql.Int,versionId).query('SELECT * FROM dbo.tblProductPackVersions WITH(UPDLOCK,HOLDLOCK) WHERE ProductId=@P AND PackVersionId=@V AND IsDeleted=0')).recordset[0];if(!row)throw Object.assign(Error('ไม่พบ Version นี้'),{status:404});if(row.IsActive){await q().input('V',sql.Int,versionId).query('UPDATE dbo.tblProductPackVersions SET IsActive=0,PackTestFingerprint=NULL,PackTestPassedAt=NULL,PackTestPassedBy=NULL WHERE PackVersionId=@V');await q().input('V',sql.Int,versionId).input('Reason',sql.NVarChar(500),('ลบ Version: '+reason).slice(0,500)).input('Actor',sql.NVarChar(100),String(req.user.username||req.user.id).slice(0,100)).query('INSERT dbo.ProductPackStatusAudit(PackVersionId,OldIsActive,NewIsActive,Reason,Actor) VALUES(@V,1,0,@Reason,@Actor)')}const used=(await q().input('V',sql.Int,versionId).query('SELECT CASE WHEN EXISTS(SELECT 1 FROM dbo.tblProductPalletVersions WITH(HOLDLOCK) WHERE PackVersionId=@V) OR EXISTS(SELECT 1 FROM dbWMS.dbo.InboundReceipts WITH(HOLDLOCK) WHERE PackVersionId=@V) OR EXISTS(SELECT 1 FROM dbWMS.dbo.tblStockTransactions WITH(HOLDLOCK) WHERE PackVersionId=@V) THEN 1 ELSE 0 END Used')).recordset[0];const snapshot=(await q().input('V',sql.Int,versionId).query('SELECT (SELECT (SELECT * FROM dbo.tblProductPackVersions WHERE PackVersionId=@V FOR JSON PATH,WITHOUT_ARRAY_WRAPPER) PackVersion,JSON_QUERY((SELECT * FROM dbo.ProductPackStatusAudit WHERE PackVersionId=@V FOR JSON PATH)) StatusHistory,JSON_QUERY((SELECT * FROM dbo.ProductPackEditAudit WHERE PackVersionId=@V FOR JSON PATH)) EditHistory FOR JSON PATH,WITHOUT_ARRAY_WRAPPER) SnapshotJson')).recordset[0].SnapshotJson,actor=String(req.user.username||req.user.id).slice(0,100);await q().input('P',sql.Int,id).input('V',sql.Int,versionId).input('N',sql.Int,row.VersionNo).input('Snapshot',sql.NVarChar(sql.MAX),snapshot).input('Reason',sql.NVarChar(500),reason).input('Actor',sql.NVarChar(100),actor).query('INSERT dbo.ProductPackVersionDeleteAudit(ProductId,PackVersionId,VersionNo,SnapshotJson,Reason,Actor) VALUES(@P,@V,@N,@Snapshot,@Reason,@Actor)');if(used.Used){await q().input('V',sql.Int,versionId).query('UPDATE dbo.tblProductPackVersions SET IsDeleted=1,IsActive=0,PackTestFingerprint=NULL,PackTestPassedAt=NULL,PackTestPassedBy=NULL WHERE PackVersionId=@V')}else{await q().input('V',sql.Int,versionId).query('DELETE dbo.ProductPackStatusAudit WHERE PackVersionId=@V; DELETE dbo.ProductPackEditAudit WHERE PackVersionId=@V');await q().input('P',sql.Int,id).input('V',sql.Int,versionId).query('DELETE dbo.tblProductPackVersions WHERE ProductId=@P AND PackVersionId=@V')}await tx.commit();res.json({success:true,PackVersionId:versionId,archived:Boolean(used.Used)});}catch(e){if(tx)try{await tx.rollback()}catch{}res.status(e.status||500).json({success:false,message:e.status?e.message:(e.number===207||e.number===208?'ฐานข้อมูลยังไม่มีโครงสร้างประวัติการลบ Version กรุณาติดตั้ง mssql/ProductPackVersionLotBinding.sql แล้วรีสตาร์ตระบบ':'ลบ Version ไม่สำเร็จ กรุณาลองใหม่')})}});router.post('/:id/pack-versions/:versionId/test',authenticate,requireAdmin,async(req,res)=>{let tx;try{const id=Number(req.params.id),versionId=Number(req.params.versionId);if(!Number.isInteger(id)||id<=0||!Number.isInteger(versionId)||versionId<=0)return res.status(400).json({success:false,message:'รหัสสินค้า หรือ Version ไม่ถูกต้อง'});tx=new sql.Transaction(await poolPromise);await tx.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);const q=()=>new sql.Request(tx),row=(await q().input('P',sql.Int,id).input('V',sql.Int,versionId).query('SELECT v.*,u.UnitCode FROM dbo.tblProductPackVersions v WITH(UPDLOCK,HOLDLOCK) JOIN dbo.tblProducts p ON p.ProductId=v.ProductId JOIN dbo.tblUnits u ON u.UnitId=p.UnitId WHERE v.ProductId=@P AND v.PackVersionId=@V AND v.IsDeleted=0')).recordset[0];if(!row)throw Object.assign(Error('ไม่พบ Version นี้'),{status:404});const policy=require('../services/product-pack-version-policy'),result=policy.testPackagingVersion(row,row.UnitCode),fingerprint=policy.fingerprintPackagingVersion(row,row.UnitCode),actor=String(req.user.username||req.user.id).slice(0,100);await q().input('V',sql.Int,versionId).input('Fingerprint',sql.Char(64),fingerprint).input('By',sql.NVarChar(100),actor).query('UPDATE dbo.tblProductPackVersions SET PackTestFingerprint=@Fingerprint,PackTestPassedAt=SYSDATETIME(),PackTestPassedBy=@By WHERE PackVersionId=@V AND IsDeleted=0');await tx.commit();res.json({...result,PackVersionId:versionId,PackTestFingerprint:fingerprint});}catch(e){if(tx)try{await tx.rollback()}catch{}res.status(e.status||500).json({success:false,message:e.status?e.message:'ทดสอบอัตราบรรจุไม่สำเร็จ'})}});router.patch('/:id/pack-versions/:versionId/status',authenticate,requireAdmin,async(req,res)=>{let tx;try{const id=Number(req.params.id),versionId=Number(req.params.versionId),active=req.body?.isActive,reason=String(req.body?.reason||'').trim();if(!Number.isInteger(id)||id<=0||!Number.isInteger(versionId)||versionId<=0||typeof active!=='boolean'||!reason||reason.length>500)return res.status(400).json({success:false,message:'ระบุรุ่น สถานะ และเหตุผลการเปลี่ยนสถานะให้ครบ'});tx=new sql.Transaction(await poolPromise);await tx.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);const q=()=>new sql.Request(tx),row=(await q().input('P',sql.Int,id).input('V',sql.Int,versionId).query('SELECT v.*,u.UnitCode FROM dbo.tblProductPackVersions v WITH(UPDLOCK,HOLDLOCK) JOIN dbo.tblProducts p ON p.ProductId=v.ProductId JOIN dbo.tblUnits u ON u.UnitId=p.UnitId WHERE v.ProductId=@P AND v.PackVersionId=@V AND v.IsDeleted=0')).recordset[0];if(!row)throw Object.assign(Error('ไม่พบรุ่นบรรจุ'),{status:404});if(active){require('../services/product-pack-version-policy').assertPassedTest(row,row.UnitCode);}if(Boolean(row.IsActive)!==active){await q().input('V',sql.Int,versionId).input('A',sql.Bit,active).query('UPDATE dbo.tblProductPackVersions SET IsActive=@A,PackTestFingerprint=CASE WHEN @A=0 THEN NULL ELSE PackTestFingerprint END,PackTestPassedAt=CASE WHEN @A=0 THEN NULL ELSE PackTestPassedAt END,PackTestPassedBy=CASE WHEN @A=0 THEN NULL ELSE PackTestPassedBy END WHERE PackVersionId=@V');await q().input('V',sql.Int,versionId).input('Old',sql.Bit,row.IsActive).input('New',sql.Bit,active).input('Reason',sql.NVarChar(500),reason).input('Actor',sql.NVarChar(100),String(req.user.username||req.user.id).slice(0,100)).query('INSERT dbo.ProductPackStatusAudit(PackVersionId,OldIsActive,NewIsActive,Reason,Actor) VALUES(@V,@Old,@New,@Reason,@Actor)')}await tx.commit();res.json({success:true,PackVersionId:versionId,IsActive:active});}catch(e){if(tx)try{await tx.rollback()}catch{}const schemaMissing=e.number===207||e.number===208;res.status(e.status||500).json({success:false,message:e.status?e.message:schemaMissing?'ฐานข้อมูลยังไม่มีโครงสร้างควบคุม Version กรุณาติดตั้ง mssql/ProductPackVersionLotBinding.sql แล้วลองใหม่':'เปลี่ยนสถานะรุ่นบรรจุไม่สำเร็จ กรุณาลองใหม่'})}});
router.get('/:id/rm-spec',authenticate,requireAdmin,async(req,res)=>{try{const id=Number(req.params.id);if(!Number.isInteger(id)||id<=0||id>2147483647)return res.status(400).json({success:false,message:'รหัสสินค้าไม่ถูกต้อง'});const p=await poolPromise,row=(await p.request().input('P',sql.Int,id).query('SELECT * FROM dbo.tblRMPackSpecs WHERE ProductId=@P')).recordset[0];res.json({success:true,data:row||null})}catch(e){res.status(500).json({success:false,message:'โหลดหน่วยบรรจุไม่สำเร็จ'})}});
router.get('/', authenticate, async (req, res) => {
  try {
    const pool = await poolPromise;
    const search = req.query.search ? req.query.search.trim() : '';

    let whereClause = 'WHERE 1=1';
    const request = pool.request();

    if (search) {
      whereClause += ` AND (p.ProductCode LIKE @search OR p.ProductName LIKE @search OR p.Nickname LIKE @search OR p.Barcode LIKE @search OR p.ProductName1 LIKE @search OR p.ProductName2 LIKE @search OR p.ProID1 LIKE @search OR p.ProID2 LIKE @search OR p.ProID3 LIKE @search OR p.ProID4 LIKE @search)`;
      request.input('search', sql.NVarChar, `%${search}%`);
    }

    const queryStr = `
      SELECT 
        p.ProductId,
        p.ProductCode,
        p.ProductCode AS ItemCode,
        p.ProductName,
        p.ProductName AS ItemName,
        p.AllowClinicDelivery,p.ClinicDeliveryNote,p.AllowSevenElevenDelivery,p.SevenElevenDeliveryNote,p.Nickname,p.ProductName1,p.ProductName2,p.ProID1,p.ProID2,p.ProID3,p.ProID4,p.PhysicalForm,p.MasterStatus,CONVERT(varchar(18),CONVERT(varbinary(8),p.RowVersion),1) AS Revision,
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
router.post('/',authenticate,requireAdminOrPowerUser,async(req,res)=>{let tx;try{const b=req.body||{},categoryId=Number(b.categoryId||1),fail=(status,message)=>{throw Object.assign(Error(message),{status})};if(!require('../config/navigation').catalog.some(m=>m.scopeParent==='PRODUCTS'&&m.categoryId===categoryId)||!productScope.can(req,categoryId,'EDIT'))fail(403,'ไม่มีสิทธิ์บันทึกสินค้ากลุ่มนี้');const productCode=b.productCode||b.itemCode||'',productName=b.productName||b.itemName||'',nickname=b.nickname||'',barcode=b.barcode||'';if([productCode,productName,nickname,barcode].some(v=>typeof v!=='string')||!productCode.trim()||!productName.trim()||productCode.length>50||productName.length>2000||nickname.length>255||barcode.length>50)fail(400,'กรอกรหัส ชื่อสินค้า และบาร์โค้ดให้ถูกต้อง');if(!Number.isInteger(b.unitId)||b.unitId<=0||b.unitId>2147483647)fail(400,'กรุณาเลือกหน่วยนับจาก Master');tx=new sql.Transaction(await poolPromise);await tx.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);const q=()=>new sql.Request(tx);if(!(await q().input('Unit',sql.Int,b.unitId).query('SELECT UnitId FROM dbo.tblUnits WITH(HOLDLOCK) WHERE UnitId=@Unit')).recordset.length)fail(400,'ไม่พบหน่วยนับที่เลือก');const supplier=await selectedProductSupplier(q,b.supplierId,categoryId,null);if((await q().input('Code',sql.NVarChar(50),productCode.trim()).query('SELECT ProductId FROM dbo.tblProducts WITH(UPDLOCK,HOLDLOCK) WHERE ProductCode=@Code')).recordset.length)fail(400,'รหัสสินค้ามีอยู่ในระบบแล้ว');await q().input('Code',sql.NVarChar(50),productCode.trim()).input('Name',sql.NVarChar(2000),productName.trim()).input('Nickname',sql.NVarChar(255),nickname.trim()||null).input('Barcode',sql.NVarChar(50),barcode.trim()||null).input('Category',sql.Int,categoryId).input('Unit',sql.Int,b.unitId).input('Supplier',sql.Int,supplier?.SupplierId||null).input('SupplierCode',sql.NVarChar(50),supplier?.SupplierCode||null).query('INSERT INTO dbo.tblProducts(ProductCode,ProductName,Nickname,Barcode,CategoryId,UnitId,SupplierId,SupplierCode,MinStock,MaxStock,StandardCost,IsActive,CreatedAt,UpdatedAt) VALUES(@Code,@Name,@Nickname,@Barcode,@Category,@Unit,@Supplier,@SupplierCode,0,0,0,1,GETDATE(),GETDATE())');const created=(await q().input('Code',sql.NVarChar(50),productCode.trim()).query('SELECT ProductId FROM dbo.tblProducts WHERE ProductCode=@Code')).recordset[0];await require('../services/product-clinic').save(q,req,created.ProductId,b);await require('../services/product-seven-eleven').save(q,req,created.ProductId,b);await require('../services/product-master-fields')(q,created.ProductId,b);await require('../services/product-volume')(q,created.ProductId,b.unitVolumeCm3);await require('../services/product-rm-spec').save(q,req,created.ProductId,categoryId,b.unitId,b.rmPackSpec);await tx.commit();res.json({success:true,message:'เพิ่มสินค้าเรียบร้อย'})}catch(e){if(tx)try{await tx.rollback()}catch{}res.status(e.status||500).json({success:false,message:e.status?e.message:'บันทึกสินค้าไม่สำเร็จ กรุณาตรวจ ProductSupplier.sql'})}});

// 7. PUT /api/products/:id (แก้ไขสินค้า)
router.put('/:id', authenticate, requireAdminOrPowerUser, async (req,res)=>{
 let tx;try{
 const id=Number(req.params.id),b=req.body||{},fail=(status,message)=>{throw Object.assign(Error(message),{status})};
 if(!Number.isInteger(id)||id<=0||id>2147483647)fail(400,'รหัสสินค้าไม่ถูกต้อง');
 const productName=b.productName??b.itemName??'',nickname=b.nickname??'',barcode=b.barcode??'';
 if(typeof productName!=='string'||!productName.trim()||productName.length>2000||typeof nickname!=='string'||nickname.length>255||typeof barcode!=='string'||barcode.length>50)fail(400,'ตรวจชื่อสินค้า ชื่อภาษาไทย และบาร์โค้ด');
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
 await q().input('Id',sql.Int,id).input('Code',sql.NVarChar(50),code).input('State',sql.VarChar(20),status).input('Name',sql.NVarChar(2000),productName.trim()).input('Nickname',sql.NVarChar(255),nickname.trim()||null).input('Barcode',sql.NVarChar(50),barcode.trim()||null).input('Unit',sql.Int,unitId).input('SupplierId',sql.Int,supplier?.SupplierId||null).input('SupplierCode',sql.NVarChar(50),supplier?.SupplierCode||(b.supplierId===undefined&&old.SupplierId==null?old.SupplierCode:null)).query("UPDATE dbo.tblProducts SET ProductCode=@Code,MasterStatus=@State,IsActive=CASE WHEN @State='READY' THEN 1 ELSE 0 END,ProductName=@Name,Nickname=@Nickname,Barcode=@Barcode,UnitId=@Unit,SupplierId=@SupplierId,SupplierCode=@SupplierCode,UpdatedAt=SYSUTCDATETIME() WHERE ProductId=@Id");
 await require('../services/product-clinic').save(q,req,id,b);await require('../services/product-seven-eleven').save(q,req,id,b);await require('../services/product-master-fields')(q,id,b);await require('../services/product-volume')(q,id,b.unitVolumeCm3);await require('../services/product-rm-spec').save(q,req,id,old.CategoryId,unitId,b.rmPackSpec);
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
