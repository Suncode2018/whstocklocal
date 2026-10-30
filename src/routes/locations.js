// src/routes/locations.js
const express = require('express');
const router = express.Router();
const { poolPromise, sql } = require('../config/db');

router.get('/', async (req, res) => {
  const pool = await poolPromise;
  const result = await pool.request().query('SELECT * FROM Locations WHERE IsActive = 1 ORDER BY LocationCode');
  res.json({ success: true, data: result.recordset });
});

module.exports = router;