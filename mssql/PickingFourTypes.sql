USE dbMaster;
SET XACT_ABORT ON;
BEGIN TRANSACTION;
IF OBJECT_ID('dbo.tblRMPackSpecs','U') IS NULL CREATE TABLE dbo.tblRMPackSpecs(ProductId INT PRIMARY KEY REFERENCES dbo.tblProducts(ProductId),PackUnit NVARCHAR(30) NOT NULL,ContentUnit NVARCHAR(30) NOT NULL,ContentPerPack DECIMAL(18,6) NOT NULL CHECK(ContentPerPack>0),BasePerContentUnit DECIMAL(18,6) NOT NULL CHECK(BasePerContentUnit>0),BaseUnit NVARCHAR(30) NOT NULL,Revision INT NOT NULL DEFAULT 1,UpdatedBy NVARCHAR(100) NOT NULL,UpdatedAt DATETIME2 NOT NULL DEFAULT SYSDATETIME());
USE dbWMS;
DECLARE @drop NVARCHAR(MAX)='';SELECT @drop=@drop+N'ALTER TABLE dbo.PickOperations DROP CONSTRAINT '+QUOTENAME(name)+N';' FROM sys.check_constraints WHERE parent_object_id=OBJECT_ID('dbo.PickOperations') AND definition LIKE '%PickType%';IF LEN(@drop)>0 EXEC sp_executesql @drop;
ALTER TABLE dbo.PickOperations ALTER COLUMN PickType VARCHAR(4) NOT NULL;
ALTER TABLE dbo.PickOperations WITH CHECK ADD CONSTRAINT CK_PickOperations_Type_Four CHECK(PickType IN('RM','PKG','SEMI','FG'));
ALTER TABLE dbo.PickOperations WITH CHECK ADD CONSTRAINT CK_PickOperations_Destination CHECK((PickType='FG' AND ToLocationCode IS NOT NULL) OR (PickType IN('RM','PKG','SEMI') AND ToLocationCode IS NULL));
IF COL_LENGTH('dbo.PickOperations','RMMode') IS NULL ALTER TABLE dbo.PickOperations ADD RMMode VARCHAR(10) NULL,RequestedQuantity DECIMAL(18,6) NULL,RequestedUnit NVARCHAR(30) NULL,RequestJson NVARCHAR(MAX) NULL;
IF OBJECT_ID('dbo.RMContainers','U') IS NULL BEGIN
CREATE TABLE dbo.RMContainers(ContainerId INT IDENTITY PRIMARY KEY,ContainerCode VARCHAR(50) NOT NULL UNIQUE,WhId INT NOT NULL,ProductId INT NOT NULL,LocationCode NVARCHAR(50) NOT NULL,LotNo NVARCHAR(60) NOT NULL,ExpiryDate DATE NULL,CapacityBase DECIMAL(18,2) NOT NULL CHECK(CapacityBase>0),RemainingBase DECIMAL(18,2) NOT NULL CHECK(RemainingBase>=0),Status VARCHAR(10) NOT NULL CHECK(Status IN('SEALED','OPEN','EMPTY','ISSUED')),CreatedBy NVARCHAR(100) NOT NULL,CreatedAt DATETIME2 NOT NULL DEFAULT SYSDATETIME(),CHECK(RemainingBase<=CapacityBase));
CREATE INDEX IX_RMContainers_Picking ON dbo.RMContainers(WhId,ProductId,LocationCode,Status,ExpiryDate,CreatedAt);
END;
IF OBJECT_ID('dbo.RMContainerEvents','U') IS NULL CREATE TABLE dbo.RMContainerEvents(EventId BIGINT IDENTITY PRIMARY KEY,ContainerId INT NOT NULL REFERENCES dbo.RMContainers(ContainerId),PickId INT NULL REFERENCES dbo.PickOperations(PickId),RequestId UNIQUEIDENTIFIER NOT NULL,EventType VARCHAR(12) NOT NULL,QuantityBase DECIMAL(18,2) NOT NULL,RemainingBase DECIMAL(18,2) NOT NULL,Actor NVARCHAR(100) NOT NULL,CreatedAt DATETIME2 NOT NULL DEFAULT SYSDATETIME());
COMMIT;
