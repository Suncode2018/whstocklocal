/* Retired schema adapter. No stock writes use the legacy Products/Stock tables. */
const router=require('express').Router();router.use((req,res)=>res.status(410).json({success:false,message:'โปรดใช้ API กระบวนการปัจจุบัน: inbound, storage-planner, picking, deliveries, inventory-counts'}));module.exports=router;
