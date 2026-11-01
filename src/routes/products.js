const express = require('express');
const router = express.Router();
const { poolPromise, sql } = require('../config/db');

let schemaPromise;
async function ensureProductVolumeSchema() {
  if (schemaPromise) return schemaPromise;
  schemaPromise = (async () => {
    const pool = await poolPromise;
    await pool.request().query(`
      IF COL_LENGTH('dbo.Products', 'UnitVolumeCm3') IS NULL ALTER TABLE dbo.Products ADD UnitVolumeCm3 DECIMAL(18,3) NULL;
      IF COL_LENGTH('dbo.Products', 'UnitWidthCm') IS NULL ALTER TABLE dbo.Products ADD UnitWidthCm DECIMAL(18,3) NULL;
      IF COL_LENGTH('dbo.Products', 'UnitLengthCm') IS NULL ALTER TABLE dbo.Products ADD UnitLengthCm DECIMAL(18,3) NULL;
      IF COL_LENGTH('dbo.Products', 'UnitHeightCm') IS NULL ALTER TABLE dbo.Products ADD UnitHeightCm DECIMAL(18,3) NULL;
    `);
    await pool.request().query(`
      IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE parent_object_id = OBJECT_ID('dbo.Products') AND name = 'CK_Products_UnitDimensions')
        ALTER TABLE dbo.Products ADD CONSTRAINT CK_Products_UnitDimensions CHECK (
          (UnitWidthCm IS NULL AND UnitLengthCm IS NULL AND UnitHeightCm IS NULL)
          OR (UnitWidthCm IS NOT NULL AND UnitLengthCm IS NOT NULL AND UnitHeightCm IS NOT NULL
            AND UnitWidthCm > 0 AND UnitLengthCm > 0 AND UnitHeightCm > 0)
        );
    `);
  })();
  try { await schemaPromise; } catch (error) { schemaPromise = null; throw error; }
}

function readProduct(body = {}) {
  const dimensions = ['unitWidthCm', 'unitLengthCm', 'unitHeightCm'].map(key => body[key] === '' || body[key] == null ? null : Number(body[key]));
  const hasAnyDimension = dimensions.some(value => value !== null);
  const hasAllDimensions = dimensions.every(value => value !== null);
  if (hasAnyDimension && !hasAllDimensions) return { error: 'กรอกกว้าง ยาว และสูงให้ครบทั้ง 3 ค่า หรือเว้นว่างทั้งหมด' };
  if (hasAllDimensions && dimensions.some(value => !Number.isFinite(value) || value <= 0 || value > 999999999999999.999)) return { error: 'กว้าง ยาว และสูงต้องเป็นตัวเลขมากกว่า 0 (cm)' };
  const unitVolumeCm3 = hasAllDimensions ? dimensions.reduce((volume, dimension) => volume * dimension, 1) : null;
  if (unitVolumeCm3 !== null && (!Number.isFinite(unitVolumeCm3) || unitVolumeCm3 > 999999999999999.999)) return { error: 'ปริมาตรที่คำนวณได้เกินขนาดที่ระบบรองรับ' };
  const itemCode = String(body.itemCode || '').trim();
  const barcode = String(body.barcode || '').trim();
  const itemName = String(body.itemName || '').trim();
  const uom = String(body.uom || 'PCS').trim();
  if (!itemCode || itemCode.length > 50 || !itemName || itemName.length > 200 || !barcode || barcode.length > 50 || !uom || uom.length > 20) return { error: 'กรอกรหัสสินค้า บาร์โค้ด ชื่อสินค้า และหน่วยให้ครบถ้วน' };
  return { itemCode, barcode, itemName, uom, unitWidthCm: dimensions[0], unitLengthCm: dimensions[1], unitHeightCm: dimensions[2], unitVolumeCm3 };
}

router.use(async (_req, res, next) => {
  try { await ensureProductVolumeSchema(); next(); }
  catch (error) { res.status(500).json({ success: false, message: `เตรียมคอลัมน์ปริมาตรสินค้าไม่สำเร็จ: ${error.message}` }); }
});

router.get('/', async (_req, res) => {
  try {
    const pool = await poolPromise;
    const result = await pool.request().query('SELECT * FROM dbo.Products ORDER BY ItemCode');
    res.json({ success: true, data: result.recordset });
  } catch (error) { res.status(500).json({ success: false, message: error.message }); }
});

