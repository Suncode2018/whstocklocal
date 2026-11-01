const express = require('express');
const jwt = require('jsonwebtoken');
const { poolPromise, sql } = require('../config/db');

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || 'super_secret_local_warehouse_jwt_key_2026';

function authenticate(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ success: false, message: 'กรุณาเข้าสู่ระบบ' });
  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return res.status(403).json({ success: false, message: 'เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่' });
    req.user = user;
    next();
  });
}

function requireAdmin(req, res, next) {
  if (req.user.role !== 'ADMIN') return res.status(403).json({ success: false, message: 'เฉพาะ ADMIN เท่านั้นที่ปิดรอบและปรับยอดสต็อกได้' });
  next();
}

function requireCycleCountPermission(req, res, next) {
  const permissions = String(req.user.permissions || '').split(',').map(value => value.trim().toUpperCase());
  if (['ADMIN', 'POWERUSER'].includes(String(req.user.role || '').toUpperCase()) || permissions.includes('ALL') || permissions.includes('CYCLECOUNT') || permissions.includes('CYCLE_COUNT')) return next();
  return res.status(403).json({ success: false, message: 'ไม่มีสิทธิ์ตรวจนับ Cycle Count' });
}

function requireAdminOrPowerUser(req, res, next) {
  if (!['ADMIN', 'POWERUSER'].includes(String(req.user.role || '').toUpperCase())) return res.status(403).json({ success: false, message: 'เฉพาะ ADMIN หรือ POWERUSER เท่านั้น' });
  next();
}

router.use(authenticate);

let schemaReadyPromise = null;

async function ensureCycleCountSchema() {
  if (!schemaReadyPromise) {
    schemaReadyPromise = (async () => {
      const pool = await poolPromise;
      await pool.request().query(`
      IF OBJECT_ID('dbo.CycleCountSessions', 'U') IS NULL
      BEGIN
        CREATE TABLE dbo.CycleCountSessions (
          SessionId INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
          SessionCode NVARCHAR(40) NOT NULL UNIQUE,
          SessionName NVARCHAR(100) NOT NULL,
          ScopeType NVARCHAR(10) NOT NULL,
          ScopeValue NVARCHAR(50) NULL,
          Status NVARCHAR(12) NOT NULL CONSTRAINT DF_CycleCountSessions_Status DEFAULT ('OPEN'),
          CreatedBy INT NOT NULL,
          CreatedAt DATETIME2 NOT NULL CONSTRAINT DF_CycleCountSessions_CreatedAt DEFAULT (SYSUTCDATETIME()),
          ExpiresAt DATETIME2 NOT NULL,
          ClosedBy INT NULL,
          ClosedAt DATETIME2 NULL,
          CONSTRAINT FK_CycleCountSessions_CreatedBy FOREIGN KEY (CreatedBy) REFERENCES dbo.Users(UserId),
          CONSTRAINT FK_CycleCountSessions_ClosedBy FOREIGN KEY (ClosedBy) REFERENCES dbo.Users(UserId),
          CONSTRAINT CK_CycleCountSessions_ScopeType CHECK (ScopeType IN ('ZONE','LOCATION')),
          CONSTRAINT CK_CycleCountSessions_Status CHECK (Status IN ('OPEN','CLOSED'))
        );
      END;
      `);
      const expiryColumn = await pool.request().query("SELECT COL_LENGTH('dbo.CycleCountSessions', 'ExpiresAt') AS ColumnLength");
      if (expiryColumn.recordset[0].ColumnLength == null) {
        await pool.request().query('ALTER TABLE dbo.CycleCountSessions ADD ExpiresAt DATETIME2 NULL');
      }
      await pool.request().query('UPDATE dbo.CycleCountSessions SET ExpiresAt = DATEADD(hour, 24, CreatedAt) WHERE ExpiresAt IS NULL');
      await pool.request().query('ALTER TABLE dbo.CycleCountSessions ALTER COLUMN ExpiresAt DATETIME2 NOT NULL');

      await pool.request().query(`
      IF OBJECT_ID('dbo.CYCLECOUNT', 'U') IS NULL AND OBJECT_ID('dbo.CycleCountItems', 'U') IS NOT NULL
        EXEC sp_rename 'dbo.CycleCountItems', 'CYCLECOUNT';
      IF OBJECT_ID('dbo.CYCLECOUNT', 'U') IS NULL
      BEGIN
        CREATE TABLE dbo.CYCLECOUNT (
          CycleCountItemId INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
          SessionId INT NOT NULL,
          ProductId INT NOT NULL,
          LocationId INT NOT NULL,
          ExpectedQuantity INT NOT NULL,
          CountedQuantity INT NULL,
          CountedBy INT NULL,
          CountedAt DATETIME2 NULL,
          CONSTRAINT FK_CYCLECOUNT_Session FOREIGN KEY (SessionId) REFERENCES dbo.CycleCountSessions(SessionId),
          CONSTRAINT FK_CYCLECOUNT_Product FOREIGN KEY (ProductId) REFERENCES dbo.Products(ProductId),
          CONSTRAINT FK_CYCLECOUNT_Location FOREIGN KEY (LocationId) REFERENCES dbo.Locations(LocationId),
          CONSTRAINT FK_CYCLECOUNT_CountedBy FOREIGN KEY (CountedBy) REFERENCES dbo.Users(UserId),
          CONSTRAINT UQ_CYCLECOUNT UNIQUE (SessionId, ProductId, LocationId)
        );
        CREATE INDEX IX_CYCLECOUNT_Session ON dbo.CYCLECOUNT(SessionId, LocationId);
      END;
      `);
    })().catch(err => {
      schemaReadyPromise = null;
      throw err;
    });
  }
  await schemaReadyPromise;
}

