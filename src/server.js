const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

// 1. Static Middleware สำหรับโฟลเดอร์หลัก public และโฟลเดอร์ย่อยแต่ละกลุ่ม
app.use(express.static(path.join(__dirname, '../public')));
app.use('/desktop', express.static(path.join(__dirname, '../public/desktop')));
app.use('/handheld', express.static(path.join(__dirname, '../public/handheld')));
app.use('/supervisor', express.static(path.join(__dirname, '../public/supervisor'))); // <-- เพิ่มบรรทัดนี้

// 2. Routing API
app.use('/api/auth', require('./routes/auth'));
app.use('/api/roles', require('./routes/roles'));
app.use('/api/users', require('./routes/users'));
app.use('/api/permissions', require('./routes/permissions'));
app.use('/api/master', require('./routes/masterdata'));
app.use('/api/products', require('./routes/products'));
app.use('/api/warehouses', require('./routes/warehouses'));
app.use('/api/stock', require('./routes/stock'));

// 3. เส้นทางลัด (Shortcuts & Redirects)
// ไปหน้า Handheld
app.get('/hh', (req, res) => {
  res.redirect('/handheld/index.html');
});

// ไปหน้า Desktop Dashboard
app.get('/app', (req, res) => {
  res.redirect('/desktop/index.html');
});

// ไปหน้าจัดการระบบ Admin (Multi-page Products Master)
app.get('/admin', (req, res) => {
  res.redirect('/admin/products.html');
});

// ไปหน้าจัดการระบบ Power User
app.get('/poweruser', (req, res) => {
  res.redirect('/poweruser/products.html');
});

// ให้บริการไฟล์หน้าเว็บสำหรับ Supervisor
app.get('/supervisor', (req, res) => {
  res.redirect('/supervisor/products.html');
});

const PORT = process.env.PORT || 3000;
const HOST = process.env.APP_HOST || 'localhost';

app.listen(PORT, '0.0.0.0', () => {
  console.log(`====================================================`);
  console.log(`🚀 Warehouse Stock Server is running!`);
  console.log(`💻 Desktop Web URL:     http://${HOST}:${PORT}/desktop/index.html`);
  console.log(`🛠️ Admin Portal:        http://${HOST}:${PORT}/admin/products.html`);
  console.log(`⚡ Power User Portal:   http://${HOST}:${PORT}/poweruser/products.html`);
  console.log(`📋 Supervisor Portal:   http://${HOST}:${PORT}/supervisor/products.html`); // <-- เพิ่มแสดงใน Log
  console.log(`📱 Handheld Mobile URL: http://${HOST}:${PORT}/handheld/index.html (หรือ /hh)`);
  console.log(`🔑 Login Page URL:      http://${HOST}:${PORT}/index.html`);
  console.log(`====================================================`);
});