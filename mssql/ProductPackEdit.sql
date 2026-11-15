USE dbMaster;
IF OBJECT_ID('dbo.ProductPackEditAudit','U') IS NULL
CREATE TABLE dbo.ProductPackEditAudit(AuditId bigint IDENTITY PRIMARY KEY,PackVersionId int NOT NULL,BeforeJson nvarchar(max) NOT NULL,AfterJson nvarchar(max) NOT NULL,Actor nvarchar(100) NOT NULL,ChangedAt datetime2 NOT NULL DEFAULT SYSDATETIME());
