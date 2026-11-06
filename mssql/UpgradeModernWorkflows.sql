-- Upgrade existing dbMaster + dbWMS. Run in SSMS or sqlcmd; no stock resets.
-- SOURCE: ProductVolume.sql
USE dbMaster;
GO
/* Dimensions are measured in cm per product UOM; UnitVolumeCm3 is calculated as W*L*H. */
IF COL_LENGTH('dbo.tblProducts', 'UnitVolumeCm3') IS NULL
  ALTER TABLE dbo.tblProducts ADD UnitVolumeCm3 DECIMAL(18,3) NULL;
GO

IF COL_LENGTH('dbo.tblProducts', 'UnitWidthCm') IS NULL
  ALTER TABLE dbo.tblProducts ADD UnitWidthCm DECIMAL(18,3) NULL;
GO

IF COL_LENGTH('dbo.tblProducts', 'UnitLengthCm') IS NULL
  ALTER TABLE dbo.tblProducts ADD UnitLengthCm DECIMAL(18,3) NULL;
GO

IF COL_LENGTH('dbo.tblProducts', 'UnitHeightCm') IS NULL
  ALTER TABLE dbo.tblProducts ADD UnitHeightCm DECIMAL(18,3) NULL;
GO

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE parent_object_id = OBJECT_ID('dbo.tblProducts') AND name = 'CK_tblProducts_UnitDimensions')
  ALTER TABLE dbo.tblProducts ADD CONSTRAINT CK_tblProducts_UnitDimensions CHECK (
    (UnitWidthCm IS NULL AND UnitLengthCm IS NULL AND UnitHeightCm IS NULL)
    OR (UnitWidthCm IS NOT NULL AND UnitLengthCm IS NOT NULL AND UnitHeightCm IS NOT NULL
      AND UnitWidthCm > 0 AND UnitLengthCm > 0 AND UnitHeightCm > 0)
  );
GO

GO
-- SOURCE: LocationCapacity.sql
USE dbMaster;
GO
/* Storage location volume capacity. Capacity applies to A- and B- storage bins.
   RCV (receiving) and OUT (shipping staging) locations have NULL capacity. */
IF COL_LENGTH('dbo.Locations', 'CapacityVolumeCm3') IS NULL
  ALTER TABLE dbo.Locations ADD CapacityVolumeCm3 DECIMAL(18,3) NULL;
GO

IF COL_LENGTH('dbo.Locations', 'CapacityWidthCm') IS NULL
  ALTER TABLE dbo.Locations ADD CapacityWidthCm DECIMAL(18,3) NULL;
GO

IF COL_LENGTH('dbo.Locations', 'CapacityLengthCm') IS NULL
  ALTER TABLE dbo.Locations ADD CapacityLengthCm DECIMAL(18,3) NULL;
GO

IF COL_LENGTH('dbo.Locations', 'CapacityHeightCm') IS NULL
  ALTER TABLE dbo.Locations ADD CapacityHeightCm DECIMAL(18,3) NULL;
GO

IF NOT EXISTS (
  SELECT 1 FROM sys.check_constraints
  WHERE parent_object_id = OBJECT_ID('dbo.Locations')
    AND name = 'CK_Locations_CapacityDimensions'
)
  ALTER TABLE dbo.Locations ADD CONSTRAINT CK_Locations_CapacityDimensions CHECK (
    (CapacityWidthCm IS NULL AND CapacityLengthCm IS NULL AND CapacityHeightCm IS NULL)
    OR (CapacityWidthCm IS NOT NULL AND CapacityLengthCm IS NOT NULL AND CapacityHeightCm IS NOT NULL
      AND CapacityWidthCm > 0 AND CapacityLengthCm > 0 AND CapacityHeightCm > 0)
  );
GO

