-- Existing databases: allow one FG SKU on multiple ANA/LOT lines.
-- Run on DEV and deployment server. No rows or stock quantities are changed.
USE dbWMS;
GO
SET XACT_ABORT ON;
BEGIN TRY
 BEGIN TRANSACTION;
 IF OBJECT_ID(N'dbo.InboundLines',N'U') IS NULL
  THROW 51000, 'InboundLines table is missing. Install receiving schema first.', 1;
 IF COL_LENGTH(N'dbo.InboundLines',N'AnaNo') IS NULL OR COL_LENGTH(N'dbo.InboundLines',N'ProductionLotNo') IS NULL
  THROW 51000, 'Install InboundProduction.sql before this migration.', 1;
 -- SQL Server unique keys also reject repeated tuples containing NULL.
 IF EXISTS(SELECT 1 FROM dbo.InboundLines GROUP BY InboundId,ProductId,AnaNo,ProductionLotNo HAVING COUNT_BIG(*)>1)
  THROW 51000, 'Duplicate SKU/ANA/LOT rows exist. Review them before migration; no data was deleted.', 1;
 -- Establish the replacement key before removing the old restriction.
 IF NOT EXISTS(SELECT 1 FROM sys.key_constraints WHERE parent_object_id=OBJECT_ID(N'dbo.InboundLines') AND name=N'UQ_InboundLines_AnaLot')
  ALTER TABLE dbo.InboundLines ADD CONSTRAINT UQ_InboundLines_AnaLot UNIQUE(InboundId,ProductId,AnaNo,ProductionLotNo);
 IF EXISTS(SELECT 1 FROM sys.key_constraints WHERE parent_object_id=OBJECT_ID(N'dbo.InboundLines') AND name=N'UQ_InboundLines_Product')
  ALTER TABLE dbo.InboundLines DROP CONSTRAINT UQ_InboundLines_Product;
 COMMIT;
 SELECT N'OK' Status,N'SKU + ANA + LOT uniqueness installed; existing data preserved' Message;
END TRY
BEGIN CATCH
 IF @@TRANCOUNT>0 ROLLBACK;
 THROW;
END CATCH;
GO
