USE [master];
GO

-- ====================================================================
-- 1. สร้าง / อัปเดต SQL Server Login: myadmin (สำหรับ Node.js ตามไฟล์ .env)
-- ====================================================================
IF NOT EXISTS (SELECT name FROM sys.server_principals WHERE name = 'myadmin')
BEGIN
    CREATE LOGIN [myadmin] WITH PASSWORD = N'iloveyou', CHECK_POLICY = OFF;
    PRINT N'✅ 1. สร้าง SQL Server Login [myadmin] เรียบร้อยแล้ว (Password: iloveyou)';
END
ELSE
BEGIN
    ALTER LOGIN [myadmin] WITH PASSWORD = N'iloveyou', CHECK_POLICY = OFF;
    ALTER LOGIN [myadmin] ENABLE;
    PRINT N'✅ 1. อัปเดตรหัสผ่าน SQL Server Login [myadmin] เป็น iloveyou เรียบร้อยแล้ว';
END
GO

ALTER SERVER ROLE [sysadmin] ADD MEMBER [myadmin];
GO

-- ====================================================================
-- 2. สร้างฐานข้อมูล WarehouseStockDB (หากยังไม่มี)
-- ====================================================================
IF NOT EXISTS (SELECT name FROM sys.databases WHERE name = 'WarehouseStockDB')
BEGIN
    CREATE DATABASE [WarehouseStockDB];
    PRINT N'✅ 2. สร้างฐานข้อมูล WarehouseStockDB เรียบร้อยแล้ว';
END
GO

USE [WarehouseStockDB];
GO

-- ให้สิทธิ์ myadmin เป็น db_owner ใน WarehouseStockDB
IF NOT EXISTS (SELECT name FROM sys.database_principals WHERE name = 'myadmin')
BEGIN
    CREATE USER [myadmin] FOR LOGIN [myadmin];
END
GO
ALTER ROLE [db_owner] ADD MEMBER [myadmin];
GO

-- ====================================================================
-- 3. ตรวจสอบและสร้างตารางหลักของระบบคลังสินค้า
-- ====================================================================

-- 3.1 ตาราง Users
IF OBJECT_ID('dbo.Users', 'U') IS NULL
BEGIN
    CREATE TABLE [dbo].[Users](
        [UserId] [int] IDENTITY(1,1) NOT NULL PRIMARY KEY,
        [Username] [nvarchar](50) NOT NULL UNIQUE,
        [PasswordHash] [nvarchar](255) NOT NULL,
        [FullName] [nvarchar](100) NOT NULL,
        [Role] [nvarchar](20) NOT NULL,
        [IsActive] [bit] NOT NULL CONSTRAINT DF_Users_IsActive DEFAULT (1),
        [CreatedAt] [datetime2](7) NOT NULL CONSTRAINT DF_Users_CreatedAt DEFAULT (SYSDATETIME()),
        [Permissions] [nvarchar](100) NULL
    );
    PRINT N'✅ สร้างตาราง Users เรียบร้อยแล้ว';
END
ELSE
BEGIN
    IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('dbo.Users') AND name = 'Permissions')
    BEGIN
        ALTER TABLE dbo.Users ADD Permissions NVARCHAR(100) NULL;
    END
END
GO

-- 3.2 ตาราง Locations
IF OBJECT_ID('dbo.Locations', 'U') IS NULL
BEGIN
    CREATE TABLE [dbo].[Locations](
        [LocationId] [int] IDENTITY(1,1) NOT NULL PRIMARY KEY,
        [LocationCode] [nvarchar](50) NOT NULL UNIQUE,
        [Zone] [nvarchar](20) NOT NULL,
        [Description] [nvarchar](100) NULL,
        [IsActive] [bit] NOT NULL CONSTRAINT DF_Locations_IsActive DEFAULT (1),
        [CapacityVolumeCm3] [decimal](18, 3) NULL,
        [CapacityWidthCm] [decimal](18, 3) NULL,
        [CapacityLengthCm] [decimal](18, 3) NULL,
        [CapacityHeightCm] [decimal](18, 3) NULL
    );
    INSERT INTO [dbo].[Locations] ([LocationCode], [Zone], [Description], [IsActive]) VALUES 
    (N'RCV-01', N'RCV', N'จุดรับสินค้าเข้าคลัง (Receiving Dock)', 1),
    (N'A-01-01', N'A', N'ชั้นวางโซน A แถว 1 ช่อง 1', 1),
    (N'A-01-02', N'A', N'ชั้นวางโซน A แถว 1 ช่อง 2', 1),
    (N'B-01-01', N'B', N'ชั้นวางโซน B แถว 1 ช่อง 1', 1),
    (N'OUT-01', N'OUT', N'จุดจัดเตรียมส่งสินค้า (Shipping Stage)', 1);
    PRINT N'✅ สร้างตาราง Locations พร้อมข้อมูลตัวอย่างเรียบร้อยแล้ว';
END
GO

