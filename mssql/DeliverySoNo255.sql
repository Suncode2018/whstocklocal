USE dbWMS;
IF OBJECT_ID('dbo.DeliveryOrders','U') IS NULL
    THROW 51000, 'dbo.DeliveryOrders does not exist. Install delivery workflow schema first.', 1;
IF COL_LENGTH('dbo.DeliveryOrders','SoNo') IS NULL
    THROW 51000, 'dbo.DeliveryOrders.SoNo does not exist.', 1;
IF COL_LENGTH('dbo.DeliveryOrders','SoNo') < 510
    ALTER TABLE dbo.DeliveryOrders ALTER COLUMN SoNo NVARCHAR(255) NULL;
GO
