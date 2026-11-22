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

router.use('/lot-adjustments',require('./stock-lot-adjustments'));

// Read stock only from dbWMS. Product and unit master data remain in dbMaster.
// Aggregate before joining products so multiple locations never duplicate totals.
const balanceQuery = `
  WITH LocationStock AS (
    SELECT ProductId, LocationCode, CASE WHEN EXISTS(SELECT 1 FROM dbMaster.dbo.Locations l WHERE l.whid=tblStock.whid AND l.LocationCode=tblStock.LocationCode AND UPPER(l.Zone)='DAMAGE') THEN 1 ELSE 0 END IsDamage, SUM(Quantity) AS Quantity, MAX(UpdatedAt) AS LastUpdated
    FROM [dbWMS].[dbo].[tblStock]
    WHERE /*WAREHOUSE_SCOPE*/
    GROUP BY ProductId, whid, LocationCode
  ), StockBalance AS (
    SELECT ProductId, SUM(Quantity) AS TotalStock, SUM(CASE WHEN IsDamage=1 THEN Quantity ELSE 0 END) DamageStock, MAX(LastUpdated) AS LastUpdated,
      CAST(N'' AS NVARCHAR(1)) AS LocationDetails
    FROM LocationStock
    GROUP BY ProductId
  )
  , TransitBalance AS (SELECT ProductId,SUM(QuantityBase) AS TransitStock FROM dbWMS.dbo.RMSubTransfers WHERE Status='SENT' AND (/*TRANSIT_SCOPE*/) GROUP BY ProductId)
  SELECT p.ProductId, p.ProductCode, p.ProductCode AS ItemCode,
    p.ProductName, p.ProductName AS ItemName, p.ThaiName, p.Barcode,
    p.CategoryId, p.IsActive, p.MinStock, p.MaxStock,
    COALESCE(u.UnitCode, p.PackageType, N'') AS UOM,
    COALESCE(s.TotalStock, 0) AS TotalStock, COALESCE(s.DamageStock,0) DamageStock, COALESCE(s.TotalStock,0)-COALESCE(s.DamageStock,0) UsableStock, COALESCE(t.TransitStock,0) AS TransitStock, COALESCE(s.TotalStock,0)+COALESCE(t.TransitStock,0) AS OwnedStock,
    COALESCE(s.LocationDetails, N'') AS LocationDetails, s.LastUpdated
  FROM [dbMaster].[dbo].[tblProducts] p
  LEFT JOIN [dbMaster].[dbo].[tblUnits] u ON u.UnitId = p.UnitId
  LEFT JOIN StockBalance s ON s.ProductId = p.ProductId
  LEFT JOIN TransitBalance t ON t.ProductId=p.ProductId
`;

