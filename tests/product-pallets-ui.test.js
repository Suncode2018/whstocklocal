const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

test('product editor renumbers visible tabs when the RM tab is hidden', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'admin-products.js'), 'utf8');
  const tabs = [
    { hidden: false, dataset: {}, textContent: '1. ข้อมูลสินค้า' },
    { hidden: false, dataset: {}, textContent: '2. รหัสอ้างอิง' },
    { hidden: true, dataset: {}, textContent: '3. หน่วยบรรจุ RM' },
    { hidden: false, dataset: {}, textContent: '4. โครงสร้างบรรจุ' },
    { hidden: false, dataset: {}, textContent: '5. พาเลท' },
    { hidden: false, dataset: {}, textContent: '6. ปริมาตรจัดเก็บ' }
  ];
  const context = { document: { querySelectorAll: () => tabs } };
  vm.runInNewContext(source.slice(source.indexOf('function refreshProductEditorTabNumbers'), source.indexOf('\n', source.indexOf('function refreshProductEditorTabNumbers'))), context);
  context.refreshProductEditorTabNumbers();
  assert.deepEqual(tabs.filter(tab => !tab.hidden).map(tab => tab.textContent), [
    '1. ข้อมูลสินค้า', '2. รหัสอ้างอิง', '3. โครงสร้างบรรจุ', '4. พาเลท', '5. ปริมาตรจัดเก็บ'
  ]);
  tabs[2].hidden = false;
  context.refreshProductEditorTabNumbers();
  assert.equal(tabs[2].textContent, '3. หน่วยบรรจุ RM');
  assert.equal(tabs[3].textContent, '4. โครงสร้างบรรจุ');
});

test('pallet form starts with the agreed organizational pallet dimensions', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'product-pallets.js'), 'utf8');
  const context = { window: {} };
  vm.runInNewContext(source, context, { filename: 'product-pallets.js' });
  assert.equal(context.window.WmsPalletDefaults.width, 100);
  assert.equal(context.window.WmsPalletDefaults.length, 120);
  assert.equal(context.window.WmsPalletDefaults.height, 15);
  assert.match(source, /GS1 ไม่ได้กำหนดขนาดพาเลทนี้/);
  assert.match(source, /Ti × Hi = จำนวนหน่วยบรรจุต่อพาเลท/);
});

test('product master labels packaging levels and distinguishes GTIN coverage', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'product-pack-versions.js'), 'utf8');
  assert.match(source, /โครงสร้างหน่วยบรรจุ/);
  assert.match(source, /ระบบยังไม่ผูก GTIN แยกแต่ละระดับ/);
  assert.match(source, /ไม่ถือเป็นการลงทะเบียน GTIN กับ GS1/);
  assert.match(source, /ANA\/LOT/);
});

test('packaging master flags inconsistent legacy ratios and base unit labels', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'product-pack-versions.js'), 'utf8');
  const context = { window: {}, productHtml: value => String(value) };
  vm.runInNewContext(source, context, { filename: 'product-pack-versions.js' });
  const warnings = context.packVersionWarnings({ StockUnitLabel: 'PCS/ซอง', UnitCode: 'PCS', PackUnit: 'ลัง', UnitsPerPack: 10, InnerPackUnit: 'กล่อง', UnitsPerInnerPack: 6 }, { UnitCode: 'PCS' });
  assert.equal(warnings.length, 2);
  assert.match(warnings.join(' '), /ไม่ตรงกับหน่วยสต๊อก/);
  assert.match(warnings.join(' '), /1 ลัง = 10 PCS หารด้วย 1 กล่อง = 6 PCS ไม่ลงตัว/);
  assert.match(source, /สถานะ Version ไม่อิงวันที่/);
  assert.match(source, /ผูกกับ Lot ตอนรับเข้า/);
});

