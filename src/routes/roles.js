const express = require('express');
const router = express.Router();
const sql = require('mssql');

// 🛠️ กำหนดค่าเชื่อมต่อฐานข้อมูลให้ชัดเจน เพื่อป้องกัน Error port เป็น undefined
const dbConfig = {
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  server: process.env.DB_SERVER,
  database: process.env.DB_DATABASE,
  port: parseInt(process.env.DB_PORT) || 1433,
  options: {
    encrypt: process.env.DB_ENCRYPT === 'true' || false,
    enableArithAbort: true,
    trustServerCertificate: true // สำหรับ SQL Server แบบ Local / Self-signed certificate
  }
};

// ดึงข้อมูล Roles ทั้งหมด
router.get('/', async (req, res) => {
  try {
    const pool = await sql.connect(dbConfig);
    const result = await pool.request().query('SELECT * FROM UserRoles ORDER BY RoleId ASC');
    res.json(result.recordset);
  } catch (err) {
    console.error('API /api/roles Error:', err);
    res.status(500).json({ error: err.message });
  }
});

// เพิ่ม Role ใหม่
router.post('/', async (req, res) => {
  try {
    const { roleCode, roleName, description, isActive } = req.body;
    const pool = await sql.connect(dbConfig);
    await pool.request()
      .input('RoleCode', sql.VarChar, roleCode.toUpperCase())
      .input('RoleName', sql.NVarChar, roleName)
      .input('Description', sql.NVarChar, description || '')
      .input('IsActive', sql.Bit, isActive ? 1 : 0)
      .query('INSERT INTO UserRoles (RoleCode, RoleName, Description, IsActive) VALUES (@RoleCode, @RoleName, @Description, @IsActive)');
    
    res.json({ success: true, message: 'เพิ่ม Role สำเร็จ' });
  } catch (err) {
    console.error('API /api/roles POST Error:', err);
    res.status(500).json({ error: err.message });
  }
});

// แก้ไข Role
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { roleName, description, isActive } = req.body;
    const pool = await sql.connect(dbConfig);
    await pool.request()
      .input('RoleId', sql.Int, id)
      .input('RoleName', sql.NVarChar, roleName)
      .input('Description', sql.NVarChar, description || '')
      .input('IsActive', sql.Bit, isActive ? 1 : 0)
      .query('UPDATE UserRoles SET RoleName = @RoleName, Description = @Description, IsActive = @IsActive WHERE RoleId = @RoleId');
    
    res.json({ success: true, message: 'อัปเดต Role สำเร็จ' });
  } catch (err) {
    console.error('API /api/roles PUT Error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ลบ Role
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const pool = await sql.connect(dbConfig);
    await pool.request()
      .input('RoleId', sql.Int, id)
      .query('DELETE FROM UserRoles WHERE RoleId = @RoleId');
    
    res.json({ success: true, message: 'ลบ Role สำเร็จ' });
  } catch (err) {
    console.error('API /api/roles DELETE Error:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;