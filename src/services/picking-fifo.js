function fifoSort(rows) {
  return [...rows].sort((a, b) => {
    const au = !!a.Unattributed, bu = !!b.Unattributed;
    if (au !== bu) return au ? 1 : -1;
    const ad = a.ReceivedAt ? new Date(a.ReceivedAt).getTime() : Number.MAX_SAFE_INTEGER;
    const bd = b.ReceivedAt ? new Date(b.ReceivedAt).getTime() : Number.MAX_SAFE_INTEGER;
    return ad - bd || String(a.LotNo || '').localeCompare(String(b.LotNo || '')) || String(a.AnaNo || '').localeCompare(String(b.AnaNo || ''));
  });
}

function availableFGLots(rows, reserved) {
  let left = Math.max(0, Number(reserved) || 0);
  return fifoSort(rows).map(row => {
    const quantity = Number(row.Quantity);
    const held = Math.min(quantity, left);
    left = Math.max(0, left - held);
    return { ...row, Quantity: quantity, ReservedQuantity: held, AvailableQuantity: Math.max(0, quantity - held) };
  });
}

function allocateFGLots(rows, quantity) {
  let left = Math.round(Number(quantity) * 100) / 100;
  const picked = [];
  for (const row of rows) {
    const take = Math.min(left, Math.round(Number(row.AvailableQuantity) * 100) / 100);
    if (take > 0) {
      picked.push({ AnaNo: row.AnaNo || null, LotNo: row.LotNo || null, FifoDate: row.ReceivedAt || null, Quantity: take });
      left = Math.round((left - take) * 100) / 100;
    }
    if (left <= 0) break;
  }
  return left > 0 ? null : picked;
}

function canonicalLotLines(rows) {
  return JSON.stringify((rows || []).map(x => ({
    AnaNo: x.AnaNo || null,
    LotNo: x.LotNo || null,
    FifoDate: x.FifoDate ? new Date(x.FifoDate).toISOString() : null,
    Quantity: Math.round(Number(x.Quantity) * 100) / 100
  })).sort((a, b) => String(a.FifoDate || '').localeCompare(String(b.FifoDate || '')) || String(a.LotNo || '').localeCompare(String(b.LotNo || '')) || String(a.AnaNo || '').localeCompare(String(b.AnaNo || ''))));
}

function allocateFGBatch(lines, lotsBySource) {
  const remainingBySource = new Map();
  return lines.map(line => {
    const key = JSON.stringify([line.whid, line.productId, line.fromLocationCode]);
    if (!remainingBySource.has(key)) {
      const lots = typeof lotsBySource === 'function' ? lotsBySource(line) : lotsBySource[key];
      remainingBySource.set(key, (lots || []).map(lot => ({ ...lot, AvailableQuantity: Number(lot.AvailableQuantity) })));
    }
    const lots = remainingBySource.get(key);
    const allocated = allocateFGLots(lots, line.quantity);
    if (!allocated) {
      const error = new Error('ยอด LOT พร้อมหยิบไม่พอสำหรับทั้งชุด');
      error.status = 409;
      throw error;
    }
    for (const allocation of allocated) {
      let left = Number(allocation.Quantity);
      for (const lot of lots) {
        const received = value => value ? new Date(value).toISOString() : null;
        if ((lot.AnaNo || null) !== allocation.AnaNo || (lot.LotNo || null) !== allocation.LotNo || received(lot.ReceivedAt) !== received(allocation.FifoDate)) continue;
        const take = Math.min(Number(lot.AvailableQuantity), left);
        lot.AvailableQuantity = Math.round((Number(lot.AvailableQuantity) - take) * 100) / 100;
        left = Math.round((left - take) * 100) / 100;
        if (left <= 0) break;
      }
    }
    return allocated;
  });
}

module.exports = { fifoSort, availableFGLots, allocateFGLots, canonicalLotLines, allocateFGBatch };