test('packaging hierarchy contains the complete version management workflow', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'product-pack-versions.js'), 'utf8');
  const context = { window: {}, wmsNavigation: { user: { role: 'ADMIN' } }, productHtml: value => String(value) };
  vm.runInNewContext(source, context, { filename: 'product-pack-versions.js' });
  const html = context.window.WmsPackHierarchyIllustration({
    StockUnitLabel: 'PCS', PackUnit: 'กล่อง', UnitsPerPack: 10, OuterPackUnit: 'ลัง', PacksPerOuter: 6, CanEdit: true
  }, { product: { UnitCode: 'PCS' } });
  assert.equal((html.match(/class="pack-flow-step/g) || []).length, 4);
  assert.doesNotMatch(html, /หน่วยย่อย \/ ซอง/);
  assert.match(html, /ภาพแสดงโครงสร้างของ Version ที่เลือก/);
  assert.doesNotMatch(html, /openPackHierarchyLevel\('inner'\)/);
  assert.match(html, /1 กล่อง = 10 PCS/);
  assert.match(html, /1 ลัง = 6 กล่อง/);
  const configured = context.window.WmsPackHierarchyIllustration({StockUnitLabel:'PCS',PackUnit:'กล่อง',UnitsPerPack:6,InnerPackUnit:'ซอง',UnitsPerInnerPack:1,OuterPackUnit:'ลัง',PacksPerOuter:10},{product:{UnitCode:'PCS'}});
  assert.match(configured, /หน่วยย่อย \/ ซอง/);
  assert.match(configured, /1 ซอง = 1 PCS/);
  assert.match(html, /ตั้ง Ti × Hi/);
  assert.equal((html.match(/<svg/g) || []).length, 4);
  assert.equal((html.match(/class="pack-flow-arrow"/g) || []).length, 3);
  const locked = context.window.WmsPackHierarchyIllustration({StockUnitLabel:'PCS',PackUnit:'กล่อง',UnitsPerPack:6,OuterPackUnit:'ลัง',PacksPerOuter:10,CanEdit:false},{product:{UnitCode:'PCS'}});
  assert.doesNotMatch(locked, /กำหนดในรุ่นใหม่|แก้ไขชั้นแรก|กำหนดพาเลท/);
  assert.match(locked, /ใช้ปุ่มจัดการในกรอบนี้/);
  assert.doesNotMatch(html, /class="btn btn-sm btn-outline-primary pack-flow-action/);
  const withInner = context.window.WmsPackHierarchyIllustration({
    StockUnitLabel: 'PCS', InnerPackUnit: 'ถุง', UnitsPerInnerPack: 1, PackUnit: 'ลัง', UnitsPerPack: 700
  }, { product: { UnitCode: 'PCS' } });
  assert.match(withInner, /1 ถุง = 1 PCS/);
  assert.match(withInner, /700 ถุง ต่อ ลัง/);
  assert.match(withInner, /700 PCS/);
  const emptyHierarchy = context.window.WmsPackHierarchyIllustration(null, { product: { UnitCode: 'KG' } });
  assert.match(emptyHierarchy, /กล่อง \/ แพ็ก \/ หน่วยบรรจุ/);
  assert.match(source, /id="packInnerName"/);
  assert.match(source, /id="packUnitsPerInner"/);
  assert.match(source, /หน่วยย่อยเป็นตัวเลือก/);
  assert.match(source, /innerPackUnit:document\.getElementById\('packInnerName'\)/);
  assert.match(source, /packHierarchyVersion/);
  assert.match(source, /packHierarchyFormMount/);
  assert.match(source, /onclick="saveProductPackVersion\(\)"/);
  assert.match(source, /onclick="testProductPackVersion\('\+current\.PackVersionId\+'\)"/);
  assert.match(source, /onclick="toggleProductPackVersion\('\+current\.PackVersionId\+',true\)"/);
  assert.match(source, /onclick="deleteProductPackVersion\('\+current\.PackVersionId\+'\)"/);
  assert.match(source, /ดู \/ จัดการ/);
  assert.match(source, /บันทึก Version/);
});

test('version create, read, update, delete, test, open and close controls are explicit', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'product-pack-versions.js'), 'utf8');
  assert.match(source, /onclick="openProductPackVersionForm\(\)"/);
  assert.match(source, /editProductPackVersion\('\+current\.PackVersionId\+'\)/);
  assert.match(source, /แก้ไขอัตราบรรจุ/);
  assert.match(source, /ลบ Version/);
  assert.match(source, /async function deleteProductPackVersion/);
  assert.match(source, /ctx\.usage\?\.DeleteAuditReady/);
  assert.match(source, /เปิดลบ Version ได้หลังติดตั้ง/);
  assert.match(source, /selectPackPreviewVersion\(this\.value\)/);
  assert.match(source, /ปิดใช้งาน/);
  assert.match(source, /เปิดใช้งาน/);
  assert.match(source, /testProductPackVersion\('\+current\.PackVersionId\+'\)/);
  assert.doesNotMatch(source,/testProductPackVersion\('\+v\.PackVersionId\+'\)/);
  assert.match(source,/ปิดใช้/);
  assert.match(source,/onclick="deleteProductPackVersion\('\+v\.PackVersionId\+'\)"/);
  const api = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'products.js'), 'utf8');
  assert.doesNotMatch(api,/CAST\(CASE WHEN v\.IsActive=0 AND NOT EXISTS\(SELECT 1 FROM dbo\.tblProductPalletVersions pv WHERE pv\.PackVersionId=v\.PackVersionId\)/);
  assert.match(api, /router\.delete\('\/:id\/pack-versions\/:versionId'/);
  assert.match(api, /if\(row\.IsActive\)\{await q\(\)\.input\('V',sql\.Int,versionId\)\.query\('UPDATE dbo\.tblProductPackVersions SET IsActive=0/);
  assert.match(api, /IsDeleted=1,IsActive=0/);
  assert.match(api, /JSON_QUERY\(\(SELECT \* FROM dbo\.ProductPackStatusAudit WHERE PackVersionId=@V FOR JSON PATH\)\) StatusHistory/);
  assert.match(api, /DELETE dbo\.ProductPackStatusAudit WHERE PackVersionId=@V; DELETE dbo\.ProductPackEditAudit WHERE PackVersionId=@V/);
  assert.doesNotMatch(api, /NOT EXISTS\(SELECT 1 FROM dbo\.ProductPackStatusAudit sa WHERE sa\.PackVersionId=v\.PackVersionId\)/);
  assert.match(api, /INSERT dbo\.ProductPackVersionDeleteAudit/);
  assert.match(api, /DeleteAuditReady/);
  assert.match(fs.readFileSync(path.join(__dirname, '..', 'mssql', 'ProductPackVersionLotBinding.sql'), 'utf8'), /ProductPackVersionDeleteAudit/);
});

test('pallet illustration renders top and side views without implying a verified layout', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'product-pallets.js'), 'utf8');
  const context = { window: {}, productHtml: value => String(value) };
  vm.runInNewContext(source, context, { filename: 'product-pallets.js' });
  const html = context.window.WmsPalletIllustration(8, 3, 'ลัง');
  assert.match(html, /มองจากด้านบน · 8 ลัง\/ชั้น/);
  assert.match(html, /มองด้านข้าง · 3 ชั้น/);
  assert.equal((html.match(/<svg/g) || []).length, 2);
  assert.match(html, /aria-label="ภาพจำลองพาเลท 3 ชั้น"/);
  assert.match(source, /ภาพจำลองเพื่อสื่อจำนวน ไม่ใช่ผังเรียงหรือการคำนวณความพอดีจริง/);
});
