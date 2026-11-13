# WH Stock Windows Service — Port 5555

รองรับ LAPTOP-T4RLHQUE และ DESKTOP-RT67GE0 โดยติดตั้ง Node.js แบบทั้งเครื่อง (64-bit, Node.js 18 ขึ้นไป)
สคริปต์ใช้ WinSW 2.12.0 จาก GitHub ทางการ และไม่ต้องติดตั้ง npm package เพิ่มสำหรับ Service

## สรุปติดตั้งบน LAPTOP-T4RLHQUE

เปิด **PowerShell แบบ Run as administrator บน LAPTOP-T4RLHQUE**

### 1. อัปเดตโปรแกรม

```powershell
cd C:\code\whstocklocal
git status
git pull --ff-only origin main
npm ci
```

หากมีไฟล์แก้ไขค้าง ให้จัดการงานนั้นก่อน pull ไม่ใช้คำสั่งทิ้งไฟล์อัตโนมัติ

### 2. ตรวจไฟล์ .env

แก้เฉพาะค่าที่เกี่ยวข้อง และเก็บ DB_USER, DB_PASSWORD, JWT_SECRET เดิมไว้:

```dotenv
PORT=5555
APP_HOST=LAPTOP-T4RLHQUE
DB_SERVER=LAPTOP-T4RLHQUE
DB_DATABASE=dbMaster
DB_PORT=1433
DB_ENCRYPT=false
DB_TRUST_SERVER_CERTIFICATE=true
```

ต้องมีทั้ง dbMaster และ dbWMS โดย SQL Login เข้าถึงได้ทั้งสองฐาน
หากมีข้อมูลเดิมบน Laptop แล้ว ไม่ต้อง Restore ทับ
Git pull ไม่ย้าย .env หรือข้อมูลฐานข้อมูล และไม่ติดตั้ง migration ให้อัตโนมัติ
ไม่ต้องแก้ src/config/db.js หรือ src/server.js

### 3. ตรวจและติดตั้ง Service พอร์ต 5555

```powershell
node createport/install.js check --host LAPTOP-T4RLHQUE --db-server LAPTOP-T4RLHQUE
node createport/install.js install --host LAPTOP-T4RLHQUE --db-server LAPTOP-T4RLHQUE
node createport/install.js status
```

ต้องระบุ host และ db-server เพราะค่าเริ่มต้นของสคริปต์เป็น DESKTOP-RT67GE0
หากมี Service WHStock5555 บน Laptop อยู่แล้ว ให้ใช้ขั้นตอนอัปเดตด้านล่าง

เปิดเว็บ:

- บน Laptop: http://localhost:5555
- เครื่องอื่นในเครือข่าย: http://LAPTOP-T4RLHQUE:5555

### 4. อัปเดตเมื่อมี Service บน Laptop แล้ว

ทำช่วงที่ไม่มีผู้ใช้บันทึกรายการ ใน PowerShell แบบผู้ดูแล:

```powershell
cd C:\code\whstocklocal
git status
git pull --ff-only origin main
node createport/install.js stop --host LAPTOP-T4RLHQUE
npm ci
```

หากรุ่นใหม่มี migration ให้สำรองฐานข้อมูล อ่าน README ของ migration และรันเฉพาะที่จำเป็น
ตรวจ DB_SERVER ใน .env ก่อนรัน migration เพราะคำสั่งที่เรียกเองไม่ได้รับ environment ของ Service
อย่ารันไฟล์ SQL ทั้งโฟลเดอร์ เพราะอาจมีสคริปต์ Reset หรือลบข้อมูล
จากนั้นเริ่ม Service และกด Ctrl+F5 ที่หน้าเว็บ:

```powershell
node createport/install.js start --host LAPTOP-T4RLHQUE
node createport/install.js status
```

หากต้องการเพียงรีสตาร์ท:

```powershell
node createport/install.js restart --host LAPTOP-T4RLHQUE
```

คำสั่ง start/stop/restart/uninstall บน Laptop ต้องระบุ --host LAPTOP-T4RLHQUE ทุกครั้ง
status และ logs ไม่ต้องระบุ host โดย logs แสดงตำแหน่งโฟลเดอร์ log

### 5. ติดตั้งใหม่เมื่อ Service เดิมชี้เครื่องหรือโฟลเดอร์ผิด

```powershell
node createport/install.js uninstall --host LAPTOP-T4RLHQUE
node createport/install.js install --host LAPTOP-T4RLHQUE --db-server LAPTOP-T4RLHQUE
```

Uninstall ไม่ลบโค้ด .env หรือฐานข้อมูล
Dev พอร์ต 3000 ใช้คู่กับ Service 5555 ได้ แต่ถ้าชี้ฐานข้อมูลเดียวกันจะใช้ยอดสต๊อกชุดเดียวกัน
หากต้องการให้ npm start ของ Dev ใช้พอร์ต 3000 ให้คง PORT=3000 ใน .env ได้ เพราะ Service กำหนด PORT=5555 แยกไว้
ไม่เปิด npm start ที่พอร์ต 5555 ซ้ำกับ Service

