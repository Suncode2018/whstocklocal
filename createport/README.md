# WH Stock Windows Service — Port 5555

ใช้บนเครื่อง DESKTOP-RT67GE0 โดยติดตั้ง Node.js แบบทั้งเครื่อง (64-bit, Node.js 18 ขึ้นไป)
สคริปต์ใช้ WinSW 2.12.0 จาก GitHub ทางการ และไม่ต้องติดตั้ง npm package เพิ่มสำหรับ Service

## เตรียมก่อนติดตั้ง

- โค้ดอยู่ที่ C:\code\whstocklocal
- มี .env เดิม พร้อม DB_USER, DB_PASSWORD, JWT_SECRET
- Restore dbMaster และ dbWMS รวมทั้ง migration ของโมดูลที่ใช้งานแล้ว
- SQL Server เปิด TCP พอร์ตตาม DB_PORT ใน .env (ปกติ 1433)
- รัน npm ci ในโฟลเดอร์โปรเจกต์
- เครื่องปลายทางต้องเชื่อม GitHub ได้สำหรับดาวน์โหลด WinSW ครั้งแรก

Service จะกำหนด PORT=5555, APP_HOST=DESKTOP-RT67GE0,
DB_SERVER=DESKTOP-RT67GE0, DB_DATABASE=dbMaster ผ่าน environment ของ Service
โดยไม่แก้ .env และใช้ DB_USER/DB_PASSWORD/JWT_SECRET เดิมจาก .env
บัญชี Windows ของ Service คือ LocalService ไม่ใช่บัญชี SQL myadmin

## วิธีติดตั้ง

เปิด Command Prompt หรือ PowerShell แบบ Run as administrator บน DESKTOP-RT67GE0:

```powershell
cd C:\code\whstocklocal
npm ci
node createport/install.js check
node createport/install.js install
```

คำสั่งเริ่มต้น `node createport/install.js` เท่ากับ `install`

หากมี SQL Server หลาย instance ให้ระบุ Windows Service ที่ถูกต้อง:

```powershell
node createport/install.js install --sql-service MSSQLSERVER
```

สำหรับ SQL Express ใน PowerShell ใช้ single quotes เพื่อคงเครื่องหมาย $:

```powershell
node createport/install.js install --sql-service 'MSSQL$SQLEXPRESS'
```

DB_SERVER ยังคงเป็นชื่อเครื่อง และต้องตั้ง TCP port ให้ตรง DB_PORT

ตรวจรูปแบบโดยไม่เชื่อมฐานข้อมูล ไม่สร้างไฟล์ และไม่ติดตั้ง Service:

```powershell
node createport/install.js --dry-run
```

ตรวจโค้ดและ .env โดยไม่เชื่อม SQL:

```powershell
node createport/install.js check --offline
```

## เข้าเว็บ

http://DESKTOP-RT67GE0:5555

Firewall เปิดเฉพาะ TCP 5555 จาก LocalSubnet บน Private profile
หากเครือข่ายเครื่องเป็น Public/Domain ให้ผู้ดูแลเครือข่ายตั้งกฎตามเครือข่ายจริง
ไม่เปิดพอร์ต SQL 1433 ออกสู่เครือข่าย เพราะเว็บกับ SQL อยู่เครื่องเดียวกัน

## จัดการ Service

```powershell
node createport/install.js status
node createport/install.js restart
node createport/install.js stop
node createport/install.js start
node createport/install.js logs
node createport/install.js uninstall
```

Service: WHStock5555 (WH Stock Web (5555))
ไฟล์ wrapper/config/log: C:\ProgramData\WHStock5555
Log: C:\ProgramData\WHStock5555\logs
เริ่มอัตโนมัติแบบ delayed start และ restart เมื่อโปรแกรมล้ม
ตั้ง dependency รอ SQL Server service บนเครื่อง

หลัง git pull หรือแก้โค้ด: รัน restart แล้ว Ctrl+F5 ที่หน้าเว็บ
การ restart/start ไม่เปลี่ยน config ที่ติดตั้งไว้เดิม
หากเปลี่ยน path, DB server หรือ SQL service dependency ให้ uninstall แล้ว install ใหม่
ถ้ามี Service ชื่อเดียวกันจากสคริปต์ PowerShell รุ่นก่อน สคริปต์จะไม่เขียนทับ
ใช้ status/restart ได้หาก wrapper อยู่ใน ProgramData ตำแหน่งเดียวกัน

Uninstall เอาออกเฉพาะ Service และกฎ Firewall ของตัวเอง
เก็บโค้ด .env ฐานข้อมูล wrapper/config และ log ไว้

## เมื่อมีปัญหา

- ข้อความ Run as administrator: เปิด Terminal แบบผู้ดูแล
- Port 5555 occupied: หยุดเว็บหรือโปรแกรมที่ใช้พอร์ตนี้ก่อน ไม่ควรเปิด npm start ซ้ำกับ Service
- Database check failed: ตรวจ DB_PORT, SQL authentication, .env, Restore ทั้งสองฐาน และสิทธิ์ของ SQL Login
- เลือก SQL instance ไม่ได้: ใช้ --sql-service ระบุชื่อจริงจาก services.msc
- Service ไม่พร้อม: ดู status และไฟล์ *.err.log / *.wrapper.log ในโฟลเดอร์ logs
- สคริปต์ปฏิเสธชื่อเครื่อง: ต้องรันบน DESKTOP-RT67GE0; ใช้ --host ชื่ออื่นเฉพาะเมื่อจงใจติดตั้งเครื่องนั้น

ตรวจ syntax, XML และ dry-run แล้ว ยังไม่ได้ติดตั้งจริงบน DESKTOP-RT67GE0

เอกสาร WinSW:
https://github.com/winsw/winsw/releases/tag/v2.12.0
https://github.com/winsw/winsw/blob/v2.12.0/doc/xmlConfigFile.md
