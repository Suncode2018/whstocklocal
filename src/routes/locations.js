const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const { poolPromise, sql } = require('../config/db');

const JWT_SECRET = process.env.JWT_SECRET || 'super_secret_local_warehouse_jwt_key_2026';

function authenticate(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) return res.status(401).json({ success: false, message: 'กรุณาเข้าสู่ระบบ' });

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return res.status(403).json({ success: false, message: 'เซสชันหมดอายุ' });
    req.user = user;
    next();
  });
}

function requireAdmin(req, res, next) {
  if (req.user?.role !== 'ADMIN') return res.status(403).json({ success: false, message: 'เฉพาะ ADMIN เท่านั้น' });
  next();
}

function requireAdminOrPowerUser(req, res, next) {
  if (!['ADMIN', 'POWERUSER'].includes(req.user?.role)) {
    return res.status(403).json({ success: false, message: 'เฉพาะ ADMIN หรือ POWERUSER เท่านั้น' });
  }
  next();
}

// GET /api/locations (ดึงรายการโลเคชั่นทั้งหมด)
router.get('/', authenticate, requireAdminOrPowerUser, async (req, res) => {
  try {
    const pool = await poolPromise;
    const result = await pool.request().query(`
      SELECT LocationId, LocationCode, Zone, Description, IsActive 
      FROM Locations 
      ORDER BY LocationId ASC
    `);
    res.json({ success: true, data: result.recordset });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST /api/locations (เพิ่มโลเคชั่นใหม่)
router.post('/', authenticate, requireAdminOrPowerUser, async (req, res) => {
  const code = req.body.locationCode || req.body.code;
  const zone = req.body.zone;
  const desc = req.body.description || req.body.desc;
  const { isActive } = req.body;
  if (!code) return res.status(400).json({ success: false, message: 'กรุณากรอกรหัสโลเคชั่น' });

  const activeVal = (isActive !== undefined) ? (isActive ? 1 : 0) : 1;

  try {
    const pool = await poolPromise;
    const check = await pool.request()
      .input('LocationCode', sql.VarChar, code.trim().toUpperCase())
      .query('SELECT 1 FROM Locations WHERE LocationCode = @LocationCode');

    if (check.recordset.length > 0) {
      return res.status(400).json({ success: false, message: 'รหัสโลเคชั่นนี้มีอยู่ในระบบแล้ว' });
    }

    await pool.request()
      .input('LocationCode', sql.VarChar, code.trim().toUpperCase())
      .input('Zone', sql.VarChar, zone ? zone.trim().toUpperCase() : '')
      .input('Description', sql.NVarChar, desc ? desc.trim() : '')
      .input('IsActive', sql.Bit, activeVal)
      .query(`
        INSERT INTO Locations (LocationCode, Zone, Description, IsActive)
        VALUES (@LocationCode, @Zone, @Description, @IsActive)
      `);

    res.json({ success: true, message: 'เพิ่มโลเคชั่นเรียบร้อย' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// PUT /api/locations/:id (แก้ไขโลเคชั่น)
router.put('/:id', authenticate, requireAdminOrPowerUser, async (req, res) => {
  const locId = parseInt(req.params.id);
  const { zone, isActive } = req.body;
  const desc = req.body.description || req.body.desc;
  const activeVal = (isActive !== undefined) ? (isActive ? 1 : 0) : 1;

  if (isNaN(locId)) return res.status(400).json({ success: false, message: 'รหัสโลเคชั่นไม่ถูกต้อง' });

  try {
    const pool = await poolPromise;
    await pool.request()
      .input('LocationId', sql.Int, locId)
      .input('Zone', sql.VarChar, zone ? zone.trim().toUpperCase() : '')
      .input('Description', sql.NVarChar, desc ? desc.trim() : '')
      .input('IsActive', sql.Bit, activeVal)
      .query(`
        UPDATE Locations 
        SET Zone = @Zone, Description = @Description, IsActive = @IsActive 
        WHERE LocationId = @LocationId
      `);

    res.json({ success: true, message: 'อัปเดตโลเคชั่นเรียบร้อย' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// DELETE /api/locations/:id (ลบโลเคชั่น)
router.delete('/:id', authenticate, requireAdmin, async (req, res) => {
  const locId = parseInt(req.params.id);
  if (isNaN(locId)) return res.status(400).json({ success: false, message: 'รหัสโลเคชั่นไม่ถูกต้อง' });

  try {
    const pool = await poolPromise;
    await pool.request()
      .input('LocationId', sql.Int, locId)
      .query('DELETE FROM Locations WHERE LocationId = @LocationId');

    res.json({ success: true, message: 'ลบโลเคชั่นเรียบร้อย' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
