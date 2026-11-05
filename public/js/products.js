const express = require('express');
const router = express.Router();

// ดึงการเชื่อมต่อ Database อัตโนมัติ (รองรับทั้ง db, db_4, db_3, db_2 หรือโฟลเดอร์ config)
let dbModule;
const possiblePaths = ['../db', '../db_4', '../db_3', '../db_2', '../config/db'];
for (const p of possiblePaths) {
  try {
    dbModule = require(p);
    break;
  } catch (e) {}
}

if (!dbModule) {
  throw new Error('ไม่พบโมดูลเชื่อมต่อฐานข้อมูลในโฟลเดอร์ src/ กรุณาตรวจสอบไฟล์ db.js');
}

const { sql, poolPromise } = dbModule;

// ==========================================
// 1. GET: สรุปภาพรวมสินค้าสำหรับ Dashboard KPI
// Endpoint: GET /api/products/summary
// ==========================================
router.get('/summary', async (req, res) => {
  try {
    const pool = await poolPromise;
    const result = await pool.request().query(`
      SELECT 
        COUNT(*) AS TotalCount,
        SUM(CASE WHEN CategoryId = 1 THEN 1 ELSE 0 END) AS TotalRM,
        SUM(CASE WHEN CategoryId = 2 THEN 1 ELSE 0 END) AS TotalPKG,
        SUM(CASE WHEN CategoryId = 3 THEN 1 ELSE 0 END) AS TotalFG,
        SUM(CASE WHEN IsActive = 1 THEN 1 ELSE 0 END) AS TotalActive,
        SUM(CASE WHEN IsActive = 0 THEN 1 ELSE 0 END) AS TotalInactive
      FROM dbo.tblProducts
    `);
    res.json({ success: true, data: result.recordset[0] });
  } catch (err) {
    res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาดในการโหลด KPI: ' + err.message });
  }
});

