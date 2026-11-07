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
      ORDER BY L.whid ASC, L.Zone ASC, L.LocationCode ASC;
    `;
    const result = await pool.request().query(query);
    res.json(result.recordset);
  } catch (err) {
    console.error('API /locations GET Error:', err);
    res.status(err.status || 500).json({ error: err.message });
  }
});

// 2. POST ADD LOCATION
router.post('/locations', async (req, res) => {
  try {
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
    res.status(err.status || 500).json({ error: err.message });
  }
});

// 3. PUT EDIT LOCATION
router.put('/locations/:id', async (req, res) => {
  try {
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
      `);

    res.json({ success: true, message: 'แก้ไขโลเคชั่นเรียบร้อย' });
  } catch (err) {
    console.error('API /locations PUT Error:', err);
    res.status(err.status || 500).json({ error: err.message });
  }
});

// 4. DELETE LOCATION
router.delete('/locations/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const pool = await poolPromise;
    await pool.request()
      .input('LocationId', sql.Int, id)
      .query(`IF EXISTS(SELECT 1 FROM dbWMS.dbo.tblStock s JOIN dbo.Locations l ON s.whid=l.whid AND s.LocationCode=l.LocationCode WHERE l.LocationId=@LocationId AND s.Quantity<>0) OR EXISTS(SELECT 1 FROM dbWMS.dbo.StoragePlans h JOIN dbWMS.dbo.StoragePlanLines pl ON pl.PlanId=h.PlanId JOIN dbo.Locations l ON l.whid=h.WhId AND (l.LocationCode=h.FromLocationCode OR l.LocationCode=pl.ToLocationCode) WHERE l.LocationId=@LocationId AND h.Status='OPEN') THROW 51000,N'ตำแหน่งมีสต๊อกหรืองานจัดเก็บค้างอยู่',1; UPDATE dbo.Locations SET IsActive=0 WHERE LocationId=@LocationId;`);

    res.json({ success: true, message: 'ลบโลเคชั่นเรียบร้อย' });
  } catch (err) {
    console.error('API /locations DELETE Error:', err);
    res.status(err.status || 500).json({ error: err.message });
  }
});

module.exports = router;