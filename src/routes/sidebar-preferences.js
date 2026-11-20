const express=require('express');
const {poolPromise,sql}=require('../config/db');
const router=express.Router();

const groups={ADMIN:['warehouse','main-process','reports','system-settings'],DESKTOP:['warehouse-warehouse','warehouse-main-process','warehouse-reports','warehouse-master','main-process','reports','system-settings'],HANDHELD:['warehouse-main-process','warehouse-warehouse','warehouse-reports']};
let schemaReady;
function ensureSchema(){
  if(!schemaReady)schemaReady=poolPromise.then(pool=>pool.request().query(`
    IF OBJECT_ID(N'dbo.UserSidebarPreferences',N'U') IS NULL
    BEGIN
      CREATE TABLE dbo.UserSidebarPreferences(
        UserId INT NOT NULL,
        Surface VARCHAR(10) NOT NULL,
        GroupStates NVARCHAR(MAX) NOT NULL CONSTRAINT DF_UserSidebarPreferences_GroupStates DEFAULT N'{}',
        UpdatedAt DATETIME2(0) NOT NULL CONSTRAINT DF_UserSidebarPreferences_UpdatedAt DEFAULT SYSDATETIME(),
        CONSTRAINT PK_UserSidebarPreferences PRIMARY KEY(UserId,Surface),
        CONSTRAINT CK_UserSidebarPreferences_Surface CHECK(Surface IN ('ADMIN','DESKTOP','HANDHELD')),
        CONSTRAINT CK_UserSidebarPreferences_GroupStates CHECK(ISJSON(GroupStates)=1)
      );
    END;
  `));
  return schemaReady;
}
function surfaceFrom(value){const surface=String(value||'').toUpperCase();return groups[surface]?surface:null;}
function validateStates(surface,value){
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!groups[surface].includes(k))||Object.values(value).some(v=>typeof v!=='boolean'))return null;
  return value;
}
router.get('/sidebar',async(req,res)=>{try{
  const surface=surfaceFrom(req.query.surface),userId=Number(req.user?.id);
  if(!surface)return res.status(400).json({success:false,message:'ประเภทเมนูไม่ถูกต้อง'});
  if(!Number.isInteger(userId)||userId<=0)return res.status(401).json({success:false,message:'ไม่พบผู้ใช้ในเซสชัน'});
  await ensureSchema();const pool=await poolPromise;
  await pool.request().input('UserId',sql.Int,userId).input('Surface',sql.VarChar(10),surface).query(`IF NOT EXISTS(SELECT 1 FROM dbo.UserSidebarPreferences WHERE UserId=@UserId AND Surface=@Surface) INSERT dbo.UserSidebarPreferences(UserId,Surface,GroupStates) VALUES(@UserId,@Surface,N'{}')`);
  const row=(await pool.request().input('UserId',sql.Int,userId).input('Surface',sql.VarChar(10),surface).query('SELECT GroupStates,UpdatedAt FROM dbo.UserSidebarPreferences WHERE UserId=@UserId AND Surface=@Surface')).recordset[0];
  res.json({success:true,states:JSON.parse(row.GroupStates||'{}'),updatedAt:row.UpdatedAt});
}catch(e){console.error('Sidebar preference load failed:',e);res.status(500).json({success:false,message:'โหลดการตั้งค่าเมนูไม่สำเร็จ'})}});
router.put('/sidebar',async(req,res)=>{try{
  const surface=surfaceFrom(req.body?.surface),userId=Number(req.user?.id),states=surface&&validateStates(surface,req.body?.states);
  if(!surface||!states)return res.status(400).json({success:false,message:'สถานะเมนูไม่ถูกต้อง'});
  if(!Number.isInteger(userId)||userId<=0)return res.status(401).json({success:false,message:'ไม่พบผู้ใช้ในเซสชัน'});
  await ensureSchema();const pool=await poolPromise;
  await pool.request().input('UserId',sql.Int,userId).input('Surface',sql.VarChar(10),surface).input('States',sql.NVarChar(sql.MAX),JSON.stringify(states)).query(`
    UPDATE dbo.UserSidebarPreferences WITH(UPDLOCK,SERIALIZABLE) SET GroupStates=@States,UpdatedAt=SYSDATETIME() WHERE UserId=@UserId AND Surface=@Surface;
    IF @@ROWCOUNT=0 INSERT dbo.UserSidebarPreferences(UserId,Surface,GroupStates) VALUES(@UserId,@Surface,@States);
  `);
  res.json({success:true});
}catch(e){console.error('Sidebar preference save failed:',e);res.status(500).json({success:false,message:'บันทึกการตั้งค่าเมนูไม่สำเร็จ'})}});
module.exports=router;
