const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const { poolPromise, sql } = require('../config/db');

const JWT_SECRET = process.env.JWT_SECRET || 'super_secret_local_warehouse_jwt_key_2026';

function authenticate(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) return res.status(401).json({ success: false, message: 'กรุณาเข้าสู่ระบบ' });

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return res.status(403).json({ success: false, message: 'เซสชันหมดอายุ' });
    req.user = user;
    next();
  });
}

function requireAdmin(req, res, next) {
  if (req.user?.role !== 'ADMIN') return res.status(403).json({ success: false, message: 'เฉพาะ ADMIN เท่านั้น' });
  next();
}

function requireAdminOrPowerUser(req, res, next) {
  if (!['ADMIN', 'POWERUSER'].includes(req.user?.role)) {
    return res.status(403).json({ success: false, message: 'เฉพาะ ADMIN หรือ POWERUSER เท่านั้น' });
  }
  next();
}

let capacitySchemaPromise;
async function ensureCapacitySchema() {
  if (capacitySchemaPromise) return capacitySchemaPromise;
  capacitySchemaPromise = (async () => {
    const pool = await poolPromise;
    await pool.request().query(`
      IF COL_LENGTH('dbo.Locations', 'CapacityVolumeCm3') IS NULL
        ALTER TABLE dbo.Locations ADD CapacityVolumeCm3 DECIMAL(18,3) NULL;
      IF COL_LENGTH('dbo.Locations', 'CapacityWidthCm') IS NULL
        ALTER TABLE dbo.Locations ADD CapacityWidthCm DECIMAL(18,3) NULL;
      IF COL_LENGTH('dbo.Locations', 'CapacityLengthCm') IS NULL
        ALTER TABLE dbo.Locations ADD CapacityLengthCm DECIMAL(18,3) NULL;
      IF COL_LENGTH('dbo.Locations', 'CapacityHeightCm') IS NULL
        ALTER TABLE dbo.Locations ADD CapacityHeightCm DECIMAL(18,3) NULL;
      IF COL_LENGTH('dbo.Products', 'UnitVolumeCm3') IS NULL
        ALTER TABLE dbo.Products ADD UnitVolumeCm3 DECIMAL(18,3) NULL;
      IF OBJECT_ID('dbo.PutawayTaskLines', 'U') IS NOT NULL AND COL_LENGTH('dbo.PutawayTaskLines', 'UnitVolumeCm3') IS NULL
        ALTER TABLE dbo.PutawayTaskLines ADD UnitVolumeCm3 DECIMAL(18,3) NULL;
    `);
    await pool.request().query(`
      IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE parent_object_id = OBJECT_ID('dbo.Locations') AND name = 'CK_Locations_CapacityDimensions')
        ALTER TABLE dbo.Locations ADD CONSTRAINT CK_Locations_CapacityDimensions CHECK (
          (CapacityWidthCm IS NULL AND CapacityLengthCm IS NULL AND CapacityHeightCm IS NULL)
          OR (CapacityWidthCm IS NOT NULL AND CapacityLengthCm IS NOT NULL AND CapacityHeightCm IS NOT NULL
            AND CapacityWidthCm > 0 AND CapacityLengthCm > 0 AND CapacityHeightCm > 0)
        );
    `);
  })();
  try { await capacitySchemaPromise; } catch (error) { capacitySchemaPromise = null; throw error; }
}

function locationClass(code) {
  const value = String(code || '').trim().toUpperCase();
  if (/^RCV-/.test(value)) return { type: 'RECEIVING', zone: 'RECEIVING', defaultDescription: 'จุดรับสินค้าเข้าคลัง', hasCapacity: false };
  if (/^OUT-/.test(value)) return { type: 'SHIPPING', zone: 'SHIPPING', defaultDescription: 'จุดพักรอจ่ายสินค้า', hasCapacity: false };
  if (/^A-/.test(value)) return { type: 'STORAGE', zone: 'ZONE-A', defaultDescription: 'พื้นที่จัดเก็บสินค้า คลัง A', hasCapacity: true };
  if (/^B-/.test(value)) return { type: 'STORAGE', zone: 'ZONE-B', defaultDescription: 'พื้นที่จัดเก็บสินค้า คลัง B', hasCapacity: true };
  return { type: 'OTHER', zone: null, hasCapacity: false };
}

