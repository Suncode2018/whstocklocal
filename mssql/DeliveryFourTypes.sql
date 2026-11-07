USE dbWMS;
IF COL_LENGTH('dbo.DeliveryOrders','CategoryCode') IS NULL ALTER TABLE dbo.DeliveryOrders ADD CategoryCode varchar(4) NOT NULL DEFAULT 'FG',Prepared bit NOT NULL DEFAULT 1,CarrierCode nvarchar(30) NULL,RequestJson nvarchar(max) NULL;
IF OBJECT_ID('dbo.DeliveryContainers','U') IS NULL CREATE TABLE dbo.DeliveryContainers(DeliveryId int NOT NULL REFERENCES dbo.DeliveryOrders(DeliveryId),ContainerId int NOT NULL REFERENCES dbo.RMContainers(ContainerId),Quantity decimal(18,2) NOT NULL,PRIMARY KEY(DeliveryId,ContainerId));
GO
CREATE OR ALTER TRIGGER dbo.TR_DeliveryReservationBalance ON dbo.tblStock AFTER INSERT,UPDATE,DELETE AS
BEGIN SET NOCOUNT ON;
IF EXISTS(SELECT 1 FROM (SELECT whid,ProductId,LocationCode FROM inserted UNION SELECT whid,ProductId,LocationCode FROM deleted) x OUTER APPLY(SELECT SUM(l.Quantity) AS Reserved FROM dbo.DeliveryLines l JOIN dbo.DeliveryOrders h ON h.DeliveryId=l.DeliveryId WHERE h.Status='DRAFT' AND h.WhId=x.whid AND l.ProductId=x.ProductId AND l.LocationCode=x.LocationCode) r LEFT JOIN dbo.tblStock s ON s.whid=x.whid AND s.ProductId=x.ProductId AND s.LocationCode=x.LocationCode WHERE r.Reserved>COALESCE(s.Quantity,0)) THROW 51000,N'ยอดนี้ถูกจองในใบส่งสินค้า ไม่สามารถใช้ยอดซ้ำได้',1;
END;

GO
IF COL_LENGTH('dbo.DeliveryLines','OriginLocationCode') IS NULL ALTER TABLE dbo.DeliveryLines ADD OriginLocationCode nvarchar(50) NULL;
IF OBJECT_ID('dbo.DeliveryAudit','U') IS NULL CREATE TABLE dbo.DeliveryAudit(AuditId int IDENTITY PRIMARY KEY,DeliveryId int NOT NULL REFERENCES dbo.DeliveryOrders(DeliveryId),Action varchar(20) NOT NULL,Actor nvarchar(100) NOT NULL,Details nvarchar(max) NULL,CreatedAt datetime2 NOT NULL DEFAULT SYSDATETIME());
GO
CREATE OR ALTER TRIGGER dbo.TR_DeliveryContainerReservation ON dbo.RMContainers AFTER UPDATE,DELETE AS
BEGIN SET NOCOUNT ON;
IF EXISTS(SELECT 1 FROM deleted old JOIN dbo.DeliveryContainers dc ON dc.ContainerId=old.ContainerId JOIN dbo.DeliveryOrders h ON h.DeliveryId=dc.DeliveryId LEFT JOIN inserted n ON n.ContainerId=old.ContainerId WHERE h.Status='DRAFT' AND (n.ContainerId IS NULL OR n.RemainingBase<>old.RemainingBase OR n.Status<>old.Status OR n.WhId<>old.WhId OR n.ProductId<>old.ProductId OR NOT EXISTS(SELECT 1 FROM dbo.DeliveryLines l WHERE l.DeliveryId=h.DeliveryId AND l.ProductId=n.ProductId AND l.LocationCode=n.LocationCode))) THROW 51000,N'ภาชนะถูกจองในใบส่ง กรุณายกเลิกใบส่งก่อนใช้ภาชนะนี้',1; END;

GO
IF COL_LENGTH('dbo.DeliveryOrders','DestinationWhId') IS NULL ALTER TABLE dbo.DeliveryOrders ADD DestinationWhId int NULL;
IF COL_LENGTH('dbo.DeliveryContainers','OriginalStatus') IS NULL ALTER TABLE dbo.DeliveryContainers ADD OriginalStatus varchar(10) NOT NULL DEFAULT 'OPEN';
DECLARE @drop nvarchar(max)='';SELECT @drop=@drop+'ALTER TABLE dbo.DeliveryOrders DROP CONSTRAINT '+QUOTENAME(name)+';' FROM sys.check_constraints WHERE parent_object_id=OBJECT_ID('dbo.DeliveryOrders') AND definition LIKE '%DeliveryType%';IF LEN(@drop)>0 EXEC sp_executesql @drop;
ALTER TABLE dbo.DeliveryOrders ADD CONSTRAINT CK_DeliveryType_FourShipping CHECK(DeliveryType IN('CUSTOMER','CLINIC','FULFILLMENT','WAREHOUSE','FACTORY'));
ALTER TABLE dbo.DeliveryOrders ADD CONSTRAINT CK_DeliveryOwnership_FourShipping CHECK((DeliveryType='CUSTOMER' AND Ownership='CUSTOMER') OR (DeliveryType IN('FULFILLMENT','WAREHOUSE','FACTORY') AND Ownership='COMPANY') OR DeliveryType='CLINIC');
SET @drop='';SELECT @drop=@drop+'ALTER TABLE dbo.DeliveryCustody DROP CONSTRAINT '+QUOTENAME(name)+';' FROM sys.check_constraints WHERE parent_object_id=OBJECT_ID('dbo.DeliveryCustody') AND definition LIKE '%Status%';IF LEN(@drop)>0 EXEC sp_executesql @drop;
ALTER TABLE dbo.DeliveryCustody ADD CONSTRAINT CK_DeliveryCustody_Shipping CHECK(Status IN('IN_TRANSIT','AT_DESTINATION','RECEIVED_STOCK'));
