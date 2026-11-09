// Run from repository root: node scripts/import-product-source-master.js
const fs=require('fs'),path=require('path');require('dotenv').config({path:path.join(__dirname,'../.env')});
const {sql,poolPromise}=require('../src/config/db');
async function run(){const pool=await poolPromise;let tx;try{
 await pool.request().query(fs.readFileSync(path.join(__dirname,'../mssql/ProductSourceMaster.sql'),'utf8'));
 const data=JSON.parse(fs.readFileSync(path.join(__dirname,'../mssql/data/product-source-master.json'),'utf8'));
 if(data.rows.length!==1636||new Set(data.rows.map(x=>x.sourceRow)).size!==data.rows.length)throw Error('Source row count invalid');
 tx=new sql.Transaction(pool);await tx.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);const q=()=>new sql.Request(tx);
 const prior=(await q().input('H',sql.Char(64),data.sourceHash).query('SELECT ImportId,SourceRowCount FROM dbo.tblProductMasterImports WITH(UPDLOCK,HOLDLOCK) WHERE SourceHash=@H')).recordset[0];
 if(prior){await tx.rollback();tx=null;console.log(JSON.stringify({alreadyImported:true,...prior}));return}
 const id=(await q().input('H',sql.Char(64),data.sourceHash).input('N',sql.NVarChar(255),data.sourceName).input('C',sql.Int,data.rows.length).query('INSERT dbo.tblProductMasterImports(SourceHash,SourceName,SourceRowCount) OUTPUT inserted.ImportId VALUES(@H,@N,@C)')).recordset[0].ImportId;
 const payload=data.rows.map(x=>({...x,code1:x.codes[0],code2:x.codes[1],code3:x.codes[2],code4:x.codes[3],sourceJson:JSON.stringify(x.source)}));
 await q().input('I',sql.Int,id).input('J',sql.NVarChar(sql.MAX),JSON.stringify(payload)).query(`
 INSERT dbo.tblProductMasterEntries(ImportId,SourceRow,CategoryCode,Code1,Code2,Code3,Code4,MainCode,Name1,Name2,DisplayName,PhysicalForm,SourceJson)
 SELECT @I,sourceRow,category,code1,code2,code3,code4,mainCode,name1,name2,displayName,physicalForm,sourceJson
 FROM OPENJSON(@J) WITH(sourceRow int,category varchar(10),code1 nvarchar(500),code2 nvarchar(500),code3 nvarchar(500),code4 nvarchar(500),mainCode nvarchar(500),name1 nvarchar(2000),name2 nvarchar(2000),displayName nvarchar(2000),physicalForm nvarchar(100),sourceJson nvarchar(max));
 -- Only one-to-one source matches may link to operational stock products.
 ;WITH candidates AS(SELECT e.EntryId,p.ProductId,COUNT(*) OVER(PARTITION BY e.EntryId) AS Matches,
 COUNT(*) OVER(PARTITION BY p.ProductId) AS Sources
 FROM dbo.tblProductMasterEntries e JOIN dbo.tblCategories c ON c.CategoryCode=e.CategoryCode
 JOIN dbo.tblProducts p ON p.CategoryId=c.CategoryId AND p.ProductCode=e.MainCode
 WHERE e.ImportId=@I AND NULLIF(e.MainCode,'') IS NOT NULL)
 UPDATE e SET ProductId=c.ProductId FROM dbo.tblProductMasterEntries e JOIN candidates c ON c.EntryId=e.EntryId WHERE c.Matches=1 AND c.Sources=1;
 `);
 const summary=(await q().input('I',sql.Int,id).query('SELECT CategoryCode,COUNT(*) AS Rows,SUM(CASE WHEN ProductId IS NOT NULL THEN 1 ELSE 0 END) AS Linked FROM dbo.tblProductMasterEntries WHERE ImportId=@I GROUP BY CategoryCode')).recordset;
 await tx.commit();tx=null;console.log(JSON.stringify({importId:id,total:data.rows.length,summary}));
 }finally{if(tx)await tx.rollback();await pool.close()}}
run().catch(e=>{console.error(e.message);process.exitCode=1});

