USE dbMaster;
IF OBJECT_ID('dbo.UserNavigation','U') IS NULL CREATE TABLE dbo.UserNavigation(UserId INT PRIMARY KEY REFERENCES dbo.Users(UserId) ON DELETE CASCADE,DesktopEnabled BIT NOT NULL DEFAULT 0,HandheldEnabled BIT NOT NULL DEFAULT 0,Revision INT NOT NULL DEFAULT 1,UpdatedAt DATETIME2 NOT NULL DEFAULT SYSDATETIME());
IF OBJECT_ID('dbo.UserMenuAccess','U') IS NULL CREATE TABLE dbo.UserMenuAccess(UserId INT NOT NULL REFERENCES dbo.Users(UserId) ON DELETE CASCADE,Mode VARCHAR(8) NOT NULL CHECK(Mode IN('DESKTOP','HH')),MenuCode VARCHAR(30) NOT NULL,CONSTRAINT PK_UserMenuAccess PRIMARY KEY(UserId,Mode,MenuCode));
USE dbMaster;
INSERT INTO dbo.Permissions(PermissionCode,PermissionName,Description,IsActive)
SELECT v.Code,v.Name,N'สิทธิ์งานคลัง',1 FROM(VALUES(N'RECEIVE',N'รับสินค้า'),(N'PUTAWAY',N'จัดเก็บสินค้า'),(N'PICK',N'เบิกจ่าย'),(N'LOAD',N'จัดส่ง'),(N'CYCLECOUNT',N'ตรวจนับ'),(N'TRANSFER',N'โอนย้าย'),(N'LOOKUP',N'ค้นหาสต๊อก'))v(Code,Name) WHERE NOT EXISTS(SELECT 1 FROM dbo.Permissions p WHERE p.PermissionCode=v.Code);

USE dbMaster;
SET XACT_ABORT ON;
BEGIN TRANSACTION;
-- Existing dual-mode profiles retain Desktop. HH-only and disabled profiles remain unchanged.
UPDATE dbo.UserNavigation SET HandheldEnabled=0,Revision=Revision+1,UpdatedAt=SYSDATETIME() WHERE DesktopEnabled=1 AND HandheldEnabled=1;
IF NOT EXISTS(SELECT 1 FROM sys.check_constraints WHERE parent_object_id=OBJECT_ID('dbo.UserNavigation') AND name='CK_UserNavigation_SingleMode')
 ALTER TABLE dbo.UserNavigation ADD CONSTRAINT CK_UserNavigation_SingleMode CHECK(DesktopEnabled=0 OR HandheldEnabled=0);
COMMIT;

USE dbMaster;
IF COL_LENGTH('dbo.UserMenuAccess','CanView') IS NULL ALTER TABLE dbo.UserMenuAccess ADD CanView BIT NOT NULL CONSTRAINT DF_UserMenu_View DEFAULT 1 WITH VALUES;
IF COL_LENGTH('dbo.UserMenuAccess','CanEdit') IS NULL ALTER TABLE dbo.UserMenuAccess ADD CanEdit BIT NOT NULL CONSTRAINT DF_UserMenu_Edit DEFAULT 1 WITH VALUES;
IF COL_LENGTH('dbo.UserMenuAccess','CanConfirm') IS NULL ALTER TABLE dbo.UserMenuAccess ADD CanConfirm BIT NOT NULL CONSTRAINT DF_UserMenu_Confirm DEFAULT 1 WITH VALUES;
IF COL_LENGTH('dbo.UserMenuAccess','CanExport') IS NULL ALTER TABLE dbo.UserMenuAccess ADD CanExport BIT NOT NULL CONSTRAINT DF_UserMenu_Export DEFAULT 1 WITH VALUES;
IF OBJECT_ID('dbo.UserAccessAudit','U') IS NULL CREATE TABLE dbo.UserAccessAudit(AuditId INT IDENTITY PRIMARY KEY,UserId INT NOT NULL,ActorId INT NOT NULL,ActorName NVARCHAR(100) NOT NULL,BeforeJson NVARCHAR(MAX) NOT NULL,AfterJson NVARCHAR(MAX) NOT NULL,ChangedAt DATETIME2 NOT NULL DEFAULT SYSDATETIME());
