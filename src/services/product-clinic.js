const {sql}=require('../config/db');
const fail=(status,message)=>{throw Object.assign(Error(message),{status})};
exports.save=async(q,req,id,b)=>{
 if(b.allowClinicDelivery===undefined&&b.clinicDeliveryNote===undefined)return;
 if(typeof b.allowClinicDelivery!=='boolean'||typeof b.clinicDeliveryNote!=='string'||b.clinicDeliveryNote.length>500)fail(400,'ตรวจสถานะและหมายเหตุส่งคลินิก');
 const old=(await q().input('I',sql.Int,id).query('SELECT AllowClinicDelivery,ClinicDeliveryNote FROM dbMaster.dbo.tblProducts WITH(UPDLOCK,HOLDLOCK) WHERE ProductId=@I')).recordset[0];
 const note=b.clinicDeliveryNote.trim();if(Boolean(old.AllowClinicDelivery)===b.allowClinicDelivery&&(old.ClinicDeliveryNote||'')===note)return;
 if(req.user.role!=='ADMIN')fail(403,'เฉพาะ Admin กำหนดการส่งคลินิกได้');
 await q().input('I',sql.Int,id).input('A',sql.Bit,b.allowClinicDelivery).input('N',sql.NVarChar(500),note||null).input('By',sql.NVarChar(100),String(req.user.username||req.user.id).slice(0,100)).query('UPDATE dbMaster.dbo.tblProducts SET AllowClinicDelivery=@A,ClinicDeliveryNote=@N,UpdatedAt=SYSDATETIME() OUTPUT inserted.ProductId,deleted.AllowClinicDelivery,inserted.AllowClinicDelivery,deleted.ClinicDeliveryNote,inserted.ClinicDeliveryNote,@By INTO dbMaster.dbo.ProductClinicAudit(ProductId,OldAllowed,NewAllowed,OldNote,NewNote,Actor) WHERE ProductId=@I');
};
exports.check=async(q,type,ids)=>{if(type!=='CLINIC')return;for(const id of [...new Set(ids)]){const p=(await q().input('ClinicProduct',sql.Int,id).query('SELECT ProductCode,AllowClinicDelivery,IsActive FROM dbMaster.dbo.tblProducts WITH(HOLDLOCK) WHERE ProductId=@ClinicProduct')).recordset[0];if(!p||!p.IsActive||!p.AllowClinicDelivery)fail(409,'สินค้า '+(p?.ProductCode||id)+' ไม่เปิดส่งคลินิก กรุณาให้ Admin ตรวจ Master สินค้า');}};
