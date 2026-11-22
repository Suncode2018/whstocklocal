USE dbMaster;
SET XACT_ABORT ON;
BEGIN TRANSACTION;
IF COL_LENGTH('dbo.tblProductPackVersions','OuterPackUnit') IS NULL
 ALTER TABLE dbo.tblProductPackVersions ADD OuterPackUnit nvarchar(30) NULL;
IF COL_LENGTH('dbo.tblProductPackVersions','PacksPerOuter') IS NULL
 ALTER TABLE dbo.tblProductPackVersions ADD PacksPerOuter int NULL;
IF COL_LENGTH('dbo.tblProductPackVersions','InnerPackUnit') IS NULL
 ALTER TABLE dbo.tblProductPackVersions ADD InnerPackUnit nvarchar(30) NULL;
IF COL_LENGTH('dbo.tblProductPackVersions','UnitsPerInnerPack') IS NULL
 ALTER TABLE dbo.tblProductPackVersions ADD UnitsPerInnerPack decimal(18,6) NULL;
COMMIT;
