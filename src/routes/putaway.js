const express = require('express');
const jwt = require('jsonwebtoken');
const { poolPromise, sql } = require('../config/db');

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || 'super_secret_local_warehouse_jwt_key_2026';
const elevatedRoles = ['ADMIN', 'POWERUSER'];

function authenticate(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ success: false, message: 'กรุณาเข้าสู่ระบบ' });
  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return res.status(403).json({ success: false, isExpired: true, message: 'เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่' });
    req.user = user;
    next();
  });
}

function hasPutawayPermission(user) {
  const role = String(user.role || '').toUpperCase();
  const permissions = String(user.permissions || '').split(',').map(value => value.trim().toUpperCase());
  return elevatedRoles.includes(role) || permissions.includes('ALL') || permissions.includes('PUTAWAY');
}

function requirePutaway(req, res, next) {
  if (!hasPutawayPermission(req.user)) return res.status(403).json({ success: false, message: 'ไม่มีสิทธิ์ทำรายการ PUTAWAY' });
  next();
}

function requirePlanner(req, res, next) {
  if (!elevatedRoles.includes(String(req.user.role || '').toUpperCase())) {
    return res.status(403).json({ success: false, message: 'เฉพาะ ADMIN หรือ POWERUSER เท่านั้นที่สร้างและยกเลิกใบงานได้' });
  }
  next();
}

let schemaPromise;
async function ensurePutawaySchema() {
  if (schemaPromise) return schemaPromise;
  schemaPromise = (async () => {
    const pool = await poolPromise;
    await pool.request().query(`
      IF OBJECT_ID('dbo.PutawayTasks', 'U') IS NULL
      BEGIN
        CREATE TABLE dbo.PutawayTasks (
          TaskId INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_PutawayTasks PRIMARY KEY,
          TaskNo NVARCHAR(40) NOT NULL CONSTRAINT UQ_PutawayTasks_TaskNo UNIQUE,
          SourceReceiveId INT NULL,
          Status NVARCHAR(20) NOT NULL CONSTRAINT DF_PutawayTasks_Status DEFAULT ('OPEN'),
          Note NVARCHAR(300) NULL,
          CreatedBy INT NOT NULL,
          CreatedAt DATETIME2 NOT NULL CONSTRAINT DF_PutawayTasks_CreatedAt DEFAULT (SYSDATETIME()),
          StartedAt DATETIME2 NULL,
          CompletedAt DATETIME2 NULL,
          CancelledAt DATETIME2 NULL,
          CONSTRAINT FK_PutawayTasks_CreatedBy FOREIGN KEY (CreatedBy) REFERENCES dbo.Users(UserId),
          CONSTRAINT CK_PutawayTasks_Status CHECK (Status IN ('OPEN','IN_PROGRESS','COMPLETED','CANCELLED'))
        );
      END;
    `);
    await pool.request().query(`
      IF OBJECT_ID('dbo.PutawayTaskLines', 'U') IS NULL
      BEGIN
        CREATE TABLE dbo.PutawayTaskLines (
          TaskLineId INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_PutawayTaskLines PRIMARY KEY,
          TaskId INT NOT NULL,
          ProductId INT NOT NULL,
          FromLocationId INT NOT NULL,
          ToLocationId INT NOT NULL,
          PlannedQuantity INT NOT NULL,
          MovedQuantity INT NOT NULL CONSTRAINT DF_PutawayTaskLines_MovedQuantity DEFAULT (0),
          UnitVolumeCm3 DECIMAL(18,3) NULL,
          CONSTRAINT FK_PutawayTaskLines_Task FOREIGN KEY (TaskId) REFERENCES dbo.PutawayTasks(TaskId),
          CONSTRAINT FK_PutawayTaskLines_Product FOREIGN KEY (ProductId) REFERENCES dbo.Products(ProductId),
          CONSTRAINT FK_PutawayTaskLines_FromLocation FOREIGN KEY (FromLocationId) REFERENCES dbo.Locations(LocationId),
          CONSTRAINT FK_PutawayTaskLines_ToLocation FOREIGN KEY (ToLocationId) REFERENCES dbo.Locations(LocationId),
          CONSTRAINT UQ_PutawayTaskLines UNIQUE (TaskId, ProductId, FromLocationId, ToLocationId),
          CONSTRAINT CK_PutawayTaskLines_Quantity CHECK (PlannedQuantity > 0 AND MovedQuantity >= 0 AND MovedQuantity <= PlannedQuantity),
          CONSTRAINT CK_PutawayTaskLines_Locations CHECK (FromLocationId <> ToLocationId)
        );
      END;
    `);
    await pool.request().query(`IF COL_LENGTH('dbo.Products', 'UnitVolumeCm3') IS NULL ALTER TABLE dbo.Products ADD UnitVolumeCm3 DECIMAL(18,3) NULL;`);
    await pool.request().query(`IF COL_LENGTH('dbo.Locations', 'CapacityVolumeCm3') IS NULL ALTER TABLE dbo.Locations ADD CapacityVolumeCm3 DECIMAL(18,3) NULL;`);
    await pool.request().query(`IF COL_LENGTH('dbo.PutawayTaskLines', 'UnitVolumeCm3') IS NULL ALTER TABLE dbo.PutawayTaskLines ADD UnitVolumeCm3 DECIMAL(18,3) NULL;`);
    await pool.request().query(`
      IF COL_LENGTH('dbo.PutawayTasks', 'SourceReceiveId') IS NULL
        ALTER TABLE dbo.PutawayTasks ADD SourceReceiveId INT NULL;
    `);
    await pool.request().query(`
      IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE parent_object_id = OBJECT_ID('dbo.PutawayTasks') AND name = 'FK_PutawayTasks_Receive')
        ALTER TABLE dbo.PutawayTasks WITH CHECK ADD CONSTRAINT FK_PutawayTasks_Receive FOREIGN KEY (SourceReceiveId) REFERENCES dbo.ReceiveOrders(ReceiveId);
    `);
    await pool.request().query(`
      IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID('dbo.PutawayTasks') AND name = 'IX_PutawayTasks_Status_CreatedAt')
        CREATE INDEX IX_PutawayTasks_Status_CreatedAt ON dbo.PutawayTasks(Status, CreatedAt DESC);
      IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID('dbo.PutawayTaskLines') AND name = 'IX_PutawayTaskLines_Product_Source')
        CREATE INDEX IX_PutawayTaskLines_Product_Source ON dbo.PutawayTaskLines(ProductId, FromLocationId, TaskId);
    `);
  })();
  try { return await schemaPromise; }
  catch (err) { schemaPromise = null; throw err; }
}

