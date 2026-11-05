USE dbWMS;
IF COL_LENGTH('dbo.InboundOrders','SupplierDocumentNo') IS NULL ALTER TABLE dbo.InboundOrders ADD SupplierDocumentNo NVARCHAR(60) NULL;
IF COL_LENGTH('dbo.InboundOrders','DocumentDate') IS NULL ALTER TABLE dbo.InboundOrders ADD DocumentDate DATE NULL;
IF COL_LENGTH('dbo.InboundOrders','VatRate') IS NULL ALTER TABLE dbo.InboundOrders ADD VatRate DECIMAL(5,2) NULL;
IF COL_LENGTH('dbo.InboundLines','SupplierProductCode') IS NULL ALTER TABLE dbo.InboundLines ADD SupplierProductCode NVARCHAR(60) NULL;
IF COL_LENGTH('dbo.InboundLines','UnitPrice') IS NULL ALTER TABLE dbo.InboundLines ADD UnitPrice DECIMAL(18,4) NULL;