router.get('/balance', async (req, res) => {
  const roles = ['ADMIN','USER'];
  if (!roles.includes(String(req.user.role || '').toUpperCase())) {
    return res.status(403).json({ success: false, message: 'ไม่มีสิทธิ์ดูรายงานสต๊อก' });
  }
  try {
    const pool = await poolPromise;
    const compact=req.query.compact==='1';
    const scope=require('../middleware/warehouse-scope');
    let productIds=null,productIdClause='';
    if(req.query.productIds!==undefined){
      const raw=String(req.query.productIds).split(',');
      if(!compact||!raw.length||raw.length>100||raw.some(value=>!/^\d{1,10}$/.test(value)||Number(value)<=0||Number(value)>2147483647))return res.status(400).json({success:false,message:'ระบุรหัสสินค้า 1–100 รายการสำหรับยอดแบบย่อ'});
      productIds=[...new Set(raw.map(Number))];
      if(productIds.length>100)return res.status(400).json({success:false,message:'ระบุรหัสสินค้าไม่เกิน 100 รายการ'});
      productIdClause='ProductId IN ('+productIds.map((_,index)=>'@StockProductId'+index).join(',')+')';
    }
    const stockIdFilter=productIdClause?' AND '+productIdClause:'';
    let query=balanceQuery.replace('WHERE /*WAREHOUSE_SCOPE*/','WHERE '+scope.predicate(req,'whid')+stockIdFilter).replace('/*TRANSIT_SCOPE*/',scope.predicate(req,'SourceWhId')+' OR '+scope.predicate(req,'DestinationWhId'));
    if(productIdClause){query=query.replace('GROUP BY ProductId)',stockIdFilter+' GROUP BY ProductId)').replace(/\s*$/, '')+' WHERE p.'+productIdClause+' ';}
    // Keep the location text out of the aggregate/product join. STRING_AGG over
    // NVARCHAR(MAX) can require a large sort memory grant even for small stock tables.
    const detailsQuery=compact?'':`;
      SELECT ProductId, LocationCode,
        CONCAT(LocationCode, N' (', SUM(Quantity), N')') AS Detail
      FROM dbWMS.dbo.tblStock
      WHERE ${scope.predicate(req,'whid')}${stockIdFilter}
      GROUP BY ProductId, whid, LocationCode
      ORDER BY ProductId, LocationCode`;
    const startedAt=Date.now();
    const label='GET /stock/balance compact='+Number(compact);
    // Capture before mssql cancels the timed-out request, while its wait is visible.
    const diagnosticTimer=setTimeout(()=>require('../services/sql-timeout-diagnostics')(poolPromise,label+' (still running after 5s)',{code:'ETIMEOUT'}),5000);
    diagnosticTimer.unref();
    let result;
    try{
      const request=pool.request();if(productIds)productIds.forEach((id,index)=>request.input('StockProductId'+index,sql.Int,id));
      result=await request.query(query+detailsQuery);
    }catch(error){
      console.warn('Stock balance request context',JSON.stringify({requestNo:req.apiRequestNo,activeAtStart:req.apiActiveAtStart,compact,elapsedMs:Date.now()-startedAt,code:error.code,root:require('path').resolve(__dirname,'../..')}));
      throw error;
    }finally{clearTimeout(diagnosticTimer);}
    if(!compact){
      const details=new Map();
      for(const row of result.recordsets[1]){
        if(!details.has(row.ProductId))details.set(row.ProductId,[]);
        details.get(row.ProductId).push(row.Detail);
      }
      for(const row of result.recordset)row.LocationDetails=(details.get(row.ProductId)||[]).join(', ');
    }
    // Sort product labels after loading the numeric balances.
    if(!compact)result.recordset.sort((a,b)=>String(a.ProductCode||'').localeCompare(String(b.ProductCode||''),'en',{sensitivity:'base'})||a.ProductId-b.ProductId);
    res.set('Cache-Control', 'no-store');
    const visible=req.navigation?.user.Role==='ADMIN'||req.navigation?.profile.DESKTOP.includes('STOCK')?result.recordset:require('../middleware/product-scope').filter(req,result.recordset);
    const fields=['ProductId','CategoryId','TotalStock','DamageStock','UsableStock','TransitStock','OwnedStock','UOM','MinStock'];
    res.json({success:true,data:compact?visible.map(row=>Object.fromEntries(fields.map(key=>[key,row[key]]))):visible});
  } catch (err) {
    console.error('Stock balance query failed:', err.code);
    require('../services/sql-timeout-diagnostics')(poolPromise,'GET /stock/balance',err);
    res.status(err.code==='ETIMEOUT'?503:500).json({ success: false, message: err.code==='ETIMEOUT'?'ฐานข้อมูลตอบช้าในการโหลดยอดสต๊อก กรุณากดรีเฟรชอีกครั้ง':'ไม่สามารถโหลดรายงานสต๊อกจากฐานข้อมูลได้' });
  }
});

