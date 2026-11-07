USE [dbWMS];
IF COL_LENGTH('dbo.InboundOrders','SourceMode') IS NULL
 ALTER TABLE dbo.InboundOrders ADD SourceMode varchar(16) NOT NULL CONSTRAINT DF_Inbound_SourceMode DEFAULT 'EXISTING_PO';
GO
IF OBJECT_ID('dbo.PurchaseOrders','U') IS NULL
CREATE TABLE dbo.PurchaseOrders(
 PurchaseOrderId int IDENTITY PRIMARY KEY,
 PONo nvarchar(60) NOT NULL UNIQUE,
 InboundId int NOT NULL UNIQUE REFERENCES dbo.InboundOrders(InboundId),
 SupplierId int NOT NULL,
 ReceiveType varchar(4) NOT NULL CHECK(ReceiveType IN ('RM','PKG','SEMI')),
 WhId int NOT NULL,
 DocumentDate date NOT NULL,
 VatRate decimal(5,2) NOT NULL DEFAULT 0,
 CreatedBy nvarchar(50) NOT NULL,
 CreatedAt datetime2 NOT NULL DEFAULT SYSDATETIME()
);
IF OBJECT_ID('dbo.PurchaseOrderLines','U') IS NULL
CREATE TABLE dbo.PurchaseOrderLines(
 PurchaseOrderLineId int IDENTITY PRIMARY KEY,
 PurchaseOrderId int NOT NULL REFERENCES dbo.PurchaseOrders(PurchaseOrderId),
 ProductId int NOT NULL,
 Quantity decimal(18,2) NOT NULL CHECK(Quantity>0),
 UnitPrice decimal(18,4) NOT NULL CHECK(UnitPrice>=0),
 SupplierProductCode nvarchar(60) NULL,
 UNIQUE(PurchaseOrderId,ProductId)
);
