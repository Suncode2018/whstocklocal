USE dbMaster;
SET XACT_ABORT ON;
IF OBJECT_ID('dbo.tblProductPackVersions','U') IS NULL
 THROW 51000,N'Install ProductPackVersions.sql first',1;
IF OBJECT_ID('dbo.tblProductPalletVersions','U') IS NULL
BEGIN
 CREATE TABLE dbo.tblProductPalletVersions(
  ProductPalletVersionId bigint IDENTITY PRIMARY KEY,
  ProductId int NOT NULL REFERENCES dbo.tblProducts(ProductId),
  PackVersionId int NOT NULL REFERENCES dbo.tblProductPackVersions(PackVersionId),
  ConfigurationCode nvarchar(30) NOT NULL,
  EffectiveFrom date NOT NULL,
  IsActive bit NOT NULL DEFAULT 1,
  HandlingLevel varchar(5) NOT NULL CHECK(HandlingLevel IN ('PACK','OUTER')),
  HandlingUnit nvarchar(30) NOT NULL,
  StockUnitsPerHandlingUnit decimal(24,6) NOT NULL CHECK(StockUnitsPerHandlingUnit>0),
  CaseWidthCm decimal(12,3) NOT NULL CHECK(CaseWidthCm>0),
  CaseLengthCm decimal(12,3) NOT NULL CHECK(CaseLengthCm>0),
  CaseHeightCm decimal(12,3) NOT NULL CHECK(CaseHeightCm>0),
  CaseGrossWeightKg decimal(12,3) NULL CHECK(CaseGrossWeightKg>0),
  PalletWidthCm decimal(12,3) NOT NULL CHECK(PalletWidthCm>0),
  PalletLengthCm decimal(12,3) NOT NULL CHECK(PalletLengthCm>0),
  PalletHeightCm decimal(12,3) NULL CHECK(PalletHeightCm>0),
  Ti int NOT NULL CHECK(Ti BETWEEN 1 AND 10000),
  Hi int NOT NULL CHECK(Hi BETWEEN 1 AND 1000),
  Note nvarchar(500) NULL,
  CreatedBy nvarchar(100) NOT NULL,
  CreatedAt datetime2 NOT NULL DEFAULT SYSUTCDATETIME(),
  UpdatedBy nvarchar(100) NULL,UpdatedAt datetime2 NULL,
  Revision rowversion,
  CONSTRAINT UQ_ProductPalletVersion UNIQUE(ProductId,ConfigurationCode,EffectiveFrom)
 );
END;
