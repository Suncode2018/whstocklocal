const router=require('express').Router(),{poolPromise,sql}=require('../config/db'),scope=require('../middleware/warehouse-scope');
const validDate=v=>/^\d{4}-\d{2}-\d{2}$/.test(v)&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString().slice(0,10)===v;
router.get('/',async(req,res)=>{try{
 const startDate=String(req.query.startDate||''),endDate=String(req.query.endDate||'');
 if(!validDate(startDate)||!validDate(endDate)||startDate>endDate)return res.status(400).json({success:false,message:'ช่วงวันที่ไม่ถูกต้อง'});
 const product=String(req.query.product||'').trim();if(product.length>100)return res.status(400).json({success:false,message:'คำค้นยาวเกินไป'});
 const warehouse=String(req.query.warehouse||'');if(warehouse&&!/^[1-9]\d*$/.test(warehouse))return res.status(400).json({success:false,message:'คลังไม่ถูกต้อง'});
 const type=String(req.query.type||'');if(type.length>40||type&&!/^[A-Z0-9_]+$/.test(type))return res.status(400).json({success:false,message:'ชนิดงานไม่ถูกต้อง'});
 const exporting=req.query.format==='csv';const {hasAction}=require('../middleware/navigation');if(exporting&&req.navigation?.user.Role!=='ADMIN'&&(!req.navigation||!hasAction(req.navigation.profile,req.navigation.mode,'REPORTS','EXPORT')))return res.status(403).json({success:false,message:'ไม่มีสิทธิ์ Export รายงาน'});
 const canSeeAll=req.navigation?.user.Role==='ADMIN'||req.navigation?.profile.DESKTOP.includes('STOCK');
 const allowedCategories=canSeeAll?null:require('../config/navigation').catalog.filter(item=>item.scopeParent==='PRODUCTS'&&require('../middleware/product-scope').can(req,item.categoryId)).map(item=>item.categoryId);
 if(allowedCategories&&!allowedCategories.length)return res.set('Cache-Control','no-store').json({success:true,data:[],total:0,page:1,pageSize:100,totalPages:1,filters:{warehouses:[],types:[]}});
 const categoryScope=allowedCategories?' AND p.CategoryId IN ('+allowedCategories.join(',')+')':'';
 const pageSize=100,pageInput=Number.parseInt(String(req.query.page||'1'),10),page=Number.isInteger(pageInput)&&pageInput>0?pageInput:1,offset=(page-1)*pageSize;
 if(!exporting&&offset>1000000)return res.status(400).json({success:false,message:'หน้าเกินขอบเขต กรุณาระบุตัวกรองให้แคบลง'});
 const pool=await poolPromise,request=()=>pool.request().input('Start',sql.Date,startDate).input('End',sql.Date,endDate).input('Product',sql.NVarChar(100),product).input('Wh',sql.Int,warehouse?Number(warehouse):null).input('Type',sql.VarChar(40),type);
 const [filtersResult,result]=await Promise.all([
   pool.request().query(`SELECT whid,whname FROM dbMaster.dbo.tblWH WHERE ${scope.predicate(req,'whid')} ORDER BY whname; SELECT DISTINCT TransType FROM dbWMS.dbo.tblStockTransactions WHERE TransType IS NOT NULL ORDER BY TransType;`),
   exporting?request().query(`SELECT t.TransId,t.CreatedAt,t.TransType,t.whid,w.whname,t.LocationCode,p.CategoryId,p.ProductCode,p.ProductName,u.UnitCode,t.QtyChange,t.QtyAfter,t.RefDocNo,t.Remark,t.CreatedBy
 FROM dbWMS.dbo.tblStockTransactions t JOIN dbMaster.dbo.tblProducts p ON p.ProductId=t.ProductId LEFT JOIN dbMaster.dbo.tblWH w ON w.whid=t.whid LEFT JOIN dbMaster.dbo.tblUnits u ON u.UnitId=p.UnitId
 WHERE t.CreatedAt>=@Start AND t.CreatedAt<DATEADD(day,1,@End) AND (@Product=N'' OR p.ProductCode LIKE N'%'+@Product+N'%' OR p.ProductName LIKE N'%'+@Product+N'%') AND (@Wh IS NULL OR t.whid=@Wh) AND (@Type='' OR t.TransType=@Type) AND (${scope.predicate(req,'t.whid')})${categoryScope}
 ORDER BY t.CreatedAt DESC,t.TransId DESC`):request().input('Offset',sql.Int,offset).input('PageSize',sql.Int,pageSize).query(`WITH Filtered AS (
 SELECT t.TransId,t.CreatedAt,t.TransType,t.whid,w.whname,t.LocationCode,p.CategoryId,p.ProductCode,p.ProductName,u.UnitCode,t.QtyChange,t.QtyAfter,t.RefDocNo,t.Remark,t.CreatedBy
 FROM dbWMS.dbo.tblStockTransactions t JOIN dbMaster.dbo.tblProducts p ON p.ProductId=t.ProductId LEFT JOIN dbMaster.dbo.tblWH w ON w.whid=t.whid LEFT JOIN dbMaster.dbo.tblUnits u ON u.UnitId=p.UnitId
 WHERE t.CreatedAt>=@Start AND t.CreatedAt<DATEADD(day,1,@End) AND (@Product=N'' OR p.ProductCode LIKE N'%'+@Product+N'%' OR p.ProductName LIKE N'%'+@Product+N'%') AND (@Wh IS NULL OR t.whid=@Wh) AND (@Type='' OR t.TransType=@Type) AND (${scope.predicate(req,'t.whid')})${categoryScope}
 ) SELECT * INTO #FilteredMovements FROM Filtered; SELECT COUNT_BIG(*) Total FROM #FilteredMovements; SELECT * FROM #FilteredMovements ORDER BY CreatedAt DESC,TransId DESC OFFSET @Offset ROWS FETCH NEXT @PageSize ROWS ONLY;`)
 ]);
 const rows=result.recordset,visible=rows;
 if(exporting){if(!visible.length)return res.status(400).json({success:false,message:'ไม่มีรายการตามตัวกรองสำหรับส่งออก'});res.set('Content-Type','text/csv; charset=utf-8');res.set('Content-Disposition','attachment; filename="stock-movements_'+startDate+'_to_'+endDate+'.csv"');return res.send(require('../services/stock-movement-export').csv(visible));}
 const total=Number(rows[0]?.Total||0),totalPages=Math.max(1,Math.ceil(total/pageSize));res.set('Cache-Control','no-store').json({success:true,data:result.recordsets?.[1]||[],total,page:Math.min(page,totalPages),pageSize,totalPages,filters:{warehouses:filtersResult.recordsets?.[0]||[],types:(filtersResult.recordsets?.[1]||[]).map(x=>x.TransType)}});
 }catch(e){console.error('Stock movements:',e.code);res.status(500).json({success:false,message:'โหลดประวัติเคลื่อนไหวไม่สำเร็จ'})}});
module.exports=router;
