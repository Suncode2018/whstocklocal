-- Compatibility installer. Existing historical tables are retained.
USE [dbMaster];
SET XACT_ABORT ON;
BEGIN TRANSACTION;
IF NOT EXISTS (SELECT 1 FROM dbo.tblCategories WITH (UPDLOCK,HOLDLOCK) WHERE UPPER(CategoryCode) IN ('SEMI','SFG'))
 INSERT INTO dbo.tblCategories (CategoryCode,CategoryName) VALUES (N'SEMI',N'Semi Finished Product');
COMMIT;
USE [dbWMS];
IF OBJECT_ID('dbo.InboundOrders','U') IS NULL
CREATE TABLE dbo.InboundOrders (
 InboundId INT IDENTITY PRIMARY KEY,
 RequestId UNIQUEIDENTIFIER NOT NULL UNIQUE,
 ReceiveNo NVARCHAR(40) NOT NULL UNIQUE,
 ReceiveType VARCHAR(4) NOT NULL CHECK (ReceiveType IN ('RM','PKG','SEMI','FG')),
 WhId INT NOT NULL,
 ReferenceNo NVARCHAR(60) NOT NULL,
 SupplierName NVARCHAR(150) NULL,
 Status VARCHAR(12) NOT NULL DEFAULT 'OPEN' CHECK(Status IN ('OPEN','PARTIAL','COMPLETED')),
 CreatedBy NVARCHAR(50) NOT NULL,
 CreatedAt DATETIME2 NOT NULL DEFAULT SYSDATETIME()
);
IF OBJECT_ID('dbo.InboundLines','U') IS NULL
CREATE TABLE dbo.InboundLines (
 LineId INT IDENTITY PRIMARY KEY,
 InboundId INT NOT NULL REFERENCES dbo.InboundOrders(InboundId),
 ProductId INT NOT NULL,
 OrderedQuantity DECIMAL(18,2) NOT NULL CHECK(OrderedQuantity>0),
 ReceivedQuantity DECIMAL(18,2) NOT NULL DEFAULT 0,
 CONSTRAINT CK_InboundLines_Received CHECK(ReceivedQuantity>=0 AND ReceivedQuantity<=OrderedQuantity),
 CONSTRAINT UQ_InboundLines_AnaLot UNIQUE(InboundId, ProductId, AnaNo, ProductionLotNo)
);
IF OBJECT_ID('dbo.InboundReceipts','U') IS NULL
CREATE TABLE dbo.InboundReceipts (
 ReceiptId INT IDENTITY PRIMARY KEY,
 RequestId UNIQUEIDENTIFIER NOT NULL UNIQUE,
 LineId INT NOT NULL REFERENCES dbo.InboundLines(LineId),
 LocationCode NVARCHAR(50) NOT NULL,
 Quantity DECIMAL(18,2) NOT NULL CHECK(Quantity>0),
 LotNo NVARCHAR(60) NULL,
 MfgDate DATE NULL,
 ExpDate DATE NULL,
 ReceivedBy NVARCHAR(50) NOT NULL,
 ReceivedAt DATETIME2 NOT NULL DEFAULT SYSDATETIME(),
 CONSTRAINT CK_InboundReceipts_Dates CHECK(MfgDate IS NULL OR ExpDate IS NULL OR ExpDate>=MfgDate)
);

GO
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
 CREATE UNIQUE INDEX UQ_tblSuppliers_TaxBranch ON dbo.tblSuppliers(TaxId,BranchCode) WHERE TaxId IS NOT NULL;
IF OBJECT_ID('dbo.tblSupplierProducts','U') IS NULL
CREATE TABLE dbo.tblSupplierProducts (
 MappingId INT IDENTITY PRIMARY KEY, SupplierId INT NOT NULL REFERENCES dbo.tblSuppliers(SupplierId),
 SupplierProductCode NVARCHAR(60) NOT NULL, ProductId INT NOT NULL REFERENCES dbo.tblProducts(ProductId),
 IsActive BIT NOT NULL DEFAULT 1, UpdatedAt DATETIME2 NOT NULL DEFAULT SYSDATETIME(),
 CONSTRAINT UQ_tblSupplierProducts_Code UNIQUE(SupplierId,SupplierProductCode)
);
USE dbWMS;
IF COL_LENGTH('dbo.InboundOrders','SupplierId') IS NULL ALTER TABLE dbo.InboundOrders ADD SupplierId INT NULL;

GO
USE dbWMS;
IF COL_LENGTH('dbo.InboundOrders','SupplierDocumentNo') IS NULL ALTER TABLE dbo.InboundOrders ADD SupplierDocumentNo NVARCHAR(60) NULL;
IF COL_LENGTH('dbo.InboundOrders','DocumentDate') IS NULL ALTER TABLE dbo.InboundOrders ADD DocumentDate DATE NULL;
IF COL_LENGTH('dbo.InboundOrders','VatRate') IS NULL ALTER TABLE dbo.InboundOrders ADD VatRate DECIMAL(5,2) NULL;
IF COL_LENGTH('dbo.InboundLines','SupplierProductCode') IS NULL ALTER TABLE dbo.InboundLines ADD SupplierProductCode NVARCHAR(60) NULL;
IF COL_LENGTH('dbo.InboundLines','UnitPrice') IS NULL ALTER TABLE dbo.InboundLines ADD UnitPrice DECIMAL(18,4) NULL;

GO
-- Supplier tax optional patch
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
