'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const {normalizeTemplate}=require('../src/services/production-issue-form-templates');

const sample={formCode:'fr-pd-02',formRevision:'Rev.01',effectiveDate:'2026-11-27',companyName:' บริษัท รวยมั่งคั่ง 69 จำกัด ',documentTitle:' ใบเบิกสินค้าเพื่อผลิต ',isActive:true};

test('normalizes form code and trims saved revision metadata',()=>{
 assert.deepEqual(normalizeTemplate(sample),{FormCode:'FR-PD-02',FormRevision:'Rev.01',EffectiveDate:'2026-11-27',CompanyName:'บริษัท รวยมั่งคั่ง 69 จำกัด',DocumentTitle:'ใบเบิกสินค้าเพื่อผลิต',IsActive:true});
});

test('rejects malformed revisions, impossible dates, and missing metadata',()=>{
 for(const invalid of [
  {...sample,formRevision:'Revision 1'},
  {...sample,effectiveDate:'2026-02-30'},
  {...sample,formCode:'FR/PD/02'},
  {...sample,companyName:' '},
  {...sample,isActive:'true'}
 ])assert.throws(()=>normalizeTemplate(invalid),error=>error.status===400);
});

test('allows a retired revision to remain stored for document history',()=>{
 assert.equal(normalizeTemplate({...sample,isActive:false}).IsActive,false);
});
