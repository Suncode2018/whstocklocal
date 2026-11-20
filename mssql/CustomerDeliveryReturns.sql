USE dbWMS;
GO

IF OBJECT_ID('dbo.CustomerDeliveryReturns','U') IS NULL
BEGIN
 CREATE TABLE dbo.CustomerDeliveryReturns (
  ReturnId INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_CustomerDeliveryReturns PRIMARY KEY,
  RequestId UNIQUEIDENTIFIER NOT NULL CONSTRAINT UQ_CustomerDeliveryReturns_RequestId UNIQUE,
  ReturnNo NVARCHAR(60) NOT NULL CONSTRAINT UQ_CustomerDeliveryReturns_ReturnNo UNIQUE,
  DeliveryId INT NOT NULL,
  WhId INT NOT NULL,
  PoNo NVARCHAR(60) NULL,
  InvoiceNo NVARCHAR(60) NULL,
  CreditNoteNo NVARCHAR(60) NULL,
  Note NVARCHAR(500) NOT NULL,
  CreatedBy NVARCHAR(50) NOT NULL,
  CreatedAt DATETIME2 NOT NULL CONSTRAINT DF_CustomerDeliveryReturns_CreatedAt DEFAULT SYSDATETIME(),
  CONSTRAINT FK_CustomerDeliveryReturns_Delivery FOREIGN KEY (DeliveryId) REFERENCES dbo.DeliveryOrders(DeliveryId)
 );
 CREATE INDEX IX_CustomerDeliveryReturns_DeliveryId ON dbo.CustomerDeliveryReturns(DeliveryId,ReturnId);
END;
GO

IF OBJECT_ID('dbo.CustomerDeliveryReturnLines','U') IS NULL
BEGIN
 CREATE TABLE dbo.CustomerDeliveryReturnLines (
  ReturnLineId INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_CustomerDeliveryReturnLines PRIMARY KEY,
  ReturnId INT NOT NULL,
  DeliveryLineId INT NOT NULL,
  ProductId INT NOT NULL,
  ProductCode NVARCHAR(100) NOT NULL,
  ProductName NVARCHAR(500) NOT NULL,
  UOM NVARCHAR(100) NULL,
  Quantity DECIMAL(18,2) NOT NULL CONSTRAINT CK_CustomerDeliveryReturnLines_Quantity CHECK (Quantity > 0),
  CaseType VARCHAR(20) NOT NULL CONSTRAINT DF_CustomerDeliveryReturnLines_CaseType DEFAULT 'STOCK_RETURN' CONSTRAINT CK_CustomerDeliveryReturnLines_CaseType CHECK (CaseType IN('STOCK_RETURN','SHORTAGE','DAMAGED','OTHER')),
  PhysicalReturned BIT NOT NULL CONSTRAINT DF_CustomerDeliveryReturnLines_PhysicalReturned DEFAULT 1,
  ReceiptLocationCode NVARCHAR(50) NULL,
  PutawayLocationCode NVARCHAR(50) NULL,
  PutawayAt DATETIME2 NULL,
  PutawayBy NVARCHAR(50) NULL,
  CONSTRAINT FK_CustomerDeliveryReturnLines_Return FOREIGN KEY (ReturnId) REFERENCES dbo.CustomerDeliveryReturns(ReturnId),
  CONSTRAINT FK_CustomerDeliveryReturnLines_DeliveryLine FOREIGN KEY (DeliveryLineId) REFERENCES dbo.DeliveryLines(LineId)
 );
 CREATE INDEX IX_CustomerDeliveryReturnLines_DeliveryLineId ON dbo.CustomerDeliveryReturnLines(DeliveryLineId,ReturnId);
END;
GO

