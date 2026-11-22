'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const policy=require('../src/services/product-pack-version-policy');

test('packaging versions are explicitly controlled, not selected by dates',()=>{
 const source=fs.readFileSync('public/js/product-pack-versions.js','utf8');
 assert.match(source,/สถานะ Version ไม่อิงวันที่/);
 assert.match(source,/toggleProductPackVersion/);
 assert.match(source,/packVersionInlineRow/);
 assert.doesNotMatch(source,/nextPackEffectiveDate/);
 assert.doesNotMatch(source,/latestDate/);
});

test('same-day versions are allowed by schema and version numbers remain unique per product',()=>{
 const schema=fs.readFileSync('mssql/ProductPackVersions.sql','utf8');
 assert.match(schema,/UNIQUE\(ProductId,VersionNo\)/);
 assert.doesNotMatch(schema,/UNIQUE\(ProductId,EffectiveFrom\)/);
 const migration=fs.readFileSync('mssql/ProductPackVersionLotBinding.sql','utf8');
 assert.match(migration,/DROP CONSTRAINT/);
 assert.match(migration,/PackVersionId/);
 assert.match(migration,/LegacyUsageUnknown bit NOT NULL/);
});

test('new unused versions remain editable even when product has legacy document history',()=>{
 const route=fs.readFileSync('src/routes/products.js','utf8');
 const edit=fs.readFileSync('src/services/product-pack-edit.js','utf8');
 assert.match(route,/LegacyUsageUnknown\) OUTPUT inserted\.PackVersionId SELECT[\s\S]*?,0,0 FROM dbo\.tblProductPackVersions/);
 assert.match(route,/v\.LegacyUsageUnknown=1 AND[\s\S]*InboundLines/);
 assert.match(route,/CASE WHEN EXISTS\(SELECT 1 FROM dbo\.tblProductPalletVersions/);
 assert.doesNotMatch(route,/CASE WHEN v\.IsActive=1 OR EXISTS/);
 assert.match(route,/ir\.PackVersionId=v\.PackVersionId/);
 assert.match(route,/st\.PackVersionId=v\.PackVersionId/);
 assert.match(edit,/LegacyUsageUnknown FROM dbo\.tblProductPackVersions/);
 assert.match(edit,/InboundReceipts WITH\(HOLDLOCK\) WHERE PackVersionId=@V/);
 assert.match(edit,/tblStockTransactions WITH\(HOLDLOCK\) WHERE PackVersionId=@V/);
});

test('active unused versions are edited in one save and close automatically; referenced versions keep history',()=>{
 const ui=fs.readFileSync('public/js/product-pack-versions.js','utf8');
 assert.match(ui,/async function editProductPackVersion/);
 assert.match(ui,/แก้ไขอัตราบรรจุ/);
 assert.match(ui,/if\(version\.CanEdit\)\{openProductPackVersionForm\(version\.PackVersionId\);return;\}/);
 assert.match(ui,/เมื่อบันทึก รุ่น V'\+editing\.VersionNo\+' จะปิดใช้งานและต้องทดสอบคำนวณใหม่/);
 assert.match(ui,/คัดลอกแล้วแก้ไข/);
 assert.match(ui,/actions\+=ctx\.usage\?\.DeleteAuditReady\?/);
 const edit=fs.readFileSync('src/services/product-pack-edit.js','utf8');
 assert.match(edit,/if\(old\.IsActive\)\{/);
 assert.match(edit,/ProductPackStatusAudit\(PackVersionId,OldIsActive,NewIsActive,Reason,Actor\) VALUES\(@V,1,0,@Reason,@Actor\)/);
 assert.match(edit,/ปิดรุ่นเพื่อแก้ไขอัตราบรรจุ/);
});

test('unused closed versions can be deleted even when legacy product documents cannot be mapped to a version',()=>{
 const route=fs.readFileSync('src/routes/products.js','utf8');
 const read=route.slice(route.indexOf("router.get('/:id/pack-versions'"),route.indexOf('const savePackVersion='));
 assert.match(read,/NOT EXISTS\(SELECT 1 FROM dbo\.tblProductPalletVersions pv WHERE pv\.PackVersionId=v\.PackVersionId\) AND NOT EXISTS\(SELECT 1 FROM dbWMS\.dbo\.InboundReceipts ir WHERE ir\.PackVersionId=v\.PackVersionId\) AND NOT EXISTS\(SELECT 1 FROM dbWMS\.dbo\.tblStockTransactions st WHERE st\.PackVersionId=v\.PackVersionId\) THEN 1 ELSE 0 END AS bit\) CanDelete/);
 const remove=route.slice(route.indexOf("router.delete('/:id/pack-versions/"),route.indexOf("router.patch('/:id/pack-versions/"));
 const guard=remove.slice(remove.indexOf('const used='),remove.indexOf('const snapshot='));
 assert.match(guard,/tblProductPalletVersions[\s\S]*InboundReceipts[\s\S]*tblStockTransactions/);
 assert.doesNotMatch(guard,/LegacyUsageUnknown|InboundLines|DeliveryLines/);
 assert.match(remove,/ProductPackVersionDeleteAudit/);
 assert.match(remove,/IsDeleted=1,IsActive=0/);
 assert.match(remove,/archived:Boolean\(used\.Used\)/);
 assert.match(remove,/ProductPackStatusAudit\(PackVersionId,OldIsActive,NewIsActive,Reason,Actor\) VALUES\(@V,1,0,@Reason,@Actor\)/);
 assert.match(read,/WHERE v\.ProductId=@I AND v\.IsDeleted=0/);
 assert.match(fs.readFileSync('mssql/ProductPackVersionLotBinding.sql','utf8'),/IsDeleted bit NOT NULL/);
 const ui=fs.readFileSync('public/js/product-pack-versions.js','utf8');
 assert.match(ui,/นำออกจากตัวเลือกใช้งานทันที/);
});

