USE dbMaster;
IF OBJECT_ID('dbo.tblProductPackVersions','U') IS NULL CREATE TABLE dbo.tblProductPackVersions(
 PackVersionId int IDENTITY PRIMARY KEY,ProductId int NOT NULL REFERENCES dbo.tblProducts(ProductId),VersionNo int NOT NULL,
 EffectiveFrom date NOT NULL,PackUnit nvarchar(30) NOT NULL,UnitsPerPack decimal(18,6) NOT NULL CHECK(UnitsPerPack>0),
 StockUnitId int NOT NULL REFERENCES dbo.tblUnits(UnitId),NetWeightGramsPerUnit decimal(18,6) NULL CHECK(NetWeightGramsPerUnit>0),
 InnerPackUnit nvarchar(30) NULL,UnitsPerInnerPack decimal(18,6) NULL CHECK(UnitsPerInnerPack>0),
 OuterPackUnit nvarchar(30) NULL,PacksPerOuter int NULL,
 IsActive bit NOT NULL DEFAULT 1,PackTestFingerprint char(64) NULL,PackTestPassedAt datetime2 NULL,PackTestPassedBy nvarchar(100) NULL,LegacyUsageUnknown bit NOT NULL CONSTRAINT DF_tblProductPackVersions_LegacyUsageUnknown DEFAULT 1,Note nvarchar(255) NULL,CreatedBy nvarchar(100) NOT NULL,CreatedAt datetime2 NOT NULL DEFAULT SYSDATETIME(),
 UNIQUE(ProductId,VersionNo)
);
IF OBJECT_ID(N'dbo.ProductPackVersionDeleteAudit',N'U') IS NULL CREATE TABLE dbo.ProductPackVersionDeleteAudit(
 AuditId bigint IDENTITY PRIMARY KEY,ProductId int NOT NULL,PackVersionId int NOT NULL,VersionNo int NOT NULL,
 SnapshotJson nvarchar(max) NOT NULL,Reason nvarchar(500) NOT NULL,Actor nvarchar(100) NOT NULL,DeletedAt datetime2 NOT NULL DEFAULT SYSDATETIME()
);
