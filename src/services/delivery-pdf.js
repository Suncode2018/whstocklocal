const PDFDocument=require('pdfkit');
const path=require('node:path');
const fontDir=path.join(__dirname,'../assets/fonts');
const text=value=>String(value??'').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g,'');
function deliveryDate(value){const raw=value instanceof Date?value.toISOString().slice(0,10):String(value).slice(0,10);const d=new Date(raw+'T00:00:00Z');return Number.isNaN(d.getTime())?raw:raw.split('-').reverse().join('/');}
function createDeliveryPdf(order,lines){return new Promise((resolve,reject)=>{
 const doc=new PDFDocument({size:'A4',margins:{top:36,bottom:36,left:36,right:36},bufferPages:true,info:{Title:'Delivery Order '+text(order.DeliveryNo),Author:'RUAYMANGKHANG 69 CO., LTD',Subject:'Temporary delivery order - no prices'}});
 const chunks=[];doc.on('data',c=>chunks.push(c));doc.on('end',()=>resolve(Buffer.concat(chunks)));doc.on('error',reject);
 try{
 doc.registerFont('Thai',path.join(fontDir,'Sarabun-Regular.ttf'));doc.registerFont('ThaiBold',path.join(fontDir,'Sarabun-Bold.ttf'));
 const company=require('./company-profile').documentCompany(order);
 const copyLabels=['ต้นฉบับ (สำหรับลูกค้า)','สำเนาที่ 1 (สำหรับลูกค้า)','สำเนาที่ 2 (สำหรับ'+text(company.NameTH)+')'];
 let copyLabel=copyLabels[0];
 const left=36,width=doc.page.width-72,right=left+width,bottom=778;let y=36;
 const status={DRAFT:'ร่าง - ยังไม่ยืนยันส่งจริง',SENT:'ส่งสินค้าแล้ว',RECEIVED:'ปลายทางรับสินค้าแล้ว',CANCELLED:'ยกเลิกเอกสาร'}[order.Status]||text(order.Status);
 const type={WAREHOUSE:'ส่งระหว่างคลัง',FACTORY:'ส่งโรงงาน',CUSTOMER:'ส่งลูกค้า',CLINIC:'ส่งคลินิก',FULFILLMENT:'ส่ง Fulfillment'}[order.DeliveryType]||'';
 function write(value,x,top,w,size=11,bold=false,extra={}){doc.font(bold?'ThaiBold':'Thai').fontSize(size).fillColor(extra.color||'#172033').text(text(value),x,top,{width:w,lineGap:2,...extra});}
 function height(value,w,size=11,bold=false){return doc.font(bold?'ThaiBold':'Thai').fontSize(size).heightOfString(text(value),{width:w,lineGap:2});}
 function rule(top){doc.strokeColor('#cbd5e1').lineWidth(.6).moveTo(left,top).lineTo(right,top).stroke();}
 function box(values,x,top,w){const content=values.filter(Boolean).join('\n');const h=height(content,w-20)+20;doc.roundedRect(x,top,w,h,5).lineWidth(.6).strokeColor('#cbd5e1').stroke();write(content,x+10,top+10,w-20);return h;}
 function header(first){
 y=32;
 if(first){
 write(company.NameTH,left,y,205,12,true);
 write(company.AddressTH+'\nโทร : '+company.Phone+'\nเลขผู้เสียภาษี : '+company.TaxId,left,y+23,205,9);
 write(company.NameEN,right-205,y,205,10,true);
 write(company.AddressEN+'\nTel : '+company.Phone+'\nTax ID : '+company.TaxId,right-205,y+23,205,9);
 doc.circle(left+width/2,53,22).strokeColor('#243e68').lineWidth(1.3).stroke();
 write(company.LogoText,left+width/2-22,33,44,20,true,{align:'center',color:'#243e68'});write(company.LogoCaption,left+width/2-22,59,44,9,true,{align:'center',color:'#243e68'});
 doc.rect(left+width/2-57,83,114,39).fill('#eef0f3');write('ใบส่งสินค้าชั่วคราว',left+width/2-57,88,114,10,true,{align:'center'});write('DELIVERY ORDER',left+width/2-57,105,114,9,true,{align:'center'});
 const billing=text(order.BillingAddress||order.ShippingAddress);
 const customer=['ลูกค้า / CUSTOMER',text(order.DestinationName),order.BranchName?text(order.BranchName):'', 'ที่อยู่ : '+billing,order.ShippingAddress&&text(order.ShippingAddress)!==billing?'จัดส่ง : '+text(order.ShippingAddress):'', 'โทร / Tel : '+text(order.Phone||'-'),'เลขผู้เสียภาษี / TAX ID : '+text(order.TaxId||'-')].filter(Boolean).join('\n');
 const meta=['เลขที่ / NO. : '+text(order.DeliveryNo),'วันที่ / DATE : '+deliveryDate(order.DeliveryDate),'เครดิต / CREDIT : -','ครบกำหนดชำระ / DUE DATE : -',copyLabel].join('\n');
 y=Math.max(139,55+height(company.AddressTH+'\nโทร : '+company.Phone+'\nเลขผู้เสียภาษี : '+company.TaxId,205,9),55+height(company.AddressEN+'\nTel : '+company.Phone+'\nTax ID : '+company.TaxId,205,9));write(customer,left,y,310,10);write(meta,left+330,y,width-330,9);y+=Math.max(height(customer,310,10),height(meta,width-330,9))+15;
 }else{write('ใบส่งสินค้าชั่วคราว / DELIVERY ORDER',left,y,width,14,true);const subtitle=text(order.DeliveryNo)+' | '+text(order.DestinationName)+'\n'+copyLabel;write(subtitle,left,y+26,width,10);y+=26+height(subtitle,width,10)+12;}
 }
 // Keep the A4 table width fixed; give quantities more room by reducing the description column.
 const columns=[left,left+27,left+239,left+309,left+345,left+405,left+458,right];
 function writeQuantity(value,top){
  const label=Number(value).toLocaleString('th-TH',{maximumFractionDigits:2});
  const padding=5,cellWidth=columns[3]-columns[2]-padding*2;
  doc.font('ThaiBold').fontSize(11);
  const measured=doc.widthOfString(label);
  const size=measured>cellWidth?11*(cellWidth-1)/measured:11;
  write(label,columns[2]+padding,top,cellWidth,size,true,{align:'right',lineBreak:false});
 }
 function tableHeader(){const heads=['ลำดับ\nITEM','รายการ\nDESCRIPTION','จำนวน\nQTY','หน่วย\nUNIT','หน่วยละ\nUNIT PRICE','ส่วนลด\nDISCOUNT','จำนวนเงิน\nAMOUNT'];doc.rect(left,y,width,35).fill('#f3f4f6');for(let i=0;i<heads.length;i++)write(heads[i],columns[i]+2,y+5,columns[i+1]-columns[i]-4,i===0?6:8,true,{align:'center'});doc.strokeColor('#555').lineWidth(.6).rect(left,y,width,35).stroke();y+=35;}
 function newPage(withTable=true){doc.addPage();header(false);if(withTable)tableHeader();}
 for(let copyIndex=0;copyIndex<copyLabels.length;copyIndex++){
 copyLabel=copyLabels[copyIndex];
 if(copyIndex>0)doc.addPage();
 const copyStart=doc.bufferedPageRange().count-1;
 header(true);if(y+75>bottom)newPage();else tableHeader();
 for(let i=0;i<lines.length;i++){
  const l=lines[i];const detail=text(l.ProductName)+'\n'+text(l.ProductCode)+(l.PackDescription?'\n'+text(l.PackDescription):'');const blocks=detail.split('\n');let parts=[];
  // Bound very long individual descriptions without clipping; continuation rows retain the item number.
  let part='';for(const character of Array.from(detail)){const trial=part+character;if(part&&height(trial,columns[2]-columns[1]-14)>190){parts.push(part);part=character}else part=trial;}if(part)parts.push(part);
  let first=true;for(const part of parts){const rowHeight=Math.max(32,height(part,columns[2]-columns[1]-14)+16);if(y+rowHeight>bottom)newPage();doc.strokeColor('#777').lineWidth(.5);for(const x of columns)doc.moveTo(x,y).lineTo(x,y+rowHeight).stroke();write(first?String(i+1):'ต่อ',columns[0]+5,y+8,columns[1]-columns[0]-10,10,false,{align:'center'});write(part,columns[1]+7,y+7,columns[2]-columns[1]-14,11,first);if(first)writeQuantity(l.Quantity,y+8);write(first?text(l.UOM||'-'):'',columns[3]+4,y+8,columns[4]-columns[3]-8,10,false,{align:'center'});for(let c=4;c<7;c++)write(first?'-':'',columns[c]+2,y+8,columns[c+1]-columns[c]-4,10,false,{align:'center'});y+=rowHeight;first=false;}
 }
 const reference=[order.PoNo?'อ้างอิง : '+text(order.PoNo):'',order.SoNo?text(order.SoNo):''].filter(Boolean).join('\n');
 if(y+height(reference,230,10)+150>bottom)newPage();
 const tableEnd=Math.max(y+height(reference,230,10)+35,625);
 doc.strokeColor('#777').lineWidth(.5).moveTo(left,tableEnd).lineTo(right,tableEnd).stroke();for(const x of columns)doc.moveTo(x,y).lineTo(x,tableEnd).stroke();
 if(reference)write(reference,columns[1]+7,y+20,columns[2]-columns[1]-14,10,true);
 y=tableEnd;
 const note=['หมายเหตุ / REMARK : '+text(order.Note||'-'),'ขนส่ง : '+text(order.Carrier||'-')+(order.VehicleNo?' · ทะเบียน '+text(order.VehicleNo):''),order.TrackingNo?'Tracking : '+text(order.TrackingNo):'',order.Cartons?'จำนวนหีบห่อ : '+text(order.Cartons):''].filter(Boolean).join('\n');
 const totals=['รวมเป็นเงิน / TOTAL','หักส่วนลด / DISCOUNT','จำนวนเงินหลังหักส่วนลด / GRAND TOTAL','จำนวนภาษีมูลค่าเพิ่ม / VAT','ราคาสินค้า / SUB TOTAL'];
 const summaryHeight=Math.max(85,height(note,280,9)+14);if(y+summaryHeight+65>bottom)newPage(false);
 doc.rect(left,y,width,summaryHeight).stroke();write(note,left+5,y+5,280,9);for(let i=0;i<5;i++){write(totals[i],left+300,y+5+i*15,175,8);write('0.00',right-42,y+5+i*15,37,9,false,{align:'right'});}y+=summaryHeight;
 const ownershipNotice='สินค้าในใบส่งของนี้ แม้จะได้มอบให้แก่ผู้ซื้อแล้วก็คงเป็นสินทรัพย์ของผู้ขาย จนกว่าผู้ซื้อจะได้ชำระเงินเรียบร้อยแล้ว';write(ownershipNotice,left+4,y+4,width-8,8);y+=Math.max(23,height(ownershipNotice,width-8,8)+8);
 const labels=['ผู้รับสินค้า / RECEIVER','ผู้ส่งสินค้า / DELIVERED BY','ผู้อนุมัติ / AUTHORIZED'];for(let i=0;i<3;i++){const x=left+i*width/3;write(labels[i],x+4,y,width/3-8,8);write('ลงชื่อ ____________________',x+4,y+17,width/3-8,9);write('วันที่ / DATE ______________',x+4,y+34,width/3-8,8);}
 const copyEnd=doc.bufferedPageRange().count;
 for(let i=copyStart;i<copyEnd;i++){doc.switchToPage(i);const savedBottom=doc.page.margins.bottom;doc.page.margins.bottom=0;write('หน้า '+(i-copyStart+1)+' / '+(copyEnd-copyStart),right-80,812,80,8,false,{align:'right',lineBreak:false});doc.page.margins.bottom=savedBottom;}
 }
 doc.end();
 }catch(error){doc.destroy();reject(error)}
});}
module.exports={createDeliveryPdf,deliveryDate};


