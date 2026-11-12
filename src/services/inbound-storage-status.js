// Match the actual inbound receipt. Older unlinked plans are matched conservatively.
module.exports=orderId=>`EXISTS (
 SELECT 1 FROM dbWMS.dbo.InboundReceipts receipt
 JOIN dbWMS.dbo.InboundLines inboundLine ON inboundLine.LineId=receipt.LineId
 JOIN dbWMS.dbo.InboundOrders inboundOrder ON inboundOrder.InboundId=inboundLine.InboundId
 JOIN dbWMS.dbo.StoragePlans planHeader ON (
  planHeader.InboundReceiptId=receipt.ReceiptId OR
  (planHeader.InboundReceiptId IS NULL AND planHeader.ProductId=inboundLine.ProductId
   AND planHeader.WhId=inboundOrder.WhId AND planHeader.FromLocationCode=receipt.LocationCode
   AND planHeader.CreatedAt>=receipt.ReceivedAt))
 JOIN dbWMS.dbo.StoragePlanLines planLine ON planLine.PlanId=planHeader.PlanId
 WHERE inboundLine.InboundId=${orderId} AND planLine.MovedQuantity>0
)`;
