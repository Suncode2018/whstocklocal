// src/routes/products.js
const express = require('express');
const router = express.Router();
const { poolPromise, sql } = require('../config/db');

router.get('/', async (req, res) => {
  const pool = await poolPromise;
  const result = await pool.request().query('SELECT * FROM Products ORDER BY ItemCode');
  res.json({ success: true, data: result.recordset });
});

router.post('/', async (req, res) => {
  const { itemCode, barcode, itemName, category, uom, minStock } = req.body;
  const pool = await poolPromise;
  await pool.request()
    .input('ItemCode', sql.NVarChar, itemCode)
    .input('Barcode', sql.NVarChar, barcode)
    .input('ItemName', sql.NVarChar, itemName)
    .input('Category', sql.NVarChar, category)
    .input('UOM', sql.NVarChar, uom || 'PCS')
    .input('MinStock', sql.Int, minStock || 0)
    .query(`INSERT INTO Products (ItemCode, Barcode, ItemName, Category, UOM, MinStock)
            VALUES (@ItemCode, @Barcode, @ItemName, @Category, @UOM, @MinStock)`);
  res.json({ success: true, message: 'เพิ่มสินค้าสำเร็จ' });
});

module.exports = router;