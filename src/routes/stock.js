const express = require('express');
const jwt = require('jsonwebtoken');
const router = express.Router();
const { poolPromise, sql } = require('../config/db');
const JWT_SECRET = process.env.JWT_SECRET || 'super_secret_local_warehouse_jwt_key_2026';

router.use((req, res, next) => {
  const match = /^Bearer\s+(\S+)$/i.exec(req.headers.authorization || '');
  if (!match) return res.status(401).json({ success: false, message: 'กรุณาเข้าสู่ระบบ' });
  try { req.user = jwt.verify(match[1], JWT_SECRET); next(); }
  catch (_) { return res.status(401).json({ success: false, isExpired: true, message: 'เซสชันหมดอายุหรือไม่ถูกต้อง' }); }
});

// Read stock only from dbWMS. Product and unit master data remain in dbMaster.
// Aggregate before joining products so multiple locations never duplicate totals.
const balanceQuery = `
  WITH LocationStock AS (
    SELECT ProductId, LocationCode, SUM(Quantity) AS Quantity, MAX(UpdatedAt) AS LastUpdated
    FROM [dbWMS].[dbo].[tblStock]
    GROUP BY ProductId, LocationCode
  ), StockBalance AS (
    SELECT ProductId, SUM(Quantity) AS TotalStock, MAX(LastUpdated) AS LastUpdated,
      STRING_AGG(CAST(CONCAT(LocationCode, N' (', Quantity, N')') AS NVARCHAR(MAX)), N', ')
        WITHIN GROUP (ORDER BY LocationCode) AS LocationDetails
    FROM LocationStock
    GROUP BY ProductId
  )
  SELECT p.ProductId, p.ProductCode, p.ProductCode AS ItemCode,
    p.ProductName, p.ProductName AS ItemName, p.ThaiName, p.Barcode,
    p.CategoryId, p.IsActive, p.MinStock, p.MaxStock,
    COALESCE(u.UnitCode, p.PackageType, N'') AS UOM,
    COALESCE(s.TotalStock, 0) AS TotalStock,
    COALESCE(s.LocationDetails, N'') AS LocationDetails, s.LastUpdated
  FROM [dbMaster].[dbo].[tblProducts] p
  LEFT JOIN [dbMaster].[dbo].[tblUnits] u ON u.UnitId = p.UnitId
  LEFT JOIN StockBalance s ON s.ProductId = p.ProductId
`;

router.get('/balance', async (req, res) => {
  const roles = ['ADMIN', 'POWERUSER', 'SUPERVISOR', 'VIEWER', 'READONLY'];
  if (!roles.includes(String(req.user.role || '').toUpperCase())) {
    return res.status(403).json({ success: false, message: 'ไม่มีสิทธิ์ดูรายงานสต๊อก' });
  }
  try {
    const pool = await poolPromise;
    const result = await pool.request().query(balanceQuery + ' ORDER BY p.ProductCode, p.ProductId');
    res.set('Cache-Control', 'no-store');
    res.json({ success: true, data: result.recordset });
  } catch (err) {
    console.error('Stock balance query failed:', err.code);
    res.status(500).json({ success: false, message: 'ไม่สามารถโหลดรายงานสต๊อกจากฐานข้อมูลได้' });
  }
});

router.get('/lookup', async (req, res) => {
  const code = String(req.query.code || req.query.barcode || '').trim();
  if (!code || code.length > 100) return res.status(400).json({ success: false, message: 'กรุณาระบุรหัสสินค้าหรือบาร์โค้ดไม่เกิน 100 ตัวอักษร' });
  try {
    const pool = await poolPromise;
    const result = await pool.request().input('Code', sql.NVarChar(100), code)
      .query(balanceQuery + ' WHERE p.ProductCode = @Code OR p.Barcode = @Code ORDER BY p.ProductId');
    if (!result.recordset.length) return res.status(404).json({ success: false, message: 'ไม่พบสินค้าในระบบ' });
    if (result.recordset.length > 1) return res.status(409).json({ success: false, message: 'พบรหัสหรือบาร์โค้ดซ้ำ กรุณาตรวจข้อมูลสินค้า' });
    const product = result.recordset[0];
    const locations = await pool.request().input('ProductId', sql.Int, product.ProductId).query(`
      SELECT whid, LocationCode AS locationCode, SUM(Quantity) AS quantity, MAX(UpdatedAt) AS lastUpdated
      FROM [dbWMS].[dbo].[tblStock]
      WHERE ProductId = @ProductId AND Quantity <> 0
      GROUP BY whid, LocationCode ORDER BY whid, LocationCode
    `);
    res.set('Cache-Control', 'no-store');
    res.json({ success: true, product: {
      itemCode: product.ItemCode, itemName: product.ItemName, barcode: product.Barcode,
      uom: product.UOM, totalQuantity: product.TotalStock, locations: locations.recordset
    } });
  } catch (err) {
    console.error('Stock lookup query failed:', err.code);
    res.status(500).json({ success: false, message: 'ไม่สามารถค้นหาสต๊อกจากฐานข้อมูลได้' });
  }
});


