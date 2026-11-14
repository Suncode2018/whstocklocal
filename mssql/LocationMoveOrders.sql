USE dbWMS;
IF OBJECT_ID('dbo.LocationMoveOrders','U') IS NULL
CREATE TABLE dbo.LocationMoveOrders(
 MoveId int IDENTITY PRIMARY KEY,RequestId uniqueidentifier NOT NULL UNIQUE,
 DocumentNo nvarchar(60) NULL,WhId int NOT NULL,ProductId int NOT NULL,
 ProductCode nvarchar(100) NOT NULL,ProductName nvarchar(500) NOT NULL,
 FromLocationCode nvarchar(50) NOT NULL,ToLocationCode nvarchar(50) NOT NULL,
 Quantity decimal(18,2) NOT NULL CHECK(Quantity>0),UnitCode nvarchar(30) NULL,
 AnaNo nvarchar(100) NULL,LotNo nvarchar(100) NULL,
 ReferenceNo nvarchar(60) NOT NULL,Status varchar(12) NOT NULL CHECK(Status IN('DRAFT','OPEN','DONE','CANCELLED')),
 CreatedBy nvarchar(50) NOT NULL,CreatedAt datetime2 NOT NULL DEFAULT SYSDATETIME(),
 CompletedBy nvarchar(50) NULL,CompletedAt datetime2 NULL,TransferId int NULL);
IF NOT EXISTS(SELECT 1 FROM sys.indexes WHERE name='IX_LocationMoveOrders_Reserved' AND object_id=OBJECT_ID('dbo.LocationMoveOrders'))
 CREATE INDEX IX_LocationMoveOrders_Reserved ON dbo.LocationMoveOrders(WhId,ProductId,FromLocationCode,Status) INCLUDE(Quantity);
EXEC(N'CREATE OR ALTER TRIGGER dbo.TR_Stock_LocationMoveReservation ON dbo.tblStock AFTER UPDATE,DELETE AS
BEGIN
 SET NOCOUNT ON;
 IF EXISTS(SELECT 1 FROM deleted d LEFT JOIN inserted i ON i.StockId=d.StockId
 WHERE (i.StockId IS NULL OR i.Quantity<d.Quantity) AND COALESCE(i.Quantity,0)<
 (SELECT COALESCE(SUM(m.Quantity),0) FROM dbo.LocationMoveOrders m WITH(UPDLOCK,HOLDLOCK)
 WHERE m.WhId=d.whid AND m.ProductId=d.ProductId AND m.FromLocationCode=d.LocationCode AND m.Status=''OPEN''))
 THROW 51071,N''ยอดสินค้าถูกจองในใบย้ายตำแหน่ง กรุณาดำเนินการหรือยกเลิกใบย้ายก่อน'',1;
END');
