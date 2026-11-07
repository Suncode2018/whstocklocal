USE dbMaster;
IF OBJECT_ID('dbo.tblSuppliers','U') IS NULL
CREATE TABLE dbo.tblSuppliers (
 SupplierId INT IDENTITY PRIMARY KEY, SupplierCode NVARCHAR(30) NOT NULL UNIQUE,
 SupplierName NVARCHAR(150) NOT NULL, TaxId VARCHAR(13) NULL, BranchCode VARCHAR(5) NOT NULL DEFAULT '00000',
 Address NVARCHAR(500) NULL, ContactName NVARCHAR(100) NULL, Phone NVARCHAR(50) NULL, Email NVARCHAR(150) NULL,
 SupplyTypes VARCHAR(30) NOT NULL, IsActive BIT NOT NULL DEFAULT 1,
 CreatedAt DATETIME2 NOT NULL DEFAULT SYSDATETIME(), UpdatedAt DATETIME2 NOT NULL DEFAULT SYSDATETIME()
);
IF NOT EXISTS(SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID('dbo.tblSuppliers') AND name='UQ_tblSuppliers_TaxBranch')
 CREATE UNIQUE INDEX UQ_tblSuppliers_TaxBranch ON dbo.tblSuppliers(TaxId,BranchCode) WHERE TaxId IS NOT NULL AND TaxId <> '0';
IF OBJECT_ID('dbo.tblSupplierProducts','U') IS NULL
CREATE TABLE dbo.tblSupplierProducts (
 MappingId INT IDENTITY PRIMARY KEY, SupplierId INT NOT NULL REFERENCES dbo.tblSuppliers(SupplierId),
 SupplierProductCode NVARCHAR(60) NOT NULL, ProductId INT NOT NULL REFERENCES dbo.tblProducts(ProductId),
 IsActive BIT NOT NULL DEFAULT 1, UpdatedAt DATETIME2 NOT NULL DEFAULT SYSDATETIME(),
 CONSTRAINT UQ_tblSupplierProducts_Code UNIQUE(SupplierId,SupplierProductCode)
);
USE dbWMS;
IF COL_LENGTH('dbo.InboundOrders','SupplierId') IS NULL ALTER TABLE dbo.InboundOrders ADD SupplierId INT NULL;

USE dbMaster;
SET XACT_ABORT ON;
BEGIN TRANSACTION;
IF EXISTS(SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID('dbo.tblSuppliers') AND name='UQ_tblSuppliers_TaxBranch' AND filter_definition NOT LIKE '%<>%0%')
 DROP INDEX UQ_tblSuppliers_TaxBranch ON dbo.tblSuppliers;
IF NOT EXISTS(SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID('dbo.tblSuppliers') AND name='UQ_tblSuppliers_TaxBranch')
 CREATE UNIQUE INDEX UQ_tblSuppliers_TaxBranch ON dbo.tblSuppliers(TaxId,BranchCode) WHERE TaxId IS NOT NULL AND TaxId <> '0';
COMMIT;

GO
-- Supplier profile fields
USE dbMaster;
IF COL_LENGTH('dbo.tblSuppliers','GoodsServices') IS NULL ALTER TABLE dbo.tblSuppliers ADD GoodsServices NVARCHAR(500) NULL;
IF COL_LENGTH('dbo.tblSuppliers','ApprovalDate') IS NULL ALTER TABLE dbo.tblSuppliers ADD ApprovalDate DATE NULL;
ALTER TABLE dbo.tblSuppliers ALTER COLUMN Phone NVARCHAR(150) NULL;
