// Conservative cancellation guard, matching the checks used when reversing receipts.
module.exports = orderId => `EXISTS (
 SELECT 1 FROM dbWMS.dbo.InboundReceipts r
 JOIN dbWMS.dbo.InboundLines l ON l.LineId=r.LineId
 JOIN dbWMS.dbo.InboundOrders h ON h.InboundId=l.InboundId
 WHERE l.InboundId=${orderId} AND (
 EXISTS(SELECT 1 FROM dbWMS.dbo.StoragePlans p WHERE p.WhId=h.WhId AND p.ProductId=l.ProductId AND p.FromLocationCode=r.LocationCode AND p.Status='OPEN')
 OR EXISTS(SELECT 1 FROM dbWMS.dbo.tblStockTransactions t WHERE t.whid=h.WhId AND t.ProductId=l.ProductId AND t.LocationCode=r.LocationCode AND t.CreatedAt>=r.ReceivedAt AND t.TransType NOT IN('RECEIVE','RECEIVE_CANCEL'))
 OR EXISTS(SELECT 1 FROM dbWMS.dbo.RMContainers c JOIN dbWMS.dbo.DeliveryContainers dc ON dc.ContainerId=c.ContainerId JOIN dbWMS.dbo.DeliveryOrders d ON d.DeliveryId=dc.DeliveryId WHERE c.WhId=h.WhId AND c.ProductId=l.ProductId AND c.LocationCode=r.LocationCode AND d.Status='DRAFT')
 ))`;
