// Applies the idempotent schema-only migration to the configured SQL Server.
const path=require('path'),fs=require('fs');
require('dotenv').config({path:path.join(__dirname,'..','.env'),quiet:true});
const {poolPromise}=require('../src/config/db');
(async()=>{const pool=await poolPromise;try{const script=fs.readFileSync(path.join(__dirname,'..','mssql','InboundMultiAnaLot.sql'),'utf8');for(const batch of script.split(/^\s*GO\s*$/mi).filter(s=>s.trim())){const result=await pool.request().batch(batch);if(result.recordset)console.log(result.recordset);}console.log('Inbound ANA/LOT migration completed.');}finally{await pool.close();}})().catch(e=>{console.error(e.message);process.exitCode=1});
