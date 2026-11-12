USE dbWMS;
SET XACT_ABORT ON;
BEGIN TRANSACTION;
IF COL_LENGTH('dbo.StoragePlans','InboundReceiptId') IS NULL
 ALTER TABLE dbo.StoragePlans ADD InboundReceiptId int NULL REFERENCES dbo.InboundReceipts(ReceiptId);
COMMIT;