router.post('/', async (req, res) => {
  const product = readProduct(req.body);
  if (product.error) return res.status(400).json({ success: false, error: product.error });
  try {
    const pool = await poolPromise;
    await pool.request().input('ItemCode', sql.NVarChar(50), product.itemCode).input('Barcode', sql.NVarChar(50), product.barcode)
      .input('ItemName', sql.NVarChar(200), product.itemName).input('UOM', sql.NVarChar(20), product.uom)
      .input('UnitWidthCm', sql.Decimal(18, 3), product.unitWidthCm).input('UnitLengthCm', sql.Decimal(18, 3), product.unitLengthCm)
      .input('UnitHeightCm', sql.Decimal(18, 3), product.unitHeightCm)
      .input('UnitVolumeCm3', sql.Decimal(18, 3), product.unitVolumeCm3)
      .query(`INSERT INTO dbo.Products (ItemCode, Barcode, ItemName, UOM, UnitWidthCm, UnitLengthCm, UnitHeightCm, UnitVolumeCm3)
        VALUES (@ItemCode, @Barcode, @ItemName, @UOM, @UnitWidthCm, @UnitLengthCm, @UnitHeightCm, @UnitVolumeCm3)`);
    res.status(201).json({ success: true, message: 'เพิ่มสินค้าสำเร็จ' });
  } catch (error) {
    const duplicate = error.number === 2627 || error.number === 2601;
    res.status(duplicate ? 409 : 500).json({ success: false, error: duplicate ? 'รหัสสินค้าหรือบาร์โค้ดนี้มีอยู่แล้ว' : error.message });
  }
});

router.put('/:id', async (req, res) => {
  const productId = Number.parseInt(req.params.id, 10);
  const product = readProduct(req.body);
  if (!Number.isInteger(productId) || productId <= 0) return res.status(400).json({ success: false, error: 'รหัสสินค้าไม่ถูกต้อง' });
  if (product.error) return res.status(400).json({ success: false, error: product.error });
  try {
    const pool = await poolPromise;
    const result = await pool.request().input('ProductId', sql.Int, productId).input('ItemCode', sql.NVarChar(50), product.itemCode)
      .input('Barcode', sql.NVarChar(50), product.barcode).input('ItemName', sql.NVarChar(200), product.itemName)
      .input('UnitWidthCm', sql.Decimal(18, 3), product.unitWidthCm).input('UnitLengthCm', sql.Decimal(18, 3), product.unitLengthCm)
      .input('UnitHeightCm', sql.Decimal(18, 3), product.unitHeightCm)
      .input('UOM', sql.NVarChar(20), product.uom).input('UnitVolumeCm3', sql.Decimal(18, 3), product.unitVolumeCm3)
      .query(`UPDATE dbo.Products SET ItemCode=@ItemCode, Barcode=@Barcode, ItemName=@ItemName, UOM=@UOM,
        UnitWidthCm=@UnitWidthCm, UnitLengthCm=@UnitLengthCm, UnitHeightCm=@UnitHeightCm,
        UnitVolumeCm3=CASE WHEN @UnitWidthCm IS NULL AND @UnitLengthCm IS NULL AND @UnitHeightCm IS NULL AND UnitVolumeCm3 IS NOT NULL
          THEN UnitVolumeCm3 ELSE @UnitVolumeCm3 END
        WHERE ProductId=@ProductId; SELECT @@ROWCOUNT AS Changed;`);
    if (!result.recordset[0].Changed) return res.status(404).json({ success: false, error: 'ไม่พบสินค้า' });
    res.json({ success: true, message: 'แก้ไขข้อมูลสินค้าสำเร็จ' });
  } catch (error) {
    const duplicate = error.number === 2627 || error.number === 2601;
    res.status(duplicate ? 409 : 500).json({ success: false, error: duplicate ? 'รหัสสินค้าหรือบาร์โค้ดนี้มีอยู่แล้ว' : error.message });
  }
});

router.delete('/:id', async (req, res) => {
  const productId = Number.parseInt(req.params.id, 10);
  if (!Number.isInteger(productId) || productId <= 0) return res.status(400).json({ success: false, error: 'รหัสสินค้าไม่ถูกต้อง' });
  try {
    const pool = await poolPromise;
    const result = await pool.request().input('ProductId', sql.Int, productId).query('DELETE FROM dbo.Products WHERE ProductId=@ProductId; SELECT @@ROWCOUNT AS Changed;');
    if (!result.recordset[0].Changed) return res.status(404).json({ success: false, error: 'ไม่พบสินค้า' });
    res.json({ success: true, message: 'ลบสินค้าสำเร็จ' });
  } catch (error) {
    if (error.number === 547) return res.status(409).json({ success: false, error: 'สินค้านี้มีประวัติการรับหรือเคลื่อนไหวแล้ว จึงลบไม่ได้' });
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;
