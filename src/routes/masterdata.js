const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');

const {sql,poolPromise}=require('../config/db');

// ==========================================
// 1. Categories API (tblCategories)
// ==========================================

// GET: ดึงรายการหมวดหมู่ทั้งหมด
router.get('/categories', async (req, res) => {
  try {
    const pool = await poolPromise;
    const result = await pool.request().query('SELECT * FROM dbo.tblCategories ORDER BY CategoryId ASC');
    res.json({ success: true, data: result.recordset });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST: เพิ่มหมวดหมู่ใหม่
router.post('/categories', async (req, res) => {
  const { categoryCode, categoryName } = req.body;
  if (!categoryCode || !categoryName) {
    return res.status(400).json({ success: false, message: 'กรุณากรอกรหัสและชื่อหมวดหมู่' });
  }
  try {
    const pool = await poolPromise;
    await pool.request()
      .input('code', sql.NVarChar, categoryCode.trim().toUpperCase())
      .input('name', sql.NVarChar, categoryName.trim())
      .query('INSERT INTO dbo.tblCategories (CategoryCode, CategoryName) VALUES (@code, @name)');
    res.json({ success: true, message: 'เพิ่มหมวดหมู่สำเร็จ' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ==========================================
// 2. Units API (tblUnits)
// ==========================================

// GET: ดึงรายการหน่วยนับทั้งหมด (ดึงทุกคอลัมน์แบบ Dynamic)
router.get('/units', async (req, res) => {
  try {
    const pool = await poolPromise;
    const result = await pool.request().query('SELECT * FROM dbo.tblUnits ORDER BY 1 ASC');
    res.json({ success: true, data: result.recordset });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ==========================================
// 3. Product Groups API (tblProductGroups)
// ==========================================

// GET: ดึงรายการกลุ่มสินค้าทั้งหมด
router.get('/product-groups', async (req, res) => {
  try {
    const pool = await poolPromise;
    const result = await pool.request().query('SELECT * FROM dbo.tblProductGroups ORDER BY GroupId ASC');
    res.json({ success: true, data: result.recordset });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST: เพิ่มกลุ่มสินค้าใหม่
router.post('/product-groups', async (req, res) => {
  const { groupCode, groupName, brand, categoryType } = req.body;
  if (!groupCode || !groupName) {
    return res.status(400).json({ success: false, message: 'กรุณาระบุรหัสกลุ่มและชื่อกลุ่มสินค้า' });
  }
  try {
    const pool = await poolPromise;
    await pool.request()
      .input('code', sql.NVarChar, groupCode.trim())
      .input('name', sql.NVarChar, groupName.trim())
      .input('brand', sql.NVarChar, brand ? brand.trim() : null)
      .input('categoryType', sql.NVarChar, categoryType ? categoryType.trim() : null)
      .query(`
        INSERT INTO dbo.tblProductGroups (GroupCode, GroupName, Brand, CategoryType, Status, CreatedAt)
        VALUES (@code, @name, @brand, @categoryType, 'ACTIVE', GETDATE())
      `);
    res.json({ success: true, message: 'เพิ่มกลุ่มสินค้าสำเร็จ' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.get('/locations', async (req, res) => {
  try {
    const pool = await poolPromise;
    const result = await pool.request().query(`
      SELECT 
        L.LocationId,
        ISNULL(L.whid, 1) AS whid,
        ISNULL(W.whname, 'WH01') AS whname,
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
      ORDER BY L.whid ASC, L.Zone ASC, L.LocationCode ASC
    `);
    res.json(result.recordset);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==========================================
// Shortage Reasons CRUD API
// ==========================================

// 1. GET ALL
router.get('/shortage-reasons', async (req, res) => {
  try {
    const pool = await poolPromise;
    const result = await pool.request().query(`
      SELECT 
        [ReasonId],
        [ReasonCode],
        [ReasonName],
        [RequiresNote],
        [IsActive],
        [SortOrder],
        [CreatedAt],
        [UpdatedAt]
      FROM [dbo].[ShortageReasons]
      ORDER BY [SortOrder] ASC, [ReasonId] ASC
    `);
    res.json(result.recordset);
  } catch (err) {
    console.error('GET /shortage-reasons error:', err);
    res.status(500).json({ error: err.message });
  }
});

// 2. POST (CREATE)
router.post('/shortage-reasons', async (req, res) => {
  try {
    const { reasonCode, reasonName, requiresNote, isActive, sortOrder } = req.body;
    if (!reasonCode || !reasonName) {
      return res.status(400).json({ error: 'กรุณากรอกรหัสและชื่อเหตุผล' });
    }

    const pool = await poolPromise;
    await pool.request()
      .input('ReasonCode', sql.NVarChar(30), reasonCode.trim().toUpperCase())
      .input('ReasonName', sql.NVarChar(100), reasonName.trim())
      .input('RequiresNote', sql.Bit, requiresNote ? 1 : 0)
      .input('IsActive', sql.Bit, isActive !== false ? 1 : 0)
      .input('SortOrder', sql.Int, parseInt(sortOrder, 10) || 0)
      .query(`
        INSERT INTO [dbo].[ShortageReasons] 
          ([ReasonCode], [ReasonName], [RequiresNote], [IsActive], [SortOrder], [CreatedAt])
        VALUES 
          (@ReasonCode, @ReasonName, @RequiresNote, @IsActive, @SortOrder, SYSDATETIME())
      `);

    res.json({ success: true, message: 'เพิ่มเหตุผลขาดส่งเรียบร้อย' });
  } catch (err) {
    console.error('POST /shortage-reasons error:', err);
    res.status(500).json({ error: err.message });
  }
});

// 3. PUT (UPDATE)
router.put('/shortage-reasons/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { reasonCode, reasonName, requiresNote, isActive, sortOrder } = req.body;
    if (!reasonCode || !reasonName) {
      return res.status(400).json({ error: 'กรุณากรอกรหัสและชื่อเหตุผล' });
    }

    const pool = await poolPromise;
    await pool.request()
      .input('ReasonId', sql.Int, id)
      .input('ReasonCode', sql.NVarChar(30), reasonCode.trim().toUpperCase())
      .input('ReasonName', sql.NVarChar(100), reasonName.trim())
      .input('RequiresNote', sql.Bit, requiresNote ? 1 : 0)
      .input('IsActive', sql.Bit, isActive !== false ? 1 : 0)
      .input('SortOrder', sql.Int, parseInt(sortOrder, 10) || 0)
      .query(`
        UPDATE [dbo].[ShortageReasons]
        SET 
          [ReasonCode] = @ReasonCode,
          [ReasonName] = @ReasonName,
          [RequiresNote] = @RequiresNote,
          [IsActive] = @IsActive,
          [SortOrder] = @SortOrder,
          [UpdatedAt] = SYSDATETIME()
        WHERE [ReasonId] = @ReasonId
      `);

    res.json({ success: true, message: 'แก้ไขเหตุผลขาดส่งเรียบร้อย' });
  } catch (err) {
    console.error('PUT /shortage-reasons error:', err);
    res.status(500).json({ error: err.message });
  }
});

// 4. DELETE
router.delete('/shortage-reasons/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const pool = await poolPromise;
    await pool.request()
      .input('ReasonId', sql.Int, id)
      .query(`DELETE FROM [dbo].[ShortageReasons] WHERE [ReasonId] = @ReasonId`);

    res.json({ success: true, message: 'ลบเหตุผลขาดส่งเรียบร้อย' });
  } catch (err) {
    console.error('DELETE /shortage-reasons error:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;