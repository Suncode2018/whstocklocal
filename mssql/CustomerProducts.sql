USE dbMaster;
SET XACT_ABORT ON;
BEGIN TRANSACTION;
IF OBJECT_ID('dbo.tblCustomers','U') IS NULL THROW 51000,N'Install CustomerMaster.sql first',1;
IF OBJECT_ID('dbo.tblCustomerProducts','U') IS NULL
BEGIN
CREATE TABLE dbo.tblCustomerProducts(MappingId INT IDENTITY PRIMARY KEY,CustomerId INT NOT NULL REFERENCES dbo.tblCustomers(CustomerId),ProductId INT NOT NULL REFERENCES dbo.tblProducts(ProductId),CustomerProductCode NVARCHAR(60) NULL,CustomerProductName NVARCHAR(255) NULL,Note NVARCHAR(500) NULL,IsActive BIT NOT NULL DEFAULT 1,Revision INT NOT NULL DEFAULT 1,CreatedBy NVARCHAR(100) NOT NULL,CreatedAt DATETIME2 NOT NULL DEFAULT SYSDATETIME(),UpdatedAt DATETIME2 NOT NULL DEFAULT SYSDATETIME(),CONSTRAINT UQ_CustomerProducts_Pair UNIQUE(CustomerId,ProductId));
CREATE UNIQUE INDEX UQ_CustomerProducts_Code ON dbo.tblCustomerProducts(CustomerId,CustomerProductCode) WHERE CustomerProductCode IS NOT NULL;
END;
IF OBJECT_ID('dbo.tblCustomerProductAudit','U') IS NULL CREATE TABLE dbo.tblCustomerProductAudit(AuditId BIGINT IDENTITY PRIMARY KEY,MappingId INT NOT NULL REFERENCES dbo.tblCustomerProducts(MappingId),Actor NVARCHAR(100) NOT NULL,Action VARCHAR(20) NOT NULL,BeforeJson NVARCHAR(MAX) NULL,AfterJson NVARCHAR(MAX) NOT NULL,CreatedAt DATETIME2 NOT NULL DEFAULT SYSDATETIME());
COMMIT;
