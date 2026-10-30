# 📦 WH Stock System (Local Warehouse & Handheld)

ระบบบริหารจัดการสต๊อกสินค้าคลังสินค้าแบบใช้งานภายในองค์กร (On-Premise / Local Network) เชื่อมต่อฐานข้อมูล **Microsoft SQL Server (MSSQL)** ครบวงจรทั้งหน้าจอเว็บสำหรับ **ผู้ดูแลระบบ (Admin Portal)** และหน้าจอสำหรับ **พนักงานสแกนคลัง (Handheld / PDA Mobile Portal)**

---

## ✨ จุดเด่นและความสามารถของระบบ (Features)

### 🏢 1. หน้าเว็บแอดมิน (Admin Web Portal - Modern Indigo Theme)
- **📊 รายงานสรุปสต๊อกสินค้า Real-time (Stock Balance Live)**: แสดงยอดคงเหลือตามรหัสสินค้า, บาร์โค้ด และแจกแจงตำแหน่งจัดเก็บ (Locations) ทันที
- **📑 Export ข้อมูลเป็น Excel (.xlsx)**: ดาวน์โหลดไฟล์ Excel สำหรับทำรายงานหรือ Audit รอบนับสต๊อกได้ทันทีด้วยคลิกเดียว
- **🗄️ จัดการ Master Data**: ดูรายการสินค้าทั้งหมด และมีแบบฟอร์มเพิ่มสินค้าใหม่ลงฐานข้อมูล MSSQL
- **💻 Desktop Quick Scanner**: รองรับการต่อเครื่องสแกนบาร์โค้ด USB เพื่อยิงบันทึกรับเข้าจากคอมพิวเตอร์ได้โดยตรง

### 📱 2. หน้าเว็บแฮนเฮล (Handheld / PDA / Mobile Web Portal)
- **🚀 2-Screen Workflow (แยกหน้าเมนู และหน้าสแกนทำงาน)**:
  - **หน้า 1 (Menu Grid)**: การ์ดเมนูขนาดใหญ่ 4 ปุ่ม (2x2) สบายตา สัมผัสง่ายด้วยนิ้วโป้งมือเดียว
  - **หน้า 2 (Operation Form)**: หน้าจอสำหรับสแกนทำงานแบบไร้การเลื่อนหน้าจอ (No-scroll) พร้อมปุ่ม `← กลับเมนูหลัก`
- **4 ฟังก์ชันหลักในการปฏิบัติงาน**:
  1. 📥 **รับสินค้าเข้าคลัง (Receive / Inbound)**: สแกน Location + สแกน Barcode + ระบุจำนวน
  2. 📤 **เบิกจ่ายสินค้า (Pick / Outbound)**: สแกน Location + Barcode เพื่อตัดสต๊อก (มีระบบป้องกันยอดสต๊อกติดลบ)
  3. 🔄 **ย้ายตำแหน่งที่เก็บ (Transfer / Relocation)**: สแกน Location ต้นทาง $\rightarrow$ Barcode $\rightarrow$ Location ปลายทาง
  4. 🔍 **เช็คสต๊อกด่วน (Quick Stock Lookup)**: ยิงบาร์โค้ดเพื่อดูยอดคงเหลือรวมและพิกัดจัดเก็บทั้งหมดได้ทันที
- **⚡ Dual Barcode Scanner Support**:
  - รองรับ **Hardware Laser Barcode Scanner** บนเครื่อง Handheld/PDA (Zebra, Honeywell, Point Mobile, Urovo ฯลฯ) ยิงปุ๊บ Enter อัตโนมัติ
  - รองรับ **Camera Scanner** เปิดกล้องมือถือสแกนผ่านเบราว์เซอร์ได้ทันที
- **🔊 Audio Feedback**: มีเสียง Beep ตอบรับทุกครั้งที่สแกนหรือบันทึกสำเร็จ

### 🔐 3. ระบบยืนยันตัวตนและความปลอดภัย (Authentication)
- แบ่งสิทธิ์การใช้งานตาม Role (**Role-Based Access Control**):
  - `ADMIN`: เข้าสู่หน้าจอ Admin Portal จัดการข้อมูล Master Data และดูรายงานภาพรวม
  - `OPERATOR`: พนักงานคลังสินค้า เข้าสู่หน้าจอ Handheld เพื่อสแกนทำงานทันทีหลังล็อกอิน
