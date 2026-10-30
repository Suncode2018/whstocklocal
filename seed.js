const { poolPromise } = require('./src/config/db');
const bcrypt = require('bcryptjs');

async function initUsers() {
  try {
    const pool = await poolPromise;
    // สร้าง bcrypt hash แท้ของคำว่า admin123
    const hash = await bcrypt.hash('admin123', 10);

    await pool.request().query(`
      DELETE FROM Users;
      INSERT INTO Users (Username, PasswordHash, FullName, Role) VALUES 
      ('admin', '${hash}', N'ผู้ดูแลระบบ', 'ADMIN'),
      ('picker01', '${hash}', N'พนักงานสแกน 01', 'OPERATOR');
    `);

    console.log('============================================');
    console.log('✅ สร้าง User ใน MSSQL สำเร็จเรียบร้อยแล้ว!');
    console.log('👉 admin    / admin123 (สำหรับ Admin)');
    console.log('👉 picker01 / admin123 (สำหรับ Handheld)');
    console.log('============================================');
    process.exit(0);
  } catch (err) {
    console.error('❌ เกิดข้อผิดพลาด:', err);
    process.exit(1);
  }
}

initUsers();