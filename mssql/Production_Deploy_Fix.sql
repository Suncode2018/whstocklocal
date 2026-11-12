-- ====================================================================
-- WH Stock System: Production Deployment & Database Migration Fix
-- เซ็ตอัปโครงสร้างฐานข้อมูล dbMaster และ dbWMS สำหรับ Production (DESKTOP-RT67GE0)
-- ปลอดภัย ไม่ลบข้อมูลสินค้าเดิม ไม่ล้างสต๊อก และไม่รีเซ็ตรหัสผ่าน (Idempotent)
-- ====================================================================

SET NOCOUNT ON;
SET XACT_ABORT ON;
GO

-- ====================================================================
-- PART 1: dbMaster - ข้อมูลหลัก (Master Data & User Navigation)
-- ====================================================================
USE [dbMaster];
GO

-- 1.1 หมวดหมู่สินค้า (tblCategories)
IF NOT EXISTS (SELECT 1 FROM dbo.tblCategories WHERE CategoryCode = 'SEMI')
    INSERT INTO dbo.tblCategories (CategoryCode, CategoryName) VALUES ('SEMI', N'Semi Finished Product');

IF NOT EXISTS (SELECT 1 FROM dbo.tblCategories WHERE CategoryCode = 'BULK')
    INSERT INTO dbo.tblCategories (CategoryCode, CategoryName) VALUES ('BULK', N'Bulk Product');
GO

-- 1.2 เพิ่มคอลัมน์ใหม่ในตารางสินค้า (tblProducts)
IF COL_LENGTH('dbo.tblProducts', 'ProductName1') IS NULL
    ALTER TABLE dbo.tblProducts ADD ProductName1 NVARCHAR(2000) NULL;

IF COL_LENGTH('dbo.tblProducts', 'ProductName2') IS NULL
    ALTER TABLE dbo.tblProducts ADD ProductName2 NVARCHAR(2000) NULL;

IF COL_LENGTH('dbo.tblProducts', 'ProID1') IS NULL
    ALTER TABLE dbo.tblProducts ADD ProID1 NVARCHAR(500) NULL;

IF COL_LENGTH('dbo.tblProducts', 'ProID2') IS NULL
    ALTER TABLE dbo.tblProducts ADD ProID2 NVARCHAR(500) NULL;

IF COL_LENGTH('dbo.tblProducts', 'ProID3') IS NULL
    ALTER TABLE dbo.tblProducts ADD ProID3 NVARCHAR(500) NULL;

IF COL_LENGTH('dbo.tblProducts', 'ProID4') IS NULL
    ALTER TABLE dbo.tblProducts ADD ProID4 NVARCHAR(500) NULL;

IF COL_LENGTH('dbo.tblProducts', 'PhysicalForm') IS NULL
    ALTER TABLE dbo.tblProducts ADD PhysicalForm NVARCHAR(50) NULL;

IF COL_LENGTH('dbo.tblProducts', 'MasterStatus') IS NULL
    ALTER TABLE dbo.tblProducts ADD MasterStatus VARCHAR(20) NOT NULL CONSTRAINT DF_tblProducts_MasterStatus DEFAULT ('READY');

IF COL_LENGTH('dbo.tblProducts', 'SourceMasterEntryId') IS NULL
    ALTER TABLE dbo.tblProducts ADD SourceMasterEntryId INT NULL;

IF COL_LENGTH('dbo.tblProducts', 'RowVersion') IS NULL
    ALTER TABLE dbo.tblProducts ADD RowVersion ROWVERSION;

IF COL_LENGTH('dbo.tblProducts', 'SupplierId') IS NULL
    ALTER TABLE dbo.tblProducts ADD SupplierId INT NULL;

IF COL_LENGTH('dbo.tblProducts', 'UnitVolumeCm3') IS NULL
    ALTER TABLE dbo.tblProducts ADD UnitVolumeCm3 DECIMAL(18,3) NULL;

IF COL_LENGTH('dbo.tblProducts', 'UnitWidthCm') IS NULL
    ALTER TABLE dbo.tblProducts ADD UnitWidthCm DECIMAL(18,3) NULL;

IF COL_LENGTH('dbo.tblProducts', 'UnitLengthCm') IS NULL
    ALTER TABLE dbo.tblProducts ADD UnitLengthCm DECIMAL(18,3) NULL;

IF COL_LENGTH('dbo.tblProducts', 'UnitHeightCm') IS NULL
    ALTER TABLE dbo.tblProducts ADD UnitHeightCm DECIMAL(18,3) NULL;
GO

