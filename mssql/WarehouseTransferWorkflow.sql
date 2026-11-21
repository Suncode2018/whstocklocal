USE dbWMS;
IF OBJECT_ID('dbo.WarehouseTransferReceipts','U') IS NULL
CREATE TABLE dbo.WarehouseTransferReceipts(
 LineId int NOT NULL PRIMARY KEY REFERENCES dbo.DeliveryLines(LineId),
 DeliveryId int NOT NULL REFERENCES dbo.DeliveryOrders(DeliveryId),WhId int NOT NULL,
 ProductId int NOT NULL,LocationCode nvarchar(50) NOT NULL,
 ReceivedQuantity decimal(18,2) NOT NULL CHECK(ReceivedQuantity>0),
 StoredQuantity decimal(18,2) NOT NULL DEFAULT 0 CHECK(StoredQuantity>=0),
 ReceivedBy nvarchar(100) NOT NULL,ReceivedAt datetime2 NOT NULL DEFAULT SYSDATETIME(),
 CONSTRAINT CK_WarehouseTransferReceived CHECK(StoredQuantity<=ReceivedQuantity));
IF OBJECT_ID('dbo.WarehouseTransferStorage','U') IS NULL
CREATE TABLE dbo.WarehouseTransferStorage(
 StorageId int IDENTITY PRIMARY KEY,RequestId uniqueidentifier NOT NULL UNIQUE,
 LineId int NOT NULL REFERENCES dbo.WarehouseTransferReceipts(LineId),
 ToLocationCode nvarchar(50) NOT NULL,Quantity decimal(18,2) NOT NULL CHECK(Quantity>0),
 CreatedBy nvarchar(100) NOT NULL,CreatedAt datetime2 NOT NULL DEFAULT SYSDATETIME());
IF OBJECT_ID('dbo.WarehouseTransferLotAllocations','U') IS NULL
CREATE TABLE dbo.WarehouseTransferLotAllocations(
 AllocationId int IDENTITY PRIMARY KEY,
 LineId int NOT NULL REFERENCES dbo.DeliveryLines(LineId),
 [LineNo] int NOT NULL CHECK([LineNo]>0),
 AnaNo nvarchar(100) NULL,LotNo nvarchar(100) NULL,FifoDate datetime2 NULL,
 Quantity decimal(18,2) NOT NULL CHECK(Quantity>0),
 StoredQuantity decimal(18,2) NOT NULL DEFAULT 0 CHECK(StoredQuantity>=0),
 IsUnattributed bit NOT NULL DEFAULT 0,
 CreatedAt datetime2 NOT NULL DEFAULT SYSDATETIME(),
 CONSTRAINT UQ_WarehouseTransferLotAllocations_LineNo UNIQUE(LineId,[LineNo]),
 CONSTRAINT CK_WarehouseTransferLotAllocations_Stored CHECK(StoredQuantity<=Quantity),
 CONSTRAINT CK_WarehouseTransferLotAllocations_Source CHECK((IsUnattributed=1 AND AnaNo IS NULL AND LotNo IS NULL) OR (IsUnattributed=0 AND (AnaNo IS NOT NULL OR LotNo IS NOT NULL)))
);
IF COL_LENGTH('dbo.WarehouseTransferStorage','AllocationId') IS NULL
 ALTER TABLE dbo.WarehouseTransferStorage ADD AllocationId int NULL;
IF NOT EXISTS(SELECT 1 FROM sys.foreign_keys WHERE name='FK_WarehouseTransferStorage_Allocation')
 ALTER TABLE dbo.WarehouseTransferStorage ADD CONSTRAINT FK_WarehouseTransferStorage_Allocation FOREIGN KEY(AllocationId) REFERENCES dbo.WarehouseTransferLotAllocations(AllocationId);
IF NOT EXISTS(SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID('dbo.WarehouseTransferLotAllocations') AND name='IX_WarehouseTransferLotAllocations_Line')
 CREATE INDEX IX_WarehouseTransferLotAllocations_Line ON dbo.WarehouseTransferLotAllocations(LineId,AllocationId) INCLUDE(AnaNo,LotNo,FifoDate,Quantity,StoredQuantity,IsUnattributed);
IF NOT EXISTS(SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID('dbo.WarehouseTransferReceipts') AND name='IX_WarehouseTransferReceipts_RCV')
 CREATE INDEX IX_WarehouseTransferReceipts_RCV ON dbo.WarehouseTransferReceipts(WhId,ProductId,LocationCode) INCLUDE(ReceivedQuantity,StoredQuantity);
EXEC(N'CREATE OR ALTER TRIGGER dbo.TR_Stock_WarehouseReceiptReservation ON dbo.tblStock AFTER UPDATE,DELETE AS
BEGIN
 SET NOCOUNT ON;
 IF EXISTS(SELECT 1 FROM deleted d LEFT JOIN inserted i ON i.StockId=d.StockId
 WHERE (i.StockId IS NULL OR i.Quantity<d.Quantity) AND COALESCE(i.Quantity,0)<
 (SELECT COALESCE(SUM(r.ReceivedQuantity-r.StoredQuantity),0) FROM dbo.WarehouseTransferReceipts r WITH(UPDLOCK,HOLDLOCK)
 WHERE r.WhId=d.whid AND r.ProductId=d.ProductId AND r.LocationCode=d.LocationCode))
 THROW 51072,N''ยอด RCV นี้อยู่ในใบรับโอน กรุณาจัดเก็บผ่านหน้าโอนข้ามคลัง'',1;
END');
