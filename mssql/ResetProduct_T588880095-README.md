# รีเซ็ตเฉพาะสินค้า T588880095   

ไฟล์ ResetProduct_T588880095.sql ใช้กับ SQL Server ที่มี dbMaster และ dbWMS อยู่ใน instance เดียวกัน

ขอบเขต: สินค้า T588880095 ทุกคลัง/ทุกโลเคชั่น ลบสต๊อกและธุรกรรมที่เกี่ยวข้อง รวมใบรับ ใบส่ง ใบเบิก แผนจัดเก็บ การโอน ภาชนะ และการตรวจนับที่เชื่อมโยงถึงกันตาม Foreign Key และแผนที่อ้าง ProductId ใน JSON

เก็บ tblProducts และ Master ทั้งหมด รวม BOM หน่วยบรรจุ ผู้ใช้ สิทธิ์ คู่ค้าและคลังไว้ ไม่รีเซ็ต Identity หรือเลขรันเอกสารร่วม เพราะสินค้าอื่นยังใช้งานอยู่

## วิธีใช้
1. สำรองทั้ง dbMaster และ dbWMS และหยุดโปรแกรม/Windows Service เพื่อไม่ให้มีรายการใหม่เข้าระหว่างรีเซ็ต
2. เปิดไฟล์ด้วย SSMS เชื่อมต่อเครื่องที่ต้องการรีเซ็ต ตรวจสอบชื่อ Server ให้ถูกต้อง
3. รันทั้งไฟล์โดยคง @Execute=0 ก่อน ดู ServerName, ProductCode, ProductId, RowsToDelete และ CanExecute
4. ถ้า CanExecute=0 ให้หยุด: มีเอกสารเกี่ยวข้องกับสินค้าอื่น สคริปต์จะไม่ลบข้อมูลใด ต้องแยกเอกสารก่อน
5. เมื่อตรวจสอบแล้ว เปลี่ยนค่าตอนต้นไฟล์เป็น:

```sql
DECLARE @Execute bit=1;
DECLARE @Confirmation nvarchar(100)=N'RESET:T588880095';
```

6. รันทั้งไฟล์อีกครั้ง สคริปต์สำรองแถวที่ลบเป็น JSON ใน dbWMS.dbo.ProductResetBackup และบันทึก RunId ใน ProductResetAudit ภายใน transaction เดียวกับการลบ ถ้าผิดพลาด rollback ทั้งชุด
7. เก็บ BackupRunId ที่แสดงหลังสำเร็จ เปิดโปรแกรมใหม่แล้วตรวจยอดควรเป็น 0 จึงเริ่มรับสินค้าใหม่

การสำรอง JSON เป็นสำเนาระดับแถว ไม่ใช่สคริปต์กู้คืนอัตโนมัติ และไม่แทนที่ Database Backup การลบประวัติเป็นการรีเซ็ตเพื่อเริ่มต้นใหม่ ไม่ใช่การยกเลิกเอกสารตามกระบวนการปกติ

## สถานะการตรวจสอบ
จัดทำจากสคริปต์รีเซ็ตเดิม โดยเปลี่ยนเป้าหมายเป็น T588880095 และคง @Execute=0 ยังไม่ได้รัน preview กับฐานข้อมูลจริง และยังไม่ได้ลบข้อมูล ต้องตรวจสอบ schema และผล preview ของเครื่องเป้าหมายก่อนใช้งาน หากพบตารางหรือ Foreign Key ใหม่ สคริปต์จะหยุดเพื่อให้ตรวจสอบเพิ่มเติม

การรีเซ็ตนี้ลบรุ่นจัดเรียงพาเลทใน dbMaster.dbo.tblProductPalletVersions เฉพาะ ProductId ของ T588880095 ด้วย โดยสำรอง JSON ด้วย RunId เดียวกัน และทำใน transaction เดียวกับ dbWMS เก็บรุ่นอัตราบรรจุไว้ หากพบตารางอ้างอิงพาเลทจะหยุดเพื่อให้ตรวจสอบก่อน

ข้อยกเว้น Master: ลบเฉพาะข้อมูลการจัดเรียงพาเลทของสินค้านี้ (Dimension / Ti / Hi และประวัติรุ่นพาเลท) ไม่ลบ tblProducts หรือรุ่นหน่วยบรรจุ ไม่รีเซ็ต Identity ส่วนกลาง

## Preview บน Dev 15/11/2026
ตรวจบน LAPTOP-T4RLHQUE: ProductId 2559, ExecuteMode=0, CanExecute=1 ไม่พบเอกสารปนสินค้าอื่น ใบรับ 3 ใบ, รายการรับ/ประวัติรับ/ข้อมูลผลิตอย่างละ 3 แถว, แผนจัดเก็บ/รายการแผน/การย้ายอย่างละ 3 แถว, tblStock 4 แถว, tblStockTransactions 9 แถว ไม่พบรุ่นพาเลทที่จะลบในขณะตรวจ ยังไม่ได้ทดสอบการลบจริง

รองรับ LocationMoveOrders, WarehouseTransferReceipts, WarehouseTransferStorage และความสัมพันธ์ StoragePlans → InboundReceipts เพิ่มเติม เก็บ InboundCorrectionBackup และ StockCorrectionBackup เป็นประวัติสำรอง ไม่ลบทิ้ง ใช้สิทธิ์ DAMAGE เฉพาะ transaction นี้แล้วล้างออก ไม่ปิด trigger

แก้ลำดับ DELETE: StoragePlanLines / StorageMoves → StoragePlans → InboundReceipts เพื่อรองรับ FK StoragePlans.InboundReceiptId ข้อผิดพลาด 547 จะ rollback ทั้งชุด ให้เปิดไฟล์ล่าสุดและ preview ใหม่ก่อน execute ยังไม่ได้ทดสอบลบจริง
