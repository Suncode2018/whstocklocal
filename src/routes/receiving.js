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
        Status NVARCHAR(20) NOT NULL CONSTRAINT DF_ReceiveOrders_Status DEFAULT ('OPEN'),
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
           COL_LENGTH('dbo.ReceiveOrders', 'Status') AS StatusLength,
           OBJECT_ID('dbo.ReceiveOrderLines', 'U') AS ReceiveOrderLinesId,
           COL_LENGTH('dbo.ReceiveOrderLines', 'ReceivedQuantity') AS ReceivedQuantityLength
  `);
  const schema = columns.recordset[0];
  if (schema.StatusLength < 40) await pool.request().query('ALTER TABLE dbo.ReceiveOrders ALTER COLUMN Status NVARCHAR(20) NOT NULL');
  await pool.request().query(`
    IF EXISTS (SELECT 1 FROM sys.check_constraints WHERE parent_object_id = OBJECT_ID('dbo.ReceiveOrders') AND name = 'CK_ReceiveOrders_Status' AND definition NOT LIKE '%COMPLETED_SHORT%')
    BEGIN
      ALTER TABLE dbo.ReceiveOrders DROP CONSTRAINT CK_ReceiveOrders_Status;
      ALTER TABLE dbo.ReceiveOrders ADD CONSTRAINT CK_ReceiveOrders_Status CHECK (Status IN ('OPEN','COMPLETED','COMPLETED_SHORT','CANCELLED'));
    END;
  `);
  if (schema.CompletedAtLength == null) await pool.request().query('ALTER TABLE dbo.ReceiveOrders ADD CompletedAt DATETIME2 NULL');
  if (schema.ReceivedQuantityLength == null) {
    await pool.request().query(`ALTER TABLE dbo.ReceiveOrderLines ADD ReceivedQuantity INT NOT NULL CONSTRAINT DF_ReceiveOrderLines_ReceivedQuantity DEFAULT (0)`);
  }
  await pool.request().query(`
    IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID('dbo.ReceiveOrders') AND name = 'IX_ReceiveOrders_Status_CreatedAt')
      CREATE INDEX IX_ReceiveOrders_Status_CreatedAt ON dbo.ReceiveOrders(Status, CreatedAt DESC);
  `);
  await pool.request().query(`
    IF OBJECT_ID('dbo.ShortageReasons', 'U') IS NULL
    BEGIN
      CREATE TABLE dbo.ShortageReasons (
        ReasonId INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_ShortageReasons PRIMARY KEY,
        ReasonCode NVARCHAR(30) NOT NULL CONSTRAINT UQ_ShortageReasons_ReasonCode UNIQUE,
        ReasonName NVARCHAR(100) NOT NULL,
        RequiresNote BIT NOT NULL CONSTRAINT DF_ShortageReasons_RequiresNote DEFAULT (0),
        IsActive BIT NOT NULL CONSTRAINT DF_ShortageReasons_IsActive DEFAULT (1),
        SortOrder INT NOT NULL CONSTRAINT DF_ShortageReasons_SortOrder DEFAULT (0),
        CreatedAt DATETIME2 NOT NULL CONSTRAINT DF_ShortageReasons_CreatedAt DEFAULT (SYSDATETIME()),
        UpdatedAt DATETIME2 NULL
      );
    END;
    IF NOT EXISTS (SELECT 1 FROM dbo.ShortageReasons WHERE ReasonCode = N'SHORT_SHIPMENT')
      INSERT INTO dbo.ShortageReasons (ReasonCode, ReasonName, RequiresNote, SortOrder) VALUES (N'SHORT_SHIPMENT', N'ผู้ขายส่งมาไม่ครบ', 0, 10);
    IF NOT EXISTS (SELECT 1 FROM dbo.ShortageReasons WHERE ReasonCode = N'DAMAGED')
      INSERT INTO dbo.ShortageReasons (ReasonCode, ReasonName, RequiresNote, SortOrder) VALUES (N'DAMAGED', N'สินค้าเสียหาย / ชำรุด', 0, 20);
    IF NOT EXISTS (SELECT 1 FROM dbo.ShortageReasons WHERE ReasonCode = N'OTHER')
      INSERT INTO dbo.ShortageReasons (ReasonCode, ReasonName, RequiresNote, SortOrder) VALUES (N'OTHER', N'อื่น ๆ', 1, 99);
  `);
  await pool.request().query(`
    IF OBJECT_ID('dbo.ReceiveShortages', 'U') IS NULL
    BEGIN
      CREATE TABLE dbo.ReceiveShortages (
        ShortageId INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_ReceiveShortages PRIMARY KEY,
        ReceiveId INT NOT NULL,
        ReceiveLineId INT NOT NULL,
        ReasonId INT NOT NULL,
        Quantity INT NOT NULL,
        ReasonCode NVARCHAR(30) NOT NULL,
        ReasonNameSnapshot NVARCHAR(100) NOT NULL,
        Note NVARCHAR(300) NULL,
        Status NVARCHAR(20) NOT NULL CONSTRAINT DF_ReceiveShortages_Status DEFAULT ('PENDING_CN'),
        RecordedBy INT NOT NULL,
        RecordedAt DATETIME2 NOT NULL CONSTRAINT DF_ReceiveShortages_RecordedAt DEFAULT (SYSDATETIME()),
        ResolvedBy INT NULL,
        ResolvedAt DATETIME2 NULL,
        CONSTRAINT FK_ReceiveShortages_Order FOREIGN KEY (ReceiveId) REFERENCES dbo.ReceiveOrders(ReceiveId),
        CONSTRAINT FK_ReceiveShortages_Line FOREIGN KEY (ReceiveLineId) REFERENCES dbo.ReceiveOrderLines(ReceiveLineId),
        CONSTRAINT FK_ReceiveShortages_Reason FOREIGN KEY (ReasonId) REFERENCES dbo.ShortageReasons(ReasonId),
        CONSTRAINT FK_ReceiveShortages_RecordedBy FOREIGN KEY (RecordedBy) REFERENCES dbo.Users(UserId),
        CONSTRAINT FK_ReceiveShortages_ResolvedBy FOREIGN KEY (ResolvedBy) REFERENCES dbo.Users(UserId),
        CONSTRAINT CK_ReceiveShortages_Quantity CHECK (Quantity > 0),
        CONSTRAINT CK_ReceiveShortages_Status CHECK (Status IN ('PENDING_CN','CN_ISSUED','CANCELLED'))
      );
    END;
    IF OBJECT_ID('dbo.CreditNotes', 'U') IS NULL
    BEGIN
      CREATE TABLE dbo.CreditNotes (
        CreditNoteId INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_CreditNotes PRIMARY KEY,
        CreditNoteNo NVARCHAR(40) NOT NULL CONSTRAINT UQ_CreditNotes_CreditNoteNo UNIQUE,
        ReceiveId INT NOT NULL,
        IssuedAt DATETIME2 NOT NULL CONSTRAINT DF_CreditNotes_IssuedAt DEFAULT (SYSDATETIME()),
        Subtotal DECIMAL(19,2) NOT NULL CONSTRAINT DF_CreditNotes_Subtotal DEFAULT (0),
        TaxAmount DECIMAL(19,2) NOT NULL CONSTRAINT DF_CreditNotes_TaxAmount DEFAULT (0),
        TotalAmount DECIMAL(19,2) NOT NULL CONSTRAINT DF_CreditNotes_TotalAmount DEFAULT (0),
        IssuedBy INT NOT NULL,
        CreatedAt DATETIME2 NOT NULL CONSTRAINT DF_CreditNotes_CreatedAt DEFAULT (SYSDATETIME()),
        CONSTRAINT FK_CreditNotes_Order FOREIGN KEY (ReceiveId) REFERENCES dbo.ReceiveOrders(ReceiveId),
        CONSTRAINT FK_CreditNotes_IssuedBy FOREIGN KEY (IssuedBy) REFERENCES dbo.Users(UserId)
      );
    END;
    IF OBJECT_ID('dbo.CreditNoteLines', 'U') IS NULL
    BEGIN
      CREATE TABLE dbo.CreditNoteLines (
        CreditNoteLineId INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_CreditNoteLines PRIMARY KEY,
        CreditNoteId INT NOT NULL,
        ShortageId INT NOT NULL CONSTRAINT UQ_CreditNoteLines_Shortage UNIQUE,
        ProductId INT NOT NULL,
        Quantity INT NOT NULL,
        UnitPrice DECIMAL(19,4) NOT NULL,
        VatRate DECIMAL(5,2) NOT NULL CONSTRAINT DF_CreditNoteLines_VatRate DEFAULT (0),
        NetAmount DECIMAL(19,2) NOT NULL,
        TaxAmount DECIMAL(19,2) NOT NULL,
        TotalAmount DECIMAL(19,2) NOT NULL,
        CONSTRAINT FK_CreditNoteLines_CreditNote FOREIGN KEY (CreditNoteId) REFERENCES dbo.CreditNotes(CreditNoteId),
        CONSTRAINT FK_CreditNoteLines_Shortage FOREIGN KEY (ShortageId) REFERENCES dbo.ReceiveShortages(ShortageId),
        CONSTRAINT FK_CreditNoteLines_Product FOREIGN KEY (ProductId) REFERENCES dbo.Products(ProductId),
        CONSTRAINT CK_CreditNoteLines_Quantity CHECK (Quantity > 0),
        CONSTRAINT CK_CreditNoteLines_Price CHECK (UnitPrice >= 0 AND VatRate >= 0 AND VatRate <= 100)
      );
    END;
  `);
  // Run ADD and UPDATE in separate batches. SQL Server otherwise compiles the
  // whole batch before the new columns exist and reports "Invalid column name".
  await pool.request().query(`
    IF COL_LENGTH('dbo.ReceiveShortages', 'ReasonId') IS NULL
      ALTER TABLE dbo.ReceiveShortages ADD ReasonId INT NULL;
    IF COL_LENGTH('dbo.ReceiveShortages', 'ReasonNameSnapshot') IS NULL
      ALTER TABLE dbo.ReceiveShortages ADD ReasonNameSnapshot NVARCHAR(100) NULL;
  `);
  await pool.request().query(`
    UPDATE s SET ReasonId = r.ReasonId
    FROM dbo.ReceiveShortages s JOIN dbo.ShortageReasons r ON r.ReasonCode = s.ReasonCode
    WHERE s.ReasonId IS NULL;
    UPDATE s SET ReasonNameSnapshot = r.ReasonName
    FROM dbo.ReceiveShortages s JOIN dbo.ShortageReasons r ON r.ReasonId = s.ReasonId
    WHERE s.ReasonNameSnapshot IS NULL;
  `);
  await pool.request().query(`
    IF EXISTS (SELECT 1 FROM sys.check_constraints WHERE parent_object_id = OBJECT_ID('dbo.ReceiveShortages') AND name = 'CK_ReceiveShortages_Reason')
      ALTER TABLE dbo.ReceiveShortages DROP CONSTRAINT CK_ReceiveShortages_Reason;
    IF EXISTS (SELECT 1 FROM dbo.ReceiveShortages WHERE ReasonId IS NULL)
      THROW 50001, 'พบเหตุผลขาดส่งเดิมที่ไม่มีใน Master ShortageReasons', 1;
    IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.ReceiveShortages') AND name = 'ReasonId' AND is_nullable = 1)
    BEGIN
      IF EXISTS (SELECT 1 FROM sys.foreign_keys WHERE parent_object_id = OBJECT_ID('dbo.ReceiveShortages') AND name = 'FK_ReceiveShortages_Reason')
        ALTER TABLE dbo.ReceiveShortages DROP CONSTRAINT FK_ReceiveShortages_Reason;
      ALTER TABLE dbo.ReceiveShortages ALTER COLUMN ReasonId INT NOT NULL;
    END;
    IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.ReceiveShortages') AND name = 'ReasonNameSnapshot' AND is_nullable = 1)
      ALTER TABLE dbo.ReceiveShortages ALTER COLUMN ReasonNameSnapshot NVARCHAR(100) NOT NULL;
    IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE parent_object_id = OBJECT_ID('dbo.ReceiveShortages') AND name = 'FK_ReceiveShortages_Reason')
      ALTER TABLE dbo.ReceiveShortages WITH CHECK ADD CONSTRAINT FK_ReceiveShortages_Reason FOREIGN KEY (ReasonId) REFERENCES dbo.ShortageReasons(ReasonId);
  `);
  await pool.request().query(`
    IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID('dbo.ReceiveShortages') AND name = 'IX_ReceiveShortages_Status_Receive')
      CREATE INDEX IX_ReceiveShortages_Status_Receive ON dbo.ReceiveShortages(Status, ReceiveId);
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

