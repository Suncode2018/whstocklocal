# โอนสินค้าข้ามคลัง

Dev: `node scripts/migrate-warehouse-transfer-workflow.js` (LAPTOP-T4RLHQUE เท่านั้น)
หน้าใช้งาน: /desktop/warehouse-transfer.html (สิทธิ์ LOAD และ LOAD_RM/PKG/SEMI/FG)
เปิดได้จากหน้าโอนย้ายตำแหน่ง หรือหน้าจัดส่งสินค้า

1. สร้างใบโอน: เลือกคลังต้นทาง/ปลายทางและกลุ่มสินค้า สำหรับ PKG/SEMI/FG เลือกจำนวนแยกตาม ANA No./LOT No. ระบบตรวจยอดที่ยังใช้ได้แล้วบันทึกการจัดสรรต่อบรรทัดสินค้า ส่วนยอดที่ไม่มีหลักฐานแหล่งล็อตแสดงแยกเป็น “ไม่ระบุ ANA/LOT” โดยไม่คาดเดาเลขย้อนหลัง
2. เตรียมส่ง: ย้ายตำแหน่งจัดเก็บไป OUT คลังต้นทาง ยอดรวมคลังคงเดิม
3. ยืนยันส่ง: ลด OUT บันทึก LOAD และ DeliveryCustody เป็น IN_TRANSIT
4. รับปลายทาง: ตรวจครบตามใบโอน เพิ่ม RCV และทะเบียน WarehouseTransferReceipts ใน transaction เดียวกัน กดย้ำไม่รับซ้ำ
5. จัดเก็บ: เลือกแถว ANA/LOT ที่รับเข้า ตำแหน่งจริง และจำนวน ลด RCV เพิ่มจัดเก็บ พร้อม PUTAWAY และ WarehouseTransferStorage อ้างอิงใบโอนและ AllocationId เดิม ประวัติ Flow แสดงจำนวนตาม ANA/LOT และตำแหน่งปลายทางที่จัดเก็บ

API ใช้ /api/deliveries เดิมสำหรับสร้าง/prepare/dispatch/receive/cancel และ PDF
GET /api/deliveries/warehouse-workflow: สถานะและรายการรอจัดเก็บ
POST /api/deliveries/warehouse-workflow/:lineId/putaway: {requestId UUID,toLocationCode,quantity}
ต้องมีสิทธิ์ LOAD_<ประเภท> CONFIRM และ PUTAWAY_<ประเภท> CONFIRM สำหรับจัดเก็บ รวมถึงคลังปลายทาง

SQL ใช้ DeliveryOrders/DeliveryLines/DeliveryAudit/DeliveryCustody/DeliveryContainers และ tblStock/tblStockTransactions เดิม ไม่สร้างชุดสต๊อกซ้ำ
เพิ่ม WarehouseTransferReceipts, WarehouseTransferLotAllocations และ WarehouseTransferStorage พร้อม trigger ป้องกันนำยอด RCV ที่รอจัดเก็บไปใช้ซ้ำ ตาราง Allocation เก็บจำนวนแยก ANA/LOT และเครื่องหมาย IsUnattributed สำหรับยอดที่ไม่มีหลักฐานล็อต ตาราง Storage ผูก AllocationId เพื่อรักษาร่องรอยเมื่อทยอยจัดเก็บ
หน้า PUTAWAY ปกติหักยอดรับโอนที่อยู่ใน workflow นี้ออก ให้จัดเก็บผ่านใบโอนเพื่อรักษาสถานะรายเอกสาร
ไม่คำนวณความจุ สามารถเพิ่มรวมกับสินค้าที่มีในตำแหน่งปลายทางอยู่แล้ว
RM ต้องเลือกทะเบียนภาชนะตอนสร้าง และจัดเก็บทั้งรายการภาชนะในครั้งเดียว
PKG/SEMI/FG สามารถทยอยจัดเก็บได้ ยอดค้างสะสมตามใบรับโอน
รุ่นนี้รับครบครั้งเดียว หากรับจริงไม่ครบอย่ากดยืนยันรับครบ ให้ตรวจสอบส่วนต่างก่อน ยังไม่รองรับการรับบางส่วน
ANA/LOT ของยอดเก่าที่ไม่ได้ผูกทะเบียนไม่สร้างหรือคาดเดาย้อนหลัง ระบบแสดงยอดดังกล่าวเป็น “ไม่ระบุ ANA/LOT” และห้ามจองซ้ำกับใบโอน/แผนจัดเก็บเดิมที่ยังไม่ปิดหรือไม่ระบุการจัดสรรล็อต ให้ปิดงานค้างเดิมก่อนเพื่อป้องกันแย่งยอดล็อต
ใบรับโอนเก่าก่อนติดตั้งแสดง LEGACY_RECEIVED ไม่ย้ายยอดย้อนหลังและไม่สร้างการรับใหม่

Production: สำรองฐานข้อมูลก่อน รัน WarehouseTransferWorkflow.sql บน dbWMS เครื่องเป้าหมายเพื่อเพิ่มตาราง/คอลัมน์ Allocation (สคริปต์ทำงานซ้ำได้) จากนั้นอัปเดตโค้ดและรีสตาร์ท Service
ต้องติดตั้ง SQL พื้นฐาน DeliveryOrders/DeliveryFourTypes/StoragePlanning ตามระบบเดิมก่อน
การติดตั้งนี้ไม่สร้าง OUT/RCV หรือเปลี่ยนสต๊อกธุรกิจ ให้ Admin กำหนดตำแหน่งจริงใน Master
