const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');

// 1. ดึงโมดูลเชื่อมต่อฐานข้อมูล
const {sql,poolPromise}=require('../config/db');
const JWT_SECRET = process.env.JWT_SECRET || 'super_secret_local_warehouse_jwt_key_2026';

// 2. Middleware ตรวจสอบสิทธิ์
function authenticate(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) return res.status(401).json({ success: false, message: 'กรุณาเข้าสู่ระบบ' });

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return res.status(403).json({ success: false, isExpired: true, message: 'เซสชันหมดอายุ' });
    req.user = user;
    next();
  });
}

function requireAdmin(req, res, next) {
  if (req.user?.role !== 'ADMIN') {
    return res.status(403).json({ success: false, message: 'เฉพาะผู้ดูแลระบบ (ADMIN) เท่านั้น' });
  }
  next();
}

function requireAdminOrPowerUser(req, res, next) {
  if (!['ADMIN', 'POWERUSER'].includes(req.user?.role)) {
    return res.status(403).json({ success: false, message: 'เฉพาะ ADMIN หรือ POWERUSER เท่านั้น' });
  }
  next();
}

// 3. GET /api/products/summary (ยอด KPI Dashboard)
router.get('/summary', authenticate, async (req, res) => {
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
    res.status(500).json({ success: false, message: 'โหลด KPI ไม่สำเร็จ: ' + err.message });
  }
});

// 4. GET /api/products/lookup/:code (สแกนบาร์โค้ด Handheld)
router.get('/lookup/:code', authenticate, async (req, res) => {
  try {
    const pool = await poolPromise;
    const code = (req.params.code || '').trim();
    const result = await pool.request()
      .input('code', sql.NVarChar(50), code)
      .query(`
        SELECT TOP 1
          p.ProductId, p.ProductCode, p.ProductName, p.ThaiName,
          p.Barcode, p.Specification, p.PackageType AS UOM,
          p.UnitWidthCm, p.UnitLengthCm, p.UnitHeightCm, p.UnitVolumeCm3,
          p.StandardCost, p.IsActive
        FROM dbo.tblProducts p
        WHERE (p.Barcode = @code OR p.ProductCode = @code) AND p.IsActive = 1
      `);

    if (result.recordset.length === 0) {
      return res.status(404).json({ success: false, message: `ไม่พบสินค้า "${code}"` });
    }
    res.json({ success: true, data: result.recordset[0] });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// 5. GET /api/products (ดึงรายการสินค้า รวมทั้งชื่อภาษาไทย)
router.get('/', authenticate, async (req, res) => {
  try {
    const pool = await poolPromise;
    const search = req.query.search ? req.query.search.trim() : '';

    let whereClause = 'WHERE 1=1';
    const request = pool.request();

    if (search) {
      whereClause += ` AND (p.ProductCode LIKE @search OR p.ProductName LIKE @search OR p.ThaiName LIKE @search OR p.Barcode LIKE @search)`;
      request.input('search', sql.NVarChar, `%${search}%`);
    }

    const queryStr = `
      SELECT 
        p.ProductId,
        p.ProductCode,
        p.ProductCode AS ItemCode,
        p.ProductName,
        p.ProductName AS ItemName,
        p.ThaiName,
        p.Barcode,
        p.PackageType,
        p.CategoryId,
        p.IsActive,
        p.CreatedAt
      FROM dbo.tblProducts p
      ${whereClause}
      ORDER BY p.ProductId DESC
    `;

    const result = await request.query(queryStr);
    res.json(result.recordset);
  } catch (err) {
    res.status(500).json({ success: false, message: 'โหลดข้อมูลสินค้าไม่สำเร็จ: ' + err.message });
  }
});

// 6. POST /api/products (เพิ่มสินค้าใหม่)
router.post('/', authenticate, requireAdminOrPowerUser, async (req, res) => {
  const productCode = (req.body.productCode || req.body.itemCode || '').trim();
  const productName = (req.body.productName || req.body.itemName || '').trim();
  const thaiName = (req.body.thaiName || '').trim();
  const barcode = (req.body.barcode || '').trim();

  if (!productCode || !productName) {
    return res.status(400).json({ success: false, message: 'กรุณากรอกรหัสสินค้าและชื่อสินค้า' });
  }

  try {
    const pool = await poolPromise;

    const check = await pool.request()
      .input('ProductCode', sql.NVarChar(50), productCode)
      .query('SELECT 1 FROM dbo.tblProducts WHERE ProductCode = @ProductCode');

    if (check.recordset.length > 0) {
      return res.status(400).json({ success: false, message: `รหัสสินค้า "${productCode}" มีอยู่ในระบบแล้ว` });
    }

    await pool.request()
      .input('ProductCode', sql.NVarChar(50), productCode)
      .input('ProductName', sql.NVarChar(255), productName)
      .input('ThaiName', sql.NVarChar(255), thaiName || null)
      .input('Barcode', sql.NVarChar(50), barcode || null)
      .input('CategoryId', sql.Int, 1)
      .input('UnitId', sql.Int, 1)
      .query(`
        INSERT INTO dbo.tblProducts (
          ProductCode, ProductName, ThaiName, Barcode,
          CategoryId, UnitId, MinStock, MaxStock, StandardCost, IsActive, CreatedAt, UpdatedAt
        ) VALUES (
          @ProductCode, @ProductName, @ThaiName, @Barcode,
          @CategoryId, @UnitId, 0, 0, 0.0000, 1, GETDATE(), GETDATE()
        )
      `);

    res.json({ success: true, message: 'เพิ่มสินค้าเรียบร้อย' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// 7. PUT /api/products/:id (แก้ไขสินค้า)
router.put('/:id', authenticate, requireAdminOrPowerUser, async (req, res) => {
  const prodId = parseInt(req.params.id, 10);
  if (isNaN(prodId)) return res.status(400).json({ success: false, message: 'รหัสสินค้าไม่ถูกต้อง' });

  const productName = (req.body.productName || req.body.itemName || '').trim();
  const thaiName = (req.body.thaiName || '').trim();
  const barcode = (req.body.barcode || '').trim();

  if (!productName) {
    return res.status(400).json({ success: false, message: 'กรุณากรอกชื่อสินค้า' });
  }

  try {
    const pool = await poolPromise;
    await pool.request()
      .input('ProductId', sql.Int, prodId)
      .input('ProductName', sql.NVarChar(255), productName)
      .input('ThaiName', sql.NVarChar(255), thaiName || null)
      .input('Barcode', sql.NVarChar(50), barcode || null)
      .query(`
        UPDATE dbo.tblProducts SET
          ProductName = @ProductName,
          ThaiName = @ThaiName,
          Barcode = @Barcode,
          UpdatedAt = GETDATE()
        WHERE ProductId = @ProductId
      `);

    res.json({ success: true, message: 'แก้ไขข้อมูลสินค้าสำเร็จ' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// 8. DELETE /api/products/:id (ลบสินค้า)
router.delete('/:id', authenticate, requireAdmin, async (req, res) => {
  const prodId = parseInt(req.params.id, 10);
  if (isNaN(prodId)) return res.status(400).json({ success: false, message: 'รหัสสินค้าไม่ถูกต้อง' });

  try {
    const pool = await poolPromise;
    await pool.request()
      .input('ProductId', sql.Int, prodId)
      .query('UPDATE dbo.tblProducts SET IsActive = 0, UpdatedAt = GETDATE() WHERE ProductId = @ProductId');

    res.json({ success: true, message: 'ลบสินค้าเรียบร้อย' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;