## ขั้นตอนสำหรับ DESKTOP-RT67GE0

คำสั่งด้านล่างใช้ค่าเริ่มต้นของสคริปต์สำหรับ DESKTOP-RT67GE0
หากใช้บน Laptop ให้เพิ่ม --host LAPTOP-T4RLHQUE และตอน check/install เพิ่ม --db-server LAPTOP-T4RLHQUE

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

ผู้ใช้ยืนยันว่าติดตั้งเว็บพอร์ต 5555 สำเร็จแล้วบน DESKTOP-RT67GE0 ส่วนการตั้ง SSH ต้องทำเพิ่มตามขั้นตอนด้านล่าง

เอกสาร WinSW:
https://github.com/winsw/winsw/releases/tag/v2.12.0
https://github.com/winsw/winsw/blob/v2.12.0/doc/xmlConfigFile.md

## Restart จากเครื่อง dev ผ่าน SSH

เครื่อง dev: LAPTOP-T4RLHQUE
เครื่องที่รัน Service: DESKTOP-RT67GE0
Service ที่สั่งงาน: WHStock5555 (พอร์ตเว็บ 5555)
พอร์ต 22 ใช้สำหรับ SSH และเป็นคนละพอร์ตกับเว็บ 5555

### 1. เตรียม OpenSSH Server ที่ DESKTOP-RT67GE0 (ครั้งแรก)

ทำบนเครื่องเซิร์ฟเวอร์โดยตรง เปิด **PowerShell แบบ Run as administrator**
ถ้าหน้าต่างปัจจุบันเป็น Command Prompt เช่น `C:\Windows\System32>` ให้พิมพ์ `powershell.exe` ก่อน

```powershell
Get-WindowsCapability -Online -Name OpenSSH.Server~~~~0.0.1.0
```

หาก State ยังไม่ใช่ Installed ให้ติดตั้ง:

```powershell
Add-WindowsCapability -Online -Name OpenSSH.Server~~~~0.0.1.0
```

เริ่มบริการและให้เปิดอัตโนมัติ:

```powershell
Set-Service -Name sshd -StartupType Automatic
Start-Service sshd
Get-Service sshd
```

สถานะต้องเป็น Running

ดูชื่อบัญชี Windows ของเครื่องเซิร์ฟเวอร์:

```powershell
whoami
```

เช่น `desktop-rt67ge0\somchai` หมายถึงบัญชี local ชื่อ `somchai`
บัญชีที่จะใช้ SSH ต้องมีสิทธิ์จัดการ Service WHStock5555
การเปิด Terminal แบบ Administrator บนเครื่อง dev ไม่ได้เพิ่มสิทธิ์บัญชีบนเซิร์ฟเวอร์

### 2. อนุญาต SSH จาก IP เครื่อง dev

บน LAPTOP-T4RLHQUE ดู IPv4 ของ Ethernet/Wi-Fi ที่เชื่อมไปยังเซิร์ฟเวอร์:

```powershell
ipconfig
```

กลับมาที่ PowerShell ผู้ดูแลบน DESKTOP-RT67GE0:

```powershell
$devIP = Read-Host 'ใส่ IPv4 จริงของ LAPTOP-T4RLHQUE'

if (Get-NetFirewallRule -Name 'WHStock-SSH-Dev' -ErrorAction SilentlyContinue) {
    Set-NetFirewallRule -Name 'WHStock-SSH-Dev' -Enabled True -Direction Inbound -Action Allow -Profile Private
    Get-NetFirewallRule -Name 'WHStock-SSH-Dev' | Get-NetFirewallAddressFilter | Set-NetFirewallAddressFilter -RemoteAddress $devIP
} else {
    New-NetFirewallRule -Name 'WHStock-SSH-Dev' -DisplayName 'WH Stock SSH from dev' -Direction Inbound -Protocol TCP -LocalPort 22 -RemoteAddress $devIP -Action Allow -Profile Private
}

# ปิดกฎกว้างที่ตัวติดตั้งอาจสร้างไว้ หลังสร้างกฎเฉพาะเครื่อง dev แล้ว
Get-NetFirewallRule -Name 'OpenSSH-Server-In-TCP' -ErrorAction SilentlyContinue | Disable-NetFirewallRule
```

กฎนี้ใช้กับ Private network เท่านั้น ตรวจ profile ด้วย `Get-NetConnectionProfile`
หากเครื่องอยู่ Domain/Public ให้ผู้ดูแลเครือข่ายกำหนดกฎให้ตรง profile จริง
หาก DHCP เปลี่ยน IP เครื่อง dev ต้องอัปเดต RemoteAddress หรือตั้ง DHCP reservation
ขั้นตอนนี้ไม่เปลี่ยนกฎเว็บพอร์ต 5555 และไม่ต้องเปิด SQL พอร์ต 1433

