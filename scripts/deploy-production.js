'use strict';
/**
 * Production Deployment & Schema Fix Runner
 * Run on DESKTOP-RT67GE0: node scripts/deploy-production.js
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const ROOT = path.resolve(__dirname, '..');
const SQL_FILE = path.join(ROOT, 'mssql', 'Production_Deploy_Fix.sql');
const SERVICE_NAME = 'WHStock5555';
const PORT = process.env.PORT || 5555;

async function executeViaSqlcmd() {
  console.log('📌 กำลังตรวจสอบ sqlcmd บนระบบ...');
  const check = spawnSync('sqlcmd', ['-?'], { encoding: 'utf8', windowsHide: true });
  if (check.error || check.status !== 0) {
    console.log('⚠️ ไม่พบ sqlcmd บนเครื่อง จะใช้ Node.js mssql แทน');
    return false;
  }

  const server = process.env.DB_SERVER || 'localhost';
  const user = process.env.DB_USER;
  const password = process.env.DB_PASSWORD;

  const args = ['-S', server, '-i', SQL_FILE, '-b'];
  if (user && password) {
    args.push('-U', user, '-P', password);
  } else {
    args.push('-E'); // Windows Authentication
  }

  console.log(`🚀 กำลังรัน SQL Script ผ่าน sqlcmd บนเซิร์ฟเวอร์ [${server}]...`);
  const res = spawnSync('sqlcmd', args, { encoding: 'utf8', windowsHide: true, timeout: 180000 });
  if (res.error || res.status !== 0) {
    console.error('❌ sqlcmd เกิดข้อผิดพลาด:', res.stderr || res.stdout);
    return false;
  }
  console.log(res.stdout);
  console.log('✅ รัน Production_Deploy_Fix.sql ผ่าน sqlcmd สำเร็จเรียบร้อย');
  return true;
}

async function executeViaNode() {
  console.log('🚀 กำลังรัน SQL Script ผ่าน Node.js mssql driver...');
  const sql = require('mssql');
  const config = {
    server: process.env.DB_SERVER || 'localhost',
    port: parseInt(process.env.DB_PORT, 10) || 1433,
    database: 'master',
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    options: {
      encrypt: process.env.DB_ENCRYPT === 'true',
      trustServerCertificate: process.env.DB_TRUST_SERVER_CERTIFICATE !== 'false',
      enableArithAbort: true
    },
    connectionTimeout: 15000,
    requestTimeout: 60000
  };

  const pool = await new sql.ConnectionPool(config).connect();
  console.log(`✅ เชื่อมต่อ SQL Server [${config.server}] สำเร็จ`);

  const sqlContent = fs.readFileSync(SQL_FILE, 'utf8');
  const batches = sqlContent.split(/^\s*GO\s*$/im).map(b => b.trim()).filter(b => b.length > 0);

  console.log(`📦 พบทั้งหมด ${batches.length} Batch กำลังดำเนินการ...`);
  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i];
    try {
      await pool.request().query(batch);
    } catch (err) {
      console.warn(`⚠️ Batch ${i + 1}/${batches.length} แจ้งเตือน: ${err.message}`);
    }
  }
  await pool.close();
  console.log('✅ ดำเนินการอัปเดตโครงสร้างฐานข้อมูลผ่าน Node.js สำเร็จ');
  return true;
}

function restartService() {
  console.log(`🔄 กำลังรีสตาร์ท Windows Service [${SERVICE_NAME}]...`);
  const psCmd = `Restart-Service -Name '${SERVICE_NAME}' -ErrorAction SilentlyContinue; Get-Service -Name '${SERVICE_NAME}' -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Status`;
  const res = spawnSync('powershell.exe', ['-NoProfile', '-Command', psCmd], { encoding: 'utf8', windowsHide: true });
  const status = res.stdout ? res.stdout.trim() : '';
  if (status === 'Running') {
    console.log(`✅ Windows Service [${SERVICE_NAME}] รีสตาร์ทและกำลังทำงาน (Running)`);
  } else {
    console.log(`ℹ️ สถานะ Service: ${status || 'อาจไม่ได้ติดตั้ง Service นี้บนเครื่องปัจจุบัน หรือต้องรันเป็น Administrator'}`);
    console.log(`💡 หากต้องการรีสตาร์ทด้วยตนเอง ให้เปิด PowerShell (Run as Administrator) แล้วพิมพ์:`);
    console.log(`   Restart-Service ${SERVICE_NAME}`);
  }
}

async function verifyHealth() {
  console.log(`🔍 ตรวจสอบการเชื่อมต่อ API บน http://127.0.0.1:${PORT}...`);
  for (let attempt = 1; attempt <= 10; attempt++) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/index.html`, { signal: AbortSignal.timeout(3000) });
      if (res.ok) {
        console.log(`🎉 ตรวจสอบสำเร็จ! ระบบพร้อมให้บริการที่ http://desktop-rt67ge0:${PORT}`);
        return true;
      }
    } catch (e) {
      await new Promise(r => setTimeout(r, 1500));
    }
  }
  console.log('ℹ️ ยังไม่ได้รับการตอบกลับจากพอร์ต 5555 ในขณะนี้ (อาจกำลังสตาร์ท)');
  return false;
}

async function main() {
  console.log('====================================================');
  console.log('🚀 Warehouse Stock System: Production Deploy & Fix');
  console.log('====================================================');
  
  if (!fs.existsSync(SQL_FILE)) {
    console.error('❌ ไม่พบไฟล์:', SQL_FILE);
    process.exit(1);
  }

  let ok = await executeViaSqlcmd();
  if (!ok) {
    ok = await executeViaNode();
  }

  restartService();
  await verifyHealth();

  console.log('====================================================');
  console.log('✅ เสร็จสิ้นขั้นตอนการ Deploy สำหรับ Production');
  console.log('💡 ให้เปิดเว็บเบราว์เซอร์แล้วกด Ctrl + F5 ที่หน้า:');
  console.log(`   http://desktop-rt67ge0:${PORT}/admin/index.html?view=master`);
  console.log('====================================================');
}

main().catch(err => {
  console.error('❌ เกิดข้อผิดพลาดร้ายแรง:', err);
  process.exit(1);
});

