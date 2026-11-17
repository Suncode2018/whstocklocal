const cell=v=>'"'+String(v??'').replace(/^[=+@-]/,'\t$&').replace(/"/g,'""')+'"';
const date=v=>new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Bangkok',day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false}).format(new Date(v));
function csv(rows){const headers=['วันที่และเวลา','ชนิดงาน','เลขเอกสาร','รหัสสินค้า','ชื่อสินค้า','รหัสคลัง','ชื่อคลัง','โลเคชั่น','ยอดก่อน','เปลี่ยนแปลง','ยอดหลัง','หน่วย','หมายเหตุ','ผู้ทำรายการ'];return '\uFEFF'+[headers,...rows.map(r=>[date(r.CreatedAt),r.TransType,r.RefDocNo,r.ProductCode,r.ProductName,r.whid,r.whname,r.LocationCode,Number(r.QtyAfter)-Number(r.QtyChange),r.QtyChange,r.QtyAfter,r.UnitCode,r.Remark,r.CreatedBy])].map(row=>row.map(cell).join(',')).join('\r\n')}
module.exports={csv};
