USE dbMaster;
SET XACT_ABORT ON;
IF OBJECT_ID('dbo.UserMenuAccess','U') IS NULL OR COL_LENGTH('dbo.UserMenuAccess','CanView') IS NULL THROW 51000,N'Run UserNavigation.sql / PermissionMatrix.sql before TwoRoles.sql',1;
IF NOT EXISTS(SELECT 1 FROM dbo.Users WHERE UPPER(LTRIM(RTRIM(Role)))='ADMIN' AND IsActive=1) THROW 51000,N'An active ADMIN is required before role migration',1;
BEGIN TRANSACTION;
IF OBJECT_ID('dbo.RoleMigrationBackup','U') IS NULL CREATE TABLE dbo.RoleMigrationBackup(MigrationVersion VARCHAR(30) NOT NULL,UserId INT NOT NULL,OldRole NVARCHAR(50) NOT NULL,SnapshotJson NVARCHAR(MAX) NOT NULL,CreatedAt DATETIME2 NOT NULL DEFAULT SYSDATETIME(),PRIMARY KEY(MigrationVersion,UserId));
INSERT INTO dbo.RoleMigrationBackup(MigrationVersion,UserId,OldRole,SnapshotJson)
SELECT 'ADMIN_USER_V1',u.UserId,u.Role,(SELECT u.UserId,u.Username,u.FullName,u.Role,u.Permissions,u.IsActive,JSON_QUERY((SELECT * FROM dbo.UserNavigation n WHERE n.UserId=u.UserId FOR JSON PATH)) AS Navigation,JSON_QUERY((SELECT * FROM dbo.UserMenuAccess m WHERE m.UserId=u.UserId FOR JSON PATH)) AS Menus FOR JSON PATH,WITHOUT_ARRAY_WRAPPER) FROM dbo.Users u WITH(UPDLOCK,HOLDLOCK) WHERE NOT EXISTS(SELECT 1 FROM dbo.RoleMigrationBackup b WHERE b.MigrationVersion='ADMIN_USER_V1' AND b.UserId=u.UserId);
CREATE TABLE #LegacyMap(RoleCode VARCHAR(20),Mode VARCHAR(8),MenuCode VARCHAR(30),CanEdit BIT,CanConfirm BIT,CanExport BIT,Operation BIT);
INSERT INTO #LegacyMap VALUES
('POWERUSER','DESKTOP','PRODUCTS',1,0,1,0),
('POWERUSER','DESKTOP','LOCATIONS',1,0,0,0),
('POWERUSER','DESKTOP','SHORTAGE_REASONS',1,0,0,0),
('POWERUSER','DESKTOP','RECEIVE',1,1,0,1),
('POWERUSER','HH','RECEIVE',1,1,0,1),
('POWERUSER','DESKTOP','PUTAWAY',1,1,0,1),
('POWERUSER','HH','PUTAWAY',1,1,0,1),
('POWERUSER','DESKTOP','PICK',0,1,0,1),
('POWERUSER','HH','PICK',0,1,0,1),
('POWERUSER','DESKTOP','LOAD',1,1,1,1),
('POWERUSER','HH','LOAD',1,1,1,1),
('POWERUSER','DESKTOP','CYCLECOUNT',1,0,0,1),
('POWERUSER','HH','CYCLECOUNT',1,0,0,1),
('POWERUSER','DESKTOP','TRANSFER',0,1,0,1),
('POWERUSER','HH','TRANSFER',0,1,0,1),
('POWERUSER','DESKTOP','STOCK',0,0,1,0),
('POWERUSER','DESKTOP','BOM_STOCK',0,0,1,0),
('POWERUSER','DESKTOP','LOOKUP',0,0,0,1),
('POWERUSER','HH','LOOKUP',0,0,0,1),
('SUPERVISOR','DESKTOP','PRODUCTS',0,0,1,0),
('SUPERVISOR','DESKTOP','LOCATIONS',0,0,0,0),
('SUPERVISOR','DESKTOP','SHORTAGE_REASONS',0,0,0,0),
('SUPERVISOR','DESKTOP','RECEIVE',1,1,0,1),
('SUPERVISOR','HH','RECEIVE',1,1,0,1),
('SUPERVISOR','DESKTOP','PUTAWAY',1,1,0,1),
('SUPERVISOR','HH','PUTAWAY',1,1,0,1),
('SUPERVISOR','DESKTOP','PICK',0,1,0,1),
('SUPERVISOR','HH','PICK',0,1,0,1),
('SUPERVISOR','DESKTOP','LOAD',1,1,1,1),
('SUPERVISOR','HH','LOAD',1,1,1,1),
('SUPERVISOR','DESKTOP','CYCLECOUNT',1,0,0,1),
('SUPERVISOR','HH','CYCLECOUNT',1,0,0,1),
('SUPERVISOR','DESKTOP','TRANSFER',0,1,0,1),
('SUPERVISOR','HH','TRANSFER',0,1,0,1),
('SUPERVISOR','DESKTOP','STOCK',0,0,1,0),
('SUPERVISOR','DESKTOP','BOM_STOCK',0,0,1,0),
('SUPERVISOR','DESKTOP','LOOKUP',0,0,0,1),
('SUPERVISOR','HH','LOOKUP',0,0,0,1),
('OPERATOR','DESKTOP','RECEIVE',1,1,0,1),
('OPERATOR','HH','RECEIVE',1,1,0,1),
('OPERATOR','DESKTOP','PUTAWAY',0,1,0,1),
('OPERATOR','HH','PUTAWAY',0,1,0,1),
('OPERATOR','DESKTOP','PICK',0,1,0,1),
('OPERATOR','HH','PICK',0,1,0,1),
('OPERATOR','DESKTOP','LOAD',0,1,1,1),
('OPERATOR','HH','LOAD',0,1,1,1),
('OPERATOR','DESKTOP','CYCLECOUNT',1,0,0,1),
('OPERATOR','HH','CYCLECOUNT',1,0,0,1),
('OPERATOR','DESKTOP','TRANSFER',0,1,0,1),
('OPERATOR','HH','TRANSFER',0,1,0,1),
('OPERATOR','DESKTOP','LOOKUP',0,0,0,1),
('OPERATOR','HH','LOOKUP',0,0,0,1),
('VIEWER','DESKTOP','PRODUCTS',0,0,1,0),
('VIEWER','DESKTOP','STOCK',0,0,1,0),
('VIEWER','DESKTOP','LOOKUP',0,0,0,1),
('VIEWER','HH','LOOKUP',0,0,0,1),
('READONLY','DESKTOP','PRODUCTS',0,0,1,0),
('READONLY','DESKTOP','STOCK',0,0,1,0),
('READONLY','DESKTOP','LOOKUP',0,0,0,1),
('READONLY','HH','LOOKUP',0,0,0,1);
SELECT u.UserId,UPPER(LTRIM(RTRIM(u.Role))) AS OldRole,u.Permissions INTO #Unconfigured FROM dbo.Users u WHERE UPPER(LTRIM(RTRIM(u.Role))) NOT IN('ADMIN','USER') AND NOT EXISTS(SELECT 1 FROM dbo.UserNavigation n WHERE n.UserId=u.UserId);
INSERT INTO dbo.UserNavigation(UserId,DesktopEnabled,HandheldEnabled) SELECT UserId,CASE WHEN OldRole IN('POWERUSER','SUPERVISOR','VIEWER','READONLY') THEN 1 ELSE 0 END,CASE WHEN OldRole='OPERATOR' THEN 1 ELSE 0 END FROM #Unconfigured;
INSERT INTO dbo.UserMenuAccess(UserId,Mode,MenuCode,CanView,CanEdit,CanConfirm,CanExport)
SELECT u.UserId,m.Mode,m.MenuCode,1,m.CanEdit,m.CanConfirm,m.CanExport FROM #Unconfigured u JOIN #LegacyMap m ON m.RoleCode=u.OldRole WHERE ((u.OldRole='OPERATOR' AND m.Mode='HH') OR (u.OldRole<>'OPERATOR' AND m.Mode='DESKTOP')) AND (u.OldRole<>'OPERATOR' OR m.Operation=0 OR EXISTS(SELECT 1 FROM STRING_SPLIT(COALESCE(u.Permissions,''),',') p WHERE UPPER(LTRIM(RTRIM(p.value))) IN('ALL',m.MenuCode) OR m.MenuCode='CYCLECOUNT' AND UPPER(LTRIM(RTRIM(p.value)))='CHECK'));
-- Freeze the effective legacy grants before changing the role label.
UPDATE a SET CanEdit=CASE WHEN m.CanEdit=1 THEN a.CanEdit ELSE 0 END,CanConfirm=CASE WHEN m.CanConfirm=1 THEN a.CanConfirm ELSE 0 END,CanExport=CASE WHEN m.CanExport=1 THEN a.CanExport ELSE 0 END FROM dbo.UserMenuAccess a JOIN dbo.Users u ON u.UserId=a.UserId JOIN #LegacyMap m ON m.RoleCode=UPPER(LTRIM(RTRIM(u.Role))) AND m.Mode=a.Mode AND m.MenuCode=a.MenuCode;
DELETE a FROM dbo.UserMenuAccess a JOIN dbo.Users u ON u.UserId=a.UserId WHERE UPPER(LTRIM(RTRIM(u.Role))) NOT IN('ADMIN','USER') AND NOT EXISTS(SELECT 1 FROM #LegacyMap m WHERE m.RoleCode=UPPER(LTRIM(RTRIM(u.Role))) AND m.Mode=a.Mode AND m.MenuCode=a.MenuCode);
DECLARE @CheckName SYSNAME,@Sql NVARCHAR(MAX);DECLARE RoleChecks CURSOR LOCAL FAST_FORWARD FOR SELECT name FROM sys.check_constraints WHERE parent_object_id=OBJECT_ID('dbo.Users') AND (definition LIKE '%[[]Role[]]%' OR name='CK_Users_Role');OPEN RoleChecks;FETCH NEXT FROM RoleChecks INTO @CheckName;WHILE @@FETCH_STATUS=0 BEGIN SET @Sql=N'ALTER TABLE dbo.Users DROP CONSTRAINT '+QUOTENAME(@CheckName);EXEC sp_executesql @Sql;FETCH NEXT FROM RoleChecks INTO @CheckName;END CLOSE RoleChecks;DEALLOCATE RoleChecks;
UPDATE dbo.UserNavigation SET Revision=Revision+1,UpdatedAt=SYSDATETIME() WHERE UserId IN(SELECT UserId FROM dbo.Users WHERE UPPER(LTRIM(RTRIM(Role))) NOT IN('ADMIN','USER'));
UPDATE dbo.Users SET Role=CASE WHEN UPPER(LTRIM(RTRIM(Role)))='ADMIN' THEN 'ADMIN' ELSE 'USER' END;
ALTER TABLE dbo.Users WITH CHECK ADD CONSTRAINT CK_Users_Role CHECK(Role IN('ADMIN','USER'));
IF NOT EXISTS(SELECT 1 FROM dbo.UserRoles WHERE RoleCode='ADMIN') INSERT INTO dbo.UserRoles(RoleCode,RoleName,Description,IsActive) VALUES('ADMIN',N'ผู้ดูแลระบบ',N'จัดการระบบ ผู้ใช้ และสิทธิ์ทั้งหมด',1);
IF NOT EXISTS(SELECT 1 FROM dbo.UserRoles WHERE RoleCode='USER') INSERT INTO dbo.UserRoles(RoleCode,RoleName,Description,IsActive) VALUES('USER',N'ผู้ใช้งาน',N'ใช้งานตามช่องทาง เมนู และตารางสิทธิ์ที่ Admin กำหนด',1);
UPDATE dbo.UserRoles SET IsActive=CASE WHEN RoleCode IN('ADMIN','USER') THEN 1 ELSE 0 END;
DROP TABLE #Unconfigured;DROP TABLE #LegacyMap;
COMMIT;
