const router=require('express').Router();const {poolPromise}=require('../config/db');
router.get('/',async(req,res)=>{try{const pool=await poolPromise;res.json((await pool.request().query("SELECT * FROM UserRoles WHERE RoleCode IN ('ADMIN','USER') ORDER BY CASE RoleCode WHEN 'ADMIN' THEN 0 ELSE 1 END")).recordset)}catch(e){res.status(500).json({error:e.message})}});
const fixed=(req,res)=>res.status(400).json({error:'ระบบกำหนดไว้เพียง ADMIN และ USER กรุณาจัดการสิทธิ์เมนูรายผู้ใช้'});router.post('/',fixed);router.put('/:id',fixed);router.delete('/:id',fixed);module.exports=router;
