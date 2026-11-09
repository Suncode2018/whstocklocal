SET XACT_ABORT ON;BEGIN TRANSACTION;
IF COL_LENGTH('dbWMS.dbo.InboundOrders','PlanId') IS NULL BEGIN ALTER TABLE dbWMS.dbo.InboundOrders ADD PlanId int NULL REFERENCES dbWMS.dbo.InboundPlans(PlanId);CREATE INDEX IX_InboundOrders_Plan ON dbWMS.dbo.InboundOrders(PlanId);END;
IF COL_LENGTH('dbWMS.dbo.DeliveryOrders','PlanId') IS NULL BEGIN ALTER TABLE dbWMS.dbo.DeliveryOrders ADD PlanId int NULL REFERENCES dbWMS.dbo.DeliveryPlans(PlanId);CREATE INDEX IX_DeliveryOrders_Plan ON dbWMS.dbo.DeliveryOrders(PlanId);END;
COMMIT;