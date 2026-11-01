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
    Status NVARCHAR(20) NOT NULL CONSTRAINT DF_ReceiveOrders_Status DEFAULT ('OPEN'),
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

GO

IF COL_LENGTH('dbo.ReceiveOrders', 'CompletedAt') IS NULL
  ALTER TABLE dbo.ReceiveOrders ADD CompletedAt DATETIME2 NULL;

IF COL_LENGTH('dbo.ReceiveOrderLines', 'ReceivedQuantity') IS NULL
  ALTER TABLE dbo.ReceiveOrderLines ADD ReceivedQuantity INT NOT NULL CONSTRAINT DF_ReceiveOrderLines_ReceivedQuantity DEFAULT (0);

IF EXISTS (SELECT 1 FROM sys.check_constraints WHERE parent_object_id = OBJECT_ID('dbo.ReceiveOrders') AND name = 'CK_ReceiveOrders_Status' AND definition NOT LIKE '%COMPLETED_SHORT%')
BEGIN
  ALTER TABLE dbo.ReceiveOrders DROP CONSTRAINT CK_ReceiveOrders_Status;
  ALTER TABLE dbo.ReceiveOrders ADD CONSTRAINT CK_ReceiveOrders_Status CHECK (Status IN ('OPEN','COMPLETED','COMPLETED_SHORT','CANCELLED'));
END;

IF COL_LENGTH('dbo.ReceiveOrders', 'Status') < 40
  ALTER TABLE dbo.ReceiveOrders ALTER COLUMN Status NVARCHAR(20) NOT NULL;

