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
async function load(pool,sql,id,stock){
 const r=await pool.request().input('P',sql.Int,id).query(`
 SELECT t.whid,t.LocationCode,t.QtyChange Quantity,t.CreatedAt,l.AnaNo,r.LotNo
 FROM dbWMS.dbo.tblStockTransactions t
 JOIN dbWMS.dbo.StoragePlans h ON h.PlanNo=t.RefDocNo AND h.ProductId=t.ProductId AND h.WhId=t.whid
 JOIN dbWMS.dbo.InboundReceipts r ON r.ReceiptId=h.InboundReceiptId
 JOIN dbWMS.dbo.InboundLines l ON l.LineId=r.LineId
 JOIN dbWMS.dbo.InboundOrders o ON o.InboundId=l.InboundId
 WHERE t.ProductId=@P AND t.TransType='PUTAWAY' AND t.QtyChange>0 AND o.IsCancelled=0;
 SELECT o.WhId whid,r.LocationCode,r.Quantity-COALESCE(m.Qty,0) Quantity,r.ReceivedAt CreatedAt,l.AnaNo,r.LotNo
 FROM dbWMS.dbo.InboundReceipts r JOIN dbWMS.dbo.InboundLines l ON l.LineId=r.LineId
 JOIN dbWMS.dbo.InboundOrders o ON o.InboundId=l.InboundId
 OUTER APPLY(SELECT SUM(pl.MovedQuantity) Qty FROM dbWMS.dbo.StoragePlans h JOIN dbWMS.dbo.StoragePlanLines pl ON pl.PlanId=h.PlanId WHERE h.InboundReceiptId=r.ReceiptId) m
 WHERE l.ProductId=@P AND o.IsCancelled=0;
 SELECT whid,LocationCode,CreatedAt FROM dbWMS.dbo.tblStockTransactions WHERE ProductId=@P AND QtyChange<0;
 `);
 // RCV attribution is safe only with no unlinked withdrawals. PUTAWAY withdrawals
 // are already deducted above; conservatively invalidate on any withdrawal too.
 return reconcile(stock,[...r.recordsets[0],...r.recordsets[1]],r.recordsets[2]);
}
module.exports={load,reconcile};
