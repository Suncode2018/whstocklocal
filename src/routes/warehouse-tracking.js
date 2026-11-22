const router=require('express').Router();
const {poolPromise,sql}=require('../config/db');
const access=require('../middleware/access'),scope=require('../middleware/warehouse-scope');
const {catalog}=require('../config/navigation'),{hasAction}=require('../middleware/navigation');
router.use(access.authenticate);

router.get('/',async(req,res)=>{try{
 const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Bangkok',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
 const start=String(req.query.start||today),end=String(req.query.end||today);
 const valid=v=>/^\d{4}-\d{2}-\d{2}$/.test(v)&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString().slice(0,10)===v;
 if(!valid(start)||!valid(end)||start>end||end>'9999-12-30')return res.status(400).json({success:false,message:'ระบุวันที่ให้ถูกต้อง และวันที่สิ้นสุดต้องไม่น้อยกว่าวันเริ่มต้น'});
 const kind=String(req.query.kind||''),warehouse=String(req.query.warehouse||''),category=String(req.query.category||''),state=String(req.query.state||''),search=String(req.query.search||'').trim();
 if(kind&&!['RECEIVE','PUTAWAY','PICK','LOAD','TRANSFER'].includes(kind)||warehouse&&!/^[1-9]\d*$/.test(warehouse)||category&&!['RM','PKG','SEMI','FG'].includes(category)||state&&!['OPEN','WAITING','PROGRESS','DONE','CANCELLED'].includes(state)||search.length>200)return res.status(400).json({success:false,message:'ตัวกรองไม่ถูกต้อง'});
 const exporting=req.query.format==='csv',admin=req.navigation?.user.Role==='ADMIN';
 if(exporting&&!admin&&!hasAction(req.navigation.profile,req.navigation.mode,'WAREHOUSE_TRACKING','EXPORT'))return res.status(403).json({success:false,message:'ไม่มีสิทธิ์ Export ติดตามงานคลัง'});
 const allowed=parent=>['RM','PKG','SEMI','FG'].filter(c=>admin||catalog.some(item=>item.scopeParent===parent&&item.categoryCode===c&&hasAction(req.navigation.profile,req.navigation.mode,item.code,'VIEW')));
 const filter=(parent,column)=>{const cats=allowed(parent);return cats.length?column+' IN ('+cats.map(c=>"'"+c+"'").join(',')+')':'1=0'};
 const pageSize=25,pageRaw=Number.parseInt(String(req.query.page||'1'),10),requestedPage=Number.isInteger(pageRaw)&&pageRaw>0?pageRaw:1,offset=(requestedPage-1)*pageSize;
 if(!exporting&&offset>1000000)return res.status(400).json({success:false,message:'หน้าเกินขอบเขต กรุณาระบุตัวกรองให้แคบลง'});
 const activity=`
 SELECT 'RECEIVE' Kind,o.ReceiveNo DocumentNo,o.ReceiveType Category,o.WhId whid,w.whname,w.whdescription,o.CreatedAt EventAt,o.CreatedBy Actor,o.ReferenceNo Reference,o.SupplierName Party,
 CASE WHEN o.IsCancelled=1 THEN 'CANCELLED' WHEN o.Status='COMPLETED' THEN 'DONE' WHEN o.Status='PARTIAL' THEN 'PROGRESS' ELSE 'WAITING' END State,
 CASE WHEN o.IsCancelled=1 THEN N'ยกเลิกแล้ว' WHEN o.Status='COMPLETED' THEN N'รับครบแล้ว' WHEN o.Status='PARTIAL' THEN N'รับบางส่วน' ELSE N'รอรับสินค้า' END StateLabel,
 CAST(NULL AS NVARCHAR(60)) ProductCode,CAST(NULL AS NVARCHAR(500)) ProductName,CAST(NULL AS DECIMAL(18,2)) Quantity,CAST(NULL AS DECIMAL(18,2)) DoneQuantity
 FROM dbWMS.dbo.InboundOrders o JOIN dbMaster.dbo.tblWH w ON w.whid=o.WhId
 WHERE o.CreatedAt>=@Start AND o.CreatedAt<DATEADD(day,1,@End) AND ${scope.predicate(req,'o.WhId')} AND ${filter('RECEIVE','o.ReceiveType')}
 UNION ALL
 SELECT 'PUTAWAY',h.PlanNo,c.CategoryCode,h.WhId,w.whname,w.whdescription,h.CreatedAt,h.CreatedBy,h.FromLocationCode,N'',
 CASE WHEN h.Status='CANCELLED' THEN 'CANCELLED' WHEN totals.Qty>0 AND totals.Moved>=totals.Qty THEN 'DONE' WHEN totals.Moved>0 THEN 'PROGRESS' ELSE 'WAITING' END,
 CASE WHEN h.Status='CANCELLED' THEN N'ยกเลิกแล้ว' WHEN totals.Qty>0 AND totals.Moved>=totals.Qty THEN N'จัดเก็บครบ' WHEN totals.Moved>0 THEN N'จัดเก็บบางส่วน' ELSE N'รอยืนยันจัดเก็บ' END,
 p.ProductCode,p.ProductName,totals.Qty,totals.Moved
 FROM dbWMS.dbo.StoragePlans h JOIN dbMaster.dbo.tblProducts p ON p.ProductId=h.ProductId JOIN dbMaster.dbo.tblCategories c ON c.CategoryId=p.CategoryId JOIN dbMaster.dbo.tblWH w ON w.whid=h.WhId
 CROSS APPLY(SELECT SUM(l.Quantity) Qty,SUM(l.MovedQuantity) Moved FROM dbWMS.dbo.StoragePlanLines l WHERE l.PlanId=h.PlanId) totals
 WHERE h.CreatedAt>=@Start AND h.CreatedAt<DATEADD(day,1,@End) AND ${scope.predicate(req,'h.WhId')} AND ${filter('PUTAWAY','c.CategoryCode')}
 UNION ALL
 SELECT CASE WHEN o.DeliveryType='WAREHOUSE' THEN 'TRANSFER' ELSE 'LOAD' END,o.DeliveryNo,o.CategoryCode,o.WhId,w.whname,w.whdescription,o.CreatedAt,o.CreatedBy,o.DeliveryType,o.DestinationName,
 CASE WHEN o.Status='CANCELLED' THEN 'CANCELLED' WHEN o.Status='RECEIVED' THEN 'DONE' WHEN o.Status='SENT' OR o.Prepared=1 THEN 'PROGRESS' ELSE 'WAITING' END,
 CASE WHEN o.Status='CANCELLED' THEN N'ยกเลิกแล้ว' WHEN o.Status='RECEIVED' THEN N'ปลายทางรับแล้ว' WHEN o.Status='SENT' AND o.DeliveryType='CLINIC' THEN N'ส่งมอบคลินิกแล้ว' WHEN o.Status='SENT' THEN N'ส่งแล้ว · รอรับปลายทาง' WHEN o.Prepared=1 THEN N'พร้อมส่ง / ส่งมอบ' ELSE N'รอเตรียมสินค้า' END,NULL,NULL,NULL,NULL
 FROM dbWMS.dbo.DeliveryOrders o JOIN dbMaster.dbo.tblWH w ON w.whid=o.WhId
 WHERE o.CreatedAt>=@Start AND o.CreatedAt<DATEADD(day,1,@End) AND ${scope.predicate(req,'o.WhId')} AND ${filter('LOAD','o.CategoryCode')}
 UNION ALL
 SELECT 'PICK',t.RefDocNo,c.CategoryCode,t.whid,w.whname,w.whdescription,t.CreatedAt,t.CreatedBy,t.LocationCode,N'','DONE',N'เบิกแล้ว',p.ProductCode,p.ProductName,ABS(t.QtyChange),ABS(t.QtyChange)
 FROM dbWMS.dbo.tblStockTransactions t JOIN dbMaster.dbo.tblProducts p ON p.ProductId=t.ProductId JOIN dbMaster.dbo.tblCategories c ON c.CategoryId=p.CategoryId JOIN dbMaster.dbo.tblWH w ON w.whid=t.whid
 WHERE t.CreatedAt>=@Start AND t.CreatedAt<DATEADD(day,1,@End) AND t.TransType='PICK' AND t.QtyChange<0 AND ${scope.predicate(req,'t.whid')} AND ${filter('PICK','c.CategoryCode')}`;
 const params=request=>(request.input('Start',sql.Date,start).input('End',sql.Date,end).input('Kind',sql.VarChar(20),kind).input('Warehouse',sql.Int,warehouse?Number(warehouse):null).input('Category',sql.VarChar(10),category).input('State',sql.VarChar(20),state).input('Search',sql.NVarChar(200),search));
 const where=`(@Kind='' OR a.Kind=@Kind) AND (@Warehouse IS NULL OR a.whid=@Warehouse) AND (@Category='' OR a.Category=@Category) AND (@State='' OR (@State='OPEN' AND a.State IN('WAITING','PROGRESS')) OR a.State=@State) AND (@Search=N'' OR CONCAT(COALESCE(a.DocumentNo,N''),N' ',COALESCE(a.Reference,N''),N' ',COALESCE(a.Party,N''),N' ',COALESCE(a.ProductCode,N''),N' ',COALESCE(a.ProductName,N'')) LIKE N'%'+@Search+N'%')`;
 const pool=await poolPromise,base=`SELECT * INTO #WarehouseActivity FROM (${activity}) a WHERE ${where};`;
 if(exporting){const result=await params(pool.request()).query(`${base} SELECT * FROM #WarehouseActivity ORDER BY EventAt DESC;`),data=result.recordset;if(!data.length)return res.status(400).json({success:false,message:'ไม่มีข้อมูลสำหรับส่งออก'});
  const cell=v=>'"'+String(v??'').replace(/^[=+@-]/,'\t$&').replace(/"/g,'""')+'"';
  const columns=[['กลุ่มงาน','Kind'],['เลขเอกสาร','DocumentNo'],['หมวด','Category'],['รหัสคลัง','whname'],['ชื่อคลัง','whdescription'],['สถานะ','StateLabel'],['รหัสสินค้า','ProductCode'],['ชื่อสินค้า','ProductName'],['อ้างอิง','Reference'],['ผู้ส่ง / ผู้รับ','Party'],['จำนวน','Quantity'],['ทำแล้ว','DoneQuantity'],['ผู้สร้าง','Actor'],['วันที่สร้าง','EventAt']];
  const csv='\uFEFF'+[columns.map(c=>cell(c[0])).join(','),...data.map(row=>columns.map(([,key])=>cell(row[key] instanceof Date?new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Bangkok',calendar:'gregory',day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false}).format(row[key]):row[key])).join(','))].join('\r\n');
  res.set('Content-Type','text/csv; charset=utf-8');res.set('Content-Disposition','attachment; filename="warehouse-tracking_'+start+'_'+end+'.csv"');return res.send(csv);
 }
 const result=await params(pool.request()).input('Offset',sql.Int,offset).input('PageSize',sql.Int,pageSize).query(`${base} SELECT State,COUNT_BIG(*) Count FROM #WarehouseActivity GROUP BY State; SELECT * FROM #WarehouseActivity ORDER BY EventAt DESC OFFSET @Offset ROWS FETCH NEXT @PageSize ROWS ONLY;`),summary=result.recordsets[0]||[],data=result.recordsets[1]||[];
 const total=summary.reduce((sum,row)=>sum+Number(row.Count),0),totalPages=Math.max(1,Math.ceil(total/pageSize)),page=Math.min(requestedPage,totalPages),pageData=page===requestedPage?data:(await params(pool.request()).input('Offset',sql.Int,(page-1)*pageSize).input('PageSize',sql.Int,pageSize).query(`${base} SELECT * FROM #WarehouseActivity ORDER BY EventAt DESC OFFSET @Offset ROWS FETCH NEXT @PageSize ROWS ONLY;`)).recordset;
 const warehouses=(await pool.request().query(`SELECT whid,whname,whdescription FROM dbMaster.dbo.tblWH WHERE ${scope.predicate(req,'whid')} ORDER BY whname`)).recordset;
 const categories=['RM','PKG','SEMI','FG'].filter(c=>admin||catalog.some(item=>item.categoryCode===c&&['RECEIVE','PUTAWAY','LOAD','PICK'].includes(item.scopeParent)&&hasAction(req.navigation.profile,req.navigation.mode,item.code,'VIEW')));
 res.set('Cache-Control','no-store').json({success:true,data:pageData,start,end,page,pageSize,total,totalPages,summary,filters:{warehouses,categories}});
 }catch(e){console.error('Warehouse tracking:',e.code||e.message);if(e.code==='ETIMEOUT')require('../services/sql-timeout-diagnostics')(poolPromise,'GET /api/warehouse-tracking',e);res.status(500).json({success:false,message:'โหลดงานคลังไม่สำเร็จ กรุณาตรวจฐานข้อมูลและ Log เซิร์ฟเวอร์'});}
});
module.exports=router;
