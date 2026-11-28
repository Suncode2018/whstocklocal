'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const {issuePickedQuantity}=require('../src/services/production-issue-pdf');

test('production issue PDF uses only confirmed PICK quantities in the actual-quantity column',()=>{
 assert.equal(issuePickedQuantity({RequiredQuantity:1,PickedQuantity:0}), '');
 assert.equal(issuePickedQuantity({RequiredQuantity:10,PickedQuantity:'2.5'}), Number(2.5).toLocaleString('th-TH',{maximumFractionDigits:6}));
 assert.equal(issuePickedQuantity({RequiredQuantity:10,PickedQuantity:-1}), '');
});
