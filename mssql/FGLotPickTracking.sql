USE [dbWMS];
SET XACT_ABORT ON;

IF OBJECT_ID(N'dbo.PickOperations', N'U') IS NULL
    THROW 51000, N'สร้าง PickOperations ก่อนติดตั้ง FGLotPickTracking.sql', 1;

IF OBJECT_ID(N'dbo.FGLotPickLines', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.FGLotPickLines (
        PickId INT NOT NULL,
        [LineNo] INT NOT NULL,
        WhId INT NOT NULL,
        ProductId INT NOT NULL,
        FromLocationCode NVARCHAR(50) NOT NULL,
        ToLocationCode NVARCHAR(50) NOT NULL,
        AnaNo NVARCHAR(100) NULL,
        LotNo NVARCHAR(100) NULL,
        FifoDate DATETIME2 NULL,
        Quantity DECIMAL(18,2) NOT NULL,
        CONSTRAINT PK_FGLotPickLines PRIMARY KEY (PickId, [LineNo]),
        CONSTRAINT FK_FGLotPickLines_PickOperations FOREIGN KEY (PickId)
            REFERENCES dbo.PickOperations(PickId),
        CONSTRAINT CK_FGLotPickLines_Quantity CHECK (Quantity > 0)
    );
    CREATE INDEX IX_FGLotPickLines_ProductLocation
        ON dbo.FGLotPickLines(ProductId, WhId, FromLocationCode, FifoDate)
        INCLUDE (AnaNo, LotNo, Quantity, ToLocationCode, PickId);
END;
GO