router.get('/containers/:productId',async(req,res)=>{try{const id=Number(req.params.productId);if(!Number.isInteger(id)||id<=0||id>2147483647)return res.status(400).json({success:false,message:'รหัสสินค้าไม่ถูกต้อง'});const p=await poolPromise,product=(await p.request().input('P',sql.Int,id).query('SELECT p.ProductId,p.ProductCode,p.ProductName,p.CategoryId,u.UnitCode FROM dbMaster.dbo.tblProducts p LEFT JOIN dbMaster.dbo.tblUnits u ON u.UnitId=p.UnitId WHERE ProductId=@P')).recordset[0];const stockAllowed=req.navigation?.user.Role==='ADMIN'||require('../middleware/navigation').hasAction(req.navigation.profile,req.navigation.mode,'STOCK','VIEW');if(!product||!stockAllowed&&!require('../middleware/product-scope').can(req,product.CategoryId,'VIEW'))return res.status(403).json({success:false,message:'ไม่มีสิทธิ์ดูสต๊อกสินค้านี้'});const pred=require('../middleware/warehouse-scope').predicate(req,'c.WhId');const rows=(await p.request().input('P',sql.Int,id).query(`SELECT ${['summary','lots'].includes(req.query.detail)?'TOP (0) ':''}c.ContainerId,c.ContainerCode,c.WhId,w.whname,w.whdescription,c.LocationCode,c.Status,c.LotNo,c.CapacityBase,c.RemainingBase,c.ExpiryDate,COALESCE(r.ReceivedAt,c.CreatedAt) ReceivedAt,o.ReferenceNo PONo,o.ReceiveNo,o.SupplierName,COALESCE(rp.PackUnit,s.PackUnit,N'ภาชนะ') PackUnit,CASE WHEN o.InboundId IS NULL THEN 1 ELSE 0 END LegacyRegistration FROM dbWMS.dbo.RMContainers c LEFT JOIN dbMaster.dbo.tblWH w ON w.whid=c.WhId LEFT JOIN dbWMS.dbo.InboundReceipts r ON r.ReceiptId=c.InboundReceiptId LEFT JOIN dbWMS.dbo.InboundLines l ON l.LineId=r.LineId LEFT JOIN dbWMS.dbo.InboundOrders o ON o.InboundId=l.InboundId LEFT JOIN dbWMS.dbo.RMInboundPacks rp ON rp.LineId=l.LineId LEFT JOIN dbMaster.dbo.tblRMPackSpecs s ON s.ProductId=c.ProductId WHERE c.ProductId=@P AND c.RemainingBase>0 AND (`+pred+`) ORDER BY COALESCE(r.ReceivedAt,c.CreatedAt),c.ContainerId;SELECT c.whid,w.whname,w.whdescription,c.LocationCode,(SELECT MAX(l.Description) FROM dbMaster.dbo.Locations l WHERE l.whid=c.whid AND l.LocationCode=c.LocationCode) AS LocationDescription,CASE WHEN EXISTS(SELECT 1 FROM dbMaster.dbo.Locations l WHERE l.whid=c.whid AND l.LocationCode=c.LocationCode AND UPPER(l.Zone)='DAMAGE') THEN 1 ELSE 0 END IsDamage,SUM(c.Quantity) Quantity FROM dbWMS.dbo.tblStock c LEFT JOIN dbMaster.dbo.tblWH w ON w.whid=c.whid WHERE c.ProductId=@P AND (`+require('../middleware/warehouse-scope').predicate(req,'c.whid')+`) GROUP BY c.whid,w.whname,w.whdescription,c.LocationCode ORDER BY w.whname,c.LocationCode;`)).recordsets;const packings=(await p.request().input('P',sql.Int,id).query(`SELECT v.PackVersionId,v.VersionNo,v.IsActive,v.PackUnit,v.UnitsPerPack,v.StockUnitLabel,v.NetVolumeMlPerUnit,v.NetWeightGramsPerUnit,v.OuterPackUnit,v.PacksPerOuter FROM dbMaster.dbo.tblProductPackVersions v JOIN dbMaster.dbo.tblProducts p ON p.ProductId=v.ProductId AND p.UnitId=v.StockUnitId WHERE v.ProductId=@P ORDER BY v.VersionNo DESC`)).recordset;const activePackings=packings.filter(v=>v.IsActive);const packing=activePackings.length===1?activePackings[0]:null;res.set('Cache-Control','no-store');const lots=['summary','containers'].includes(req.query.detail)?[]:await require('../services/stock-lot-details').load(p,sql,id,rows[1]);res.json({success:true,product,packing,packings,containers:rows[0],stock:rows[1],lots,canAdjustLots:String(req.user.role).toUpperCase()==='ADMIN'})}catch(e){res.status(500).json({success:false,message:'โหลดรายละเอียดกล่องไม่สำเร็จ'})}});
router.get('/lookup', async (req, res) => {
  const code = String(req.query.code || req.query.barcode || '').trim();
  if (!code || code.length > 100) return res.status(400).json({ success: false, message: 'กรุณาระบุรหัสสินค้าหรือบาร์โค้ดไม่เกิน 100 ตัวอักษร' });
  try {
    const pool = await poolPromise;
    const result = await pool.request().input('Code', sql.NVarChar(100), code)
      .query(balanceQuery.replace('/*WAREHOUSE_SCOPE*/',require('../middleware/warehouse-scope').predicate(req,'whid')).replace('/*TRANSIT_SCOPE*/',require('../middleware/warehouse-scope').predicate(req,'SourceWhId')+' OR '+require('../middleware/warehouse-scope').predicate(req,'DestinationWhId')) + ' WHERE p.ProductCode = @Code OR p.Barcode = @Code ORDER BY p.ProductId');
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
      uom: product.UOM, totalQuantity: product.TotalStock, damageQuantity:product.DamageStock, usableQuantity:product.UsableStock, transitQuantity:product.TransitStock, ownedQuantity:product.OwnedStock, locations: locations.recordset
    } });
  } catch (err) {
    console.error('Stock lookup query failed:', err.code);
    res.status(500).json({ success: false, message: 'ไม่สามารถค้นหาสต๊อกจากฐานข้อมูลได้' });
  }
});


