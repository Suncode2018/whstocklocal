SET XACT_ABORT ON;
IF OBJECT_ID('dbWMS.dbo.InboundManufacturerLinks','U') IS NULL CREATE TABLE dbWMS.dbo.InboundManufacturerLinks(LineId int NOT NULL PRIMARY KEY REFERENCES dbWMS.dbo.InboundLines(LineId),LinkId int NOT NULL,ManufacturerId int NOT NULL,SupplierId int NOT NULL,DocumentDate date NOT NULL,LinkSnapshot nvarchar(max) NOT NULL CHECK(ISJSON(LinkSnapshot)=1));
