USE dbWMS;
IF COL_LENGTH('dbo.DeliveryAudit','Action') < 40
    ALTER TABLE dbo.DeliveryAudit ALTER COLUMN Action VARCHAR(40) NOT NULL;