async function requireStockAdmin(req, res, next) {
  if (String(req.user.role || '').toUpperCase() === 'ADMIN') return next();
  const productId = Number(req.params.productId ?? req.body?.productId);
  if (!Number.isInteger(productId) || productId <= 0 || productId > 2147483647) return res.status(400).json({ success: false, message: 'รหัสสินค้าไม่ถูกต้อง' });
  try {
    const pool = await poolPromise;
    const product = (await pool.request().input('ProductId', sql.Int, productId)
      .query('SELECT CategoryId FROM dbMaster.dbo.tblProducts WHERE ProductId=@ProductId')).recordset[0];
    if (!product) return res.status(404).json({ success: false, message: 'ไม่พบสินค้า' });
    if (!require('../middleware/product-scope').can(req, product.CategoryId, 'CONFIRM')) return res.status(403).json({ success: false, message: 'ไม่มีสิทธิ์ปรับยอดสต๊อกสินค้ากลุ่มนี้' });
    next();
  } catch (err) {
    console.error('Stock adjustment permission failed:', err.code);
    res.status(500).json({ success: false, message: 'ตรวจสิทธิ์ปรับยอดสต๊อกไม่สำเร็จ' });
  }
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
      SELECT whid,whname,whdescription FROM dbMaster.dbo.tblWH ORDER BY whid;
      SELECT whid,LocationCode FROM dbMaster.dbo.Locations WHERE IsActive=1 ORDER BY whid,LocationCode;
      SELECT whid,LocationCode,Quantity FROM dbWMS.dbo.tblStock WHERE ProductId=@ProductId;
      SELECT v.PackVersionId,v.VersionNo,v.IsActive,v.PackUnit,v.UnitsPerPack,v.InnerPackUnit,v.UnitsPerInnerPack,v.OuterPackUnit,v.PacksPerOuter,u.UnitCode FROM dbMaster.dbo.tblProductPackVersions v JOIN dbMaster.dbo.tblUnits u ON u.UnitId=v.StockUnitId WHERE v.ProductId=@ProductId ORDER BY v.VersionNo DESC;
    `);
    if (!result.recordsets[0].length) return res.status(404).json({success:false,message:'ไม่พบสินค้า'});
    const lots=await require('../services/stock-lot-details').load(pool,sql,id,result.recordsets[3]);
    res.set('Cache-Control','no-store').json({success:true,product:result.recordsets[0][0],warehouses:result.recordsets[1],locations:result.recordsets[2],stock:result.recordsets[3],packVersions:result.recordsets[4],lots});
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
    await new sql.Request(transaction).input('Wh',sql.Int,whid).query('SELECT whid FROM dbMaster.dbo.tblWH WITH(UPDLOCK,HOLDLOCK) WHERE whid=@Wh');
    if(Number(quantity)!==Number(expectedQuantity)&&(await new sql.Request(transaction).input('Wh',sql.Int,whid).input('P',sql.Int,productId).input('Loc',sql.NVarChar(50),locationCode).query('SELECT TOP 1 ContainerId FROM dbWMS.dbo.RMContainers WITH(UPDLOCK,HOLDLOCK) WHERE WhId=@Wh AND ProductId=@P AND LocationCode=@Loc AND RemainingBase>0')).recordset.length)throw Object.assign(Error('RM นี้ควบคุมระดับภาชนะ ไม่สามารถปรับยอดรวมแยกจากยอดภาชนะ'),{status:409});
    const damage=(await new sql.Request(transaction).input('W',sql.Int,whid).input('L',sql.NVarChar(50),locationCode.trim()).query("SELECT Zone FROM dbMaster.dbo.Locations WHERE whid=@W AND LocationCode=@L")).recordset[0];
    if(String(damage?.Zone).toUpperCase()==='DAMAGE'&&!require('../services/damage-locations').isAdmin(req))throw Object.assign(Error('เฉพาะ ADMIN ปรับยอดสินค้า DAMAGE ได้'),{status:403});
    await require('../services/damage-locations').authorize(()=>new sql.Request(transaction),req);
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
    if(err.number===51070)err.status=403;
    if(err.status) return res.status(err.status).json({success:false,message:err.message});
    const number = err.number || err.originalError?.info?.number;
    if ([50001,50002,50003,50004].includes(number)) return res.status(number===50004?409:400).json({success:false,message:err.message});
    console.error('Stock adjustment failed:',err.code);
    res.status(500).json({success:false,message:'บันทึกปรับยอดไม่สำเร็จ กรุณาโหลดข้อมูลล่าสุดก่อนลองอีกครั้ง'});
  }
});

// Set the counted quantity for one identified LOT in a packaging unit.
router.post('/adjust-package', requireStockAdmin, async (req,res)=>{
  const b=req.body||{},validQty=value=>(typeof value==='number'||typeof value==='string')&&/^\d{1,12}(?:\.\d{1,6})?$/.test(String(value))&&Number(value)>=0;
  if(!Number.isInteger(b.productId)||b.productId<=0||!Number.isInteger(b.whid)||b.whid<=0||typeof b.locationCode!=='string'||!b.locationCode.trim()||b.locationCode.length>50||!Number.isInteger(b.packVersionId)||b.packVersionId<=0||typeof b.lotNo!=='string'||!b.lotNo.trim()||b.lotNo.length>100||b.anaNo!=null&&(typeof b.anaNo!=='string'||b.anaNo.length>100)||!validQty(b.quantity)||!validQty(b.expectedTotalQuantity)||!validQty(b.expectedLotQuantity)||typeof b.inputUnit!=='string'||!b.inputUnit.trim()||typeof b.remark!=='string'||!b.remark.trim()||b.remark.length>255){return res.status(400).json({success:false,message:'ระบุคลัง ตำแหน่ง LOT Version หน่วย จำนวน และเหตุผลให้ครบ'});}
  let tx;
  try{
    const pool=await poolPromise;tx=new sql.Transaction(pool);await tx.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
    const q=()=>new sql.Request(tx);await q().input('Wh',sql.Int,b.whid).query('SELECT whid FROM dbMaster.dbo.tblWH WITH(UPDLOCK,HOLDLOCK) WHERE whid=@Wh');
    await require('../services/damage-locations').authorize(q,req);
    const location=(await q().input('W',sql.Int,b.whid).input('L',sql.NVarChar(50),b.locationCode.trim()).query('SELECT Zone FROM dbMaster.dbo.Locations WITH(UPDLOCK,HOLDLOCK) WHERE whid=@W AND LocationCode=@L AND IsActive=1')).recordset[0];if(!location)throw Object.assign(Error('โลเคชั่นไม่อยู่ในคลังหรือถูกปิดใช้งาน'),{status:400});
    if(String(location.Zone).toUpperCase()==='DAMAGE'&&!require('../services/damage-locations').isAdmin(req))throw Object.assign(Error('เฉพาะ ADMIN ปรับยอดสินค้า DAMAGE ได้'),{status:403});
    const product=(await q().input('P',sql.Int,b.productId).query('SELECT p.Barcode,p.UnitId,u.UnitCode FROM dbMaster.dbo.tblProducts p JOIN dbMaster.dbo.tblUnits u ON u.UnitId=p.UnitId WHERE p.ProductId=@P AND p.IsActive=1')).recordset[0];if(!product)throw Object.assign(Error('ไม่พบสินค้าหรือสินค้าถูกปิดใช้งาน'),{status:400});
    const version=(await q().input('P',sql.Int,b.productId).input('V',sql.Int,b.packVersionId).query('SELECT v.*,u.UnitCode FROM dbMaster.dbo.tblProductPackVersions v WITH(UPDLOCK,HOLDLOCK) JOIN dbMaster.dbo.tblUnits u ON u.UnitId=v.StockUnitId WHERE v.ProductId=@P AND v.PackVersionId=@V AND v.IsDeleted=0 AND v.StockUnitId='+Number(product.UnitId))).recordset[0];if(!version)throw Object.assign(Error('Version ไม่ตรงกับสินค้าและหน่วยฐาน'),{status:400});
    const stock=(await q().input('P',sql.Int,b.productId).input('W',sql.Int,b.whid).input('L',sql.NVarChar(50),b.locationCode.trim()).query('SELECT Quantity FROM dbWMS.dbo.tblStock WITH(UPDLOCK,HOLDLOCK) WHERE ProductId=@P AND whid=@W AND LocationCode=@L')).recordset[0],total=Number(stock?.Quantity||0);if(Math.round(total*100)!==Math.round(Number(b.expectedTotalQuantity)*100))throw Object.assign(Error('ยอดตำแหน่งเปลี่ยนแล้ว กรุณาโหลดข้อมูลใหม่'),{status:409});
    const stockRows=(await q().input('P',sql.Int,b.productId).query('SELECT whid,LocationCode,Quantity FROM dbWMS.dbo.tblStock WHERE ProductId=@P')).recordset;
    const lots=await require('../services/stock-lot-details').load(pool,sql,b.productId,stockRows,()=>new sql.Request(tx));
    const ana=b.anaNo?.trim()||null,lot=b.lotNo.trim(),same=lots.filter(x=>Number(x.whid)===b.whid&&x.LocationCode===b.locationCode.trim()&&(x.AnaNo||null)===ana&&x.LotNo===lot),otherVersion=same.find(x=>Number(x.PackVersionId||0)!==b.packVersionId);if(otherVersion)throw Object.assign(Error('ANA / LOT นี้ถูกผูกกับ Version อื่นแล้ว'),{status:409});
    const oldLot=Number(same.reduce((n,x)=>n+Number(x.Quantity),0).toFixed(2));if(Math.round(oldLot*100)!==Math.round(Number(b.expectedLotQuantity)*100))throw Object.assign(Error('ยอดของ LOT เปลี่ยนแล้ว กรุณาโหลดข้อมูลใหม่'),{status:409});if(oldLot===0&&!version.IsActive)throw Object.assign(Error('Version นี้ปิดใช้แล้ว จึงใช้สร้างรายการ LOT ใหม่ไม่ได้'),{status:409});
    const conversion=require('../services/product-pack-version-policy').calculateBaseQuantity(b.quantity,b.inputUnit,version,product.UnitCode),base=Number(conversion.baseQuantity.toFixed(6));if(Math.abs(base-Math.round(base*100)/100)>0.000001)throw Object.assign(Error('หน่วยฐานสต๊อกและเอกสารรองรับทศนิยม 2 ตำแหน่งเท่านั้น ผลคำนวณ LOT นี้ละเอียดเกินไป'),{status:400});
    const nextTotal=Number((total-oldLot+base).toFixed(2));if(nextTotal<0||nextTotal>999999999999)throw Object.assign(Error('ยอดคำนวณ LOT ไม่ถูกต้อง'),{status:400});const delta=Number((base-oldLot).toFixed(2));if(delta===0){await tx.commit();return res.json({success:true,changed:false,oldQuantity:total,newQuantity:total,lotQuantity:oldLot});}
    const result=await q().input('P',sql.Int,b.productId).input('W',sql.Int,b.whid).input('L',sql.NVarChar(50),b.locationCode.trim()).input('Barcode',sql.NVarChar(50),product.Barcode).input('Expected',sql.Decimal(18,2),total).input('NewTotal',sql.Decimal(18,2),nextTotal).input('Delta',sql.Decimal(18,2),delta).input('Version',sql.Int,b.packVersionId).input('InputQty',sql.Decimal(18,6),conversion.inputQuantity).input('InputUnit',sql.NVarChar(30),conversion.inputUnit).input('Factor',sql.Decimal(18,6),conversion.unitsPerInput).input('BaseQty',sql.Decimal(18,6),base).input('Calculation',sql.NVarChar(1000),conversion.calculation).input('Ana',sql.NVarChar(100),ana).input('Lot',sql.NVarChar(100),lot).input('Ref',sql.NVarChar(60),b.referenceNo?.trim()||null).input('Remark',sql.NVarChar(255),b.remark.trim()).input('By',sql.NVarChar(50),String(req.user.username||req.user.id||'ADMIN').slice(0,50)).query(`DECLARE @Old decimal(18,2),@StockId int;IF NOT EXISTS(SELECT 1 FROM dbMaster.dbo.tblProducts WHERE ProductId=@P AND IsActive=1) THROW 50001,N'ไม่พบสินค้าหรือสินค้าถูกปิดใช้งาน',1;SELECT @StockId=StockId,@Old=Quantity FROM dbWMS.dbo.tblStock WITH(UPDLOCK,HOLDLOCK) WHERE ProductId=@P AND whid=@W AND LocationCode=@L;SET @Old=COALESCE(@Old,0);IF @Old<>@Expected THROW 50004,N'ยอดสต๊อกเปลี่ยนแล้ว กรุณาโหลดข้อมูลล่าสุดก่อนปรับยอดอีกครั้ง',1;IF @StockId IS NULL INSERT dbWMS.dbo.tblStock(whid,ProductId,Barcode,LocationCode,Quantity,CreatedAt,UpdatedAt) VALUES(@W,@P,@Barcode,@L,@NewTotal,SYSDATETIME(),SYSDATETIME());ELSE UPDATE dbWMS.dbo.tblStock SET Quantity=@NewTotal,Barcode=@Barcode,UpdatedAt=SYSDATETIME() WHERE StockId=@StockId;INSERT dbWMS.dbo.tblStockTransactions(TransType,whid,ProductId,Barcode,LocationCode,QtyChange,QtyAfter,RefDocNo,Remark,CreatedBy,CreatedAt,PackVersionId,AdjustmentInputQuantity,AdjustmentInputUnit,AdjustmentUnitsPerInput,AdjustmentBaseQuantity,AdjustmentCalculation,AdjustmentAnaNo,AdjustmentLotNo) VALUES(N'ADJUST',@W,@P,@Barcode,@L,@Delta,@NewTotal,@Ref,@Remark,@By,SYSDATETIME(),@Version,@InputQty,@InputUnit,@Factor,@BaseQty,@Calculation,@Ana,@Lot);SELECT @Old oldQuantity,@NewTotal newQuantity,@Delta change,CAST(1 AS bit) changed;`);
    await tx.commit();res.json({success:true,...result.recordset[0],lotQuantity:base,conversion});
  }catch(e){if(tx)try{await tx.rollback()}catch{}if(e.status)return res.status(e.status).json({success:false,message:e.message});if(e.number===51070)return res.status(403).json({success:false,message:e.message});console.error('Pack LOT adjustment:',e.code||e.number);res.status(500).json({success:false,message:'บันทึกปรับยอดตาม Version ไม่สำเร็จ กรุณาตรวจ migration และโหลดข้อมูลใหม่'});}
});

module.exports = router;
