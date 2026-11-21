const test=require('node:test'),assert=require('node:assert/strict');
const {validateAllocations}=require('../src/services/warehouse-transfer-lots');

test('transfer lot allocation must cover the line total without combining known and unknown origins',()=>{
 assert.equal(validateAllocations([
  {AnaNo:'A1',LotNo:'L1',FifoDate:'2026-11-20T00:00:00.000Z',Quantity:'6',IsUnattributed:false},
  {AnaNo:null,LotNo:null,FifoDate:null,Quantity:'4',IsUnattributed:true}
 ],10),true);
});

test('transfer lot allocation rejects total mismatch, fake unknown, duplicate and invalid quantity',()=>{
 const lot={AnaNo:'A1',LotNo:'L1',FifoDate:null,Quantity:'4',IsUnattributed:false};
 assert.throws(()=>validateAllocations([lot],5),e=>e.status===400);
 assert.throws(()=>validateAllocations([{...lot,AnaNo:null,LotNo:null,IsUnattributed:false}],4),e=>e.status===400);
 assert.throws(()=>validateAllocations([{...lot,IsUnattributed:true}],4),e=>e.status===400);
 assert.throws(()=>validateAllocations([lot,lot],8),e=>e.status===400);
 assert.throws(()=>validateAllocations([{...lot,Quantity:'0'}],0),e=>e.status===400);
});
