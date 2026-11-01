const express = require('express');
const jwt = require('jsonwebtoken');
const { poolPromise, sql } = require('../config/db');

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || 'super_secret_local_warehouse_jwt_key_2026';

function authenticate(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ success: false, message: 'กรุณาเข้าสู่ระบบ' });
  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return res.status(403).json({ success: false, isExpired: true, message: 'เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่' });
    req.user = user;
    next();
  });
}

function hasReceivePermission(user) {
  const role = String(user.role || '').toUpperCase();
  const permissions = String(user.permissions || '').split(',').map(value => value.trim().toUpperCase());
  return ['ADMIN', 'POWERUSER'].includes(role) || permissions.includes('ALL') || permissions.includes('RECEIVE');
}

function requireReceivePermission(req, res, next) {
  if (!hasReceivePermission(req.user)) return res.status(403).json({ success: false, message: 'ไม่มีสิทธิ์รับสินค้า (RECEIVE)' });
  next();
}

function requireAdminOrPowerUser(req, res, next) {
  if (!['ADMIN', 'POWERUSER'].includes(String(req.user.role || '').toUpperCase())) return res.status(403).json({ success: false, message: 'เฉพาะ ADMIN หรือ POWERUSER เท่านั้น' });
  next();
}

let receivingSchemaPromise;
async function ensureReceivingSchema() {
  if (receivingSchemaPromise) return receivingSchemaPromise;
  receivingSchemaPromise = (async () => {
  const pool = await poolPromise;
  await pool.request().query(`
    IF OBJECT_ID('dbo.ReceiveOrders', 'U') IS NULL
    BEGIN
      CREATE TABLE dbo.ReceiveOrders (
        ReceiveId INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
        ReceiveNo NVARCHAR(40) NOT NULL UNIQUE,
        PONumber NVARCHAR(60) NOT NULL UNIQUE,
        SupplierName NVARCHAR(150) NULL,
        Status NVARCHAR(12) NOT NULL CONSTRAINT DF_ReceiveOrders_Status DEFAULT ('OPEN'),
        CreatedBy INT NOT NULL,
        CreatedAt DATETIME2 NOT NULL CONSTRAINT DF_ReceiveOrders_CreatedAt DEFAULT (SYSDATETIME()),
        CompletedAt DATETIME2 NULL,
        CONSTRAINT FK_ReceiveOrders_CreatedBy FOREIGN KEY (CreatedBy) REFERENCES dbo.Users(UserId),
        CONSTRAINT CK_ReceiveOrders_Status CHECK (Status IN ('OPEN','COMPLETED','CANCELLED'))
      );
    END;
    IF OBJECT_ID('dbo.ReceiveOrderLines', 'U') IS NULL
    BEGIN
      CREATE TABLE dbo.ReceiveOrderLines (
        ReceiveLineId INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
        ReceiveId INT NOT NULL,
        ProductId INT NOT NULL,
        OrderedQuantity INT NOT NULL,
        ReceivedQuantity INT NOT NULL CONSTRAINT DF_ReceiveOrderLines_ReceivedQuantity DEFAULT (0),
        CONSTRAINT FK_ReceiveOrderLines_Receive FOREIGN KEY (ReceiveId) REFERENCES dbo.ReceiveOrders(ReceiveId),
        CONSTRAINT FK_ReceiveOrderLines_Product FOREIGN KEY (ProductId) REFERENCES dbo.Products(ProductId),
        CONSTRAINT UQ_ReceiveOrderLines_Receive_Product UNIQUE (ReceiveId, ProductId),
        CONSTRAINT CK_ReceiveOrderLines_OrderedQuantity CHECK (OrderedQuantity > 0),
        CONSTRAINT CK_ReceiveOrderLines_ReceivedQuantity CHECK (ReceivedQuantity >= 0 AND ReceivedQuantity <= OrderedQuantity)
      );
    END;
  `);
  // Upgrade a partially deployed schema without replacing any receiving data.
  const columns = await pool.request().query(`
    SELECT OBJECT_ID('dbo.ReceiveOrders', 'U') AS ReceiveOrdersId,
           COL_LENGTH('dbo.ReceiveOrders', 'CompletedAt') AS CompletedAtLength,
           OBJECT_ID('dbo.ReceiveOrderLines', 'U') AS ReceiveOrderLinesId,
           COL_LENGTH('dbo.ReceiveOrderLines', 'ReceivedQuantity') AS ReceivedQuantityLength
  `);
  const schema = columns.recordset[0];
  if (schema.CompletedAtLength == null) await pool.request().query('ALTER TABLE dbo.ReceiveOrders ADD CompletedAt DATETIME2 NULL');
  if (schema.ReceivedQuantityLength == null) {
    await pool.request().query(`ALTER TABLE dbo.ReceiveOrderLines ADD ReceivedQuantity INT NOT NULL CONSTRAINT DF_ReceiveOrderLines_ReceivedQuantity DEFAULT (0)`);
  }
  await pool.request().query(`
    IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID('dbo.ReceiveOrders') AND name = 'IX_ReceiveOrders_Status_CreatedAt')
      CREATE INDEX IX_ReceiveOrders_Status_CreatedAt ON dbo.ReceiveOrders(Status, CreatedAt DESC);
  `);
  })();
  return receivingSchemaPromise;
}

