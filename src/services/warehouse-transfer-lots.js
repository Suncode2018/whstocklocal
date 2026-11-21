const {poolPromise,sql}=require('../config/db');

const cents=value=>Math.round(Number(value||0)*100);

async function availability({whid,productId,locationCode,requestFactory}){
 const pool=await poolPromise,request=requestFactory||(()=>pool.request());
 const stock=(await request().input('Wh',sql.Int,whid).input('Product',sql.Int,productId).input('Location',sql.NVarChar(50),locationCode).query(`
  SELECT s.whid,s.LocationCode,s.Quantity FROM dbWMS.dbo.tblStock s
  WHERE s.whid=@Wh AND s.ProductId=@Product AND s.LocationCode=@Location AND s.Quantity>0;
  SELECT COUNT_BIG(*) AS BlockedDrafts FROM dbWMS.dbo.DeliveryOrders h
  JOIN dbWMS.dbo.DeliveryLines l ON l.DeliveryId=h.DeliveryId
  WHERE h.Status='DRAFT' AND h.WhId=@Wh AND l.ProductId=@Product
   AND COALESCE(NULLIF(l.OriginLocationCode,N''),l.LocationCode)=@Location
   AND (h.DeliveryType<>'WAREHOUSE' OR NOT EXISTS(SELECT 1 FROM dbWMS.dbo.WarehouseTransferLotAllocations a WHERE a.LineId=l.LineId));
  SELECT COUNT_BIG(*) AS BlockedPlans FROM dbWMS.dbo.StoragePlans h
  JOIN dbWMS.dbo.StoragePlanLines l ON l.PlanId=h.PlanId
  WHERE h.Status='OPEN' AND h.WhId=@Wh AND h.ProductId=@Product AND h.FromLocationCode=@Location;
  SELECT a.AnaNo,a.LotNo,SUM(a.Quantity) AS ReservedQuantity
  FROM dbWMS.dbo.WarehouseTransferLotAllocations a
  JOIN dbWMS.dbo.DeliveryLines l ON l.LineId=a.LineId
  JOIN dbWMS.dbo.DeliveryOrders h ON h.DeliveryId=l.DeliveryId
  WHERE h.Status='DRAFT' AND h.DeliveryType='WAREHOUSE' AND h.WhId=@Wh AND l.ProductId=@Product
   AND COALESCE(NULLIF(l.OriginLocationCode,N''),l.LocationCode)=@Location
  GROUP BY a.AnaNo,a.LotNo;`)).recordsets;
 const source=stock[0]?.[0];
 if(!source)return {success:true,blocked:false,stockQuantity:0,lots:[]};
 const detail=await require('./stock-lot-details').load(pool,sql,productId,[source],request);
 const reserved=stock[3]||[],byKey=new Map(reserved.map(row=>[JSON.stringify([row.AnaNo||null,row.LotNo||null]),cents(row.ReservedQuantity)]));
 const lots=detail.filter(row=>Number(row.whid)===Number(whid)&&row.LocationCode===locationCode).map(row=>{
  const key=JSON.stringify([row.AnaNo||null,row.LotNo||null]),qty=cents(row.Quantity),held=byKey.get(key)||0;
  byKey.delete(key);
  return {...row,ReservedQuantity:held/100,AvailableQuantity:Math.max(0,qty-held)/100,IsUnattributed:!!row.Unattributed||(!row.AnaNo&&!row.LotNo)};
 });
 const blocked=Number(stock[1]?.[0]?.BlockedDrafts||0)>0||Number(stock[2]?.[0]?.BlockedPlans||0)>0;
 return {success:true,blocked,blockReason:blocked?'มีใบจองเดิมหรือแผนจัดเก็บที่ยังไม่ระบุ LOT กรุณาปิดงานเดิมก่อนเลือกล็อต':null,stockQuantity:Number(source.Quantity),lots};
}

function validateAllocations(allocations,total){
 if(!Array.isArray(allocations)||!allocations.length||allocations.length>100)throw Object.assign(Error('เลือก ANA/LOT หรือรายการไม่ระบุอย่างน้อย 1 รายการ'),{status:400});
 let sum=0;
 for(const row of allocations){
  if(!row||typeof row!=='object'||!/^\d{1,12}(?:\.\d{1,2})?$/.test(String(row.Quantity))||Number(row.Quantity)<=0||row.AnaNo!=null&&(typeof row.AnaNo!=='string'||row.AnaNo.length>100)||row.LotNo!=null&&(typeof row.LotNo!=='string'||row.LotNo.length>100)||row.FifoDate!=null&&(typeof row.FifoDate!=='string'||!Number.isFinite(Date.parse(row.FifoDate)))||typeof row.IsUnattributed!=='boolean'||row.IsUnattributed&&((row.AnaNo||null)!==null||(row.LotNo||null)!==null)||!row.IsUnattributed&&!row.AnaNo&&!row.LotNo)throw Object.assign(Error('ข้อมูล ANA/LOT ที่เลือกไม่ถูกต้อง'),{status:400});
  sum+=cents(row.Quantity);
 }
 if(sum!==cents(total))throw Object.assign(Error('ผลรวมจำนวนแยก ANA/LOT ต้องเท่ากับจำนวนที่โอน'),{status:400});
 const keys=allocations.map(row=>JSON.stringify([row.AnaNo||null,row.LotNo||null]));
 if(new Set(keys).size!==keys.length)throw Object.assign(Error('มี ANA/LOT ซ้ำในรายการ กรุณารวมจำนวนให้เป็นแถวเดียว'),{status:400});
 return true;
}

module.exports={availability,validateAllocations};