GO
-- SOURCE: InboundFourTypes.sql
USE [dbMaster];
SET XACT_ABORT ON;
BEGIN TRANSACTION;
IF NOT EXISTS (SELECT 1 FROM dbo.tblCategories WITH (UPDLOCK,HOLDLOCK) WHERE UPPER(CategoryCode) IN ('SEMI','SFG'))
 INSERT INTO dbo.tblCategories (CategoryCode,CategoryName) VALUES (N'SEMI',N'Semi Finished Product');
COMMIT;
USE [dbWMS];
IF OBJECT_ID('dbo.InboundOrders','U') IS NULL
CREATE TABLE dbo.InboundOrders (
 InboundId INT IDENTITY PRIMARY KEY,
 RequestId UNIQUEIDENTIFIER NOT NULL UNIQUE,
 ReceiveNo NVARCHAR(40) NOT NULL UNIQUE,
 ReceiveType VARCHAR(4) NOT NULL CHECK (ReceiveType IN ('RM','PKG','SEMI','FG')),
 WhId INT NOT NULL,
 ReferenceNo NVARCHAR(60) NOT NULL,
 SupplierName NVARCHAR(150) NULL,
 Status VARCHAR(12) NOT NULL DEFAULT 'OPEN' CHECK(Status IN ('OPEN','PARTIAL','COMPLETED')),
 CreatedBy NVARCHAR(50) NOT NULL,
 CreatedAt DATETIME2 NOT NULL DEFAULT SYSDATETIME()
);
IF OBJECT_ID('dbo.InboundLines','U') IS NULL
CREATE TABLE dbo.InboundLines (
 LineId INT IDENTITY PRIMARY KEY,
 InboundId INT NOT NULL REFERENCES dbo.InboundOrders(InboundId),
 ProductId INT NOT NULL,
 OrderedQuantity DECIMAL(18,2) NOT NULL CHECK(OrderedQuantity>0),
 ReceivedQuantity DECIMAL(18,2) NOT NULL DEFAULT 0,
 CONSTRAINT CK_InboundLines_Received CHECK(ReceivedQuantity>=0 AND ReceivedQuantity<=OrderedQuantity),
 CONSTRAINT UQ_InboundLines_Product UNIQUE(InboundId,ProductId)
);
IF OBJECT_ID('dbo.InboundReceipts','U') IS NULL
CREATE TABLE dbo.InboundReceipts (
 ReceiptId INT IDENTITY PRIMARY KEY,
 RequestId UNIQUEIDENTIFIER NOT NULL UNIQUE,
 LineId INT NOT NULL REFERENCES dbo.InboundLines(LineId),
 LocationCode NVARCHAR(50) NOT NULL,
 Quantity DECIMAL(18,2) NOT NULL CHECK(Quantity>0),
 LotNo NVARCHAR(60) NULL,
 MfgDate DATE NULL,
 ExpDate DATE NULL,
 ReceivedBy NVARCHAR(50) NOT NULL,
 ReceivedAt DATETIME2 NOT NULL DEFAULT SYSDATETIME(),
 CONSTRAINT CK_InboundReceipts_Dates CHECK(MfgDate IS NULL OR ExpDate IS NULL OR ExpDate>=MfgDate)
);

GO
-- SOURCE: PackagingReceiptDocument.sql
USE dbWMS;
IF COL_LENGTH('dbo.InboundOrders','SupplierDocumentNo') IS NULL ALTER TABLE dbo.InboundOrders ADD SupplierDocumentNo NVARCHAR(60) NULL;
IF COL_LENGTH('dbo.InboundOrders','DocumentDate') IS NULL ALTER TABLE dbo.InboundOrders ADD DocumentDate DATE NULL;
IF COL_LENGTH('dbo.InboundOrders','VatRate') IS NULL ALTER TABLE dbo.InboundOrders ADD VatRate DECIMAL(5,2) NULL;
IF COL_LENGTH('dbo.InboundLines','SupplierProductCode') IS NULL ALTER TABLE dbo.InboundLines ADD SupplierProductCode NVARCHAR(60) NULL;
IF COL_LENGTH('dbo.InboundLines','UnitPrice') IS NULL ALTER TABLE dbo.InboundLines ADD UnitPrice DECIMAL(18,4) NULL;

