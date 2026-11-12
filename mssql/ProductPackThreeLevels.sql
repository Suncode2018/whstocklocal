USE dbMaster;
SET XACT_ABORT ON;
BEGIN TRANSACTION;
IF COL_LENGTH('dbo.tblProductPackVersions','OuterPackUnit') IS NULL
 ALTER TABLE dbo.tblProductPackVersions ADD OuterPackUnit nvarchar(30) NULL;
IF COL_LENGTH('dbo.tblProductPackVersions','PacksPerOuter') IS NULL
 ALTER TABLE dbo.tblProductPackVersions ADD PacksPerOuter int NULL;
COMMIT;
