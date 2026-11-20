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
test('latest correction at the same movement version wins and supports splitting lots',()=>{
 const adjustments=[{AdjustmentId:1,ThroughTransId:1,WhId:1,LocationCode:'A',RowsJson:JSON.stringify([{LotNo:'old',Quantity:10}])},{AdjustmentId:2,ThroughTransId:1,WhId:1,LocationCode:'A',RowsJson:JSON.stringify([{AnaNo:'a',LotNo:'one',Quantity:3},{LotNo:'two',Quantity:7}])}];
 const rows=replay([{whid:1,LocationCode:'A',Quantity:10}],[e(1,'ADJUST',1,'A',10,'COUNT')],[],[],adjustments);assert.deepEqual(rows.map(r=>[r.LotNo,r.Quantity]),[['one',3],['two',7]]);
});
test('lot adjustment validation rejects invalid quantities, duplicate lots and missing reasons',()=>{
 const {validate}=require('../src/services/stock-lot-adjustment');const b={productId:1,whid:1,locationCode:'A',throughTransId:0,version:0,reason:'ตรวจเอกสาร',rows:[{AnaNo:'ANA',LotNo:'LOT',Quantity:'10.25'}]};assert.equal(validate(b).cents,1025);
 for(const invalid of [{...b,reason:''},{...b,rows:[{Quantity:-1}]},{...b,rows:[{Quantity:'1.001'}]},{...b,rows:[b.rows[0],b.rows[0]]},{...b,productId:0}])assert.throws(()=>validate(invalid),e=>e.status===400);
});
