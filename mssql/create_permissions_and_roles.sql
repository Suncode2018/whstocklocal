USE [dbMaster];
GO

-- ====================================================================
-- 1. สร้างตาราง Permissions (ตารางสิทธิ์เมนูระบบ WMS)
-- ====================================================================
IF OBJECT_ID('dbo.Permissions', 'U') IS NULL
BEGIN
    CREATE TABLE [dbo].[Permissions] (
        [PermissionId]   INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
        [PermissionCode] NVARCHAR(50) NOT NULL UNIQUE,
        [PermissionName] NVARCHAR(100) NOT NULL,
        [Description]    NVARCHAR(200) NULL,
        [IsActive]       BIT NOT NULL CONSTRAINT DF_Permissions_IsActive DEFAULT (1),
        [CreatedAt]      DATETIME2 NOT NULL CONSTRAINT DF_Permissions_CreatedAt DEFAULT (SYSDATETIME())
    );
    PRINT N'✅ 1. สร้างตาราง Permissions สำเร็จ';
END
ELSE
BEGIN
    PRINT N'ℹ️ ตาราง Permissions มีอยู่แล้ว';
END
GO

-- บันทึกข้อมูลสิทธิ์เริ่มต้นของระบบคลังสินค้า
IF NOT EXISTS (SELECT 1 FROM dbo.Permissions WHERE PermissionCode = 'ALL')
    INSERT INTO dbo.Permissions (PermissionCode, PermissionName, Description, IsActive) VALUES (N'ALL', N'จัดการได้ทุกฟังก์ชัน', N'สิทธิ์สูงสุดสำหรับผู้ดูแลระบบ', 1);

IF NOT EXISTS (SELECT 1 FROM dbo.Permissions WHERE PermissionCode = 'RECEIVE')
    INSERT INTO dbo.Permissions (PermissionCode, PermissionName, Description, IsActive) VALUES (N'RECEIVE', N'รับสินค้า (Receive)', N'สแกนรับสินค้าเข้าคลังตาม PO', 1);

IF NOT EXISTS (SELECT 1 FROM dbo.Permissions WHERE PermissionCode = 'PUTAWAY')
    INSERT INTO dbo.Permissions (PermissionCode, PermissionName, Description, IsActive) VALUES (N'PUTAWAY', N'จัดเก็บสินค้า (Putaway)', N'นำสินค้าเข้าตำแหน่งจัดเก็บตามใบงาน', 1);

IF NOT EXISTS (SELECT 1 FROM dbo.Permissions WHERE PermissionCode = 'PICK')
    INSERT INTO dbo.Permissions (PermissionCode, PermissionName, Description, IsActive) VALUES (N'PICK', N'เบิกจ่ายสินค้า (Pick)', N'สแกนตัดจ่ายสินค้าออกจากคลัง', 1);

IF NOT EXISTS (SELECT 1 FROM dbo.Permissions WHERE PermissionCode = 'CHECK')
    INSERT INTO dbo.Permissions (PermissionCode, PermissionName, Description, IsActive) VALUES (N'CHECK', N'ตรวจนับสต็อก (Check)', N'ตรวจนับสต็อกสินค้าคงเหลือในตำแหน่ง', 1);

IF NOT EXISTS (SELECT 1 FROM dbo.Permissions WHERE PermissionCode = 'LOAD')
    INSERT INTO dbo.Permissions (PermissionCode, PermissionName, Description, IsActive) VALUES (N'LOAD', N'จัดโหลดสินค้า (Load)', N'จัดเตรียมและโหลดสินค้าขึ้นรถขนส่ง', 1);

IF NOT EXISTS (SELECT 1 FROM dbo.Permissions WHERE PermissionCode = 'TRANSFER')
    INSERT INTO dbo.Permissions (PermissionCode, PermissionName, Description, IsActive) VALUES (N'TRANSFER', N'ย้ายตำแหน่ง (Transfer)', N'โอนย้ายสินค้าระหว่างตำแหน่งจัดเก็บ', 1);

IF NOT EXISTS (SELECT 1 FROM dbo.Permissions WHERE PermissionCode = 'CYCLECOUNT')
    INSERT INTO dbo.Permissions (PermissionCode, PermissionName, Description, IsActive) VALUES (N'CYCLECOUNT', N'ตรวจนับรอบ (Cycle Count)', N'ตรวจนับสต็อกสินค้าประจำรอบ', 1);

IF NOT EXISTS (SELECT 1 FROM dbo.Permissions WHERE PermissionCode = 'LOOKUP')
    INSERT INTO dbo.Permissions (PermissionCode, PermissionName, Description, IsActive) VALUES (N'LOOKUP', N'เช็คสต็อกด่วน (Lookup)', N'ดูยอดคงเหลือและพิกัดจัดเก็บด่วน', 1);

