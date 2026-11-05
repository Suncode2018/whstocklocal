const express = require('express');
const router = express.Router();
const { poolPromise, sql } = require('../config/db');

// 1. GET ALL
router.get('/', async (req, res) => {
  try {
    const pool = await poolPromise;
    const result = await pool.request().query('SELECT whid, whname, whdescription FROM [dbo].[tblWH] ORDER BY whid ASC');
    res.json(result.recordset);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 2. GET BY ID
router.get('/:id', async (req, res) => {
  try {
    const pool = await poolPromise;
    const result = await pool.request()
      .input('whid', sql.Int, req.params.id)
      .query('SELECT whid, whname, whdescription FROM [dbo].[tblWH] WHERE whid = @whid');
    if (!result.recordset.length) return res.status(404).json({ error: 'ไม่พบคลังสินค้า' });
    res.json(result.recordset[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 3. POST (CREATE)
router.post('/', async (req, res) => {
  try {
    const { whname, whdescription } = req.body;
    if (!whname) return res.status(400).json({ error: 'กรุณาระบุชื่อคลังสินค้า (whname)' });
    
    const pool = await poolPromise;
    await pool.request()
      .input('whname', sql.NVarChar(10), whname.trim())
      .input('whdescription', sql.NVarChar(50), (whdescription || '').trim())
      .query('INSERT INTO [dbo].[tblWH] (whname, whdescription) VALUES (@whname, @whdescription)');

    res.json({ success: true, message: 'เพิ่มคลังสินค้าเรียบร้อย' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 4. PUT (UPDATE)
router.put('/:id', async (req, res) => {
  try {
    const { whname, whdescription } = req.body;
    if (!whname) return res.status(400).json({ error: 'กรุณาระบุชื่อคลังสินค้า (whname)' });

    const pool = await poolPromise;
    await pool.request()
      .input('whid', sql.Int, req.params.id)
      .input('whname', sql.NVarChar(10), whname.trim())
      .input('whdescription', sql.NVarChar(50), (whdescription || '').trim())
      .query('UPDATE [dbo].[tblWH] SET whname = @whname, whdescription = @whdescription WHERE whid = @whid');

    res.json({ success: true, message: 'แก้ไขคลังสินค้าเรียบร้อย' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 5. DELETE
router.delete('/:id', async (req, res) => {
  try {
    const pool = await poolPromise;
    await pool.request()
      .input('whid', sql.Int, req.params.id)
      .query('DELETE FROM [dbo].[tblWH] WHERE whid = @whid');

    res.json({ success: true, message: 'ลบคลังสินค้าเรียบร้อย' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;