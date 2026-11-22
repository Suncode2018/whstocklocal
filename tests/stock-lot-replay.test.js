const test=require('node:test'),assert=require('node:assert/strict');
const {replay}=require('../src/services/stock-lot-replay');
const e=(id,type,wh,loc,qty,ref,time=id)=>({TransId:id,TransType:type,whid:wh,LocationCode:loc,QtyChange:qty,RefDocNo:ref,CreatedAt:new Date(time*1000)});
const receipt=(wh,ref,lot,qty)=>({whid:wh,ReceiveNo:ref,LocationCode:'RCV',Quantity:qty,AnaNo:lot,LotNo:lot});
test('ANA and LOT follow prepare, cancellation, dispatch, receipt, putaway and onward transfer',()=>{
 const events=[e(1,'RECEIVE',1,'RCV',10,'R'),e(2,'SHIP_PREP',1,'RCV',-10,'D',2),e(3,'SHIP_PREP',1,'OUT',10,'D',2),e(4,'SHIP_CANCEL',1,'RCV',10,'D',3),e(5,'SHIP_CANCEL',1,'OUT',-10,'D',3),e(6,'SHIP_PREP',1,'RCV',-10,'D2',4),e(7,'SHIP_PREP',1,'OUT',10,'D2',4),e(8,'LOAD',1,'OUT',-10,'D2'),e(9,'SHIP_RECEIVE',2,'RCV',10,'D2'),e(10,'PUTAWAY',2,'RCV',-10,'D2',10),e(11,'PUTAWAY',2,'A',10,'D2',10),e(12,'SHIP_PREP',2,'A',-4,'D3',12),e(13,'SHIP_PREP',2,'OUT',4,'D3',12),e(14,'LOAD',2,'OUT',-4,'D3'),e(15,'SHIP_RECEIVE',3,'RCV',4,'D3')];
 const rows=replay([{whid:2,LocationCode:'A',Quantity:6},{whid:3,LocationCode:'RCV',Quantity:4}],events,[receipt(1,'R','LOT03',10)],[]);
 assert.deepEqual(rows.map(x=>[x.whid,x.AnaNo,x.LotNo,x.Quantity]),[[2,'LOT03','LOT03',6],[3,'LOT03','LOT03',4]]);
});
test('mixed partial transfers remain unknown instead of inventing FIFO',()=>{
 const events=[e(1,'RECEIVE',1,'RCV',10,'R1'),e(2,'RECEIVE',1,'RCV',10,'R2'),e(3,'SHIP_PREP',1,'RCV',-5,'D',3),e(4,'SHIP_PREP',1,'OUT',5,'D',3),e(5,'LOAD',1,'OUT',-5,'D'),e(6,'SHIP_RECEIVE',2,'RCV',5,'D')];
 const rows=replay([{whid:1,LocationCode:'RCV',Quantity:15},{whid:2,LocationCode:'RCV',Quantity:5}],events,[receipt(1,'R1','A',10),receipt(1,'R2','B',10)],[]);
 assert.equal(rows.reduce((n,x)=>n+x.Quantity,0),20);assert.ok(rows.every(x=>x.Unattributed));
});
test('moving all mixed lots preserves every ANA/LOT and fractional quantity',()=>{
 const events=[e(1,'RECEIVE',1,'RCV',0.1,'R1'),e(2,'RECEIVE',1,'RCV',0.2,'R2'),e(3,'SHIP_PREP',1,'RCV',-0.3,'D',3),e(4,'SHIP_PREP',1,'OUT',0.3,'D',3),e(5,'LOAD',1,'OUT',-0.3,'D'),e(6,'SHIP_RECEIVE',2,'RCV',0.3,'D')];
 const rows=replay([{whid:2,LocationCode:'RCV',Quantity:0.3}],events,[receipt(1,'R1','A',0.1),receipt(1,'R2','B',0.2)],[]);assert.deepEqual(rows.map(x=>[x.LotNo,x.Quantity]),[['A',0.1],['B',0.2]]);
});
test('incomplete movement histories do not claim unsupported lots',()=>{
 assert.deepEqual(replay([{whid:1,LocationCode:'A',Quantity:9}],[],[],[]),[{whid:1,LocationCode:'A',AnaNo:null,LotNo:null,ReceivedAt:null,Quantity:9,Unattributed:true}]);
});
test('Admin lot correction carries through later cross warehouse movements without changing stock',()=>{
 const events=[e(1,'ADJUST',1,'A',10,'COUNT'),e(2,'SHIP_PREP',1,'A',-4,'D',2),e(3,'SHIP_PREP',1,'OUT',4,'D',2),e(4,'LOAD',1,'OUT',-4,'D'),e(5,'SHIP_RECEIVE',2,'RCV',4,'D')];
 const adjustments=[{AdjustmentId:1,ThroughTransId:1,WhId:1,LocationCode:'A',RowsJson:JSON.stringify([{AnaNo:'ANA-X',LotNo:'LOT-X',Quantity:10}])}];
 const rows=replay([{whid:1,LocationCode:'A',Quantity:6},{whid:2,LocationCode:'RCV',Quantity:4}],events,[],[],adjustments);
 assert.deepEqual(rows.map(r=>[r.AnaNo,r.LotNo,r.Quantity]),[['ANA-X','LOT-X',6],['ANA-X','LOT-X',4]]);
});
test('cross-warehouse transfer preserves the selected ANA/LOT allocation and putaway split',()=>{
 const events=[e(1,'RECEIVE',1,'A',10,'R1'),e(2,'RECEIVE',1,'A',10,'R2'),e(3,'SHIP_PREP',1,'A',-5,'D1',3),e(4,'SHIP_PREP',1,'OUT',5,'D1',3),e(5,'LOAD',1,'OUT',-5,'D1',4),e(6,'SHIP_RECEIVE',2,'RCV',5,'D1',5),e(7,'PUTAWAY',2,'RCV',-3,'D1',7),e(8,'PUTAWAY',2,'A',3,'D1',7)];
 const receipts=[{whid:1,ReceiveNo:'R1',LocationCode:'A',Quantity:10,AnaNo:'ANA-1',LotNo:'LOT-1'},{whid:1,ReceiveNo:'R2',LocationCode:'A',Quantity:10,AnaNo:'ANA-2',LotNo:'LOT-2'}];
 const allocations=[{DeliveryNo:'D1',WhId:1,LocationCode:'A',AnaNo:'ANA-2',LotNo:'LOT-2',Quantity:5}];
 const storage=[{DeliveryNo:'D1',WhId:2,FromLocationCode:'RCV',AnaNo:'ANA-2',LotNo:'LOT-2',Quantity:3,MovedAt:new Date(7000)}];
 const rows=replay([{whid:1,LocationCode:'A',Quantity:15},{whid:2,LocationCode:'RCV',Quantity:2},{whid:2,LocationCode:'A',Quantity:3}],events,receipts,[],[],[],allocations,storage);
 assert.deepEqual(rows.map(x=>[x.whid,x.LocationCode,x.AnaNo,x.LotNo,x.Quantity]),[[1,'A','ANA-1','LOT-1',10],[1,'A','ANA-2','LOT-2',5],[2,'RCV','ANA-2','LOT-2',2],[2,'A','ANA-2','LOT-2',3]]);
});
test('cancelling a prepared transfer restores the exact allocated ANA/LOT quantities',()=>{
 const events=[e(1,'RECEIVE',1,'A',10,'R1'),e(2,'RECEIVE',1,'A',10,'R2'),e(3,'SHIP_PREP',1,'A',-5,'D1',3),e(4,'SHIP_PREP',1,'OUT',5,'D1',3),e(5,'SHIP_CANCEL',1,'OUT',-5,'D1',5),e(6,'SHIP_CANCEL',1,'A',5,'D1',5)];
 const receipts=[{whid:1,ReceiveNo:'R1',LocationCode:'A',Quantity:10,AnaNo:'ANA-1',LotNo:'LOT-1'},{whid:1,ReceiveNo:'R2',LocationCode:'A',Quantity:10,AnaNo:'ANA-2',LotNo:'LOT-2'}];
 const allocations=[{DeliveryNo:'D1',WhId:1,LocationCode:'A',AnaNo:'ANA-2',LotNo:'LOT-2',Quantity:5}];
 const rows=replay([{whid:1,LocationCode:'A',Quantity:20}],events,receipts,[],[],[],allocations);
 assert.deepEqual(rows.map(x=>[x.AnaNo,x.LotNo,x.Quantity]),[['ANA-1','LOT-1',10],['ANA-2','LOT-2',10]]);
});
test('latest correction at the same movement version wins and supports splitting lots',()=>{
 const adjustments=[{AdjustmentId:1,ThroughTransId:1,WhId:1,LocationCode:'A',RowsJson:JSON.stringify([{LotNo:'old',Quantity:10}])},{AdjustmentId:2,ThroughTransId:1,WhId:1,LocationCode:'A',RowsJson:JSON.stringify([{AnaNo:'a',LotNo:'one',Quantity:3},{LotNo:'two',Quantity:7}])}];
 const rows=replay([{whid:1,LocationCode:'A',Quantity:10}],[e(1,'ADJUST',1,'A',10,'COUNT')],[],[],adjustments);assert.deepEqual(rows.map(r=>[r.LotNo,r.Quantity]),[['one',3],['two',7]]);
});
test('packaging Version remains attached to a receipt LOT through an exact transfer',()=>{
 const events=[e(1,'RECEIVE',1,'A',10,'R1'),e(2,'RECEIVE',1,'A',10,'R2'),e(3,'SHIP_PREP',1,'A',-4,'D',4),e(4,'SHIP_PREP',1,'OUT',4,'D',4),e(5,'LOAD',1,'OUT',-4,'D'),e(6,'SHIP_RECEIVE',2,'RCV',4,'D')];
 const receipts=[{whid:1,ReceiveNo:'R1',LocationCode:'A',Quantity:10,AnaNo:'ANA',LotNo:'OLD',PackVersionId:1},{whid:1,ReceiveNo:'R2',LocationCode:'A',Quantity:10,AnaNo:'ANA',LotNo:'NEW',PackVersionId:2}];
 const allocations=[{DeliveryNo:'D',WhId:1,LocationCode:'A',AnaNo:'ANA',LotNo:'NEW',Quantity:4}];
 const rows=replay([{whid:1,LocationCode:'A',Quantity:16},{whid:2,LocationCode:'RCV',Quantity:4}],events,receipts,[],[],[],allocations);
 assert.deepEqual(rows.map(x=>[x.whid,x.LotNo,x.PackVersionId,x.Quantity]),[[1,'OLD',1,10],[1,'NEW',2,6],[2,'NEW',2,4]]);
});
test('package adjustment changes only its selected Versioned LOT in replay',()=>{
 const events=[{...e(1,'RECEIVE',1,'A',10,'R1'),PackVersionId:7},{...e(2,'ADJUST',1,'A',-2,'ADJ1',2),PackVersionId:7,AdjustmentAnaNo:'ANA',AdjustmentLotNo:'LOT-A'},{...e(3,'ADJUST',1,'A',3,'ADJ2',3),PackVersionId:7,AdjustmentAnaNo:'ANA',AdjustmentLotNo:'LOT-A'}];
 const rows=replay([{whid:1,LocationCode:'A',Quantity:11}],events,[{whid:1,ReceiveNo:'R1',LocationCode:'A',Quantity:10,AnaNo:'ANA',LotNo:'LOT-A',PackVersionId:7}],[]);
 assert.deepEqual(rows.map(x=>[x.AnaNo,x.LotNo,x.PackVersionId,x.Quantity]),[['ANA','LOT-A',7,11]]);
});
test('lot adjustment validation rejects invalid quantities, duplicate lots and missing reasons',()=>{
 const {validate}=require('../src/services/stock-lot-adjustment');const b={productId:1,whid:1,locationCode:'A',throughTransId:0,version:0,reason:'ตรวจเอกสาร',rows:[{AnaNo:'ANA',LotNo:'LOT',Quantity:'10.25'}]};assert.equal(validate(b).cents,1025);
 for(const invalid of [{...b,reason:''},{...b,rows:[{Quantity:-1}]},{...b,rows:[{Quantity:'1.001'}]},{...b,rows:[b.rows[0],b.rows[0]]},{...b,productId:0}])assert.throws(()=>validate(invalid),e=>e.status===400);
});