router.get('/reasons/active', requireReceivePermission, async (req, res) => {
  try {
    const pool = await poolPromise;
    const result = await pool.request().query(`SELECT ReasonId, ReasonCode, ReasonName, RequiresNote
      FROM dbo.ShortageReasons WHERE IsActive = 1 ORDER BY SortOrder, ReasonName`);
    res.json({ success: true, data: result.recordset });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

router.get('/reasons', requireAdminOrPowerUser, async (req, res) => {
  try {
    const pool = await poolPromise;
    const result = await pool.request().query(`SELECT ReasonId, ReasonCode, ReasonName, RequiresNote, IsActive, SortOrder, CreatedAt, UpdatedAt
      FROM dbo.ShortageReasons ORDER BY SortOrder, ReasonName`);
    res.json({ success: true, data: result.recordset });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

router.post('/reasons', requireAdminOrPowerUser, async (req, res) => {
  const reasonCode = String(req.body.reasonCode || '').trim().toUpperCase();
  const reasonName = String(req.body.reasonName || '').trim();
  const requiresNote = Boolean(req.body.requiresNote);
  const sortOrder = Number(req.body.sortOrder ?? 0);
  if (!/^[A-Z0-9_]{2,30}$/.test(reasonCode) || !reasonName || reasonName.length > 100 || !Number.isInteger(sortOrder)) {
    return res.status(400).json({ success: false, message: 'กรอกรหัส ชื่อเหตุผล และลำดับให้ถูกต้อง' });
  }
  try {
    const pool = await poolPromise;
    await pool.request().input('ReasonCode', sql.NVarChar(30), reasonCode).input('ReasonName', sql.NVarChar(100), reasonName)
      .input('RequiresNote', sql.Bit, requiresNote).input('SortOrder', sql.Int, sortOrder)
      .query(`INSERT INTO dbo.ShortageReasons (ReasonCode, ReasonName, RequiresNote, SortOrder)
        VALUES (@ReasonCode, @ReasonName, @RequiresNote, @SortOrder)`);
    res.status(201).json({ success: true, message: 'เพิ่มเหตุผลขาดส่งแล้ว' });
  } catch (err) {
    const duplicate = err.number === 2627 || err.number === 2601;
    res.status(duplicate ? 409 : 500).json({ success: false, message: duplicate ? 'รหัสเหตุผลนี้มีอยู่แล้ว' : err.message });
  }
});

router.put('/reasons/:id', requireAdminOrPowerUser, async (req, res) => {
  const reasonId = Number.parseInt(req.params.id, 10);
  const reasonName = String(req.body.reasonName || '').trim();
  const sortOrder = Number(req.body.sortOrder ?? 0);
  if (!Number.isInteger(reasonId) || !reasonName || reasonName.length > 100 || !Number.isInteger(sortOrder)) {
    return res.status(400).json({ success: false, message: 'ข้อมูลเหตุผลขาดส่งไม่ถูกต้อง' });
  }
  try {
    const pool = await poolPromise;
    const result = await pool.request().input('ReasonId', sql.Int, reasonId).input('ReasonName', sql.NVarChar(100), reasonName)
      .input('RequiresNote', sql.Bit, Boolean(req.body.requiresNote)).input('IsActive', sql.Bit, Boolean(req.body.isActive))
      .input('SortOrder', sql.Int, sortOrder)
      .query(`UPDATE dbo.ShortageReasons SET ReasonName = @ReasonName, RequiresNote = @RequiresNote,
        IsActive = @IsActive, SortOrder = @SortOrder, UpdatedAt = SYSDATETIME() WHERE ReasonId = @ReasonId;
        SELECT @@ROWCOUNT AS Changed;`);
    if (!result.recordset[0].Changed) return res.status(404).json({ success: false, message: 'ไม่พบเหตุผลขาดส่งนี้' });
    res.json({ success: true, message: 'อัปเดต Master เหตุผลขาดส่งแล้ว' });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

router.delete('/reasons/:id', requireAdminOrPowerUser, async (req, res) => {
  const reasonId = Number.parseInt(req.params.id, 10);
  if (!Number.isInteger(reasonId)) return res.status(400).json({ success: false, message: 'รหัสเหตุผลไม่ถูกต้อง' });
  try {
    const pool = await poolPromise;
    const result = await pool.request().input('ReasonId', sql.Int, reasonId).query(`
      UPDATE dbo.ShortageReasons SET IsActive = 0, UpdatedAt = SYSDATETIME() WHERE ReasonId = @ReasonId;
      SELECT @@ROWCOUNT AS Changed;
    `);
    if (!result.recordset[0].Changed) return res.status(404).json({ success: false, message: 'ไม่พบเหตุผลขาดส่งนี้' });
    res.json({ success: true, message: 'ปิดใช้งานเหตุผลแล้ว (เก็บประวัติเดิมไว้)' });
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
      WHERE (@OpenOnly = 0 OR o.Status = 'OPEN' OR (
        o.Status = 'COMPLETED_SHORT' AND EXISTS (
          SELECT 1 FROM dbo.ReceiveShortages pending
          WHERE pending.ReceiveId = o.ReceiveId AND pending.Status = 'PENDING_CN'
        )
      ))
      GROUP BY o.ReceiveId, o.ReceiveNo, o.PONumber, o.SupplierName, o.Status, o.CreatedAt, o.CompletedAt, creator.Username
      ORDER BY CASE WHEN o.Status = 'OPEN' THEN 0 ELSE 1 END, o.CreatedAt DESC
    `);
    res.json({ success: true, data: result.recordset });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

router.get('/pending-shortages', requireAdminOrPowerUser, async (req, res) => {
  try {
    const pool = await poolPromise;
    const result = await pool.request().query(`
      SELECT s.ShortageId, s.ReceiveId, s.Quantity, s.ReasonCode, s.Note, s.RecordedAt,
        o.ReceiveNo, o.PONumber, o.SupplierName,
        p.Barcode, p.ItemCode, p.ItemName, p.UOM, s.ReasonNameSnapshot AS ReasonName,
        recorder.Username AS RecordedByName
      FROM dbo.ReceiveShortages s
      JOIN dbo.ReceiveOrders o ON o.ReceiveId = s.ReceiveId
      JOIN dbo.ReceiveOrderLines l ON l.ReceiveLineId = s.ReceiveLineId
      JOIN dbo.Products p ON p.ProductId = l.ProductId
      JOIN dbo.Users recorder ON recorder.UserId = s.RecordedBy
      WHERE s.Status = 'PENDING_CN'
      ORDER BY s.RecordedAt, o.PONumber, p.ItemCode
    `);
    res.json({ success: true, data: result.recordset });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

router.get('/credit-notes', requireAdminOrPowerUser, async (req, res) => {
  try {
    const pool = await poolPromise;
    const result = await pool.request().query(`
      SELECT cn.CreditNoteId, cn.CreditNoteNo, cn.IssuedAt, cn.Subtotal, cn.TaxAmount, cn.TotalAmount,
        o.PONumber,
        STUFF((SELECT N', ' + p2.ItemCode + N' × ' + CONVERT(NVARCHAR(20), l2.Quantity)
          FROM dbo.CreditNoteLines l2 JOIN dbo.Products p2 ON p2.ProductId = l2.ProductId
          WHERE l2.CreditNoteId = cn.CreditNoteId FOR XML PATH(''), TYPE).value('.', 'NVARCHAR(MAX)'), 1, 2, '') AS Items,
        issuer.Username AS IssuedByName
      FROM dbo.CreditNotes cn
      JOIN dbo.ReceiveOrders o ON o.ReceiveId = cn.ReceiveId
      JOIN dbo.Users issuer ON issuer.UserId = cn.IssuedBy
      ORDER BY cn.IssuedAt DESC, cn.CreditNoteId DESC
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
      SELECT o.Status, line.ReceiveLineId, p.ProductId, p.Barcode, p.ItemCode, p.ItemName, p.UOM,
        line.OrderedQuantity, line.ReceivedQuantity,
        COALESCE(shortages.ShortageQuantity, 0) AS ShortageQuantity,
        line.OrderedQuantity - line.ReceivedQuantity - COALESCE(shortages.ShortageQuantity, 0) AS RemainingQuantity
      FROM dbo.ReceiveOrders o
      JOIN dbo.ReceiveOrderLines line ON line.ReceiveId = o.ReceiveId
      JOIN dbo.Products p ON p.ProductId = line.ProductId
      OUTER APPLY (
        SELECT SUM(s.Quantity) AS ShortageQuantity FROM dbo.ReceiveShortages s
        WHERE s.ReceiveLineId = line.ReceiveLineId AND s.Status IN ('PENDING_CN','CN_ISSUED')
      ) shortages
      WHERE o.ReceiveId = @ReceiveId
      ORDER BY p.ItemCode
    `);
    const shortageDetails = await pool.request()
      .input('ReceiveId', sql.Int, receiveId)
      .input('UserId', sql.Int, req.user.id || req.user.userId)
      .query(`
      SELECT s.ShortageId, s.ReceiveLineId, s.ReasonNameSnapshot AS ReasonName, s.Quantity,
        s.Note, s.RecordedAt, s.Status,
        CASE WHEN s.RecordedBy = @UserId AND s.Status = 'PENDING_CN' THEN 1 ELSE 0 END AS CanCancel
      FROM dbo.ReceiveShortages s
      WHERE s.ReceiveId = @ReceiveId AND s.Status IN ('PENDING_CN','CN_ISSUED')
      ORDER BY s.ReceiveLineId, s.RecordedAt, s.ShortageId
    `);
    for (const line of result.recordset) {
      line.ShortageBreakdown = shortageDetails.recordset
        .filter(item => item.ReceiveLineId === line.ReceiveLineId)
        .map(item => ({ ShortageId: item.ShortageId, ReasonName: item.ReasonName, Quantity: item.Quantity, Note: item.Note, CanCancel: Boolean(item.CanCancel) }));
    }
    const elevated = ['ADMIN', 'POWERUSER'].includes(String(req.user.role || '').toUpperCase());
    const canViewShortClosedOrder = result.recordset[0]?.Status === 'COMPLETED_SHORT' && shortageDetails.recordset.some(item => item.Status === 'PENDING_CN');
    if (!elevated && (!hasReceivePermission(req.user) || !result.recordset.length || (result.recordset[0].Status !== 'OPEN' && !canViewShortClosedOrder))) {
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
    const shortageResult = await request().input('ReceiveLineId', sql.Int, line.ReceiveLineId).query(`
      SELECT COALESCE(SUM(Quantity), 0) AS ShortageQuantity FROM dbo.ReceiveShortages
      WHERE ReceiveLineId = @ReceiveLineId AND Status IN ('PENDING_CN','CN_ISSUED')
    `);
    const remaining = line.OrderedQuantity - line.ReceivedQuantity - shortageResult.recordset[0].ShortageQuantity;
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
      SELECT COUNT(*) AS RemainingLines
      FROM dbo.ReceiveOrderLines l
      OUTER APPLY (
        SELECT SUM(s.Quantity) AS ShortageQuantity FROM dbo.ReceiveShortages s
        WHERE s.ReceiveLineId = l.ReceiveLineId AND s.Status IN ('PENDING_CN','CN_ISSUED')
      ) shortage
      WHERE l.ReceiveId = @ReceiveId
        AND l.ReceivedQuantity + COALESCE(shortage.ShortageQuantity, 0) < l.OrderedQuantity;
      UPDATE o SET Status = CASE WHEN EXISTS (
          SELECT 1 FROM dbo.ReceiveShortages s WHERE s.ReceiveId = o.ReceiveId AND s.Status IN ('PENDING_CN','CN_ISSUED')
        ) THEN 'COMPLETED_SHORT' ELSE 'COMPLETED' END,
        CompletedAt = SYSDATETIME()
      FROM dbo.ReceiveOrders o
      WHERE o.ReceiveId = @ReceiveId AND NOT EXISTS (
        SELECT 1 FROM dbo.ReceiveOrderLines l
        OUTER APPLY (
          SELECT SUM(s.Quantity) AS ShortageQuantity FROM dbo.ReceiveShortages s
          WHERE s.ReceiveLineId = l.ReceiveLineId AND s.Status IN ('PENDING_CN','CN_ISSUED')
        ) shortage
        WHERE l.ReceiveId = o.ReceiveId
          AND l.ReceivedQuantity + COALESCE(shortage.ShortageQuantity, 0) < l.OrderedQuantity
      );
    `);
    await transaction.commit();
    res.json({ success: true, message: 'รับสินค้าเข้าสต็อกแล้ว', completed: completion.recordset[0].RemainingLines === 0, item: product, locationCode });
  } catch (err) {
    try { await transaction.rollback(); } catch (_) {}
    res.status(400).json({ success: false, message: err.message });
  }
});

router.post('/:id/shortages', requireReceivePermission, async (req, res) => {
  const receiveId = Number.parseInt(req.params.id, 10);
  const barcode = String(req.body.barcode || '').trim();
  const quantity = Number(req.body.quantity);
  const reasonId = Number(req.body.reasonId);
  const note = String(req.body.note || '').trim();
  if (!Number.isInteger(receiveId) || !barcode || !Number.isInteger(quantity) || quantity <= 0 || !Number.isInteger(reasonId)) {
    return res.status(400).json({ success: false, message: 'กรุณาระบุสินค้า จำนวนขาดส่ง และเหตุผลให้ถูกต้อง' });
  }

  const pool = await poolPromise;
  const transaction = new sql.Transaction(pool);
  try {
    await transaction.begin();
    const request = () => new sql.Request(transaction);
    const order = await request().input('ReceiveId', sql.Int, receiveId).query(`
      SELECT Status FROM dbo.ReceiveOrders WITH (UPDLOCK, ROWLOCK) WHERE ReceiveId = @ReceiveId
    `);
    if (!order.recordset.length || order.recordset[0].Status !== 'OPEN') throw new Error('ไม่พบใบรับ PO ที่ยังเปิดรับสินค้า');
    const reason = await request().input('ReasonId', sql.Int, reasonId).query(`
      SELECT ReasonId, ReasonCode, ReasonName, RequiresNote FROM dbo.ShortageReasons WHERE ReasonId = @ReasonId AND IsActive = 1
    `);
    if (!reason.recordset.length) throw new Error('เหตุผลนี้ถูกปิดใช้งานแล้ว กรุณาเลือกเหตุผลใหม่');
    if (reason.recordset[0].RequiresNote && !note) throw new Error('เหตุผลนี้กำหนดให้กรอกหมายเหตุ');
    const product = await request().input('Barcode', sql.NVarChar(50), barcode).query('SELECT ProductId FROM dbo.Products WHERE Barcode = @Barcode');
    if (!product.recordset.length) throw new Error(`ไม่พบสินค้า Barcode ${barcode}`);
    const line = await request().input('ReceiveId', sql.Int, receiveId).input('ProductId', sql.Int, product.recordset[0].ProductId).query(`
      SELECT ReceiveLineId, OrderedQuantity, ReceivedQuantity FROM dbo.ReceiveOrderLines WITH (UPDLOCK, ROWLOCK)
      WHERE ReceiveId = @ReceiveId AND ProductId = @ProductId
    `);
    if (!line.recordset.length) throw new Error('สินค้านี้ไม่มีอยู่ใน PO ที่เลือก');
    const row = line.recordset[0];
    const existing = await request().input('ReceiveLineId', sql.Int, row.ReceiveLineId).query(`
      SELECT COALESCE(SUM(Quantity), 0) AS ShortageQuantity FROM dbo.ReceiveShortages
      WHERE ReceiveLineId = @ReceiveLineId AND Status IN ('PENDING_CN','CN_ISSUED')
    `);
    const remaining = row.OrderedQuantity - row.ReceivedQuantity - existing.recordset[0].ShortageQuantity;
    if (quantity > remaining) throw new Error(`แจ้งขาดเกินยอดคงเหลือไม่ได้ เหลือจัดการ ${remaining} ชิ้น`);
    const inserted = await request()
      .input('ReceiveId', sql.Int, receiveId)
      .input('ReceiveLineId', sql.Int, row.ReceiveLineId)
      .input('ReasonId', sql.Int, reasonId)
      .input('Quantity', sql.Int, quantity)
      .input('ReasonCode', sql.NVarChar(30), reason.recordset[0].ReasonCode)
      .input('ReasonNameSnapshot', sql.NVarChar(100), reason.recordset[0].ReasonName)
      .input('Note', sql.NVarChar(300), note || null)
      .input('RecordedBy', sql.Int, req.user.id || req.user.userId)
      .query(`INSERT INTO dbo.ReceiveShortages (ReceiveId, ReceiveLineId, ReasonId, Quantity, ReasonCode, ReasonNameSnapshot, Note, RecordedBy)
        OUTPUT INSERTED.ShortageId VALUES (@ReceiveId, @ReceiveLineId, @ReasonId, @Quantity, @ReasonCode, @ReasonNameSnapshot, @Note, @RecordedBy)`);
    const completion = await request().input('ReceiveId', sql.Int, receiveId).query(`
      SELECT COUNT(*) AS RemainingLines
      FROM dbo.ReceiveOrderLines l
      OUTER APPLY (
        SELECT SUM(s.Quantity) AS ShortageQuantity FROM dbo.ReceiveShortages s
        WHERE s.ReceiveLineId = l.ReceiveLineId AND s.Status IN ('PENDING_CN','CN_ISSUED')
      ) shortage
      WHERE l.ReceiveId = @ReceiveId
        AND l.ReceivedQuantity + COALESCE(shortage.ShortageQuantity, 0) < l.OrderedQuantity;
      UPDATE o SET Status = 'COMPLETED_SHORT', CompletedAt = SYSDATETIME()
      FROM dbo.ReceiveOrders o
      WHERE o.ReceiveId = @ReceiveId AND NOT EXISTS (
        SELECT 1 FROM dbo.ReceiveOrderLines l
        OUTER APPLY (
          SELECT SUM(s.Quantity) AS ShortageQuantity FROM dbo.ReceiveShortages s
          WHERE s.ReceiveLineId = l.ReceiveLineId AND s.Status IN ('PENDING_CN','CN_ISSUED')
        ) shortage
        WHERE l.ReceiveId = o.ReceiveId
          AND l.ReceivedQuantity + COALESCE(shortage.ShortageQuantity, 0) < l.OrderedQuantity
      );
    `);
    await transaction.commit();
    res.status(201).json({ success: true, shortageId: inserted.recordset[0].ShortageId, completed: completion.recordset[0].RemainingLines === 0, message: 'บันทึกยอดขาดส่ง รอ Admin/Power User ออก CN แล้ว' });
  } catch (err) {
    try { await transaction.rollback(); } catch (_) {}
    res.status(400).json({ success: false, message: err.message });
  }
});

router.delete('/shortages/:id', requireReceivePermission, async (req, res) => {
  const shortageId = Number.parseInt(req.params.id, 10);
  if (!Number.isInteger(shortageId)) return res.status(400).json({ success: false, message: 'รายการขาดส่งไม่ถูกต้อง' });
  try {
    const pool = await poolPromise;
    const canManageAll = ['ADMIN', 'POWERUSER'].includes(String(req.user.role || '').toUpperCase());
    const result = await pool.request()
      .input('ShortageId', sql.Int, shortageId)
      .input('UserId', sql.Int, req.user.id || req.user.userId)
      .input('CanManageAll', sql.Bit, canManageAll)
      .input('ResolvedBy', sql.Int, req.user.id || req.user.userId)
      .query(`UPDATE dbo.ReceiveShortages SET Status = 'CANCELLED', ResolvedBy = @ResolvedBy, ResolvedAt = SYSDATETIME()
        WHERE ShortageId = @ShortageId AND Status = 'PENDING_CN'
          AND (@CanManageAll = 1 OR RecordedBy = @UserId);
        DECLARE @Changed INT = @@ROWCOUNT;
        SELECT @Changed AS Changed;
        IF @Changed > 0
        BEGIN
        UPDATE o SET Status = CASE
            WHEN EXISTS (
              SELECT 1 FROM dbo.ReceiveOrderLines l
              OUTER APPLY (
                SELECT SUM(s.Quantity) AS ShortageQuantity FROM dbo.ReceiveShortages s
                WHERE s.ReceiveLineId = l.ReceiveLineId AND s.Status IN ('PENDING_CN','CN_ISSUED')
              ) shortage
              WHERE l.ReceiveId = o.ReceiveId
                AND l.ReceivedQuantity + COALESCE(shortage.ShortageQuantity, 0) < l.OrderedQuantity
            ) THEN 'OPEN'
            WHEN EXISTS (SELECT 1 FROM dbo.ReceiveShortages s WHERE s.ReceiveId = o.ReceiveId AND s.Status IN ('PENDING_CN','CN_ISSUED')) THEN 'COMPLETED_SHORT'
            ELSE 'COMPLETED' END,
          CompletedAt = CASE WHEN EXISTS (
            SELECT 1 FROM dbo.ReceiveOrderLines l
            OUTER APPLY (
              SELECT SUM(s.Quantity) AS ShortageQuantity FROM dbo.ReceiveShortages s
              WHERE s.ReceiveLineId = l.ReceiveLineId AND s.Status IN ('PENDING_CN','CN_ISSUED')
            ) shortage
            WHERE l.ReceiveId = o.ReceiveId
              AND l.ReceivedQuantity + COALESCE(shortage.ShortageQuantity, 0) < l.OrderedQuantity
          ) THEN NULL ELSE COALESCE(o.CompletedAt, SYSDATETIME()) END
        FROM dbo.ReceiveOrders o
        WHERE o.ReceiveId = (SELECT ReceiveId FROM dbo.ReceiveShortages WHERE ShortageId = @ShortageId)
          AND o.Status IN ('OPEN','COMPLETED','COMPLETED_SHORT');
        END;`);
    if (!result.recordset[0].Changed) return res.status(409).json({ success: false, message: 'ยกเลิกไม่ได้: รายการอาจไม่ใช่ของคุณ ออก CN แล้ว หรือถูกยกเลิกไปแล้ว' });
    res.json({ success: true, message: 'ยกเลิกรายการขาดส่งแล้ว ยอดดังกล่าวกลับไปรับเข้าได้' });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

router.post('/credit-notes/issue', requireAdminOrPowerUser, async (req, res) => {
  const lines = Array.isArray(req.body.lines) ? req.body.lines.map(line => ({
    shortageId: Number(line.shortageId), unitPrice: Number(line.unitPrice), vatRate: Number(line.vatRate ?? 0)
  })) : [];
  if (!lines.length || lines.length > 100 || lines.some(line => !Number.isInteger(line.shortageId) || !Number.isFinite(line.unitPrice) || line.unitPrice < 0 || !Number.isFinite(line.vatRate) || line.vatRate < 0 || line.vatRate > 100)) {
    return res.status(400).json({ success: false, message: 'รายการขาดส่ง ราคาต่อหน่วย หรืออัตราภาษีไม่ถูกต้อง' });
  }
  if (new Set(lines.map(line => line.shortageId)).size !== lines.length) return res.status(400).json({ success: false, message: 'พบรายการขาดส่งซ้ำใน CN' });
  const pool = await poolPromise;
  const transaction = new sql.Transaction(pool);
  try {
    await transaction.begin();
    const request = () => new sql.Request(transaction);
    const firstShortage = await request().input('FirstShortageId', sql.Int, lines[0].shortageId).query('SELECT ReceiveId FROM dbo.ReceiveShortages WHERE ShortageId = @FirstShortageId');
    if (!firstShortage.recordset.length) throw new Error('ไม่พบรายการขาดส่ง');
    const receiveId = firstShortage.recordset[0].ReceiveId;
    await request().input('ReceiveId', sql.Int, receiveId).query('SELECT ReceiveId FROM dbo.ReceiveOrders WITH (UPDLOCK, ROWLOCK) WHERE ReceiveId = @ReceiveId');
    const pendingSet = await request().input('ReceiveId', sql.Int, receiveId).query("SELECT ShortageId FROM dbo.ReceiveShortages WHERE ReceiveId = @ReceiveId AND Status = 'PENDING_CN'");
    const pendingIds = pendingSet.recordset.map(item => item.ShortageId).sort((a, b) => a - b);
    const selectedIds = lines.map(item => item.shortageId).sort((a, b) => a - b);
    if (pendingIds.length !== selectedIds.length || pendingIds.some((id, index) => id !== selectedIds[index])) throw new Error('มีรายการขาดส่งของ PO นี้เปลี่ยนแปลง กรุณารีเฟรชก่อนออก CN');
    const shortageQuery = request();
    const idParams = lines.map((line, index) => {
      shortageQuery.input(`ShortageId${index}`, sql.Int, line.shortageId);
      return `@ShortageId${index}`;
    });
    const shortage = await shortageQuery.query(`
      SELECT s.ReceiveId, s.ReceiveLineId, s.Quantity, s.Status, l.ProductId
      FROM dbo.ReceiveShortages s WITH (UPDLOCK, ROWLOCK)
      JOIN dbo.ReceiveOrderLines l ON l.ReceiveLineId = s.ReceiveLineId
      WHERE s.ShortageId IN (${idParams.join(',')})
    `);
    if (shortage.recordset.length !== lines.length || shortage.recordset.some(row => row.Status !== 'PENDING_CN')) throw new Error('มีรายการที่ไม่อยู่ในสถานะรอออก CN แล้ว กรุณารีเฟรชรายการ');
    if (shortage.recordset.some(row => row.ReceiveId !== receiveId)) throw new Error('หนึ่ง CN ต้องอ้างอิง PO เดียวกัน');
    const issueDate = new Date();
    const dateKey = `${issueDate.getFullYear()}${String(issueDate.getMonth() + 1).padStart(2, '0')}${String(issueDate.getDate()).padStart(2, '0')}`;
    const creditNoteNo = `CN-${dateKey}-${receiveId}-${Date.now()}-${Math.floor(Math.random() * 900 + 100)}`;
    const header = await request()
      .input('CreditNoteNo', sql.NVarChar(40), creditNoteNo)
      .input('ReceiveId', sql.Int, receiveId)
      .input('IssuedBy', sql.Int, req.user.id || req.user.userId)
      .query(`INSERT INTO dbo.CreditNotes (CreditNoteNo, ReceiveId, IssuedBy)
        OUTPUT INSERTED.CreditNoteId VALUES (@CreditNoteNo, @ReceiveId, @IssuedBy)`);
    const creditNoteId = header.recordset[0].CreditNoteId;
    for (const item of shortage.recordset) {
      const price = lines.find(line => line.shortageId === item.ShortageId);
      await request()
        .input('CreditNoteId', sql.Int, creditNoteId)
        .input('ShortageId', sql.Int, item.ShortageId)
        .input('ProductId', sql.Int, item.ProductId)
        .input('Quantity', sql.Int, item.Quantity)
        .input('UnitPrice', sql.Decimal(19, 4), price.unitPrice)
        .input('VatRate', sql.Decimal(5, 2), price.vatRate)
        .query(`
          DECLARE @net DECIMAL(19,2) = ROUND(@Quantity * @UnitPrice, 2);
          DECLARE @tax DECIMAL(19,2) = ROUND(@net * @VatRate / 100.0, 2);
          INSERT INTO dbo.CreditNoteLines (CreditNoteId, ShortageId, ProductId, Quantity, UnitPrice, VatRate, NetAmount, TaxAmount, TotalAmount)
          VALUES (@CreditNoteId, @ShortageId, @ProductId, @Quantity, @UnitPrice, @VatRate, @net, @tax, @net + @tax);
        `);
      await request().input('ShortageId', sql.Int, item.ShortageId).input('ResolvedBy', sql.Int, req.user.id || req.user.userId).query(`
        UPDATE dbo.ReceiveShortages SET Status = 'CN_ISSUED', ResolvedBy = @ResolvedBy, ResolvedAt = SYSDATETIME()
        WHERE ShortageId = @ShortageId;
      `);
    }
    const totals = await request().input('CreditNoteId', sql.Int, creditNoteId).query(`
      UPDATE cn SET Subtotal = totals.Subtotal, TaxAmount = totals.TaxAmount, TotalAmount = totals.TotalAmount
      FROM dbo.CreditNotes cn CROSS APPLY (
        SELECT SUM(NetAmount) AS Subtotal, SUM(TaxAmount) AS TaxAmount, SUM(TotalAmount) AS TotalAmount
        FROM dbo.CreditNoteLines WHERE CreditNoteId = @CreditNoteId
      ) totals WHERE cn.CreditNoteId = @CreditNoteId;
      SELECT Subtotal, TaxAmount, TotalAmount FROM dbo.CreditNotes WHERE CreditNoteId = @CreditNoteId;
    `);
    await request().input('ReceiveId', sql.Int, receiveId).query(`
      UPDATE o SET Status = 'COMPLETED_SHORT', CompletedAt = SYSDATETIME()
      FROM dbo.ReceiveOrders o
      WHERE o.ReceiveId = @ReceiveId AND o.Status = 'OPEN'
        AND NOT EXISTS (
          SELECT 1 FROM dbo.ReceiveOrderLines l
          WHERE l.ReceiveId = o.ReceiveId
            AND l.OrderedQuantity > l.ReceivedQuantity + COALESCE((
              SELECT SUM(s.Quantity) FROM dbo.ReceiveShortages s
              WHERE s.ReceiveLineId = l.ReceiveLineId AND s.Status = 'CN_ISSUED'
            ), 0)
        );
    `);
    await transaction.commit();
    res.status(201).json({ success: true, creditNoteId, creditNoteNo, totals: totals.recordset[0], message: 'ออก CN สำเร็จ' });
  } catch (err) {
    try { await transaction.rollback(); } catch (_) {}
    res.status(400).json({ success: false, message: err.message });
  }
});

module.exports = router;
