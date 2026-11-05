USE [WarehouseStockDB];
GO

-- ====================================================================
-- 1. ปลดล็อกและอัปเดต CHECK Constraint ของตาราง Users ให้รองรับ VIEWER
-- ====================================================================
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
GO

ALTER TABLE dbo.Users 
ADD CONSTRAINT CK_Users_Role CHECK (Role IN ('ADMIN', 'POWERUSER', 'OPERATOR', 'VIEWER', 'READONLY'));
GO

-- ====================================================================
-- 2. สร้าง User ตัวอย่างสำหรับอ่านอย่างเดียว (viewer01 / admin123)
-- ====================================================================
DECLARE @PasswordHash NVARCHAR(255) = N'$2a$10$JSFnDF3tSsoDmYBfPMOYuOA7qcyQqADyVDA0G/eXPoBkYh/9OoK1y';

IF NOT EXISTS (SELECT 1 FROM dbo.Users WHERE Username = 'viewer01')
BEGIN
    INSERT INTO dbo.Users (Username, PasswordHash, FullName, Role, IsActive, CreatedAt, Permissions)
    VALUES (N'viewer01', @PasswordHash, N'เจ้าหน้าที่อ่านอย่างเดียว 01', N'VIEWER', 1, SYSDATETIME(), N'LOOKUP');
    PRINT N'✅ สร้างผู้ใช้งาน viewer01 (Role: VIEWER / Password: admin123) สำเร็จ';
END
ELSE
BEGIN
    UPDATE dbo.Users 
    SET Role = N'VIEWER', Permissions = N'LOOKUP', IsActive = 1
    WHERE Username = 'viewer01';
    PRINT N'✅ อัปเดตผู้ใช้งาน viewer01 ให้มี Role: VIEWER สำเร็จ';
END
GO

-- ====================================================================
-- 3. ตรวจสอบข้อมูลผู้ใช้งานทั้งหมด
-- ====================================================================
SELECT UserId, Username, FullName, Role, IsActive, Permissions, CreatedAt 
FROM dbo.Users;
GO

