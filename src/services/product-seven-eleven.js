const {sql}=require('../config/db');
const fail=(status,message)=>{throw Object.assign(Error(message),{status})};
exports.save=async(q,req,id,b)=>{
 if(b.allowSevenElevenDelivery===undefined&&b.sevenElevenDeliveryNote===undefined)return;
 if(typeof b.allowSevenElevenDelivery!=='boolean'||typeof b.sevenElevenDeliveryNote!=='string'||b.sevenElevenDeliveryNote.length>500)fail(400,'ตรวจสถานะและหมายเหตุส่ง 7-11');
 const old=(await q().input('I',sql.Int,id).query('SELECT AllowSevenElevenDelivery,SevenElevenDeliveryNote FROM dbMaster.dbo.tblProducts WITH(UPDLOCK,HOLDLOCK) WHERE ProductId=@I')).recordset[0];
 const note=b.sevenElevenDeliveryNote.trim();if(Boolean(old.AllowSevenElevenDelivery)===b.allowSevenElevenDelivery&&(old.SevenElevenDeliveryNote||'')===note)return;
 if(req.user.role!=='ADMIN')fail(403,'เฉพาะ Admin กำหนดการส่ง 7-11ได้');
 await q().input('I',sql.Int,id).input('A',sql.Bit,b.allowSevenElevenDelivery).input('N',sql.NVarChar(500),note||null).input('By',sql.NVarChar(100),String(req.user.username||req.user.id).slice(0,100)).query('UPDATE dbMaster.dbo.tblProducts SET AllowSevenElevenDelivery=@A,SevenElevenDeliveryNote=@N,UpdatedAt=SYSDATETIME() OUTPUT inserted.ProductId,deleted.AllowSevenElevenDelivery,inserted.AllowSevenElevenDelivery,deleted.SevenElevenDeliveryNote,inserted.SevenElevenDeliveryNote,@By INTO dbMaster.dbo.ProductSevenElevenAudit(ProductId,OldAllowed,NewAllowed,OldNote,NewNote,Actor) WHERE ProductId=@I');
};
