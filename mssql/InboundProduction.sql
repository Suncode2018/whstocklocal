USE dbWMS;
IF OBJECT_ID('dbo.InboundProductionInfo','U') IS NULL
CREATE TABLE dbo.InboundProductionInfo(
 InboundId int PRIMARY KEY REFERENCES dbo.InboundOrders(InboundId),
 FormulaCode nvarchar(60) NULL,
 FormulaName nvarchar(200) NULL,
 ProductionSender nvarchar(150) NULL,
 Remark nvarchar(500) NULL
);
IF COL_LENGTH('dbo.InboundLines','AnaNo') IS NULL ALTER TABLE dbo.InboundLines ADD AnaNo nvarchar(60) NULL;
IF COL_LENGTH('dbo.InboundLines','ProductionLotNo') IS NULL ALTER TABLE dbo.InboundLines ADD ProductionLotNo nvarchar(60) NULL;