function requireStockAdmin(req, res, next) {
  if (String(req.user.role || '').toUpperCase() !== 'ADMIN') return res.status(403).json({ success: false, message: 'เฉพาะ ADMIN เท่านั้นที่ปรับยอดสต๊อกได้' });
  next();
}
router.get('/adjustment-context/:productId', requireStockAdmin, async (req, res) => {
  const id = Number(req.params.productId);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ success:false, message:'รหัสสินค้าไม่ถูกต้อง' });
  try {
    const pool = await poolPromise;
    const result = await pool.request().input('ProductId', sql.Int, id).query(`
      SELECT p.ProductId,p.ProductCode,p.ProductName,p.ThaiName,p.Barcode,p.IsActive,
        COALESCE(u.UnitCode,p.PackageType,N'') AS UOM
      FROM dbMaster.dbo.tblProducts p LEFT JOIN dbMaster.dbo.tblUnits u ON u.UnitId=p.UnitId WHERE p.ProductId=@ProductId;
      SELECT whid,whname FROM dbMaster.dbo.tblWH ORDER BY whid;
      SELECT whid,LocationCode FROM dbMaster.dbo.Locations WHERE IsActive=1 ORDER BY whid,LocationCode;
      SELECT whid,LocationCode,Quantity FROM dbWMS.dbo.tblStock WHERE ProductId=@ProductId;
    `);
    if (!result.recordsets[0].length) return res.status(404).json({success:false,message:'ไม่พบสินค้า'});
    res.set('Cache-Control','no-store').json({success:true,product:result.recordsets[0][0],warehouses:result.recordsets[1],locations:result.recordsets[2],stock:result.recordsets[3]});
  } catch (err) { console.error('Stock adjustment context:',err.code); res.status(500).json({success:false,message:'โหลดข้อมูลสำหรับปรับสต๊อกไม่สำเร็จ'}); }
});