// ==========================================
// 2. GET: ค้นหาด่วนด้วย Barcode หรือ ProductCode (สำหรับ Handheld Scanner)
// Endpoint: GET /api/products/lookup/:code
// ==========================================
router.get('/lookup/:code', async (req, res) => {
  try {
    const pool = await poolPromise;
    const code = req.params.code ? req.params.code.trim() : '';
    const result = await pool.request()
      .input('code', sql.NVarChar, code)
      .query(`
        SELECT TOP 1
          p.ProductId,
          p.ProductCode,
          p.ProductName,
          p.ThaiName,
          p.Barcode,
          p.CategoryId,
          c.CategoryName,
          c.CategoryCode,
          p.UnitId,
          u.UnitCode,
          p.StandardCost,
          p.Specification,
          p.IsActive
        FROM dbo.tblProducts p
        LEFT JOIN dbo.tblCategories c ON p.CategoryId = c.CategoryId
        LEFT JOIN dbo.tblUnits u ON p.UnitId = u.UnitId
        WHERE (p.Barcode = @code OR p.ProductCode = @code) AND p.IsActive = 1
      `);

    if (result.recordset.length === 0) {
      return res.status(404).json({ success: false, message: `ไม่พบสินค้าที่มีรหัสหรือบาร์โค้ด "${code}"` });
    }
    res.json({ success: true, data: result.recordset[0] });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ==========================================
// 3. GET: รายการสินค้าพร้อมระบบแบ่งหน้า (Search & Pagination)
// Endpoint: GET /api/products?page=1&limit=20&search=...&categoryId=1&unitId=1
// ==========================================
router.get('/', async (req, res) => {
  try {
    const pool = await poolPromise;
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.max(1, Math.min(100, parseInt(req.query.limit, 10) || 20));
    const offset = (page - 1) * limit;
    const search = req.query.search ? req.query.search.trim() : '';
    const categoryId = req.query.categoryId ? parseInt(req.query.categoryId, 10) : null;
    const unitId = req.query.unitId ? parseInt(req.query.unitId, 10) : null;
    const status = req.query.status !== undefined ? req.query.status : null; // active/inactive

    let whereClause = 'WHERE 1=1';
    const request = pool.request();

    if (search) {
      whereClause += ` AND (
        p.ProductCode LIKE @search 
        OR p.ProductName LIKE @search 
        OR p.ThaiName LIKE @search 
        OR p.Barcode LIKE @search
        OR p.Brand LIKE @search
      )`;
      request.input('search', sql.NVarChar, `%${search}%`);
    }

    if (categoryId) {
      whereClause += ` AND p.CategoryId = @categoryId`;
      request.input('categoryId', sql.Int, categoryId);
    }

    if (unitId) {
      whereClause += ` AND p.UnitId = @unitId`;
      request.input('unitId', sql.Int, unitId);
    }

    if (status !== null && status !== '') {
      whereClause += ` AND p.IsActive = @status`;
      request.input('status', sql.Bit, status === '1' || status === 'true');
    }

    // นับจำนวนรวม
    const countResult = await request.query(`
      SELECT COUNT(*) AS TotalCount 
      FROM dbo.tblProducts p 
      ${whereClause}
    `);
    const totalItems = countResult.recordset[0].TotalCount;

    // ดึงชุดข้อมูล
    request.input('offset', sql.Int, offset);
    request.input('limit', sql.Int, limit);

    const dataResult = await request.query(`
      SELECT 
        p.ProductId,
        p.ProductCode,
        p.ProductName,
        p.ThaiName,
        p.Specification,
        p.CategoryId,
        c.CategoryCode,
        c.CategoryName,
        p.UnitId,
        u.UnitCode,
        p.Brand,
        p.Barcode,
        p.NotificationNo,
        p.StandardCost,
        p.CountryOfOrigin,
        p.IsActive,
        p.CreatedAt,
        p.UpdatedAt
      FROM dbo.tblProducts p
      LEFT JOIN dbo.tblCategories c ON p.CategoryId = c.CategoryId
      LEFT JOIN dbo.tblUnits u ON p.UnitId = u.UnitId
      ${whereClause}
      ORDER BY p.ProductId ASC
      OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY
    `);

    res.json({
      success: true,
      data: dataResult.recordset,
      pagination: {
        page,
        limit,
        totalItems,
        totalPages: Math.ceil(totalItems / limit) || 1
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'ดึงข้อมูลสินค้าไม่สำเร็จ: ' + err.message });
  }
});

// ==========================================
// 4. GET: รายละเอียดสินค้าแบบรายตัว (By ID)
// Endpoint: GET /api/products/:id
// ==========================================
router.get('/:id', async (req, res) => {
  try {
    const pool = await poolPromise;
    const result = await pool.request()
      .input('id', sql.Int, req.params.id)
      .query(`
        SELECT 
          p.*,
          c.CategoryName,
          c.CategoryCode,
          u.UnitCode
        FROM dbo.tblProducts p
        LEFT JOIN dbo.tblCategories c ON p.CategoryId = c.CategoryId
        LEFT JOIN dbo.tblUnits u ON p.UnitId = u.UnitId
        WHERE p.ProductId = @id
      `);

    if (result.recordset.length === 0) {
      return res.status(404).json({ success: false, message: 'ไม่พบรายการสินค้านี้ในระบบ' });
    }
    res.json({ success: true, data: result.recordset[0] });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ==========================================
// 5. POST: เพิ่มสินค้าใหม่
// Endpoint: POST /api/products
// ==========================================
router.post('/', async (req, res) => {
  const {
    productCode,
    productName,
    thaiName,
    barcode,
    categoryId,
    unitId,
    brand,
    standardCost,
    specification,
    countryOfOrigin
  } = req.body;

  if (!productCode || !productName || !categoryId || !unitId) {
    return res.status(400).json({
      success: false,
      message: 'กรุณากรอกรหัสสินค้า, ชื่อสินค้า, หมวดหมู่ และหน่วยนับให้ครบถ้วน'
    });
  }

  try {
    const pool = await poolPromise;

    // ตรวจสอบรหัสสินค้าซ้ำ
    const checkDup = await pool.request()
      .input('code', sql.NVarChar, productCode.trim())
      .query('SELECT 1 FROM dbo.tblProducts WHERE ProductCode = @code');

    if (checkDup.recordset.length > 0) {
      return res.status(400).json({ success: false, message: `รหัสสินค้า "${productCode}" มีอยู่ในระบบแล้ว` });
    }

    await pool.request()
      .input('code', sql.NVarChar, productCode.trim())
      .input('name', sql.NVarChar, productName.trim())
      .input('thaiName', sql.NVarChar, thaiName ? thaiName.trim() : null)
      .input('barcode', sql.NVarChar, barcode ? barcode.trim() : null)
      .input('catId', sql.Int, parseInt(categoryId, 10))
      .input('unitId', sql.Int, parseInt(unitId, 10))
      .input('brand', sql.NVarChar, brand ? brand.trim() : null)
      .input('cost', sql.Decimal(18, 4), parseFloat(standardCost) || 0.0)
      .input('spec', sql.NVarChar, specification ? specification.trim() : null)
      .input('origin', sql.NVarChar, countryOfOrigin ? countryOfOrigin.trim() : null)
      .query(`
        INSERT INTO dbo.tblProducts (
          ProductCode, ProductName, ThaiName, Barcode, CategoryId, UnitId,
          Brand, StandardCost, Specification, CountryOfOrigin, IsActive, CreatedAt, UpdatedAt
        ) VALUES (
          @code, @name, @thaiName, @barcode, @catId, @unitId,
          @brand, @cost, @spec, @origin, 1, GETDATE(), GETDATE()
        )
      `);

    res.json({ success: true, message: 'เพิ่มข้อมูลสินค้าเรียบร้อยแล้ว' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'บันทึกสินค้าไม่สำเร็จ: ' + err.message });
  }
});

// ==========================================
// 6. PUT: แก้ไขข้อมูลสินค้า
// Endpoint: PUT /api/products/:id
// ==========================================
router.put('/:id', async (req, res) => {
  const {
    productName,
    thaiName,
    barcode,
    categoryId,
    unitId,
    brand,
    standardCost,
    specification,
    countryOfOrigin,
    isActive
  } = req.body;

  if (!productName || !categoryId || !unitId) {
    return res.status(400).json({
      success: false,
      message: 'กรุณากรอกชื่อสินค้า, หมวดหมู่ และหน่วยนับ'
    });
  }

  try {
    const pool = await poolPromise;
    await pool.request()
      .input('id', sql.Int, req.params.id)
      .input('name', sql.NVarChar, productName.trim())
      .input('thaiName', sql.NVarChar, thaiName ? thaiName.trim() : null)
      .input('barcode', sql.NVarChar, barcode ? barcode.trim() : null)
      .input('catId', sql.Int, parseInt(categoryId, 10))
      .input('unitId', sql.Int, parseInt(unitId, 10))
      .input('brand', sql.NVarChar, brand ? brand.trim() : null)
      .input('cost', sql.Decimal(18, 4), parseFloat(standardCost) || 0.0)
      .input('spec', sql.NVarChar, specification ? specification.trim() : null)
      .input('origin', sql.NVarChar, countryOfOrigin ? countryOfOrigin.trim() : null)
      .input('active', sql.Bit, isActive !== undefined ? isActive : 1)
      .query(`
        UPDATE dbo.tblProducts SET
          ProductName = @name,
          ThaiName = @thaiName,
          Barcode = @barcode,
          CategoryId = @catId,
          UnitId = @unitId,
          Brand = @brand,
          StandardCost = @cost,
          Specification = @spec,
          CountryOfOrigin = @origin,
          IsActive = @active,
          UpdatedAt = GETDATE()
        WHERE ProductId = @id
      `);

    res.json({ success: true, message: 'อัปเดตข้อมูลสินค้าสำเร็จ' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'แก้ไขข้อมูลไม่สำเร็จ: ' + err.message });
  }
});

// ==========================================
// 7. DELETE: เปลี่ยนสถานะเป็น Inactive (Soft Delete)
// Endpoint: DELETE /api/products/:id
// ==========================================
router.delete('/:id', async (req, res) => {
  try {
    const pool = await poolPromise;
    await pool.request()
      .input('id', sql.Int, req.params.id)
      .query(`
        UPDATE dbo.tblProducts 
        SET IsActive = 0, UpdatedAt = GETDATE() 
        WHERE ProductId = @id
      `);

    res.json({ success: true, message: 'ระงับการใช้งานสินค้าเรียบร้อยแล้ว' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;