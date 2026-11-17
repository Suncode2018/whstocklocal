const router=require('express').Router(),{poolPromise,sql}=require('../config/db'),scope=require('../middleware/warehouse-scope');
const validDate=v=>/^\d{4}-\d{2}-\d{2}$/.test(v)&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString().slice(0,10)===v;
router.get('/',async(req,res)=>{try{const start=String(req.query.startDate||''),end=String(req.query.endDate||''),product=String(req.query.product||'').trim(),wh=String(req.query.warehouse||'');if(!validDate(start)||!validDate(end)||start>end||product.length>100||wh&&!/^[1-9]\d*$/.test(wh))return res.status(400).json({success:false,message:'ตัวกรองไม่ถูกต้อง'});
 const exporting=req.query.format==='csv';const {hasAction}=require('../middleware/navigation');if(exporting&&req.navigation?.user.Role!=='ADMIN'&&(!req.navigation||!hasAction(req.navigation.profile,req.navigation.mode,'REPORTS','EXPORT')))return res.status(403).json({success:false,message:'ไม่มีสิทธิ์ Export รายงาน'});
 const all=req.navigation?.user.Role==='ADMIN'||req.navigation?.profile.DESKTOP.includes('STOCK');const categories=all?null:require('../config/navigation').catalog.filter(c=>c.scopeParent==='PRODUCTS'&&require('../middleware/product-scope').can(req,c.categoryId)).map(c=>c.categoryId);if(categories&&!categories.length)return exporting?res.status(400).json({success:false,message:'ไม่มีรายการตามตัวกรองสำหรับส่งออก'}):res.json({success:true,data:[]});
 const allowed=categories?' AND p.CategoryId IN ('+categories.join(',')+')':'';
 const result=await(await poolPromise).request().input('Start',sql.Date,start).input('End',sql.Date,end).input('Product',sql.NVarChar(100),product).input('Wh',sql.Int,wh?Number(wh):null).query(`WITH Daily AS (
 SELECT CONVERT(date,t.CreatedAt) StockDate,t.ProductId,t.whid,
 SUM(CASE WHEN t.QtyChange>0 THEN t.QtyChange ELSE 0 END) Received,
 SUM(CASE WHEN t.QtyChange<0 THEN -t.QtyChange ELSE 0 END) Issued,COUNT_BIG(*) MovementCount
 FROM dbWMS.dbo.tblStockTransactions t JOIN dbMaster.dbo.tblProducts p ON p.ProductId=t.ProductId
 WHERE t.CreatedAt>=@Start AND t.CreatedAt<DATEADD(day,1,@End) AND (@Wh IS NULL OR t.whid=@Wh) AND (@Product=N'' OR p.ProductCode LIKE N'%'+@Product+N'%' OR p.ProductName LIKE N'%'+@Product+N'%') AND (${scope.predicate(req,'t.whid')})${allowed}
 GROUP BY CONVERT(date,t.CreatedAt),t.ProductId,t.whid
), CurrentStock AS (
 SELECT s.ProductId,s.whid,SUM(s.Quantity) Qty FROM dbWMS.dbo.tblStock s
 WHERE EXISTS(SELECT 1 FROM Daily d WHERE d.ProductId=s.ProductId AND d.whid=s.whid)
 GROUP BY s.ProductId,s.whid
), LaterMovement AS (
 SELECT t.ProductId,t.whid,SUM(t.QtyChange) Qty FROM dbWMS.dbo.tblStockTransactions t
 WHERE t.CreatedAt>=DATEADD(day,1,@End) AND EXISTS(SELECT 1 FROM Daily d WHERE d.ProductId=t.ProductId AND d.whid=t.whid)
 GROUP BY t.ProductId,t.whid
), Balances AS (
 SELECT d.*,COALESCE(s.Qty,0)-COALESCE(l.Qty,0)-SUM(d.Received-d.Issued) OVER(PARTITION BY d.ProductId,d.whid ORDER BY d.StockDate DESC ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) Opening
 FROM Daily d LEFT JOIN CurrentStock s ON s.ProductId=d.ProductId AND s.whid=d.whid LEFT JOIN LaterMovement l ON l.ProductId=d.ProductId AND l.whid=d.whid
)
SELECT d.StockDate,p.ProductCode,p.ProductName,COALESCE(u.UnitCode,p.PackageType,N'') UOM,
 SUM(d.Opening) Opening,SUM(d.Received) Received,SUM(d.Issued) Issued,
 SUM(d.Opening+d.Received-d.Issued) Closing,SUM(d.MovementCount) MovementCount,COUNT_BIG(*) WarehouseCount
FROM Balances d JOIN dbMaster.dbo.tblProducts p ON p.ProductId=d.ProductId LEFT JOIN dbMaster.dbo.tblUnits u ON u.UnitId=p.UnitId
GROUP BY d.StockDate,p.ProductId,p.ProductCode,p.ProductName,u.UnitCode,p.PackageType
ORDER BY d.StockDate ASC,p.ProductCode`);
 if(exporting){if(!result.recordset.length)return res.status(400).json({success:false,message:'ไม่มีรายการตามตัวกรองสำหรับส่งออก'});res.set('Content-Type','text/csv; charset=utf-8');res.set('Content-Disposition','attachment; filename="stock-daily_'+start+'_to_'+end+'.csv"');return res.send(require('../services/stock-daily-export').csv(result.recordset));}
 const warehouses=(await(await poolPromise).request().query(`SELECT whid,whname FROM dbMaster.dbo.tblWH WHERE ${scope.predicate(req,'whid')} ORDER BY whname`)).recordset;res.set('Cache-Control','no-store').json({success:true,data:result.recordset,warehouses});}catch(e){console.error('Stock daily:',e.code);res.status(500).json({success:false,message:'โหลดสต๊อกรายวันไม่สำเร็จ'})}});module.exports=router;