function readCapacity(widthValue, lengthValue, heightValue, hasCapacity) {
  if (!hasCapacity) return { width: null, length: null, height: null, value: null, hasDimensions: false };
  const raw = [widthValue, lengthValue, heightValue];
  const dimensions = raw.map(value => value == null || value === '' ? null : Number(value));
  const hasAny = dimensions.some(value => value !== null);
  const hasAll = dimensions.every(value => value !== null);
  if (!hasAny) return { width: null, length: null, height: null, value: null, hasDimensions: false };
  if (!hasAll || dimensions.some(value => !Number.isFinite(value) || value <= 0 || value > 999999999999999.999)) {
    return { error: 'กรอกกว้าง ยาว และสูงของช่องจัดเก็บให้ครบ และแต่ละค่าต้องมากกว่า 0 cm' };
  }
  const volume = dimensions.reduce((total, value) => total * value, 1);
  if (!Number.isFinite(volume) || volume > 999999999999999.999) return { error: 'ปริมาตรช่องที่คำนวณได้เกินขนาดที่ระบบรองรับ' };
  return { width: dimensions[0], length: dimensions[1], height: dimensions[2], value: volume, hasDimensions: true };
}

async function getLocationUsage(pool, locationId) {
  const result = await pool.request().input('LocationId', sql.Int, locationId).query(`
    SELECT COALESCE(SUM(CASE WHEN p.UnitVolumeCm3 IS NOT NULL THEN s.Quantity * p.UnitVolumeCm3 ELSE 0 END), 0) AS UsedVolumeCm3,
      COALESCE(SUM(CASE WHEN s.Quantity > 0 AND p.UnitVolumeCm3 IS NULL THEN 1 ELSE 0 END), 0) AS UnmeasuredProducts
    FROM dbo.Stock s JOIN dbo.Products p ON p.ProductId = s.ProductId
    WHERE s.LocationId = @LocationId AND s.Quantity > 0
  `);
  let reservedVolumeCm3 = 0;
  let unmeasuredReservations = 0;
  const tableStatus = await pool.request().query(`SELECT OBJECT_ID('dbo.PutawayTasks', 'U') AS TasksId, OBJECT_ID('dbo.PutawayTaskLines', 'U') AS LinesId`);
  if (tableStatus.recordset[0].TasksId && tableStatus.recordset[0].LinesId) {
    const reservations = await pool.request().input('LocationId', sql.Int, locationId).query(`
      SELECT COALESCE(SUM(CASE WHEN l.UnitVolumeCm3 IS NOT NULL THEN (l.PlannedQuantity - l.MovedQuantity) * l.UnitVolumeCm3 ELSE 0 END), 0) AS ReservedVolumeCm3,
        COALESCE(SUM(CASE WHEN l.UnitVolumeCm3 IS NULL AND l.MovedQuantity < l.PlannedQuantity THEN 1 ELSE 0 END), 0) AS UnmeasuredReservations
      FROM dbo.PutawayTaskLines l JOIN dbo.PutawayTasks t ON t.TaskId = l.TaskId
      WHERE l.ToLocationId = @LocationId AND t.Status IN ('OPEN','IN_PROGRESS')
    `);
    reservedVolumeCm3 = Number(reservations.recordset[0].ReservedVolumeCm3);
    unmeasuredReservations = Number(reservations.recordset[0].UnmeasuredReservations);
  }
  return { ...result.recordset[0], ReservedVolumeCm3: reservedVolumeCm3, UnmeasuredReservations: unmeasuredReservations };
}