-- 3.3 ตาราง Products
IF OBJECT_ID('dbo.Products', 'U') IS NULL
BEGIN
    CREATE TABLE [dbo].[Products](
        [ProductId] [int] IDENTITY(1,1) NOT NULL PRIMARY KEY,
        [ItemCode] [nvarchar](50) NOT NULL UNIQUE,
        [Barcode] [nvarchar](50) NOT NULL UNIQUE,
        [ItemName] [nvarchar](200) NOT NULL,
        [Category] [nvarchar](50) NULL,
        [UOM] [nvarchar](20) NOT NULL CONSTRAINT DF_Products_UOM DEFAULT (N'PCS'),
        [MinStock] [int] NOT NULL CONSTRAINT DF_Products_MinStock DEFAULT (0),
        [CreatedAt] [datetime2](7) NOT NULL CONSTRAINT DF_Products_CreatedAt DEFAULT (SYSDATETIME()),
        [UnitVolumeCm3] [decimal](18, 3) NULL,
        [UnitWidthCm] [decimal](18, 3) NULL,
        [UnitLengthCm] [decimal](18, 3) NULL,
        [UnitHeightCm] [decimal](18, 3) NULL
    );
    PRINT N'✅ สร้างตาราง Products เรียบร้อยแล้ว';
END
GO

-- 3.4 ตาราง Stock
IF OBJECT_ID('dbo.Stock', 'U') IS NULL
BEGIN
    CREATE TABLE [dbo].[Stock](
        [StockId] [int] IDENTITY(1,1) NOT NULL PRIMARY KEY,
        [ProductId] [int] NOT NULL CONSTRAINT FK_Stock_Products FOREIGN KEY REFERENCES [dbo].[Products]([ProductId]),
        [LocationId] [int] NOT NULL CONSTRAINT FK_Stock_Locations FOREIGN KEY REFERENCES [dbo].[Locations]([LocationId]),
        [Quantity] [int] NOT NULL CONSTRAINT DF_Stock_Quantity DEFAULT (0),
        [LastUpdated] [datetime2](7) NOT NULL CONSTRAINT DF_Stock_LastUpdated DEFAULT (SYSDATETIME()),
        CONSTRAINT [UQ_Product_Location] UNIQUE ([ProductId], [LocationId])
    );
    PRINT N'✅ สร้างตาราง Stock เรียบร้อยแล้ว';
END
GO

-- 3.5 ตาราง StockTransactions
IF OBJECT_ID('dbo.StockTransactions', 'U') IS NULL
BEGIN
    CREATE TABLE [dbo].[StockTransactions](
        [TransactionId] [int] IDENTITY(1,1) NOT NULL PRIMARY KEY,
        [TransactionType] [nvarchar](20) NOT NULL,
        [ProductId] [int] NOT NULL CONSTRAINT FK_Tx_Products FOREIGN KEY REFERENCES [dbo].[Products]([ProductId]),
        [FromLocationId] [int] NULL,
        [ToLocationId] [int] NULL,
        [Quantity] [int] NOT NULL,
        [ReferenceNo] [nvarchar](100) NULL,
        [UserId] [int] NOT NULL CONSTRAINT FK_Tx_Users FOREIGN KEY REFERENCES [dbo].[Users]([UserId]),
        [CreatedAt] [datetime2](7) NOT NULL CONSTRAINT DF_Tx_CreatedAt DEFAULT (SYSDATETIME())
    );
    PRINT N'✅ สร้างตาราง StockTransactions เรียบร้อยแล้ว';
END
GO

-- ====================================================================
-- 4. ปรับแก้ CHECK Constraint ของ Role ให้รองรับ POWERUSER และสร้าง User
-- ====================================================================

-- 4.1 ลบ CHECK Constraint เก่าของ Role (ถ้ามี)
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

-- 4.2 เพิ่ม CHECK Constraint ใหม่ที่รองรับ ADMIN, POWERUSER, OPERATOR, VIEWER, READONLY
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE parent_object_id = OBJECT_ID('dbo.Users') AND name = 'CK_Users_Role')
BEGIN
    ALTER TABLE dbo.Users ADD CONSTRAINT CK_Users_Role CHECK (Role IN ('ADMIN', 'POWERUSER', 'OPERATOR', 'VIEWER', 'READONLY'));
END;
GO

-- 4.3 สร้างบัญชีเข้าสู่ระบบเว็บ WMS (รหัสผ่านคือ admin123 ทั้งหมด)
DECLARE @PasswordHash NVARCHAR(255) = N'$2a$10$JSFnDF3tSsoDmYBfPMOYuOA7qcyQqADyVDA0G/eXPoBkYh/9OoK1y';

DELETE FROM dbo.Users WHERE Username IN ('admin', 'poweruser', 'picker01');

INSERT INTO dbo.Users (Username, PasswordHash, FullName, Role, IsActive, CreatedAt, Permissions)
VALUES 
    (N'admin', @PasswordHash, N'ผู้ดูแลระบบ', N'ADMIN', 1, SYSDATETIME(), N'ALL'),
    (N'poweruser', @PasswordHash, N'หัวหน้างานคลังสินค้า', N'POWERUSER', 1, SYSDATETIME(), N'ALL'),
    (N'picker01', @PasswordHash, N'พนักงานสแกน 01', N'OPERATOR', 1, SYSDATETIME(), N'RECEIVE,PUTAWAY,PICK,TRANSFER,CHECK,LOAD,CYCLECOUNT,LOOKUP');

PRINT N'✅ 4. สร้างบัญชีผู้ใช้งานสำหรับเข้าเว็บเรียบร้อยแล้ว:';
PRINT N'   - admin     / admin123 (ADMIN)';
PRINT N'   - poweruser / admin123 (POWERUSER)';
PRINT N'   - picker01  / admin123 (OPERATOR)';
GO

-- แสดงผลลัพธ์
SELECT UserId, Username, FullName, Role, IsActive, Permissions FROM dbo.Users;
GO
