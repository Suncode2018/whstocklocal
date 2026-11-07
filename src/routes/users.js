const express = require('express');
const router = express.Router();
const sql = require('mssql');
const bcrypt = require('bcrypt');
const { poolPromise } = require('../config/db');
router.param('id',(req,res,next,value)=>{if(!/^[1-9]\d*$/.test(value)||!Number.isSafeInteger(Number(value))||Number(value)>2147483647)return res.status(400).json({error:'รหัสผู้ใช้ไม่ถูกต้อง กรุณารีเฟรชรายการผู้ใช้แล้วลองใหม่'});req.params.id=Number(value);next();});

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
    const assignedRole = String(role||'USER').trim().toUpperCase();if(!['ADMIN','USER'].includes(assignedRole))return res.status(400).json({error:'ใช้ได้เฉพาะ ADMIN หรือ USER'});

    const pool = await poolPromise;
    const normalizedPermissions = await normalizePermissions(pool, permissions);
    const inserted = await pool.request()
      .input('Username', sql.VarChar, username)
      .input('Fullname', sql.NVarChar, fullname || '')
      .input('PasswordHash', sql.VarChar, hashedPassword)
      .input('Role', sql.VarChar, assignedRole)
      .input('IsActive', sql.Bit, isActive !== undefined ? isActive : 1)
      .input('Permissions', sql.NVarChar(100), normalizedPermissions)
      .query(`INSERT INTO Users (Username, Fullname, PasswordHash, Role, IsActive, Permissions)
              OUTPUT INSERTED.UserId AS UserId
              VALUES (@Username, @Fullname, @PasswordHash, @Role, @IsActive, @Permissions)`);

    res.json({ success: true, UserId: inserted.recordset[0].UserId, message: 'เพิ่มผู้ใช้งานสำเร็จ' });
  } catch (err) {
    console.error('API /api/users POST Error:', err);
    res.status(err.statusCode || 500).json({ error: err.message });
  }
});

// Reset only the password; roles, status, navigation and warehouse access stay intact.
router.post('/:id/reset-password',require('../middleware/access').authenticate,require('../middleware/access').admin,async(req,res)=>{try{const password=req.body?.password;if(typeof password!=='string'||password.length<8||Buffer.byteLength(password,'utf8')>72)return res.status(400).json({success:false,error:'รหัสผ่านต้องมีอย่างน้อย 8 ตัวอักษร และไม่เกิน 72 ไบต์'});const hash=await bcrypt.hash(password,12),pool=await poolPromise;const result=await pool.request().input('Id',sql.Int,req.params.id).input('Hash',sql.VarChar(255),hash).query('UPDATE dbo.Users SET PasswordHash=@Hash OUTPUT inserted.UserId WHERE UserId=@Id');if(!result.recordset.length)return res.status(404).json({success:false,error:'ไม่พบผู้ใช้งาน กรุณารีเฟรชรายการ'});res.set('Cache-Control','no-store');res.json({success:true,message:'รีเซ็ตรหัสผ่านเรียบร้อย'})}catch(e){console.error('API reset password failed:',e.code||'ERROR');res.status(500).json({success:false,error:'รีเซ็ตรหัสผ่านไม่สำเร็จ กรุณาลองใหม่'})}});

// แก้ไขข้อมูลผู้ใช้งาน
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { fullname, password, role, isActive, permissions } = req.body;
    if(Number(id)===Number(req.user.id)&&(role!=='ADMIN'||isActive===false||isActive===0))return res.status(400).json({error:'ไม่สามารถลดสิทธิ์หรือปิดบัญชี Admin ที่กำลังใช้งาน'});
    if(!['ADMIN','USER'].includes(role))return res.status(400).json({error:'ใช้ได้เฉพาะ ADMIN หรือ USER'});

    const pool = await poolPromise;
    const normalizedPermissions = await normalizePermissions(pool, permissions);

    if (password && password.trim() !== '') {
      // กรณีเปลี่ยนรหัสผ่าน (ใช้ PasswordHash)
      const hashedPassword = await bcrypt.hash(password, 10);
      await pool.request()
        .input('UserId', sql.Int, id)
        .input('Fullname', sql.NVarChar, fullname || '')
        .input('PasswordHash', sql.VarChar, hashedPassword)
        .input('Role', sql.VarChar, role || 'USER')
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
        .input('Role', sql.VarChar, role || 'USER')
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
  if(Number(req.params.id)===Number(req.user.id))return res.status(400).json({error:'ไม่สามารถลบบัญชีที่กำลังใช้งาน'});
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
