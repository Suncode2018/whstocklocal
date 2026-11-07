USE dbWMS;
IF COL_LENGTH('dbo.PickOperations','BatchNo') IS NULL ALTER TABLE dbo.PickOperations ADD BatchNo nvarchar(60) NULL;
IF COL_LENGTH('dbo.RMContainers','InboundReceiptId') IS NULL ALTER TABLE dbo.RMContainers ADD InboundReceiptId int NULL REFERENCES dbo.InboundReceipts(ReceiptId);
IF OBJECT_ID('dbo.RMInboundPacks','U') IS NULL CREATE TABLE dbo.RMInboundPacks(LineId int PRIMARY KEY REFERENCES dbo.InboundLines(LineId),PackCount int NOT NULL,PackUnit nvarchar(30) NOT NULL,ContentPerPack decimal(18,6) NOT NULL,ContentUnit nvarchar(30) NOT NULL,BasePerContentUnit decimal(18,6) NOT NULL,BaseUnit nvarchar(30) NOT NULL,CapacityBase decimal(18,2) NOT NULL);
