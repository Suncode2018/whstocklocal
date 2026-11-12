USE dbMaster;
SET XACT_ABORT ON;
BEGIN TRANSACTION;
IF OBJECT_ID('dbo.tblProductPackVersions','U') IS NULL THROW 51000,N'Install ProductPackVersions.sql first.',1;
IF COL_LENGTH('dbo.tblProductPackVersions','StockUnitLabel') IS NULL ALTER TABLE dbo.tblProductPackVersions ADD StockUnitLabel nvarchar(30) NULL;
IF COL_LENGTH('dbo.tblProductPackVersions','NetVolumeMlPerUnit') IS NULL ALTER TABLE dbo.tblProductPackVersions ADD NetVolumeMlPerUnit decimal(18,6) NULL CONSTRAINT CK_ProductPack_NetVolume CHECK(NetVolumeMlPerUnit>0);
COMMIT;
