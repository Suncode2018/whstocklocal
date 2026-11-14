USE dbMaster;
IF COL_LENGTH('dbo.tblProducts','AllowClinicDelivery') IS NULL ALTER TABLE dbo.tblProducts ADD AllowClinicDelivery bit NOT NULL CONSTRAINT DF_Products_Clinic DEFAULT(0) WITH VALUES;
IF COL_LENGTH('dbo.tblProducts','ClinicDeliveryNote') IS NULL ALTER TABLE dbo.tblProducts ADD ClinicDeliveryNote nvarchar(500) NULL;
IF OBJECT_ID('dbo.ProductClinicAudit','U') IS NULL CREATE TABLE dbo.ProductClinicAudit(AuditId bigint IDENTITY PRIMARY KEY,ProductId int NOT NULL,OldAllowed bit NOT NULL,NewAllowed bit NOT NULL,OldNote nvarchar(500),NewNote nvarchar(500),Actor nvarchar(100) NOT NULL,ChangedAt datetime2 NOT NULL DEFAULT SYSDATETIME());
