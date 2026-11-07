SET XACT_ABORT ON;
BEGIN TRANSACTION;
IF OBJECT_ID('dbWMS.dbo.DeliveryNumberSeries','U') IS NULL
CREATE TABLE dbWMS.dbo.DeliveryNumberSeries(
 WarehouseCode nvarchar(20) NOT NULL,
 DocumentDate date NOT NULL,
 LastNumber int NOT NULL CHECK(LastNumber>0),
 CONSTRAINT PK_DeliveryNumberSeries PRIMARY KEY(WarehouseCode,DocumentDate)
);
COMMIT;
