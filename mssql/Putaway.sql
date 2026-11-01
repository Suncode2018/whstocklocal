/* PUTAWAY task schema. Also created automatically by /api/putaway. */
IF OBJECT_ID('dbo.PutawayTasks', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.PutawayTasks (
    TaskId INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_PutawayTasks PRIMARY KEY,
    TaskNo NVARCHAR(40) NOT NULL CONSTRAINT UQ_PutawayTasks_TaskNo UNIQUE,
    SourceReceiveId INT NULL,
    Status NVARCHAR(20) NOT NULL CONSTRAINT DF_PutawayTasks_Status DEFAULT ('OPEN'),
    Note NVARCHAR(300) NULL,
    CreatedBy INT NOT NULL,
    CreatedAt DATETIME2 NOT NULL CONSTRAINT DF_PutawayTasks_CreatedAt DEFAULT (SYSDATETIME()),
    StartedAt DATETIME2 NULL,
    CompletedAt DATETIME2 NULL,
    CancelledAt DATETIME2 NULL,
    CONSTRAINT FK_PutawayTasks_CreatedBy FOREIGN KEY (CreatedBy) REFERENCES dbo.Users(UserId),
    CONSTRAINT CK_PutawayTasks_Status CHECK (Status IN ('OPEN','IN_PROGRESS','COMPLETED','CANCELLED'))
  );
END;
GO

IF COL_LENGTH('dbo.PutawayTasks', 'SourceReceiveId') IS NULL
  ALTER TABLE dbo.PutawayTasks ADD SourceReceiveId INT NULL;
GO

IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE parent_object_id = OBJECT_ID('dbo.PutawayTasks') AND name = 'FK_PutawayTasks_Receive')
  ALTER TABLE dbo.PutawayTasks WITH CHECK ADD CONSTRAINT FK_PutawayTasks_Receive FOREIGN KEY (SourceReceiveId) REFERENCES dbo.ReceiveOrders(ReceiveId);
GO

IF OBJECT_ID('dbo.PutawayTaskLines', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.PutawayTaskLines (
    TaskLineId INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_PutawayTaskLines PRIMARY KEY,
    TaskId INT NOT NULL,
    ProductId INT NOT NULL,
    FromLocationId INT NOT NULL,
    ToLocationId INT NOT NULL,
    PlannedQuantity INT NOT NULL,
    MovedQuantity INT NOT NULL CONSTRAINT DF_PutawayTaskLines_MovedQuantity DEFAULT (0),
    UnitVolumeCm3 DECIMAL(18,3) NULL,
    CONSTRAINT FK_PutawayTaskLines_Task FOREIGN KEY (TaskId) REFERENCES dbo.PutawayTasks(TaskId),
    CONSTRAINT FK_PutawayTaskLines_Product FOREIGN KEY (ProductId) REFERENCES dbo.Products(ProductId),
    CONSTRAINT FK_PutawayTaskLines_FromLocation FOREIGN KEY (FromLocationId) REFERENCES dbo.Locations(LocationId),
    CONSTRAINT FK_PutawayTaskLines_ToLocation FOREIGN KEY (ToLocationId) REFERENCES dbo.Locations(LocationId),
    CONSTRAINT UQ_PutawayTaskLines UNIQUE (TaskId, ProductId, FromLocationId, ToLocationId),
    CONSTRAINT CK_PutawayTaskLines_Quantity CHECK (PlannedQuantity > 0 AND MovedQuantity >= 0 AND MovedQuantity <= PlannedQuantity),
    CONSTRAINT CK_PutawayTaskLines_Locations CHECK (FromLocationId <> ToLocationId)
  );
END;
GO

IF COL_LENGTH('dbo.PutawayTaskLines', 'UnitVolumeCm3') IS NULL
  ALTER TABLE dbo.PutawayTaskLines ADD UnitVolumeCm3 DECIMAL(18,3) NULL;
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID('dbo.PutawayTasks') AND name = 'IX_PutawayTasks_Status_CreatedAt')
  CREATE INDEX IX_PutawayTasks_Status_CreatedAt ON dbo.PutawayTasks(Status, CreatedAt DESC);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID('dbo.PutawayTaskLines') AND name = 'IX_PutawayTaskLines_Product_Source')
  CREATE INDEX IX_PutawayTaskLines_Product_Source ON dbo.PutawayTaskLines(ProductId, FromLocationId, TaskId);
GO