- เข้ารหัสผ่านอย่างปลอดภัยด้วย **bcrypt** และออก Session Token ด้วย **JWT (JSON Web Token)**
- จัดการความปลอดภัยของฐานข้อมูลด้วย **MSSQL Transactions (ACID)** ป้องกันยอดติดลบและการแย่งกันอัปเดตข้อมูล (Concurrency)

---

## 🛠️ เทคโนโลยีที่ใช้ (Tech Stack)

- **Backend**: Node.js, Express.js
- **Database**: Microsoft SQL Server (MSSQL) ผ่านไดรเวอร์ `mssql` (Pure TDS Protocol ไม่ต้องติดตั้ง ODBC เพิ่มเติม)
- **Frontend**: HTML5, CSS3, JavaScript (Vanilla JS), Bootstrap 5, Bootstrap Icons, Google Fonts (Prompt)
- **Libraries**:
  - `bcryptjs` (Password Hashing)
  - `jsonwebtoken` (Authentication)
  - `html5-qrcode` (Mobile Camera Barcode Scanning)
  - `xlsx` SheetJS (Excel .xlsx Export)

---

## 📁 โครงสร้างโปรเจกต์ (Project Structure)

```text
c:\code\whstocklocal\
├── database/
│   └── schema.sql              # สคริปต์สร้าง Database, Tables, Indexes และ Seed Data
├── public/                     # ไฟล์ส่วนหน้าบ้าน (Web Frontend)
│   ├── index.html              # หน้าเข้าสู่ระบบ (Login)
│   ├── admin.html              # หน้าเว็บแอดมิน (Admin Portal)
│   └── handheld.html           # หน้าจอแฮนเฮล (Handheld Mobile Portal)
├── src/                        # ซอร์สโค้ดฝั่งหลังบ้าน (Backend Server)
│   ├── config/
│   │   └── db.js               # เชื่อมต่อ MSSQL Connection Pool
│   ├── routes/
│   │   ├── auth.js             # API Login & Check Session
│   │   ├── products.js         # API สินค้า Master Data
│   │   ├── locations.js        # API ตำแหน่งจัดเก็บ
│   │   ├── stock.js            # API ยอดคงเหลือ & ค้นหาสต๊อก
│   │   └── transactions.js     # API รับ/จ่าย/ย้ายสต๊อก (MSSQL Transactions)
│   └── server.js               # Express Server & Static File Host
├── .env                        # การตั้งค่าเชื่อมต่อฐานข้อมูลและพอร์ต
├── .gitignore                  # รายการไฟล์ที่ไม่นำขึ้น Git
├── package.json                # ข้อมูลและแพ็กเกจของโปรเจกต์
├── seed.js                     # สคริปต์สร้าง User ทดสอบเริ่มต้น
└── README.md                   # เอกสารประกอบการใช้งานระบบ
```

---

## 🚀 ขั้นตอนการติดตั้งและเปิดใช้งาน (Installation & Setup)

