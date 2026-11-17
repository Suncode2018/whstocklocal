const cell=value=>'"'+String(value??'').replace(/^[=+@-]/,'\t$&').replace(/"/g,'""')+'"';
function csv(rows){const header=['วันที่','รหัสสินค้า','ชื่อสินค้า','ยอดยกมา','รับเข้า','จ่ายออก','คงเหลือสิ้นวัน','หน่วย','จำนวนรายการเคลื่อนไหว'];return '\uFEFF'+[header,...rows.map(r=>[String(r.StockDate).slice(0,10),r.ProductCode,r.ProductName,r.Opening,r.Received,r.Issued,r.Closing,r.UOM,r.MovementCount])].map(row=>row.map(cell).join(',')).join('\r\n')}
module.exports={csv};