router.use(authenticate);
router.use(async (req, res, next) => {
  try { await ensureReceivingSchema(); next(); }
  catch (err) {
    console.error('Receiving schema initialization failed:', err);
    res.status(500).json({ success: false, message: `เตรียมฐานข้อมูลรับสินค้าไม่สำเร็จ: ${err.message}` });
  }
});

// Active locations for the receiving handheld; operators do not need location-master access.
router.get('/locations', requireReceivePermission, async (req, res) => {
  try {
    const pool = await poolPromise;
    const result = await pool.request().query('SELECT LocationId, LocationCode, Zone FROM dbo.Locations WHERE IsActive = 1 ORDER BY LocationCode');
    res.json({ success: true, data: result.recordset });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

router.get('/', requireReceivePermission, async (req, res) => {
  try {
    const pool = await poolPromise;
    const operatorOnly = !['ADMIN', 'POWERUSER'].includes(String(req.user.role || '').toUpperCase());
    const result = await pool.request().input('OpenOnly', sql.Bit, operatorOnly ? 1 : 0).query(`
      SELECT o.ReceiveId, o.ReceiveNo, o.PONumber, o.SupplierName, o.Status, o.CreatedAt, o.CompletedAt,
        creator.Username AS CreatedByName,
        COUNT(line.ReceiveLineId) AS TotalLines,
        COALESCE(SUM(line.OrderedQuantity), 0) AS OrderedQuantity,
        COALESCE(SUM(line.ReceivedQuantity), 0) AS ReceivedQuantity
      FROM dbo.ReceiveOrders o
      JOIN dbo.Users creator ON creator.UserId = o.CreatedBy
      LEFT JOIN dbo.ReceiveOrderLines line ON line.ReceiveId = o.ReceiveId
      WHERE (@OpenOnly = 0 OR o.Status = 'OPEN')
      GROUP BY o.ReceiveId, o.ReceiveNo, o.PONumber, o.SupplierName, o.Status, o.CreatedAt, o.CompletedAt, creator.Username
      ORDER BY CASE WHEN o.Status = 'OPEN' THEN 0 ELSE 1 END, o.CreatedAt DESC
    `);
    res.json({ success: true, data: result.recordset });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

router.get('/:id/lines', requireReceivePermission, async (req, res) => {
  const receiveId = Number.parseInt(req.params.id, 10);
  if (!Number.isInteger(receiveId)) return res.status(400).json({ success: false, message: 'ใบรับสินค้าไม่ถูกต้อง' });
  try {
    const pool = await poolPromise;
    const result = await pool.request().input('ReceiveId', sql.Int, receiveId).query(`
      SELECT o.Status, p.ProductId, p.Barcode, p.ItemCode, p.ItemName, p.UOM,
        line.OrderedQuantity, line.ReceivedQuantity,
        line.OrderedQuantity - line.ReceivedQuantity AS RemainingQuantity
      FROM dbo.ReceiveOrders o
      JOIN dbo.ReceiveOrderLines line ON line.ReceiveId = o.ReceiveId
      JOIN dbo.Products p ON p.ProductId = line.ProductId
    WHERE o.ReceiveId = @ReceiveId
      ORDER BY p.ItemCode
    `);
    const elevated = ['ADMIN', 'POWERUSER'].includes(String(req.user.role || '').toUpperCase());
    if (!elevated && (!hasReceivePermission(req.user) || !result.recordset.length || result.recordset[0].Status !== 'OPEN')) {
      return res.status(403).json({ success: false, message: 'ใบรับสินค้านี้ไม่ได้เปิดให้ Handheld ทำงานแล้ว' });
    }
    if (!result.recordset.length) return res.status(404).json({ success: false, message: 'ไม่พบใบรับสินค้านี้' });
    res.json({ success: true, data: result.recordset });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

router.post('/', requireAdminOrPowerUser, async (req, res) => {
  const poNumber = String(req.body.poNumber || '').trim().toUpperCase();
  const supplierName = String(req.body.supplierName || '').trim();
  const lines = Array.isArray(req.body.lines) ? req.body.lines : [];
  if (!poNumber) return res.status(400).json({ success: false, message: 'กรุณาระบุเลขที่ PO' });
  if (!lines.length) return res.status(400).json({ success: false, message: 'กรุณาเพิ่มสินค้าใน PO อย่างน้อย 1 รายการ' });

  const normalizedLines = lines.map(line => ({
    barcode: String(line.barcode || '').trim(),
    quantity: Number(line.orderedQuantity)
  }));
  if (normalizedLines.some(line => !line.barcode || !Number.isInteger(line.quantity) || line.quantity <= 0)) {
    return res.status(400).json({ success: false, message: 'บาร์โค้ดและจำนวนสั่งซื้อของทุกรายการต้องถูกต้อง' });
  }
  if (new Set(normalizedLines.map(line => line.barcode)).size !== normalizedLines.length) {
    return res.status(400).json({ success: false, message: 'พบสินค้าซ้ำในรายการ กรุณารวมจำนวนให้เหลือหนึ่งบรรทัดต่อสินค้า' });
  }

  const pool = await poolPromise;
  const transaction = new sql.Transaction(pool);
  try {
    await transaction.begin();
    const headerResult = await new sql.Request(transaction)
      .input('PONumber', sql.NVarChar(60), poNumber)
      .input('SupplierName', sql.NVarChar(150), supplierName || null)
      .input('CreatedBy', sql.Int, req.user.id || req.user.userId)
      .input('ReceiveNo', sql.NVarChar(40), `RCV-${Date.now()}-${Math.floor(Math.random() * 900 + 100)}`)
      .query(`INSERT INTO dbo.ReceiveOrders (ReceiveNo, PONumber, SupplierName, CreatedBy)
        OUTPUT INSERTED.ReceiveId VALUES (@ReceiveNo, @PONumber, @SupplierName, @CreatedBy)`);
    const receiveId = headerResult.recordset[0].ReceiveId;
    for (const line of normalizedLines) {
      const result = await new sql.Request(transaction).input('Barcode', sql.NVarChar(50), line.barcode).query('SELECT ProductId FROM dbo.Products WHERE Barcode = @Barcode');
      if (!result.recordset.length) throw new Error(`ไม่พบสินค้า Barcode ${line.barcode}`);
      await new sql.Request(transaction)
        .input('ReceiveId', sql.Int, receiveId)
        .input('ProductId', sql.Int, result.recordset[0].ProductId)
        .input('OrderedQuantity', sql.Int, line.quantity)
        .query('INSERT INTO dbo.ReceiveOrderLines (ReceiveId, ProductId, OrderedQuantity) VALUES (@ReceiveId, @ProductId, @OrderedQuantity)');
    }
    await transaction.commit();
    res.status(201).json({ success: true, receiveId, message: 'สร้างใบรับสินค้าตาม PO และเปิดให้ Handheld รับสินค้าแล้ว' });
  } catch (err) {
    try { await transaction.rollback(); } catch (_) {}
    const duplicate = err.number === 2627 || err.number === 2601;
    res.status(duplicate ? 409 : 400).json({ success: false, message: duplicate ? 'เลขที่ PO นี้มีใบรับสินค้าแล้ว' : err.message });
  }
});

router.post('/:id/receive', requireReceivePermission, async (req, res) => {
  const receiveId = Number.parseInt(req.params.id, 10);
  const barcode = String(req.body.barcode || '').trim();
  const locationCode = String(req.body.locationCode || '').trim().toUpperCase();
  const quantity = Number(req.body.quantity);
  if (!Number.isInteger(receiveId) || !barcode || !locationCode || !Number.isInteger(quantity) || quantity <= 0) {
    return res.status(400).json({ success: false, message: 'กรุณาระบุ PO, บาร์โค้ด, โลเคชั่น และจำนวนรับที่ถูกต้อง' });
  }

  const pool = await poolPromise;
  const transaction = new sql.Transaction(pool);
  try {
    await transaction.begin();
    const request = () => new sql.Request(transaction);
    const orderResult = await request().input('ReceiveId', sql.Int, receiveId).query(`
      SELECT ReceiveNo, PONumber, Status FROM dbo.ReceiveOrders WITH (UPDLOCK, ROWLOCK) WHERE ReceiveId = @ReceiveId
    `);
    if (!orderResult.recordset.length || orderResult.recordset[0].Status !== 'OPEN') throw new Error('ไม่พบใบรับสินค้าที่เปิดอยู่');

    const productResult = await request().input('Barcode', sql.NVarChar(50), barcode).query('SELECT ProductId, ItemCode, ItemName FROM dbo.Products WHERE Barcode = @Barcode');
    if (!productResult.recordset.length) throw new Error(`ไม่พบสินค้า Barcode ${barcode}`);
    const product = productResult.recordset[0];
    const lineResult = await request().input('ReceiveId', sql.Int, receiveId).input('ProductId', sql.Int, product.ProductId).query(`
      SELECT ReceiveLineId, OrderedQuantity, ReceivedQuantity
      FROM dbo.ReceiveOrderLines WITH (UPDLOCK, ROWLOCK)
      WHERE ReceiveId = @ReceiveId AND ProductId = @ProductId
    `);
    if (!lineResult.recordset.length) throw new Error('สินค้านี้ไม่มีอยู่ใน PO ที่เลือก');
    const line = lineResult.recordset[0];
    const remaining = line.OrderedQuantity - line.ReceivedQuantity;
    if (quantity > remaining) throw new Error(`รับเกิน PO ไม่ได้: เหลือรับ ${remaining} ชิ้น`);

    const locationResult = await request().input('LocationCode', sql.NVarChar(50), locationCode).query('SELECT LocationId, LocationCode FROM dbo.Locations WHERE LocationCode = @LocationCode AND IsActive = 1');
    if (!locationResult.recordset.length) throw new Error('ไม่พบโลเคชั่นที่เปิดใช้งาน');
    const location = locationResult.recordset[0];

    await request().input('ReceiveLineId', sql.Int, line.ReceiveLineId).input('Quantity', sql.Int, quantity)
      .query('UPDATE dbo.ReceiveOrderLines SET ReceivedQuantity = ReceivedQuantity + @Quantity WHERE ReceiveLineId = @ReceiveLineId');
    await request().input('ProductId', sql.Int, product.ProductId).input('LocationId', sql.Int, location.LocationId).input('Quantity', sql.Int, quantity).query(`
      MERGE dbo.Stock WITH (HOLDLOCK) AS target
      USING (SELECT @ProductId AS ProductId, @LocationId AS LocationId) AS source
      ON target.ProductId = source.ProductId AND target.LocationId = source.LocationId
      WHEN MATCHED THEN UPDATE SET target.Quantity = target.Quantity + @Quantity, target.LastUpdated = GETDATE()
      WHEN NOT MATCHED THEN INSERT (ProductId, LocationId, Quantity, LastUpdated) VALUES (@ProductId, @LocationId, @Quantity, GETDATE());
    `);
    await request()
      .input('ProductId', sql.Int, product.ProductId)
      .input('LocationId', sql.Int, location.LocationId)
      .input('Quantity', sql.Int, quantity)
      .input('ReferenceNo', sql.NVarChar(100), `${orderResult.recordset[0].PONumber}/${orderResult.recordset[0].ReceiveNo}`)
      .input('UserId', sql.Int, req.user.id || req.user.userId)
      .query(`INSERT INTO dbo.StockTransactions (TransactionType, ProductId, FromLocationId, ToLocationId, Quantity, ReferenceNo, UserId)
        VALUES (N'RECEIVE', @ProductId, NULL, @LocationId, @Quantity, @ReferenceNo, @UserId)`);

    const completion = await request().input('ReceiveId', sql.Int, receiveId).query(`
      SELECT COUNT(*) AS RemainingLines FROM dbo.ReceiveOrderLines
      WHERE ReceiveId = @ReceiveId AND ReceivedQuantity < OrderedQuantity;
      UPDATE dbo.ReceiveOrders SET Status = 'COMPLETED', CompletedAt = SYSDATETIME()
      WHERE ReceiveId = @ReceiveId AND NOT EXISTS (
        SELECT 1 FROM dbo.ReceiveOrderLines WHERE ReceiveId = @ReceiveId AND ReceivedQuantity < OrderedQuantity
      );
    `);
    await transaction.commit();
    res.json({ success: true, message: 'รับสินค้าเข้าสต็อกแล้ว', completed: completion.recordset[0].RemainingLines === 0, item: product, locationCode });
  } catch (err) {
    try { await transaction.rollback(); } catch (_) {}
    res.status(400).json({ success: false, message: err.message });
  }
});

module.exports = router;
