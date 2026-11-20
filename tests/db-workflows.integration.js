// Explicit DEV-only integration smoke. This starts the real route modules and
// writes uniquely tagged test documents to the configured local SQL instance.
// It always restores the affected stock rows and removes its test records.
const express = require('express');
const jwt = require('jsonwebtoken');
const { randomUUID } = require('crypto');

const tag = `WMS-IT-${new Date().toISOString().replace(/\D/g, '').slice(0, 14)}-${randomUUID().slice(0, 8).toUpperCase()}`;
const inboundRequestId = randomUUID();
const storageRequestId = randomUUID();
const countRequestId = randomUUID();
process.env.JWT_SECRET = `local-dev-integration-${randomUUID()}`;

const { poolPromise, sql } = require('../src/config/db');
const stockLotDetails = require('../src/services/stock-lot-details');
const { today: bangkokToday } = require('../src/services/sql-dates');
const { availableFGLots } = require('../src/services/picking-fifo');

const assert = (condition, message) => { if (!condition) throw new Error(message); };
const round = value => Math.round(Number(value) * 100) / 100;

async function api(url, token, body) {
  const response = await fetch(url, {
    method: body ? 'POST' : 'GET',
    headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {})
  });
  const json = await response.json().catch(() => ({}));
  return { status: response.status, body: json };
}

async function snapshotStock(pool, whid, productId, locationCode) {
  return (await pool.request().input('Wh', sql.Int, whid).input('Product', sql.Int, productId)
    .input('Location', sql.NVarChar(50), locationCode).query(`
      SELECT Quantity FROM dbWMS.dbo.tblStock
      WHERE whid=@Wh AND ProductId=@Product AND LocationCode=@Location;
    `)).recordset[0]?.Quantity ?? 0;
}

async function restoreStockQuantity(pool, whid, productId, locationCode, quantity) {
  await pool.request().input('Wh', sql.Int, whid).input('Product', sql.Int, productId)
    .input('Location', sql.NVarChar(50), locationCode).input('Quantity', sql.Decimal(18, 2), quantity)
    .query(`IF EXISTS(SELECT 1 FROM dbWMS.dbo.tblStock WITH(UPDLOCK,HOLDLOCK) WHERE whid=@Wh AND ProductId=@Product AND LocationCode=@Location)
      UPDATE dbWMS.dbo.tblStock SET Quantity=@Quantity,UpdatedAt=SYSDATETIME() WHERE whid=@Wh AND ProductId=@Product AND LocationCode=@Location;
      ELSE IF @Quantity<>0 INSERT dbWMS.dbo.tblStock(whid,ProductId,LocationCode,Quantity) VALUES(@Wh,@Product,@Location,@Quantity);`);
}

