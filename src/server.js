const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

// เสิร์ฟหน้าเว็บโฟลเดอร์ public
app.use(express.static(path.join(__dirname, '../public')));

// Routing API
app.use('/api/auth', require('./routes/auth'));
app.use('/api/products', require('./routes/products'));
app.use('/api/locations', require('./routes/locations'));
app.use('/api/receiving', require('./routes/receiving'));
app.use('/api/cycle-counts', require('./routes/cycle-counts'));
app.use('/api/stock', require('./routes/stock'));
app.use('/api/transactions', require('./routes/transactions'));
app.use('/api/users', require('./routes/users'));
app.use('/api/permissions', require('./routes/permissions')); //
app.use('/api/locations', require('./routes/locations'));
app.use('/api/roles', require('./routes/roles'));


const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`====================================================`);
  console.log(`🚀 Warehouse Stock Server is running!`);
  console.log(`💻 Admin Web URL:     http://localhost:${PORT}/admin.html`);
  console.log(`⚡ Power User URL:    http://localhost:${PORT}/poweruser.html`);
  console.log(`📱 Handheld Web URL:  http://localhost:${PORT}/handheld.html`);
  console.log(`🔑 Login Page URL:    http://localhost:${PORT}/index.html`);
  console.log(`====================================================`);
});
