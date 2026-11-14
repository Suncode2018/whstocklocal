USE dbWMS;
IF COL_LENGTH('dbo.DeliveryOrders','DispatchMethod') IS NULL ALTER TABLE dbo.DeliveryOrders ADD DispatchMethod varchar(30) NULL;
IF COL_LENGTH('dbo.DeliveryOrders','HandoverTo') IS NULL ALTER TABLE dbo.DeliveryOrders ADD HandoverTo nvarchar(100) NULL;
IF COL_LENGTH('dbo.DeliveryOrders','HandoverNote') IS NULL ALTER TABLE dbo.DeliveryOrders ADD HandoverNote nvarchar(500) NULL;
