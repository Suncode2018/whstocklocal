USE dbMaster;
SET XACT_ABORT ON;
BEGIN TRANSACTION;
IF EXISTS(SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID('dbo.tblSuppliers') AND name='UQ_tblSuppliers_TaxBranch' AND filter_definition NOT LIKE '%<>%0%')
 DROP INDEX UQ_tblSuppliers_TaxBranch ON dbo.tblSuppliers;
IF NOT EXISTS(SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID('dbo.tblSuppliers') AND name='UQ_tblSuppliers_TaxBranch')
 CREATE UNIQUE INDEX UQ_tblSuppliers_TaxBranch ON dbo.tblSuppliers(TaxId,BranchCode) WHERE TaxId IS NOT NULL AND TaxId <> '0';
COMMIT;
