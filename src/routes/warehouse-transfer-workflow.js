const express=require('express'),{poolPromise,sql}=require('../config/db'),shipping=require('./delivery-types'),scope=require('../middleware/warehouse-scope'),nav=require('../middleware/navigation');
const router=express.Router(),fail=(status,message)=>{throw Object.assign(Error(message),{status})};
function error(res,e){
 const conflict=[51070,51071,51072,51000].includes(e.number);
 if(!e.status&&!conflict)console.error('[WAREHOUSE TRANSFER WORKFLOW ERROR]',JSON.stringify({code:e.code,number:e.number,message:e.message}));
 const message=e.status||conflict?e.message:e.number===208?'ตารางบริการใบโอนยังไม่ครบ กรุณาติดตั้ง WarehouseTransferWorkflow.sql':e.number===207?'โครงสร้างฐานข้อมูลบริการใบโอนไม่ตรงรุ่น กรุณาตรวจสอบ WarehouseTransferWorkflow.sql':'โหลดบริการใบโอนไม่สำเร็จ กรุณาตรวจสอบ log เซิร์ฟเวอร์';
 res.status(e.status||(conflict?409:500)).json({success:false,message});
}
router.get('/bootstrap',async(req,res)=>{try{const category=String(req.query.category||'').toUpperCase(),whid=String(req.query.whid||''),includeStock=req.query.includeStock==='1';if(!['RM','PKG','SEMI','FG'].includes(category)||!shipping.can(req,category))fail(403,'ไม่มีสิทธิ์ดูสต๊อกกลุ่มนี้');if(whid&&(!/^\d+$/.test(whid)||Number(whid)<1||!scope.has(req,whid)))fail(403,'ไม่มีสิทธิ์ใช้คลังที่เลือก');const p=await poolPromise,q=p.request(),whScope=scope.predicate(req,'whid');let warehouses=(await q.query(`SELECT whid,whname,whdescription FROM dbMaster.dbo.tblWH WHERE ${whScope} ORDER BY whid`)).recordset,stock=[];if(includeStock&&whid){const r=await p.request().input('Wh',sql.Int,Number(whid)).input('Category',sql.VarChar(4),category).query(`SELECT s.whid,s.ProductId,s.LocationCode,s.Quantity,c.CategoryCode,l.Zone,p.AllowClinicDelivery,p.ProductCode,p.ProductName,p.Barcode,COALESCE(u.UnitCode,p.PackageType,N'') AS UOM,COALESCE((SELECT SUM(dl.Quantity) FROM dbWMS.dbo.DeliveryOrders dh JOIN dbWMS.dbo.DeliveryLines dl ON dl.DeliveryId=dh.DeliveryId WHERE dh.Status='DRAFT' AND dh.WhId=s.whid AND dl.ProductId=s.ProductId AND dl.LocationCode=s.LocationCode),0)+COALESCE((SELECT SUM(pl.Quantity-pl.MovedQuantity) FROM dbWMS.dbo.StoragePlans ph JOIN dbWMS.dbo.StoragePlanLines pl ON pl.PlanId=ph.PlanId WHERE ph.Status='OPEN' AND ph.WhId=s.whid AND ph.ProductId=s.ProductId AND ph.FromLocationCode=s.LocationCode),0) AS ReservedQuantity FROM dbWMS.dbo.tblStock s JOIN dbMaster.dbo.Locations l ON l.whid=s.whid AND l.LocationCode=s.LocationCode AND l.IsActive=1 AND UPPER(l.Zone) IN('A','B','STORAGE','OUT') JOIN dbMaster.dbo.tblProducts p ON p.ProductId=s.ProductId AND p.IsActive=1 JOIN dbMaster.dbo.tblCategories c ON c.CategoryID=p.CategoryId AND c.CategoryCode=@Category LEFT JOIN dbMaster.dbo.tblUnits u ON u.UnitId=p.UnitId WHERE s.whid=@Wh AND s.Quantity>0`).then(x=>x.recordset);stock=r.filter(s=>shipping.can(req,s.CategoryCode)).map(s=>({...s,AvailableQuantity:Math.max(0,s.Quantity-s.ReservedQuantity)}));}res.set('Cache-Control','no-store').json({success:true,warehouses,stock,orders:[]});}catch(e){error(res,e)}});
router.get('/lot-availability',async(req,res)=>{try{
 const category=String(req.query.category||'').toUpperCase(),whid=Number(req.query.whid),productId=Number(req.query.productId),locationCode=String(req.query.locationCode||'').trim();
 if(!['RM','PKG','SEMI','FG'].includes(category)||!shipping.can(req,category)||!Number.isInteger(whid)||whid<1||!scope.has(req,whid)||!Number.isInteger(productId)||productId<1||!locationCode||locationCode.length>50)fail(400,'เลือกกลุ่มสินค้า คลัง SKU และตำแหน่งให้ถูกต้อง');
 const p=await poolPromise,product=(await p.request().input('P',sql.Int,productId).input('C',sql.VarChar(4),category).query('SELECT p.ProductId FROM dbMaster.dbo.tblProducts p JOIN dbMaster.dbo.tblCategories c ON c.CategoryID=p.CategoryId WHERE p.ProductId=@P AND c.CategoryCode=@C AND p.IsActive=1')).recordset[0];
 if(!product)fail(404,'ไม่พบสินค้าในกลุ่มที่เลือก');
 const data=await require('../services/warehouse-transfer-lots').availability({whid,productId,locationCode});
 res.set('Cache-Control','no-store').json(data);
 }catch(e){error(res,e)}});