### 1. ความต้องการของระบบ (Prerequisites)
- [Node.js](https://nodejs.org/) (เวอร์ชัน 18 ขึ้นไป)
- [Microsoft SQL Server](https://www.microsoft.com/en-us/sql-server) (เวอร์ชัน 2016 ขึ้นไป หรือ SQL Server Express)
- [SQL Server Management Studio (SSMS)](https://learn.microsoft.com/en-us/sql/ssms/download-sql-server-management-studio-ssms)

### 2. ติดตั้ง Dependencies
เปิด Command Prompt หรือ PowerShell ในโฟลเดอร์โปรเจกต์:
```bash
cd c:\code\whstocklocal
npm install
```

### 3. สร้างฐานข้อมูลใน MSSQL
1. เปิด **SSMS** แล้วเชื่อมต่อเข้า SQL Server ของคุณ
2. เปิดไฟล์ `database/schema.sql`
3. กดปุ่ม **Execute (F5)** เพื่อสร้างฐานข้อมูล `WarehouseStockDB` และตารางทั้งหมด

### 4. กำหนดค่าการเชื่อมต่อในไฟล์ `.env`
เปิดไฟล์ `.env` แล้วแก้ไขข้อมูลให้ตรงกับเครื่องของคุณ:
```ini
PORT=3000
JWT_SECRET=super_secret_local_warehouse_jwt_key_2026

# ตั้งค่าเชื่อมต่อ MSSQL
DB_SERVER=localhost
# (หากใช้ SQL Server Express ให้ใส่: DB_SERVER=localhost\\SQLEXPRESS)
DB_DATABASE=WarehouseStockDB
DB_USER=sa
DB_PASSWORD=รหัสผ่านsaของคุณ
DB_PORT=1433
DB_ENCRYPT=false
DB_TRUST_SERVER_CERTIFICATE=true
```

### 5. สร้าง User ทดสอบเริ่มต้น
รันคำสั่งเพื่อสร้างบัญชีผู้ใช้เริ่มต้นลงในฐานข้อมูล MSSQL:
```bash
node seed.js
```

### 6. เริ่มการทำงานของเซิร์ฟเวอร์
```bash
npm start
```
เมื่อเริ่มต้นสำเร็จ หน้าจอจะแสดงข้อความ:
```text
✅ Connected to MSSQL Database successfully.
====================================================
🚀 Warehouse Stock Server is running!
💻 Admin Web URL:     http://localhost:3000/admin.html
📱 Handheld Web URL:  http://localhost:3000/handheld.html
🔑 Login Page URL:    http://localhost:3000/index.html
====================================================
```

---

## 🔑 บัญชีผู้ใช้งานเริ่มต้นสำหรับทดสอบ (Default Users)

| สิทธิ์ (Role) | Username | Password | หน้าจอหลักหลังล็อกอิน | หน้าที่ |
| :--- | :--- | :--- | :--- | :--- |
| **แอดมิน (ADMIN)** | `admin` | `admin123` | `/admin.html` | จัดการ Master Data, ดูยอดสต๊อกสด, Export Excel |
| **พนักงาน (OPERATOR)** | `picker01` | `admin123` | `/handheld.html` | สแกนรับสินค้า, เบิกจ่าย, ย้ายตำแหน่ง, เช็คสต๊อก |

---

## 🏷️ ข้อมูลเริ่มต้นสำหรับทดลองสแกน (Demo Test Data)

### รหัสตำแหน่งจัดเก็บ (Locations)
- `RCV-01` (จุดรับเข้าชั่วคราว)
- `A-01-01` (โซน A แถว 1 ชั้น 1)
- `A-01-02` (โซน A แถว 1 ชั้น 2)
- `B-01-01` (โซน B แถว 1 ชั้น 1)
- `OUT-01` (จุดพักสินค้ารอจ่าย)

### ข้อมูลสินค้าและบาร์โค้ด (Products & Barcodes)
| รหัสสินค้า | บาร์โค้ด (สำหรับยิงทดสอบ) | ชื่อสินค้า | หน่วยนับ |
| :--- | :--- | :--- | :--- |
| **ITM001** | `8850123456789` | กล่องพลาสติกอเนกประสงค์ ไซส์ L | BOX |
| **ITM002** | `8850987654321` | เทปกาวใส OPP 2 นิ้ว | ROLL |
| **ITM003** | `8850111222333` | ฟิล์มยืดพันพาเลท 15 ไมครอน | ROLL |

---

## 📲 วิธีเชื่อมต่อใช้งานบนอุปกรณ์ Handheld / PDA / โทรศัพท์มือถือจริง

1. เชื่อมต่อเครื่อง Handheld หรือโทรศัพท์มือถือเข้ากับ **Wi-Fi วงเดียวกัน** กับเครื่องคอมพิวเตอร์ที่รันระบบ
2. ตรวจสอบ IP Address ของเครื่องคอมพิวเตอร์ โดยเปิด Command Prompt แล้วพิมพ์:
   ```cmd
   ipconfig
   ```
   *(มองหา `IPv4 Address` เช่น `192.168.1.50`)*
3. เปิดเว็บเบราว์เซอร์ (Chrome / Edge) บนเครื่อง Handheld แล้วพิมพ์:
   ```text
   http://192.168.1.50:3000
   ```
4. ล็อกอินด้วยบัญชี `picker01` เพื่อเริ่มสแกนรับเข้าหรือเบิกจ่ายได้ทันที

---

## 📄 ลิขสิทธิ์และการพัฒนาต่อยอด (License)
โปรเจกต์นี้พัฒนาขึ้นสำหรับใช้งานภายในองค์กร (Local / Private Deployment) สามารถปรับแต่งฟังก์ชันเพิ่มเติม เช่น การเพิ่มระบบพิมพ์สติ๊กเกอร์บาร์โค้ด หรือเชื่อมต่อระบบ ERP ได้ตามต้องการ