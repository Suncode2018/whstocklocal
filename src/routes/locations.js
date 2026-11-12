const express = require('express');
const router = express.Router();
const { poolPromise, sql } = require('../config/db');


// Send validated decimal text to SQL, avoiding JavaScript/TDS decimal rounding.
function locationCapacity(body) {
  const bad=message=>{throw Object.assign(new Error(message),{status:400})};
  const parse=(value,label)=>{
    if(value==null||value==='')return null;
    if(!['string','number'].includes(typeof value)||!/^\d{1,15}(?:\.\d{1,3})?$/.test(String(value)))bad(label+' ต้องเป็นจำนวนบวก ทศนิยมไม่เกิน 3 ตำแหน่ง');
    const [whole,fraction='']=String(value).split('.'),n=BigInt(whole)*1000n+BigInt(fraction.padEnd(3,'0'));
    if(n<=0n||n>999999999999999999n)bad(label+' เกินช่วงที่รองรับ');return n;
  };
  const text=n=>n==null?null:(n/1000n)+'.'+String(n%1000n).padStart(3,'0');
  const dims=['capacityWidthCm','capacityLengthCm','capacityHeightCm'].map((k,i)=>parse(body[k],['ความกว้าง','ความยาว','ความสูง'][i]));
  if(dims.some(x=>x!=null)&&dims.some(x=>x==null))bad('กรุณาระบุกว้าง ยาว สูงให้ครบ หรือเว้นว่างทั้งหมด');
  let volume=dims[0]!=null?(dims[0]*dims[1]*dims[2]+500000n)/1000000n:parse(body.capacityVolumeCm3,'ความจุ');
  if(volume!=null&&(volume<=0n||volume>999999999999999999n))bad('ปริมาตรจากกว้าง × ยาว × สูงเกินช่วงที่รองรับ กรุณาตรวจสอบหน่วยเซนติเมตร');
  return [...dims,volume].map(text);
}

function validateLocation(body,id){
 const invalid=message=>{throw Object.assign(Error(message),{status:400})};
 if(id!==undefined&&(!Number.isInteger(Number(id))||Number(id)<=0||Number(id)>2147483647))invalid('รหัสรายการโลเคชั่นไม่ถูกต้อง');
 if(!Number.isInteger(body.whid)||body.whid<=0||body.whid>2147483647)invalid('กรุณาเลือกคลังสินค้า');
 if(typeof body.locationCode!=='string'||!body.locationCode.trim()||body.locationCode.trim().length>50||typeof body.zone!=='string'||!body.zone.trim()||body.zone.trim().length>20)invalid('กรอกรหัสโลเคชั่นไม่เกิน 50 ตัวอักษร และโซนไม่เกิน 20 ตัวอักษร');
 if(body.description!=null&&(typeof body.description!=='string'||body.description.length>100))invalid('คำอธิบายต้องไม่เกิน 100 ตัวอักษร');
}
function duplicateLocation(res,code){return res.status(409).json({success:false,code:'DUPLICATE_LOCATION',error:'รหัสโลเคชั่น '+String(code||'').trim().toUpperCase()+' มีอยู่แล้ว กรุณาใช้รหัสใหม่ หรือแก้ไขรายการเดิม (รวมรายการที่ปิดใช้งานแล้ว)'})}
async function locationExists(pool,code,id=0){return (await pool.request().input('Code',sql.NVarChar(50),code.trim().toUpperCase()).input('Id',sql.Int,Number(id)).query('SELECT TOP 1 LocationId FROM dbo.Locations WHERE LocationCode=@Code AND LocationId<>@Id')).recordset.length>0}
function locationSaveError(res,err,code){if(locationConflict(res,err))return;if([2601,2627].includes(err.number))return duplicateLocation(res,code);return res.status(err.status||500).json({success:false,error:err.status?err.message:'บันทึกโลเคชั่นไม่สำเร็จ กรุณาลองใหม่หรือตรวจบันทึกเซิร์ฟเวอร์'})}

