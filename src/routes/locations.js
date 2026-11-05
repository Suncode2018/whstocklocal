const express = require('express');
const router = express.Router();
const { poolPromise, sql } = require('../config/db');

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
    res.status(500).json({ error: err.message });
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

    const pool = await poolPromise;
    await pool.request()
      .input('whid', sql.Int, whid || 1)
      .input('LocationCode', sql.NVarChar(50), locationCode.trim().toUpperCase())
      .input('Zone', sql.NVarChar(20), zone.trim().toUpperCase())
      .input('Description', sql.NVarChar(100), description ? description.trim() : null)
      .input('IsActive', sql.Bit, isActive ? 1 : 0)
      .input('CapacityWidthCm', sql.Decimal(18, 3), capacityWidthCm || null)
      .input('CapacityLengthCm', sql.Decimal(18, 3), capacityLengthCm || null)
      .input('CapacityHeightCm', sql.Decimal(18, 3), capacityHeightCm || null)
      .input('CapacityVolumeCm3', sql.Decimal(18, 3), capacityVolumeCm3 || null)
      .query(`
        INSERT INTO [dbo].[Locations]
          ([whid], [LocationCode], [Zone], [Description], [IsActive], [CapacityWidthCm], [CapacityLengthCm], [CapacityHeightCm], [CapacityVolumeCm3])
        VALUES
          (@whid, @LocationCode, @Zone, @Description, @IsActive, @CapacityWidthCm, @CapacityLengthCm, @CapacityHeightCm, @CapacityVolumeCm3);
      `);

    res.json({ success: true, message: 'เพิ่มโลเคชั่นเรียบร้อย' });
  } catch (err) {
    console.error('API /locations POST Error:', err);
    res.status(500).json({ error: err.message });
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

    const pool = await poolPromise;
    await pool.request()
      .input('LocationId', sql.Int, id)
      .input('whid', sql.Int, whid || 1)
      .input('LocationCode', sql.NVarChar(50), locationCode.trim().toUpperCase())
      .input('Zone', sql.NVarChar(20), zone.trim().toUpperCase())
      .input('Description', sql.NVarChar(100), description ? description.trim() : null)
      .input('IsActive', sql.Bit, isActive ? 1 : 0)
      .input('CapacityWidthCm', sql.Decimal(18, 3), capacityWidthCm || null)
      .input('CapacityLengthCm', sql.Decimal(18, 3), capacityLengthCm || null)
      .input('CapacityHeightCm', sql.Decimal(18, 3), capacityHeightCm || null)
      .input('CapacityVolumeCm3', sql.Decimal(18, 3), capacityVolumeCm3 || null)
      .query(`
        UPDATE [dbo].[Locations]
        SET 
          [whid] = @whid,
          [LocationCode] = @LocationCode,
          [Zone] = @Zone,
          [Description] = @Description,
          [IsActive] = @IsActive,
          [CapacityWidthCm] = @CapacityWidthCm,
          [CapacityLengthCm] = @CapacityLengthCm,
          [CapacityHeightCm] = @CapacityHeightCm,
          [CapacityVolumeCm3] = @CapacityVolumeCm3
        WHERE [LocationId] = @LocationId;
      `);

    res.json({ success: true, message: 'แก้ไขโลเคชั่นเรียบร้อย' });
  } catch (err) {
    console.error('API /locations PUT Error:', err);
    res.status(500).json({ error: err.message });
  }
});

// 4. DELETE LOCATION
router.delete('/locations/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const pool = await poolPromise;
    await pool.request()
      .input('LocationId', sql.Int, id)
      .query(`DELETE FROM [dbo].[Locations] WHERE [LocationId] = @LocationId;`);

    res.json({ success: true, message: 'ลบโลเคชั่นเรียบร้อย' });
  } catch (err) {
    console.error('API /locations DELETE Error:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;