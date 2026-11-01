/*
  PO based receiving workflow.
  One open ReceiveOrders header per PO; ReceiveOrderLines stores ordered and
  received quantities. Handheld receiving updates line, stock and transaction
  log within one database transaction.
*/
IF OBJECT_ID('dbo.ReceiveOrders', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.ReceiveOrders (
    ReceiveId INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_ReceiveOrders PRIMARY KEY,
    ReceiveNo NVARCHAR(40) NOT NULL CONSTRAINT UQ_ReceiveOrders_ReceiveNo UNIQUE,
    PONumber NVARCHAR(60) NOT NULL CONSTRAINT UQ_ReceiveOrders_PONumber UNIQUE,
    SupplierName NVARCHAR(150) NULL,
    Status NVARCHAR(12) NOT NULL CONSTRAINT DF_ReceiveOrders_Status DEFAULT ('OPEN'),
    CreatedBy INT NOT NULL,
    CreatedAt DATETIME2 NOT NULL CONSTRAINT DF_ReceiveOrders_CreatedAt DEFAULT (SYSDATETIME()),
    CompletedAt DATETIME2 NULL,
    CONSTRAINT FK_ReceiveOrders_CreatedBy FOREIGN KEY (CreatedBy) REFERENCES dbo.Users(UserId),
    CONSTRAINT CK_ReceiveOrders_Status CHECK (Status IN ('OPEN','COMPLETED','CANCELLED'))
  );
END;

IF OBJECT_ID('dbo.ReceiveOrderLines', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.ReceiveOrderLines (
    ReceiveLineId INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_ReceiveOrderLines PRIMARY KEY,
    ReceiveId INT NOT NULL,
    ProductId INT NOT NULL,
    OrderedQuantity INT NOT NULL,
    ReceivedQuantity INT NOT NULL CONSTRAINT DF_ReceiveOrderLines_ReceivedQuantity DEFAULT (0),
    CONSTRAINT FK_ReceiveOrderLines_Receive FOREIGN KEY (ReceiveId) REFERENCES dbo.ReceiveOrders(ReceiveId),
    CONSTRAINT FK_ReceiveOrderLines_Product FOREIGN KEY (ProductId) REFERENCES dbo.Products(ProductId),
    CONSTRAINT UQ_ReceiveOrderLines_Receive_Product UNIQUE (ReceiveId, ProductId),
    CONSTRAINT CK_ReceiveOrderLines_OrderedQuantity CHECK (OrderedQuantity > 0),
    CONSTRAINT CK_ReceiveOrderLines_ReceivedQuantity CHECK (ReceivedQuantity >= 0 AND ReceivedQuantity <= OrderedQuantity)
  );
END;

GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID('dbo.ReceiveOrders') AND name = 'IX_ReceiveOrders_Status_CreatedAt')
  CREATE INDEX IX_ReceiveOrders_Status_CreatedAt ON dbo.ReceiveOrders(Status, CreatedAt DESC);

