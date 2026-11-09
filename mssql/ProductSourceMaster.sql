-- Product source master: independent identity preserves repeated business codes.
IF OBJECT_ID('dbo.tblProductMasterImports') IS NULL
CREATE TABLE dbo.tblProductMasterImports(ImportId int IDENTITY PRIMARY KEY, SourceHash char(64) NOT NULL UNIQUE, SourceName nvarchar(255) NOT NULL, ImportedAt datetime2 NOT NULL DEFAULT SYSUTCDATETIME(), SourceRowCount int NOT NULL);
IF OBJECT_ID('dbo.tblProductMasterEntries') IS NULL
CREATE TABLE dbo.tblProductMasterEntries(
 EntryId int IDENTITY PRIMARY KEY, ImportId int NOT NULL REFERENCES dbo.tblProductMasterImports(ImportId), SourceRow int NOT NULL,
 CategoryCode varchar(10) NOT NULL CHECK(CategoryCode IN('RM','PKG','SEMI','BULK','FG')),
 Code1 nvarchar(500) NULL, Code2 nvarchar(500) NULL, Code3 nvarchar(500) NULL, Code4 nvarchar(500) NULL,
 MainCode nvarchar(500) NULL, Name1 nvarchar(2000) NULL, Name2 nvarchar(2000) NULL, DisplayName nvarchar(2000) NOT NULL,
 PhysicalForm nvarchar(100) NULL, SourceJson nvarchar(max) NOT NULL CHECK(ISJSON(SourceJson)=1),
 ProductId int NULL REFERENCES dbo.tblProducts(ProductId), Revision int NOT NULL DEFAULT 1,
 UpdatedAt datetime2 NOT NULL DEFAULT SYSUTCDATETIME(), CONSTRAINT UQ_ProductMasterSource UNIQUE(ImportId,SourceRow));

