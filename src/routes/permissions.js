const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const { poolPromise, sql } = require('../config/db');

const JWT_SECRET = process.env.JWT_SECRET || 'super_secret_local_warehouse_jwt_key_2026';

// Middleware สำหรับ Admin เท่านั้น (ใช้กับเมนูจัดการ Master)
function requireAdmin(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) return res.status(401).json({ success: false, message: 'กรุณาเข้าสู่ระบบ' });

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return res.status(403).json({ success: false, isExpired: true, message: 'เซสชันหมดอายุ' });
    if (user.role !== 'ADMIN') {
      return res.status(403).json({ success: false, message: 'เฉพาะผู้ดูแลระบบ (ADMIN) เท่านั้น' });
    }
    req.user = user;
    next();
  });
}

// Middleware: อนุญาตให้ผู้ใช้ที่ล็อกอินแล้วทุกคน (ADMIN และ OPERATOR) เข้าถึงได้
function verifyToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) return res.status(401).json({ success: false, message: 'กรุณาเข้าสู่ระบบ' });

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return res.status(403).json({ success: false, isExpired: true, message: 'เซสชันหมดอายุ' });
    req.user = user;
    next();
  });
}

// 1. GET /api/permissions (ดึงรายการสิทธิ์ทั้งหมดสำหรับหน้าจัดการ Master - เฉพาะ ADMIN)
router.get('/', requireAdmin, async (req, res) => {
  try {
    const pool = await poolPromise;
    const result = await pool.request().query(`
      SELECT PermissionId, PermissionCode, PermissionName, Description, IsActive, CreatedAt 
      FROM Permissions 
      ORDER BY PermissionId ASC
    `);
    res.json({ success: true, data: result.recordset });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// 2. GET /api/permissions/all (ดึงรายการสิทธิ์ที่เปิดใช้งาน - ใช้ verifyToken เพื่อให้ Handheld ทุกคนเรียกได้)
router.get('/all', verifyToken, async (req, res) => {
  try {
    const pool = await poolPromise;
    const result = await pool.request().query(`
      SELECT PermissionCode, PermissionName, Description, IsActive 
      FROM Permissions 
      WHERE IsActive = 1 
      ORDER BY PermissionId ASC
    `);
    res.json({ success: true, data: result.recordset });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// 3. GET /api/permissions/:id (ดึงข้อมูลรายรายการสำหรับปุ่มแก้ไข - เฉพาะ ADMIN)
router.get('/:id', requireAdmin, async (req, res) => {
  const permId = parseInt(req.params.id);
  if (isNaN(permId)) return res.status(400).json({ success: false, message: 'รหัสสิทธิ์ไม่ถูกต้อง' });

  try {
    const pool = await poolPromise;
    const result = await pool.request()
      .input('PermissionId', sql.Int, permId)
      .query(`SELECT PermissionId, PermissionCode, PermissionName, Description, IsActive FROM Permissions WHERE PermissionId = @PermissionId`);

    if (result.recordset.length === 0) {
      return res.status(404).json({ success: false, message: 'ไม่พบข้อมูลสิทธิ์เมนู' });
    }

    res.json({ success: true, data: result.recordset[0] });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// 4. POST /api/permissions (เพิ่มสิทธิ์เมนูใหม่ - เฉพาะ ADMIN)
router.post('/', requireAdmin, async (req, res) => {
  const { code, name, desc, isActive } = req.body;
  if (!code || !name) {
    return res.status(400).json({ success: false, message: 'กรุณากรอกรหัสสิทธิ์และชื่อเมนู' });
  }

  const activeVal = (isActive !== undefined) ? (isActive ? 1 : 0) : 1;

  try {
    const pool = await poolPromise;
    const check = await pool.request()
      .input('PermissionCode', sql.VarChar, code.trim().toUpperCase())
      .query('SELECT 1 FROM Permissions WHERE PermissionCode = @PermissionCode');

    if (check.recordset.length > 0) {
      return res.status(400).json({ success: false, message: 'รหัสสิทธิ์นี้มีอยู่ในระบบแล้ว' });
    }

    await pool.request()
      .input('PermissionCode', sql.VarChar, code.trim().toUpperCase())
      .input('PermissionName', sql.NVarChar, name.trim())
      .input('Description', sql.NVarChar, desc ? desc.trim() : '')
      .input('IsActive', sql.Bit, activeVal)
      .query(`
        INSERT INTO Permissions (PermissionCode, PermissionName, Description, IsActive)
        VALUES (@PermissionCode, @PermissionName, @Description, @IsActive)
      `);

    res.json({ success: true, message: 'เพิ่มสิทธิ์เมนูเรียบร้อย' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// 5. PUT /api/permissions/:id (อัปเดตสิทธิ์เมนู - เฉพาะ ADMIN)
router.put('/:id', requireAdmin, async (req, res) => {
  const permId = parseInt(req.params.id);
  const { name, desc, isActive } = req.body;
  const activeVal = (isActive !== undefined) ? (isActive ? 1 : 0) : 1;

  if (isNaN(permId)) return res.status(400).json({ success: false, message: 'รหัสสิทธิ์ไม่ถูกต้อง' });

  try {
    const pool = await poolPromise;
    await pool.request()
      .input('PermissionId', sql.Int, permId)
      .input('PermissionName', sql.NVarChar, name ? name.trim() : '')
      .input('Description', sql.NVarChar, desc ? desc.trim() : '')
      .input('IsActive', sql.Bit, activeVal)
      .query(`
        UPDATE Permissions 
        SET PermissionName = @PermissionName, Description = @Description, IsActive = @IsActive 
        WHERE PermissionId = @PermissionId
      `);

    res.json({ success: true, message: 'อัปเดตสิทธิ์เมนูเรียบร้อย' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// 6. DELETE /api/permissions/:id (ลบสิทธิ์เมนู - เฉพาะ ADMIN)
router.delete('/:id', requireAdmin, async (req, res) => {
  const permId = parseInt(req.params.id);
  if (isNaN(permId)) return res.status(400).json({ message: 'รหัสสิทธิ์ไม่ถูกต้อง' });

  try {
    const pool = await poolPromise;
    await pool.request()
      .input('PermissionId', sql.Int, permId)
      .query('DELETE FROM Permissions WHERE PermissionId = @PermissionId');

    res.json({ success: true, message: 'ลบสิทธิ์เมนูเรียบร้อย' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;