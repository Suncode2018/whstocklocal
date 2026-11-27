USE dbWMS;
GO
IF OBJECT_ID(N'dbo.ProductionIssueRequests',N'U') IS NULL
BEGIN
  CREATE TABLE dbo.ProductionIssueRequests(
    IssueId INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_ProductionIssueRequests PRIMARY KEY,
    RequestId UNIQUEIDENTIFIER NOT NULL CONSTRAINT UQ_ProductionIssueRequests_RequestId UNIQUE,
    IssueNo NVARCHAR(40) NULL,
    FGProductId INT NOT NULL,
    BOMId INT NOT NULL,
    BOMVersion INT NOT NULL,
    BaseQuantity DECIMAL(18,6) NOT NULL CONSTRAINT CK_ProductionIssueRequests_BaseQuantity CHECK(BaseQuantity>0),
    BaseUnit NVARCHAR(30) NOT NULL,
    FGProductCode NVARCHAR(50) NOT NULL,
    FGProductName NVARCHAR(200) NOT NULL,
    WarehouseIdsJson NVARCHAR(MAX) NOT NULL,
    Status VARCHAR(12) NOT NULL CONSTRAINT DF_ProductionIssueRequests_Status DEFAULT 'DRAFT' CONSTRAINT CK_ProductionIssueRequests_Status CHECK(Status IN('DRAFT','CANCELLED')),
    CreatedBy NVARCHAR(100) NOT NULL,
    CreatedAt DATETIME2 NOT NULL CONSTRAINT DF_ProductionIssueRequests_CreatedAt DEFAULT SYSDATETIME()
  );
END;
GO
IF NOT EXISTS(SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID(N'dbo.ProductionIssueRequests') AND name=N'UQ_ProductionIssueRequests_IssueNo')
  CREATE UNIQUE INDEX UQ_ProductionIssueRequests_IssueNo ON dbo.ProductionIssueRequests(IssueNo) WHERE IssueNo IS NOT NULL;
IF NOT EXISTS(SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID(N'dbo.ProductionIssueRequests') AND name=N'IX_ProductionIssueRequests_CreatedAt')
  CREATE INDEX IX_ProductionIssueRequests_CreatedAt ON dbo.ProductionIssueRequests(CreatedAt DESC,IssueId DESC);
GO
IF OBJECT_ID(N'dbo.ProductionIssueLines',N'U') IS NULL
BEGIN
  CREATE TABLE dbo.ProductionIssueLines(
    IssueLineId INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_ProductionIssueLines PRIMARY KEY,
    IssueId INT NOT NULL CONSTRAINT FK_ProductionIssueLines_Request REFERENCES dbo.ProductionIssueRequests(IssueId),
    [LineNo] INT NOT NULL,
    ProductId INT NOT NULL,
    ProductCode NVARCHAR(50) NOT NULL,
    ProductName NVARCHAR(200) NOT NULL,
    CategoryCode VARCHAR(10) NOT NULL,
    RequiredQuantity DECIMAL(18,6) NOT NULL CONSTRAINT CK_ProductionIssueLines_Quantity CHECK(RequiredQuantity>0),
    UnitCode NVARCHAR(30) NOT NULL,
    CONSTRAINT UQ_ProductionIssueLines_Line UNIQUE(IssueId,[LineNo])
  );
END;
GO