test('discrete PCS packaging hierarchy rejects non-integer child counts',()=>{
 assert.equal(policy.assertPackagingHierarchy('PCS',60,'ซอง',1),undefined);
 assert.equal(policy.assertPackagingHierarchy('PCS',10,null,null),undefined);
 assert.equal(policy.assertPackagingHierarchy('KG',10,'ถุง',3),undefined);
 assert.throws(()=>policy.assertPackagingHierarchy('PCS',10,'กล่อง',6),error=>error.status===400&&/จำนวนเต็ม/.test(error.message));
});

test('packaging version cannot rename or replace the stock base unit',()=>{
 assert.equal(policy.assertStockUnitLabel('PCS','PCS'),undefined);
 assert.throws(()=>policy.assertStockUnitLabel('PCS','PCS/ซอง'),error=>error.status===400&&/ต้องตรงกับหน่วยสินค้า PCS/.test(error.message));
});

test('conversion tests show base, inner, pack and outer quantities without rounding',()=>{
 const version={PackUnit:'กล่อง',UnitsPerPack:6,InnerPackUnit:'ซอง',UnitsPerInnerPack:1,OuterPackUnit:'ลัง',PacksPerOuter:10,StockUnitLabel:'PCS'};
 assert.equal(policy.testPackagingVersion(version,'PCS').examples[3].baseQuantity,60);
 assert.deepEqual(policy.calculateBaseQuantity(2,'ลัง',version,'PCS'),{inputQuantity:2,inputUnit:'ลัง',unitsPerInput:60,baseQuantity:120,calculation:'1 ลัง = 60 PCS; 2 × 60 = 120 PCS'});
 assert.equal(policy.calculateBaseQuantity(3,'ซอง',version,'PCS').baseQuantity,3);
 assert.equal(policy.calculateBaseQuantity(1.25,'KG',{PackUnit:'ถุง',UnitsPerPack:25},'KG').baseQuantity,1.25);
 assert.throws(()=>policy.calculateBaseQuantity(1,'แพ็ค',version,'PCS'),error=>error.status===400);
});

test('test rejects incomplete outer packaging configuration',()=>{
 assert.throws(()=>policy.testPackagingVersion({PackUnit:'กล่อง',UnitsPerPack:6,OuterPackUnit:'ลัง',PacksPerOuter:null},'PCS'),error=>error.status===400&&/ชั้นนอก/.test(error.message));
});