IF OBJECT_ID('dbo.ShortageReasons', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.ShortageReasons (
    ReasonId INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_ShortageReasons PRIMARY KEY,
    ReasonCode NVARCHAR(30) NOT NULL CONSTRAINT UQ_ShortageReasons_ReasonCode UNIQUE,
    ReasonName NVARCHAR(100) NOT NULL,
    RequiresNote BIT NOT NULL CONSTRAINT DF_ShortageReasons_RequiresNote DEFAULT (0),
    IsActive BIT NOT NULL CONSTRAINT DF_ShortageReasons_IsActive DEFAULT (1),
    SortOrder INT NOT NULL CONSTRAINT DF_ShortageReasons_SortOrder DEFAULT (0),
    CreatedAt DATETIME2 NOT NULL CONSTRAINT DF_ShortageReasons_CreatedAt DEFAULT (SYSDATETIME()),
    UpdatedAt DATETIME2 NULL
  );
END;

IF NOT EXISTS (SELECT 1 FROM dbo.ShortageReasons WHERE ReasonCode = N'SHORT_SHIPMENT')
  INSERT INTO dbo.ShortageReasons (ReasonCode, ReasonName, RequiresNote, SortOrder) VALUES (N'SHORT_SHIPMENT', N'ผู้ขายส่งมาไม่ครบ', 0, 10);
IF NOT EXISTS (SELECT 1 FROM dbo.ShortageReasons WHERE ReasonCode = N'DAMAGED')
  INSERT INTO dbo.ShortageReasons (ReasonCode, ReasonName, RequiresNote, SortOrder) VALUES (N'DAMAGED', N'สินค้าเสียหาย / ชำรุด', 0, 20);
IF NOT EXISTS (SELECT 1 FROM dbo.ShortageReasons WHERE ReasonCode = N'OTHER')
  INSERT INTO dbo.ShortageReasons (ReasonCode, ReasonName, RequiresNote, SortOrder) VALUES (N'OTHER', N'อื่น ๆ', 1, 99);

IF OBJECT_ID('dbo.ReceiveShortages', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.ReceiveShortages (
    ShortageId INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_ReceiveShortages PRIMARY KEY,
    ReceiveId INT NOT NULL,
    ReceiveLineId INT NOT NULL,
    ReasonId INT NOT NULL,
    Quantity INT NOT NULL,
    ReasonCode NVARCHAR(30) NOT NULL,
    ReasonNameSnapshot NVARCHAR(100) NOT NULL,
    Note NVARCHAR(300) NULL,
    Status NVARCHAR(20) NOT NULL CONSTRAINT DF_ReceiveShortages_Status DEFAULT ('PENDING_CN'),
    RecordedBy INT NOT NULL,
    RecordedAt DATETIME2 NOT NULL CONSTRAINT DF_ReceiveShortages_RecordedAt DEFAULT (SYSDATETIME()),
    ResolvedBy INT NULL,
    ResolvedAt DATETIME2 NULL,
    CONSTRAINT FK_ReceiveShortages_Order FOREIGN KEY (ReceiveId) REFERENCES dbo.ReceiveOrders(ReceiveId),
    CONSTRAINT FK_ReceiveShortages_Line FOREIGN KEY (ReceiveLineId) REFERENCES dbo.ReceiveOrderLines(ReceiveLineId),
    CONSTRAINT FK_ReceiveShortages_Reason FOREIGN KEY (ReasonId) REFERENCES dbo.ShortageReasons(ReasonId),
    CONSTRAINT FK_ReceiveShortages_RecordedBy FOREIGN KEY (RecordedBy) REFERENCES dbo.Users(UserId),
    CONSTRAINT FK_ReceiveShortages_ResolvedBy FOREIGN KEY (ResolvedBy) REFERENCES dbo.Users(UserId),
    CONSTRAINT CK_ReceiveShortages_Quantity CHECK (Quantity > 0),
    CONSTRAINT CK_ReceiveShortages_Status CHECK (Status IN ('PENDING_CN','CN_ISSUED','CANCELLED'))
  );
END;

IF COL_LENGTH('dbo.ReceiveShortages', 'ReasonId') IS NULL
  ALTER TABLE dbo.ReceiveShortages ADD ReasonId INT NULL;

IF COL_LENGTH('dbo.ReceiveShortages', 'ReasonNameSnapshot') IS NULL
  ALTER TABLE dbo.ReceiveShortages ADD ReasonNameSnapshot NVARCHAR(100) NULL;

GO

UPDATE s SET ReasonId = r.ReasonId
FROM dbo.ReceiveShortages s JOIN dbo.ShortageReasons r ON r.ReasonCode = s.ReasonCode
WHERE s.ReasonId IS NULL;

UPDATE s SET ReasonNameSnapshot = r.ReasonName
FROM dbo.ReceiveShortages s JOIN dbo.ShortageReasons r ON r.ReasonId = s.ReasonId
WHERE s.ReasonNameSnapshot IS NULL;

IF EXISTS (SELECT 1 FROM sys.check_constraints WHERE parent_object_id = OBJECT_ID('dbo.ReceiveShortages') AND name = 'CK_ReceiveShortages_Reason')
  ALTER TABLE dbo.ReceiveShortages DROP CONSTRAINT CK_ReceiveShortages_Reason;

IF EXISTS (SELECT 1 FROM dbo.ReceiveShortages WHERE ReasonId IS NULL)
  THROW 50001, 'พบเหตุผลขาดส่งเดิมที่ไม่มีใน Master ShortageReasons', 1;

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.ReceiveShortages') AND name = 'ReasonId' AND is_nullable = 1)
BEGIN
  IF EXISTS (SELECT 1 FROM sys.foreign_keys WHERE parent_object_id = OBJECT_ID('dbo.ReceiveShortages') AND name = 'FK_ReceiveShortages_Reason')
    ALTER TABLE dbo.ReceiveShortages DROP CONSTRAINT FK_ReceiveShortages_Reason;
  ALTER TABLE dbo.ReceiveShortages ALTER COLUMN ReasonId INT NOT NULL;
END;

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.ReceiveShortages') AND name = 'ReasonNameSnapshot' AND is_nullable = 1)
  ALTER TABLE dbo.ReceiveShortages ALTER COLUMN ReasonNameSnapshot NVARCHAR(100) NOT NULL;

IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE parent_object_id = OBJECT_ID('dbo.ReceiveShortages') AND name = 'FK_ReceiveShortages_Reason')
  ALTER TABLE dbo.ReceiveShortages WITH CHECK ADD CONSTRAINT FK_ReceiveShortages_Reason FOREIGN KEY (ReasonId) REFERENCES dbo.ShortageReasons(ReasonId);

IF OBJECT_ID('dbo.CreditNotes', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.CreditNotes (
    CreditNoteId INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_CreditNotes PRIMARY KEY,
    CreditNoteNo NVARCHAR(40) NOT NULL CONSTRAINT UQ_CreditNotes_CreditNoteNo UNIQUE,
    ReceiveId INT NOT NULL,
    IssuedAt DATETIME2 NOT NULL CONSTRAINT DF_CreditNotes_IssuedAt DEFAULT (SYSDATETIME()),
    Subtotal DECIMAL(19,2) NOT NULL CONSTRAINT DF_CreditNotes_Subtotal DEFAULT (0),
    TaxAmount DECIMAL(19,2) NOT NULL CONSTRAINT DF_CreditNotes_TaxAmount DEFAULT (0),
    TotalAmount DECIMAL(19,2) NOT NULL CONSTRAINT DF_CreditNotes_TotalAmount DEFAULT (0),
    IssuedBy INT NOT NULL,
    CreatedAt DATETIME2 NOT NULL CONSTRAINT DF_CreditNotes_CreatedAt DEFAULT (SYSDATETIME()),
    CONSTRAINT FK_CreditNotes_Order FOREIGN KEY (ReceiveId) REFERENCES dbo.ReceiveOrders(ReceiveId),
    CONSTRAINT FK_CreditNotes_IssuedBy FOREIGN KEY (IssuedBy) REFERENCES dbo.Users(UserId)
  );
END;

IF OBJECT_ID('dbo.CreditNoteLines', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.CreditNoteLines (
    CreditNoteLineId INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_CreditNoteLines PRIMARY KEY,
    CreditNoteId INT NOT NULL,
    ShortageId INT NOT NULL CONSTRAINT UQ_CreditNoteLines_Shortage UNIQUE,
    ProductId INT NOT NULL,
    Quantity INT NOT NULL,
    UnitPrice DECIMAL(19,4) NOT NULL,
    VatRate DECIMAL(5,2) NOT NULL CONSTRAINT DF_CreditNoteLines_VatRate DEFAULT (0),
    NetAmount DECIMAL(19,2) NOT NULL,
    TaxAmount DECIMAL(19,2) NOT NULL,
    TotalAmount DECIMAL(19,2) NOT NULL,
    CONSTRAINT FK_CreditNoteLines_CreditNote FOREIGN KEY (CreditNoteId) REFERENCES dbo.CreditNotes(CreditNoteId),
    CONSTRAINT FK_CreditNoteLines_Shortage FOREIGN KEY (ShortageId) REFERENCES dbo.ReceiveShortages(ShortageId),
    CONSTRAINT FK_CreditNoteLines_Product FOREIGN KEY (ProductId) REFERENCES dbo.Products(ProductId),
    CONSTRAINT CK_CreditNoteLines_Quantity CHECK (Quantity > 0),
    CONSTRAINT CK_CreditNoteLines_Price CHECK (UnitPrice >= 0 AND VatRate >= 0 AND VatRate <= 100)
  );
END;

GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID('dbo.ReceiveShortages') AND name = 'IX_ReceiveShortages_Status_Receive')
  CREATE INDEX IX_ReceiveShortages_Status_Receive ON dbo.ReceiveShortages(Status, ReceiveId);