GO
-- SOURCE: SupplierMaster.sql
USE dbMaster;
IF OBJECT_ID('dbo.tblSuppliers','U') IS NULL
CREATE TABLE dbo.tblSuppliers (
 SupplierId INT IDENTITY PRIMARY KEY, SupplierCode NVARCHAR(30) NOT NULL UNIQUE,
 SupplierName NVARCHAR(150) NOT NULL, TaxId VARCHAR(13) NULL, BranchCode VARCHAR(5) NOT NULL DEFAULT '00000',
 Address NVARCHAR(500) NULL, ContactName NVARCHAR(100) NULL, Phone NVARCHAR(50) NULL, Email NVARCHAR(150) NULL,
 SupplyTypes VARCHAR(30) NOT NULL, IsActive BIT NOT NULL DEFAULT 1,
 CreatedAt DATETIME2 NOT NULL DEFAULT SYSDATETIME(), UpdatedAt DATETIME2 NOT NULL DEFAULT SYSDATETIME()
);
IF NOT EXISTS(SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID('dbo.tblSuppliers') AND name='UQ_tblSuppliers_TaxBranch')
 CREATE UNIQUE INDEX UQ_tblSuppliers_TaxBranch ON dbo.tblSuppliers(TaxId,BranchCode) WHERE TaxId IS NOT NULL;
IF OBJECT_ID('dbo.tblSupplierProducts','U') IS NULL
CREATE TABLE dbo.tblSupplierProducts (
 MappingId INT IDENTITY PRIMARY KEY, SupplierId INT NOT NULL REFERENCES dbo.tblSuppliers(SupplierId),
 SupplierProductCode NVARCHAR(60) NOT NULL, ProductId INT NOT NULL REFERENCES dbo.tblProducts(ProductId),
 IsActive BIT NOT NULL DEFAULT 1, UpdatedAt DATETIME2 NOT NULL DEFAULT SYSDATETIME(),
 CONSTRAINT UQ_tblSupplierProducts_Code UNIQUE(SupplierId,SupplierProductCode)
);
USE dbWMS;
IF COL_LENGTH('dbo.InboundOrders','SupplierId') IS NULL ALTER TABLE dbo.InboundOrders ADD SupplierId INT NULL;

GO
-- SOURCE: StoragePlanning.sql
USE dbWMS;
IF OBJECT_ID('dbo.StoragePlans','U') IS NULL
CREATE TABLE dbo.StoragePlans (
 PlanId INT IDENTITY PRIMARY KEY, RequestId UNIQUEIDENTIFIER NOT NULL UNIQUE,
 PlanNo NVARCHAR(40) NOT NULL UNIQUE, WhId INT NOT NULL, ProductId INT NOT NULL,
 FromLocationCode NVARCHAR(50) NOT NULL, UnitVolumeCm3 DECIMAL(18,3) NOT NULL CHECK(UnitVolumeCm3>0),
 Status VARCHAR(12) NOT NULL DEFAULT 'OPEN' CHECK(Status IN ('OPEN','COMPLETED','CANCELLED')),
 Note NVARCHAR(255) NULL, CreatedBy NVARCHAR(50) NOT NULL, CreatedAt DATETIME2 NOT NULL DEFAULT SYSDATETIME()
);
IF OBJECT_ID('dbo.StoragePlanLines','U') IS NULL
CREATE TABLE dbo.StoragePlanLines (
 LineId INT IDENTITY PRIMARY KEY, PlanId INT NOT NULL REFERENCES dbo.StoragePlans(PlanId),
 ToLocationCode NVARCHAR(50) NOT NULL, Quantity DECIMAL(18,2) NOT NULL CHECK(Quantity>0),
 MovedQuantity DECIMAL(18,2) NOT NULL DEFAULT 0 CHECK(MovedQuantity>=0),
 CONSTRAINT CK_StoragePlanLines_Qty CHECK(MovedQuantity<=Quantity),
 CONSTRAINT UQ_StoragePlanLines_Target UNIQUE(PlanId,ToLocationCode)
);

