// Reconstruct provenance from recorded movements. Partial withdrawals from mixed
// lots are ambiguous unless the movement names a receipt; never assume FIFO.
const units=n=>Math.round(Number(n)*100);
const key=(w,l)=>JSON.stringify([Number(w),l]);
const lotKey=x=>JSON.stringify([x.AnaNo||null,x.LotNo||null,x.PackVersionId||null]);
function replay(stock,events,receipts,plans,adjustments=[],pickAllocations=[],transferAllocations=[],storageMoves=[]){
 const balances=new Map(),transit=new Map();
 const add=(list,rows)=>{for(const r of rows){if(r.q<=0)continue;const old=list.find(x=>lotKey(x)===lotKey(r));if(old){old.q+=r.q;if(r.ReceivedAt&&(!old.ReceivedAt||new Date(r.ReceivedAt)<new Date(old.ReceivedAt)))old.ReceivedAt=r.ReceivedAt;}else list.push({...r});}};
 const at=(w,l)=>{const k=key(w,l);if(!balances.has(k))balances.set(k,[]);return balances.get(k)};
 function take(list,q,preferred){
  const total=list.reduce((n,x)=>n+x.q,0);
  if(total<q)add(list,[{q:q-total}]);
  const eligible=preferred?list.filter(x=>lotKey(x)===lotKey(preferred)):list;
  if(preferred&&eligible.reduce((n,x)=>n+x.q,0)<q)preferred=null;
  if(!preferred&&list.filter(x=>x.q>0).length>1&&q<list.reduce((n,x)=>n+x.q,0)){
   const remaining=list.reduce((n,x)=>n+x.q,0)-q;list.splice(0,list.length,{q:remaining});return [{q}];
  }
  let left=q;const result=[];
  for(const r of preferred?eligible:list){const n=Math.min(left,r.q);if(n){result.push({...r,q:n});r.q-=n;left-=n;}if(!left)break;}
  return result;
 }
 function takeExact(list,rows){
  const result=[];
  for(const row of rows){let left=units(row.Quantity),wanted={AnaNo:row.AnaNo,LotNo:row.LotNo},sameLot=list.filter(x=>(x.AnaNo||null)===(wanted.AnaNo||null)&&(x.LotNo||null)===(wanted.LotNo||null)),match=row.PackVersionId?sameLot.find(x=>Number(x.PackVersionId)===Number(row.PackVersionId)):sameLot.length===1?sameLot[0]:null;if(!match||match.q<left){return [{q:rows.reduce((n,x)=>n+units(x.Quantity),0),AnaNo:null,LotNo:null,Unattributed:true}]}match.q-=left;result.push({AnaNo:wanted.AnaNo||null,LotNo:wanted.LotNo||null,PackVersionId:match.PackVersionId||null,ReceivedAt:row.FifoDate||match.ReceivedAt||null,q:left});}
  return result;
 }
 const picksByRef=new Map();for(const p of pickAllocations){if(!picksByRef.has(p.PickNo))picksByRef.set(p.PickNo,[]);picksByRef.get(p.PickNo).push(p);}
 const groups=new Map();
 for(const e of [...events].sort((a,b)=>new Date(a.CreatedAt)-new Date(b.CreatedAt)||a.TransId-b.TransId)){
  const k=JSON.stringify([new Date(e.CreatedAt).getTime(),e.TransType,e.RefDocNo,e.whid]);
  if(!groups.has(k))groups.set(k,[]);groups.get(k).push(e);
 }
 const corrections=[...adjustments].sort((a,b)=>a.ThroughTransId-b.ThroughTransId||a.AdjustmentId-b.AdjustmentId);
 let correctionIndex=0;
 function applyCorrections(before){
  while(correctionIndex<corrections.length&&corrections[correctionIndex].ThroughTransId<before){
   const c=corrections[correctionIndex++],list=at(c.WhId,c.LocationCode);
   const rows=JSON.parse(c.RowsJson);list.splice(0,list.length);
   add(list,rows.map(r=>({AnaNo:r.AnaNo,LotNo:r.LotNo,PackVersionId:r.PackVersionId||null,q:units(r.Quantity)})));
  }
 }
 for(const group of groups.values()){
  applyCorrections(Math.min(...group.map(e=>e.TransId)));
  const first=group[0],moved=[];
  const plan=plans.find(p=>p.PlanNo===first.RefDocNo&&Number(p.WhId)===Number(first.whid));
  for(const e of group.filter(x=>Number(x.QtyChange)<0)){
   const exact=first.TransType==='PICK'?(picksByRef.get(first.RefDocNo)||[]).filter(p=>Number(p.WhId)===Number(e.whid)&&p.FromLocationCode===e.LocationCode):[];
   const transfer=first.TransType==='SHIP_PREP'?transferAllocations.filter(x=>x.DeliveryNo===first.RefDocNo&&Number(x.WhId)===Number(e.whid)&&x.LocationCode===e.LocationCode):first.TransType==='SHIP_CANCEL'?transferAllocations.filter(x=>x.DeliveryNo===first.RefDocNo&&Number(x.WhId)===Number(e.whid)):[];
   const stored=first.TransType==='PUTAWAY'?storageMoves.filter(x=>x.DeliveryNo===first.RefDocNo&&Number(x.WhId)===Number(e.whid)&&x.FromLocationCode===e.LocationCode&&new Date(x.MovedAt).getTime()===new Date(e.CreatedAt).getTime()):[];
   const rows=exact.length?takeExact(at(e.whid,e.LocationCode),exact):transfer.length?takeExact(at(e.whid,e.LocationCode),transfer):stored.length?takeExact(at(e.whid,e.LocationCode),stored):e.TransType==='ADJUST'&&e.AdjustmentLotNo?take(at(e.whid,e.LocationCode),-units(e.QtyChange),{AnaNo:e.AdjustmentAnaNo||null,LotNo:e.AdjustmentLotNo,PackVersionId:e.PackVersionId||null}):take(at(e.whid,e.LocationCode),-units(e.QtyChange),plan?.InboundReceiptId?plan:null);add(moved,rows);
  }
  if(first.TransType==='LOAD'&&moved.length){const k=first.RefDocNo;if(!transit.has(k))transit.set(k,[]);add(transit.get(k),moved);}
  for(const e of group.filter(x=>Number(x.QtyChange)>0)){
   const q=units(e.QtyChange);let rows;
   if(e.TransType==='SHIP_RECEIVE')rows=take(transit.get(e.RefDocNo)||[],q);
   else if(moved.reduce((n,x)=>n+x.q,0)>=q)rows=take(moved,q);
   else if(e.TransType==='ADJUST'&&e.AdjustmentLotNo)rows=[{AnaNo:e.AdjustmentAnaNo||null,LotNo:e.AdjustmentLotNo,PackVersionId:e.PackVersionId||null,q}];
   else if(e.TransType==='RECEIVE'){
    const matches=receipts.filter(r=>r.ReceiveNo===e.RefDocNo&&Number(r.whid)===Number(e.whid)&&r.LocationCode===e.LocationCode);
    const receiveEvents=events.filter(x=>x.TransType==='RECEIVE'&&x.RefDocNo===e.RefDocNo&&Number(x.whid)===Number(e.whid)&&x.LocationCode===e.LocationCode);
    rows=receiveEvents.length===1&&matches.reduce((n,r)=>n+units(r.Quantity),0)===q?matches.map(r=>({...r,q:units(r.Quantity)})):[{q}];
   }else rows=[{q}];
   add(at(e.whid,e.LocationCode),rows);
  }
 }
 applyCorrections(Infinity);
 return stock.flatMap(s=>{
  const q=units(s.Quantity);if(!q)return [];
  let rows=at(s.whid,s.LocationCode).filter(r=>r.q>0);
  if(rows.reduce((n,r)=>n+r.q,0)!==q)rows=[{q}];
  return rows.map(r=>({whid:s.whid,LocationCode:s.LocationCode,AnaNo:r.AnaNo||null,LotNo:r.LotNo||null,...(r.PackVersionId?{PackVersionId:r.PackVersionId}:{}),ReceivedAt:r.ReceivedAt||null,Quantity:r.q/100,...(!r.AnaNo&&!r.LotNo?{Unattributed:true}:{})}));
 });
}
module.exports={replay};
