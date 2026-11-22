const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const context = { window: {}, document: {} };
vm.runInNewContext(
  fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'packing-levels.js'), 'utf8'),
  context,
  { filename: 'packing-levels.js' }
);
const packing = context.window.WmsPacking;

test('pack hierarchy converts loose units, packs and outer cases into base units', () => {
  const pack = { UnitsPerPack: 700, PacksPerOuter: 10, OuterPackUnit: 'ลัง' };
  assert.equal(packing.calculate(pack, 200, 1, 0), 900);
  assert.equal(packing.calculate(pack, 0, 0, 1), 7000);
});

test('pack hierarchy accepts base-unit-only and rejects invalid partial counts', () => {
  const pack = { UnitsPerPack: 700 };
  assert.equal(packing.calculate(pack, 250, 0), 250);
  assert.throws(() => packing.calculate(pack, 700, 0), /เศษต้องน้อยกว่า/);
  assert.throws(() => packing.calculate(pack, 0.5, 0), /จำนวนเต็ม/);
  assert.throws(() => packing.calculate({ UnitsPerPack: 700 }, 0, 0, 1), /จำนวนเต็ม/);
});

test('packing equivalent shows higher levels and any remaining base units', () => {
  const pack = { UnitsPerPack: 700, PacksPerOuter: 10, OuterPackUnit: 'ลัง', PackUnit: 'กล่อง' };
  assert.equal(packing.equivalent(7350, pack, 'PCS'), '1 ลัง + 350 PCS');
});
