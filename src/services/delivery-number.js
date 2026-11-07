const {sql}=require('../config/db');
async function nextDeliveryNumber(rq,warehouseCode,date){
 const code=String(warehouseCode||'').trim();
 if(!code||code.length>20||/[\r\n\u0000-\u001f]/.test(code)){const e=Error('รหัสคลังไม่ถูกต้องสำหรับออกเลขใบส่ง (สูงสุด 20 ตัวอักษร)');e.status=400;throw e;}
 const prefix=code+'-'+date.replace(/-/g,'')+'-';
 const result=await rq().input('Code',sql.NVarChar(20),code).input('Date',sql.Date,date).input('Prefix',sql.NVarChar(30),prefix).query(`
 DECLARE @N int;
 SELECT @N=LastNumber FROM dbWMS.dbo.DeliveryNumberSeries WITH(UPDLOCK,HOLDLOCK) WHERE WarehouseCode=@Code AND DocumentDate=@Date;
 IF @N IS NULL BEGIN
 SELECT @N=COALESCE(MAX(TRY_CONVERT(int,SUBSTRING(DeliveryNo,LEN(@Prefix)+1,40))),0) FROM dbWMS.dbo.DeliveryOrders WHERE LEFT(DeliveryNo,LEN(@Prefix))=@Prefix;
 IF @N=2147483647 THROW 51000,N'เลขรันใบส่งเต็มแล้ว',1;
 SET @N=@N+1;
 INSERT dbWMS.dbo.DeliveryNumberSeries(WarehouseCode,DocumentDate,LastNumber) VALUES(@Code,@Date,@N);
 END ELSE BEGIN
 IF @N=2147483647 THROW 51000,N'เลขรันใบส่งเต็มแล้ว',1;
 SET @N=@N+1;
 UPDATE dbWMS.dbo.DeliveryNumberSeries SET LastNumber=@N WHERE WarehouseCode=@Code AND DocumentDate=@Date;
 END;
 SELECT @N AS RunningNumber;`);
 return prefix+String(result.recordset[0].RunningNumber).padStart(2,'0');
}
module.exports={nextDeliveryNumber};