// GET /api/locations (ดึงรายการโลเคชั่นทั้งหมด)
router.get('/', authenticate, requireAdminOrPowerUser, async (req, res) => {
  try {
    const pool = await poolPromise;
    await ensureCapacitySchema();
    const result = await pool.request().query(`
      SELECT l.LocationId, l.LocationCode, l.Zone, l.Description, l.IsActive, l.CapacityVolumeCm3,
        l.CapacityWidthCm, l.CapacityLengthCm, l.CapacityHeightCm,
        COALESCE(SUM(CASE WHEN p.UnitVolumeCm3 IS NOT NULL THEN s.Quantity * p.UnitVolumeCm3 ELSE 0 END), 0) AS UsedVolumeCm3,
        COALESCE(SUM(CASE WHEN s.Quantity > 0 AND p.UnitVolumeCm3 IS NULL THEN 1 ELSE 0 END), 0) AS UnmeasuredProducts
      FROM dbo.Locations l
      LEFT JOIN dbo.Stock s ON s.LocationId = l.LocationId AND s.Quantity > 0
      LEFT JOIN dbo.Products p ON p.ProductId = s.ProductId
      GROUP BY l.LocationId, l.LocationCode, l.Zone, l.Description, l.IsActive, l.CapacityVolumeCm3,
        l.CapacityWidthCm, l.CapacityLengthCm, l.CapacityHeightCm
      ORDER BY l.LocationId ASC
    `);
    const tableStatus = await pool.request().query(`SELECT OBJECT_ID('dbo.PutawayTasks', 'U') AS TasksId, OBJECT_ID('dbo.PutawayTaskLines', 'U') AS LinesId`);
    let reserved = [];
    if (tableStatus.recordset[0].TasksId && tableStatus.recordset[0].LinesId) {
      const reservationResult = await pool.request().query(`
        SELECT l.ToLocationId AS LocationId,
          COALESCE(SUM(CASE WHEN l.UnitVolumeCm3 IS NOT NULL THEN (l.PlannedQuantity - l.MovedQuantity) * l.UnitVolumeCm3 ELSE 0 END), 0) AS ReservedVolumeCm3,
          COALESCE(SUM(CASE WHEN l.UnitVolumeCm3 IS NULL AND l.MovedQuantity < l.PlannedQuantity THEN 1 ELSE 0 END), 0) AS UnmeasuredReservations
        FROM dbo.PutawayTaskLines l JOIN dbo.PutawayTasks t ON t.TaskId = l.TaskId
        WHERE t.Status IN ('OPEN','IN_PROGRESS') GROUP BY l.ToLocationId
      `);
      reserved = reservationResult.recordset;
    }
    const reservationsByLocation = new Map(reserved.map(row => [Number(row.LocationId), row]));
    res.json({ success: true, data: result.recordset.map(location => {
      const reservation = reservationsByLocation.get(Number(location.LocationId));
      return { ...location, ReservedVolumeCm3: Number(reservation?.ReservedVolumeCm3 || 0), UnmeasuredReservations: Number(reservation?.UnmeasuredReservations || 0) };
    }) });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST /api/locations (เพิ่มโลเคชั่นใหม่)
router.post('/', authenticate, requireAdminOrPowerUser, async (req, res) => {
  const code = String(req.body.locationCode || req.body.code || '').trim().toUpperCase();
  const classification = locationClass(code);
  const zone = classification.zone || req.body.zone;
  const desc = req.body.description || req.body.desc;
  const { isActive } = req.body;
  if (!code) return res.status(400).json({ success: false, message: 'กรุณากรอกรหัสโลเคชั่น' });
  const capacity = readCapacity(req.body.capacityWidthCm, req.body.capacityLengthCm, req.body.capacityHeightCm, classification.hasCapacity);
  if (capacity.error) return res.status(400).json({ success: false, message: capacity.error });
  if (classification.hasCapacity && !capacity.hasDimensions) return res.status(400).json({ success: false, message: 'ระบุขนาดกว้าง × ยาว × สูงของช่องจัดเก็บ A/B ให้ครบ' });

  const activeVal = (isActive !== undefined) ? (isActive ? 1 : 0) : 1;

  try {
    const pool = await poolPromise;
    await ensureCapacitySchema();
    const check = await pool.request()
      .input('LocationCode', sql.VarChar, code.trim().toUpperCase())
      .query('SELECT 1 FROM Locations WHERE LocationCode = @LocationCode');

    if (check.recordset.length > 0) {
      return res.status(400).json({ success: false, message: 'รหัสโลเคชั่นนี้มีอยู่ในระบบแล้ว' });
    }

    await pool.request()
      .input('LocationCode', sql.VarChar, code.trim().toUpperCase())
      .input('Zone', sql.VarChar, zone ? zone.trim().toUpperCase() : '')
      .input('Description', sql.NVarChar, desc ? desc.trim() : (classification.defaultDescription || ''))
      .input('CapacityWidthCm', sql.Decimal(18, 3), capacity.width)
      .input('CapacityLengthCm', sql.Decimal(18, 3), capacity.length)
      .input('CapacityHeightCm', sql.Decimal(18, 3), capacity.height)
      .input('CapacityVolumeCm3', sql.Decimal(18, 3), capacity.value)
      .input('IsActive', sql.Bit, activeVal)
      .query(`
        INSERT INTO Locations (LocationCode, Zone, Description, IsActive, CapacityWidthCm, CapacityLengthCm, CapacityHeightCm, CapacityVolumeCm3)
        VALUES (@LocationCode, @Zone, @Description, @IsActive, @CapacityWidthCm, @CapacityLengthCm, @CapacityHeightCm, @CapacityVolumeCm3)
      `);

    res.json({ success: true, message: 'เพิ่มโลเคชั่นเรียบร้อย' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// PUT /api/locations/:id (แก้ไขโลเคชั่น)
router.put('/:id', authenticate, requireAdminOrPowerUser, async (req, res) => {
  const locId = parseInt(req.params.id);
  const { isActive } = req.body;
  const desc = req.body.description || req.body.desc;
  const activeVal = (isActive !== undefined) ? (isActive ? 1 : 0) : 1;

  if (isNaN(locId)) return res.status(400).json({ success: false, message: 'รหัสโลเคชั่นไม่ถูกต้อง' });

  try {
    const pool = await poolPromise;
    await ensureCapacitySchema();
    const existing = await pool.request().input('LocationId', sql.Int, locId)
      .query('SELECT LocationCode FROM dbo.Locations WHERE LocationId = @LocationId');
    if (!existing.recordset.length) return res.status(404).json({ success: false, message: 'ไม่พบโลเคชั่นนี้' });
    const classification = locationClass(existing.recordset[0].LocationCode);
    const capacity = readCapacity(req.body.capacityWidthCm, req.body.capacityLengthCm, req.body.capacityHeightCm, classification.hasCapacity);
    if (capacity.error) return res.status(400).json({ success: false, message: capacity.error });
    if (capacity.value != null) {
      const usage = await getLocationUsage(pool, locId);
      if (Number(usage.UnmeasuredProducts) > 0) return res.status(409).json({ success: false, message: `ยังตั้งความจุไม่ได้ เพราะมีสินค้า ${usage.UnmeasuredProducts} รายการที่ยังไม่ระบุปริมาตร` });
      if (Number(usage.UnmeasuredReservations) > 0) return res.status(409).json({ success: false, message: `ยังปรับความจุไม่ได้ เพราะมีใบงาน PUTAWAY ${usage.UnmeasuredReservations} รายการที่ไม่ทราบปริมาตร` });
      const occupied = Number(usage.UsedVolumeCm3) + Number(usage.ReservedVolumeCm3);
      if (capacity.value < occupied) return res.status(409).json({ success: false, message: `ความจุใหม่ต่ำกว่าปริมาตรที่ใช้และจองอยู่ (${occupied.toLocaleString('th-TH')} cm³)` });
    }
    await pool.request()
      .input('LocationId', sql.Int, locId)
      .input('Zone', sql.VarChar, classification.zone || req.body.zone || '')
      .input('Description', sql.NVarChar, desc ? desc.trim() : (classification.defaultDescription || ''))
      .input('CapacityWidthCm', sql.Decimal(18, 3), capacity.width)
      .input('CapacityLengthCm', sql.Decimal(18, 3), capacity.length)
      .input('CapacityHeightCm', sql.Decimal(18, 3), capacity.height)
      .input('CapacityVolumeCm3', sql.Decimal(18, 3), capacity.value)
      .input('HasStorageCapacity', sql.Bit, classification.hasCapacity ? 1 : 0)
      .input('HasDimensions', sql.Bit, capacity.hasDimensions ? 1 : 0)
      .input('IsActive', sql.Bit, activeVal)
      .query(`
        UPDATE Locations 
        SET Zone = @Zone, Description = @Description, IsActive = @IsActive,
          CapacityWidthCm = CASE WHEN @HasStorageCapacity = 1 AND @HasDimensions = 0 THEN CapacityWidthCm ELSE @CapacityWidthCm END,
          CapacityLengthCm = CASE WHEN @HasStorageCapacity = 1 AND @HasDimensions = 0 THEN CapacityLengthCm ELSE @CapacityLengthCm END,
          CapacityHeightCm = CASE WHEN @HasStorageCapacity = 1 AND @HasDimensions = 0 THEN CapacityHeightCm ELSE @CapacityHeightCm END,
          CapacityVolumeCm3 = CASE WHEN @HasStorageCapacity = 1 AND @HasDimensions = 0 THEN CapacityVolumeCm3 ELSE @CapacityVolumeCm3 END
        WHERE LocationId = @LocationId
      `);

    res.json({ success: true, message: 'อัปเดตโลเคชั่นเรียบร้อย' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// DELETE /api/locations/:id (ลบโลเคชั่น)
router.delete('/:id', authenticate, requireAdmin, async (req, res) => {
  const locId = parseInt(req.params.id);
  if (isNaN(locId)) return res.status(400).json({ success: false, message: 'รหัสโลเคชั่นไม่ถูกต้อง' });

  try {
    const pool = await poolPromise;
    await pool.request()
      .input('LocationId', sql.Int, locId)
      .query('DELETE FROM Locations WHERE LocationId = @LocationId');

    res.json({ success: true, message: 'ลบโลเคชั่นเรียบร้อย' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
