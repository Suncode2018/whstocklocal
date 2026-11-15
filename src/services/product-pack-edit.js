const {sql}=require('../config/db');
const fail=(status,message)=>{throw Object.assign(Error(message),{status})};
exports.save=async(q,req,id,b,product)=>{
 const versionId=Number(req.params.versionId);
 if(!Number.isInteger(versionId)||versionId<=0||versionId>2147483647)fail(400,'รุ่นไม่ถูกต้อง');
 const old=(await q().input('V',sql.Int,versionId).input('P',sql.Int,id).query('SELECT * FROM dbo.tblProductPackVersions WITH(UPDLOCK,HOLDLOCK) WHERE PackVersionId=@V AND ProductId=@P')).recordset[0];
 if(!old)fail(404,'ไม่พบรุ่นอัตราบรรจุ');
 // Older documents have no version foreign key, so conservatively protect every version for products with document history.
 const used=(await q().input('P',sql.Int,id).input('V',sql.Int,versionId).query(`SELECT CASE WHEN EXISTS(SELECT 1 FROM dbo.tblProductPalletVersions WITH(HOLDLOCK) WHERE PackVersionId=@V)
 OR EXISTS(SELECT 1 FROM dbWMS.dbo.InboundLines WITH(HOLDLOCK) WHERE ProductId=@P)
 OR EXISTS(SELECT 1 FROM dbWMS.dbo.DeliveryLines WITH(HOLDLOCK) WHERE ProductId=@P)
 THEN 1 ELSE 0 END Used`)).recordset[0];
 if(used.Used)fail(409,'สินค้ามีประวัติใบรับ/ใบส่ง หรือรุ่นนี้ถูกใช้จัดเรียงพาเลทแล้ว จึงแก้รุ่นเดิมไม่ได้ กรุณาสร้างรุ่นใหม่');
 if(b.originalVersion!==JSON.stringify(old))fail(409,'ข้อมูลรุ่นเปลี่ยนแล้ว กรุณารีเฟรชก่อนแก้ไข');
 if((await q().input('P',sql.Int,id).input('V',sql.Int,versionId).input('D',sql.Date,b.effectiveFrom).query('SELECT PackVersionId FROM dbo.tblProductPackVersions WITH(UPDLOCK,HOLDLOCK) WHERE ProductId=@P AND EffectiveFrom=@D AND PackVersionId<>@V')).recordset.length)fail(409,'มีรุ่นอื่นเริ่มใช้ในวันนี้แล้ว');
 await q().input('V',sql.Int,versionId).input('D',sql.Date,b.effectiveFrom).input('Pack',sql.NVarChar(30),b.packUnit.trim()).input('Qty',sql.Decimal(18,6),b.unitsPerPack).input('Label',sql.NVarChar(30),b.stockUnitLabel?.trim()||null).input('Weight',sql.Decimal(18,6),b.netWeightGramsPerUnit||null).input('Volume',sql.Decimal(18,6),b.netVolumeMlPerUnit||null).input('Outer',sql.NVarChar(30),b.outerPackUnit?.trim()||null).input('Packs',sql.Int,b.outerPackUnit?Number(b.packsPerOuter):null).input('Note',sql.NVarChar(255),b.note?.trim()||null).query('UPDATE dbo.tblProductPackVersions SET EffectiveFrom=@D,PackUnit=@Pack,UnitsPerPack=@Qty,StockUnitLabel=@Label,NetWeightGramsPerUnit=@Weight,NetVolumeMlPerUnit=@Volume,OuterPackUnit=@Outer,PacksPerOuter=@Packs,Note=@Note WHERE PackVersionId=@V');
 await q().input('V',sql.Int,versionId).input('Old',sql.NVarChar(sql.MAX),JSON.stringify(old)).input('Actor',sql.NVarChar(100),String(req.user.username||req.user.id).slice(0,100)).query('INSERT dbo.ProductPackEditAudit(PackVersionId,BeforeJson,AfterJson,Actor) SELECT @V,@Old,(SELECT * FROM dbo.tblProductPackVersions WHERE PackVersionId=@V FOR JSON PATH,WITHOUT_ARRAY_WRAPPER),@Actor');
};