router.get('/',async(req,res)=>{
 try{
  const category=String(req.query.category||'').toUpperCase();
  if(!['RM','PKG','SEMI','FG'].includes(category)||!shipping.can(req,category))fail(403,'ไม่มีสิทธิ์ดูใบโอนกลุ่มนี้');
  const tab=String(req.query.tab||'today').toLowerCase();if(!['today','pending','history'].includes(tab))fail(400,'แท็บใบโอนไม่ถูกต้อง');
  const warehouseValue=String(req.query.whid||'').trim();if(warehouseValue&&(!/^\d+$/.test(warehouseValue)||Number(warehouseValue)<1||Number(warehouseValue)>2147483647||!scope.has(req,warehouseValue)))fail(403,'ไม่มีสิทธิ์ใช้คลังที่เลือก');
  const page=Math.max(1,Math.min(100000,Number.parseInt(req.query.page,10)||1)),pageSize=Math.max(1,Math.min(50,Number.parseInt(req.query.pageSize,10)||25)),search=String(req.query.search||'').trim().slice(0,100);
  const parseDate=(value,label)=>{if(!value)return null;if(!/^\d{4}-\d{2}-\d{2}$/.test(value))fail(400,`รูปแบบ${label}ไม่ถูกต้อง`);const parsed=new Date(`${value}T00:00:00.000Z`);if(Number.isNaN(parsed.getTime())||parsed.toISOString().slice(0,10)!==value)fail(400,`วันที่${label}ไม่ถูกต้อง`);return value;};
  const fromDate=parseDate(String(req.query.fromDate||''),'เริ่มต้น'),toDate=parseDate(String(req.query.toDate||''),'สิ้นสุด');if((fromDate&&!toDate)||(!fromDate&&toDate))fail(400,'กรุณาระบุวันที่เริ่มต้นและสิ้นสุดให้ครบ');if(fromDate&&toDate&&fromDate>toDate)fail(400,'วันที่เริ่มต้นต้องไม่อยู่หลังวันที่สิ้นสุด');
  const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Bangkok',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date()),part=t=>parts.find(x=>x.type===t).value,today=new Date(`${part('year')}-${part('month')}-${part('day')}T00:00:00.000Z`);
  const p=await poolPromise,sourceScope=scope.predicate(req,'h.WhId'),destinationScope=scope.predicate(req,'h.DestinationWhId'),scoped=`(${sourceScope} OR ${destinationScope})`;
  const q=p.request().input('Category',sql.VarChar(4),category).input('Warehouse',sql.Int,warehouseValue?Number(warehouseValue):null).input('Tab',sql.VarChar(10),tab).input('Search',sql.NVarChar(100),search||null).input('Today',sql.Date,today).input('FromDate',sql.Date,fromDate).input('ToDate',sql.Date,toDate).input('Offset',sql.Int,(page-1)*pageSize).input('PageSize',sql.Int,pageSize);
  const r=await q.query(`
DECLARE @PageIds TABLE(DeliveryId int PRIMARY KEY);
DECLARE @Total bigint;
SELECT
 COUNT_BIG(CASE WHEN h.CreatedAt>=CONVERT(datetime2,@Today) AND h.CreatedAt<DATEADD(day,1,CONVERT(datetime2,@Today)) THEN 1 END) AS TodayCount,
 COUNT_BIG(CASE WHEN h.Status IN('DRAFT','SENT') OR (h.Status='RECEIVED' AND COALESCE(receiptProgress.HasPendingPutaway,0)=1) THEN 1 END) AS PendingCount,
 COUNT_BIG(CASE WHEN h.Status='CANCELLED' OR (h.Status='RECEIVED' AND COALESCE(receiptProgress.HasPendingPutaway,0)=0) OR h.Status NOT IN('DRAFT','SENT','RECEIVED','CANCELLED') THEN 1 END) AS HistoryCount
FROM dbWMS.dbo.DeliveryOrders h
LEFT JOIN (SELECT DeliveryId,1 AS HasPendingPutaway FROM dbWMS.dbo.WarehouseTransferReceipts WHERE StoredQuantity<ReceivedQuantity GROUP BY DeliveryId) receiptProgress ON receiptProgress.DeliveryId=h.DeliveryId
WHERE h.DeliveryType='WAREHOUSE' AND h.CategoryCode=@Category AND ${scoped} AND (@Warehouse IS NULL OR h.WhId=@Warehouse OR h.DestinationWhId=@Warehouse);
SELECT @Total=COUNT_BIG(*) FROM dbWMS.dbo.DeliveryOrders h
WHERE h.DeliveryType='WAREHOUSE' AND h.CategoryCode=@Category AND ${scoped} AND (@Warehouse IS NULL OR h.WhId=@Warehouse OR h.DestinationWhId=@Warehouse)
 AND (@Search IS NULL OR h.DeliveryNo LIKE N'%'+@Search+N'%' OR h.DestinationName LIKE N'%'+@Search+N'%' OR h.PoNo LIKE N'%'+@Search+N'%' OR h.SoNo LIKE N'%'+@Search+N'%')
 AND (@Tab<>'history' OR ((@FromDate IS NULL OR h.CreatedAt>=CONVERT(datetime2,@FromDate)) AND (@ToDate IS NULL OR h.CreatedAt<DATEADD(day,1,CONVERT(datetime2,@ToDate)))))
 AND ((@Tab='today' AND h.CreatedAt>=CONVERT(datetime2,@Today) AND h.CreatedAt<DATEADD(day,1,CONVERT(datetime2,@Today)))
   OR (@Tab='pending' AND (h.Status IN('DRAFT','SENT') OR (h.Status='RECEIVED' AND EXISTS(SELECT 1 FROM dbWMS.dbo.WarehouseTransferReceipts r WHERE r.DeliveryId=h.DeliveryId AND r.StoredQuantity<r.ReceivedQuantity))))
   OR (@Tab='history' AND (h.Status='CANCELLED' OR (h.Status='RECEIVED' AND NOT EXISTS(SELECT 1 FROM dbWMS.dbo.WarehouseTransferReceipts r WHERE r.DeliveryId=h.DeliveryId AND r.StoredQuantity<r.ReceivedQuantity)) OR h.Status NOT IN('DRAFT','SENT','RECEIVED','CANCELLED'))));
SELECT @Total AS TotalCount,@Offset/@PageSize+1 AS Page,(@Total+@PageSize-1)/@PageSize AS PageCount;
INSERT INTO @PageIds(DeliveryId)
SELECT MatchingTransfers.DeliveryId FROM (
 SELECT h.DeliveryId,ROW_NUMBER() OVER(ORDER BY h.DeliveryId DESC) AS RowNo FROM dbWMS.dbo.DeliveryOrders h
WHERE h.DeliveryType='WAREHOUSE' AND h.CategoryCode=@Category AND ${scoped} AND (@Warehouse IS NULL OR h.WhId=@Warehouse OR h.DestinationWhId=@Warehouse)
 AND (@Search IS NULL OR h.DeliveryNo LIKE N'%'+@Search+N'%' OR h.DestinationName LIKE N'%'+@Search+N'%' OR h.PoNo LIKE N'%'+@Search+N'%' OR h.SoNo LIKE N'%'+@Search+N'%')
 AND (@Tab<>'history' OR ((@FromDate IS NULL OR h.CreatedAt>=CONVERT(datetime2,@FromDate)) AND (@ToDate IS NULL OR h.CreatedAt<DATEADD(day,1,CONVERT(datetime2,@ToDate)))))
 AND ((@Tab='today' AND h.CreatedAt>=CONVERT(datetime2,@Today) AND h.CreatedAt<DATEADD(day,1,CONVERT(datetime2,@Today)))
   OR (@Tab='pending' AND (h.Status IN('DRAFT','SENT') OR (h.Status='RECEIVED' AND EXISTS(SELECT 1 FROM dbWMS.dbo.WarehouseTransferReceipts r WHERE r.DeliveryId=h.DeliveryId AND r.StoredQuantity<r.ReceivedQuantity))))
   OR (@Tab='history' AND (h.Status='CANCELLED' OR (h.Status='RECEIVED' AND NOT EXISTS(SELECT 1 FROM dbWMS.dbo.WarehouseTransferReceipts r WHERE r.DeliveryId=h.DeliveryId AND r.StoredQuantity<r.ReceivedQuantity)) OR h.Status NOT IN('DRAFT','SENT','RECEIVED','CANCELLED')))
 )) AS MatchingTransfers WHERE RowNo>@Offset AND RowNo<=@Offset+@PageSize;
SELECT @Total AS TotalCount,@Offset/@PageSize+1 AS Page,CASE WHEN @Total=0 THEN 1 ELSE (@Total+@PageSize-1)/@PageSize END AS PageCount;
SELECT h.DeliveryId,h.DeliveryNo,h.DeliveryDate,h.CreatedAt,h.DestinationName,h.BranchName,h.PoNo,h.SoNo,h.Ownership,h.DeliveryType,h.CategoryCode,h.Status,h.Prepared,h.WhId,h.DestinationWhId,
 a.whname AS SourceCode,a.whdescription AS SourceName,b.whname AS DestinationCode,b.whdescription AS DestinationDescription,
 CASE WHEN h.Status='CANCELLED' THEN 'CANCELLED' WHEN h.Status='DRAFT' AND h.Prepared=0 THEN 'RESERVED' WHEN h.Status='DRAFT' THEN 'READY' WHEN h.Status='SENT' THEN 'IN_TRANSIT' WHEN h.Status='RECEIVED' AND NOT EXISTS(SELECT 1 FROM dbWMS.dbo.WarehouseTransferReceipts r WHERE r.DeliveryId=h.DeliveryId) THEN 'LEGACY_RECEIVED' WHEN h.Status='RECEIVED' AND EXISTS(SELECT 1 FROM dbWMS.dbo.WarehouseTransferReceipts r WHERE r.DeliveryId=h.DeliveryId AND r.StoredQuantity<r.ReceivedQuantity) THEN 'WAIT_STORAGE' ELSE 'COMPLETED' END AS WorkflowStatus
FROM @PageIds x JOIN dbWMS.dbo.DeliveryOrders h ON h.DeliveryId=x.DeliveryId JOIN dbMaster.dbo.tblWH a ON a.whid=h.WhId JOIN dbMaster.dbo.tblWH b ON b.whid=h.DestinationWhId ORDER BY h.DeliveryId DESC;
SELECT r.LineId,r.DeliveryId,r.WhId,r.ProductId,r.LocationCode,
 COALESCE(a.Quantity,r.ReceivedQuantity) ReceivedQuantity,COALESCE(a.StoredQuantity,r.StoredQuantity) StoredQuantity,
 a.AllocationId,a.AnaNo,a.LotNo,a.IsUnattributed,l.ProductCode,l.ProductName,l.UOM
FROM dbWMS.dbo.WarehouseTransferReceipts r JOIN dbWMS.dbo.DeliveryLines l ON l.LineId=r.LineId
LEFT JOIN dbWMS.dbo.WarehouseTransferLotAllocations a ON a.LineId=r.LineId
JOIN @PageIds x ON x.DeliveryId=r.DeliveryId
WHERE (a.AllocationId IS NULL AND r.StoredQuantity<r.ReceivedQuantity) OR (a.AllocationId IS NOT NULL AND a.StoredQuantity<a.Quantity);
SELECT DISTINCT l.whid,l.LocationCode,l.Zone,l.Description FROM dbMaster.dbo.Locations l WHERE l.IsActive=1 AND UPPER(l.Zone) IN('A','B','STORAGE') AND ${scope.predicate(req,'l.whid')} AND EXISTS(SELECT 1 FROM dbWMS.dbo.WarehouseTransferReceipts r JOIN @PageIds x ON x.DeliveryId=r.DeliveryId WHERE r.WhId=l.whid AND r.StoredQuantity<r.ReceivedQuantity);
`);
  const orders=r.recordsets[3]||[],receipts=r.recordsets[4]||[],locations=r.recordsets[5]||[];
  res.set('Cache-Control','no-store').json({success:true,counts:r.recordsets[0]?.[0]||{TodayCount:0,PendingCount:0,HistoryCount:0},pagination:r.recordsets[2]?.[0]||{TotalCount:0,Page:page,PageCount:1},orders:orders.map(o=>({...o,canEdit:scope.has(req,o.WhId)&&shipping.can(req,o.CategoryCode,'EDIT'),canStore:scope.has(req,o.DestinationWhId)&&shipping.can(req,o.CategoryCode,'CONFIRM')&&(req.navigation?.user.Role==='ADMIN'||nav.hasAction(req.navigation.profile,req.navigation.mode,'PUTAWAY_'+o.CategoryCode,'CONFIRM')),canSend:scope.has(req,o.WhId)&&shipping.can(req,o.CategoryCode,'CONFIRM'),canReceive:scope.has(req,o.DestinationWhId)&&shipping.can(req,o.CategoryCode,'CONFIRM')})),receipts,locations});
 }catch(e){error(res,e)}
});
router.post('/:id/putaway',async(req,res)=>{let tx;try{const b=req.body||{},lineId=Number(req.params.id),allocationId=b.allocationId==null?null:Number(b.allocationId);if(!Number.isInteger(lineId)||lineId<1||lineId>2147483647||allocationId!==null&&(!Number.isInteger(allocationId)||allocationId<1)||typeof b.toLocationCode!=='string'||!b.toLocationCode.trim()||b.toLocationCode.length>50||!/^\d{1,12}(?:\.\d{1,2})?$/.test(String(b.quantity))||Number(b.quantity)<=0||!/^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i.test(b.requestId||''))fail(400,'ตรวจตำแหน่ง จำนวน และรหัสคำขอ');
const p=await poolPromise,initial=(await p.request().input('Id',sql.Int,lineId).query('SELECT WhId FROM dbWMS.dbo.WarehouseTransferReceipts WHERE LineId=@Id')).recordset[0];if(!initial||!scope.has(req,initial.WhId))fail(403,'ไม่มีสิทธิ์คลังรับปลายทาง');
tx=new sql.Transaction(p);await tx.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);const q=()=>new sql.Request(tx);await q().input('Wh',sql.Int,initial.WhId).query('SELECT whid FROM dbMaster.dbo.tblWH WITH(UPDLOCK,HOLDLOCK) WHERE whid=@Wh');
const r=(await q().input('Id',sql.Int,lineId).query('SELECT r.*,h.Status,h.CategoryCode,h.DeliveryNo,p.CategoryId,p.Barcode FROM dbWMS.dbo.WarehouseTransferReceipts r WITH(UPDLOCK,HOLDLOCK) JOIN dbWMS.dbo.DeliveryOrders h ON h.DeliveryId=r.DeliveryId JOIN dbMaster.dbo.tblProducts p ON p.ProductId=r.ProductId WHERE r.LineId=@Id')).recordset[0];
if(!r||r.Status!=='RECEIVED'||!shipping.can(req,r.CategoryCode,'CONFIRM'))fail(403,'ไม่มีสิทธิ์หรือยังไม่รับสินค้า');
if(req.navigation?.user.Role!=='ADMIN'&&!nav.hasAction(req.navigation.profile,req.navigation.mode,'PUTAWAY_'+r.CategoryCode,'CONFIRM'))fail(403,'ต้องมีสิทธิ์ยืนยันจัดเก็บกลุ่มสินค้านี้');
const allocation=allocationId===null?null:(await q().input('Allocation',sql.Int,allocationId).input('Line',sql.Int,lineId).query('SELECT * FROM dbWMS.dbo.WarehouseTransferLotAllocations WITH(UPDLOCK,HOLDLOCK) WHERE AllocationId=@Allocation AND LineId=@Line')).recordset[0];
if(allocationId!==null&&!allocation)fail(404,'ไม่พบแถว ANA/LOT ในใบโอน');
if(allocationId===null&&(await q().input('Line',sql.Int,lineId).query('SELECT TOP 1 AllocationId FROM dbWMS.dbo.WarehouseTransferLotAllocations WHERE LineId=@Line')).recordset.length)fail(400,'รายการนี้แยกตาม ANA/LOT แล้ว กรุณาจัดเก็บจากแถว LOT ที่เลือก');
const availableToStore=allocation?allocation.Quantity-allocation.StoredQuantity:r.ReceivedQuantity-r.StoredQuantity;
const prior=(await q().input('Key',sql.UniqueIdentifier,b.requestId).query('SELECT * FROM dbWMS.dbo.WarehouseTransferStorage WHERE RequestId=@Key')).recordset[0];if(prior){if(prior.LineId!==lineId||prior.AllocationId!==allocationId||prior.ToLocationCode!==b.toLocationCode||prior.Quantity!==Number(b.quantity))fail(409,'รหัสคำขอใช้กับข้อมูลอื่นแล้ว');await tx.commit();return res.json({success:true,duplicate:true});}
if(Number(b.quantity)>availableToStore)fail(409,'จำนวนเกินยอดรอจัดเก็บของ ANA/LOT นี้');
const to=(await q().input('Wh',sql.Int,r.WhId).input('Loc',sql.NVarChar(50),b.toLocationCode).query("SELECT LocationCode FROM dbMaster.dbo.Locations WHERE whid=@Wh AND LocationCode=@Loc AND IsActive=1 AND UPPER(Zone) IN('A','B','STORAGE')")).recordset[0];if(!to)fail(400,'เลือกตำแหน่งจัดเก็บในคลังปลายทาง');
const rules=(await q().input('Wh',sql.Int,r.WhId).input('Loc',sql.NVarChar(50),to.LocationCode).query('SELECT CategoryId FROM dbMaster.dbo.tblLocationCategoryRules WHERE WhId=@Wh AND LocationCode=@Loc')).recordset;if(rules.length&&!rules.some(x=>x.CategoryId===r.CategoryId))fail(409,'ตำแหน่งไม่รองรับกลุ่มสินค้านี้');
if(r.CategoryCode==='RM'&&(r.StoredQuantity!==0||Number(b.quantity)!==r.ReceivedQuantity))fail(409,'RM ต้องจัดเก็บทั้งภาชนะของรายการในครั้งเดียว');
const by=String(req.user.username||req.user.id).slice(0,50);
await q().input('Id',sql.Int,lineId).input('Allocation',sql.Int,allocationId).input('Wh',sql.Int,r.WhId).input('P',sql.Int,r.ProductId).input('From',sql.NVarChar(50),r.LocationCode).input('To',sql.NVarChar(50),to.LocationCode).input('Qty',sql.Decimal(18,2),b.quantity).input('Key',sql.UniqueIdentifier,b.requestId).input('By',sql.NVarChar(100),by).input('Ref',sql.NVarChar(60),r.DeliveryNo).query(`
DECLARE @Old decimal(18,2),@MovedAt datetime2=SYSDATETIME();SELECT @Old=Quantity FROM dbWMS.dbo.tblStock WITH(UPDLOCK,HOLDLOCK) WHERE whid=@Wh AND ProductId=@P AND LocationCode=@From;
IF @Old IS NULL OR @Old<@Qty THROW 51000,N'ยอด RCV ไม่เพียงพอ',1;
UPDATE dbWMS.dbo.WarehouseTransferReceipts SET StoredQuantity=StoredQuantity+@Qty WHERE LineId=@Id;
IF @Allocation IS NOT NULL UPDATE dbWMS.dbo.WarehouseTransferLotAllocations SET StoredQuantity=StoredQuantity+@Qty WHERE AllocationId=@Allocation;
UPDATE dbWMS.dbo.tblStock SET Quantity=Quantity-@Qty,UpdatedAt=SYSDATETIME() WHERE whid=@Wh AND ProductId=@P AND LocationCode=@From;
IF EXISTS(SELECT 1 FROM dbWMS.dbo.tblStock WITH(UPDLOCK,HOLDLOCK) WHERE whid=@Wh AND ProductId=@P AND LocationCode=@To) UPDATE dbWMS.dbo.tblStock SET Quantity=Quantity+@Qty,UpdatedAt=SYSDATETIME() WHERE whid=@Wh AND ProductId=@P AND LocationCode=@To;
ELSE INSERT dbWMS.dbo.tblStock(whid,ProductId,LocationCode,Quantity) VALUES(@Wh,@P,@To,@Qty);
INSERT dbWMS.dbo.tblStockTransactions(TransType,whid,ProductId,LocationCode,QtyChange,QtyAfter,RefDocNo,Remark,CreatedBy,CreatedAt) SELECT 'PUTAWAY',@Wh,@P,LocationCode,CASE WHEN LocationCode=@From THEN -@Qty ELSE @Qty END,Quantity,@Ref,N'จัดเก็บจากใบโอนข้ามคลัง',@By,@MovedAt FROM dbWMS.dbo.tblStock WHERE whid=@Wh AND ProductId=@P AND LocationCode IN(@From,@To);
INSERT dbWMS.dbo.WarehouseTransferStorage(RequestId,LineId,AllocationId,ToLocationCode,Quantity,CreatedBy,CreatedAt) VALUES(@Key,@Id,@Allocation,@To,@Qty,@By,@MovedAt);`);
if(r.CategoryCode==='RM')await q().input('D',sql.Int,r.DeliveryId).input('P',sql.Int,r.ProductId).input('To',sql.NVarChar(50),to.LocationCode).input('Key',sql.UniqueIdentifier,b.requestId).input('By',sql.NVarChar(100),by).query("INSERT dbWMS.dbo.RMContainerEvents(ContainerId,RequestId,EventType,QuantityBase,RemainingBase,Actor) SELECT c.ContainerId,@Key,'TRANSFER',c.RemainingBase,c.RemainingBase,@By FROM dbWMS.dbo.RMContainers c JOIN dbWMS.dbo.DeliveryContainers dc ON dc.ContainerId=c.ContainerId WHERE dc.DeliveryId=@D AND c.ProductId=@P;UPDATE c SET LocationCode=@To FROM dbWMS.dbo.RMContainers c JOIN dbWMS.dbo.DeliveryContainers dc ON dc.ContainerId=c.ContainerId WHERE dc.DeliveryId=@D AND c.ProductId=@P");
await shipping.audit(q,r.DeliveryId,'PUTAWAY',by,{lineId,quantity:b.quantity,toLocationCode:to.LocationCode,requestId:b.requestId});await tx.commit();res.json({success:true});
}catch(e){if(tx)try{await tx.rollback()}catch{}error(res,e)}});
module.exports=router;
