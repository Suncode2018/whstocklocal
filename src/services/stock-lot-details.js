// Only report quantities supported by receipt-linked movements. Ambiguous legacy
// withdrawals invalidate the earlier attribution, rather than assuming FIFO.
function reconcile(stock, candidates, outgoing) {
 return stock.flatMap(s=>{
  const quantity=Number(s.Quantity), key=x=>Number(x.whid)===Number(s.whid)&&x.LocationCode===s.LocationCode;
  let known=candidates.filter(key).filter(c=>Number(c.Quantity)>0 && !outgoing.some(o=>key(o)&&new Date(o.CreatedAt)>=new Date(c.CreatedAt)));
  const sum=known.reduce((n,c)=>n+Number(c.Quantity),0);
  if(quantity<0 || sum>quantity+0.005)known=[];
  const groups=new Map();
  for(const c of known){const k=JSON.stringify([c.AnaNo||'',c.LotNo||'']);if(!groups.has(k))groups.set(k,{whid:s.whid,LocationCode:s.LocationCode,AnaNo:c.AnaNo||null,LotNo:c.LotNo||null,Quantity:0});groups.get(k).Quantity+=Number(c.Quantity);}
  const remainder=Math.round((quantity-[...groups.values()].reduce((n,c)=>n+c.Quantity,0))*100)/100;
  if(remainder!==0)groups.set('unknown',{whid:s.whid,LocationCode:s.LocationCode,AnaNo:null,LotNo:null,Quantity:remainder,Unattributed:true});
  return [...groups.values()];
 });
}
async function load(pool,sql,id,stock,requestFactory){
 const request=requestFactory?requestFactory():pool.request();
 const r=await request.input('P',sql.Int,id).query(`
 SELECT TransId,TransType,whid,LocationCode,QtyChange,QtyAfter,RefDocNo,CreatedAt
 FROM dbWMS.dbo.tblStockTransactions WHERE ProductId=@P ORDER BY CreatedAt,TransId;
 SELECT o.WhId whid,o.ReceiveNo,r.LocationCode,r.Quantity,r.ReceivedAt,l.AnaNo,COALESCE(NULLIF(r.LotNo,N''),l.ProductionLotNo) LotNo
 FROM dbWMS.dbo.InboundReceipts r JOIN dbWMS.dbo.InboundLines l ON l.LineId=r.LineId
 JOIN dbWMS.dbo.InboundOrders o ON o.InboundId=l.InboundId
 WHERE l.ProductId=@P AND o.IsCancelled=0;
 SELECT h.PlanNo,h.WhId,h.InboundReceiptId,l.AnaNo,COALESCE(NULLIF(r.LotNo,N''),l.ProductionLotNo) LotNo
 FROM dbWMS.dbo.StoragePlans h JOIN dbWMS.dbo.InboundReceipts r ON r.ReceiptId=h.InboundReceiptId
 JOIN dbWMS.dbo.InboundLines l ON l.LineId=r.LineId WHERE h.ProductId=@P
 UNION ALL SELECT DocumentNo,WhId,MoveId,AnaNo,LotNo FROM dbWMS.dbo.LocationMoveOrders WHERE ProductId=@P AND Status='DONE' AND (AnaNo IS NOT NULL OR LotNo IS NOT NULL);
 IF OBJECT_ID('dbWMS.dbo.StockLotAdjustments','U') IS NOT NULL
 SELECT * FROM dbWMS.dbo.StockLotAdjustments WHERE ProductId=@P ORDER BY AdjustmentId;
 IF OBJECT_ID('dbWMS.dbo.FGLotPickLines','U') IS NOT NULL
 SELECT o.PickNo,x.WhId,x.ProductId,x.FromLocationCode,x.ToLocationCode,x.AnaNo,x.LotNo,x.FifoDate,x.Quantity FROM dbWMS.dbo.FGLotPickLines x JOIN dbWMS.dbo.PickOperations o ON o.PickId=x.PickId WHERE x.ProductId=@P ORDER BY o.PickId,x.[LineNo];
 ELSE SELECT CAST(NULL AS NVARCHAR(40)) PickNo,CAST(NULL AS INT) WhId,CAST(NULL AS INT) ProductId,CAST(NULL AS NVARCHAR(50)) FromLocationCode,CAST(NULL AS NVARCHAR(50)) ToLocationCode,CAST(NULL AS NVARCHAR(100)) AnaNo,CAST(NULL AS NVARCHAR(100)) LotNo,CAST(NULL AS DATETIME2) FifoDate,CAST(NULL AS DECIMAL(18,2)) Quantity WHERE 1=0;
 `);
 return require('./stock-lot-replay').replay(stock,r.recordsets[0],r.recordsets[1],r.recordsets[2],r.recordsets[3]||[],r.recordsets[4]||[]);
}
module.exports={load,reconcile};