// Serialize location changes with warehouse stock operations; never net stock across SKUs.
const locationChangeGuard = `
 DECLARE @OldWh int, @OldCode nvarchar(50), @Lock int;
 SELECT @OldWh=whid FROM dbo.Locations WHERE LocationId=@LocationId;
 SELECT @Lock=whid FROM dbo.tblWH WITH (UPDLOCK,HOLDLOCK) WHERE whid IN (@OldWh,@whid) ORDER BY whid;
 SELECT @OldWh=whid,@OldCode=LocationCode FROM dbo.Locations WITH (UPDLOCK,HOLDLOCK) WHERE LocationId=@LocationId;
 IF @OldCode IS NULL THROW 51003,N'ไม่พบโลเคชั่น กรุณารีเฟรชข้อมูล',1;
 IF (@IsActive=0 OR @OldWh<>@whid OR @OldCode<>@LocationCode OR EXISTS(SELECT 1 FROM dbo.Locations WHERE LocationId=@LocationId AND UPPER(Zone)<>UPPER(@Zone)))
 BEGIN
   IF EXISTS(SELECT 1 FROM dbWMS.dbo.tblStock WITH (UPDLOCK,HOLDLOCK) WHERE whid=@OldWh AND LocationCode=@OldCode AND Quantity<>0)
     THROW 51001,N'โลเคชั่นนี้ยังมียอดสินค้า ไม่สามารถปิดใช้งาน เปลี่ยนรหัส หรือเปลี่ยนคลังได้ กรุณาย้ายสินค้าออกให้หมดก่อน แล้วลองอีกครั้ง',1;
   IF EXISTS(SELECT 1 FROM dbWMS.dbo.StoragePlans h JOIN dbWMS.dbo.StoragePlanLines pl ON pl.PlanId=h.PlanId WHERE h.WhId=@OldWh AND h.Status='OPEN' AND (h.FromLocationCode=@OldCode OR pl.ToLocationCode=@OldCode))
     THROW 51002,N'โลเคชั่นนี้มีงานจัดเก็บค้างอยู่ กรุณาจัดการงานให้เสร็จก่อนปิดใช้งาน',1;
 END;
`;
function locationConflict(res,err){
 if(![51001,51002,51003].includes(err.number))return false;
 res.status(err.number===51003?404:409).json({success:false,code:err.number===51001?'LOCATION_HAS_STOCK':err.number===51002?'LOCATION_HAS_WORK':'LOCATION_NOT_FOUND',error:err.message});return true;
}

router.use(async(req,res,next)=>{
 if(req.method==='GET'||require('../services/damage-locations').isAdmin(req))return next();
 try{let protectedLocation=String(req.body?.zone||'').trim().toUpperCase()==='DAMAGE';
 const match=/^\/locations\/(\d+)$/.exec(req.path);
 if(match){const p=await poolPromise;const row=(await p.request().input('I',sql.Int,Number(match[1])).query("SELECT Zone FROM dbo.Locations WHERE LocationId=@I")).recordset[0];protectedLocation=protectedLocation||String(row?.Zone).toUpperCase()==='DAMAGE';}
 if(protectedLocation)return res.status(403).json({success:false,error:'เฉพาะ ADMIN กำหนดหรือแก้ไขโลเคชั่น DAMAGE ได้'});next();
 }catch(e){res.status(500).json({success:false,error:'ตรวจสิทธิ์โลเคชั่นไม่สำเร็จ'});}
});

// 1. GET ALL LOCATIONS (พร้อมชื่อคลังสินค้าจาก tblWH)
router.get('/locations', async (req, res) => {
  try {
    const pool = await poolPromise;
    const query = `
      SELECT 
        L.LocationId,
        ISNULL(L.whid, 1) AS whid,
        ISNULL(W.whname, N'WH01') AS whname,
        ISNULL(W.whdescription, N'คลังหลัก') AS WarehouseName,
        L.LocationCode,
        L.Zone,
        L.Description,
        L.IsActive,
        L.CapacityVolumeCm3,
        L.CapacityWidthCm,
        L.CapacityLengthCm,
        L.CapacityHeightCm
      FROM [dbo].[Locations] L
      LEFT JOIN [dbo].[tblWH] W ON L.whid = W.whid
      -- Sorting is performed after the read, without a SQL sort memory grant.
    `;
    const result = await pool.request().query(query);
    result.recordset.sort((a,b)=>a.whid-b.whid||String(a.Zone||'').localeCompare(String(b.Zone||''),'en',{sensitivity:'base'})||String(a.LocationCode||'').localeCompare(String(b.LocationCode||''),'en',{sensitivity:'base'}));
    res.set('Cache-Control','no-store').json(result.recordset);
  } catch (err) {
    console.error('API /locations GET Error:', err.code||err.message);
    require('../services/sql-timeout-diagnostics')(poolPromise,'GET /master/locations',err);
    res.status(err.code==='ETIMEOUT'?503:500).json({error:err.code==='ETIMEOUT'?'ฐานข้อมูลตอบช้าในการโหลดโลเคชั่น กรุณากดรีเฟรชอีกครั้ง':'โหลดโลเคชั่นไม่สำเร็จ กรุณาตรวจบันทึกเซิร์ฟเวอร์'});
  }
});

