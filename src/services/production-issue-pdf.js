'use strict';
const PDFDocument=require('pdfkit');
const path=require('node:path');
const clean=value=>String(value??'').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g,'');
const fmt=value=>Number(value||0).toLocaleString('th-TH',{maximumFractionDigits:6});
function createProductionIssuePdf(progress){return new Promise((resolve,reject)=>{
 const {document:d,lines=[],summary={}}=progress;
 const doc=new PDFDocument({size:'A4',margins:{top:38,bottom:42,left:42,right:42},bufferPages:true,info:{Title:'ใบขอเบิกผลิต '+clean(d.IssueNo),Author:'WH Stock System'}}),chunks=[];
 doc.on('data',chunk=>chunks.push(chunk));doc.on('end',()=>resolve(Buffer.concat(chunks)));doc.on('error',reject);
 try{
  const fonts=path.join(__dirname,'../assets/fonts');doc.registerFont('Thai',path.join(fonts,'Sarabun-Regular.ttf'));doc.registerFont('ThaiBold',path.join(fonts,'Sarabun-Bold.ttf'));
  const left=42,right=doc.page.width-42,width=right-left,bottom=doc.page.height-45;let y=38;
  const text=(value,x,top,w,size=10,bold=false,extra={})=>doc.font(bold?'ThaiBold':'Thai').fontSize(size).fillColor(extra.color||'#172033').text(clean(value),x,top,{width:w,lineGap:2,...extra});
  const status={DRAFT:'ยังไม่เบิก',PARTIAL:'เบิกบางส่วน',ISSUED:'เบิกครบแล้ว',CANCELLED:'ยกเลิก'}[d.FulfillmentStatus]||d.FulfillmentStatus;
  function header(first){if(first){text('ใบขอเบิกวัตถุดิบ / บรรจุภัณฑ์เพื่อการผลิต',left,y,width,18,true);y+=28;text('เลขที่ '+d.IssueNo,left,y,width*.58,12,true);text('สถานะ: '+status,right-width*.38,y,width*.38,11,true,{align:'right'});y+=24;text('FG: '+d.FGProductCode+' · '+d.FGProductName,left,y,width,10);y+=17;text('จำนวนผลิต: '+fmt(d.BaseQuantity)+' '+d.BaseUnit+' · สูตร V'+d.BOMVersion,left,y,width*.58,10);text('วันที่: '+new Date(d.CreatedAt).toLocaleString('th-TH'),right-width*.42,y,width*.42,9,false,{align:'right'});y+=24;text('คลังที่อนุญาต: '+JSON.parse(d.WarehouseIdsJson||'[]').join(', '),left,y,width,9,false,{color:'#475569'});y+=20;}else{text('ใบขอเบิกผลิต · '+d.IssueNo,left,y,width,12,true);y+=23;}}
  const cols=[left,left+26,left+190,left+281,left+357,left+429,right];
  function tableHead(){const labels=['#','รหัส / รายการ','ประเภท','ต้องเบิก','เบิกแล้ว','คงเหลือ'];doc.rect(left,y,width,27).fill('#eef2f7');for(let i=0;i<labels.length;i++)text(labels[i],cols[i]+4,y+7,cols[i+1]-cols[i]-8,8,true,{align:i>2?'right':'left'});y+=27;}
  header(true);tableHead();
  for(const [index,line] of lines.entries()){
   const label=clean(line.ProductCode)+' · '+clean(line.ProductName),lineHeight=Math.max(30,doc.font('Thai').fontSize(9).heightOfString(label,{width:cols[2]-cols[1]-12,lineGap:2})+12);
   if(y+lineHeight>bottom){doc.addPage();y=38;header(false);tableHead();}
   doc.strokeColor('#d5dbe5').lineWidth(.5).moveTo(left,y+lineHeight).lineTo(right,y+lineHeight).stroke();
   text(index+1,cols[0]+4,y+7,cols[1]-cols[0]-8,8);text(label,cols[1]+5,y+6,cols[2]-cols[1]-10,9,true);text(line.CategoryCode,cols[2]+4,y+7,cols[3]-cols[2]-8,8);text(fmt(line.RequiredQuantity)+' '+line.UnitCode,cols[3]+4,y+7,cols[4]-cols[3]-8,8,false,{align:'right'});text(fmt(line.PickedQuantity),cols[4]+4,y+7,cols[5]-cols[4]-8,8,false,{align:'right'});text(fmt(line.RemainingQuantity),cols[5]+4,y+7,cols[6]-cols[5]-8,8,false,{align:'right'});y+=lineHeight;
  }
  y+=14;
  // Reserve room for the summary and both signature rows. If PDFKit is left
  // to page-break one of these text calls automatically, its extra page gets
  // added after our buffered page count and appears as a blank PDF page.
  const closingBlockHeight=112;
  if(y+closingBlockHeight>bottom){doc.addPage();y=40;header(false)}
  const unitSummary=(summary.byUnit||[]).map(item=>`${fmt(item.pickedQuantity)} / ${fmt(item.requiredQuantity)} ${item.unit} เบิกแล้ว`).join(' · ');
  doc.roundedRect(left,y,width,62,5).fill('#f3f6fa');text('ความคืบหน้า: '+summary.completeCount+'/'+summary.lineCount+' รายการครบ',left+10,y+7,width-20,10,true);text(unitSummary||'ยังไม่มีการเบิก',left+10,y+24,width-20,8,false);text('ยืนยัน PICK แล้วระบบตัดสต๊อกตามจำนวนจริง · เอกสารนี้ไม่ใช่หลักฐานการตัดสต๊อก',left+10,y+40,width-20,8,false,{color:'#475569'});y+=78;
  text('ผู้ขอเบิก __________________________',left,y,width*.48,9);text('ผู้จ่าย / ผู้ตรวจนับ __________________________',left+width*.52,y,width*.48,9);y+=28;text('วันที่ __________________________',left,y,width*.48,9);text('วันที่ __________________________',left+width*.52,y,width*.48,9);
  const pages=doc.bufferedPageRange();for(let i=0;i<pages.count;i++){doc.switchToPage(i);doc.page.margins.bottom=12;doc.font('Thai').fontSize(8).fillColor('#64748b').text(`หน้า ${i+1} / ${pages.count}`,right-70,doc.page.height-31,{width:70,align:'right',lineBreak:false});}doc.end();
 }catch(error){doc.destroy();reject(error)}
});}
module.exports={createProductionIssuePdf};
