const router=require('express').Router(),{poolPromise,sql}=require('../config/db');
router.use((req,res,next)=>String(req.user?.role).toUpperCase()==='ADMIN'?next():res.status(403).json({success:false,message:'เฉพาะ Admin ปรับ ANA / LOT ได้'}));
const contextSql=`SELECT whid,LocationCode,Quantity FROM dbWMS.dbo.tblStock WHERE ProductId=@P AND whid=@W AND LocationCode=@L;
SELECT COALESCE(MAX(TransId),0) ThroughTransId FROM dbWMS.dbo.tblStockTransactions WHERE ProductId=@P;
SELECT COALESCE(MAX(AdjustmentId),0) Version FROM dbWMS.dbo.StockLotAdjustments WHERE ProductId=@P;
 SELECT TOP 20 AdjustmentId,WhId,LocationCode,RowsJson,Reason,CreatedBy,CreatedAt FROM dbWMS.dbo.StockLotAdjustments WHERE ProductId=@P AND WhId=@W AND LocationCode=@L ORDER BY AdjustmentId DESC;
 SELECT PackVersionId,VersionNo,IsActive,PackUnit,UnitsPerPack,InnerPackUnit,UnitsPerInnerPack,OuterPackUnit,PacksPerOuter FROM dbMaster.dbo.tblProductPackVersions WHERE ProductId=@P ORDER BY VersionNo DESC;`;
router.get('/',async(req,res)=>{try{
 const p=Number(req.query.productId),w=Number(req.query.whid),l=req.query.locationCode;
 if(!Number.isInteger(p)||p<=0||!Number.isInteger(w)||w<=0||typeof l!=='string'||!l||l.length>50)return res.status(400).json({success:false,message:'ข้อมูลไม่ถูกต้อง'});
 const pool=await poolPromise,r=await pool.request().input('P',sql.Int,p).input('W',sql.Int,w).input('L',sql.NVarChar(50),l).query(contextSql);
 const stock=r.recordsets[0];if(!stock.length)return res.status(404).json({success:false,message:'ไม่พบยอดสต๊อกในตำแหน่งนี้'});
 const rows=await require('../services/stock-lot-details').load(pool,sql,p,stock);
 res.json({success:true,quantity:stock[0].Quantity,throughTransId:r.recordsets[1][0].ThroughTransId,version:r.recordsets[2][0].Version,rows,history:r.recordsets[3],packVersions:r.recordsets[4]});
 }catch(e){console.error('Lot context:',e.code);res.status(500).json({success:false,message:'โหลดข้อมูล ANA / LOT ไม่สำเร็จ ตรวจ StockLotAdjustments.sql'})}});
router.post('/',async(req,res)=>{let tx;try{
 const b=require('../services/stock-lot-adjustment').validate(req.body),pool=await poolPromise;
 tx=new sql.Transaction(pool);await tx.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
 const request=new sql.Request(tx).input('P',sql.Int,b.productId).input('W',sql.Int,b.whid).input('L',sql.NVarChar(50),b.locationCode);
 const r=await request.query(`SELECT Quantity FROM dbWMS.dbo.tblStock WITH(UPDLOCK,HOLDLOCK) WHERE ProductId=@P AND whid=@W AND LocationCode=@L;
 SELECT COALESCE(MAX(TransId),0) ThroughTransId FROM dbWMS.dbo.tblStockTransactions WITH(HOLDLOCK) WHERE ProductId=@P;
 SELECT COALESCE(MAX(AdjustmentId),0) Version FROM dbWMS.dbo.StockLotAdjustments WITH(UPDLOCK,HOLDLOCK) WHERE ProductId=@P;
 SELECT TOP 1 ContainerId FROM dbWMS.dbo.RMContainers WHERE ProductId=@P AND WhId=@W AND LocationCode=@L AND RemainingBase>0;`);
 if(!r.recordsets[0].length)throw Object.assign(Error('ไม่พบสต๊อก'),{status:404});
 if(r.recordsets[3].length)throw Object.assign(Error('สินค้านี้ควบคุมระดับภาชนะ ต้องแก้ LOT ในทะเบียนภาชนะ'),{status:409});
 if(r.recordsets[1][0].ThroughTransId!==b.throughTransId||r.recordsets[2][0].Version!==b.version)throw Object.assign(Error('มีการเคลื่อนไหวหรือแก้ล็อตใหม่ กรุณาปิดแล้วโหลดใหม่'),{status:409});
 if(Math.round(Number(r.recordsets[0][0].Quantity)*100)!==b.cents)throw Object.assign(Error('ยอดรวม ANA / LOT ต้องเท่ากับยอดคงเหลือปัจจุบัน'),{status:409});
 const versionIds=b.rows.filter(x=>x.PackVersionId).map(x=>x.PackVersionId);if(versionIds.length){const found=(await new sql.Request(tx).input('P',sql.Int,b.productId).query(`SELECT PackVersionId FROM dbMaster.dbo.tblProductPackVersions WHERE ProductId=@P AND PackVersionId IN (${versionIds.join(',')})`)).recordset;if(found.length!==new Set(versionIds).size)throw Object.assign(Error('มี Version ที่ไม่ได้เป็นของสินค้านี้'),{status:400});}
 await new sql.Request(tx).input('P',sql.Int,b.productId).input('W',sql.Int,b.whid).input('L',sql.NVarChar(50),b.locationCode).input('T',sql.Int,b.throughTransId).input('Q',sql.Decimal(18,2),b.cents/100).input('J',sql.NVarChar(sql.MAX),JSON.stringify(b.rows)).input('R',sql.NVarChar(500),b.reason).input('By',sql.NVarChar(100),String(req.user.username||req.user.id).slice(0,100)).query('INSERT dbWMS.dbo.StockLotAdjustments(ProductId,WhId,LocationCode,ThroughTransId,Quantity,RowsJson,Reason,CreatedBy) VALUES(@P,@W,@L,@T,@Q,@J,@R,@By)');
 await tx.commit();res.json({success:true,message:'บันทึก ANA / LOT แล้ว ยอดสต๊อกคงเดิม'});
 }catch(e){if(tx)try{await tx.rollback()}catch{}console.error('Lot adjustment:',e.status||e.code);res.status(e.status||500).json({success:false,message:e.status?e.message:'บันทึก ANA / LOT ไม่สำเร็จ'})}});
module.exports=router;
