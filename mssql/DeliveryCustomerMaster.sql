USE dbWMS;
IF COL_LENGTH('dbo.DeliveryOrders','CustomerId') IS NULL ALTER TABLE dbo.DeliveryOrders ADD CustomerId int NULL,CustomerCode nvarchar(30) NULL;
ALTER TABLE dbo.DeliveryOrders ALTER COLUMN DestinationName nvarchar(200) NOT NULL;
ALTER TABLE dbo.DeliveryOrders ALTER COLUMN BillingAddress nvarchar(1000) NULL;
ALTER TABLE dbo.DeliveryOrders ALTER COLUMN ShippingAddress nvarchar(1000) NOT NULL;
ALTER TABLE dbo.DeliveryOrders ALTER COLUMN Phone nvarchar(150) NOT NULL;
