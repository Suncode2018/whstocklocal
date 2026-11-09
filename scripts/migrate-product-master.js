const fs=require('fs'),path=require('path'),root=path.resolve(__dirname,'..');require('dotenv').config({path:path.join(root,'.env')});const {sql,poolPromise}=require('../src/config/db');
async function migrate(){const pool=await poolPromise;let tx;try{tx=new sql.Transaction(pool);await tx.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);const q=()=>new sql.Request(tx);
 await q().query(`IF OBJECT_ID('dbo.ProductMasterMigrationBackup_20261108') IS NULL SELECT * INTO dbo.ProductMasterMigrationBackup_20261108 FROM dbo.tblProducts;
 IF COL_LENGTH('dbo.tblProducts','ProductName1') IS NULL ALTER TABLE dbo.tblProducts ADD ProductName1 nvarchar(2000) NULL,ProductName2 nvarchar(2000) NULL,ProID1 nvarchar(500) NULL,ProID2 nvarchar(500) NULL,ProID3 nvarchar(500) NULL,ProID4 nvarchar(500) NULL,PhysicalForm nvarchar(50) NULL,MasterStatus varchar(20) NOT NULL CONSTRAINT DF_tblProducts_MasterStatus DEFAULT 'READY',SourceMasterEntryId int NULL,RowVersion rowversion;
 `);
 await q().query(`DECLARE @drop nvarchar(max)=''; SELECT @drop=@drop+'ALTER TABLE dbo.tblProducts DROP CONSTRAINT '+QUOTENAME(k.name)+';' FROM sys.key_constraints k JOIN sys.index_columns ic ON ic.object_id=k.parent_object_id AND ic.index_id=k.unique_index_id JOIN sys.columns c ON c.object_id=ic.object_id AND c.column_id=ic.column_id WHERE k.parent_object_id=OBJECT_ID('dbo.tblProducts') AND k.type='UQ' AND c.name='ProductCode';EXEC sp_executesql @drop;
 IF EXISTS(SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID('dbo.tblProducts') AND name='IX_tblProducts_Search') DROP INDEX IX_tblProducts_Search ON dbo.tblProducts;
 IF EXISTS(SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID('dbo.tblProducts') AND name='ProductCode' AND is_nullable=0) ALTER TABLE dbo.tblProducts ALTER COLUMN ProductCode nvarchar(50) NULL;
 IF EXISTS(SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID('dbo.tblProducts') AND name='ProductName' AND max_length<4000) ALTER TABLE dbo.tblProducts ALTER COLUMN ProductName nvarchar(2000) NOT NULL;
 IF EXISTS(SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID('dbo.tblProducts') AND name='UnitId' AND is_nullable=0) ALTER TABLE dbo.tblProducts ALTER COLUMN UnitId int NULL;
 IF NOT EXISTS(SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID('dbo.tblProducts') AND name='UX_tblProducts_Code') CREATE UNIQUE INDEX UX_tblProducts_Code ON dbo.tblProducts(ProductCode) WHERE ProductCode IS NOT NULL;
 IF NOT EXISTS(SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID('dbo.tblProducts') AND name='UX_tblProducts_SourceMaster') CREATE UNIQUE INDEX UX_tblProducts_SourceMaster ON dbo.tblProducts(SourceMasterEntryId) WHERE SourceMasterEntryId IS NOT NULL;
 IF NOT EXISTS(SELECT 1 FROM dbo.tblCategories WHERE CategoryCode='BULK') INSERT dbo.tblCategories(CategoryCode,CategoryName) VALUES('BULK','Bulk Product');`);
 await q().query(`UPDATE dbo.tblProducts SET MasterStatus='INACTIVE' WHERE IsActive=0 AND MasterStatus='READY';
 UPDATE p SET ProductName1=e.Name1,ProductName2=e.Name2,ProductName=CASE WHEN NULLIF(e.DisplayName,'') IS NULL THEN p.ProductName ELSE e.DisplayName END,ProID1=e.Code1,ProID2=e.Code2,ProID3=e.Code3,ProID4=e.Code4,PhysicalForm=NULLIF(e.PhysicalForm,''),SourceMasterEntryId=e.EntryId
 FROM dbo.tblProducts p JOIN dbo.tblProductMasterEntries e ON e.ProductId=p.ProductId
 WHERE e.ImportId=(SELECT MAX(ImportId) FROM dbo.tblProductMasterImports) AND p.SourceMasterEntryId IS NULL;
 ;WITH source AS(SELECT e.*,COUNT(*) OVER(PARTITION BY e.MainCode) AS CodeCount FROM dbo.tblProductMasterEntries e WHERE e.ImportId=(SELECT MAX(ImportId) FROM dbo.tblProductMasterImports))
 INSERT dbo.tblProducts(ProductCode,ProductName,ProductName1,ProductName2,ProID1,ProID2,ProID3,ProID4,PhysicalForm,CategoryId,UnitId,IsActive,MasterStatus,SourceMasterEntryId,MinStock,MaxStock,StandardCost,CreatedAt,UpdatedAt)
 SELECT CASE WHEN e.CodeCount=1 AND LEN(e.MainCode)<=50 AND e.MainCode NOT LIKE '%[^A-Za-z0-9_-]%' AND NULLIF(e.MainCode,'') IS NOT NULL AND NOT EXISTS(SELECT 1 FROM dbo.tblProducts x WHERE x.ProductCode=e.MainCode) THEN e.MainCode ELSE NULL END,
 COALESCE(NULLIF(e.DisplayName,''),NULLIF(e.Name1,''),NULLIF(e.Name2,''),N'ยังไม่ระบุชื่อ'),e.Name1,e.Name2,e.Code1,e.Code2,e.Code3,e.Code4,NULLIF(e.PhysicalForm,''),c.CategoryId,NULL,0,'DRAFT',e.EntryId,0,0,0,SYSUTCDATETIME(),SYSUTCDATETIME()
 FROM source e JOIN dbo.tblCategories c ON c.CategoryCode=e.CategoryCode WHERE NOT EXISTS(SELECT 1 FROM dbo.tblProducts p WHERE p.SourceMasterEntryId=e.EntryId);
 UPDATE e SET ProductId=p.ProductId FROM dbo.tblProductMasterEntries e JOIN dbo.tblProducts p ON p.SourceMasterEntryId=e.EntryId;
 IF NOT EXISTS(SELECT 1 FROM sys.check_constraints WHERE name='CK_tblProducts_MasterReady') ALTER TABLE dbo.tblProducts WITH CHECK ADD CONSTRAINT CK_tblProducts_MasterReady CHECK(MasterStatus IN('DRAFT','READY','INACTIVE') AND (IsActive=0 OR MasterStatus='READY') AND (MasterStatus<>'READY' OR (NULLIF(LTRIM(RTRIM(ProductCode)),'') IS NOT NULL AND NULLIF(LTRIM(RTRIM(ProductName)),'') IS NOT NULL AND UnitId IS NOT NULL)));
 `);
 const results=(await q().query(`SELECT MasterStatus,COUNT(*) RowsCount FROM dbo.tblProducts GROUP BY MasterStatus; SELECT COUNT(*) SourceRows,COUNT(DISTINCT ProductId) LinkedProducts FROM dbo.tblProductMasterEntries; SELECT COUNT(*) PreservedOriginalIds FROM dbo.ProductMasterMigrationBackup_20261108 b JOIN dbo.tblProducts p ON p.ProductId=b.ProductId;`)).recordsets;
 await tx.commit();tx=null;console.log(JSON.stringify(results));}finally{if(tx)try{await tx.rollback()}catch{};await pool.close()}}
migrate().catch(e=>{console.error(e.message);process.exitCode=1});
