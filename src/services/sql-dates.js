'use strict';
// SQL datetime/datetime2 values in this application are Bangkok wall-clock time.
// Keep driver useUTC=true for SQL DATE and parameter compatibility. Normalize
// timestamp results once, before API serialization or CSV formatting.
const BANGKOK_OFFSET_MS = 7 * 60 * 60 * 1000;
function today(now = new Date()) {
 return new Intl.DateTimeFormat('sv-SE', {timeZone:'Asia/Bangkok',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);
}
function normalize(result, sql, command = '') {
 const utcPallet = /\btblProductPalletVersions\b/i.test(command);
 const utcImport = /\btblProductMaster(?:Entries|Imports)\b/i.test(command);
 const seen = new WeakSet();
 for (const rows of result?.recordsets || (result?.recordset ? [result.recordset] : [])) {
  if(seen.has(rows)) continue; seen.add(rows);
  for (const [name, column] of Object.entries(rows.columns || {})) {
   if (![sql.DateTime, sql.DateTime2, sql.SmallDateTime].includes(column.type)) continue;
   if ((utcPallet && /^(CreatedAt|UpdatedAt)$/i.test(name)) ||
       (utcImport && /^(ImportedAt|UpdatedAt)$/i.test(name)) ||
       (/\bProductResetAudit\b/i.test(command) && /^ExecutedAt$/i.test(name))) continue;
   for (const row of rows) if(row[name] instanceof Date)
    row[name] = new Date(row[name].getTime() - BANGKOK_OFFSET_MS);
  }
 }
 return result;
}
function install(sql) {
 const original=sql.Request.prototype.query;
 if(original.wmsDateNormalized) return;
 function query(command, callback) {
  if(typeof callback==='function') return original.call(this,command,(err,result)=>callback(err,err?result:normalize(result,sql,command)));
  const result=original.call(this,command);
  return result && typeof result.then==='function' ? result.then(r=>normalize(r,sql,command)) : result;
 }
 query.wmsDateNormalized=true;
 sql.Request.prototype.query=query;
}
module.exports={today,normalize,install};
