USE [WarehouseStockDB];
GO

-- 1. เพิ่มคอลัมน์ Permissions ในตาราง Users หากยังไม่มี
IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('dbo.Users') AND name = 'Permissions')
BEGIN
    ALTER TABLE dbo.Users ADD Permissions NVARCHAR(100) NULL;
END
GO

-- 2. ปลดล็อก CHECK Constraint ของ Role ให้รองรับ POWERUSER
DECLARE @roleCheckName sysname;
SELECT TOP 1 @roleCheckName = name
FROM sys.check_constraints
WHERE parent_object_id = OBJECT_ID('dbo.Users')
  AND definition LIKE '%Role%';

WHILE @roleCheckName IS NOT NULL
BEGIN
    DECLARE @dropRoleSql NVARCHAR(MAX) = N'ALTER TABLE dbo.Users DROP CONSTRAINT [' + REPLACE(@roleCheckName, ']', ']]') + N']';
    EXEC sp_executesql @dropRoleSql;
    
    SET @roleCheckName = NULL;
    SELECT TOP 1 @roleCheckName = name
    FROM sys.check_constraints
    WHERE parent_object_id = OBJECT_ID('dbo.Users')
      AND definition LIKE '%Role%';
END;

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE parent_object_id = OBJECT_ID('dbo.Users') AND name = 'CK_Users_Role')
BEGIN
    ALTER TABLE dbo.Users ADD CONSTRAINT CK_Users_Role CHECK (Role IN ('ADMIN', 'POWERUSER', 'OPERATOR', 'VIEWER', 'READONLY'));
END;
GO

-- 3. สร้างบัญชีผู้ใช้งานสำหรับเข้าสู่ระบบ WMS (รหัสผ่านคือ admin123 สำหรับทุก User)
DECLARE @PasswordHash NVARCHAR(255) = N'$2a$10$JSFnDF3tSsoDmYBfPMOYuOA7qcyQqADyVDA0G/eXPoBkYh/9OoK1y';

DELETE FROM dbo.Users WHERE Username IN ('admin', 'poweruser', 'picker01');

INSERT INTO dbo.Users (Username, PasswordHash, FullName, Role, IsActive, CreatedAt, Permissions)
VALUES 
    (N'admin', @PasswordHash, N'ผู้ดูแลระบบ', N'ADMIN', 1, SYSDATETIME(), N'ALL'),
    (N'poweruser', @PasswordHash, N'หัวหน้างานคลังสินค้า', N'POWERUSER', 1, SYSDATETIME(), N'ALL'),
    (N'picker01', @PasswordHash, N'พนักงานสแกน 01', N'OPERATOR', 1, SYSDATETIME(), N'RECEIVE,PUTAWAY,PICK,TRANSFER,CHECK,LOAD,CYCLECOUNT,LOOKUP');

PRINT N'✅ สร้างข้อมูลผู้ใช้งาน (admin, poweruser, picker01) สำเร็จเรียบร้อยแล้ว!';
GO

-- ตรวจสอบข้อมูลผู้ใช้งานที่สร้าง
SELECT UserId, Username, FullName, Role, IsActive, Permissions, CreatedAt 
FROM dbo.Users;
GO
