const {sql}=require('../config/db');
module.exports=async(q,id,b)=>{
 const fields=[['productName1','ProductName1',2000],['productName2','ProductName2',2000],['proID1','ProID1',500],['proID2','ProID2',500],['proID3','ProID3',500],['proID4','ProID4',500],['physicalForm','PhysicalForm',50]];
 const updates=[],request=q().input('Id',sql.Int,id);
 for(const[key,col,max]of fields){if(b[key]===undefined)continue;if(b[key]!==null&&(typeof b[key]!=='string'||b[key].length>max))throw Object.assign(Error('ข้อมูล '+col+' ยาวเกินกำหนดหรือรูปแบบไม่ถูกต้อง'),{status:400});request.input(col,sql.NVarChar(max),b[key]?.trim()||null);updates.push(col+'=@'+col)}
 if(updates.length)await request.query('UPDATE dbo.tblProducts SET '+updates.join(',')+',UpdatedAt=SYSUTCDATETIME() WHERE ProductId=@Id');
};
