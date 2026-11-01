const express = require('express');
const router = express.Router();
const sql = require('mssql');
const bcrypt = require('bcrypt');
const { poolPromise } = require('../config/db');

async function normalizePermissions(pool, value) {
  const requested = [...new Set(String(value || '').split(',').map(code => code.trim().toUpperCase()).filter(Boolean))];
  if (requested.length === 0) return '';

  const result = await pool.request().query(`
    SELECT UPPER(PermissionCode) AS PermissionCode
    FROM Permissions
    WHERE IsActive = 1
  `);
  const allowed = new Set(result.recordset.map(row => row.PermissionCode));
  const invalid = requested.filter(code => !allowed.has(code));
  if (invalid.length) {
    const error = new Error(`รหัสสิทธิ์ไม่ถูกต้องหรือปิดใช้งาน: ${invalid.join(', ')}`);
    error.statusCode = 400;
    throw error;
  }
  return requested.join(',');
}

const dbConfig = {
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  server: process.env.DB_SERVER,
  database: process.env.DB_DATABASE,
  port: parseInt(process.env.DB_PORT) || 1433,
  options: {
    encrypt: process.env.DB_ENCRYPT === 'true' || false,
    enableArithAbort: true,
    trustServerCertificate: true
  }
};

// ดึงข้อมูลผู้ใช้งานทั้งหมด
router.get('/', async (req, res) => {
  try {
    const pool = await poolPromise;
    const result = await pool.request().query("SELECT UserId, Username, FullName = COALESCE(NULLIF(LTRIM(RTRIM(FullName)), N''), Username), Role, IsActive, CreatedAt, Permissions FROM Users ORDER BY UserId ASC");
    res.json(result.recordset);
  } catch (err) {
    console.error('API /api/users GET Error:', err);
    res.status(500).json({ error: err.message });
  }
});

// เพิ่มผู้ใช้งานใหม่
router.post('/', async (req, res) => {
  try {
    const { username, fullname, password, role, isActive, permissions } = req.body;

    if (!username || !password) {
      return res.status(400).json({ error: 'กรุณากรอกชื่อผู้ใช้และรหัสผ่าน' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const assignedRole = role || 'OPERATOR';

    const pool = await poolPromise;
    const normalizedPermissions = await normalizePermissions(pool, permissions);
    await pool.request()
      .input('Username', sql.VarChar, username)
      .input('Fullname', sql.NVarChar, fullname || '')
      .input('PasswordHash', sql.VarChar, hashedPassword)
      .input('Role', sql.VarChar, assignedRole)
      .input('IsActive', sql.Bit, isActive !== undefined ? isActive : 1)
      .input('Permissions', sql.NVarChar(100), normalizedPermissions)
      .query(`INSERT INTO Users (Username, Fullname, PasswordHash, Role, IsActive, Permissions)
              VALUES (@Username, @Fullname, @PasswordHash, @Role, @IsActive, @Permissions)`);

    res.json({ success: true, message: 'เพิ่มผู้ใช้งานสำเร็จ' });
  } catch (err) {
    console.error('API /api/users POST Error:', err);
    res.status(err.statusCode || 500).json({ error: err.message });
  }
});

// แก้ไขข้อมูลผู้ใช้งาน
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { fullname, password, role, isActive, permissions } = req.body;

    const pool = await poolPromise;
    const normalizedPermissions = await normalizePermissions(pool, permissions);

    if (password && password.trim() !== '') {
      // กรณีเปลี่ยนรหัสผ่าน (ใช้ PasswordHash)
      const hashedPassword = await bcrypt.hash(password, 10);
      await pool.request()
        .input('UserId', sql.Int, id)
        .input('Fullname', sql.NVarChar, fullname || '')
        .input('PasswordHash', sql.VarChar, hashedPassword)
        .input('Role', sql.VarChar, role || 'OPERATOR')
        .input('IsActive', sql.Bit, isActive !== undefined ? isActive : 1)
        .input('Permissions', sql.NVarChar(100), normalizedPermissions)
        .query(`UPDATE Users
                SET Fullname = @Fullname, PasswordHash = @PasswordHash, Role = @Role, IsActive = @IsActive, Permissions = @Permissions
                WHERE UserId = @UserId`);
    } else {
      // กรณีไม่เปลี่ยนรหัสผ่าน
      await pool.request()
        .input('UserId', sql.Int, id)
        .input('Fullname', sql.NVarChar, fullname || '')
        .input('Role', sql.VarChar, role || 'OPERATOR')
        .input('IsActive', sql.Bit, isActive !== undefined ? isActive : 1)
        .input('Permissions', sql.NVarChar(100), normalizedPermissions)
        .query(`UPDATE Users
                SET Fullname = @Fullname, Role = @Role, IsActive = @IsActive, Permissions = @Permissions
                WHERE UserId = @UserId`);
    }

    res.json({ success: true, message: 'อัปเดตผู้ใช้งานสำเร็จ' });
  } catch (err) {
    console.error('API /api/users PUT Error:', err);
    res.status(err.statusCode || 500).json({ error: err.message });
  }
});

// ลบผู้ใช้งาน
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const pool = await poolPromise;
    await pool.request()
      .input('UserId', sql.Int, id)
      .query('DELETE FROM Users WHERE UserId = @UserId');

    res.json({ success: true, message: 'ลบผู้ใช้งานสำเร็จ' });
  } catch (err) {
    console.error('API /api/users DELETE Error:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
