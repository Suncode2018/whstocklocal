const express = require('express');
const router = express.Router();
const sql = require('mssql');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken'); // หรือระบบจัดการ Session ที่คุณใช้

const {poolPromise}=require('../config/db');

const navigation=require('../middleware/navigation'),{normalizeRole,normalizePermissions}=require('../config/navigation');
const JWT_SECRET = process.env.JWT_SECRET || 'super_secret_local_warehouse_jwt_key_2026';

// API Login
router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ error: 'กรุณากรอกชื่อผู้ใช้และรหัสผ่าน' });
    }

    const pool = await poolPromise;
    const result = await pool.request()
      .input('Username', sql.VarChar, username)
      .query("SELECT UserId, Username, PasswordHash, FullName = COALESCE(NULLIF(LTRIM(RTRIM(FullName)), N''), Username), Role, IsActive, Permissions FROM Users WHERE Username = @Username");

    if (result.recordset.length === 0) {
      return res.status(401).json({ error: 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง' });
    }

    const user = result.recordset[0];

    if (!user.IsActive) {
      return res.status(403).json({ error: 'บัญชีนี้ถูกปิดใช้งาน' });
    }

    // ตรวจสอบรหัสผ่าน (เทียบกับ PasswordHash ในฐานข้อมูล)
    const match = await bcrypt.compare(password, user.PasswordHash);
    if (!match) {
      return res.status(401).json({ error: 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง' });
    }

    user.Role=normalizeRole(user.Role);if(!['ADMIN','USER'].includes(user.Role))return res.status(403).json({error:'กรุณาอัปเดตบทบาทผู้ใช้ด้วย TwoRoles.sql'});user.Permissions=normalizePermissions(user.Permissions);
    const profile=await navigation.profile(pool,user);
    const mode=profile.assignedMode;
    if(!mode)return res.status(403).json({error:'บัญชีนี้ยังไม่ได้รับช่องทางใช้งาน กรุณาติดต่อ Admin'});
    // สร้าง Token หรือ Payload สำหรับส่งกลับไป
    const tokenPayload = {
      id: user.UserId,
      username: user.Username,
      fullname: user.FullName,
      role: user.Role,
      permissions: user.Permissions || '', mode
    };

    const token = jwt.sign(tokenPayload, JWT_SECRET, { expiresIn: '8h' });

    res.json({
      success: true,
      redirect: mode==='HH'?'/handheld/index.html':'/desktop/index.html',
      token: token,
      user: {
        id: user.UserId,
        username: user.Username,
        fullname: user.FullName,
        role: user.Role,
        permissions: user.Permissions || '', mode
      }
    });

  } catch (err) {
    console.error('API Login Error:', err);
    res.status(500).json({ error: 'เกิดข้อผิดพลาดภายในเซิร์ฟเวอร์' });
  }
});

module.exports = router;
