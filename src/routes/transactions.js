const express = require('express');
const router = express.Router();
const { poolPromise, sql } = require('../config/db');
const jwt = require('jsonwebtoken');

// Middleware ตรวจสอบอายุ Token (เกิน 9 ชั่วโมง ปฏิเสธทันที)
const JWT_SECRET = process.env.JWT_SECRET || 'super_secret_local_warehouse_jwt_key_2026';

function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) return res.status(401).json({ success: false, isExpired: true, message: 'กรุณาเข้าสู่ระบบ' });

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({ 
        success: false, 
        isExpired: true, 
        message: 'เซสชันการใช้งานของคุณหมดอายุแล้ว (เกิน 9 ชั่วโมง) กรุณาเข้าสู่ระบบใหม่' 
      });
    }
    req.user = user;
    next();
  });
}

// POST /api/transactions/execute (รับเข้า, เบิกจ่าย, โอนย้าย)
router.post('/execute', authenticateToken, async (req, res) => {
  const { type, barcode, locationCode, targetLocationCode, quantity, referenceNo } = req.body;
  const qty = parseInt(quantity);

  if (!type || !barcode || !locationCode || isNaN(qty) || qty <= 0) {
    return res.status(400).json({ success: false, message: 'ข้อมูลไม่ครบถ้วนหรือไม่ถูกต้อง' });
  }

  const pool = await poolPromise;
  const transaction = new sql.Transaction(pool);

  try {
    await transaction.begin();

    // 1. ตรวจสอบสินค้า
    const reqProd = new sql.Request(transaction);
    const prodRes = await reqProd
      .input('Barcode', sql.NVarChar, barcode)
      .query('SELECT ProductId, ItemCode, ItemName FROM Products WHERE Barcode = @Barcode');
    if (prodRes.recordset.length === 0) {
      throw new Error(`ไม่พบสินค้าที่มีบาร์โค้ด: ${barcode}`);
    }
    const product = prodRes.recordset[0];

    // 2. ตรวจสอบ Location
    const reqLoc = new sql.Request(transaction);
    const locRes = await reqLoc
      .input('LocationCode', sql.NVarChar, locationCode)
      .query('SELECT LocationId, LocationCode FROM Locations WHERE LocationCode = @LocationCode');
    if (locRes.recordset.length === 0) {
      throw new Error(`ไม่พบตำแหน่งจัดเก็บ: ${locationCode}`);
    }
    const location = locRes.recordset[0];

    let targetLocation = null;
    if (type === 'TRANSFER') {
      if (!targetLocationCode) throw new Error('กรุณาระบุตำแหน่งปลายทาง');
      const reqTLoc = new sql.Request(transaction);
      const targetLocRes = await reqTLoc
        .input('TargetLocationCode', sql.NVarChar, targetLocationCode)
        .query('SELECT LocationId, LocationCode FROM Locations WHERE LocationCode = @TargetLocationCode');
      if (targetLocRes.recordset.length === 0) {
        throw new Error(`ไม่พบตำแหน่งปลายทาง: ${targetLocationCode}`);
      }
      targetLocation = targetLocRes.recordset[0];
    }

    // 3. หักสต๊อกต้นทาง (PICK / TRANSFER)
    if (type === 'PICK' || type === 'TRANSFER') {
      const reqCheck = new sql.Request(transaction);
      const stockCheck = await reqCheck
        .input('ProdId', sql.Int, product.ProductId)
        .input('LocId', sql.Int, location.LocationId)
        .query('SELECT Quantity FROM Stock WHERE ProductId = @ProdId AND LocationId = @LocId');

      const currentQty = stockCheck.recordset.length > 0 ? stockCheck.recordset[0].Quantity : 0;
      if (currentQty < qty) {
        throw new Error(`สต๊อกไม่พอจ่าย! ที่ ${location.LocationCode} มีเพียง ${currentQty} ชิ้น (ต้องการ ${qty})`);
      }

      const reqMinus = new sql.Request(transaction);
      await reqMinus
        .input('ProdId', sql.Int, product.ProductId)
        .input('LocId', sql.Int, location.LocationId)
        .input('QtyMinus', sql.Int, qty)
        .query('UPDATE Stock SET Quantity = Quantity - @QtyMinus, LastUpdated = GETDATE() WHERE ProductId = @ProdId AND LocationId = @LocId');
    }

    // 4. เพิ่มสต๊อกปลายทาง (RECEIVE / TRANSFER)
    if (type === 'RECEIVE' || type === 'TRANSFER') {
      const destLocId = type === 'RECEIVE' ? location.LocationId : targetLocation.LocationId;
      const reqAdd = new sql.Request(transaction);
      await reqAdd
        .input('ProdId', sql.Int, product.ProductId)
        .input('DestLocId', sql.Int, destLocId)
        .input('QtyAdd', sql.Int, qty)
        .query(`
          MERGE Stock AS target
          USING (SELECT @ProdId AS ProductId, @DestLocId AS LocationId) AS source
          ON (target.ProductId = source.ProductId AND target.LocationId = source.LocationId)
          WHEN MATCHED THEN
              UPDATE SET target.Quantity = target.Quantity + @QtyAdd, target.LastUpdated = GETDATE()
          WHEN NOT MATCHED THEN
              INSERT (ProductId, LocationId, Quantity, LastUpdated)
              VALUES (source.ProductId, source.LocationId, @QtyAdd, GETDATE());
        `);
    }

    // 5. บันทึก Transaction Log
    const reqLog = new sql.Request(transaction);
    await reqLog
      .input('TxType', sql.NVarChar, type)
      .input('ProdId', sql.Int, product.ProductId)
      .input('FromLocId', sql.Int, type === 'RECEIVE' ? null : location.LocationId)
      .input('ToLocId', sql.Int, type === 'PICK' ? null : (type === 'TRANSFER' ? targetLocation.LocationId : location.LocationId))
      .input('Qty', sql.Int, qty)
      .input('RefNo', sql.NVarChar, referenceNo || '')
      .input('UserId', sql.Int, req.user.userId)
      .query(`
        INSERT INTO StockTransactions (TransactionType, ProductId, FromLocationId, ToLocationId, Quantity, ReferenceNo, UserId)
        VALUES (@TxType, @ProdId, @FromLocId, @ToLocId, @Qty, @RefNo, @UserId)
      `);

    await transaction.commit();
    res.json({
      success: true,
      message: `บันทึกรายการสำเร็จ! [${product.ItemCode}] จำนวน ${qty} ที่ ${location.LocationCode}`,
      item: product
    });

  } catch (err) {
    await transaction.rollback();
    res.status(400).json({ success: false, message: err.message });
  }
});

// GET /api/transactions/recent
router.get('/recent', authenticateToken, async (req, res) => {
  try {
    const pool = await poolPromise;
    const result = await pool.request().query(`
      SELECT TOP 50 
        t.TransactionId, t.TransactionType, t.Quantity, t.ReferenceNo, t.CreatedAt,
        p.ItemCode, p.ItemName, p.Barcode,
        locFrom.LocationCode AS FromLocation,
        locTo.LocationCode AS ToLocation,
        u.FullName AS OperatorName
      FROM StockTransactions t
      JOIN Products p ON t.ProductId = p.ProductId
      LEFT JOIN Locations locFrom ON t.FromLocationId = locFrom.LocationId
      LEFT JOIN Locations locTo ON t.ToLocationId = locTo.LocationId
      JOIN Users u ON t.UserId = u.UserId
      ORDER BY t.CreatedAt DESC
    `);
    res.json({ success: true, data: result.recordset });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});



module.exports = router;