// 2. POST ADD LOCATION
router.post('/locations', async (req, res) => {
  try {
    validateLocation(req.body||{},undefined);
    const {
      whid,
      locationCode,
      zone,
      description,
      isActive,
      capacityWidthCm,
      capacityLengthCm,
      capacityHeightCm,
      capacityVolumeCm3
    } = req.body;

    if (!locationCode || !zone) {
      return res.status(400).json({ error: 'กรุณากรอกรหัสโลเคชั่นและโซน' });
    }

    const capacity = locationCapacity(req.body);
    const pool = await poolPromise;
    if(await locationExists(pool,locationCode,0))return duplicateLocation(res,locationCode);
    await pool.request()
      .input('whid', sql.Int, whid || 1)
      .input('LocationCode', sql.NVarChar(50), locationCode.trim().toUpperCase())
      .input('Zone', sql.NVarChar(20), zone.trim().toUpperCase())
      .input('Description', sql.NVarChar(100), description ? description.trim() : null)
      .input('IsActive', sql.Bit, isActive ? 1 : 0)
      .input('CapacityWidthCm', sql.NVarChar(32), capacity[0])
      .input('CapacityLengthCm', sql.NVarChar(32), capacity[1])
      .input('CapacityHeightCm', sql.NVarChar(32), capacity[2])
      .input('CapacityVolumeCm3', sql.NVarChar(32), capacity[3])
      .query(`
        INSERT INTO [dbo].[Locations]
          ([whid], [LocationCode], [Zone], [Description], [IsActive], [CapacityWidthCm], [CapacityLengthCm], [CapacityHeightCm], [CapacityVolumeCm3])
        VALUES
          (@whid, @LocationCode, @Zone, @Description, @IsActive, CONVERT(decimal(18,3), @CapacityWidthCm), CONVERT(decimal(18,3), @CapacityLengthCm), CONVERT(decimal(18,3), @CapacityHeightCm), CONVERT(decimal(18,3), @CapacityVolumeCm3));
      `);

    res.json({ success: true, message: 'เพิ่มโลเคชั่นเรียบร้อย' });
  } catch (err) {
    console.error('API /locations POST Error:', err);
    locationSaveError(res,err,req.body?.locationCode);
  }
});

// 3. PUT EDIT LOCATION
router.put('/locations/:id', async (req, res) => {
  try {
    validateLocation(req.body||{},req.params.id);
    const { id } = req.params;
    const {
      whid,
      locationCode,
      zone,
      description,
      isActive,
      capacityWidthCm,
      capacityLengthCm,
      capacityHeightCm,
      capacityVolumeCm3
    } = req.body;

    const capacity = locationCapacity(req.body);
    const pool = await poolPromise;
    if(await locationExists(pool,locationCode,id))return duplicateLocation(res,locationCode);
    await pool.request()
      .input('LocationId', sql.Int, id)
      .input('whid', sql.Int, whid || 1)
      .input('LocationCode', sql.NVarChar(50), locationCode.trim().toUpperCase())
      .input('Zone', sql.NVarChar(20), zone.trim().toUpperCase())
      .input('Description', sql.NVarChar(100), description ? description.trim() : null)
      .input('IsActive', sql.Bit, isActive ? 1 : 0)
      .input('CapacityWidthCm', sql.NVarChar(32), capacity[0])
      .input('CapacityLengthCm', sql.NVarChar(32), capacity[1])
      .input('CapacityHeightCm', sql.NVarChar(32), capacity[2])
      .input('CapacityVolumeCm3', sql.NVarChar(32), capacity[3])
      .query(`
        SET XACT_ABORT ON; BEGIN TRY BEGIN TRANSACTION;
        ${locationChangeGuard}
        UPDATE [dbo].[Locations]
        SET 
          [whid] = @whid,
          [LocationCode] = @LocationCode,
          [Zone] = @Zone,
          [Description] = @Description,
          [IsActive] = @IsActive,
          [CapacityWidthCm] = CONVERT(decimal(18,3), @CapacityWidthCm),
          [CapacityLengthCm] = CONVERT(decimal(18,3), @CapacityLengthCm),
          [CapacityHeightCm] = CONVERT(decimal(18,3), @CapacityHeightCm),
          [CapacityVolumeCm3] = CONVERT(decimal(18,3), @CapacityVolumeCm3)
        WHERE [LocationId] = @LocationId;
        COMMIT; END TRY BEGIN CATCH IF @@TRANCOUNT>0 ROLLBACK; THROW; END CATCH;
      `);

    res.json({ success: true, message: 'แก้ไขโลเคชั่นเรียบร้อย' });
  } catch (err) {
    console.error('API /locations PUT Error:', err);
    locationSaveError(res,err,req.body?.locationCode);
  }
});

// 4. DELETE LOCATION
router.delete('/locations/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const pool = await poolPromise;
    await pool.request()
      .input('LocationId', sql.Int, id)
      .query(`SET XACT_ABORT ON; BEGIN TRY BEGIN TRANSACTION;
       DECLARE @whid int,@LocationCode nvarchar(50),@IsActive bit=0,@Zone nvarchar(20);
       SELECT @whid=whid,@LocationCode=LocationCode,@Zone=Zone FROM dbo.Locations WHERE LocationId=@LocationId;
       ${locationChangeGuard}
       UPDATE dbo.Locations SET IsActive=0 WHERE LocationId=@LocationId;
       COMMIT; END TRY BEGIN CATCH IF @@TRANCOUNT>0 ROLLBACK; THROW; END CATCH;`);

    res.json({ success: true, message: 'ลบโลเคชั่นเรียบร้อย' });
  } catch (err) {
    console.error('API /locations DELETE Error:', err);
    if(locationConflict(res,err))return;
    res.status(err.status || 500).json({ error: err.message });
  }
});

module.exports = router;