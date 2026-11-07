USE dbMaster;
IF OBJECT_ID('dbo.tblProductPackVersions','U') IS NULL CREATE TABLE dbo.tblProductPackVersions(
 PackVersionId int IDENTITY PRIMARY KEY,ProductId int NOT NULL REFERENCES dbo.tblProducts(ProductId),VersionNo int NOT NULL,
 EffectiveFrom date NOT NULL,PackUnit nvarchar(30) NOT NULL,UnitsPerPack decimal(18,6) NOT NULL CHECK(UnitsPerPack>0),
 StockUnitId int NOT NULL REFERENCES dbo.tblUnits(UnitId),NetWeightGramsPerUnit decimal(18,6) NULL CHECK(NetWeightGramsPerUnit>0),
 IsActive bit NOT NULL DEFAULT 1,Note nvarchar(255) NULL,CreatedBy nvarchar(100) NOT NULL,CreatedAt datetime2 NOT NULL DEFAULT SYSDATETIME(),
 UNIQUE(ProductId,VersionNo),UNIQUE(ProductId,EffectiveFrom)
);