GO
-- SOURCE: PickingThreeTypes.sql
USE dbWMS;
IF OBJECT_ID('dbo.PickOperations','U') IS NULL
CREATE TABLE dbo.PickOperations (
 PickId INT IDENTITY PRIMARY KEY, RequestId UNIQUEIDENTIFIER NOT NULL UNIQUE,
 PickNo NVARCHAR(40) NOT NULL UNIQUE, PickType VARCHAR(3) NOT NULL CHECK(PickType IN ('RM','PKG','FG')),
 WhId INT NOT NULL, ProductId INT NOT NULL, FromLocationCode NVARCHAR(50) NOT NULL,
 ToLocationCode NVARCHAR(50) NULL, Quantity DECIMAL(18,2) NOT NULL CHECK(Quantity>0),
 ReferenceNo NVARCHAR(60) NOT NULL, Note NVARCHAR(255) NULL,
 CreatedBy NVARCHAR(50) NOT NULL, CreatedAt DATETIME2 NOT NULL DEFAULT SYSDATETIME(),
 CONSTRAINT CK_PickOperations_Destination CHECK((PickType='FG' AND ToLocationCode IS NOT NULL) OR (PickType IN ('RM','PKG') AND ToLocationCode IS NULL))
);

GO
-- SOURCE: DeliveryOrders.sql
USE dbWMS;
IF OBJECT_ID('dbo.DeliveryOrders','U') IS NULL
CREATE TABLE dbo.DeliveryOrders (
 DeliveryId INT IDENTITY PRIMARY KEY, RequestId UNIQUEIDENTIFIER NOT NULL UNIQUE, DeliveryNo NVARCHAR(40) NOT NULL UNIQUE,
 DeliveryType VARCHAR(12) NOT NULL CHECK(DeliveryType IN('CUSTOMER','CLINIC','FULFILLMENT')),
 Ownership VARCHAR(8) NOT NULL CHECK(Ownership IN('CUSTOMER','COMPANY')), WhId INT NOT NULL,
 DestinationName NVARCHAR(150) NOT NULL, BranchName NVARCHAR(100) NULL, TaxId VARCHAR(13) NULL,
 BillingAddress NVARCHAR(500) NULL, ShippingAddress NVARCHAR(500) NOT NULL, ContactName NVARCHAR(100) NOT NULL, Phone NVARCHAR(50) NOT NULL,
 DeliveryDate DATE NOT NULL, PoNo NVARCHAR(60) NULL, SoNo NVARCHAR(60) NULL, Note NVARCHAR(500) NULL,
 Status VARCHAR(10) NOT NULL DEFAULT 'DRAFT' CHECK(Status IN('DRAFT','SENT','RECEIVED','CANCELLED')),
 Carrier NVARCHAR(100) NULL, TrackingNo NVARCHAR(100) NULL, VehicleNo NVARCHAR(30) NULL, Cartons INT NULL,
 CreatedBy NVARCHAR(50) NOT NULL, CreatedAt DATETIME2 NOT NULL DEFAULT SYSDATETIME(), SentBy NVARCHAR(50) NULL, SentAt DATETIME2 NULL,
 ReceivedBy NVARCHAR(100) NULL, ReceivedAt DATETIME2 NULL,
 CONSTRAINT CK_DeliveryOrders_Ownership CHECK((DeliveryType='CUSTOMER' AND Ownership='CUSTOMER') OR (DeliveryType='FULFILLMENT' AND Ownership='COMPANY') OR DeliveryType='CLINIC')
);
IF OBJECT_ID('dbo.DeliveryLines','U') IS NULL
CREATE TABLE dbo.DeliveryLines (
 LineId INT IDENTITY PRIMARY KEY, DeliveryId INT NOT NULL REFERENCES dbo.DeliveryOrders(DeliveryId), ProductId INT NOT NULL,
 LocationCode NVARCHAR(50) NOT NULL, Quantity DECIMAL(18,2) NOT NULL CHECK(Quantity>0),
 ProductCode NVARCHAR(100) NOT NULL, ProductName NVARCHAR(500) NOT NULL, UOM NVARCHAR(100) NULL,
 CONSTRAINT UQ_DeliveryLines UNIQUE(DeliveryId,ProductId,LocationCode)
);
IF OBJECT_ID('dbo.DeliveryCustody','U') IS NULL
CREATE TABLE dbo.DeliveryCustody (
 LineId INT PRIMARY KEY REFERENCES dbo.DeliveryLines(LineId), Quantity DECIMAL(18,2) NOT NULL,
 Status VARCHAR(14) NOT NULL CHECK(Status IN('IN_TRANSIT','AT_DESTINATION')),
 SentAt DATETIME2 NOT NULL DEFAULT SYSDATETIME(), ReceivedAt DATETIME2 NULL
);

