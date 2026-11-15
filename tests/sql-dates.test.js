const {test}=require('node:test');
const assert=require('node:assert/strict');
const sql=require('mssql');
const {normalize,today}=require('../src/services/sql-dates');
const display=d=>new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Bangkok',day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false}).format(d);
function result(type,field,value){const rows=[{[field]:new Date(value)}];rows.columns={[field]:{type}};return {recordset:rows,recordsets:[rows]};}
test('SQL local timestamp displays the SQL date and time, including midnight',()=>{
 for(const value of ['2026-11-14T17:14:39Z','2026-11-15T00:04:36Z','2026-11-15T23:59:59Z']){
  const r=normalize(result(sql.DateTime2,'EventAt',value),sql,'SELECT CreatedAt EventAt FROM InboundOrders');
  assert.equal(display(r.recordset[0].EventAt),value.slice(8,10)+'/'+value.slice(5,7)+'/'+value.slice(0,4)+', '+value.slice(11,19));
 }
});
test('SQL DATE stays unchanged',()=>{
 const r=normalize(result(sql.Date,'DocumentDate','2026-11-14T00:00:00Z'),sql);
 assert.equal(r.recordset[0].DocumentDate.toISOString(),'2026-11-14T00:00:00.000Z');
});
test('true UTC pallet/import timestamps stay UTC',()=>{
 for(const [table,field] of [['tblProductPalletVersions','CreatedAt'],['tblProductPalletVersions','UpdatedAt'],['tblProductMasterImports','ImportedAt'],['tblProductMasterEntries','UpdatedAt'],['ProductResetAudit','ExecutedAt']]){
  const r=normalize(result(sql.DateTime2,field,'2026-11-15T01:00:00Z'),sql,'SELECT * FROM '+table);
  assert.equal(r.recordset[0][field].toISOString(),'2026-11-15T01:00:00.000Z');
 }
});
test('Bangkok today changes at Thai midnight, not UTC midnight',()=>{
 assert.equal(today(new Date('2026-11-14T16:59:59Z')),'2026-11-14');
 assert.equal(today(new Date('2026-11-14T17:00:00Z')),'2026-11-15');
});