router.use(authenticate);
router.use(async (req, res, next) => {
  try { await ensurePutawaySchema(); next(); }
  catch (err) {
    console.error('PUTAWAY schema initialization failed:', err);
    res.status(500).json({ success: false, message: `เตรียมฐานข้อมูล PUTAWAY ไม่สำเร็จ: ${err.message}` });
  }
});

router.get('/locations', requirePutaway, async (_req, res) => {
  try {
    const pool = await poolPromise;
    const result = await pool.request().query(`
      SELECT l.LocationId, l.LocationCode, l.Zone, l.CapacityVolumeCm3,
        COALESCE(SUM(CASE WHEN p.UnitVolumeCm3 IS NOT NULL THEN s.Quantity * p.UnitVolumeCm3 ELSE 0 END), 0) AS UsedVolumeCm3,
        COALESCE(SUM(CASE WHEN s.Quantity > 0 AND p.UnitVolumeCm3 IS NULL THEN 1 ELSE 0 END), 0) AS UnmeasuredProducts
      FROM dbo.Locations l LEFT JOIN dbo.Stock s ON s.LocationId = l.LocationId AND s.Quantity > 0
      LEFT JOIN dbo.Products p ON p.ProductId = s.ProductId
      WHERE l.IsActive = 1
      GROUP BY l.LocationId, l.LocationCode, l.Zone, l.CapacityVolumeCm3
      ORDER BY l.LocationCode
    `);
    res.json({ success: true, data: result.recordset });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

router.get('/', requirePutaway, async (req, res) => {
  try {
    const pool = await poolPromise;
    const elevated = elevatedRoles.includes(String(req.user.role || '').toUpperCase());
    const result = await pool.request().input('Planner', sql.Bit, elevated ? 1 : 0).query(`
      SELECT t.TaskId, t.TaskNo, t.SourceReceiveId, ro.PONumber, ro.ReceiveNo, t.Status, t.Note, t.CreatedAt, t.StartedAt, t.CompletedAt, t.CancelledAt,
        creator.Username AS CreatedByName,
        COUNT(l.TaskLineId) AS TotalLines,
        COALESCE(SUM(l.PlannedQuantity), 0) AS PlannedQuantity,
        COALESCE(SUM(l.MovedQuantity), 0) AS MovedQuantity,
        COALESCE(SUM(l.PlannedQuantity * COALESCE(l.UnitVolumeCm3, 0)), 0) AS PlannedVolumeCm3,
        SUM(CASE WHEN l.TaskLineId IS NOT NULL AND l.UnitVolumeCm3 IS NULL THEN 1 ELSE 0 END) AS LinesWithoutVolume
      FROM dbo.PutawayTasks t
      LEFT JOIN dbo.ReceiveOrders ro ON ro.ReceiveId = t.SourceReceiveId
      JOIN dbo.Users creator ON creator.UserId = t.CreatedBy
      LEFT JOIN dbo.PutawayTaskLines l ON l.TaskId = t.TaskId
      WHERE @Planner = 1 OR t.Status IN ('OPEN','IN_PROGRESS')
      GROUP BY t.TaskId, t.TaskNo, t.SourceReceiveId, ro.PONumber, ro.ReceiveNo, t.Status, t.Note, t.CreatedAt, t.StartedAt, t.CompletedAt, t.CancelledAt, creator.Username
      ORDER BY CASE WHEN t.Status IN ('OPEN','IN_PROGRESS') THEN 0 ELSE 1 END, t.CreatedAt DESC
    `);
    res.json({ success: true, data: result.recordset });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

router.get('/from-receive/:id/preview', requirePutaway, requirePlanner, async (req, res) => {
  const receiveId = Number.parseInt(req.params.id, 10);
  if (!Number.isInteger(receiveId)) return res.status(400).json({ success: false, message: 'ใบรับ PO ไม่ถูกต้อง' });
  try {
    const pool = await poolPromise;
    const result = await pool.request().input('ReceiveId', sql.Int, receiveId).query(`
      SELECT o.ReceiveId, o.ReceiveNo, o.PONumber, o.Status
      FROM dbo.ReceiveOrders o WHERE o.ReceiveId = @ReceiveId;
      SELECT l.ProductId, p.Barcode, p.ItemCode, p.ItemName, p.UOM, p.UnitVolumeCm3,
        loc.LocationId AS FromLocationId, loc.LocationCode AS FromLocationCode,
        SUM(st.Quantity) AS ReceivedQuantity,
        COALESCE(stock.Quantity, 0) AS StockQuantity,
        COALESCE(prior.PlannedQuantity, 0) AS PreviouslyPlannedQuantity,
        COALESCE(active.ReservedQuantity, 0) AS ActiveReservedQuantity
      FROM dbo.ReceiveOrderLines l
      JOIN dbo.ReceiveOrders o ON o.ReceiveId = l.ReceiveId
      JOIN dbo.Products p ON p.ProductId = l.ProductId
      JOIN dbo.StockTransactions st ON st.ProductId = l.ProductId AND st.TransactionType = 'RECEIVE'
        AND st.ReferenceNo = o.PONumber + N'/' + o.ReceiveNo
      JOIN dbo.Locations loc ON loc.LocationId = st.ToLocationId AND loc.IsActive = 1
      LEFT JOIN dbo.Stock stock ON stock.ProductId = l.ProductId AND stock.LocationId = loc.LocationId
      LEFT JOIN (
        SELECT t.SourceReceiveId, pl.ProductId, pl.FromLocationId,
          SUM(pl.PlannedQuantity) AS PlannedQuantity
        FROM dbo.PutawayTasks t JOIN dbo.PutawayTaskLines pl ON pl.TaskId = t.TaskId
        WHERE t.Status <> 'CANCELLED'
        GROUP BY t.SourceReceiveId, pl.ProductId, pl.FromLocationId
      ) prior ON prior.SourceReceiveId = o.ReceiveId AND prior.ProductId = l.ProductId AND prior.FromLocationId = loc.LocationId
      LEFT JOIN (
        SELECT pl.ProductId, pl.FromLocationId, SUM(pl.PlannedQuantity - pl.MovedQuantity) AS ReservedQuantity
        FROM dbo.PutawayTasks t JOIN dbo.PutawayTaskLines pl ON pl.TaskId = t.TaskId
        WHERE t.Status IN ('OPEN','IN_PROGRESS')
        GROUP BY pl.ProductId, pl.FromLocationId
      ) active ON active.ProductId = l.ProductId AND active.FromLocationId = loc.LocationId
      WHERE l.ReceiveId = @ReceiveId AND l.ReceivedQuantity > 0
      GROUP BY l.ProductId, p.Barcode, p.ItemCode, p.ItemName, p.UOM, p.UnitVolumeCm3, loc.LocationId, loc.LocationCode,
        stock.Quantity, prior.PlannedQuantity, active.ReservedQuantity
      ORDER BY loc.LocationCode, p.ItemCode;
    `);
    const order = result.recordsets[0][0];
    if (!order) return res.status(404).json({ success: false, message: 'ไม่พบใบรับ PO' });
    const rows = result.recordsets[1].map(row => ({ ...row,
      AvailableQuantity: Math.max(0, Math.min(Number(row.ReceivedQuantity) - Number(row.PreviouslyPlannedQuantity), Number(row.StockQuantity) - Number(row.ActiveReservedQuantity)))
    })).filter(row => row.AvailableQuantity > 0);
    res.json({ success: true, data: { order, lines: rows } });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

router.get('/:id/lines', requirePutaway, async (req, res) => {
  const taskId = Number.parseInt(req.params.id, 10);
  if (!Number.isInteger(taskId)) return res.status(400).json({ success: false, message: 'ใบงาน PUTAWAY ไม่ถูกต้อง' });
  try {
    const pool = await poolPromise;
    const result = await pool.request().input('TaskId', sql.Int, taskId).query(`
      SELECT t.TaskId, t.TaskNo, t.Status, t.Note, t.CreatedAt,
        ro.PONumber, ro.ReceiveNo,
        l.TaskLineId, p.ProductId, p.Barcode, p.ItemCode, p.ItemName, p.UOM,
        source.LocationCode AS FromLocationCode, target.LocationCode AS ToLocationCode,
        l.PlannedQuantity, l.MovedQuantity, l.PlannedQuantity - l.MovedQuantity AS RemainingQuantity,
        l.UnitVolumeCm3, l.PlannedQuantity * l.UnitVolumeCm3 AS PlannedVolumeCm3
      FROM dbo.PutawayTasks t
      LEFT JOIN dbo.ReceiveOrders ro ON ro.ReceiveId = t.SourceReceiveId
      JOIN dbo.PutawayTaskLines l ON l.TaskId = t.TaskId
      JOIN dbo.Products p ON p.ProductId = l.ProductId
      JOIN dbo.Locations source ON source.LocationId = l.FromLocationId
      JOIN dbo.Locations target ON target.LocationId = l.ToLocationId
      WHERE t.TaskId = @TaskId
      ORDER BY l.TaskLineId
    `);
    if (!result.recordset.length) return res.status(404).json({ success: false, message: 'ไม่พบใบงาน PUTAWAY' });
    const elevated = elevatedRoles.includes(String(req.user.role || '').toUpperCase());
    if (!elevated && !['OPEN','IN_PROGRESS'].includes(result.recordset[0].Status)) {
      return res.status(403).json({ success: false, message: 'ใบงานนี้ไม่ได้เปิดให้ Handheld ทำงานแล้ว' });
    }
    res.json({ success: true, data: { task: result.recordset[0], lines: result.recordset } });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

router.post('/', requirePutaway, requirePlanner, async (req, res) => {
  const note = String(req.body.note || '').trim();
  const sourceReceiveId = req.body.sourceReceiveId == null || req.body.sourceReceiveId === '' ? null : Number(req.body.sourceReceiveId);
  if (sourceReceiveId !== null && (!Number.isInteger(sourceReceiveId) || sourceReceiveId <= 0)) {
    return res.status(400).json({ success: false, message: 'เลขที่ใบรับ PO สำหรับ PUTAWAY ไม่ถูกต้อง' });
  }
  const lines = Array.isArray(req.body.lines) ? req.body.lines.map(line => ({
    barcode: String(line.barcode || '').trim(),
    fromLocationCode: String(line.fromLocationCode || '').trim().toUpperCase(),
    toLocationCode: String(line.toLocationCode || '').trim().toUpperCase(),
    quantity: Number(line.quantity)
  })) : [];
  if (note.length > 300 || !lines.length || lines.length > 200 || lines.some(line => !line.barcode || line.barcode.length > 50 || !line.fromLocationCode || line.fromLocationCode.length > 50 || !line.toLocationCode || line.toLocationCode.length > 50 || line.fromLocationCode === line.toLocationCode || !Number.isInteger(line.quantity) || line.quantity <= 0)) {
    return res.status(400).json({ success: false, message: 'กรอกสินค้า โลเคชั่นต้นทาง/ปลายทาง และจำนวนให้ถูกต้อง (อย่างน้อย 1 รายการ)' });
  }
  const unique = new Set(lines.map(line => `${line.barcode.toUpperCase()}|${line.fromLocationCode}|${line.toLocationCode}`));
  if (unique.size !== lines.length) return res.status(400).json({ success: false, message: 'รายการสินค้าต้นทางและปลายทางซ้ำกัน กรุณารวมจำนวนในบรรทัดเดียว' });
  lines.sort((a, b) => a.fromLocationCode.localeCompare(b.fromLocationCode) || a.barcode.localeCompare(b.barcode) || a.toLocationCode.localeCompare(b.toLocationCode));

  const pool = await poolPromise;
  const transaction = new sql.Transaction(pool);
  try {
    await transaction.begin();
    const request = () => new sql.Request(transaction);
    let receiveOrder = null;
    if (sourceReceiveId !== null) {
      const foundReceive = await request().input('ReceiveId', sql.Int, sourceReceiveId).query(`
        SELECT ReceiveId, PONumber, ReceiveNo FROM dbo.ReceiveOrders WHERE ReceiveId = @ReceiveId AND Status <> 'CANCELLED'
      `);
      receiveOrder = foundReceive.recordset[0];
      if (!receiveOrder) throw new Error('ไม่พบใบรับ PO หรือใบรับถูกยกเลิกแล้ว');
    }
    // Serialize capacity reservations in a stable order so two planners cannot
    // both allocate the same remaining space concurrently.
    for (const targetCode of [...new Set(lines.map(line => line.toLocationCode))].sort()) {
      const lockedTarget = await request().input('TargetCode', sql.NVarChar(50), targetCode).query(`
        SELECT LocationId FROM dbo.Locations WITH (UPDLOCK, HOLDLOCK)
        WHERE LocationCode = @TargetCode AND IsActive = 1
      `);
      if (!lockedTarget.recordset.length) throw new Error(`ไม่พบโลเคชั่นปลายทางที่เปิดใช้งาน (${targetCode})`);
    }
    const taskNo = `PA-${new Date().toISOString().replace(/[-:T.Z]/g, '').slice(0, 14)}-${Math.floor(Math.random() * 900 + 100)}`;
    const header = await request().input('TaskNo', sql.NVarChar(40), taskNo).input('SourceReceiveId', sql.Int, sourceReceiveId).input('Note', sql.NVarChar(300), note || null)
      .input('CreatedBy', sql.Int, req.user.id || req.user.userId)
      .query(`INSERT INTO dbo.PutawayTasks (TaskNo, SourceReceiveId, Note, CreatedBy) OUTPUT INSERTED.TaskId VALUES (@TaskNo, @SourceReceiveId, @Note, @CreatedBy)`);
    const taskId = header.recordset[0].TaskId;
    for (const line of lines) {
      const product = await request().input('Barcode', sql.NVarChar(50), line.barcode).query('SELECT ProductId, UnitVolumeCm3 FROM dbo.Products WHERE Barcode = @Barcode');
      if (!product.recordset.length) throw new Error(`ไม่พบสินค้าบาร์โค้ด ${line.barcode}`);
      const locations = await request()
        .input('FromCode', sql.NVarChar(50), line.fromLocationCode)
        .input('ToCode', sql.NVarChar(50), line.toLocationCode)
        .query(`SELECT LocationId, LocationCode FROM dbo.Locations WHERE IsActive = 1 AND LocationCode IN (@FromCode, @ToCode)`);
      const source = locations.recordset.find(location => location.LocationCode === line.fromLocationCode);
      const target = locations.recordset.find(location => location.LocationCode === line.toLocationCode);
      if (!source || !target) throw new Error(`ไม่พบโลเคชั่นต้นทางหรือปลายทางที่เปิดใช้งาน (${line.fromLocationCode} → ${line.toLocationCode})`);
      if (!source.LocationCode.startsWith('RCV-')) throw new Error(`PUTAWAY ต้องเริ่มจากโลเคชั่นรับเข้า RCV-* (เลือก ${line.fromLocationCode})`);
      if (!/^[AB]-/.test(target.LocationCode)) throw new Error(`ปลายทาง PUTAWAY ต้องเป็นพื้นที่จัดเก็บ A-* หรือ B-* (เลือก ${line.toLocationCode})`);
      const productId = product.recordset[0].ProductId;
      if (receiveOrder) {
        const receiptAvailability = await request().input('ReceiveId', sql.Int, receiveOrder.ReceiveId).input('ProductId', sql.Int, productId)
          .input('SourceId', sql.Int, source.LocationId).input('ReferenceNo', sql.NVarChar(100), `${receiveOrder.PONumber}/${receiveOrder.ReceiveNo}`).query(`
            SELECT COALESCE(SUM(st.Quantity), 0) AS ReceivedQuantity,
              COALESCE((SELECT SUM(pl.PlannedQuantity) FROM dbo.PutawayTasks pt JOIN dbo.PutawayTaskLines pl ON pl.TaskId = pt.TaskId
                WHERE pt.SourceReceiveId = @ReceiveId AND pt.Status <> 'CANCELLED' AND pl.ProductId = @ProductId AND pl.FromLocationId = @SourceId), 0) AS PreviouslyPlanned
            FROM dbo.ReceiveOrderLines rl
            LEFT JOIN dbo.StockTransactions st ON st.ProductId = rl.ProductId AND st.TransactionType = 'RECEIVE'
              AND st.ToLocationId = @SourceId AND st.ReferenceNo = @ReferenceNo
            WHERE rl.ReceiveId = @ReceiveId AND rl.ProductId = @ProductId AND rl.ReceivedQuantity > 0
          `);
        const attributable = Math.max(0, Number(receiptAvailability.recordset[0]?.ReceivedQuantity || 0) - Number(receiptAvailability.recordset[0]?.PreviouslyPlanned || 0));
        if (!attributable) throw new Error(`สินค้า ${line.barcode} ไม่มีจำนวนรับจาก PO นี้เหลือสำหรับสร้าง PUTAWAY ที่ ${line.fromLocationCode}`);
        if (line.quantity > attributable) throw new Error(`จำนวน ${line.barcode} เกินยอดรับจาก PO ที่ยังไม่วางแผน (${attributable})`);
      }
      const stock = await request().input('ProductId', sql.Int, productId).input('SourceId', sql.Int, source.LocationId).query(`
        SELECT Quantity FROM dbo.Stock WITH (UPDLOCK, HOLDLOCK) WHERE ProductId = @ProductId AND LocationId = @SourceId
      `);
      const available = Number(stock.recordset[0]?.Quantity || 0);
      const reserved = await request().input('ProductId', sql.Int, productId).input('SourceId', sql.Int, source.LocationId).query(`
        SELECT COALESCE(SUM(l.PlannedQuantity - l.MovedQuantity), 0) AS ReservedQuantity
        FROM dbo.PutawayTaskLines l JOIN dbo.PutawayTasks t ON t.TaskId = l.TaskId
        WHERE l.ProductId = @ProductId AND l.FromLocationId = @SourceId AND t.Status IN ('OPEN','IN_PROGRESS')
      `);
      if (available - Number(reserved.recordset[0].ReservedQuantity) < line.quantity) {
        throw new Error(`สต็อกต้นทาง ${line.fromLocationCode} ไม่พอหรือถูกจองในใบงานอื่นแล้ว: คงเหลือจัดสรรได้ ${Math.max(0, available - Number(reserved.recordset[0].ReservedQuantity))}`);
      }
      const capacityResult = await request().input('TargetId', sql.Int, target.LocationId).query('SELECT CapacityVolumeCm3 FROM dbo.Locations WHERE LocationId = @TargetId');
      const capacityVolume = capacityResult.recordset[0]?.CapacityVolumeCm3;
      if (capacityVolume == null) throw new Error(`ยังไม่ได้กำหนดความจุของ ${target.LocationCode} กรุณาตั้งค่าที่เมนูจัดการโลเคชั่นก่อน`);
      {
        const unitVolume = product.recordset[0].UnitVolumeCm3;
        if (unitVolume == null) throw new Error(`สินค้า ${line.barcode} ยังไม่ระบุปริมาตรต่อหน่วย จึงตรวจความจุ ${target.LocationCode} ไม่ได้`);
        const occupancy = await request().input('TargetId', sql.Int, target.LocationId).query(`
          SELECT COALESCE(SUM(CASE WHEN p.UnitVolumeCm3 IS NOT NULL THEN s.Quantity * p.UnitVolumeCm3 ELSE 0 END), 0) AS UsedVolumeCm3,
            COALESCE(SUM(CASE WHEN s.Quantity > 0 AND p.UnitVolumeCm3 IS NULL THEN 1 ELSE 0 END), 0) AS UnmeasuredStock,
            COALESCE((SELECT SUM((pl.PlannedQuantity - pl.MovedQuantity) * pl.UnitVolumeCm3)
              FROM dbo.PutawayTaskLines pl JOIN dbo.PutawayTasks pt ON pt.TaskId = pl.TaskId
              WHERE pl.ToLocationId = @TargetId AND pt.Status IN ('OPEN','IN_PROGRESS') AND pl.UnitVolumeCm3 IS NOT NULL), 0) AS ReservedVolumeCm3,
            COALESCE((SELECT COUNT(*) FROM dbo.PutawayTaskLines pl JOIN dbo.PutawayTasks pt ON pt.TaskId = pl.TaskId
              WHERE pl.ToLocationId = @TargetId AND pt.Status IN ('OPEN','IN_PROGRESS') AND pl.MovedQuantity < pl.PlannedQuantity AND pl.UnitVolumeCm3 IS NULL), 0) AS UnmeasuredReservations
          FROM dbo.Stock s JOIN dbo.Products p ON p.ProductId = s.ProductId
          WHERE s.LocationId = @TargetId AND s.Quantity > 0
        `);
        const usage = occupancy.recordset[0];
        if (Number(usage.UnmeasuredStock) || Number(usage.UnmeasuredReservations)) throw new Error(`ไม่สามารถตรวจความจุ ${target.LocationCode} ได้ เพราะมีสินค้า/ใบงานที่ยังไม่ระบุปริมาตร`);
        const plannedVolume = Number(unitVolume) * line.quantity;
        const totalVolume = Number(usage.UsedVolumeCm3) + Number(usage.ReservedVolumeCm3) + plannedVolume;
        if (totalVolume > Number(capacityVolume) + 0.0001) {
          throw new Error(`${target.LocationCode} มีความจุไม่พอ: ใช้แล้วและจอง ${Number(usage.UsedVolumeCm3) + Number(usage.ReservedVolumeCm3)} cm³, เพิ่ม ${plannedVolume} cm³, ความจุ ${capacityVolume} cm³`);
        }
      }
      await request().input('TaskId', sql.Int, taskId).input('ProductId', sql.Int, productId)
        .input('FromId', sql.Int, source.LocationId).input('ToId', sql.Int, target.LocationId).input('Quantity', sql.Int, line.quantity)
        .input('UnitVolumeCm3', sql.Decimal(18, 3), product.recordset[0].UnitVolumeCm3)
        .query(`INSERT INTO dbo.PutawayTaskLines (TaskId, ProductId, FromLocationId, ToLocationId, PlannedQuantity, UnitVolumeCm3)
          VALUES (@TaskId, @ProductId, @FromId, @ToId, @Quantity, @UnitVolumeCm3)`);
    }
    await transaction.commit();
    res.status(201).json({ success: true, taskId, taskNo, message: 'สร้างใบงาน PUTAWAY และจองยอดต้นทางแล้ว' });
  } catch (err) {
    try { await transaction.rollback(); } catch (_) {}
    res.status(400).json({ success: false, message: err.message });
  }
});

router.post('/:id/move', requirePutaway, async (req, res) => {
  const taskId = Number.parseInt(req.params.id, 10);
  const barcode = String(req.body.barcode || '').trim();
  const targetLocationCode = String(req.body.targetLocationCode || '').trim().toUpperCase();
  const quantity = Number(req.body.quantity);
  if (!Number.isInteger(taskId) || !barcode || !targetLocationCode || !Number.isInteger(quantity) || quantity <= 0) {
    return res.status(400).json({ success: false, message: 'ระบุใบงาน บาร์โค้ด โลเคชั่นปลายทาง และจำนวนให้ถูกต้อง' });
  }
  const pool = await poolPromise;
  const transaction = new sql.Transaction(pool);
  try {
    await transaction.begin();
    const request = () => new sql.Request(transaction);
    const task = await request().input('TaskId', sql.Int, taskId).query(`SELECT TaskNo, Status FROM dbo.PutawayTasks WHERE TaskId = @TaskId`);
    if (!task.recordset.length || !['OPEN','IN_PROGRESS'].includes(task.recordset[0].Status)) throw new Error('ไม่พบใบงาน PUTAWAY ที่เปิดอยู่');
    const findTaskLine = () => request().input('TaskId', sql.Int, taskId).input('Barcode', sql.NVarChar(50), barcode).query(`
      SELECT l.TaskLineId, l.ProductId, l.FromLocationId, l.ToLocationId, l.PlannedQuantity, l.MovedQuantity, l.UnitVolumeCm3,
        source.LocationCode AS FromLocationCode, target.LocationCode AS ToLocationCode,
        source.IsActive AS FromLocationActive, target.IsActive AS ToLocationActive, p.ItemCode, p.ItemName
      FROM dbo.PutawayTaskLines l
      JOIN dbo.Products p ON p.ProductId = l.ProductId
      JOIN dbo.Locations source ON source.LocationId = l.FromLocationId
      JOIN dbo.Locations target ON target.LocationId = l.ToLocationId
      WHERE l.TaskId = @TaskId AND p.Barcode = @Barcode
    `);
    const initialLineResult = await findTaskLine();
    if (!initialLineResult.recordset.length) throw new Error('บาร์โค้ดนี้ไม่มีในใบงาน PUTAWAY');
    const initialLine = initialLineResult.recordset[0];
    // Lock stock before task/line rows. Task creation and other outbound moves
    // use the same lock order so reservations cannot deadlock with execution.
    const sourceStock = await request().input('ProductId', sql.Int, initialLine.ProductId).input('SourceId', sql.Int, initialLine.FromLocationId).query(`
      SELECT Quantity FROM dbo.Stock WITH (UPDLOCK, HOLDLOCK) WHERE ProductId = @ProductId AND LocationId = @SourceId
    `);
    const lockedTask = await request().input('TaskId', sql.Int, taskId).query(`SELECT TaskNo, Status FROM dbo.PutawayTasks WITH (UPDLOCK, ROWLOCK) WHERE TaskId = @TaskId`);
    if (!lockedTask.recordset.length || !['OPEN','IN_PROGRESS'].includes(lockedTask.recordset[0].Status)) throw new Error('ใบงาน PUTAWAY ถูกปิดหรือยกเลิกแล้ว');
    const lockedLineResult = await request().input('TaskId', sql.Int, taskId).input('Barcode', sql.NVarChar(50), barcode).query(`
      SELECT l.TaskLineId, l.ProductId, l.FromLocationId, l.ToLocationId, l.PlannedQuantity, l.MovedQuantity, l.UnitVolumeCm3,
        source.LocationCode AS FromLocationCode, target.LocationCode AS ToLocationCode,
        source.IsActive AS FromLocationActive, target.IsActive AS ToLocationActive, p.ItemCode, p.ItemName
      FROM dbo.PutawayTaskLines l WITH (UPDLOCK, ROWLOCK)
      JOIN dbo.Products p ON p.ProductId = l.ProductId
      JOIN dbo.Locations source ON source.LocationId = l.FromLocationId
      JOIN dbo.Locations target ON target.LocationId = l.ToLocationId
      WHERE l.TaskId = @TaskId AND p.Barcode = @Barcode
    `);
    if (!lockedLineResult.recordset.length) throw new Error('บาร์โค้ดนี้ไม่มีในใบงาน PUTAWAY');
    const line = lockedLineResult.recordset[0];
    if (!line.FromLocationActive || !line.ToLocationActive) throw new Error('โลเคชั่นต้นทางหรือปลายทางถูกปิดใช้งาน กรุณาติดต่อ Admin/Power User');
    if (line.ToLocationCode !== targetLocationCode) throw new Error(`ใบงานกำหนดปลายทางเป็น ${line.ToLocationCode}`);
    const remaining = line.PlannedQuantity - line.MovedQuantity;
    if (quantity > remaining) throw new Error(`จำนวนเกินยอดในใบงาน เหลือจัดเก็บ ${remaining}`);
    if (!sourceStock.recordset.length || sourceStock.recordset[0].Quantity < quantity) throw new Error(`สต็อกต้นทาง ${line.FromLocationCode} ไม่พอสำหรับจัดเก็บ`);
    const targetCapacityResult = await request().input('TargetId', sql.Int, line.ToLocationId).query('SELECT CapacityVolumeCm3 FROM dbo.Locations WHERE LocationId = @TargetId');
    const targetCapacity = targetCapacityResult.recordset[0]?.CapacityVolumeCm3;
    if (targetCapacity == null || line.UnitVolumeCm3 == null) throw new Error(`ไม่สามารถตรวจความจุปลายทาง ${line.ToLocationCode} ได้ กรุณาตรวจค่าความจุโลเคชั่นและปริมาตรสินค้า`);
    const targetOccupancy = await request().input('TargetId', sql.Int, line.ToLocationId).query(`
      SELECT COALESCE(SUM(CASE WHEN p.UnitVolumeCm3 IS NOT NULL THEN s.Quantity * p.UnitVolumeCm3 ELSE 0 END), 0) AS UsedVolumeCm3,
        COALESCE(SUM(CASE WHEN s.Quantity > 0 AND p.UnitVolumeCm3 IS NULL THEN 1 ELSE 0 END), 0) AS UnmeasuredStock,
        COALESCE((SELECT SUM((pl.PlannedQuantity - pl.MovedQuantity) * pl.UnitVolumeCm3)
          FROM dbo.PutawayTaskLines pl JOIN dbo.PutawayTasks pt ON pt.TaskId = pl.TaskId
          WHERE pl.ToLocationId = @TargetId AND pt.Status IN ('OPEN','IN_PROGRESS') AND pl.UnitVolumeCm3 IS NOT NULL), 0) AS ReservedVolumeCm3,
        COALESCE((SELECT COUNT(*) FROM dbo.PutawayTaskLines pl JOIN dbo.PutawayTasks pt ON pt.TaskId = pl.TaskId
          WHERE pl.ToLocationId = @TargetId AND pt.Status IN ('OPEN','IN_PROGRESS') AND pl.MovedQuantity < pl.PlannedQuantity AND pl.UnitVolumeCm3 IS NULL), 0) AS UnmeasuredReservations
      FROM dbo.Stock s JOIN dbo.Products p ON p.ProductId = s.ProductId
      WHERE s.LocationId = @TargetId AND s.Quantity > 0
    `);
    const targetUsage = targetOccupancy.recordset[0];
    const committedVolume = Number(targetUsage.UsedVolumeCm3) + Number(targetUsage.ReservedVolumeCm3);
    if (Number(targetUsage.UnmeasuredStock) || Number(targetUsage.UnmeasuredReservations) || committedVolume > Number(targetCapacity) + 0.0001) {
      throw new Error(`ความจุปลายทาง ${line.ToLocationCode} เปลี่ยนแปลงหรือมีรายการที่ยังไม่ทราบปริมาตร กรุณาให้ Admin ตรวจสอบ`);
    }
    const deducted = await request().input('ProductId', sql.Int, line.ProductId).input('SourceId', sql.Int, line.FromLocationId).input('Quantity', sql.Int, quantity).query(`
      UPDATE dbo.Stock SET Quantity = Quantity - @Quantity, LastUpdated = SYSDATETIME()
      WHERE ProductId = @ProductId AND LocationId = @SourceId AND Quantity >= @Quantity;
      SELECT @@ROWCOUNT AS Changed;
    `);
    if (!deducted.recordset[0].Changed) throw new Error('ยอดสต็อกต้นทางเปลี่ยนแปลง กรุณารีเฟรชใบงาน');
    await request().input('ProductId', sql.Int, line.ProductId).input('TargetId', sql.Int, line.ToLocationId).input('Quantity', sql.Int, quantity).query(`
      MERGE dbo.Stock WITH (HOLDLOCK) AS target
      USING (SELECT @ProductId AS ProductId, @TargetId AS LocationId) AS source
      ON target.ProductId = source.ProductId AND target.LocationId = source.LocationId
      WHEN MATCHED THEN UPDATE SET target.Quantity = target.Quantity + @Quantity, target.LastUpdated = SYSDATETIME()
      WHEN NOT MATCHED THEN INSERT (ProductId, LocationId, Quantity, LastUpdated) VALUES (@ProductId, @TargetId, @Quantity, SYSDATETIME());
    `);
    await request().input('TaskLineId', sql.Int, line.TaskLineId).input('Quantity', sql.Int, quantity).query(`
      UPDATE dbo.PutawayTaskLines SET MovedQuantity = MovedQuantity + @Quantity WHERE TaskLineId = @TaskLineId;
    `);
    await request().input('TransactionType', sql.NVarChar(20), 'PUTAWAY').input('ProductId', sql.Int, line.ProductId)
      .input('FromId', sql.Int, line.FromLocationId).input('ToId', sql.Int, line.ToLocationId).input('Quantity', sql.Int, quantity)
      .input('ReferenceNo', sql.NVarChar(100), lockedTask.recordset[0].TaskNo).input('UserId', sql.Int, req.user.id || req.user.userId)
      .query(`INSERT INTO dbo.StockTransactions (TransactionType, ProductId, FromLocationId, ToLocationId, Quantity, ReferenceNo, UserId)
        VALUES (@TransactionType, @ProductId, @FromId, @ToId, @Quantity, @ReferenceNo, @UserId)`);
    const completion = await request().input('TaskId', sql.Int, taskId).query(`
      IF NOT EXISTS (SELECT 1 FROM dbo.PutawayTaskLines WHERE TaskId = @TaskId AND MovedQuantity < PlannedQuantity)
        UPDATE dbo.PutawayTasks SET Status = 'COMPLETED', CompletedAt = SYSDATETIME() WHERE TaskId = @TaskId;
      ELSE
        UPDATE dbo.PutawayTasks SET Status = 'IN_PROGRESS', StartedAt = COALESCE(StartedAt, SYSDATETIME()) WHERE TaskId = @TaskId;
      SELECT Status FROM dbo.PutawayTasks WHERE TaskId = @TaskId;
    `);
    await transaction.commit();
    res.json({ success: true, status: completion.recordset[0].Status, message: `จัดเก็บ ${line.ItemName} จำนวน ${quantity} จาก ${line.FromLocationCode} ไป ${line.ToLocationCode} แล้ว` });
  } catch (err) {
    try { await transaction.rollback(); } catch (_) {}
    res.status(400).json({ success: false, message: err.message });
  }
});

router.delete('/:id', requirePutaway, requirePlanner, async (req, res) => {
  const taskId = Number.parseInt(req.params.id, 10);
  if (!Number.isInteger(taskId)) return res.status(400).json({ success: false, message: 'ใบงาน PUTAWAY ไม่ถูกต้อง' });
  try {
    const pool = await poolPromise;
    const result = await pool.request().input('TaskId', sql.Int, taskId).query(`
      UPDATE dbo.PutawayTasks SET Status = 'CANCELLED', CancelledAt = SYSDATETIME()
      WHERE TaskId = @TaskId AND Status = 'OPEN'
        AND NOT EXISTS (SELECT 1 FROM dbo.PutawayTaskLines WHERE TaskId = @TaskId AND MovedQuantity > 0);
      SELECT @@ROWCOUNT AS Changed;
    `);
    if (!result.recordset[0].Changed) return res.status(409).json({ success: false, message: 'ยกเลิกได้เฉพาะใบงานที่ยังไม่เริ่มจัดเก็บ' });
    res.json({ success: true, message: 'ยกเลิกใบงานแล้ว ยอดที่จองกลับมาใช้สร้างใบงานใหม่ได้' });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

module.exports = router;
