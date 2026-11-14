const fs=require('fs'),path=require('path');
require('dotenv').config({path:path.join(__dirname,'..','.env'),quiet:true});
const {poolPromise}=require('../src/config/db');
(async()=>{const pool=await poolPromise;try{await pool.request().batch(fs.readFileSync(path.join(__dirname,'..','mssql','ProductPalletVersions.sql'),'utf8'));console.log('Installed product pallet versions. Existing products, packing versions and stock unchanged.');}finally{await pool.close();}})().catch(e=>{console.error(e.message);process.exitCode=1;});