### 3. ทดสอบจาก LAPTOP-T4RLHQUE

เปิด PowerShell บนเครื่อง dev:

```powershell
Test-NetConnection DESKTOP-RT67GE0 -Port 22
```

ต้องเห็น `TcpTestSucceeded : True`

```powershell
$serverUser = Read-Host 'ใส่ชื่อบัญชี Windows จริงบน DESKTOP-RT67GE0 เช่น somchai'
ssh -l "$serverUser" DESKTOP-RT67GE0
```

ครั้งแรกให้ตรวจ fingerprint ของเครื่องปลายทางก่อนยอมรับ
ใช้รหัสผ่านบัญชี Windows ของเซิร์ฟเวอร์ ไม่ใช่ PIN, รหัส SQL myadmin หรือรหัสล็อกอินหน้าเว็บ
อย่าพิมพ์ WINDOWS_USER หรือ YOUR_WINDOWS_USER ตามตัวอย่างเดิมโดยไม่เปลี่ยนเป็นชื่อบัญชีจริง
SSH จะถามรหัสผ่านเอง ไม่ต้องใส่รหัสผ่านลงในคำสั่งหรือ README

เมื่อเข้าเครื่องได้แล้ว ตรวจสถานะ Service:

```powershell
powershell.exe -NoProfile -Command "Get-Service -Name WHStock5555"
```

ออกจาก SSH ด้วย `exit`

### 4. สั่ง Restart โดยตรงจากเครื่อง dev

ใน PowerShell บน LAPTOP-T4RLHQUE:

```powershell
$serverUser = Read-Host 'ชื่อบัญชี Windows บน DESKTOP-RT67GE0'

# ตรวจสถานะก่อน
ssh -l "$serverUser" DESKTOP-RT67GE0 "powershell.exe -NoProfile -Command Get-Service -Name WHStock5555"

# รีสตาร์ท Service
ssh -l "$serverUser" DESKTOP-RT67GE0 "powershell.exe -NoProfile -Command Restart-Service -Name WHStock5555"

# ตรวจสถานะหลัง (ต้องเป็น Running)
ssh -l "$serverUser" DESKTOP-RT67GE0 "powershell.exe -NoProfile -Command Get-Service -Name WHStock5555"

# ตรวจว่าเว็บกลับมาแล้ว
Invoke-WebRequest 'http://DESKTOP-RT67GE0:5555/index.html' -UseBasicParsing
```

การ Restart สำเร็จอาจไม่มีข้อความตอบกลับ ให้ยืนยันจาก Get-Service และ HTTP StatusCode 200
ควรทำช่วงที่ผู้ใช้ไม่ได้บันทึกรายการ เว็บจะหยุดชั่วครู่และเปิดต่ออัตโนมัติ
คำสั่งนี้รีสตาร์ทเฉพาะเว็บ ไม่รีสตาร์ท SQL Server หรือ Windows

### แก้ปัญหา SSH

| ข้อความ | ตรวจสอบ |
| --- | --- |
| Connection refused | บนเซิร์ฟเวอร์ตรวจ `Get-Service sshd` และ `Get-NetTCPConnection -LocalPort 22 -State Listen`; ตรวจว่า hostname ชี้ IP ถูกเครื่อง |
| Connection timed out / TcpTestSucceeded False | ตรวจ IP, การเชื่อมเครือข่าย, Firewall profile และ RemoteAddress ของเครื่อง dev |
| Permission denied | ตรวจชื่อบัญชี Windows และรหัสผ่าน ไม่ใช้ PIN หรือบัญชี SQL |
| Access denied ตอน Restart-Service | บัญชี SSH ไม่มีสิทธิ์บน Service; ให้ผู้ดูแลเซิร์ฟเวอร์กำหนดสิทธิ์จัดการ Service ที่จำเป็น |
| Cannot find service WHStock5555 | ตรวจ `Get-Service *WHStock*` บนเครื่องปลายทางและชื่อ Service ที่ติดตั้งจริง |
| Service Running แต่เว็บยังเข้าไม่ได้ | ตรวจ log ที่ `C:\ProgramData\WHStock5555\logs` และทดสอบ localhost:5555 บนเซิร์ฟเวอร์ |

SSH เป็นช่องทางจัดการเครื่องแยกจากตัวเว็บ ต้องตั้งค่าครั้งแรกบนเซิร์ฟเวอร์ก่อน
คำแนะนำนี้ยังไม่ได้ตั้ง SSH หรือทดลอง Remote Restart บน DESKTOP-RT67GE0 ให้โดยอัตโนมัติ

อ้างอิง Microsoft:
https://learn.microsoft.com/en-us/windows-server/administration/openssh/openssh_install_firstuse