GO
-- SOURCE: ModernWorkflows.sql
USE dbWMS;
IF OBJECT_ID('dbo.StorageMoves','U') IS NULL
CREATE TABLE dbo.StorageMoves(MoveId INT IDENTITY PRIMARY KEY,RequestId UNIQUEIDENTIFIER NOT NULL UNIQUE,LineId INT NOT NULL REFERENCES dbo.StoragePlanLines(LineId),Quantity DECIMAL(18,2) NOT NULL CHECK(Quantity>0),MovedBy NVARCHAR(50) NOT NULL,MovedAt DATETIME2 NOT NULL DEFAULT SYSDATETIME());
IF OBJECT_ID('dbo.InventoryCountSessions','U') IS NULL
CREATE TABLE dbo.InventoryCountSessions(SessionId INT IDENTITY PRIMARY KEY,RequestId UNIQUEIDENTIFIER NOT NULL UNIQUE,SessionNo NVARCHAR(40) NOT NULL UNIQUE,WhId INT NOT NULL,LocationCode NVARCHAR(50) NOT NULL,Status VARCHAR(10) NOT NULL DEFAULT 'OPEN' CHECK(Status IN('OPEN','CLOSED','CANCELLED')),CreatedBy NVARCHAR(50) NOT NULL,CreatedAt DATETIME2 NOT NULL DEFAULT SYSDATETIME(),ClosedAt DATETIME2 NULL);
IF OBJECT_ID('dbo.InventoryCountItems','U') IS NULL
CREATE TABLE dbo.InventoryCountItems(ItemId INT IDENTITY PRIMARY KEY,SessionId INT NOT NULL REFERENCES dbo.InventoryCountSessions(SessionId),StockId INT NOT NULL,ProductId INT NOT NULL,SnapshotQuantity DECIMAL(18,2) NOT NULL,SnapshotUpdatedAt DATETIME2 NOT NULL,CountedQuantity DECIMAL(18,2) NULL CHECK(CountedQuantity>=0),CountedBy NVARCHAR(50) NULL,CountedAt DATETIME2 NULL,CONSTRAINT UQ_InventoryCountItem UNIQUE(SessionId,StockId));
USE dbWMS;
IF OBJECT_ID('dbo.StockTransfers','U') IS NULL CREATE TABLE dbo.StockTransfers(TransferId INT IDENTITY PRIMARY KEY,RequestId UNIQUEIDENTIFIER NOT NULL UNIQUE,WhId INT NOT NULL,ProductId INT NOT NULL,FromLocationCode NVARCHAR(50) NOT NULL,ToLocationCode NVARCHAR(50) NOT NULL,Quantity DECIMAL(18,2) NOT NULL CHECK(Quantity>0),ReferenceNo NVARCHAR(60) NOT NULL,CreatedBy NVARCHAR(50) NOT NULL,CreatedAt DATETIME2 NOT NULL DEFAULT SYSDATETIME());
