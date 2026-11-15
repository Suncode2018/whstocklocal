USE dbMaster;
SET XACT_ABORT ON;
BEGIN TRANSACTION;
IF COL_LENGTH('dbo.tblProducts','AllowSevenElevenDelivery') IS NULL
 ALTER TABLE dbo.tblProducts ADD AllowSevenElevenDelivery bit NOT NULL CONSTRAINT DF_Products_SevenEleven DEFAULT(0) WITH VALUES;
IF COL_LENGTH('dbo.tblProducts','SevenElevenDeliveryNote') IS NULL
 ALTER TABLE dbo.tblProducts ADD SevenElevenDeliveryNote nvarchar(500) NULL;
IF OBJECT_ID('dbo.ProductSevenElevenAudit','U') IS NULL
 CREATE TABLE dbo.ProductSevenElevenAudit(AuditId bigint IDENTITY PRIMARY KEY,ProductId int NOT NULL,OldAllowed bit NOT NULL,NewAllowed bit NOT NULL,OldNote nvarchar(500),NewNote nvarchar(500),Actor nvarchar(100) NOT NULL,ChangedAt datetime2 NOT NULL DEFAULT SYSDATETIME());
COMMIT;
