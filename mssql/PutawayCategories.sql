USE dbMaster;
SET XACT_ABORT ON;
IF OBJECT_ID('dbo.tblLocationCategoryRules','U') IS NULL CREATE TABLE dbo.tblLocationCategoryRules(WhId INT NOT NULL,LocationCode NVARCHAR(50) NOT NULL,CategoryId INT NOT NULL REFERENCES dbo.tblCategories(CategoryId),PRIMARY KEY(WhId,LocationCode,CategoryId));
IF OBJECT_ID('dbo.tblLocationCategoryAudit','U') IS NULL CREATE TABLE dbo.tblLocationCategoryAudit(AuditId BIGINT IDENTITY PRIMARY KEY,WhId INT NOT NULL,LocationCode NVARCHAR(50) NOT NULL,Actor NVARCHAR(100) NOT NULL,BeforeJson NVARCHAR(MAX) NOT NULL,AfterJson NVARCHAR(MAX) NOT NULL,CreatedAt DATETIME2 NOT NULL DEFAULT SYSDATETIME());