// Set an absolute quantity for one warehouse/product/location. Both writes are atomic.
const adjustmentSql = `
  DECLARE @Barcode NVARCHAR(50), @OldQuantity DECIMAL(18,2), @StockId INT;
  IF NOT EXISTS (SELECT 1 FROM dbMaster.dbo.tblProducts WITH (HOLDLOCK) WHERE ProductId=@ProductId AND IsActive=1)
    THROW 50001, N'ไม่พบสินค้าหรือสินค้าถูกปิดใช้งาน', 1;
  SELECT @Barcode=Barcode FROM dbMaster.dbo.tblProducts WHERE ProductId=@ProductId;
  IF NOT EXISTS (SELECT 1 FROM dbMaster.dbo.tblWH WITH (HOLDLOCK) WHERE whid=@WhId)
    THROW 50002, N'ไม่พบคลังสินค้า', 1;
  IF NOT EXISTS (SELECT 1 FROM dbMaster.dbo.Locations WITH (HOLDLOCK) WHERE whid=@WhId AND LocationCode=@LocationCode AND IsActive=1)
    THROW 50003, N'โลเคชั่นไม่อยู่ในคลังที่เลือกหรือถูกปิดใช้งาน', 1;
  SELECT @StockId=StockId,@OldQuantity=Quantity FROM dbWMS.dbo.tblStock WITH (UPDLOCK,HOLDLOCK)
    WHERE whid=@WhId AND ProductId=@ProductId AND LocationCode=@LocationCode;
  SET @OldQuantity=COALESCE(@OldQuantity,0);
  IF @OldQuantity<>@ExpectedQuantity THROW 50004, N'ยอดสต๊อกเปลี่ยนแล้ว กรุณาโหลดข้อมูลล่าสุดก่อนปรับยอดอีกครั้ง', 1;
  IF @OldQuantity=@NewQuantity
  BEGIN
    SELECT @OldQuantity AS oldQuantity,@NewQuantity AS newQuantity,CAST(0 AS DECIMAL(18,2)) AS change,CAST(0 AS BIT) AS changed;
    RETURN;
  END;
  IF @StockId IS NULL
    INSERT INTO dbWMS.dbo.tblStock (whid,ProductId,Barcode,LocationCode,Quantity,CreatedAt,UpdatedAt)
    VALUES (@WhId,@ProductId,@Barcode,@LocationCode,@NewQuantity,SYSDATETIME(),SYSDATETIME());
  ELSE
    UPDATE dbWMS.dbo.tblStock SET Quantity=@NewQuantity,Barcode=@Barcode,UpdatedAt=SYSDATETIME() WHERE StockId=@StockId;
  INSERT INTO dbWMS.dbo.tblStockTransactions (TransType,whid,ProductId,Barcode,LocationCode,QtyChange,QtyAfter,RefDocNo,Remark,CreatedBy,CreatedAt)
  VALUES (N'ADJUST',@WhId,@ProductId,@Barcode,@LocationCode,@NewQuantity-@OldQuantity,@NewQuantity,@RefDocNo,@Remark,@CreatedBy,SYSDATETIME());
  SELECT @OldQuantity AS oldQuantity,@NewQuantity AS newQuantity,@NewQuantity-@OldQuantity AS change,CAST(1 AS BIT) AS changed;
`;
router.post('/adjust', requireStockAdmin, async (req, res) => {
  const {productId,whid,locationCode,quantity,expectedQuantity,remark,referenceNo} = req.body || {};
  const validQty = value => (typeof value === 'string' || typeof value === 'number') && /^\d{1,12}(?:\.\d{1,2})?$/.test(String(value)) && Number.isFinite(Number(value));
  if (!Number.isInteger(productId) || productId<=0 || !Number.isInteger(whid) || whid<=0 || typeof locationCode!=='string' || !locationCode.trim() || locationCode.length>50 || !validQty(quantity) || !validQty(expectedQuantity) || typeof remark!=='string' || !remark.trim() || remark.length>255 || (referenceNo!=null && (typeof referenceNo!=='string' || referenceNo.length>60))) {
    return res.status(400).json({success:false,message:'กรุณาระบุสินค้า คลัง โลเคชั่น ยอดใหม่ไม่ติดลบ (ทศนิยมไม่เกิน 2 ตำแหน่ง) และเหตุผลให้ถูกต้อง'});
  }
  let transaction;
  try {
    const pool = await poolPromise;
    transaction = new sql.Transaction(pool);
    await transaction.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
    const result = await new sql.Request(transaction)
      .input('ProductId',sql.Int,productId).input('WhId',sql.Int,whid)
      .input('LocationCode',sql.NVarChar(50),locationCode.trim())
      .input('NewQuantity',sql.Decimal(18,2),quantity).input('ExpectedQuantity',sql.Decimal(18,2),expectedQuantity)
      .input('Remark',sql.NVarChar(255),remark.trim()).input('RefDocNo',sql.NVarChar(60),referenceNo?.trim() || null)
      .input('CreatedBy',sql.NVarChar(50),String(req.user.username || req.user.id || 'ADMIN').slice(0,50))
      .query(adjustmentSql);
    await transaction.commit();
    res.json({success:true,...result.recordset[0]});
  } catch (err) {
    if (transaction) { try { await transaction.rollback(); } catch (_) {} }
    const number = err.number || err.originalError?.info?.number;
    if ([50001,50002,50003,50004].includes(number)) return res.status(number===50004?409:400).json({success:false,message:err.message});
    console.error('Stock adjustment failed:',err.code);
    res.status(500).json({success:false,message:'บันทึกปรับยอดไม่สำเร็จ กรุณาโหลดข้อมูลล่าสุดก่อนลองอีกครั้ง'});
  }
});

module.exports = router;
