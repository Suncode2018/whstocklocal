USE [dbMaster];
IF OBJECT_ID('dbo.tblTrunsport','U') IS NULL
CREATE TABLE dbo.tblTrunsport(tranid nvarchar(30) NOT NULL PRIMARY KEY,tranName nvarchar(200) NOT NULL,IsActive bit NOT NULL CONSTRAINT DF_TransportActive DEFAULT 1,Revision int NOT NULL CONSTRAINT DF_TransportRevision DEFAULT 1,UpdatedAt datetime2 NOT NULL CONSTRAINT DF_TransportUpdated DEFAULT SYSDATETIME());
IF COL_LENGTH('dbo.tblTrunsport','IsActive') IS NULL ALTER TABLE dbo.tblTrunsport ADD IsActive bit NOT NULL DEFAULT 1;
IF COL_LENGTH('dbo.tblTrunsport','Revision') IS NULL ALTER TABLE dbo.tblTrunsport ADD Revision int NOT NULL DEFAULT 1;
IF COL_LENGTH('dbo.tblTrunsport','UpdatedAt') IS NULL ALTER TABLE dbo.tblTrunsport ADD UpdatedAt datetime2 NOT NULL DEFAULT SYSDATETIME();
IF OBJECT_ID('dbo.tblTransportAudit','U') IS NULL CREATE TABLE dbo.tblTransportAudit(AuditId int IDENTITY PRIMARY KEY,tranid nvarchar(30) NOT NULL,Actor nvarchar(100) NOT NULL,Action varchar(20) NOT NULL,BeforeJson nvarchar(max) NULL,AfterJson nvarchar(max) NOT NULL,CreatedAt datetime2 NOT NULL DEFAULT SYSDATETIME());