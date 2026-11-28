'use strict';

const router=require('express').Router();
const {poolPromise,sql}=require('../config/db');
const access=require('../middleware/access');
const {normalizeTemplate}=require('../services/production-issue-form-templates');

router.use(access.authenticate,access.admin);
const fail=(status,message)=>{throw Object.assign(Error(message),{status})};
function sendError(res,error){
 const missing=error.number===208&&String(error.message).includes('ProductionIssueFormTemplates');
 const duplicate=[2601,2627].includes(error.number);
 res.status(error.status||(missing?503:duplicate?409:500)).json({success:false,message:error.status?error.message:missing?'ยังไม่ได้ติดตั้ง mssql/ProductionIssueFormTemplates.sql กรุณารันสคริปต์ฐานข้อมูลก่อนใช้งาน':duplicate?'รหัสฟอร์มและ Revision นี้มีอยู่แล้ว':'จัดการ Revision ฟอร์มไม่สำเร็จ'});
}
const columns='FormTemplateId,FormCode,FormRevision,EffectiveDate,CompanyName,DocumentTitle,IsActive,Version,CreatedBy,CreatedAt,UpdatedBy,UpdatedAt';
const shape=row=>row?{...row,EffectiveDate:row.EffectiveDate instanceof Date?row.EffectiveDate.toISOString().slice(0,10):String(row.EffectiveDate||'').slice(0,10)}:row;
router.get('/',async(req,res)=>{
 try{
  const pool=await poolPromise;
  const data=(await pool.request().query(`SELECT ${columns.replace('EffectiveDate','CONVERT(char(10),EffectiveDate,23) EffectiveDate')} FROM dbWMS.dbo.ProductionIssueFormTemplates ORDER BY FormCode,EffectiveDate DESC,FormRevision DESC`)).recordset;
  res.json({success:true,data});
 }catch(error){sendError(res,error);}
});

async function save(req,res,editing){
 let tx;
 try{
  const data=normalizeTemplate(req.body);
  const id=editing?Number(req.params.id):null;
  if(editing&&(!Number.isSafeInteger(id)||id<=0||!Number.isInteger(req.body?.version)||req.body.version<1))fail(400,'ข้อมูล Revision สำหรับแก้ไขไม่ถูกต้อง');
  const pool=await poolPromise;
  tx=new sql.Transaction(pool);
  await tx.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
  const rq=()=>new sql.Request(tx);
  let old=null;
  if(editing){
   old=(await rq().input('Id',sql.Int,id).query('SELECT * FROM dbWMS.dbo.ProductionIssueFormTemplates WITH(UPDLOCK,HOLDLOCK) WHERE FormTemplateId=@Id')).recordset[0];
   if(!old)fail(404,'ไม่พบ Revision ฟอร์ม');
   if(old.Version!==req.body.version)fail(409,'ข้อมูล Revision ถูกแก้ไขแล้ว กรุณารีเฟรชก่อนบันทึก');
  }
  if(data.IsActive){
   await rq().input('Code',sql.NVarChar(30),data.FormCode).input('Except',sql.Int,id||0).input('By',sql.NVarChar(100),String(req.user.username||req.user.id).slice(0,100)).query(`UPDATE dbWMS.dbo.ProductionIssueFormTemplates SET IsActive=0,Version=Version+1,UpdatedBy=@By,UpdatedAt=SYSDATETIME() WHERE FormCode=@Code AND IsActive=1 AND FormTemplateId<>@Except`);
  }
  const request=rq().input('Code',sql.NVarChar(30),data.FormCode).input('Revision',sql.NVarChar(20),data.FormRevision).input('Date',sql.Date,new Date(`${data.EffectiveDate}T00:00:00Z`)).input('Company',sql.NVarChar(200),data.CompanyName).input('Title',sql.NVarChar(200),data.DocumentTitle).input('Active',sql.Bit,data.IsActive).input('By',sql.NVarChar(100),String(req.user.username||req.user.id).slice(0,100));
  let result;
  if(editing){
   result=await request.input('Id',sql.Int,id).input('Version',sql.Int,req.body.version).query(`UPDATE dbWMS.dbo.ProductionIssueFormTemplates SET FormCode=@Code,FormRevision=@Revision,EffectiveDate=@Date,CompanyName=@Company,DocumentTitle=@Title,IsActive=@Active,Version=Version+1,UpdatedBy=@By,UpdatedAt=SYSDATETIME() OUTPUT inserted.${columns.replaceAll(',',' ,inserted.') } WHERE FormTemplateId=@Id AND Version=@Version`);
   if(!result.recordset.length)fail(409,'ข้อมูล Revision ถูกแก้ไขแล้ว กรุณารีเฟรชก่อนบันทึก');
  }else{
   result=await request.query(`INSERT dbWMS.dbo.ProductionIssueFormTemplates(FormCode,FormRevision,EffectiveDate,CompanyName,DocumentTitle,IsActive,CreatedBy,UpdatedBy) OUTPUT inserted.${columns.replaceAll(',',' ,inserted.')} VALUES(@Code,@Revision,@Date,@Company,@Title,@Active,@By,@By)`);
  }
  await tx.commit();
  res.status(editing?200:201).json({success:true,data:shape(result.recordset[0])});
 }catch(error){if(tx)try{await tx.rollback();}catch{}sendError(res,error);}
}
router.post('/',(req,res)=>save(req,res,false));
router.put('/:id',(req,res)=>save(req,res,true));
router.delete('/:id',async(req,res)=>{
 let tx;
 try{
  const id=Number(req.params.id),version=req.body?.version;
  if(!Number.isSafeInteger(id)||id<=0||!Number.isInteger(version)||version<1)fail(400,'ข้อมูล Revision สำหรับปิดใช้งานไม่ถูกต้อง');
  const pool=await poolPromise;tx=new sql.Transaction(pool);await tx.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
  const result=await new sql.Request(tx).input('Id',sql.Int,id).input('Version',sql.Int,version).input('By',sql.NVarChar(100),String(req.user.username||req.user.id).slice(0,100)).query(`UPDATE dbWMS.dbo.ProductionIssueFormTemplates SET IsActive=0,Version=Version+1,UpdatedBy=@By,UpdatedAt=SYSDATETIME() OUTPUT inserted.${columns.replaceAll(',',' ,inserted.')} WHERE FormTemplateId=@Id AND Version=@Version`);
  if(!result.recordset.length){
   const found=(await new sql.Request(tx).input('Id',sql.Int,id).query('SELECT FormTemplateId FROM dbWMS.dbo.ProductionIssueFormTemplates WHERE FormTemplateId=@Id')).recordset[0];
   fail(found?409:404,found?'ข้อมูล Revision ถูกแก้ไขแล้ว กรุณารีเฟรชก่อนปิดใช้งาน':'ไม่พบ Revision ฟอร์ม');
  }
  await tx.commit();res.json({success:true,data:shape(result.recordset[0])});
 }catch(error){if(tx)try{await tx.rollback();}catch{}sendError(res,error);}
});
module.exports=router;
