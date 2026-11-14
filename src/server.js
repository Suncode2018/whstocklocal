const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const app = express();
const access = require('./middleware/access');
app.use((req,res,next)=>{res.set('Cache-Control','no-store');next();});
app.use(cors());
app.use(express.json());

// Retired UI trees are not served. Old bookmarks return to the common login.
app.use(['/supervisor','/poweruser','/poweruser.html'],(req,res)=>res.redirect('/index.html'));
// 1. Static Middleware สำหรับโฟลเดอร์หลัก public และโฟลเดอร์ย่อยแต่ละกลุ่ม
app.use(express.static(path.join(__dirname, '../public')));
app.use('/desktop', express.static(path.join(__dirname, '../public/desktop')));
app.use('/handheld', express.static(path.join(__dirname, '../public/handheld')));

// 2. Routing API
app.use('/api/auth', require('./routes/auth'));
app.use('/api/navigation',require('./routes/navigation'));
app.use('/api',require('./middleware/navigation').gate);
app.use('/api',require('./middleware/warehouse-scope').middleware);
app.use('/api/roles', access.authenticate, (req,res,next)=>req.method==='GET'?next():access.admin(req,res,next), require('./routes/roles'));
app.use('/api/users', access.authenticate, access.admin, require('./routes/users'));
app.use('/api/permissions', require('./routes/permissions'));
app.use('/api/master', access.authenticate, access.masterWrite, require('./routes/locations'));
app.use('/api/master', access.authenticate, access.masterWrite, require('./routes/masterdata'));
app.use('/api/manufacturer-products',require('./routes/manufacturer-products'));
app.use('/api/customer-products',require('./routes/customer-products'));
app.use('/api/transport-products',require('./routes/transport-products'));
app.use('/api/checks',require('./routes/checks'));
app.use('/api/transports',require('./routes/transports'));
app.use('/api/company',require('./routes/company'));
app.use('/api/customers',require('./routes/customers'));
app.use('/api/products', require('./routes/products'));
app.use('/api/warehouses', access.authenticate, access.masterWrite, require('./routes/warehouses'));
app.use('/api/stock', require('./routes/stock'));
app.use('/api/inbound', require('./routes/inbound'));
app.use('/api/storage-planner', require('./routes/storage-planner'));
app.use('/api/rm-sub-transfers',require('./routes/rm-sub-transfers'));
app.use('/api/rm-picking',require('./routes/rm-picking'));
app.use('/api/picking', require('./routes/picking'));
app.use('/api/suppliers', require('./routes/suppliers'));
app.use('/api/inbound-plans',require('./routes/inbound-plans'));
app.use('/api/delivery-plans',require('./routes/delivery-plans'));
app.use('/api/deliveries', require('./routes/deliveries'));

app.use('/api/daily-operations',require('./routes/daily-operations'));
app.use('/api/stock-transfers', require('./routes/stock-transfers'));
app.use('/api/bom-stock', require('./routes/bom-stock'));
app.use('/api/bom', require('./routes/bom'));
app.use('/api/inventory-counts', require('./routes/inventory-counts'));
app.get('/api/version',(req,res)=>res.json({success:true,version:'20261106-modern-workflows',root:path.resolve(__dirname,'..')}));
app.use('/api',(req,res)=>res.status(404).json({success:false,message:'ไม่พบ API นี้ กรุณาอัปเดตโปรแกรมและรีสตาร์ท Service',path:req.path}));
app.use((err,req,res,next)=>{if(!req.path.startsWith('/api/'))return next(err);res.status(err.status||500).json({success:false,message:err.status===400?'รูปแบบข้อมูลไม่ถูกต้อง':'เกิดข้อผิดพลาดในบริการ API'});});
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
  res.redirect('/admin/index.html');
});

const PORT = process.env.PORT || 3000;
const HOST = process.env.APP_HOST || 'localhost';

app.listen(PORT, '0.0.0.0', () => {
  console.log(`====================================================`);
  console.log(`🚀 Warehouse Stock Server is running!`);
  console.log(`💻 Desktop Web URL:     http://${HOST}:${PORT}/desktop/index.html`);
  console.log(`🛠️ Admin Portal:        http://${HOST}:${PORT}/admin/index.html`);
  console.log(`📱 Handheld Mobile URL: http://${HOST}:${PORT}/handheld/index.html (หรือ /hh)`);
  console.log(`🔑 Login Page URL:      http://${HOST}:${PORT}/index.html`);
  console.log(`====================================================`);
});