async function run() {
  const pool = await poolPromise;
  const identity = (await pool.request().query(`
    SELECT @@SERVERNAME AS ServerName,
      (SELECT state_desc FROM sys.databases WHERE name='dbWMS') AS WmsState,
      DB_NAME() AS CurrentDatabase;
  `)).recordset[0];
  assert(['localhost', '127.0.0.1', '(local)', '.'].includes(String(process.env.DB_SERVER || 'localhost').toLowerCase()),
    'Safety stop: database server is not configured as localhost.');
  assert(identity.WmsState === 'ONLINE', 'Safety stop: dbWMS is not ONLINE.');
  const migration = (await pool.request().query("SELECT OBJECT_ID('dbWMS.dbo.FGLotPickLines','U') AS LotTable")).recordset[0];
  assert(migration.LotTable, 'Safety stop: apply mssql/FGLotPickTracking.sql before running the FG batch integration.');

  const app = express();
  app.use(express.json());
  // Auth is isolated to this ephemeral in-process DEV harness; route code still
  // verifies the signed test token and executes its normal SQL transactions.
  app.use((req, res, next) => {
    req.navigation = { user: { Role: 'ADMIN' }, mode: 'DESKTOP', profile: { warehouseIds: null } };
    req.warehouseIds = null;
    next();
  });
  app.use('/api/inbound', require('../src/routes/inbound'));
  app.use('/api/picking', require('../src/routes/picking'));
  app.use('/api/deliveries', require('../src/routes/deliveries'));
  app.use('/api/storage-planner', require('../src/routes/storage-planner'));
  app.use('/api/inventory-counts', require('../src/routes/inventory-counts'));
  const server = await new Promise((resolve, reject) => {
    const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
    listener.once('error', reject);
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  const token = jwt.sign({ id: 2147483000, username: 'WMS-DB-IT', role: 'ADMIN', permissions: 'ALL', mode: 'DESKTOP' }, process.env.JWT_SECRET, { expiresIn: '20m' });
  const cleanupNotes = [];
  const cleanupErrors = [];
  let inbound = null;
  let semiInbound = null;
  let semiPlan = null;
  let delivery = null;
  const deliveryPageTestDocs = [];
  let warehouseTransfer = null;
  let customerReturnShipment = null;
  const returnStockBaselines = [];
  let storagePlan = null;
  let countSession = null;
  let pickSource = null;
  const batchIds = [randomUUID(), randomUUID()];
  const genericRequestIds = { PKG: randomUUID(), SEMI: randomUUID() };
  const genericPickBaselines = [];
  const pickNumbers = [];
  let semiStockBaseline = null;
  let sourceBefore = null;
  let outBefore = null;
  let batchResult = null;
  let inboundBefore = null;
  let deliveryStockBefore = null;
  const transferStockBaselines = [];

  try {
    // Find a valid existing FG stock row with fully attributable ANA/LOT and
    // a same-warehouse OUT location. Only 2 PCS are used and later reversed.
    const candidates = (await pool.request().query(`
      SELECT TOP (100) s.whid,s.ProductId,s.LocationCode,s.Quantity,
        COALESCE((SELECT SUM(l.Quantity-l.MovedQuantity)
          FROM dbWMS.dbo.StoragePlans h JOIN dbWMS.dbo.StoragePlanLines l ON l.PlanId=h.PlanId
          WHERE h.Status='OPEN' AND h.WhId=s.whid AND h.ProductId=s.ProductId AND h.FromLocationCode=s.LocationCode),0)
        +COALESCE((SELECT SUM(dl.Quantity)
          FROM dbWMS.dbo.DeliveryLines dl JOIN dbWMS.dbo.DeliveryOrders dh ON dh.DeliveryId=dl.DeliveryId
          WHERE dh.Status='DRAFT' AND dh.WhId=s.whid AND dl.ProductId=s.ProductId AND dl.LocationCode=s.LocationCode),0) AS ReservedQuantity,
        p.Barcode,p.ProductCode
      FROM dbWMS.dbo.tblStock s
      JOIN dbMaster.dbo.tblProducts p ON p.ProductId=s.ProductId AND p.IsActive=1
      JOIN dbMaster.dbo.tblCategories c ON c.CategoryID=p.CategoryId AND UPPER(c.CategoryCode)='FG'
      JOIN dbMaster.dbo.Locations l ON l.whid=s.whid AND l.LocationCode=s.LocationCode AND l.IsActive=1
      WHERE s.Quantity>=4 AND UPPER(l.Zone) IN('A','B','STORAGE')
        AND EXISTS(SELECT 1 FROM dbMaster.dbo.Locations o WHERE o.whid=s.whid AND o.IsActive=1 AND UPPER(o.Zone)='OUT')
      ORDER BY s.Quantity DESC;
    `)).recordset;
    for (const candidate of candidates) {
      const lots = await stockLotDetails.load(pool, sql, candidate.ProductId, [candidate]);
      if (Math.abs(lots.reduce((sum, line) => sum + Number(line.Quantity), 0) - Number(candidate.Quantity)) > 0.005) continue;
      const availableLots = availableFGLots(lots, candidate.ReservedQuantity);
      // Leave enough unreserved stock for the later 26-document pagination
      // case as well as the independent FG picking and cancellation checks.
      if (availableLots.reduce((sum, line) => sum + Number(line.AvailableQuantity), 0) < 32) continue;
      const outLocation = (await pool.request().input('Wh', sql.Int, candidate.whid).query("SELECT TOP(1) LocationCode FROM dbMaster.dbo.Locations WHERE whid=@Wh AND IsActive=1 AND UPPER(Zone)='OUT' ORDER BY LocationCode")).recordset[0]?.LocationCode;
      if (!outLocation) continue;
      pickSource = { ...candidate, lots: availableLots, outLocation };
      break;
    }
    assert(pickSource, 'No active FG stock with traceable LOT and a same-warehouse OUT location was found.');

    // Inbound: create a production receipt, receive it into an RCV location,
    // replay the same request id, then reverse it through the app cancellation flow.
    const rcv = (await pool.request().input('Wh', sql.Int, pickSource.whid).query("SELECT TOP(1) LocationCode FROM dbMaster.dbo.Locations WHERE whid=@Wh AND IsActive=1 AND UPPER(Zone)='RCV' ORDER BY LocationCode")).recordset[0]?.LocationCode;
    assert(rcv, `No active RCV location in warehouse ${pickSource.whid}; inbound test cannot run safely.`);
    const product = (await pool.request().input('Product', sql.Int, pickSource.ProductId).query(`
      SELECT p.ProductId,p.ProductCode,p.ProductName,COALESCE(u.UnitCode,p.PackageType,N'') AS UOM
      FROM dbMaster.dbo.tblProducts p LEFT JOIN dbMaster.dbo.tblUnits u ON u.UnitId=p.UnitId WHERE p.ProductId=@Product;
    `)).recordset[0];
    const receiveQty = 2;
    const lotNo = `${tag}-LOT`.slice(0, 60);
    inboundBefore = await snapshotStock(pool, pickSource.whid, product.ProductId, rcv);
    const create = await api(`${base}/api/inbound`, token, {
      receiveType: 'FG', sourceMode: 'PRODUCTION', whid: pickSource.whid, requestId: inboundRequestId,
      referenceNo: `${tag}-RECEIVE`.slice(0, 60), supplierName: 'ฝ่ายผลิต',
      productionSender: tag, productionRemark: 'Disposable DB integration test',
      lines: [{ productId: product.ProductId, quantity: receiveQty, anaNo: `${tag}-ANA`.slice(0, 60), lotNo }]
    });
    assert(create.status === 201 && create.body.success && create.body.InboundId && create.body.ReceiveNo,
      `Inbound creation failed (${create.status}): ${create.body.message || 'unexpected response'}`);
    inbound = { id: create.body.InboundId, no: create.body.ReceiveNo, requestId: inboundRequestId, whid: pickSource.whid, productId: product.ProductId, location: rcv };
    const line = (await pool.request().input('Id', sql.Int, inbound.id).query('SELECT LineId FROM dbWMS.dbo.InboundLines WHERE InboundId=@Id')).recordset[0];
    assert(line?.LineId, 'Inbound line was not persisted.');
    const receiveRequestId = randomUUID();
    const receipt = { requestId: receiveRequestId, lineId: line.LineId, quantity: receiveQty, locationCode: rcv, lotNo };
    const received = await api(`${base}/api/inbound/${inbound.id}/receive`, token, receipt);
    assert([200, 201].includes(received.status) && received.body.success, `Receive failed (${received.status}): ${received.body.message || 'unexpected response'}`);
    const afterReceive = await snapshotStock(pool, inbound.whid, inbound.productId, rcv);
    assert(round(afterReceive - inboundBefore) === receiveQty, 'Received quantity did not persist to stock.');
    const repeatedReceipt = await api(`${base}/api/inbound/${inbound.id}/receive`, token, receipt);
    assert(repeatedReceipt.status === 200 && repeatedReceipt.body.duplicate === true, 'Receipt replay was not idempotent.');

    const receiptRow = (await pool.request().input('Request', sql.UniqueIdentifier, receiveRequestId).query('SELECT ReceiptId FROM dbWMS.dbo.InboundReceipts WHERE RequestId=@Request')).recordset[0];
    assert(receiptRow?.ReceiptId, 'Inbound receipt was not persisted for the storage-plan flow.');
    const target = (await pool.request().input('Wh', sql.Int, pickSource.whid).input('Product', sql.Int, product.ProductId).query(`
      SELECT TOP(1) l.LocationCode FROM dbMaster.dbo.Locations l
      JOIN dbMaster.dbo.tblProducts p ON p.ProductId=@Product
      WHERE l.whid=@Wh AND l.IsActive=1 AND UPPER(l.Zone) IN('A','B','STORAGE')
        AND NOT EXISTS(SELECT 1 FROM dbMaster.dbo.tblLocationCategoryRules r WHERE r.WhId=l.whid AND r.LocationCode=l.LocationCode)
      ORDER BY l.LocationCode;
    `)).recordset[0]?.LocationCode;
    assert(target, `No compatible storage destination was available in warehouse ${pickSource.whid}.`);
    const planned = await api(`${base}/api/storage-planner`, token, {
      requestId: storageRequestId, whid: pickSource.whid, productId: product.ProductId,
      receiptId: receiptRow.ReceiptId, fromLocationCode: rcv, note: `${tag} putaway plan`,
      lines: [{ toLocationCode: target, quantity: receiveQty }]
    });
    assert(planned.status === 201 && planned.body.success && planned.body.PlanId && planned.body.PlanNo,
      `Storage plan creation failed (${planned.status}): ${planned.body.message || 'unexpected response'}`);
    storagePlan = { id: planned.body.PlanId, no: planned.body.PlanNo, requestId: storageRequestId };
    const planState = (await pool.request().input('Id', sql.Int, storagePlan.id).query(`
      SELECT h.Status,h.InboundReceiptId,SUM(l.Quantity) AS Planned FROM dbWMS.dbo.StoragePlans h
      JOIN dbWMS.dbo.StoragePlanLines l ON l.PlanId=h.PlanId WHERE h.PlanId=@Id GROUP BY h.Status,h.InboundReceiptId;
    `)).recordset[0];
    assert(planState?.Status === 'OPEN' && planState.InboundReceiptId === receiptRow.ReceiptId && round(planState.Planned) === receiveQty,
      'Putaway plan was not linked to the receipt and quantity as expected.');
    const cancelledPlan = await api(`${base}/api/storage-planner/${storagePlan.id}/cancel`, token, {});
    assert(cancelledPlan.status === 200 && cancelledPlan.body.success, `Storage plan cancel failed (${cancelledPlan.status}).`);
    const planStatus = (await pool.request().input('Id', sql.Int, storagePlan.id).query('SELECT Status FROM dbWMS.dbo.StoragePlans WHERE PlanId=@Id')).recordset[0]?.Status;
    assert(planStatus === 'CANCELLED', 'Cancelled putaway plan status was not persisted.');
    cleanupNotes.push(`Storage plan ${storagePlan.no}: linked to the receipt, saved, cancelled without moving stock.`);

    const cancelled = await api(`${base}/api/inbound/${inbound.id}/cancel`, token, { reason: `${tag} cleanup` });
    assert(cancelled.status === 200 && cancelled.body.success, `Inbound reverse failed (${cancelled.status}): ${cancelled.body.message || 'unexpected response'}`);
    const afterCancel = await snapshotStock(pool, inbound.whid, inbound.productId, rcv);
    assert(round(afterCancel - inboundBefore) === 0, 'Inbound cancel did not restore the original stock quantity.');
    cleanupNotes.push(`Inbound ${inbound.no}: created, received ${receiveQty}, replayed idempotently, cancelled; stock delta returned to 0.`);

    // FG pick: duplicate SKU/location rows remain distinct and cumulatively
    // consume FIFO. Verify persisted rows, movements, idempotency and rollback.
    sourceBefore = await snapshotStock(pool, pickSource.whid, pickSource.ProductId, pickSource.LocationCode);
    outBefore = await snapshotStock(pool, pickSource.whid, pickSource.ProductId, pickSource.outLocation);
    const batchLines = [0, 1].map((_, index) => ({
      pickType: 'FG', whid: pickSource.whid, productId: pickSource.ProductId,
      fromLocationCode: pickSource.LocationCode, toLocationCode: pickSource.outLocation,
      quantity: 1, requestId: batchIds[index], referenceNo: `${tag}-BATCH`, note: `${tag} duplicate row ${index + 1}`
    }));
    const failedIds = [randomUUID(), randomUUID()];
    const rollbackLines = [
      { ...batchLines[0], requestId: failedIds[0], referenceNo: `${tag}-ROLLBACK`, note: `${tag} rollback first` },
      { ...batchLines[1], requestId: failedIds[1], quantity: Math.ceil(Number(pickSource.Quantity) + 1), referenceNo: `${tag}-ROLLBACK`, note: `${tag} rollback overflow` }
    ];
    const rejected = await api(`${base}/api/picking/fg-batch`, token, { lines: rollbackLines });
    assert(rejected.status === 409 && rejected.body.success === false, `Oversize batch should fail atomically (received ${rejected.status}).`);
    const rolledBack = (await pool.request().input('First', sql.UniqueIdentifier, failedIds[0]).input('Second', sql.UniqueIdentifier, failedIds[1]).query('SELECT COUNT(*) AS Total FROM dbWMS.dbo.PickOperations WHERE RequestId IN(@First,@Second)')).recordset[0].Total;
    assert(rolledBack === 0, 'Failed batch left a persisted PickOperation behind.');
    assert(round(await snapshotStock(pool, pickSource.whid, pickSource.ProductId, pickSource.LocationCode) - sourceBefore) === 0,
      'Failed batch changed source stock despite rollback.');

    batchResult = await api(`${base}/api/picking/fg-batch`, token, { lines: batchLines });
    assert(batchResult.status === 201 && batchResult.body.success && batchResult.body.atomic && batchResult.body.results?.length === 2,
      `FG batch failed (${batchResult.status}): ${batchResult.body.message || 'unexpected response'}`);
    assert(batchResult.body.results.every(x => !x.duplicate), 'New batch unexpectedly replayed as duplicate.');
    const persisted = await pool.request().input('First', sql.UniqueIdentifier, batchIds[0]).input('Second', sql.UniqueIdentifier, batchIds[1]).query(`
      SELECT o.PickId,o.PickNo,o.Quantity,COALESCE(SUM(l.Quantity),0) AS LotQuantity,COUNT(l.PickId) AS LotLines
      FROM dbWMS.dbo.PickOperations o LEFT JOIN dbWMS.dbo.FGLotPickLines l ON l.PickId=o.PickId
      WHERE o.RequestId IN(@First,@Second) GROUP BY o.PickId,o.PickNo,o.Quantity ORDER BY o.PickId;
    `);
    assert(persisted.recordset.length === 2 && persisted.recordset.every(x => round(x.Quantity) === 1 && round(x.LotQuantity) === 1 && x.LotLines > 0),
      'Two separate duplicate rows and their FIFO/LOT lines were not persisted correctly.');
    pickNumbers.push(...persisted.recordset.map(x => x.PickNo));
    assert(round(sourceBefore - await snapshotStock(pool, pickSource.whid, pickSource.ProductId, pickSource.LocationCode)) === 2,
      'FG source stock was not reduced by the committed quantity.');
    assert(round(await snapshotStock(pool, pickSource.whid, pickSource.ProductId, pickSource.outLocation) - outBefore) === 2,
      'FG OUT stock was not increased by the committed quantity.');
    const retried = await api(`${base}/api/picking/fg-batch`, token, { lines: batchLines });
    assert(retried.status === 201 && retried.body.results?.length === 2 && retried.body.results.every(x => x.duplicate),
      'Retrying the same FG batch was not idempotent.');
    assert(round(sourceBefore - await snapshotStock(pool, pickSource.whid, pickSource.ProductId, pickSource.LocationCode)) === 2,
      'Idempotent retry changed source stock a second time.');
    cleanupNotes.push(`FG batch ${tag}-BATCH: two same-SKU/location rows committed separately with LOT details, replay was idempotent, and invalid second row rolled back the entire batch.`);

    // Exercise the shared non-RM pick endpoint against real PKG and SEMI stock.
    for (const [type, categories] of [['PKG', "('PKG','PACK')"], ['SEMI', "('SEMI','SFG')"]]) {
      const options = (await pool.request().query(`
        SELECT TOP(25) s.whid,s.ProductId,s.LocationCode,s.Quantity,
          COALESCE((SELECT SUM(l.Quantity-l.MovedQuantity) FROM dbWMS.dbo.StoragePlans h JOIN dbWMS.dbo.StoragePlanLines l ON l.PlanId=h.PlanId
            WHERE h.Status='OPEN' AND h.WhId=s.whid AND h.ProductId=s.ProductId AND h.FromLocationCode=s.LocationCode),0)
          +COALESCE((SELECT SUM(dl.Quantity) FROM dbWMS.dbo.DeliveryLines dl JOIN dbWMS.dbo.DeliveryOrders dh ON dh.DeliveryId=dl.DeliveryId
            WHERE dh.Status='DRAFT' AND dh.WhId=s.whid AND dl.ProductId=s.ProductId AND dl.LocationCode=s.LocationCode),0) AS ReservedQuantity
        FROM dbWMS.dbo.tblStock s JOIN dbMaster.dbo.tblProducts p ON p.ProductId=s.ProductId AND p.IsActive=1
        JOIN dbMaster.dbo.tblCategories c ON c.CategoryID=p.CategoryId AND UPPER(c.CategoryCode) IN${categories}
        JOIN dbMaster.dbo.Locations l ON l.whid=s.whid AND l.LocationCode=s.LocationCode AND l.IsActive=1
        WHERE s.Quantity>=1 AND UPPER(l.Zone) IN('A','B','STORAGE')
        ORDER BY s.Quantity DESC;
      `)).recordset;
      const candidate = options.find(x => Number(x.Quantity) - Number(x.ReservedQuantity) >= 1);
      if (!candidate && type === 'SEMI') {
        // DEV has no SEMI on hand. Seed one unit through the real SEMI inbound
        // flow, receive to RCV, and complete the real putaway before testing pick.
        const fixture = (await pool.request().query(`
          SELECT TOP(1) p.ProductId,p.ProductCode,p.ProductName,p.Barcode,p.UnitId,
            l.LinkId,m.SupplierId,s.SupplierName,
            (SELECT TOP(1) LocationCode FROM dbMaster.dbo.Locations WHERE whid=1 AND IsActive=1 AND UPPER(Zone)='RCV' ORDER BY LocationCode) AS RcvLocation,
            (SELECT TOP(1) LocationCode FROM dbMaster.dbo.Locations WHERE whid=1 AND IsActive=1 AND UPPER(Zone) IN('A','B','STORAGE') ORDER BY LocationCode) AS PutawayLocation
          FROM dbMaster.dbo.tblProducts p
          JOIN dbMaster.dbo.tblCategories c ON c.CategoryID=p.CategoryId AND c.CategoryCode='SEMI'
          JOIN dbMaster.dbo.tblManufacturerProducts l ON l.ProductId=p.ProductId AND l.Status='CONFIRMED'
          JOIN dbMaster.dbo.tblManufacturers m ON m.ManufacturerId=l.ManufacturerId AND m.IsActive=1 AND m.SupplierId=207
          JOIN dbMaster.dbo.tblSuppliers s ON s.SupplierId=m.SupplierId AND s.IsActive=1
          WHERE p.ProductCode='SEMI001' AND p.IsActive=1
            AND CONVERT(date,GETDATE()) BETWEEN l.StartDate AND COALESCE(l.EndDate,'99991231')
          ORDER BY l.LinkId;
        `)).recordset[0];
        assert(fixture?.RcvLocation && fixture?.PutawayLocation,
          'No active SEMI inbound manufacturer link or WH01 receive/putaway location is available for a reversible DEV fixture.');
        const semiQty = 2;
        const rcvBefore = await snapshotStock(pool, 1, fixture.ProductId, fixture.RcvLocation);
        const putawayBefore = await snapshotStock(pool, 1, fixture.ProductId, fixture.PutawayLocation);
        semiStockBaseline = { productId: fixture.ProductId, whid: 1, rcvLocation: fixture.RcvLocation,
          putawayLocation: fixture.PutawayLocation, rcvBefore, putawayBefore };
        const semiInboundRequestId = randomUUID();
        const createdSemi = await api(`${base}/api/inbound`, token, {
          receiveType: 'SEMI', sourceMode: 'NEW_PO', whid: 1, requestId: semiInboundRequestId,
          referenceNo: `${tag}-SEMI-PO`, documentDate: bangkokToday(), supplierId: fixture.SupplierId,
          supplierName: fixture.SupplierName, supplierDocumentNo: `${tag}-SEMI-DOC`, vatRate: 0,
          lines: [{ productId: fixture.ProductId, quantity: semiQty, unitPrice: 1, manufacturerLinkId: fixture.LinkId }]
        });
        assert(createdSemi.status === 201 && createdSemi.body.success && createdSemi.body.InboundId,
          `SEMI inbound creation failed (${createdSemi.status}): ${createdSemi.body.message || 'unexpected response'}`);
        semiInbound = { id: createdSemi.body.InboundId, no: createdSemi.body.ReceiveNo, requestId: semiInboundRequestId,
          lineId: null, receiveRequestId: randomUUID(), quantity: semiQty, ...semiStockBaseline };
        const semiLine = (await pool.request().input('Id', sql.Int, semiInbound.id)
          .query('SELECT LineId FROM dbWMS.dbo.InboundLines WHERE InboundId=@Id')).recordset[0];
        assert(semiLine?.LineId, 'SEMI inbound line did not persist.');
        semiInbound.lineId = semiLine.LineId;
        const semiReceived = await api(`${base}/api/inbound/${semiInbound.id}/receive`, token, {
          requestId: semiInbound.receiveRequestId, lineId: semiInbound.lineId, quantity: semiQty,
          locationCode: semiInbound.rcvLocation, lotNo: `${tag}-SEMI-LOT`.slice(0, 60)
        });
        assert([200, 201].includes(semiReceived.status) && semiReceived.body.success,
          `SEMI receive failed (${semiReceived.status}): ${semiReceived.body.message || 'unexpected response'}`);
        const receiptId = (await pool.request().input('Request', sql.UniqueIdentifier, semiInbound.receiveRequestId)
          .query('SELECT ReceiptId FROM dbWMS.dbo.InboundReceipts WHERE RequestId=@Request')).recordset[0]?.ReceiptId;
        assert(receiptId, 'SEMI receipt record was not persisted.');
        const semiPlanRequestId = randomUUID();
        const plannedSemi = await api(`${base}/api/storage-planner`, token, {
          requestId: semiPlanRequestId, whid: 1, productId: fixture.ProductId,
          fromLocationCode: fixture.RcvLocation, note: `${tag} SEMI putaway`,
          lines: [{ toLocationCode: fixture.PutawayLocation, quantity: semiQty }]
        });
        assert(plannedSemi.status === 201 && plannedSemi.body.success && plannedSemi.body.PlanId,
          `SEMI putaway plan failed (${plannedSemi.status}): ${plannedSemi.body.message || 'unexpected response'}`);
        semiPlan = { id: plannedSemi.body.PlanId, no: plannedSemi.body.PlanNo, requestId: semiPlanRequestId,
          moveRequestId: randomUUID(), lineId: null };
        const semiPlanLine = (await pool.request().input('Id', sql.Int, semiPlan.id)
          .query('SELECT TOP(1) LineId FROM dbWMS.dbo.StoragePlanLines WHERE PlanId=@Id')).recordset[0];
        assert(semiPlanLine?.LineId, 'SEMI putaway plan line did not persist.');
        semiPlan.lineId = semiPlanLine.LineId;
        const movedSemi = await api(`${base}/api/storage-planner/${semiPlan.id}/move`, token, {
          requestId: semiPlan.moveRequestId, lineId: semiPlan.lineId, quantity: semiQty,
          productCode: fixture.ProductCode, fromLocationCode: fixture.RcvLocation, toLocationCode: fixture.PutawayLocation
        });
        assert(movedSemi.status === 200 && movedSemi.body.success,
          `SEMI putaway move failed (${movedSemi.status}): ${movedSemi.body.message || 'unexpected response'}`);
        assert(round(await snapshotStock(pool, 1, fixture.ProductId, fixture.RcvLocation) - rcvBefore) === 0
          && round(await snapshotStock(pool, 1, fixture.ProductId, fixture.PutawayLocation) - putawayBefore) === semiQty,
          'SEMI receipt and putaway did not move stock from RCV to storage.');
        cleanupNotes.push(`SEMI fixture ${fixture.ProductCode}: seeded ${semiQty} units by inbound, received in RCV, and put away to storage.`);
        const fresh = (await pool.request().input('Wh', sql.Int, 1).input('P', sql.Int, fixture.ProductId)
          .input('Loc', sql.NVarChar(50), fixture.PutawayLocation).query('SELECT whid,ProductId,LocationCode,Quantity,0 AS ReservedQuantity FROM dbWMS.dbo.tblStock WHERE whid=@Wh AND ProductId=@P AND LocationCode=@Loc')).recordset[0];
        assert(fresh && Number(fresh.Quantity) - Number(fresh.ReservedQuantity) >= 1, 'SEMI fixture was not available for picking after putaway.');
        const before = await snapshotStock(pool, 1, fixture.ProductId, fixture.PutawayLocation);
        genericPickBaselines.push({ type, ...fresh, before });
        const payload = { pickType: 'SEMI', whid: 1, productId: fixture.ProductId,
          fromLocationCode: fixture.PutawayLocation, quantity: 1, requestId: genericRequestIds.SEMI,
          referenceNo: `${tag}-SEMI`, note: `${tag} SEMI pick integration` };
        const picked = await api(`${base}/api/picking`, token, payload);
        assert(picked.status === 201 && picked.body.success && picked.body.PickId,
          `SEMI pick failed (${picked.status}): ${picked.body.message || 'unexpected response'}`);
        assert(round(before - await snapshotStock(pool, 1, fixture.ProductId, fixture.PutawayLocation)) === 1,
          'SEMI pick did not persist stock deduction.');
        const replay = await api(`${base}/api/picking`, token, payload);
        assert(replay.status === 200 && replay.body.duplicate, 'SEMI pick replay was not idempotent.');
        pickNumbers.push(picked.body.PickNo);
        cleanupNotes.push(`SEMI pick ${picked.body.PickNo}: one unit persisted after real inbound/putaway, replay idempotent.`);
        continue;
      }
      if (!candidate) {
        cleanupNotes.push(`${type} pick skipped: no unreserved stock of at least 1 unit exists in an active storage location.`);
        continue;
      }
      const before = await snapshotStock(pool, candidate.whid, candidate.ProductId, candidate.LocationCode);
      genericPickBaselines.push({ type, ...candidate, before });
      const payload = {
        pickType: type, whid: candidate.whid, productId: candidate.ProductId,
        fromLocationCode: candidate.LocationCode, quantity: 1,
        requestId: genericRequestIds[type], referenceNo: `${tag}-${type}`,
        note: `${tag} ${type} pick integration`
      };
      const picked = await api(`${base}/api/picking`, token, payload);
      assert(picked.status === 201 && picked.body.success && picked.body.PickId && picked.body.PickNo,
        `${type} pick failed (${picked.status}): ${picked.body.message || 'unexpected response'}`);
      const afterPick = await snapshotStock(pool, candidate.whid, candidate.ProductId, candidate.LocationCode);
      assert(round(before - afterPick) === 1, `${type} pick did not persist the stock deduction.`);
      const replay = await api(`${base}/api/picking`, token, payload);
      assert(replay.status === 200 && replay.body.success && replay.body.duplicate, `${type} pick replay was not idempotent.`);
      assert(round(before - await snapshotStock(pool, candidate.whid, candidate.ProductId, candidate.LocationCode)) === 1,
        `${type} pick replay deducted stock more than once.`);
      pickNumbers.push(picked.body.PickNo);
      cleanupNotes.push(`${type} pick ${picked.body.PickNo}: one unit persisted, replay was idempotent.`);
    }

    // Delivery draft and cancellation: persists a real shipment reservation,
    // then cancels it and confirms that available stock returns unchanged.
    const profile = (await pool.request().query('SELECT ProfileJson FROM dbMaster.dbo.CompanyProfile WHERE CompanyId=1')).recordset[0];
    assert(profile, 'CompanyProfile is not configured; shipment draft integration cannot run safely.');
    deliveryStockBefore = await snapshotStock(pool, pickSource.whid, pickSource.ProductId, pickSource.LocationCode);
    const deliveryRequestId = randomUUID();
    const deliveryDate = bangkokToday();
    const deliveryPayload = {
      requestId: deliveryRequestId, categoryCode: 'FG', deliveryType: 'CUSTOMER', ownership: 'CUSTOMER',
      whid: pickSource.whid, destinationName: `${tag} shipment test`, shippingAddress: 'DEV TEST only',
      contactName: 'WMS DB integration', phone: '0000000000', deliveryDate,
      poNo: '', soNo: '', note: `${tag} draft/cancel test`,
      lines: [{ productId: pickSource.ProductId, locationCode: pickSource.LocationCode, quantity: 1 }]
    };
    const createdDelivery = await api(`${base}/api/deliveries`, token, deliveryPayload);
    assert(createdDelivery.status === 201 && createdDelivery.body.success && createdDelivery.body.DeliveryId && createdDelivery.body.DeliveryNo,
      `Delivery draft creation failed (${createdDelivery.status}): ${createdDelivery.body.message || 'unexpected response'}`);
    delivery = { id: createdDelivery.body.DeliveryId, no: createdDelivery.body.DeliveryNo, requestId: deliveryRequestId, whid: pickSource.whid, productId: pickSource.ProductId, location: pickSource.LocationCode };
    const draftRow = (await pool.request().input('Id', sql.Int, delivery.id).query('SELECT Status,Prepared FROM dbWMS.dbo.DeliveryOrders WHERE DeliveryId=@Id')).recordset[0];
    assert(draftRow?.Status === 'DRAFT' && draftRow.Prepared === false, 'Shipment draft was not persisted in the expected unprepared state.');
    const cancelledDelivery = await api(`${base}/api/deliveries/${delivery.id}/cancel`, token, {});
    assert(cancelledDelivery.status === 200 && cancelledDelivery.body.success, `Delivery cancel failed (${cancelledDelivery.status}): ${cancelledDelivery.body.message || 'unexpected response'}`);
    const deliveryStatus = (await pool.request().input('Id', sql.Int, delivery.id).query('SELECT Status FROM dbWMS.dbo.DeliveryOrders WHERE DeliveryId=@Id')).recordset[0]?.Status;
    assert(deliveryStatus === 'CANCELLED', 'Cancelled shipment status was not persisted.');
    assert(round(await snapshotStock(pool, delivery.whid, delivery.productId, delivery.location) - deliveryStockBefore) === 0,
      'Cancelling an unprepared delivery changed source stock.');
    cleanupNotes.push(`Delivery ${delivery.no}: draft reservation was saved, cancellation persisted, stock remained unchanged.`);

    // Delivery-list UI pagination: first create 3 drafts (one page), verify
    // they all appear together, then add 23 more so the same tagged result has
    // 26 rows and crosses the 25-row page boundary. All rows are cancelled and
    // deleted by the dedicated cleanup below; stock is only reserved in DRAFT.
    const pagePayload = index => ({
      requestId: randomUUID(), categoryCode: 'FG', deliveryType: 'CUSTOMER', ownership: 'CUSTOMER',
      whid: pickSource.whid, destinationName: `${tag} page-case-${String(index).padStart(2, '0')}`,
      shippingAddress: 'DEV TEST only', contactName: 'WMS DB pagination test', phone: '0000000000',
      deliveryDate: bangkokToday(), note: `${tag} delivery pagination test`,
      lines: [{ productId: pickSource.ProductId, locationCode: pickSource.LocationCode, quantity: 1 }]
    });
    const createPageTestDraft = async index => {
      const created = await api(`${base}/api/deliveries`, token, pagePayload(index));
      assert(created.status === 201 && created.body.success && created.body.DeliveryId,
        `Pagination draft ${index} failed (${created.status}): ${created.body.message || ''}`);
      deliveryPageTestDocs.push({ id: created.body.DeliveryId, no: created.body.DeliveryNo });
    };
    for (let index = 1; index <= 3; index++) await createPageTestDraft(index);
    const onePage = await api(`${base}/api/deliveries/list?category=FG&type=CUSTOMER&tab=open&status=DRAFT&page=1&search=${encodeURIComponent(tag)}`, token);
    assert(onePage.status === 200 && onePage.body.success && onePage.body.total === 3 && onePage.body.data.length === 3,
      `Three-draft single-page list failed (${onePage.status}); total=${onePage.body.total}, rows=${onePage.body.data?.length}`);
    for (let index = 4; index <= 26; index++) await createPageTestDraft(index);
    const pageOne = await api(`${base}/api/deliveries/list?category=FG&type=CUSTOMER&tab=open&status=DRAFT&page=1&search=${encodeURIComponent(tag)}`, token);
    const pageTwo = await api(`${base}/api/deliveries/list?category=FG&type=CUSTOMER&tab=open&status=DRAFT&page=2&search=${encodeURIComponent(tag)}`, token);
    assert(pageOne.status === 200 && pageOne.body.total === 26 && pageOne.body.data.length === 25,
      `Pagination first page failed (${pageOne.status}); total=${pageOne.body.total}, rows=${pageOne.body.data?.length}`);
    assert(pageTwo.status === 200 && pageTwo.body.total === 26 && pageTwo.body.data.length === 1,
      `Pagination second page failed (${pageTwo.status}); total=${pageTwo.body.total}, rows=${pageTwo.body.data?.length}`);
    const listedIds = [...pageOne.body.data, ...pageTwo.body.data].map(row => row.DeliveryId);
    assert(new Set(listedIds).size === 26 && deliveryPageTestDocs.every(doc => listedIds.includes(doc.id)),
      'Pagination returned duplicate or missing delivery rows across pages.');
    cleanupNotes.push(`Delivery list UI/DB pagination: 3 tagged drafts listed on one page; expanded to 26, listed 25 on page 1 and 1 on page 2 with no duplicates or missing IDs.`);

    // Full inter-warehouse path: reserve -> prepare to source OUT -> dispatch
    // -> destination RCV receipt -> destination putaway. Restore exact stock
    // snapshots and remove only the uniquely identified test transfer.
    const transferCandidate = (await pool.request().query(`
      SELECT TOP(1) s.whid,s.ProductId,s.LocationCode,s.Quantity,p.ProductCode,p.ProductName
      FROM dbWMS.dbo.tblStock s
      JOIN dbMaster.dbo.tblProducts p ON p.ProductId=s.ProductId AND p.IsActive=1
      JOIN dbMaster.dbo.tblCategories c ON c.CategoryID=p.CategoryId AND c.CategoryCode='PKG'
      JOIN dbMaster.dbo.Locations l ON l.whid=s.whid AND l.LocationCode=s.LocationCode AND l.IsActive=1 AND UPPER(l.Zone) IN('A','B','STORAGE')
      WHERE s.Quantity>=2 AND NOT EXISTS(SELECT 1 FROM dbWMS.dbo.StoragePlans h JOIN dbWMS.dbo.StoragePlanLines pl ON pl.PlanId=h.PlanId
        WHERE h.Status='OPEN' AND h.WhId=s.whid AND h.ProductId=s.ProductId AND h.FromLocationCode=s.LocationCode)
        AND NOT EXISTS(SELECT 1 FROM dbWMS.dbo.DeliveryOrders h JOIN dbWMS.dbo.DeliveryLines dl ON dl.DeliveryId=h.DeliveryId
        WHERE h.Status='DRAFT' AND h.WhId=s.whid AND dl.ProductId=s.ProductId AND dl.LocationCode=s.LocationCode)
        AND EXISTS(SELECT 1 FROM dbMaster.dbo.Locations o WHERE o.whid=s.whid AND o.IsActive=1 AND UPPER(o.Zone)='OUT')
      ORDER BY s.Quantity DESC;
    `)).recordset[0];
    assert(transferCandidate, 'No unreserved PKG source stock was available for a reversible transfer test.');
    const destination = (await pool.request().input('Source', sql.Int, transferCandidate.whid).query(`
      SELECT TOP(1) w.whid,
        (SELECT TOP(1) LocationCode FROM dbMaster.dbo.Locations WHERE whid=w.whid AND IsActive=1 AND UPPER(Zone)='RCV' ORDER BY LocationCode) AS RcvLocation,
        (SELECT TOP(1) LocationCode FROM dbMaster.dbo.Locations WHERE whid=w.whid AND IsActive=1 AND UPPER(Zone) IN('A','B','STORAGE') ORDER BY LocationCode) AS PutawayLocation
      FROM dbMaster.dbo.tblWH w WHERE w.whid<>@Source
        AND EXISTS(SELECT 1 FROM dbMaster.dbo.Locations WHERE whid=w.whid AND IsActive=1 AND UPPER(Zone)='RCV')
        AND EXISTS(SELECT 1 FROM dbMaster.dbo.Locations WHERE whid=w.whid AND IsActive=1 AND UPPER(Zone) IN('A','B','STORAGE'))
      ORDER BY w.whid;
    `)).recordset[0];
    assert(destination?.RcvLocation && destination?.PutawayLocation, 'No destination warehouse with active RCV/storage locations is available.');
    const sourceOut = (await pool.request().input('Wh', sql.Int, transferCandidate.whid).query("SELECT TOP(1) LocationCode FROM dbMaster.dbo.Locations WHERE whid=@Wh AND IsActive=1 AND UPPER(Zone)='OUT' ORDER BY LocationCode")).recordset[0]?.LocationCode;
    assert(sourceOut, 'No source OUT location was available for the transfer test.');
    const transferQty = 1;
    for (const [whid, location] of [[transferCandidate.whid, transferCandidate.LocationCode], [transferCandidate.whid, sourceOut], [destination.whid, destination.RcvLocation], [destination.whid, destination.PutawayLocation]]) {
      transferStockBaselines.push({ whid, productId: transferCandidate.ProductId, location, before: await snapshotStock(pool, whid, transferCandidate.ProductId, location) });
    }
    const transferCreated = await api(`${base}/api/deliveries`, token, {
      requestId: randomUUID(), categoryCode: 'PKG', deliveryType: 'WAREHOUSE', ownership: 'COMPANY',
      whid: transferCandidate.whid, destinationWhId: destination.whid,
      destinationName: `${tag} transfer destination`, shippingAddress: 'DEV TEST only',
      contactName: 'WMS DB integration', phone: '0000000000', deliveryDate: bangkokToday(),
      note: `${tag} transfer end-to-end`, lines: [{ productId: transferCandidate.ProductId, locationCode: transferCandidate.LocationCode, quantity: transferQty }]
    });
    assert(transferCreated.status === 201 && transferCreated.body.success && transferCreated.body.DeliveryId,
      `Warehouse transfer creation failed (${transferCreated.status}): ${transferCreated.body.message || 'unexpected response'}`);
    warehouseTransfer = { id: transferCreated.body.DeliveryId, no: transferCreated.body.DeliveryNo,
      productId: transferCandidate.ProductId, sourceWh: transferCandidate.whid, destWh: destination.whid,
      outLocation: sourceOut, rcvLocation: destination.RcvLocation, putawayLocation: destination.PutawayLocation };
    const transferLine = (await pool.request().input('Id', sql.Int, warehouseTransfer.id).query('SELECT TOP(1) LineId FROM dbWMS.dbo.DeliveryLines WHERE DeliveryId=@Id')).recordset[0];
    assert(transferLine?.LineId, 'Warehouse transfer line did not persist.');
    const preparedTransfer = await api(`${base}/api/deliveries/${warehouseTransfer.id}/prepare`, token, { outLocation: sourceOut });
    assert(preparedTransfer.status === 200 && preparedTransfer.body.success, `Transfer prepare failed (${preparedTransfer.status}): ${preparedTransfer.body.message || ''}`);
    const carrierOptions = await api(`${base}/api/deliveries/${warehouseTransfer.id}/carriers`, token);
    const carrier = carrierOptions.body.data?.[0];
    assert(carrierOptions.status === 200 && carrier, 'No active carrier option is compatible with the PKG transfer fixture.');
    const dispatchedTransfer = await api(`${base}/api/deliveries/${warehouseTransfer.id}/dispatch`, token, {
      carrierCode: carrier.tranid, checked: true, trackingNo: `${tag}-TRACK`, vehicleNo: 'DEV', cartons: 1
    });
    assert(dispatchedTransfer.status === 200 && dispatchedTransfer.body.success, `Transfer dispatch failed (${dispatchedTransfer.status}): ${dispatchedTransfer.body.message || ''}`);
    const receivedTransfer = await api(`${base}/api/deliveries/${warehouseTransfer.id}/receive`, token, {
      inboundLocation: destination.RcvLocation, receivedBy: 'WMS DB integration'
    });
    assert(receivedTransfer.status === 200 && receivedTransfer.body.success, `Transfer receive failed (${receivedTransfer.status}): ${receivedTransfer.body.message || ''}`);
    const transferReceipt = (await pool.request().input('Id', sql.Int, warehouseTransfer.id).query('SELECT TOP(1) LineId FROM dbWMS.dbo.WarehouseTransferReceipts WHERE DeliveryId=@Id')).recordset[0];
    assert(transferReceipt?.LineId, 'Warehouse transfer receipt was not persisted.');
    const transferStored = await api(`${base}/api/deliveries/warehouse-workflow/${transferReceipt.LineId}/putaway`, token, {
      toLocationCode: destination.PutawayLocation, quantity: transferQty, requestId: randomUUID()
    });
    assert(transferStored.status === 200 && transferStored.body.success, `Transfer putaway failed (${transferStored.status}): ${transferStored.body.message || ''}`);
    const transferState = (await pool.request().input('Id', sql.Int, warehouseTransfer.id).query(`
      SELECT h.Status,h.Prepared,r.ReceivedQuantity,r.StoredQuantity FROM dbWMS.dbo.DeliveryOrders h
      JOIN dbWMS.dbo.WarehouseTransferReceipts r ON r.DeliveryId=h.DeliveryId WHERE h.DeliveryId=@Id;
    `)).recordset[0];
    assert(transferState?.Status === 'RECEIVED' && transferState.Prepared === true
      && round(transferState.ReceivedQuantity) === transferQty && round(transferState.StoredQuantity) === transferQty,
      'Warehouse transfer did not reach received and fully stored state.');
    cleanupNotes.push(`Warehouse transfer ${warehouseTransfer.no}: prepared, dispatched, received in destination RCV and put away; verified receipt/storage quantities.`);

    // Real customer shipment + physical customer-return lifecycle.
    const returnRcv = (await pool.request().input('Wh', sql.Int, pickSource.whid)
      .query("SELECT TOP(1) LocationCode FROM dbMaster.dbo.Locations WHERE whid=@Wh AND IsActive=1 AND UPPER(Zone)='RCV' ORDER BY LocationCode")).recordset[0]?.LocationCode;
    const returnTarget = (await pool.request().input('Wh', sql.Int, pickSource.whid)
      .query("SELECT TOP(1) LocationCode FROM dbMaster.dbo.Locations WHERE whid=@Wh AND IsActive=1 AND UPPER(Zone) IN('A','B','STORAGE') ORDER BY LocationCode")).recordset[0]?.LocationCode;
    assert(returnRcv && returnTarget, 'No active RCV/storage locations for the customer-return scenario.');
    for (const location of new Set([pickSource.LocationCode, pickSource.outLocation, returnRcv, returnTarget])) {
      returnStockBaselines.push({ whid: pickSource.whid, productId: pickSource.ProductId, location,
        before: await snapshotStock(pool, pickSource.whid, pickSource.ProductId, location) });
    }
    const customerOrder = await api(`${base}/api/deliveries`, token, {
      requestId: randomUUID(), categoryCode: 'FG', deliveryType: 'CUSTOMER', ownership: 'CUSTOMER',
      whid: pickSource.whid, destinationName: `${tag} customer return test`, shippingAddress: 'DEV TEST only',
      contactName: 'WMS DB integration', phone: '0000000000', deliveryDate: bangkokToday(),
      note: `${tag} customer shipment and physical return`,
      lines: [{ productId: pickSource.ProductId, locationCode: pickSource.LocationCode, quantity: 1 }]
    });
    assert(customerOrder.status === 201 && customerOrder.body.success && customerOrder.body.DeliveryId,
      `Customer shipment creation failed (${customerOrder.status}): ${customerOrder.body.message || ''}`);
    customerReturnShipment = { id: customerOrder.body.DeliveryId, no: customerOrder.body.DeliveryNo };
    const customerLine = (await pool.request().input('Id', sql.Int, customerReturnShipment.id)
      .query('SELECT TOP(1) LineId FROM dbWMS.dbo.DeliveryLines WHERE DeliveryId=@Id')).recordset[0];
    assert(customerLine?.LineId, 'Customer shipment line did not persist.');
    const customerPrepared = await api(`${base}/api/deliveries/${customerReturnShipment.id}/prepare`, token, { outLocation: pickSource.outLocation });
    assert(customerPrepared.status === 200 && customerPrepared.body.success, `Customer shipment prepare failed (${customerPrepared.status}): ${customerPrepared.body.message || ''}`);
    const customerCarriers = await api(`${base}/api/deliveries/${customerReturnShipment.id}/carriers`, token);
    const customerCarrier = customerCarriers.body.data?.[0];
    assert(customerCarriers.status === 200 && customerCarrier, 'No compatible customer shipment carrier was available.');
    const customerDispatched = await api(`${base}/api/deliveries/${customerReturnShipment.id}/dispatch`, token, {
      carrierCode: customerCarrier.tranid, checked: true, trackingNo: `${tag}-SHIP`, vehicleNo: 'DEV', cartons: 1
    });
    assert(customerDispatched.status === 200 && customerDispatched.body.success, `Customer dispatch failed (${customerDispatched.status}): ${customerDispatched.body.message || ''}`);
    const customerReceived = await api(`${base}/api/deliveries/${customerReturnShipment.id}/receive`, token, { receivedBy: 'WMS DB integration' });
    assert(customerReceived.status === 200 && customerReceived.body.success, `Customer delivery acknowledgement failed (${customerReceived.status}): ${customerReceived.body.message || ''}`);
    // Customer documents may return independently from physical goods. Verify
    // that recording returned PO/invoice/signed delivery documents is persisted
    // without changing stock before exercising the combined goods-return path.
    const stockBeforeDocumentReturn = await snapshotStock(pool, pickSource.whid, pickSource.ProductId, pickSource.LocationCode);
    const documentsReturned = await api(`${base}/api/deliveries/${customerReturnShipment.id}/returned-documents`, token, {
      poNo: `${tag}-PO`, invoiceNo: `${tag}-INV`, hasPo: true, hasInvoice: true,
      hasSignedDelivery: true, note: `${tag} documents-only return check`
    });
    assert(documentsReturned.status === 200 && documentsReturned.body.success && documentsReturned.body.complete,
      `Customer returned documents failed (${documentsReturned.status}): ${documentsReturned.body.message || ''}`);
    const returnedDocumentRow = (await pool.request().input('Id', sql.Int, customerReturnShipment.id).query(`
      SELECT PoNo,InvoiceNo,HasPo,HasInvoice,HasSignedDelivery FROM dbWMS.dbo.CustomerDeliveryDocumentReturns WHERE DeliveryId=@Id;
    `)).recordset[0];
    assert(returnedDocumentRow?.PoNo === `${tag}-PO` && returnedDocumentRow.InvoiceNo === `${tag}-INV`
      && returnedDocumentRow.HasPo === true && returnedDocumentRow.HasInvoice === true
      && returnedDocumentRow.HasSignedDelivery === true, 'Returned customer documents were not persisted correctly.');
    assert(round(await snapshotStock(pool, pickSource.whid, pickSource.ProductId, pickSource.LocationCode) - stockBeforeDocumentReturn) === 0,
      'Returning documents only changed stock quantity.');
    const returnCase = await api(`${base}/api/deliveries/${customerReturnShipment.id}/customer-returns`, token, {
      requestId: randomUUID(), note: `${tag} physical return`, poNo: '', invoiceNo: '', creditNoteNo: '',
      lines: [{ lineId: customerLine.LineId, quantity: 1, caseType: 'STOCK_RETURN', expectedReturn: true }]
    });
    assert(returnCase.status === 201 && returnCase.body.success && returnCase.body.ReturnId,
      `Customer return case failed (${returnCase.status}): ${returnCase.body.message || ''}`);
    customerReturnShipment.returnId = returnCase.body.ReturnId;
    customerReturnShipment.returnNo = returnCase.body.ReturnNo;
    const returnDispatched = await api(`${base}/api/deliveries/${customerReturnShipment.id}/customer-returns/${customerReturnShipment.returnId}/dispatch`, token,
      { carrier: 'DEV test carrier', trackingNo: `${tag}-RETURN` });
    assert(returnDispatched.status === 200 && returnDispatched.body.success, `Return dispatch failed (${returnDispatched.status}): ${returnDispatched.body.message || ''}`);
    const returnLine = (await pool.request().input('Id', sql.Int, customerReturnShipment.returnId)
      .query('SELECT TOP(1) ReturnLineId FROM dbWMS.dbo.CustomerDeliveryReturnLines WHERE ReturnId=@Id')).recordset[0];
    assert(returnLine?.ReturnLineId, 'Customer return line did not persist.');
    const physicallyReturned = await api(`${base}/api/deliveries/${customerReturnShipment.id}/customer-return-lines/${returnLine.ReturnLineId}/receive`, token,
      { receiptLocation: returnRcv });
    assert(physicallyReturned.status === 200 && physicallyReturned.body.success, `Physical return receipt failed (${physicallyReturned.status}): ${physicallyReturned.body.message || ''}`);
    const returnedStored = await api(`${base}/api/deliveries/${customerReturnShipment.id}/return-lines/${returnLine.ReturnLineId}/putaway`, token,
      { destinationLocation: returnTarget });
    assert(returnedStored.status === 200 && returnedStored.body.success, `Returned goods putaway failed (${returnedStored.status}): ${returnedStored.body.message || ''}`);
    const returnState = (await pool.request().input('Id', sql.Int, returnLine.ReturnLineId).query(`
      SELECT PhysicalReturned,PutawayAt,ReceiptLocationCode,PutawayLocationCode FROM dbWMS.dbo.CustomerDeliveryReturnLines WHERE ReturnLineId=@Id;
    `)).recordset[0];
    assert(returnState?.PhysicalReturned === true && returnState.PutawayAt && returnState.ReceiptLocationCode === returnRcv
      && returnState.PutawayLocationCode === returnTarget, 'Physical return did not finish in destination storage.');
    cleanupNotes.push(`Customer delivery ${customerReturnShipment.no}: cancel-at-draft covered separately; dispatched and acknowledged; documents-only return persisted without stock change; combined documents + physical goods return received at RCV and put away.`);

    const countLocation = (await pool.request().query(`
      SELECT TOP(1) s.whid,s.LocationCode FROM dbWMS.dbo.tblStock s
      WHERE NOT EXISTS(SELECT 1 FROM dbWMS.dbo.CheckSessions c WHERE c.WhId=s.whid AND c.LocationCode=s.LocationCode AND c.Status IN('OPEN','REVIEW'))
        AND NOT EXISTS(SELECT 1 FROM dbWMS.dbo.InventoryCountSessions i WHERE i.WhId=s.whid AND i.LocationCode=s.LocationCode AND i.Status='OPEN')
      ORDER BY s.whid,s.LocationCode;
    `)).recordset[0];
    assert(countLocation, 'No location was available for a cycle-count snapshot integration test.');
    const countCreated = await api(`${base}/api/inventory-counts`, token, {
      requestId: countRequestId, whid: countLocation.whid, locationCode: countLocation.LocationCode
    });
    assert(countCreated.status === 200 && countCreated.body.success && countCreated.body.SessionId,
      `Inventory count creation failed (${countCreated.status}): ${countCreated.body.message || 'unexpected response'}`);
    countSession = { id: countCreated.body.SessionId, requestId: countRequestId };
    const countState = (await pool.request().input('Id', sql.Int, countSession.id).query(`
      SELECT s.Status,COUNT(i.ItemId) AS SnapshotItems FROM dbWMS.dbo.InventoryCountSessions s
      LEFT JOIN dbWMS.dbo.InventoryCountItems i ON i.SessionId=s.SessionId WHERE s.SessionId=@Id GROUP BY s.Status;
    `)).recordset[0];
    assert(countState?.Status === 'OPEN' && countState.SnapshotItems > 0, 'Inventory count snapshot was not persisted.');
    const countCancelled = await api(`${base}/api/inventory-counts/${countSession.id}/cancel`, token, {});
    assert(countCancelled.status === 200 && countCancelled.body.success, 'Inventory count cancel failed.');
    const countStatus = (await pool.request().input('Id', sql.Int, countSession.id).query('SELECT Status FROM dbWMS.dbo.InventoryCountSessions WHERE SessionId=@Id')).recordset[0]?.Status;
    assert(countStatus === 'CANCELLED', 'Inventory count cancellation was not persisted.');
    cleanupNotes.push(`Cycle count session ${countSession.id}: stock snapshot saved, cancelled, stock unchanged.`);
  } finally {
    try {
      const genericPicks = [];
      for (const requestId of Object.values(genericRequestIds)) {
        const pick = (await pool.request().input('Request', sql.UniqueIdentifier, requestId).query(`
          SELECT PickId,PickNo,WhId,ProductId,FromLocationCode,Quantity FROM dbWMS.dbo.PickOperations WITH(UPDLOCK,HOLDLOCK) WHERE RequestId=@Request;
        `)).recordset[0];
        if (pick) genericPicks.push(pick);
      }
      if (genericPicks.length) {
        const tx = new sql.Transaction(pool);
        await tx.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
        try {
          for (const pick of genericPicks) {
            pickNumbers.push(pick.PickNo);
            await new sql.Request(tx).input('Wh', sql.Int, pick.WhId).input('Product', sql.Int, pick.ProductId)
              .input('Location', sql.NVarChar(50), pick.FromLocationCode).input('Qty', sql.Decimal(18, 2), pick.Quantity)
              .query('UPDATE dbWMS.dbo.tblStock WITH(UPDLOCK,HOLDLOCK) SET Quantity=Quantity+@Qty,UpdatedAt=SYSDATETIME() WHERE whid=@Wh AND ProductId=@Product AND LocationCode=@Location');
            await new sql.Request(tx).input('No', sql.NVarChar(60), pick.PickNo).input('Actor', sql.NVarChar(50), 'WMS-DB-IT')
              .query("DELETE FROM dbWMS.dbo.tblStockTransactions WHERE RefDocNo=@No AND CreatedBy=@Actor AND TransType='PICK'");
            await new sql.Request(tx).input('Id', sql.Int, pick.PickId).query('DELETE FROM dbWMS.dbo.PickOperations WHERE PickId=@Id');
          }
          await tx.commit();
          cleanupNotes.push(`Removed ${genericPicks.length} PKG/SEMI test picks and restored source stock.`);
        } catch (error) { await tx.rollback(); throw error; }
      }
    } catch (error) { cleanupErrors.push(`PKG/SEMI cleanup error: ${error.message}`); }

    // Remove only records created by this run and reverse its two pick legs.
    try {
      const picks = (await pool.request().input('First', sql.UniqueIdentifier, batchIds[0]).input('Second', sql.UniqueIdentifier, batchIds[1]).query(`
        SELECT PickId,PickNo,WhId,ProductId,FromLocationCode,ToLocationCode,Quantity
        FROM dbWMS.dbo.PickOperations WITH(UPDLOCK,HOLDLOCK) WHERE RequestId IN(@First,@Second);
      `)).recordset;
      pickNumbers.push(...picks.map(x => x.PickNo).filter(x => !pickNumbers.includes(x)));
      if (picks.length) {
        const tx = new sql.Transaction(pool);
        await tx.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
        try {
          for (const pick of picks) {
            const qty = Number(pick.Quantity);
            await new sql.Request(tx).input('Wh', sql.Int, pick.WhId).input('Product', sql.Int, pick.ProductId)
              .input('From', sql.NVarChar(50), pick.FromLocationCode).input('Qty', sql.Decimal(18, 2), qty)
              .query('UPDATE dbWMS.dbo.tblStock WITH(UPDLOCK,HOLDLOCK) SET Quantity=Quantity+@Qty,UpdatedAt=SYSDATETIME() WHERE whid=@Wh AND ProductId=@Product AND LocationCode=@From');
            await new sql.Request(tx).input('Wh', sql.Int, pick.WhId).input('Product', sql.Int, pick.ProductId)
              .input('To', sql.NVarChar(50), pick.ToLocationCode).input('Qty', sql.Decimal(18, 2), qty)
              .query(`UPDATE dbWMS.dbo.tblStock WITH(UPDLOCK,HOLDLOCK) SET Quantity=Quantity-@Qty,UpdatedAt=SYSDATETIME() WHERE whid=@Wh AND ProductId=@Product AND LocationCode=@To AND Quantity>=@Qty; IF @@ROWCOUNT<>1 THROW 51000,N'Integration cleanup could not reverse the OUT quantity',1;`);
            await new sql.Request(tx).input('No', sql.NVarChar(60), pick.PickNo).input('Actor', sql.NVarChar(50), 'WMS-DB-IT')
              .query("DELETE FROM dbWMS.dbo.tblStockTransactions WHERE RefDocNo=@No AND CreatedBy=@Actor AND TransType='PICK'; DELETE FROM dbWMS.dbo.FGLotPickLines WHERE PickId IN(SELECT PickId FROM dbWMS.dbo.PickOperations WHERE PickNo=@No);");
            await new sql.Request(tx).input('Id', sql.Int, pick.PickId).query('DELETE FROM dbWMS.dbo.PickOperations WHERE PickId=@Id');
          }
          await tx.commit();
          cleanupNotes.push(`Removed ${picks.length} FG test pick rows and reversed their stock movements.`);
        } catch (error) { await tx.rollback(); throw error; }
      }
    } catch (error) { cleanupErrors.push(`FG cleanup error: ${error.message}`); }

    if (deliveryPageTestDocs.length) {
      try {
        const tx = new sql.Transaction(pool);
        await tx.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
        try {
          for (const doc of deliveryPageTestDocs) {
            await new sql.Request(tx).input('Id', sql.Int, doc.id).query(`
              DELETE FROM dbWMS.dbo.DeliveryAudit WHERE DeliveryId=@Id;
              DELETE FROM dbWMS.dbo.DeliveryContainers WHERE DeliveryId=@Id;
              DELETE FROM dbWMS.dbo.DeliveryLines WHERE DeliveryId=@Id;
              DELETE FROM dbWMS.dbo.DeliveryOrders WHERE DeliveryId=@Id AND Status='DRAFT';
            `);
          }
          await tx.commit();
          const remaining = (await pool.request().input('Tag', sql.NVarChar(100), `${tag} page-case-%`).query(`
            SELECT COUNT(*) AS Total FROM dbWMS.dbo.DeliveryOrders WHERE DestinationName LIKE @Tag;
          `)).recordset[0].Total;
          assert(Number(remaining) === 0, `Pagination test cleanup left ${remaining} draft delivery rows.`);
          cleanupNotes.push(`Removed ${deliveryPageTestDocs.length} tagged pagination drafts after one-page/multi-page verification; no stock was moved.`);
        } catch (error) { await tx.rollback(); throw error; }
      } catch (error) { cleanupErrors.push(`Delivery pagination cleanup error: ${error.message}`); }
    }

    if (!delivery) {
      try {
        const created = (await pool.request().input('Tag', sql.NVarChar(60), `${tag}%`).query(`
          SELECT TOP(1) DeliveryId,DeliveryNo,RequestId,WhId FROM dbWMS.dbo.DeliveryOrders WHERE Note LIKE @Tag;
        `)).recordset[0];
        if (created) delivery = { id: created.DeliveryId, no: created.DeliveryNo, requestId: created.RequestId, whid: created.WhId, productId: pickSource?.ProductId, location: pickSource?.LocationCode };
      } catch (error) { cleanupErrors.push(`Delivery recovery lookup error: ${error.message}`); }
    }
    if (delivery) {
      try {
        const cancelled = await api(`${base}/api/deliveries/${delivery.id}/cancel`, token, {});
        assert(cancelled.status === 200 && cancelled.body.success, `Delivery safety cancellation failed (${cancelled.status}); records will be retained.`);
        const tx = new sql.Transaction(pool);
        await tx.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
        try {
          await new sql.Request(tx).input('Id', sql.Int, delivery.id).query(`
            DELETE FROM dbWMS.dbo.DeliveryAudit WHERE DeliveryId=@Id;
            DELETE FROM dbWMS.dbo.DeliveryContainers WHERE DeliveryId=@Id;
            DELETE FROM dbWMS.dbo.DeliveryLines WHERE DeliveryId=@Id;
            DELETE FROM dbWMS.dbo.DeliveryOrders WHERE DeliveryId=@Id;
          `);
          await tx.commit();
          const leftovers = (await pool.request().input('Request', sql.UniqueIdentifier, delivery.requestId)
            .query('SELECT COUNT(*) AS Total FROM dbWMS.dbo.DeliveryOrders WHERE RequestId=@Request')).recordset[0].Total;
          assert(leftovers === 0, 'Delivery cleanup did not remove the test document.');
          cleanupNotes.push(`Removed delivery test document ${delivery.no} and its audit/line rows.`);
        } catch (error) { await tx.rollback(); throw error; }
      } catch (error) { cleanupErrors.push(`Delivery cleanup error: ${error.message}`); }
    }

    if (warehouseTransfer) {
      try {
        for (const baseline of transferStockBaselines) {
          await restoreStockQuantity(pool, baseline.whid, baseline.productId, baseline.location, baseline.before);
        }
        const tx = new sql.Transaction(pool);
        await tx.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
        try {
          await new sql.Request(tx).input('Id', sql.Int, warehouseTransfer.id).input('No', sql.NVarChar(60), warehouseTransfer.no).query(`
            DELETE FROM dbWMS.dbo.tblStockTransactions WHERE RefDocNo=@No;
            DELETE FROM dbWMS.dbo.WarehouseTransferStorage WHERE LineId IN(SELECT LineId FROM dbWMS.dbo.WarehouseTransferReceipts WHERE DeliveryId=@Id);
            DELETE FROM dbWMS.dbo.WarehouseTransferReceipts WHERE DeliveryId=@Id;
            DELETE FROM dbWMS.dbo.DeliveryCustody WHERE LineId IN(SELECT LineId FROM dbWMS.dbo.DeliveryLines WHERE DeliveryId=@Id);
            DELETE FROM dbWMS.dbo.DeliveryAudit WHERE DeliveryId=@Id;
            DELETE FROM dbWMS.dbo.DeliveryContainers WHERE DeliveryId=@Id;
            DELETE FROM dbWMS.dbo.DeliveryLines WHERE DeliveryId=@Id;
            DELETE FROM dbWMS.dbo.DeliveryOrders WHERE DeliveryId=@Id;
          `);
          await tx.commit();
          cleanupNotes.push(`Removed transfer ${warehouseTransfer.no} and restored source/OUT/destination RCV/storage snapshots.`);
        } catch (error) { await tx.rollback(); throw error; }
      } catch (error) { cleanupErrors.push(`Warehouse transfer cleanup error: ${error.message}`); }
    }

    if (customerReturnShipment) {
      try {
        for (const baseline of returnStockBaselines) {
          await restoreStockQuantity(pool, baseline.whid, baseline.productId, baseline.location, baseline.before);
        }
        const tx = new sql.Transaction(pool);
        await tx.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
        try {
          await new sql.Request(tx).input('Id', sql.Int, customerReturnShipment.id)
            .input('ReturnNo', sql.NVarChar(60), customerReturnShipment.returnNo || '').query(`
              DELETE FROM dbWMS.dbo.tblStockTransactions WHERE RefDocNo IN(
                (SELECT DeliveryNo FROM dbWMS.dbo.DeliveryOrders WHERE DeliveryId=@Id),@ReturnNo);
              DELETE FROM dbWMS.dbo.CustomerDeliveryReturnLines WHERE ReturnId IN(SELECT ReturnId FROM dbWMS.dbo.CustomerDeliveryReturns WHERE DeliveryId=@Id);
              DELETE FROM dbWMS.dbo.CustomerDeliveryReturns WHERE DeliveryId=@Id;
              DELETE FROM dbWMS.dbo.CustomerDeliveryDocumentReturns WHERE DeliveryId=@Id;
              DELETE FROM dbWMS.dbo.DeliveryCustody WHERE LineId IN(SELECT LineId FROM dbWMS.dbo.DeliveryLines WHERE DeliveryId=@Id);
              DELETE FROM dbWMS.dbo.DeliveryAudit WHERE DeliveryId=@Id;
              DELETE FROM dbWMS.dbo.DeliveryContainers WHERE DeliveryId=@Id;
              DELETE FROM dbWMS.dbo.DeliveryLines WHERE DeliveryId=@Id;
              DELETE FROM dbWMS.dbo.DeliveryOrders WHERE DeliveryId=@Id;
            `);
          await tx.commit();
          cleanupNotes.push(`Removed customer shipment/return ${customerReturnShipment.no} and restored stock-location snapshots.`);
        } catch (error) { await tx.rollback(); throw error; }
      } catch (error) { cleanupErrors.push(`Customer return cleanup error: ${error.message}`); }
    }

    if (!countSession) {
      try {
        const created = (await pool.request().input('Request', sql.UniqueIdentifier, countRequestId).query('SELECT SessionId FROM dbWMS.dbo.InventoryCountSessions WHERE RequestId=@Request')).recordset[0];
        if (created) countSession = { id: created.SessionId, requestId: countRequestId };
      } catch (error) { cleanupErrors.push(`Cycle count recovery lookup error: ${error.message}`); }
    }
    if (countSession) {
      try {
        await api(`${base}/api/inventory-counts/${countSession.id}/cancel`, token, {});
        const tx = new sql.Transaction(pool);
        await tx.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
        try {
          await new sql.Request(tx).input('Id', sql.Int, countSession.id).query('DELETE FROM dbWMS.dbo.InventoryCountItems WHERE SessionId=@Id; DELETE FROM dbWMS.dbo.InventoryCountSessions WHERE SessionId=@Id');
          await tx.commit();
          cleanupNotes.push(`Removed cycle count test session ${countSession.id} and its snapshot rows.`);
        } catch (error) { await tx.rollback(); throw error; }
      } catch (error) { cleanupErrors.push(`Cycle count cleanup error: ${error.message}`); }
    }

    if (!storagePlan) {
      try {
        const created = (await pool.request().input('Request', sql.UniqueIdentifier, storageRequestId).query('SELECT PlanId,PlanNo FROM dbWMS.dbo.StoragePlans WHERE RequestId=@Request')).recordset[0];
        if (created) storagePlan = { id: created.PlanId, no: created.PlanNo, requestId: storageRequestId };
      } catch (error) { cleanupErrors.push(`Storage plan recovery lookup error: ${error.message}`); }
    }
    if (storagePlan) {
      try {
        const status = (await pool.request().input('Id', sql.Int, storagePlan.id).query('SELECT Status FROM dbWMS.dbo.StoragePlans WHERE PlanId=@Id')).recordset[0]?.Status;
        if (status === 'OPEN') {
          const cancelled = await api(`${base}/api/storage-planner/${storagePlan.id}/cancel`, token, {});
          assert(cancelled.status === 200 && cancelled.body.success, `Putaway safety cancellation failed (${cancelled.status}).`);
        }
        const tx = new sql.Transaction(pool);
        await tx.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
        try {
          await new sql.Request(tx).input('Id', sql.Int, storagePlan.id).query('DELETE FROM dbWMS.dbo.StoragePlanLines WHERE PlanId=@Id; DELETE FROM dbWMS.dbo.StoragePlans WHERE PlanId=@Id');
          await tx.commit();
          cleanupNotes.push(`Removed storage plan test document ${storagePlan.no}.`);
        } catch (error) { await tx.rollback(); throw error; }
      } catch (error) { cleanupErrors.push(`Storage plan cleanup error: ${error.message}`); }
    }

    // Reverse the SEMI putaway movement, then cancel/delete its unique inbound
    // fixture. The generic pick cleanup above first restores the picked unit.
    if (semiPlan && semiStockBaseline) {
      try {
        const b = semiStockBaseline;
        const tx = new sql.Transaction(pool);
        await tx.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
        try {
          await new sql.Request(tx).input('Wh', sql.Int, b.whid).input('P', sql.Int, b.productId)
            .input('From', sql.NVarChar(50), b.putawayLocation).input('To', sql.NVarChar(50), b.rcvLocation)
            .input('Qty', sql.Decimal(18, 2), semiInbound.quantity)
            .query(`UPDATE dbWMS.dbo.tblStock SET Quantity=Quantity-@Qty,UpdatedAt=SYSDATETIME() WHERE whid=@Wh AND ProductId=@P AND LocationCode=@From AND Quantity>=@Qty;
              IF @@ROWCOUNT<>1 THROW 51000,N'SEMI test putaway stock could not be reversed',1;
              UPDATE dbWMS.dbo.tblStock SET Quantity=Quantity+@Qty,UpdatedAt=SYSDATETIME() WHERE whid=@Wh AND ProductId=@P AND LocationCode=@To;`);
          await new sql.Request(tx).input('Plan', sql.Int, semiPlan.id).input('No', sql.NVarChar(60), semiPlan.no)
            .input('Actor', sql.NVarChar(50), 'WMS-DB-IT').query(`
              DELETE FROM dbWMS.dbo.tblStockTransactions WHERE RefDocNo=@No AND CreatedBy=@Actor AND TransType='PUTAWAY';
              DELETE FROM dbWMS.dbo.StorageMoves WHERE LineId IN(SELECT LineId FROM dbWMS.dbo.StoragePlanLines WHERE PlanId=@Plan);
              DELETE FROM dbWMS.dbo.StoragePlanLines WHERE PlanId=@Plan;
              DELETE FROM dbWMS.dbo.StoragePlans WHERE PlanId=@Plan;
            `);
          await tx.commit();
          cleanupNotes.push(`Reversed the SEMI putaway move and removed its plan/movement rows.`);
        } catch (error) { await tx.rollback(); throw error; }
      } catch (error) { cleanupErrors.push(`SEMI putaway cleanup error: ${error.message}`); }
    }

    if (semiInbound) {
      try {
        const reversed = await api(`${base}/api/inbound/${semiInbound.id}/cancel`, token, { reason: `${tag} SEMI cleanup` });
        assert(reversed.status === 200 && reversed.body.success,
          `SEMI inbound reversal failed (${reversed.status}); retaining records for manual review.`);
        const tx = new sql.Transaction(pool);
        await tx.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
        try {
          await new sql.Request(tx).input('Id', sql.Int, semiInbound.id).input('No', sql.NVarChar(60), semiInbound.no)
            .input('Actor', sql.NVarChar(50), 'WMS-DB-IT').query(`
              DELETE FROM dbWMS.dbo.tblStockTransactions WHERE RefDocNo=@No AND CreatedBy=@Actor AND TransType IN('RECEIVE','RECEIVE_CANCEL');
              DELETE FROM dbWMS.dbo.InboundCancelAudit WHERE InboundId=@Id;
              DELETE FROM dbWMS.dbo.InboundReceipts WHERE LineId IN(SELECT LineId FROM dbWMS.dbo.InboundLines WHERE InboundId=@Id);
              DELETE FROM dbWMS.dbo.InboundManufacturerLinks WHERE LineId IN(SELECT LineId FROM dbWMS.dbo.InboundLines WHERE InboundId=@Id);
              DELETE FROM dbWMS.dbo.PurchaseOrderLines WHERE PurchaseOrderId IN(SELECT PurchaseOrderId FROM dbWMS.dbo.PurchaseOrders WHERE InboundId=@Id);
              DELETE FROM dbWMS.dbo.PurchaseOrders WHERE InboundId=@Id;
              DELETE FROM dbWMS.dbo.InboundLines WHERE InboundId=@Id;
              DELETE FROM dbWMS.dbo.InboundOrders WHERE InboundId=@Id;
            `);
          await tx.commit();
          if (semiStockBaseline.rcvBefore === 0) await pool.request().input('Wh', sql.Int, semiStockBaseline.whid)
            .input('P', sql.Int, semiStockBaseline.productId).input('Loc', sql.NVarChar(50), semiStockBaseline.rcvLocation)
            .query('DELETE FROM dbWMS.dbo.tblStock WHERE whid=@Wh AND ProductId=@P AND LocationCode=@Loc AND Quantity=0');
          if (semiStockBaseline.putawayBefore === 0) await pool.request().input('Wh', sql.Int, semiStockBaseline.whid)
            .input('P', sql.Int, semiStockBaseline.productId).input('Loc', sql.NVarChar(50), semiStockBaseline.putawayLocation)
            .query('DELETE FROM dbWMS.dbo.tblStock WHERE whid=@Wh AND ProductId=@P AND LocationCode=@Loc AND Quantity=0');
          cleanupNotes.push(`Removed SEMI inbound/PO test rows and cancelled its receive.`);
        } catch (error) { await tx.rollback(); throw error; }
      } catch (error) { cleanupErrors.push(`SEMI inbound cleanup error: ${error.message}`); }
    }

    if (!inbound) {
      try {
        const created = (await pool.request().input('Request', sql.UniqueIdentifier, inboundRequestId).query(`
          SELECT TOP(1) InboundId,ReceiveNo,WhId FROM dbWMS.dbo.InboundOrders WHERE RequestId=@Request;
        `)).recordset[0];
        if (created) {
          const line = (await pool.request().input('Id', sql.Int, created.InboundId).query('SELECT TOP(1) ProductId FROM dbWMS.dbo.InboundLines WHERE InboundId=@Id')).recordset[0];
          const receiveLocation = (await pool.request().input('Wh', sql.Int, created.WhId).query("SELECT TOP(1) LocationCode FROM dbMaster.dbo.Locations WHERE whid=@Wh AND IsActive=1 AND UPPER(Zone)='RCV' ORDER BY LocationCode")).recordset[0];
          inbound = { id: created.InboundId, no: created.ReceiveNo, requestId: inboundRequestId, whid: created.WhId, productId: line?.ProductId, location: receiveLocation?.LocationCode };
        }
      } catch (error) { cleanupErrors.push(`Inbound recovery lookup error: ${error.message}`); }
    }

    if (inbound) {
      try {
        const reversed = await api(`${base}/api/inbound/${inbound.id}/cancel`, token, { reason: `${tag} cleanup` });
        assert(reversed.status === 200 && reversed.body.success, `Inbound safety reversal failed (${reversed.status}); records will be retained for manual recovery.`);
        const reversedStock = await snapshotStock(pool, inbound.whid, inbound.productId, inbound.location);
        assert(round(reversedStock - inboundBefore) === 0, 'Inbound safety reversal did not return stock to its original quantity; records will be retained.');
        const tx = new sql.Transaction(pool);
        await tx.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
        try {
          const lines = (await new sql.Request(tx).input('Id', sql.Int, inbound.id).query('SELECT LineId FROM dbWMS.dbo.InboundLines WITH(UPDLOCK,HOLDLOCK) WHERE InboundId=@Id')).recordset;
          if (lines.length) {
            const ids = lines.map(x => x.LineId).join(',');
            await new sql.Request(tx).input('No', sql.NVarChar(40), inbound.no).input('Actor', sql.NVarChar(50), 'WMS-DB-IT')
              .query('DELETE FROM dbWMS.dbo.tblStockTransactions WHERE RefDocNo=@No AND CreatedBy=@Actor AND TransType IN(\'RECEIVE\',\'RECEIVE_CANCEL\')');
            await new sql.Request(tx).input('Id', sql.Int, inbound.id).input('No', sql.NVarChar(40), inbound.no)
              .query(`DELETE FROM dbWMS.dbo.InboundCancelAudit WHERE InboundId=@Id;
                DELETE FROM dbWMS.dbo.InboundReceipts WHERE LineId IN(${ids});
                DELETE FROM dbWMS.dbo.InboundManufacturerLinks WHERE LineId IN(${ids});
                DELETE FROM dbWMS.dbo.RMInboundPacks WHERE LineId IN(${ids});
                DELETE FROM dbWMS.dbo.InboundProductionInfo WHERE InboundId=@Id;
                DELETE FROM dbWMS.dbo.PurchaseOrders WHERE InboundId=@Id;
                DELETE FROM dbWMS.dbo.InboundLines WHERE InboundId=@Id;
                DELETE FROM dbWMS.dbo.InboundOrders WHERE InboundId=@Id;
              `);
          }
          // Cancellation has restored stock; remove only an empty row that this
          // flow created when the location had no matching stock row before.
          if (inboundBefore === 0) await new sql.Request(tx).input('Wh', sql.Int, inbound.whid).input('Product', sql.Int, inbound.productId)
            .input('Location', sql.NVarChar(50), inbound.location).query('DELETE FROM dbWMS.dbo.tblStock WHERE whid=@Wh AND ProductId=@Product AND LocationCode=@Location AND Quantity=0');
          await tx.commit();
          const leftover = (await pool.request().input('Request', sql.UniqueIdentifier, inbound.requestId)
            .query('SELECT COUNT(*) AS Total FROM dbWMS.dbo.InboundOrders WHERE RequestId=@Request')).recordset[0].Total;
          assert(leftover === 0, 'Inbound cleanup did not remove the test document.');
          cleanupNotes.push(`Removed inbound test document ${inbound.no} and its tagged stock movements.`);
        } catch (error) { await tx.rollback(); throw error; }
      } catch (error) { cleanupErrors.push(`Inbound cleanup error: ${error.message}`); }
    }

    if (sourceBefore != null && outBefore != null && pickSource) {
      let sourceAfterCleanup = await snapshotStock(pool, pickSource.whid, pickSource.ProductId, pickSource.LocationCode);
      let outAfterCleanup = await snapshotStock(pool, pickSource.whid, pickSource.ProductId, pickSource.outLocation);
      if (round(sourceAfterCleanup - sourceBefore) !== 0 || round(outAfterCleanup - outBefore) !== 0) {
        await restoreStockQuantity(pool, pickSource.whid, pickSource.ProductId, pickSource.LocationCode, sourceBefore);
        await restoreStockQuantity(pool, pickSource.whid, pickSource.ProductId, pickSource.outLocation, outBefore);
        sourceAfterCleanup = await snapshotStock(pool, pickSource.whid, pickSource.ProductId, pickSource.LocationCode);
        outAfterCleanup = await snapshotStock(pool, pickSource.whid, pickSource.ProductId, pickSource.outLocation);
        cleanupNotes.push('Restored FG source and OUT to their recorded pre-batch snapshots after customer shipment cleanup.');
      }
      if (round(sourceAfterCleanup - sourceBefore) !== 0) cleanupErrors.push(`FG source stock cleanup mismatch: before=${sourceBefore}, after=${sourceAfterCleanup}`);
      if (round(outAfterCleanup - outBefore) !== 0) cleanupErrors.push(`FG OUT stock cleanup mismatch: before=${outBefore}, after=${outAfterCleanup}`);
    }
    for (const baseline of genericPickBaselines) {
      // SEMI's pick baseline is the temporary inbound/putaway fixture. The
      // final baseline for that flow is the original pre-seed RCV/storage pair.
      if (baseline.type === 'SEMI' && semiStockBaseline) continue;
      let after = await snapshotStock(pool, baseline.whid, baseline.ProductId, baseline.LocationCode);
      if (round(after - baseline.before) !== 0) {
        await restoreStockQuantity(pool, baseline.whid, baseline.ProductId, baseline.LocationCode, baseline.before);
        after = await snapshotStock(pool, baseline.whid, baseline.ProductId, baseline.LocationCode);
        cleanupNotes.push(`Restored ${baseline.type} source to its recorded pre-pick quantity after workflow cleanup.`);
      }
      if (round(after - baseline.before) !== 0) cleanupErrors.push(`${baseline.type} stock cleanup mismatch: before=${baseline.before}, after=${after}`);
    }
    if (semiStockBaseline) {
      const b = semiStockBaseline;
      // Exact snapshot restore is the final guard for DEV data, even when an
      // upstream cancel/putaway path has transformed or removed a row.
      await restoreStockQuantity(pool, b.whid, b.productId, b.rcvLocation, b.rcvBefore);
      await restoreStockQuantity(pool, b.whid, b.productId, b.putawayLocation, b.putawayBefore);
      cleanupNotes.push(`Applied final SEMI snapshot restore (${b.rcvBefore} RCV, ${b.putawayBefore} storage).`);
      let rcvAfter = await snapshotStock(pool, b.whid, b.productId, b.rcvLocation);
      let putawayAfter = await snapshotStock(pool, b.whid, b.productId, b.putawayLocation);
      if (round(rcvAfter - b.rcvBefore) !== 0 || round(putawayAfter - b.putawayBefore) !== 0) {
        cleanupErrors.push(`SEMI stock cleanup mismatch: RCV ${b.rcvBefore}->${rcvAfter}, storage ${b.putawayBefore}->${putawayAfter}`);
      }
    }
    if (inbound && inboundBefore != null) {
      const inboundAfterCleanup = await snapshotStock(pool, inbound.whid, inbound.productId, inbound.location);
      if (round(inboundAfterCleanup - inboundBefore) !== 0) cleanupErrors.push(`Inbound stock cleanup mismatch: before=${inboundBefore}, after=${inboundAfterCleanup}`);
    }
    const orphanCounts = (await pool.request().input('Actor', sql.NVarChar(50), 'WMS-DB-IT')
      .input('Tag', sql.NVarChar(60), `${tag}%`).input('Request', sql.UniqueIdentifier, inboundRequestId)
      .input('StorageRequest', sql.UniqueIdentifier, storageRequestId).input('CountRequest', sql.UniqueIdentifier, countRequestId).query(`
      SELECT (SELECT COUNT(*) FROM dbWMS.dbo.PickOperations WHERE CreatedBy=@Actor AND ReferenceNo LIKE @Tag) AS Picks,
        (SELECT COUNT(*) FROM dbWMS.dbo.InboundOrders WHERE RequestId=@Request OR (CreatedBy=@Actor AND ReferenceNo LIKE @Tag)) AS Inbounds,
        (SELECT COUNT(*) FROM dbWMS.dbo.DeliveryOrders WHERE CreatedBy=@Actor AND Note LIKE @Tag) AS Deliveries,
        (SELECT COUNT(*) FROM dbWMS.dbo.StoragePlans WHERE RequestId=@StorageRequest) AS Plans,
        (SELECT COUNT(*) FROM dbWMS.dbo.InventoryCountSessions WHERE RequestId=@CountRequest) AS Counts;
    `)).recordset[0];
    let stockTransactions = 0;
    for (const ref of [...pickNumbers, ...(inbound?.no ? [inbound.no] : [])]) {
      stockTransactions += Number((await pool.request().input('Ref', sql.NVarChar(60), ref).input('Actor', sql.NVarChar(50), 'WMS-DB-IT')
        .query('SELECT COUNT(*) AS Total FROM dbWMS.dbo.tblStockTransactions WHERE RefDocNo=@Ref AND CreatedBy=@Actor')).recordset[0].Total);
    }
    if (orphanCounts.Picks || orphanCounts.Inbounds || orphanCounts.Deliveries || orphanCounts.Plans || orphanCounts.Counts || stockTransactions) cleanupErrors.push(`Test records remain: ${JSON.stringify({ ...orphanCounts, stockTransactions })}`);
    console.log(JSON.stringify({ testTag: tag, cleanup: cleanupNotes, cleanupErrors }, null, 2));
    await new Promise(resolve => server.close(resolve));
    await pool.close();
  }

  if (cleanupErrors.length) throw new Error(cleanupErrors.join('; '));
  console.log(JSON.stringify({ success: true, server: identity.ServerName, database: 'dbWMS', testTag: tag, checks: cleanupNotes }, null, 2));
}

run().catch(error => {
  console.error(JSON.stringify({ success: false, testTag: tag, error: error.message }, null, 2));
  process.exitCode = 1;
});
