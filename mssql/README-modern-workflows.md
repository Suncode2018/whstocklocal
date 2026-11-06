# อัปเดตโครงสร้างปัจจุบัน (dbMaster + dbWMS)

ใช้ `UpgradeModernWorkflows.sql` กับฐานข้อมูลเดิมที่มี `tblProducts`, `tblWH`, `Locations`, `tblStock` และ `tblStockTransactions` แล้ว เปิดใน SSMS และ Execute ทั้งไฟล์ สคริปต์เพิ่มโครงสร้างที่ขาด ไม่ล้างสต๊อกและไม่รีเซ็ตรหัสผ่าน

ไฟล์รวมครอบคลุมปริมาตรสินค้า/ความจุ, รับ RM/Pack/Semi/FG, Supplier, แผนจัดเก็บ, Picking, Delivery และ PDF, การยืนยันย้ายตามแผน, ตรวจนับ และโอนย้ายตำแหน่ง

`Receiving.sql`, `Putaway.sql`, `CycleCount.sql` เป็นชื่อติดตั้งเพื่อรองรับลิงก์เดิมและใช้โครงสร้างปัจจุบันแล้ว สำหรับการอัปเดตทุกโมดูลให้ใช้ไฟล์รวมข้างต้น

`SQLProject.sql`, `complete_setup_inventory.sql`, `warehouse_inventory.sql`, `ResetReceiveOrderLines.sql` เป็นแหล่งข้อมูล/คำสั่งย้อนหลัง ไม่ใช่ตัวติดตั้งปัจจุบัน บางไฟล์มีคำสั่งสร้างฐานข้อมูลเดิมหรือล้างข้อมูล ห้ามใช้เป็นตัวอัปเดตระบบที่กำลังใช้งาน

เก็บตารางประวัติรุ่นเก่าไว้ ไม่ลบหรือแปลงใบงานเก่าเป็นใบงานใหม่อัตโนมัติ หากมีใบงานเดิมค้าง ให้ตรวจและปิดงานก่อนเริ่มใบงานใหม่เพื่อป้องกันรับ/ตัดสต๊อกซ้ำ

หลังอัปเดตที่ DESKTOP-RT67GE0 ให้ใช้ PowerShell (Administrator):

```powershell
Restart-Service -Name WHStock5555
Invoke-RestMethod http://localhost:5555/api/version
```

ค่า version ต้องเป็น `20261106-modern-workflows` ถ้ายังไม่ใช่ ให้ตรวจว่า Service ชี้ไปยังโฟลเดอร์ที่อัปเดตจริง แล้วกด Ctrl+F5 ที่เบราว์เซอร์

การทดสอบในเครื่องพัฒนาให้หยุดโปรเซสเดิมและรัน `npm start` จาก C:\code\whstocklocal
