const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { poolPromise, sql } = require('../config/db');

const JWT_SECRET = process.env.JWT_SECRET || 'super_secret_local_warehouse_jwt_key_2026';

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



// 1. GET /api/users (ดึงรายการผู้ใช้งานทั้งหมด)
router.get('/', requireAdmin, async (req, res) => {
  try {
    const pool = await poolPromise;
    const result = await pool.request().query(`
      SELECT UserId, Username, FullName, Role, IsActive, Permissions 
      FROM Users 
      ORDER BY UserId ASC
    `);
    res.json({ success: true, data: result.recordset });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// 2. GET /api/users/:id (ดึงข้อมูลผู้ใช้งานรายคน สำหรับปุ่มแก้ไข)
router.get('/:id', requireAdmin, async (req, res) => {
  const userId = parseInt(req.params.id);
  if (isNaN(userId)) {
    return res.status(400).json({ success: false, message: 'รหัสผู้ใช้งานไม่ถูกต้อง' });
  }

  try {
    const pool = await poolPromise;
    const result = await pool.request()
      .input('UserId', sql.Int, userId)
      .query(`
        SELECT UserId, Username, FullName, Role, Permissions, IsActive, CreatedAt 
        FROM Users 
        WHERE UserId = @UserId
      `);

    if (result.recordset.length === 0) {
      return res.status(404).json({ success: false, message: 'ไม่พบข้อมูลผู้ใช้งาน' });
    }

    const row = result.recordset[0];
    res.json({
      success: true,
      user: {
        Id: row.UserId,
        Username: row.Username,
        Fullname: row.FullName,
        Role: row.Role,
        Status: row.IsActive ? 1 : 0,
        Permissions: row.Permissions ? row.Permissions.split(',') : []
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// 3. POST /api/users (เพิ่มผู้ใช้งานใหม่)
router.post('/', requireAdmin, async (req, res) => {
  const { username, password, role, permissions } = req.body;
  // 💡 รองรับทั้ง fullName และ fullname ป้องกันค่าเป็น undefined
  const fullName = req.body.fullName || req.body.fullname;

  if (!username || !password || !fullName || !role) {
    return res.status(400).json({ success: false, message: 'กรุณากรอกข้อมูลให้ครบถ้วน' });
  }

  const permStr = Array.isArray(permissions) ? permissions.join(',') : (permissions || 'RECEIVE,PICK,TRANSFER,LOOKUP');

  try {
    const pool = await poolPromise;
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
      .input('Permissions', sql.NVarChar, permStr)
      .query(`
        INSERT INTO Users (Username, PasswordHash, FullName, Role, Permissions, IsActive)
        VALUES (@Username, @PasswordHash, @FullName, @Role, @Permissions, 1)
      `);

    res.json({ success: true, message: 'เพิ่มผู้ใช้งานสำเร็จเรียบร้อย' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// 4. PUT /api/users/:id (อัปเดตข้อมูลผู้ใช้งาน)
router.put('/:id', requireAdmin, async (req, res) => {
  const userId = parseInt(req.params.id);
  const { role, status, password, permissions } = req.body;
  // 💡 รองรับทั้ง fullName และ fullname
  const fullName = req.body.fullName || req.body.fullname;
  
  const permStr = Array.isArray(permissions) ? permissions.join(',') : (permissions || 'RECEIVE,PICK,TRANSFER,LOOKUP');
  const isActiveVal = (status !== undefined) ? (status == 1 ? 1 : 0) : 1;

  try {
    const pool = await poolPromise;
    const reqUpdate = pool.request()
      .input('UserId', sql.Int, userId)
      .input('FullName', sql.NVarChar, fullName ? fullName.trim() : '')
      .input('Role', sql.NVarChar, role ? role.toUpperCase() : 'OPERATOR')
      .input('Permissions', sql.NVarChar, permStr)
      .input('IsActive', sql.Bit, isActiveVal);

    let queryStr = `
      UPDATE Users 
      SET FullName = @FullName, Role = @Role, Permissions = @Permissions, IsActive = @IsActive
    `;

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

// 5. DELETE /api/users/:id (ลบหรือระงับการใช้งานผู้ใช้งาน)
router.delete('/:id', requireAdmin, async (req, res) => {
  const targetId = parseInt(req.params.id);

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