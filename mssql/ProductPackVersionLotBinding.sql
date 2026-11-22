-- Explicit packaging-version control and Lot-level traceability.
-- Safe additive schema changes only; this script does not rewrite stock or history.
USE dbMaster;
SET XACT_ABORT ON;
BEGIN TRANSACTION;

-- Allow multiple packaging versions to be created on the same calendar day.
DECLARE @Name sysname,@IsConstraint bit,@Command nvarchar(max);
DECLARE DateUniqueIndexes CURSOR LOCAL FAST_FORWARD FOR
 SELECT i.name,i.is_unique_constraint
 FROM sys.indexes i
 WHERE i.object_id=OBJECT_ID(N'dbo.tblProductPackVersions') AND i.is_unique=1
  AND (SELECT COUNT(*) FROM sys.index_columns ic WHERE ic.object_id=i.object_id AND ic.index_id=i.index_id AND ic.key_ordinal>0)=2
  AND EXISTS(SELECT 1 FROM sys.index_columns ic JOIN sys.columns c ON c.object_id=ic.object_id AND c.column_id=ic.column_id WHERE ic.object_id=i.object_id AND ic.index_id=i.index_id AND ic.key_ordinal>0 AND c.name=N'ProductId')
  AND EXISTS(SELECT 1 FROM sys.index_columns ic JOIN sys.columns c ON c.object_id=ic.object_id AND c.column_id=ic.column_id WHERE ic.object_id=i.object_id AND ic.index_id=i.index_id AND ic.key_ordinal>0 AND c.name=N'EffectiveFrom');
OPEN DateUniqueIndexes;
 FETCH NEXT FROM DateUniqueIndexes INTO @Name,@IsConstraint;
WHILE @@FETCH_STATUS=0
BEGIN
 IF @IsConstraint=1 SET @Command=N'ALTER TABLE dbo.tblProductPackVersions DROP CONSTRAINT '+QUOTENAME(@Name)+N';';
 ELSE SET @Command=N'DROP INDEX '+QUOTENAME(@Name)+N' ON dbo.tblProductPackVersions;';
 EXEC sys.sp_executesql @Command;
 FETCH NEXT FROM DateUniqueIndexes INTO @Name,@IsConstraint;
END;
CLOSE DateUniqueIndexes;
DEALLOCATE DateUniqueIndexes;

IF COL_LENGTH(N'dbo.tblProductPackVersions',N'PackTestFingerprint') IS NULL
 ALTER TABLE dbo.tblProductPackVersions ADD PackTestFingerprint char(64) NULL;
IF COL_LENGTH(N'dbo.tblProductPackVersions',N'PackTestPassedAt') IS NULL
 ALTER TABLE dbo.tblProductPackVersions ADD PackTestPassedAt datetime2 NULL;
IF COL_LENGTH(N'dbo.tblProductPackVersions',N'PackTestPassedBy') IS NULL
 ALTER TABLE dbo.tblProductPackVersions ADD PackTestPassedBy nvarchar(100) NULL;
-- Existing versions predate per-LOT version links. Preserve them as non-editable
-- when legacy documents exist, while new versions can be edited until used.
IF COL_LENGTH(N'dbo.tblProductPackVersions',N'LegacyUsageUnknown') IS NULL
 ALTER TABLE dbo.tblProductPackVersions ADD LegacyUsageUnknown bit NOT NULL CONSTRAINT DF_tblProductPackVersions_LegacyUsageUnknown DEFAULT 1 WITH VALUES;

-- A referenced version can be removed from the working list without breaking
-- historical Lot/stock/pallet links. Unused versions are still hard-deleted.
IF COL_LENGTH(N'dbo.tblProductPackVersions',N'IsDeleted') IS NULL
 ALTER TABLE dbo.tblProductPackVersions ADD IsDeleted bit NOT NULL CONSTRAINT DF_tblProductPackVersions_IsDeleted DEFAULT 0 WITH VALUES;


IF OBJECT_ID(N'dbo.ProductPackStatusAudit',N'U') IS NULL
 CREATE TABLE dbo.ProductPackStatusAudit(
  AuditId bigint IDENTITY PRIMARY KEY,
  PackVersionId int NOT NULL REFERENCES dbo.tblProductPackVersions(PackVersionId),
  OldIsActive bit NOT NULL,NewIsActive bit NOT NULL,
  Reason nvarchar(500) NOT NULL,Actor nvarchar(100) NOT NULL,
  ChangedAt datetime2 NOT NULL DEFAULT SYSDATETIME()
 );

-- Keep a snapshot/audit trail when a version is removed from the working list.
IF OBJECT_ID(N'dbo.ProductPackVersionDeleteAudit',N'U') IS NULL
 CREATE TABLE dbo.ProductPackVersionDeleteAudit(
  AuditId bigint IDENTITY PRIMARY KEY,
  ProductId int NOT NULL,PackVersionId int NOT NULL,VersionNo int NOT NULL,
  SnapshotJson nvarchar(max) NOT NULL,Reason nvarchar(500) NOT NULL,
  Actor nvarchar(100) NOT NULL,DeletedAt datetime2 NOT NULL DEFAULT SYSDATETIME()
 );

COMMIT;

USE dbWMS;
IF COL_LENGTH(N'dbo.InboundReceipts',N'PackVersionId') IS NULL
 ALTER TABLE dbo.InboundReceipts ADD PackVersionId int NULL;
IF COL_LENGTH(N'dbo.tblStockTransactions',N'PackVersionId') IS NULL
 ALTER TABLE dbo.tblStockTransactions ADD PackVersionId int NULL;
IF COL_LENGTH(N'dbo.tblStockTransactions',N'AdjustmentInputQuantity') IS NULL
 ALTER TABLE dbo.tblStockTransactions ADD AdjustmentInputQuantity decimal(18,6) NULL;
IF COL_LENGTH(N'dbo.tblStockTransactions',N'AdjustmentInputUnit') IS NULL
 ALTER TABLE dbo.tblStockTransactions ADD AdjustmentInputUnit nvarchar(30) NULL;
IF COL_LENGTH(N'dbo.tblStockTransactions',N'AdjustmentUnitsPerInput') IS NULL
 ALTER TABLE dbo.tblStockTransactions ADD AdjustmentUnitsPerInput decimal(18,6) NULL;
IF COL_LENGTH(N'dbo.tblStockTransactions',N'AdjustmentBaseQuantity') IS NULL
 ALTER TABLE dbo.tblStockTransactions ADD AdjustmentBaseQuantity decimal(18,6) NULL;
IF COL_LENGTH(N'dbo.tblStockTransactions',N'AdjustmentCalculation') IS NULL
 ALTER TABLE dbo.tblStockTransactions ADD AdjustmentCalculation nvarchar(1000) NULL;
IF COL_LENGTH(N'dbo.tblStockTransactions',N'AdjustmentAnaNo') IS NULL
 ALTER TABLE dbo.tblStockTransactions ADD AdjustmentAnaNo nvarchar(100) NULL;
IF COL_LENGTH(N'dbo.tblStockTransactions',N'AdjustmentLotNo') IS NULL
 ALTER TABLE dbo.tblStockTransactions ADD AdjustmentLotNo nvarchar(100) NULL;
GO

-- Rollback guide: only use after application writes are stopped and PackVersionId
-- is no longer referenced. Restore the former unique(ProductId, EffectiveFrom)
-- index only after verifying there are no same-day variants.
