USE dbMaster;
SET XACT_ABORT ON;
BEGIN TRANSACTION;
-- Existing dual-mode profiles retain Desktop. HH-only and disabled profiles remain unchanged.
UPDATE dbo.UserNavigation SET HandheldEnabled=0,Revision=Revision+1,UpdatedAt=SYSDATETIME() WHERE DesktopEnabled=1 AND HandheldEnabled=1;
IF NOT EXISTS(SELECT 1 FROM sys.check_constraints WHERE parent_object_id=OBJECT_ID('dbo.UserNavigation') AND name='CK_UserNavigation_SingleMode')
 ALTER TABLE dbo.UserNavigation ADD CONSTRAINT CK_UserNavigation_SingleMode CHECK(DesktopEnabled=0 OR HandheldEnabled=0);
COMMIT;
