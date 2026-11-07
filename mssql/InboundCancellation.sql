USE dbWMS;
IF COL_LENGTH('dbo.InboundOrders','IsCancelled') IS NULL ALTER TABLE dbo.InboundOrders ADD IsCancelled bit NOT NULL CONSTRAINT DF_Inbound_IsCancelled DEFAULT 0;
IF COL_LENGTH('dbo.InboundOrders','CancelledBy') IS NULL ALTER TABLE dbo.InboundOrders ADD CancelledBy nvarchar(100) NULL,CancelledAt datetime2 NULL,CancelReason nvarchar(500) NULL;
IF OBJECT_ID('dbo.InboundCancelAudit','U') IS NULL CREATE TABLE dbo.InboundCancelAudit(InboundId int PRIMARY KEY REFERENCES dbo.InboundOrders(InboundId),Reason nvarchar(500) NOT NULL,CancelledBy nvarchar(100) NOT NULL,CancelledAt datetime2 NOT NULL DEFAULT SYSDATETIME(),ReceiptSnapshot nvarchar(max) NOT NULL);