-- ปรับขนาดฟิลด์ ProductName และ UnitId ให้ยืดหยุ่น
IF EXISTS(SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.tblProducts') AND name = 'ProductCode' AND is_nullable = 0)
    ALTER TABLE dbo.tblProducts ALTER COLUMN ProductCode NVARCHAR(50) NULL;

IF EXISTS(SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.tblProducts') AND name = 'ProductName' AND max_length < 4000)
    ALTER TABLE dbo.tblProducts ALTER COLUMN ProductName NVARCHAR(2000) NOT NULL;

IF EXISTS(SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.tblProducts') AND name = 'UnitId' AND is_nullable = 0)
    ALTER TABLE dbo.tblProducts ALTER COLUMN UnitId INT NULL;
GO

-- อัปเดตสถานะ MasterStatus ให้สินค้าเดิม
UPDATE dbo.tblProducts SET MasterStatus = 'READY' WHERE MasterStatus IS NULL OR MasterStatus = '';
UPDATE dbo.tblProducts SET MasterStatus = 'INACTIVE' WHERE IsActive = 0;
GO

-- 1.3 ดัชนี Unique ของ ProductCode
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID('dbo.tblProducts') AND name = 'UX_tblProducts_Code')
    CREATE UNIQUE INDEX UX_tblProducts_Code ON dbo.tblProducts(ProductCode) WHERE ProductCode IS NOT NULL;
GO

-- 1.4 ความจุตำแหน่งจัดเก็บ (Locations)
IF COL_LENGTH('dbo.Locations', 'CapacityVolumeCm3') IS NULL
    ALTER TABLE dbo.Locations ADD CapacityVolumeCm3 DECIMAL(18,3) NULL;

IF COL_LENGTH('dbo.Locations', 'CapacityWidthCm') IS NULL
    ALTER TABLE dbo.Locations ADD CapacityWidthCm DECIMAL(18,3) NULL;

IF COL_LENGTH('dbo.Locations', 'CapacityLengthCm') IS NULL
    ALTER TABLE dbo.Locations ADD CapacityLengthCm DECIMAL(18,3) NULL;

IF COL_LENGTH('dbo.Locations', 'CapacityHeightCm') IS NULL
    ALTER TABLE dbo.Locations ADD CapacityHeightCm DECIMAL(18,3) NULL;
GO

-- 1.5 ตารางรุ่นอัตราบรรจุและสเปกบรรจุภัณฑ์ RM (tblProductPackVersions & tblRMPackSpecs)
IF OBJECT_ID('dbo.tblProductPackVersions', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.tblProductPackVersions (
        PackVersionId INT IDENTITY PRIMARY KEY,
        ProductId INT NOT NULL REFERENCES dbo.tblProducts(ProductId),
        VersionNo INT NOT NULL,
        EffectiveFrom DATE NOT NULL,
        PackUnit NVARCHAR(30) NOT NULL,
        UnitsPerPack DECIMAL(18,6) NOT NULL CHECK(UnitsPerPack > 0),
        StockUnitId INT NOT NULL REFERENCES dbo.tblUnits(UnitId),
        NetWeightGramsPerUnit DECIMAL(18,6) NULL CHECK(NetWeightGramsPerUnit > 0),
        IsActive BIT NOT NULL DEFAULT 1,
        Note NVARCHAR(255) NULL,
        CreatedBy NVARCHAR(100) NOT NULL,
        CreatedAt DATETIME2 NOT NULL DEFAULT SYSDATETIME(),
        CONSTRAINT UQ_PackVersion_No UNIQUE(ProductId, VersionNo),
        CONSTRAINT UQ_PackVersion_Date UNIQUE(ProductId, EffectiveFrom)
    );
END;

IF OBJECT_ID('dbo.tblRMPackSpecs', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.tblRMPackSpecs (
        ProductId INT PRIMARY KEY REFERENCES dbo.tblProducts(ProductId),
        PackUnit NVARCHAR(30) NOT NULL,
        ContentUnit NVARCHAR(30) NOT NULL,
        ContentPerPack DECIMAL(18,6) NOT NULL CHECK(ContentPerPack > 0),
        BasePerContentUnit DECIMAL(18,6) NOT NULL CHECK(BasePerContentUnit > 0),
        BaseUnit NVARCHAR(30) NOT NULL,
        Revision INT NOT NULL DEFAULT 1,
        UpdatedBy NVARCHAR(100) NOT NULL,
        UpdatedAt DATETIME2 NOT NULL DEFAULT SYSDATETIME()
    );
END;
GO

-- 1.6 ตารางผู้จำหน่าย (tblSuppliers & tblSupplierProducts)
IF OBJECT_ID('dbo.tblSuppliers', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.tblSuppliers (
        SupplierId INT IDENTITY PRIMARY KEY,
        SupplierCode NVARCHAR(30) NOT NULL UNIQUE,
        SupplierName NVARCHAR(150) NOT NULL,
        TaxId VARCHAR(13) NULL,
        BranchCode VARCHAR(5) NOT NULL DEFAULT '00000',
        Address NVARCHAR(500) NULL,
        ContactName NVARCHAR(100) NULL,
        Phone NVARCHAR(150) NULL,
        Email NVARCHAR(150) NULL,
        SupplyTypes VARCHAR(30) NOT NULL,
        GoodsServices NVARCHAR(500) NULL,
        ApprovalDate DATE NULL,
        IsActive BIT NOT NULL DEFAULT 1,
        CreatedAt DATETIME2 NOT NULL DEFAULT SYSDATETIME(),
        UpdatedAt DATETIME2 NOT NULL DEFAULT SYSDATETIME()
    );
END;

IF OBJECT_ID('dbo.tblSupplierProducts', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.tblSupplierProducts (
        MappingId INT IDENTITY PRIMARY KEY,
        SupplierId INT NOT NULL REFERENCES dbo.tblSuppliers(SupplierId),
        SupplierProductCode NVARCHAR(60) NOT NULL,
        ProductId INT NOT NULL REFERENCES dbo.tblProducts(ProductId),
        IsActive BIT NOT NULL DEFAULT 1,
        UpdatedAt DATETIME2 NOT NULL DEFAULT SYSDATETIME(),
        CONSTRAINT UQ_tblSupplierProducts_Code UNIQUE(SupplierId, SupplierProductCode)
    );
END;
GO

-- 1.7 ตารางลูกค้า (tblCustomers & tblCustomerProducts)
IF OBJECT_ID('dbo.tblCustomers', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.tblCustomers (
        CustomerId INT IDENTITY PRIMARY KEY,
        CustomerCode NVARCHAR(30) NOT NULL UNIQUE,
        CustomerName NVARCHAR(200) NOT NULL,
        TaxId VARCHAR(13) NOT NULL DEFAULT '0',
        BranchCode VARCHAR(5) NOT NULL DEFAULT '00000',
        BillingAddress NVARCHAR(1000) NULL,
        ShippingAddress NVARCHAR(1000) NULL,
        ContactName NVARCHAR(100) NULL,
        Phone NVARCHAR(150) NULL,
        Email NVARCHAR(150) NULL,
        CustomerTypes VARCHAR(100) NOT NULL,
        Note NVARCHAR(1000) NULL,
        SourceTaxId NVARCHAR(50) NULL,
        SourceFile NVARCHAR(200) NULL,
        IsActive BIT NOT NULL DEFAULT 1,
        Revision INT NOT NULL DEFAULT 1,
        CreatedAt DATETIME2 NOT NULL DEFAULT SYSDATETIME(),
        UpdatedAt DATETIME2 NOT NULL DEFAULT SYSDATETIME()
    );
END;

IF OBJECT_ID('dbo.tblCustomerProducts', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.tblCustomerProducts (
        MappingId INT IDENTITY PRIMARY KEY,
        CustomerId INT NOT NULL REFERENCES dbo.tblCustomers(CustomerId),
        CustomerProductCode NVARCHAR(60) NOT NULL,
        ProductId INT NOT NULL REFERENCES dbo.tblProducts(ProductId),
        CustomerProductName NVARCHAR(200) NULL,
        IsActive BIT NOT NULL DEFAULT 1,
        UpdatedAt DATETIME2 NOT NULL DEFAULT SYSDATETIME(),
        CONSTRAINT UQ_tblCustomerProducts_Code UNIQUE(CustomerId, CustomerProductCode)
    );
END;
GO

-- 1.8 ตารางผู้ขนส่ง (tblTransports & tblTransportProducts)
IF OBJECT_ID('dbo.tblTransports', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.tblTransports (
        TransportId INT IDENTITY PRIMARY KEY,
        TransportCode NVARCHAR(30) NOT NULL UNIQUE,
        TransportName NVARCHAR(200) NOT NULL,
        ContactName NVARCHAR(100) NULL,
        Phone NVARCHAR(150) NULL,
        IsActive BIT NOT NULL DEFAULT 1,
        CreatedAt DATETIME2 NOT NULL DEFAULT SYSDATETIME()
    );
END;

IF OBJECT_ID('dbo.tblTransportProducts', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.tblTransportProducts (
        Id INT IDENTITY PRIMARY KEY,
        TransportId INT NOT NULL REFERENCES dbo.tblTransports(TransportId),
        ProductId INT NOT NULL REFERENCES dbo.tblProducts(ProductId),
        CreatedAt DATETIME2 NOT NULL DEFAULT SYSDATETIME(),
        CONSTRAINT UQ_Transport_Product UNIQUE(TransportId, ProductId)
    );
END;
GO

-- 1.9 ตารางผู้ผลิต-สินค้า (tblManufacturerProducts)
IF OBJECT_ID('dbo.tblManufacturerProducts', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.tblManufacturerProducts (
        Id INT IDENTITY PRIMARY KEY,
        ManufacturerId INT NOT NULL,
        ProductId INT NOT NULL REFERENCES dbo.tblProducts(ProductId),
        CreatedAt DATETIME2 NOT NULL DEFAULT SYSDATETIME(),
        CONSTRAINT UQ_Manufacturer_Product UNIQUE(ManufacturerId, ProductId)
    );
END;
GO

-- 1.10 ข้อมูลบริษัท (CompanyProfile)
IF OBJECT_ID('dbo.CompanyProfile', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.CompanyProfile (
        CompanyId INT NOT NULL PRIMARY KEY CHECK(CompanyId = 1),
        ProfileJson NVARCHAR(MAX) NOT NULL CHECK(ISJSON(ProfileJson) = 1),
        Revision INT NOT NULL DEFAULT 1,
        UpdatedBy NVARCHAR(50),
        UpdatedAt DATETIME2 NOT NULL DEFAULT SYSDATETIME()
    );
    INSERT INTO dbo.CompanyProfile (CompanyId, ProfileJson)
    VALUES (1, N'{"NameTH":"บริษัท รวยมั่งคั่ง 69 จำกัด","NameEN":"RUAYMANGKHANG 69 CO., LTD","AddressTH":"99/64 หมู่ที่ 5 ตำบลบางระกำ อำเภอบางเลน\nจังหวัดนครปฐม 73130","AddressEN":"99/64 Moo 5 Bang Rakam Subdistrict,\nBang Len District, Nakhon Pathom 73130","TaxId":"0735566010770","BranchCode":"00000","Phone":"084-556-1349","Email":"","LogoText":"69","LogoCaption":"RMK"}');
END;
GO

-- 1.11 สูตรการผลิต (tblBOMHeaders & tblBOMLines)
IF OBJECT_ID('dbo.tblBOMHeaders', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.tblBOMHeaders (
        BOMId INT IDENTITY PRIMARY KEY,
        FGProductId INT NOT NULL REFERENCES dbo.tblProducts(ProductId),
        VersionNo INT NOT NULL,
        BaseQuantity DECIMAL(18,6) NOT NULL CHECK(BaseQuantity > 0),
        Status VARCHAR(10) NOT NULL DEFAULT 'DRAFT' CHECK(Status IN('DRAFT','ACTIVE','ARCHIVED')),
        Note NVARCHAR(500) NULL,
        Revision INT NOT NULL DEFAULT 1,
        CreatedBy NVARCHAR(50) NOT NULL,
        CreatedAt DATETIME2 NOT NULL DEFAULT SYSDATETIME(),
        UpdatedAt DATETIME2 NOT NULL DEFAULT SYSDATETIME(),
        ActivatedBy NVARCHAR(50) NULL,
        ActivatedAt DATETIME2 NULL,
        CONSTRAINT UQ_BOM_Version UNIQUE(FGProductId, VersionNo)
    );
END;

IF OBJECT_ID('dbo.tblBOMLines', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.tblBOMLines (
        BOMLineId INT IDENTITY PRIMARY KEY,
        BOMId INT NOT NULL REFERENCES dbo.tblBOMHeaders(BOMId),
        ComponentProductId INT NOT NULL REFERENCES dbo.tblProducts(ProductId),
        Quantity DECIMAL(18,6) NOT NULL CHECK(Quantity > 0),
        UnitId INT NOT NULL REFERENCES dbo.tblUnits(UnitId),
        CONSTRAINT UQ_BOM_Component UNIQUE(BOMId, ComponentProductId)
    );
END;
GO

-- 1.12 ระบบสิทธิ์ผู้ใช้และช่องทาง (UserNavigation, UserMenuAccess, UserWarehouseAccess)
IF OBJECT_ID('dbo.UserNavigation', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.UserNavigation (
        UserId INT PRIMARY KEY REFERENCES dbo.Users(UserId) ON DELETE CASCADE,
        DesktopEnabled BIT NOT NULL DEFAULT 0,
        HandheldEnabled BIT NOT NULL DEFAULT 0,
        Revision INT NOT NULL DEFAULT 1,
        UpdatedAt DATETIME2 NOT NULL DEFAULT SYSDATETIME()
    );
END;

IF OBJECT_ID('dbo.UserMenuAccess', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.UserMenuAccess (
        UserId INT NOT NULL REFERENCES dbo.Users(UserId) ON DELETE CASCADE,
        Mode VARCHAR(8) NOT NULL CHECK(Mode IN('DESKTOP','HH')),
        MenuCode VARCHAR(30) NOT NULL,
        CanView BIT NOT NULL CONSTRAINT DF_UserMenu_View DEFAULT 1,
        CanEdit BIT NOT NULL CONSTRAINT DF_UserMenu_Edit DEFAULT 1,
        CanConfirm BIT NOT NULL CONSTRAINT DF_UserMenu_Confirm DEFAULT 1,
        CanExport BIT NOT NULL CONSTRAINT DF_UserMenu_Export DEFAULT 1,
        CONSTRAINT PK_UserMenuAccess PRIMARY KEY(UserId, Mode, MenuCode)
    );
END;

IF OBJECT_ID('dbo.UserWarehouseAccess', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.UserWarehouseAccess (
        UserId INT NOT NULL REFERENCES dbo.Users(UserId),
        WhId INT NOT NULL REFERENCES dbo.tblWH(whid),
        CreatedAt DATETIME2 NOT NULL DEFAULT SYSDATETIME(),
        PRIMARY KEY(UserId, WhId)
    );
END;

IF OBJECT_ID('dbo.UserAccessAudit', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.UserAccessAudit (
        AuditId INT IDENTITY PRIMARY KEY,
        UserId INT NOT NULL,
        ActorId INT NOT NULL,
        ActorName NVARCHAR(100) NOT NULL,
        BeforeJson NVARCHAR(MAX) NOT NULL,
        AfterJson NVARCHAR(MAX) NOT NULL,
        ChangedAt DATETIME2 NOT NULL DEFAULT SYSDATETIME()
    );
END;
GO

PRINT N'✅ อัปเดตโครงสร้าง dbMaster เรียบร้อยแล้ว';
GO

-- ====================================================================
-- PART 2: dbWMS - งานคลังและธุรกรรม (Workflows & Transactions)
-- ====================================================================
USE [dbWMS];
GO

-- 2.1 รับเข้าสินค้า (InboundOrders & InboundLines & Receipts)
IF OBJECT_ID('dbo.InboundOrders', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.InboundOrders (
        InboundId INT IDENTITY PRIMARY KEY,
        RequestId UNIQUEIDENTIFIER NOT NULL UNIQUE,
        ReceiveNo NVARCHAR(40) NOT NULL UNIQUE,
        ReceiveType VARCHAR(4) NOT NULL CHECK (ReceiveType IN ('RM','PKG','SEMI','FG')),
        WhId INT NOT NULL,
        ReferenceNo NVARCHAR(60) NOT NULL,
        SupplierName NVARCHAR(150) NULL,
        SupplierId INT NULL,
        SupplierDocumentNo NVARCHAR(60) NULL,
        DocumentDate DATE NULL,
        VatRate DECIMAL(5,2) NULL,
        SourceType VARCHAR(20) NULL,
        ProductionOrderNo NVARCHAR(60) NULL,
        ManufacturerId INT NULL,
        IsCancelled BIT NOT NULL DEFAULT 0,
        CancelledBy NVARCHAR(50) NULL,
        CancelledAt DATETIME2 NULL,
        CancellationReason NVARCHAR(500) NULL,
        Status VARCHAR(12) NOT NULL DEFAULT 'OPEN' CHECK(Status IN ('OPEN','PARTIAL','COMPLETED')),
        CreatedBy NVARCHAR(50) NOT NULL,
        CreatedAt DATETIME2 NOT NULL DEFAULT SYSDATETIME()
    );
END
ELSE
BEGIN
    IF COL_LENGTH('dbo.InboundOrders','SupplierDocumentNo') IS NULL ALTER TABLE dbo.InboundOrders ADD SupplierDocumentNo NVARCHAR(60) NULL;
    IF COL_LENGTH('dbo.InboundOrders','DocumentDate') IS NULL ALTER TABLE dbo.InboundOrders ADD DocumentDate DATE NULL;
    IF COL_LENGTH('dbo.InboundOrders','VatRate') IS NULL ALTER TABLE dbo.InboundOrders ADD VatRate DECIMAL(5,2) NULL;
    IF COL_LENGTH('dbo.InboundOrders','SupplierId') IS NULL ALTER TABLE dbo.InboundOrders ADD SupplierId INT NULL;
    IF COL_LENGTH('dbo.InboundOrders','SourceType') IS NULL ALTER TABLE dbo.InboundOrders ADD SourceType VARCHAR(20) NULL;
    IF COL_LENGTH('dbo.InboundOrders','ProductionOrderNo') IS NULL ALTER TABLE dbo.InboundOrders ADD ProductionOrderNo NVARCHAR(60) NULL;
    IF COL_LENGTH('dbo.InboundOrders','ManufacturerId') IS NULL ALTER TABLE dbo.InboundOrders ADD ManufacturerId INT NULL;
    IF COL_LENGTH('dbo.InboundOrders','IsCancelled') IS NULL ALTER TABLE dbo.InboundOrders ADD IsCancelled BIT NOT NULL DEFAULT 0;
    IF COL_LENGTH('dbo.InboundOrders','CancelledBy') IS NULL ALTER TABLE dbo.InboundOrders ADD CancelledBy NVARCHAR(50) NULL;
    IF COL_LENGTH('dbo.InboundOrders','CancelledAt') IS NULL ALTER TABLE dbo.InboundOrders ADD CancelledAt DATETIME2 NULL;
    IF COL_LENGTH('dbo.InboundOrders','CancellationReason') IS NULL ALTER TABLE dbo.InboundOrders ADD CancellationReason NVARCHAR(500) NULL;
END;
GO

IF OBJECT_ID('dbo.InboundLines', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.InboundLines (
        LineId INT IDENTITY PRIMARY KEY,
        InboundId INT NOT NULL REFERENCES dbo.InboundOrders(InboundId),
        ProductId INT NOT NULL,
        OrderedQuantity DECIMAL(18,2) NOT NULL CHECK(OrderedQuantity > 0),
        ReceivedQuantity DECIMAL(18,2) NOT NULL DEFAULT 0,
        SupplierProductCode NVARCHAR(60) NULL,
        UnitPrice DECIMAL(18,4) NULL,
        CONSTRAINT CK_InboundLines_Received CHECK(ReceivedQuantity >= 0 AND ReceivedQuantity <= OrderedQuantity),
        CONSTRAINT UQ_InboundLines_AnaLot UNIQUE(InboundId, ProductId, AnaNo, ProductionLotNo)
    );
END
ELSE
BEGIN
    IF COL_LENGTH('dbo.InboundLines','SupplierProductCode') IS NULL ALTER TABLE dbo.InboundLines ADD SupplierProductCode NVARCHAR(60) NULL;
    IF COL_LENGTH('dbo.InboundLines','UnitPrice') IS NULL ALTER TABLE dbo.InboundLines ADD UnitPrice DECIMAL(18,4) NULL;
END;
GO

IF OBJECT_ID('dbo.InboundReceipts', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.InboundReceipts (
        ReceiptId INT IDENTITY PRIMARY KEY,
        RequestId UNIQUEIDENTIFIER NOT NULL UNIQUE,
        LineId INT NOT NULL REFERENCES dbo.InboundLines(LineId),
        LocationCode NVARCHAR(50) NOT NULL,
        Quantity DECIMAL(18,2) NOT NULL CHECK(Quantity > 0),
        LotNo NVARCHAR(60) NULL,
        MfgDate DATE NULL,
        ExpDate DATE NULL,
        ReceivedBy NVARCHAR(50) NOT NULL,
        ReceivedAt DATETIME2 NOT NULL DEFAULT SYSDATETIME(),
        CONSTRAINT CK_InboundReceipts_Dates CHECK(MfgDate IS NULL OR ExpDate IS NULL OR ExpDate >= MfgDate)
    );
END;
GO

-- 2.2 แผนรับและแผนจัดส่ง (InboundPlans, DeliveryPlans, PlanDocuments)
IF OBJECT_ID('dbo.InboundPlans', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.InboundPlans (
        PlanId INT IDENTITY PRIMARY KEY,
        RequestId UNIQUEIDENTIFIER NOT NULL UNIQUE,
        PlanNo NVARCHAR(40) NOT NULL UNIQUE,
        ReceiveType VARCHAR(4) NOT NULL,
        WhId INT NOT NULL,
        ReferenceNo NVARCHAR(60) NOT NULL,
        SupplierName NVARCHAR(150) NULL,
        SupplierId INT NULL,
        Status VARCHAR(12) NOT NULL DEFAULT 'OPEN',
        CreatedBy NVARCHAR(50) NOT NULL,
        CreatedAt DATETIME2 NOT NULL DEFAULT SYSDATETIME()
    );
END;

IF OBJECT_ID('dbo.InboundPlanLines', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.InboundPlanLines (
        LineId INT IDENTITY PRIMARY KEY,
        PlanId INT NOT NULL REFERENCES dbo.InboundPlans(PlanId),
        ProductId INT NOT NULL,
        PlannedQuantity DECIMAL(18,2) NOT NULL CHECK(PlannedQuantity > 0),
        ReceivedQuantity DECIMAL(18,2) NOT NULL DEFAULT 0
    );
END;

IF OBJECT_ID('dbo.PlanDocuments', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.PlanDocuments (
        DocumentId INT IDENTITY PRIMARY KEY,
        PlanType VARCHAR(10) NOT NULL,
        PlanId INT NOT NULL,
        FileName NVARCHAR(255) NOT NULL,
        FileBytes VARBINARY(MAX) NOT NULL,
        UploadedBy NVARCHAR(50) NOT NULL,
        UploadedAt DATETIME2 NOT NULL DEFAULT SYSDATETIME()
    );
END;
GO

-- 2.3 ภาชนะบรรจุ RM (RMContainers & RMInboundPacks)
IF OBJECT_ID('dbo.RMContainers', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.RMContainers (
        ContainerId INT IDENTITY PRIMARY KEY,
        ContainerCode VARCHAR(50) NOT NULL UNIQUE,
        WhId INT NOT NULL,
        ProductId INT NOT NULL,
        LocationCode NVARCHAR(50) NOT NULL,
        LotNo NVARCHAR(60) NOT NULL,
        ExpiryDate DATE NULL,
        CapacityBase DECIMAL(18,2) NOT NULL CHECK(CapacityBase > 0),
        RemainingBase DECIMAL(18,2) NOT NULL CHECK(RemainingBase >= 0),
        Status VARCHAR(10) NOT NULL CHECK(Status IN('SEALED','OPEN','EMPTY','ISSUED')),
        InboundReceiptId INT NULL REFERENCES dbo.InboundReceipts(ReceiptId),
        CreatedBy NVARCHAR(100) NOT NULL,
        CreatedAt DATETIME2 NOT NULL DEFAULT SYSDATETIME(),
        CHECK(RemainingBase <= CapacityBase)
    );
    CREATE INDEX IX_RMContainers_Picking ON dbo.RMContainers(WhId, ProductId, LocationCode, Status, ExpiryDate, CreatedAt);
END;

IF OBJECT_ID('dbo.RMInboundPacks', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.RMInboundPacks (
        LineId INT PRIMARY KEY REFERENCES dbo.InboundLines(LineId),
        PackCount INT NOT NULL,
        PackUnit NVARCHAR(30) NOT NULL,
        ContentPerPack DECIMAL(18,6) NOT NULL,
        ContentUnit NVARCHAR(30) NOT NULL,
        BasePerContentUnit DECIMAL(18,6) NOT NULL,
        BaseUnit NVARCHAR(30) NOT NULL,
        CapacityBase DECIMAL(18,2) NOT NULL
    );
END;
GO

-- 2.4 วัตถุดิบคลังย่อย (RMSubTransfers, RMSubTransferContainers, RMSubRequests)
IF OBJECT_ID('dbo.RMSubTransfers', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.RMSubTransfers (
        TransferId INT IDENTITY PRIMARY KEY,
        RequestId UNIQUEIDENTIFIER NOT NULL UNIQUE,
        TransferNo NVARCHAR(40) NOT NULL UNIQUE,
        ProductId INT NOT NULL,
        SourceWhId INT NOT NULL,
        SourceLocation NVARCHAR(50) NOT NULL,
        DestinationWhId INT NOT NULL,
        DestinationLocation NVARCHAR(50) NOT NULL,
        PackCount INT NOT NULL CHECK(PackCount > 0),
        QuantityBase DECIMAL(18,2) NOT NULL CHECK(QuantityBase > 0),
        PackUnit NVARCHAR(30) NOT NULL,
        ContentUnit NVARCHAR(30) NOT NULL,
        ContentPerPack DECIMAL(18,6) NOT NULL,
        BasePerContentUnit DECIMAL(18,6) NOT NULL,
        BaseUnit NVARCHAR(30) NOT NULL,
        Status VARCHAR(12) NOT NULL DEFAULT 'SENT' CHECK(Status IN('SENT','RECEIVED','CANCELLED')),
        ReferenceNo NVARCHAR(60) NOT NULL,
        Note NVARCHAR(255) NULL,
        RequestJson NVARCHAR(MAX) NOT NULL,
        CreatedBy NVARCHAR(100) NOT NULL,
        CreatedAt DATETIME2 NOT NULL DEFAULT SYSDATETIME(),
        ReceivedBy NVARCHAR(100) NULL,
        ReceivedAt DATETIME2 NULL,
        CancelledBy NVARCHAR(100) NULL,
        CancelledAt DATETIME2 NULL
    );
    CREATE INDEX IX_RMSubTransfers_Pending ON dbo.RMSubTransfers(Status, ProductId, SourceWhId, DestinationWhId);
END;

IF OBJECT_ID('dbo.RMSubTransferContainers', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.RMSubTransferContainers (
        TransferId INT NOT NULL REFERENCES dbo.RMSubTransfers(TransferId),
        ContainerId INT NOT NULL REFERENCES dbo.RMContainers(ContainerId),
        QuantityBase DECIMAL(18,2) NOT NULL CHECK(QuantityBase > 0),
        LotNo NVARCHAR(60) NOT NULL,
        ExpiryDate DATE NULL,
        PRIMARY KEY(TransferId, ContainerId)
    );
END;

IF OBJECT_ID('dbo.RMSubTransferAudit', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.RMSubTransferAudit (
        AuditId INT IDENTITY PRIMARY KEY,
        TransferId INT NOT NULL REFERENCES dbo.RMSubTransfers(TransferId),
        Action VARCHAR(20) NOT NULL,
        Actor NVARCHAR(100) NOT NULL,
        Details NVARCHAR(MAX) NULL,
        CreatedAt DATETIME2 NOT NULL DEFAULT SYSDATETIME()
    );
END;

IF OBJECT_ID('dbo.RMSubRequests', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.RMSubRequests (
        RequestId INT IDENTITY PRIMARY KEY,
        RequestNo NVARCHAR(40) NOT NULL UNIQUE,
        ProductId INT NOT NULL,
        Status VARCHAR(20) NOT NULL DEFAULT 'PENDING',
        TransferId INT NULL REFERENCES dbo.RMSubTransfers(TransferId),
        CreatedBy NVARCHAR(100) NOT NULL,
        CreatedAt DATETIME2 NOT NULL DEFAULT SYSDATETIME()
    );
END;
GO

-- 2.5 การเบิกจ่าย (PickOperations)
IF OBJECT_ID('dbo.PickOperations', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.PickOperations (
        PickId INT IDENTITY PRIMARY KEY,
        RequestId UNIQUEIDENTIFIER NOT NULL UNIQUE,
        PickNo NVARCHAR(40) NOT NULL UNIQUE,
        PickType VARCHAR(4) NOT NULL,
        WhId INT NOT NULL,
        ProductId INT NOT NULL,
        FromLocationCode NVARCHAR(50) NOT NULL,
        ToLocationCode NVARCHAR(50) NULL,
        Quantity DECIMAL(18,2) NOT NULL CHECK(Quantity > 0),
        ReferenceNo NVARCHAR(60) NOT NULL,
        Note NVARCHAR(255) NULL,
        BatchNo NVARCHAR(60) NULL,
        RMMode VARCHAR(10) NULL,
        RequestedQuantity DECIMAL(18,6) NULL,
        RequestedUnit NVARCHAR(30) NULL,
        RequestJson NVARCHAR(MAX) NULL,
        CreatedBy NVARCHAR(50) NOT NULL,
        CreatedAt DATETIME2 NOT NULL DEFAULT SYSDATETIME()
    );
END
ELSE
BEGIN
    IF COL_LENGTH('dbo.PickOperations', 'BatchNo') IS NULL ALTER TABLE dbo.PickOperations ADD BatchNo NVARCHAR(60) NULL;
    IF COL_LENGTH('dbo.PickOperations', 'RMMode') IS NULL ALTER TABLE dbo.PickOperations ADD RMMode VARCHAR(10) NULL;
    IF COL_LENGTH('dbo.PickOperations', 'RequestedQuantity') IS NULL ALTER TABLE dbo.PickOperations ADD RequestedQuantity DECIMAL(18,6) NULL;
    IF COL_LENGTH('dbo.PickOperations', 'RequestedUnit') IS NULL ALTER TABLE dbo.PickOperations ADD RequestedUnit NVARCHAR(30) NULL;
    IF COL_LENGTH('dbo.PickOperations', 'RequestJson') IS NULL ALTER TABLE dbo.PickOperations ADD RequestJson NVARCHAR(MAX) NULL;
END;
GO

-- 2.6 แผนจัดเก็บ (StoragePlans & StoragePlanLines & StorageMoves)
IF OBJECT_ID('dbo.StoragePlans', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.StoragePlans (
        PlanId INT IDENTITY PRIMARY KEY,
        RequestId UNIQUEIDENTIFIER NOT NULL UNIQUE,
        PlanNo NVARCHAR(40) NOT NULL UNIQUE,
        WhId INT NOT NULL,
        ProductId INT NOT NULL,
        FromLocationCode NVARCHAR(50) NOT NULL,
        UnitVolumeCm3 DECIMAL(18,3) NOT NULL CHECK(UnitVolumeCm3 > 0),
        Status VARCHAR(12) NOT NULL DEFAULT 'OPEN' CHECK(Status IN ('OPEN','COMPLETED','CANCELLED')),
        Note NVARCHAR(255) NULL,
        CreatedBy NVARCHAR(50) NOT NULL,
        CreatedAt DATETIME2 NOT NULL DEFAULT SYSDATETIME()
    );
END;

IF OBJECT_ID('dbo.StoragePlanLines', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.StoragePlanLines (
        LineId INT IDENTITY PRIMARY KEY,
        PlanId INT NOT NULL REFERENCES dbo.StoragePlans(PlanId),
        ToLocationCode NVARCHAR(50) NOT NULL,
        Quantity DECIMAL(18,2) NOT NULL CHECK(Quantity > 0),
        MovedQuantity DECIMAL(18,2) NOT NULL DEFAULT 0 CHECK(MovedQuantity >= 0),
        CONSTRAINT CK_StoragePlanLines_Qty CHECK(MovedQuantity <= Quantity),
        CONSTRAINT UQ_StoragePlanLines_Target UNIQUE(PlanId, ToLocationCode)
    );
END;

IF OBJECT_ID('dbo.StorageMoves', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.StorageMoves (
        MoveId INT IDENTITY PRIMARY KEY,
        RequestId UNIQUEIDENTIFIER NOT NULL UNIQUE,
        LineId INT NOT NULL REFERENCES dbo.StoragePlanLines(LineId),
        Quantity DECIMAL(18,2) NOT NULL CHECK(Quantity > 0),
        MovedBy NVARCHAR(50) NOT NULL,
        MovedAt DATETIME2 NOT NULL DEFAULT SYSDATETIME()
    );
END;
GO

-- 2.7 จัดส่งสินค้า (DeliveryOrders, DeliveryLines, DeliveryCustody, DeliveryContainers)
IF OBJECT_ID('dbo.DeliveryOrders', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.DeliveryOrders (
        DeliveryId INT IDENTITY PRIMARY KEY,
        RequestId UNIQUEIDENTIFIER NOT NULL UNIQUE,
        DeliveryNo NVARCHAR(40) NOT NULL UNIQUE,
        DeliveryType VARCHAR(12) NOT NULL,
        Ownership VARCHAR(8) NOT NULL,
        CategoryCode VARCHAR(4) NOT NULL DEFAULT 'FG',
        Prepared BIT NOT NULL DEFAULT 1,
        WhId INT NOT NULL,
        DestinationWhId INT NULL,
        DestinationName NVARCHAR(150) NOT NULL,
        BranchName NVARCHAR(100) NULL,
        TaxId VARCHAR(13) NULL,
        BillingAddress NVARCHAR(500) NULL,
        ShippingAddress NVARCHAR(500) NOT NULL,
        ContactName NVARCHAR(100) NOT NULL,
        Phone NVARCHAR(50) NOT NULL,
        DeliveryDate DATE NOT NULL,
        PoNo NVARCHAR(60) NULL,
        SoNo NVARCHAR(60) NULL,
        Note NVARCHAR(500) NULL,
        Status VARCHAR(10) NOT NULL DEFAULT 'DRAFT' CHECK(Status IN('DRAFT','SENT','RECEIVED','CANCELLED')),
        Carrier NVARCHAR(100) NULL,
        CarrierCode NVARCHAR(30) NULL,
        TrackingNo NVARCHAR(100) NULL,
        VehicleNo NVARCHAR(30) NULL,
        Cartons INT NULL,
        CompanySnapshot NVARCHAR(MAX) NULL,
        RequestJson NVARCHAR(MAX) NULL,
        CreatedBy NVARCHAR(50) NOT NULL,
        CreatedAt DATETIME2 NOT NULL DEFAULT SYSDATETIME(),
        SentBy NVARCHAR(50) NULL,
        SentAt DATETIME2 NULL,
        ReceivedBy NVARCHAR(100) NULL,
        ReceivedAt DATETIME2 NULL
    );
END
ELSE
BEGIN
    IF COL_LENGTH('dbo.DeliveryOrders','CategoryCode') IS NULL ALTER TABLE dbo.DeliveryOrders ADD CategoryCode VARCHAR(4) NOT NULL DEFAULT 'FG';
    IF COL_LENGTH('dbo.DeliveryOrders','Prepared') IS NULL ALTER TABLE dbo.DeliveryOrders ADD Prepared BIT NOT NULL DEFAULT 1;
    IF COL_LENGTH('dbo.DeliveryOrders','CarrierCode') IS NULL ALTER TABLE dbo.DeliveryOrders ADD CarrierCode NVARCHAR(30) NULL;
    IF COL_LENGTH('dbo.DeliveryOrders','DestinationWhId') IS NULL ALTER TABLE dbo.DeliveryOrders ADD DestinationWhId INT NULL;
    IF COL_LENGTH('dbo.DeliveryOrders','CompanySnapshot') IS NULL ALTER TABLE dbo.DeliveryOrders ADD CompanySnapshot NVARCHAR(MAX) NULL;
    IF COL_LENGTH('dbo.DeliveryOrders','RequestJson') IS NULL ALTER TABLE dbo.DeliveryOrders ADD RequestJson NVARCHAR(MAX) NULL;
END;
GO

IF OBJECT_ID('dbo.DeliveryLines', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.DeliveryLines (
        LineId INT IDENTITY PRIMARY KEY,
        DeliveryId INT NOT NULL REFERENCES dbo.DeliveryOrders(DeliveryId),
        ProductId INT NOT NULL,
        LocationCode NVARCHAR(50) NOT NULL,
        OriginLocationCode NVARCHAR(50) NULL,
        Quantity DECIMAL(18,2) NOT NULL CHECK(Quantity > 0),
        ProductCode NVARCHAR(100) NOT NULL,
        ProductName NVARCHAR(500) NOT NULL,
        UOM NVARCHAR(100) NULL,
        CONSTRAINT UQ_DeliveryLines UNIQUE(DeliveryId, ProductId, LocationCode)
    );
END
ELSE
BEGIN
    IF COL_LENGTH('dbo.DeliveryLines','OriginLocationCode') IS NULL ALTER TABLE dbo.DeliveryLines ADD OriginLocationCode NVARCHAR(50) NULL;
END;
GO

IF OBJECT_ID('dbo.DeliveryCustody', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.DeliveryCustody (
        LineId INT PRIMARY KEY REFERENCES dbo.DeliveryLines(LineId),
        Quantity DECIMAL(18,2) NOT NULL,
        Status VARCHAR(20) NOT NULL DEFAULT 'IN_TRANSIT',
        SentAt DATETIME2 NOT NULL DEFAULT SYSDATETIME(),
        ReceivedAt DATETIME2 NULL
    );
END;

IF OBJECT_ID('dbo.DeliveryContainers', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.DeliveryContainers (
        DeliveryId INT NOT NULL REFERENCES dbo.DeliveryOrders(DeliveryId),
        ContainerId INT NOT NULL REFERENCES dbo.RMContainers(ContainerId),
        Quantity DECIMAL(18,2) NOT NULL,
        OriginalStatus VARCHAR(10) NOT NULL DEFAULT 'OPEN',
        PRIMARY KEY(DeliveryId, ContainerId)
    );
END;

IF OBJECT_ID('dbo.DeliveryAudit', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.DeliveryAudit (
        AuditId INT IDENTITY PRIMARY KEY,
        DeliveryId INT NOT NULL REFERENCES dbo.DeliveryOrders(DeliveryId),
        Action VARCHAR(20) NOT NULL,
        Actor NVARCHAR(100) NOT NULL,
        Details NVARCHAR(MAX) NULL,
        CreatedAt DATETIME2 NOT NULL DEFAULT SYSDATETIME()
    );
END;
GO

-- 2.8 การตรวจนับ (CheckSessions, CheckItems, CheckContainers, CheckAudit)
IF OBJECT_ID('dbo.CheckSessions', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.CheckSessions (
        Id INT IDENTITY PRIMARY KEY,
        RequestId UNIQUEIDENTIFIER NOT NULL UNIQUE,
        DocNo NVARCHAR(40) NOT NULL UNIQUE,
        WhId INT NOT NULL,
        LocationCode NVARCHAR(50) NOT NULL,
        CategoryCode VARCHAR(4) NOT NULL CHECK(CategoryCode IN('RM','PKG','SEMI','FG')),
        Status VARCHAR(12) NOT NULL DEFAULT 'OPEN' CHECK(Status IN('OPEN','REVIEW','CLOSED','CANCELLED')),
        CreatedBy NVARCHAR(100) NOT NULL,
        CreatedAt DATETIME2 NOT NULL DEFAULT SYSDATETIME(),
        ClosedBy NVARCHAR(100) NULL,
        ClosedAt DATETIME2 NULL
    );
END;

IF OBJECT_ID('dbo.CheckItems', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.CheckItems (
        Id INT IDENTITY PRIMARY KEY,
        SessionId INT NOT NULL REFERENCES dbo.CheckSessions(Id),
        StockId INT NOT NULL,
        ProductId INT NOT NULL,
        Snapshot DECIMAL(18,2) NOT NULL,
        Counted DECIMAL(18,2) NULL,
        Recount DECIMAL(18,2) NULL,
        Reason NVARCHAR(255) NULL,
        CountedBy NVARCHAR(100) NULL,
        CountedAt DATETIME2 NULL,
        CONSTRAINT UQ_CheckSession_Stock UNIQUE(SessionId, StockId)
    );
END;

IF OBJECT_ID('dbo.CheckContainers', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.CheckContainers (
        Id INT IDENTITY PRIMARY KEY,
        ItemId INT NOT NULL REFERENCES dbo.CheckItems(Id),
        ContainerId INT NOT NULL REFERENCES dbo.RMContainers(ContainerId),
        Snapshot DECIMAL(18,2) NOT NULL,
        Counted DECIMAL(18,2) NULL,
        Recount DECIMAL(18,2) NULL,
        CONSTRAINT UQ_CheckItem_Container UNIQUE(ItemId, ContainerId)
    );
END;

IF OBJECT_ID('dbo.CheckAudit', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.CheckAudit (
        Id INT IDENTITY PRIMARY KEY,
        SessionId INT NOT NULL REFERENCES dbo.CheckSessions(Id),
        Actor NVARCHAR(100) NOT NULL,
        Action VARCHAR(20) NOT NULL,
        Details NVARCHAR(MAX) NULL,
        CreatedAt DATETIME2 NOT NULL DEFAULT SYSDATETIME()
    );
END;
GO

-- 2.9 การโอนย้ายสต็อก (StockTransfers)
IF OBJECT_ID('dbo.StockTransfers', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.StockTransfers (
        TransferId INT IDENTITY PRIMARY KEY,
        RequestId UNIQUEIDENTIFIER NOT NULL UNIQUE,
        WhId INT NOT NULL,
        ProductId INT NOT NULL,
        FromLocationCode NVARCHAR(50) NOT NULL,
        ToLocationCode NVARCHAR(50) NOT NULL,
        Quantity DECIMAL(18,2) NOT NULL CHECK(Quantity > 0),
        ReferenceNo NVARCHAR(60) NOT NULL,
        CreatedBy NVARCHAR(50) NOT NULL,
        CreatedAt DATETIME2 NOT NULL DEFAULT SYSDATETIME()
    );
END;
GO

PRINT N'✅ อัปเดตโครงสร้าง dbWMS เรียบร้อยแล้ว';
PRINT N'====================================================================';
PRINT N'🎉 อัปเดตโครงสร้างระบบคลังสินค้าครบถ้วนสมบูรณ์ พร้อมใช้งานบน Production!';
PRINT N'====================================================================';
GO