test('opening a Version requires a passed test for the exact current packaging ratios',()=>{
 const source=fs.readFileSync('src/routes/products.js','utf8');
 const edit=fs.readFileSync('src/services/product-pack-edit.js','utf8');
 const ui=fs.readFileSync('public/js/product-pack-versions.js','utf8');
 const version={StockUnitId:1,StockUnitLabel:'PCS',PackUnit:'กล่อง',UnitsPerPack:6,InnerPackUnit:'ซอง',UnitsPerInnerPack:1,OuterPackUnit:'ลัง',PacksPerOuter:10};
 version.PackTestFingerprint=policy.fingerprintPackagingVersion(version,'PCS');version.PackTestPassedAt=new Date();
 assert.equal(policy.assertPassedTest(version,'PCS'),version.PackTestFingerprint);
 assert.throws(()=>policy.assertPassedTest({...version,UnitsPerPack:12},'PCS'),error=>error.status===409&&/ทดสอบคำนวณ/.test(error.message));
 assert.match(source,/assertPassedTest\(row,row\.UnitCode\)/);
 assert.match(source,/PackTestFingerprint=@Fingerprint/);
 assert.match(source,/PackTestFingerprint=CASE WHEN @A=0 THEN NULL/);
 assert.match(edit,/if\(old\.IsActive\)\{/);
 assert.match(edit,/PackTestFingerprint=NULL,PackTestPassedAt=NULL/);
 assert.match(ui,/เมื่อบันทึก รุ่น V'\+editing\.VersionNo\+' จะปิดใช้งานและต้องทดสอบคำนวณใหม่/);
 assert.match(ui,/ทดสอบคำนวณ/);
 assert.match(ui,/current\.PackTestPassed\?'':'disabled/);
 const failedTest=ui.match(/async function testProductPackVersion[^\n]*/)?.[0]||'';
 assert.match(failedTest,/แก้ไขรุ่นนี้/);
 assert.match(failedTest,/คัดลอกเพื่อแก้ไข/);
 assert.match(failedTest,/openProductPackVersionForm\(null,version\.PackVersionId\)/);
 assert.doesNotMatch(failedTest,/toggleProductPackVersion/);
 assert.match(ui,/openProductPackVersionForm\(null,version\.PackVersionId\)/);
 assert.match(ui,/sourceVersion\?'สร้าง Version ใหม่จาก V/);
});

test('inbound only offers packaging versions that passed calculation for the current product stock unit',()=>{
 const inbound=fs.readFileSync('src/routes/inbound.js','utf8');
 const ui=fs.readFileSync('public/js/product-pack-versions.js','utf8');
 assert.match(inbound,/PackVersionBlocked:candidates\.length>0&&PackVersions\.length===0/);
 assert.match(inbound,/Number\(version\.StockUnitId\)!==Number\(row\.ProductUnitId\)/);
 assert.match(inbound,/versionPolicy\.assertPassedTest\(version,version\.ProductUnitCode\)/);
 assert.match(inbound,/activePackVersions\.filter\(version=>\{try\{if\(Number\(version\.StockUnitId\)!==Number\(version\.ProductUnitId\)\)return false/);
 assert.match(inbound,/Version ที่เปิดอยู่ยังไม่ผ่านการทดสอบคำนวณ จึงรับเข้า LOT ไม่ได้/);
 assert.match(ui,/เปิดอยู่ · รอทดสอบ/);
 assert.match(ui,/รุ่นที่ยังไม่ผ่านจะไม่แสดงให้เลือกตอนรับเข้า/);
 assert.match(ui,/อัตรา 1 .* หารด้วย 1 .* ไม่ลงตัว/);
 assert.match(ui,/input:'textarea'/);
 assert.match(ui,/เหตุผล \* \(จำเป็นสำหรับบันทึกประวัติ\)/);
 assert.doesNotMatch(ui,/confirm\.disabled=!field\.value\.trim\(\)/);
 assert.match(ui,/เหตุผลจำเป็น หากเว้นว่างระบบจะแจ้งให้กรอกก่อนทำรายการ/);
 assert.match(ui,/เหตุผลจำเป็น หากเว้นว่างระบบจะแจ้งให้กรอกก่อนลบ/);
 assert.match(ui,/target:packDialogTarget()/);
 assert.match(ui,/requestAnimationFrame\(\(\)=>field\.focus\(\)\)/);
 assert.match(ui,/inputValidator:value=>String\(value\|\|''\)\.trim\(\)\?undefined:'กรอกเหตุผลในช่องนี้ก่อนยืนยัน'/);
 assert.match(fs.readFileSync('src/routes/products.js','utf8'),/ฐานข้อมูลยังไม่มีโครงสร้างควบคุม Version กรุณาติดตั้ง mssql\/ProductPackVersionLotBinding\.sql/);
});
