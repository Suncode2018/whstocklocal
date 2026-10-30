const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { poolPromise, sql } = require('../config/db');

// Middleware ตรวจสอบสิทธิ์ Admin
function requireAdmin(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) return res.status(401).json({ success: false, message: 'กรุณาเข้าสู่ระบบ' });

  jwt.verify(token, process.env.JWT_SECRET || 'super_secret_local_warehouse_jwt_key_2026', (err, user) => {
    if (err) return res.status(403).json({ success: false, isExpired: true, message: 'เซสชันหมดอายุ' });
    if (user.role !== 'ADMIN') {
      return res.status(403).json({ success: false, message: 'เฉพาะผู้ดูแลระบบ (ADMIN) เท่านั้น' });
    }
    req.user = user;
    next();
  });
}

// 1. GET /api/users - ดึงรายชื่อผู้ใช้ทั้งหมด
router.get('/', requireAdmin, async (req, res) => {
  try {
    const pool = await poolPromise;
    const result = await pool.request().query(`
      SELECT UserId, Username, FullName, Role, IsActive, CreatedAt 
      FROM Users 
      ORDER BY UserId ASC
    `);
    res.json({ success: true, data: result.recordset });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// 2. POST /api/users - เพิ่มผู้ใช้ใหม่
router.post('/', requireAdmin, async (req, res) => {
  const { username, password, fullName, role } = req.body;
  if (!username || !password || !fullName || !role) {
    return res.status(400).json({ success: false, message: 'กรุณากรอกข้อมูลให้ครบถ้วน' });
  }

  try {
    const pool = await poolPromise;
    // ตรวจสอบ username ซ้ำ
    const checkUser = await pool.request()
      .input('Username', sql.NVarChar, username.trim())
      .query('SELECT 1 FROM Users WHERE LOWER(Username) = LOWER(@Username)');

    if (checkUser.recordset.length > 0) {
      return res.status(400).json({ success: false, message: 'ชื่อผู้ใช้นี้มีอยู่ในระบบแล้ว' });
    }

    const hash = await bcrypt.hash(password, 10);
    await pool.request()
      .input('Username', sql.NVarChar, username.trim())
      .input('PasswordHash', sql.NVarChar, hash)
      .input('FullName', sql.NVarChar, fullName.trim())
      .input('Role', sql.NVarChar, role.toUpperCase())
      .query(`
        INSERT INTO Users (Username, PasswordHash, FullName, Role, IsActive)
        VALUES (@Username, @PasswordHash, @FullName, @Role, 1)
      `);

    res.json({ success: true, message: 'เพิ่มผู้ใช้งานสำเร็จเรียบร้อย' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// 3. PUT /api/users/:id - แก้ไขข้อมูลผู้ใช้ / เปลี่ยนรหัสผ่าน
router.put('/:id', requireAdmin, async (req, res) => {
  const userId = parseInt(req.params.id);
  const { fullName, role, isActive, password } = req.body;

  try {
    const pool = await poolPromise;
    const reqUpdate = pool.request()
      .input('UserId', sql.Int, userId)
      .input('FullName', sql.NVarChar, fullName.trim())
      .input('Role', sql.NVarChar, role.toUpperCase())
      .input('IsActive', sql.Bit, isActive ? 1 : 0);

    let queryStr = `
      UPDATE Users 
      SET FullName = @FullName, Role = @Role, IsActive = @IsActive
    `;

    // ถ้ามีการเปลี่ยนรหัสผ่านด้วย
    if (password && password.trim() !== '') {
      const hash = await bcrypt.hash(password.trim(), 10);
      reqUpdate.input('PasswordHash', sql.NVarChar, hash);
      queryStr += `, PasswordHash = @PasswordHash `;
    }

    queryStr += ` WHERE UserId = @UserId`;
    await reqUpdate.query(queryStr);

    res.json({ success: true, message: 'อัปเดตข้อมูลผู้ใช้งานเรียบร้อย' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// 4. DELETE /api/users/:id - ลบผู้ใช้
router.delete('/:id', requireAdmin, async (req, res) => {
  const targetId = parseInt(req.params.id);

  // ห้ามลบบัญชีตัวเอง
  if (targetId === req.user.userId) {
    return res.status(400).json({ success: false, message: 'ไม่อนุญาตให้ลบบัญชีที่กำลังล็อกอินอยู่' });
  }

  try {
    const pool = await poolPromise;
    try {
      await pool.request()
        .input('UserId', sql.Int, targetId)
        .query('DELETE FROM Users WHERE UserId = @UserId');
      res.json({ success: true, message: 'ลบผู้ใช้งานเรียบร้อย' });
    } catch (fkErr) {
      // ถ้าติด Foreign Key จากประวัติสต๊อก ให้ปรับเป็นระงับการใช้งานแทน
      await pool.request()
        .input('UserId', sql.Int, targetId)
        .query('UPDATE Users SET IsActive = 0 WHERE UserId = @UserId');
      res.json({ 
        success: true, 
        message: 'ผู้ใช้นี้มีประวัติการทำรายการในระบบแล้ว ระบบจึงเปลี่ยนสถานะเป็น "ระงับการใช้งาน" ให้แทนการลบ' 
      });
    }
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;