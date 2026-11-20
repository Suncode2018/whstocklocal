const test = require('node:test');
const assert = require('node:assert/strict');
const { availableFGLots, allocateFGLots, allocateFGBatch, canonicalLotLines } = require('../src/services/picking-fifo');
const { actionForRequest } = require('../src/config/menu-actions');

const receivedAt = day => new Date(`2026-01-${String(day).padStart(2, '0')}T00:00:00.000Z`);

test('FG FIFO assigns oldest attributed lots first and leaves unknown provenance last', () => {
  const rows = [
    { LotNo: 'NEW', Quantity: 100, ReceivedAt: receivedAt(2) },
    { LotNo: 'UNKNOWN', Quantity: 50, Unattributed: true },
    { LotNo: 'OLD', Quantity: 100, ReceivedAt: receivedAt(1) }
  ];
  assert.deepEqual(allocateFGLots(availableFGLots(rows, 0), 150).map(x => [x.LotNo, x.Quantity]), [['OLD', 100], ['NEW', 50]]);
});

test('reservations reduce oldest lots before calculating what can be picked', () => {
  const lots = availableFGLots([
    { LotNo: 'OLD', Quantity: 100, ReceivedAt: receivedAt(1) },
    { LotNo: 'NEW', Quantity: 100, ReceivedAt: receivedAt(2) }
  ], 80);
  assert.deepEqual(lots.map(x => [x.LotNo, x.ReservedQuantity, x.AvailableQuantity]), [['OLD', 80, 20], ['NEW', 0, 100]]);
  assert.deepEqual(allocateFGLots(lots, 30).map(x => [x.LotNo, x.Quantity]), [['OLD', 20], ['NEW', 10]]);
});

test('duplicate FG rows for one source consume FIFO cumulatively', () => {
  const lines = [
    { whid: 2, productId: 7, fromLocationCode: 'A-01', quantity: 300 },
    { whid: 2, productId: 7, fromLocationCode: 'A-01', quantity: 200 }
  ];
  const lots = {
    [JSON.stringify([2, 7, 'A-01'])]: [
      { LotNo: 'LOT06', Quantity: 300, AvailableQuantity: 300, ReceivedAt: receivedAt(1) },
      { LotNo: 'LOT07', Quantity: 200, AvailableQuantity: 200, ReceivedAt: receivedAt(2) }
    ]
  };
  const allocations = allocateFGBatch(lines, lots);
  assert.deepEqual(allocations.map(rows => rows.map(x => [x.LotNo, x.Quantity])), [[['LOT06', 300]], [['LOT07', 200]]]);
});

test('FG batch allocation fails before proceeding when combined quantities exceed stock', () => {
  const lines = [
    { whid: 1, productId: 9, fromLocationCode: 'A-01', quantity: 300 },
    { whid: 1, productId: 9, fromLocationCode: 'A-01', quantity: 201 }
  ];
  const lots = { [JSON.stringify([1, 9, 'A-01'])]: [{ LotNo: 'LOT', Quantity: 500, AvailableQuantity: 500, ReceivedAt: receivedAt(1) }] };
  assert.throws(() => allocateFGBatch(lines, lots), error => error.status === 409);
});

test('canonical lot lines compare consistently regardless of input row order', () => {
  const old = { AnaNo: 'ANA-A', LotNo: 'LOT-A', FifoDate: receivedAt(1), Quantity: 10 };
  const newer = { AnaNo: 'ANA-B', LotNo: 'LOT-B', FifoDate: receivedAt(2), Quantity: 5 };
  assert.equal(canonicalLotLines([old, newer]), canonicalLotLines([newer, old]));
});

test('atomic FG batch endpoint requires PICK confirmation permission', () => {
  assert.deepEqual(actionForRequest('/picking/fg-batch', 'POST'), { code: 'PICK', action: 'CONFIRM' });
});