PRINT N'✅ 2. บันทึกข้อมูลสิทธิ์ Permissions เริ่มต้นเรียบร้อยแล้ว';
GO

-- ====================================================================
-- 2. สร้างตาราง UserRoles (ตารางบทบาทผู้ใช้งาน)
-- ====================================================================
IF OBJECT_ID('dbo.UserRoles', 'U') IS NULL
BEGIN
    CREATE TABLE [dbo].[UserRoles] (
        [RoleId]      INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
        [RoleCode]    NVARCHAR(20) NOT NULL UNIQUE,
        [RoleName]    NVARCHAR(50) NOT NULL,
        [Description] NVARCHAR(200) NULL,
        [IsActive]    BIT NOT NULL CONSTRAINT DF_UserRoles_IsActive DEFAULT (1),
        [CreatedAt]   DATETIME2 NOT NULL CONSTRAINT DF_UserRoles_CreatedAt DEFAULT (SYSDATETIME())
    );
    PRINT N'✅ 3. สร้างตาราง UserRoles สำเร็จ';
END
ELSE
BEGIN
    PRINT N'ℹ️ ตาราง UserRoles มีอยู่แล้ว';
END
GO

-- บันทึกข้อมูล Roles เริ่มต้น
IF NOT EXISTS (SELECT 1 FROM dbo.UserRoles WHERE RoleCode = 'ADMIN')
    INSERT INTO dbo.UserRoles (RoleCode, RoleName, Description, IsActive) VALUES (N'ADMIN', N'ผู้ดูแลระบบสูงสุด', N'เข้าถึงและจัดการได้ทุกเมนูในระบบ รวมถึงจัดการผู้ใช้และสิทธิ์', 1);

IF NOT EXISTS (SELECT 1 FROM dbo.UserRoles WHERE RoleCode = 'POWERUSER')
    INSERT INTO dbo.UserRoles (RoleCode, RoleName, Description, IsActive) VALUES (N'POWERUSER', N'หัวหน้างานคลังสินค้า', N'จัดการสต็อก ใบรับ ใบงานจัดเก็บ และ Master Data', 1);

IF NOT EXISTS (SELECT 1 FROM dbo.UserRoles WHERE RoleCode = 'OPERATOR')
    INSERT INTO dbo.UserRoles (RoleCode, RoleName, Description, IsActive) VALUES (N'OPERATOR', N'เจ้าหน้าที่คลังสินค้า / Picker', N'สแกนรับ/เบิก/ย้ายสินค้าผ่านเครื่อง Handheld PDA', 1);

IF NOT EXISTS (SELECT 1 FROM dbo.UserRoles WHERE RoleCode = 'VIEWER')
    INSERT INTO dbo.UserRoles (RoleCode, RoleName, Description, IsActive) VALUES (N'VIEWER', N'อ่านอย่างเดียว (Viewer)', N'ดูข้อมูลสต็อกและรายงานเท่านั้น ไม่สามารถแก้ไขหรือบันทึกข้อมูลได้', 1);

PRINT N'✅ 4. บันทึกข้อมูลบทบาท UserRoles เริ่มต้นเรียบร้อยแล้ว';
GO

-- ====================================================================
-- 3. ตรวจสอบคอลัมน์ Permissions ในตาราง Users
-- ====================================================================
IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('dbo.Users') AND name = 'Permissions')
BEGIN
    ALTER TABLE dbo.Users ADD Permissions NVARCHAR(100) NULL;
    EXEC('UPDATE dbo.Users SET Permissions = ''RECEIVE,PUTAWAY,PICK,TRANSFER,CHECK,LOAD,CYCLECOUNT,LOOKUP'' WHERE Permissions IS NULL AND Role = ''OPERATOR''');
    EXEC('UPDATE dbo.Users SET Permissions = ''ALL'' WHERE Permissions IS NULL AND Role IN (''ADMIN'', ''POWERUSER'')');
    EXEC('UPDATE dbo.Users SET Permissions = ''LOOKUP'' WHERE Permissions IS NULL AND Role = ''VIEWER''');
    PRINT N'✅ 5. เพิ่มคอลัมน์ Permissions ในตาราง Users สำเร็จ';
END
GO

-- แสดงผลลัพธ์
SELECT PermissionId, PermissionCode, PermissionName, IsActive FROM dbo.Permissions;
SELECT RoleId, RoleCode, RoleName, IsActive FROM dbo.UserRoles;
GO