IF COL_LENGTH('dbo.CustomerDeliveryReturns','CreditNoteNo') IS NULL ALTER TABLE dbo.CustomerDeliveryReturns ADD CreditNoteNo NVARCHAR(60) NULL;
IF COL_LENGTH('dbo.CustomerDeliveryReturnLines','CaseType') IS NULL ALTER TABLE dbo.CustomerDeliveryReturnLines ADD CaseType VARCHAR(20) NOT NULL CONSTRAINT DF_CustomerDeliveryReturnLines_CaseType DEFAULT 'STOCK_RETURN';
IF COL_LENGTH('dbo.CustomerDeliveryReturnLines','PhysicalReturned') IS NULL ALTER TABLE dbo.CustomerDeliveryReturnLines ADD PhysicalReturned BIT NOT NULL CONSTRAINT DF_CustomerDeliveryReturnLines_PhysicalReturned DEFAULT 1;
IF COL_LENGTH('dbo.CustomerDeliveryReturnLines','ReceiptLocationCode') IS NOT NULL ALTER TABLE dbo.CustomerDeliveryReturnLines ALTER COLUMN ReceiptLocationCode NVARCHAR(50) NULL;
IF COL_LENGTH('dbo.CustomerDeliveryReturns','ReturnStatus') IS NULL ALTER TABLE dbo.CustomerDeliveryReturns ADD ReturnStatus VARCHAR(24) NOT NULL CONSTRAINT DF_CustomerDeliveryReturns_ReturnStatus DEFAULT 'OPEN';
IF COL_LENGTH('dbo.CustomerDeliveryReturns','ReturnCarrier') IS NULL ALTER TABLE dbo.CustomerDeliveryReturns ADD ReturnCarrier NVARCHAR(100) NULL;
IF COL_LENGTH('dbo.CustomerDeliveryReturns','ReturnTrackingNo') IS NULL ALTER TABLE dbo.CustomerDeliveryReturns ADD ReturnTrackingNo NVARCHAR(100) NULL;
IF COL_LENGTH('dbo.CustomerDeliveryReturns','ReturnSentBy') IS NULL ALTER TABLE dbo.CustomerDeliveryReturns ADD ReturnSentBy NVARCHAR(50) NULL;
IF COL_LENGTH('dbo.CustomerDeliveryReturns','ReturnSentAt') IS NULL ALTER TABLE dbo.CustomerDeliveryReturns ADD ReturnSentAt DATETIME2 NULL;
IF COL_LENGTH('dbo.CustomerDeliveryReturnLines','ExpectedReturn') IS NULL
BEGIN
 ALTER TABLE dbo.CustomerDeliveryReturnLines ADD ExpectedReturn BIT NOT NULL CONSTRAINT DF_CustomerDeliveryReturnLines_ExpectedReturn DEFAULT 1;
 EXEC sys.sp_executesql N'UPDATE dbo.CustomerDeliveryReturnLines SET ExpectedReturn=PhysicalReturned;';
END;
IF COL_LENGTH('dbo.CustomerDeliveryReturnLines','SentQuantity') IS NULL ALTER TABLE dbo.CustomerDeliveryReturnLines ADD SentQuantity DECIMAL(18,2) NOT NULL CONSTRAINT DF_CustomerDeliveryReturnLines_SentQuantity DEFAULT 0;
-- Preserve legacy lines that were already received and added to RCV before this split.
EXEC sys.sp_executesql N'UPDATE dbo.CustomerDeliveryReturnLines SET ExpectedReturn=0 WHERE CaseType=''SHORTAGE'';';
EXEC sys.sp_executesql N'UPDATE dbo.CustomerDeliveryReturns SET ReturnStatus=''RECEIVED'' WHERE ReturnStatus=''OPEN'' AND EXISTS(SELECT 1 FROM dbo.CustomerDeliveryReturnLines l WHERE l.ReturnId=CustomerDeliveryReturns.ReturnId AND l.PhysicalReturned=1);';
IF OBJECT_ID('dbo.CustomerDeliveryDocumentReturns','U') IS NULL
BEGIN
 CREATE TABLE dbo.CustomerDeliveryDocumentReturns(
  DocumentReturnId INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_CustomerDeliveryDocumentReturns PRIMARY KEY,
  DeliveryId INT NOT NULL CONSTRAINT UQ_CustomerDeliveryDocumentReturns_Delivery UNIQUE,
  PoNo NVARCHAR(60) NULL,
  InvoiceNo NVARCHAR(60) NULL,
  HasPo BIT NOT NULL CONSTRAINT DF_CustomerDeliveryDocumentReturns_HasPo DEFAULT 0,
  HasInvoice BIT NOT NULL CONSTRAINT DF_CustomerDeliveryDocumentReturns_HasInvoice DEFAULT 0,
  HasSignedDelivery BIT NOT NULL CONSTRAINT DF_CustomerDeliveryDocumentReturns_HasSignedDelivery DEFAULT 0,
  Note NVARCHAR(500) NULL,
  ReceivedBy NVARCHAR(50) NOT NULL,
  ReceivedAt DATETIME2 NOT NULL CONSTRAINT DF_CustomerDeliveryDocumentReturns_ReceivedAt DEFAULT SYSDATETIME(),
  UpdatedAt DATETIME2 NOT NULL CONSTRAINT DF_CustomerDeliveryDocumentReturns_UpdatedAt DEFAULT SYSDATETIME(),
  CONSTRAINT FK_CustomerDeliveryDocumentReturns_Delivery FOREIGN KEY(DeliveryId) REFERENCES dbo.DeliveryOrders(DeliveryId)
 );
END;
GO
