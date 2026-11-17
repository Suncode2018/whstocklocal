USE dbWMS;
IF OBJECT_ID('dbo.StockLotAdjustments','U') IS NULL
BEGIN
 CREATE TABLE dbo.StockLotAdjustments(
 AdjustmentId int IDENTITY PRIMARY KEY,ProductId int NOT NULL,WhId int NOT NULL,
 LocationCode nvarchar(50) NOT NULL,ThroughTransId int NOT NULL,
 Quantity decimal(18,2) NOT NULL,RowsJson nvarchar(max) NOT NULL,
 Reason nvarchar(500) NOT NULL,CreatedBy nvarchar(100) NOT NULL,
 CreatedAt datetime2 NOT NULL DEFAULT SYSDATETIME(),
 CONSTRAINT CK_StockLotAdjustments_Json CHECK(ISJSON(RowsJson)=1));
 CREATE INDEX IX_StockLotAdjustments_Product ON dbo.StockLotAdjustments(ProductId,AdjustmentId);
END;
