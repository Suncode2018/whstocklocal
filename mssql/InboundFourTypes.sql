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
