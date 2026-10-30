const express = require('express');
const router = express.Router();
const { poolPromise, sql } = require('../config/db');

// GET /api/stock/lookup?code=... (สำหรับ Handheld ตรวจสอบสต๊อกทันทีที่สแกน)
router.get('/lookup', async (req, res) => {
  const { code } = req.query;
  if (!code) return res.status(400).json({ message: 'กรุณาระบุรหัสสินค้าหรือบาร์โค้ด' });

  try {
    const pool = await poolPromise;
    const result = await pool.request()
      .input('Code', sql.NVarChar, code)
      .query(`
        SELECT p.ProductId, p.ItemCode, p.ItemName, p.Barcode, p.UOM,
               ISNULL(l.LocationCode, 'N/A') AS LocationCode,
               ISNULL(s.Quantity, 0) AS Quantity,
               s.LastUpdated
        FROM Products p
        LEFT JOIN Stock s ON p.ProductId = s.ProductId AND s.Quantity > 0
        LEFT JOIN Locations l ON s.LocationId = l.LocationId
        WHERE p.Barcode = @Code OR p.ItemCode = @Code
      `);

    if (result.recordset.length === 0) {
      return res.status(404).json({ success: false, message: 'ไม่พบสินค้าในระบบ' });
    }

    const first = result.recordset[0];
    const totalQty = result.recordset.reduce((sum, row) => sum + row.Quantity, 0);

    res.json({
      success: true,
      product: {
        itemCode: first.ItemCode,
        itemName: first.ItemName,
        barcode: first.Barcode,
        uom: first.UOM,
        totalQuantity: totalQty,
        locations: result.recordset.filter(r => r.Quantity > 0).map(r => ({
          locationCode: r.LocationCode,
          quantity: r.Quantity,
          lastUpdated: r.LastUpdated
        }))
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET /api/stock/balance (ภาพรวมสต๊อกทั้งหมดในหน้า Admin)
router.get('/balance', async (req, res) => {
  try {
    const pool = await poolPromise;
    const result = await pool.request().query(`
      SELECT 
        p.ProductId, p.ItemCode, p.Barcode, p.ItemName, p.Category, p.UOM, p.MinStock,
        ISNULL(SUM(s.Quantity), 0) AS TotalStock,
        STRING_AGG(CONCAT(l.LocationCode, ' (', s.Quantity, ')'), ', ') AS LocationDetails,
        MAX(s.LastUpdated) AS LastUpdated
      FROM Products p
      LEFT JOIN Stock s ON p.ProductId = s.ProductId AND s.Quantity > 0
      LEFT JOIN Locations l ON s.LocationId = l.LocationId
      GROUP BY p.ProductId, p.ItemCode, p.Barcode, p.ItemName, p.Category, p.UOM, p.MinStock
      ORDER BY p.ItemCode
    `);
    res.json({ success: true, data: result.recordset });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;