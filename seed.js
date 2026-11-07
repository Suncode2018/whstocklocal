const { poolPromise } = require('./src/config/db');
const bcrypt = require('bcryptjs');

async function initUsers() {
  try {
    const pool = await poolPromise;
    const hash = await bcrypt.hash('admin123', 10);

    // ตรวจสอบคอลัมน์ Permissions
    await pool.request().query(`
      IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('dbo.Users') AND name = 'Permissions')
      BEGIN
          ALTER TABLE dbo.Users ADD Permissions NVARCHAR(100) NULL;
      END
    `);

    await pool.request().query(`
      DELETE FROM Users WHERE Username IN ('admin', 'poweruser', 'picker01', 'viewer01');
      INSERT INTO Users (Username, PasswordHash, FullName, Role, IsActive, CreatedAt, Permissions) VALUES 
      ('admin', '${hash}', N'ผู้ดูแลระบบ', 'ADMIN', 1, SYSDATETIME(), 'ALL'),
      ('poweruser', '${hash}', N'หัวหน้างานคลังสินค้า', 'USER', 1, SYSDATETIME(), 'ALL'),
      ('picker01', '${hash}', N'พนักงานสแกน 01', 'USER', 1, SYSDATETIME(), 'RECEIVE,PUTAWAY,PICK,TRANSFER,CHECK,LOAD,CYCLECOUNT,LOOKUP'),
      ('viewer01', '${hash}', N'เจ้าหน้าที่อ่านอย่างเดียว', 'USER', 1, SYSDATETIME(), 'LOOKUP');
    `);

    console.log('============================================');
    console.log('✅ สร้าง User ใน MSSQL สำเร็จเรียบร้อยแล้ว!');
    console.log('👉 admin     / admin123 (สำหรับ Admin)');
    console.log('👉 poweruser / admin123 (สำหรับ Power User)');
    console.log('👉 picker01  / admin123 (สำหรับ Handheld PDA)');
    console.log('👉 viewer01  / admin123 (สำหรับ อ่านอย่างเดียว / Viewer)');
    console.log('============================================');
    process.exit(0);
  } catch (err) {
    console.error('❌ เกิดข้อผิดพลาด:', err);
    process.exit(1);
  }
}

initUsers();