// Ensure the daily count tables exist for both Admin and Power User on first use.
router.use(async (req, res, next) => {
  try {
    await ensureCycleCountSchema();
    next();
  } catch (err) {
    console.error('Cycle Count schema initialization failed:', err);
    res.status(500).json({ success: false, message: `สร้างตาราง Cycle Count ไม่สำเร็จ: ${err.message}` });
  }
});

router.get('/', requireCycleCountPermission, async (req, res) => {
  try {
    const pool = await poolPromise;
    const result = await pool.request().query(`
      SELECT s.SessionId, s.SessionCode, s.SessionName, s.ScopeType, s.ScopeValue,
        CASE WHEN s.Status = 'OPEN' AND s.ExpiresAt <= SYSUTCDATETIME() THEN 'EXPIRED' ELSE s.Status END AS Status,
        s.CreatedAt, s.ExpiresAt,
        creator.Username AS CreatedByName,
        COUNT(i.CycleCountItemId) AS TotalItems,
        SUM(CASE WHEN i.CountedQuantity IS NOT NULL THEN 1 ELSE 0 END) AS CountedItems,
        SUM(CASE WHEN i.CountedQuantity IS NOT NULL AND i.CountedQuantity <> i.ExpectedQuantity THEN 1 ELSE 0 END) AS VarianceItems
      FROM dbo.CycleCountSessions s
      JOIN dbo.Users creator ON creator.UserId = s.CreatedBy
      LEFT JOIN dbo.CYCLECOUNT i ON i.SessionId = s.SessionId
      GROUP BY s.SessionId, s.SessionCode, s.SessionName, s.ScopeType, s.ScopeValue, s.Status, s.CreatedAt, s.ExpiresAt, creator.Username
      ORDER BY s.SessionId DESC
    `);
    res.json({ success: true, data: result.recordset });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.get('/:id/items', requireCycleCountPermission, async (req, res) => {
  const sessionId = Number.parseInt(req.params.id, 10);
  if (!Number.isInteger(sessionId)) return res.status(400).json({ success: false, message: 'รอบตรวจนับไม่ถูกต้อง' });
  try {
    const pool = await poolPromise;
    const result = await pool.request().input('SessionId', sql.Int, sessionId).query(`
      SELECT i.CycleCountItemId, p.Barcode, p.ItemCode, p.ItemName, p.UOM,
        l.LocationCode, l.Zone, i.ExpectedQuantity, i.CountedQuantity,
        CASE WHEN i.CountedQuantity IS NULL THEN NULL ELSE i.CountedQuantity - i.ExpectedQuantity END AS Variance,
        u.Username AS CountedByName, i.CountedAt
      FROM dbo.CYCLECOUNT i
      JOIN dbo.Products p ON p.ProductId = i.ProductId
      JOIN dbo.Locations l ON l.LocationId = i.LocationId
      LEFT JOIN dbo.Users u ON u.UserId = i.CountedBy
      WHERE i.SessionId = @SessionId
      ORDER BY l.LocationCode, p.ItemCode
    `);
    res.json({ success: true, data: result.recordset });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post('/', requireAdminOrPowerUser, async (req, res) => {
  const sessionName = String(req.body.sessionName || '').trim();
  const scopeType = String(req.body.scopeType || '').toUpperCase();
  const scopeValue = String(req.body.scopeValue || '').trim().toUpperCase();
  if (!sessionName || !['ZONE', 'LOCATION'].includes(scopeType) || !scopeValue) {
    return res.status(400).json({ success: false, message: 'กรุณาระบุชื่อรอบและเลือกโซนหรือโลเคชั่น' });
  }
  const pool = await poolPromise;
  const transaction = new sql.Transaction(pool);
  try {
    await transaction.begin();
    const scopeRequest = new sql.Request(transaction)
      .input('ScopeValue', sql.NVarChar(50), scopeValue)
      .input('ScopeType', sql.NVarChar(10), scopeType);
    const locationsResult = await scopeRequest.query(`
      SELECT LocationId, LocationCode FROM dbo.Locations
      WHERE IsActive = 1 AND ((@ScopeType = 'ZONE' AND Zone = @ScopeValue) OR (@ScopeType = 'LOCATION' AND LocationCode = @ScopeValue))
    `);
    if (!locationsResult.recordset.length) throw new Error('ไม่พบโลเคชั่นที่เปิดใช้งานในขอบเขตที่เลือก');

    const code = `CC-${new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14)}-${Math.floor(Math.random() * 900 + 100)}`;
    const createResult = await new sql.Request(transaction)
      .input('SessionCode', sql.NVarChar(40), code)
      .input('SessionName', sql.NVarChar(100), sessionName)
      .input('ScopeType', sql.NVarChar(10), scopeType)
      .input('ScopeValue', sql.NVarChar(50), scopeValue)
      .input('CreatedBy', sql.Int, req.user.id || req.user.userId)
      .query(`INSERT INTO dbo.CycleCountSessions (SessionCode, SessionName, ScopeType, ScopeValue, CreatedBy, ExpiresAt)
        OUTPUT INSERTED.SessionId VALUES (@SessionCode, @SessionName, @ScopeType, @ScopeValue, @CreatedBy, DATEADD(hour, 24, SYSUTCDATETIME()))`);
    const sessionId = createResult.recordset[0].SessionId;
    for (const location of locationsResult.recordset) {
      const seedRequest = new sql.Request(transaction).input('SessionId', sql.Int, sessionId).input('LocationId', sql.Int, location.LocationId);
      await seedRequest.query(`
        INSERT INTO dbo.CYCLECOUNT (SessionId, ProductId, LocationId, ExpectedQuantity)
        SELECT @SessionId, p.ProductId, @LocationId, COALESCE(st.Quantity, 0)
        FROM dbo.Products p
        LEFT JOIN dbo.Stock st ON st.ProductId = p.ProductId AND st.LocationId = @LocationId
        WHERE p.ProductId NOT IN (SELECT ProductId FROM dbo.CYCLECOUNT WHERE SessionId = @SessionId AND LocationId = @LocationId)
      `);
    }
    await transaction.commit();
    res.status(201).json({ success: true, sessionId, sessionCode: code, message: 'เริ่มรอบตรวจนับแล้ว' });
  } catch (err) {
    await transaction.rollback();
    res.status(400).json({ success: false, message: err.message });
  }
});

router.post('/:id/count', requireCycleCountPermission, async (req, res) => {
  const sessionId = Number.parseInt(req.params.id, 10);
  const barcode = String(req.body.barcode || '').trim();
  const locationCode = String(req.body.locationCode || '').trim().toUpperCase();
  const countedQuantity = Number.parseInt(req.body.countedQuantity, 10);
  if (!Number.isInteger(sessionId) || !barcode || !locationCode || !Number.isInteger(countedQuantity) || countedQuantity < 0) {
    return res.status(400).json({ success: false, message: 'กรุณาระบุบาร์โค้ด โลเคชั่น และจำนวนที่ถูกต้อง' });
  }
  try {
    const pool = await poolPromise;
    const result = await pool.request()
      .input('SessionId', sql.Int, sessionId)
      .input('Barcode', sql.NVarChar(50), barcode)
      .input('LocationCode', sql.NVarChar(50), locationCode)
      .input('CountedQuantity', sql.Int, countedQuantity)
      .input('CountedBy', sql.Int, req.user.id || req.user.userId)
      .query(`
        UPDATE item SET CountedQuantity = @CountedQuantity, CountedBy = @CountedBy, CountedAt = SYSUTCDATETIME()
        OUTPUT INSERTED.CycleCountItemId
        FROM dbo.CYCLECOUNT item
        JOIN dbo.CycleCountSessions session ON session.SessionId = item.SessionId AND session.Status = 'OPEN' AND session.ExpiresAt > SYSUTCDATETIME()
        JOIN dbo.Products p ON p.ProductId = item.ProductId AND p.Barcode = @Barcode
        JOIN dbo.Locations l ON l.LocationId = item.LocationId AND l.LocationCode = @LocationCode
        WHERE item.SessionId = @SessionId
      `);
    if (!result.recordset.length) return res.status(404).json({ success: false, message: 'ไม่พบสินค้า/โลเคชั่นในรอบที่เปิดอยู่ หรือรอบถูกปิดแล้ว' });
    res.json({ success: true, message: 'บันทึกผลตรวจนับแล้ว' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post('/:id/close', requireAdmin, async (req, res) => {
  const sessionId = Number.parseInt(req.params.id, 10);
  if (!Number.isInteger(sessionId)) return res.status(400).json({ success: false, message: 'รอบตรวจนับไม่ถูกต้อง' });
  const pool = await poolPromise;
  const transaction = new sql.Transaction(pool);
  try {
    await transaction.begin();
    const session = await new sql.Request(transaction).input('SessionId', sql.Int, sessionId).query(`
      SELECT SessionCode, Status, ExpiresAt FROM dbo.CycleCountSessions WITH (UPDLOCK, ROWLOCK) WHERE SessionId = @SessionId
    `);
    if (!session.recordset.length || session.recordset[0].Status !== 'OPEN') throw new Error('ไม่พบรอบที่เปิดอยู่');
    if (new Date(session.recordset[0].ExpiresAt) <= new Date()) throw new Error('รอบตรวจนับหมดอายุแล้ว (อายุ 24 ชั่วโมง)');
    const pending = await new sql.Request(transaction).input('SessionId', sql.Int, sessionId).query(`
      SELECT COUNT(*) AS PendingCount FROM dbo.CYCLECOUNT WHERE SessionId = @SessionId AND CountedQuantity IS NULL
    `);
    if (pending.recordset[0].PendingCount) throw new Error(`ยังมี ${pending.recordset[0].PendingCount} รายการที่ไม่ได้ตรวจนับ`);
    await new sql.Request(transaction).input('SessionId', sql.Int, sessionId).input('UserId', sql.Int, req.user.id || req.user.userId).query(`
      UPDATE st SET Quantity = item.CountedQuantity, LastUpdated = GETDATE()
      FROM dbo.Stock st JOIN dbo.CYCLECOUNT item ON item.ProductId = st.ProductId AND item.LocationId = st.LocationId
      WHERE item.SessionId = @SessionId;
      INSERT INTO dbo.Stock (ProductId, LocationId, Quantity, LastUpdated)
      SELECT item.ProductId, item.LocationId, item.CountedQuantity, GETDATE()
      FROM dbo.CYCLECOUNT item
      WHERE item.SessionId = @SessionId
        AND NOT EXISTS (SELECT 1 FROM dbo.Stock st WHERE st.ProductId = item.ProductId AND st.LocationId = item.LocationId);
      INSERT INTO dbo.StockTransactions (TransactionType, ProductId, FromLocationId, ToLocationId, Quantity, ReferenceNo, UserId)
      SELECT N'CYCLECOUNT', item.ProductId, item.LocationId, item.LocationId, item.CountedQuantity - item.ExpectedQuantity,
        CONCAT(session.SessionCode, N':', product.ItemCode), @UserId
      FROM dbo.CYCLECOUNT item
      JOIN dbo.CycleCountSessions session ON session.SessionId = item.SessionId
      JOIN dbo.Products product ON product.ProductId = item.ProductId
      WHERE item.SessionId = @SessionId AND item.CountedQuantity <> item.ExpectedQuantity;
      UPDATE dbo.CycleCountSessions SET Status = 'CLOSED', ClosedBy = @UserId, ClosedAt = SYSUTCDATETIME()
      WHERE SessionId = @SessionId;
    `);
    await transaction.commit();
    res.json({ success: true, message: 'ปิดรอบและปรับยอดสต็อกแล้ว' });
  } catch (err) {
    await transaction.rollback();
    res.status(400).json({ success: false, message: err.message });
  }
});

module.exports = router;
