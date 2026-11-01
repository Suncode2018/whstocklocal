/* Cycle Count schema for WarehouseStockDB
   Safe to run repeatedly. Existing Locations, Products, Stock, StockTransactions,
   and Users tables are used as the source of truth. */
USE [WarehouseStockDB];
GO

IF OBJECT_ID('dbo.CycleCountSessions', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.CycleCountSessions (
    SessionId INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
    SessionCode NVARCHAR(40) NOT NULL UNIQUE,
    SessionName NVARCHAR(100) NOT NULL,
    ScopeType NVARCHAR(10) NOT NULL,
    ScopeValue NVARCHAR(50) NULL,
    Status NVARCHAR(12) NOT NULL CONSTRAINT DF_CycleCountSessions_Status DEFAULT ('OPEN'),
    CreatedBy INT NOT NULL,
    CreatedAt DATETIME2 NOT NULL CONSTRAINT DF_CycleCountSessions_CreatedAt DEFAULT (SYSUTCDATETIME()),
    ExpiresAt DATETIME2 NOT NULL,
    ClosedBy INT NULL,
    ClosedAt DATETIME2 NULL,
    CONSTRAINT FK_CycleCountSessions_CreatedBy FOREIGN KEY (CreatedBy) REFERENCES dbo.Users(UserId),
    CONSTRAINT FK_CycleCountSessions_ClosedBy FOREIGN KEY (ClosedBy) REFERENCES dbo.Users(UserId),
    CONSTRAINT CK_CycleCountSessions_ScopeType CHECK (ScopeType IN ('ZONE','LOCATION')),
    CONSTRAINT CK_CycleCountSessions_Status CHECK (Status IN ('OPEN','CLOSED'))
  );
END;
GO

IF COL_LENGTH('dbo.CycleCountSessions', 'ExpiresAt') IS NULL
BEGIN
  ALTER TABLE dbo.CycleCountSessions ADD ExpiresAt DATETIME2 NULL;
END;
GO

UPDATE dbo.CycleCountSessions SET ExpiresAt = DATEADD(hour, 24, CreatedAt) WHERE ExpiresAt IS NULL;
GO

ALTER TABLE dbo.CycleCountSessions ALTER COLUMN ExpiresAt DATETIME2 NOT NULL;
GO

IF OBJECT_ID('dbo.CYCLECOUNT', 'U') IS NULL AND OBJECT_ID('dbo.CycleCountItems', 'U') IS NOT NULL
  EXEC sp_rename 'dbo.CycleCountItems', 'CYCLECOUNT';
GO

IF OBJECT_ID('dbo.CYCLECOUNT', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.CYCLECOUNT (
    CycleCountItemId INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
    SessionId INT NOT NULL,
    ProductId INT NOT NULL,
    LocationId INT NOT NULL,
    ExpectedQuantity INT NOT NULL,
    CountedQuantity INT NULL,
    CountedBy INT NULL,
    CountedAt DATETIME2 NULL,
    CONSTRAINT FK_CYCLECOUNT_Session FOREIGN KEY (SessionId) REFERENCES dbo.CycleCountSessions(SessionId),
    CONSTRAINT FK_CYCLECOUNT_Product FOREIGN KEY (ProductId) REFERENCES dbo.Products(ProductId),
    CONSTRAINT FK_CYCLECOUNT_Location FOREIGN KEY (LocationId) REFERENCES dbo.Locations(LocationId),
    CONSTRAINT FK_CYCLECOUNT_CountedBy FOREIGN KEY (CountedBy) REFERENCES dbo.Users(UserId),
    CONSTRAINT UQ_CYCLECOUNT UNIQUE (SessionId, ProductId, LocationId)
  );
  CREATE INDEX IX_CYCLECOUNT_Session ON dbo.CYCLECOUNT(SessionId, LocationId);
END;
GO
