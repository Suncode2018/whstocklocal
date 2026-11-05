const PDFDocument=require('pdfkit');
const path=require('node:path');
const fontDir=path.join(__dirname,'../assets/fonts');
const text=value=>String(value??'').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g,'');
function deliveryDate(value){const raw=value instanceof Date?value.toISOString().slice(0,10):String(value).slice(0,10);const d=new Date(raw+'T00:00:00Z');return Number.isNaN(d.getTime())?raw:new Intl.DateTimeFormat('th-TH-u-ca-gregory',{dateStyle:'long',timeZone:'Asia/Bangkok'}).format(d);}
function createDeliveryPdf(order,lines){return new Promise((resolve,reject)=>{
 const doc=new PDFDocument({size:'A4',margins:{top:36,bottom:36,left:36,right:36},bufferPages:true,info:{Title:'Delivery Order '+text(order.DeliveryNo),Author:'RUAYMANGKHANG 69 CO., LTD',Subject:'Temporary delivery order - no prices'}});
 const chunks=[];doc.on('data',c=>chunks.push(c));doc.on('end',()=>resolve(Buffer.concat(chunks)));doc.on('error',reject);
 try{
 doc.registerFont('Thai',path.join(fontDir,'Sarabun-Regular.ttf'));doc.registerFont('ThaiBold',path.join(fontDir,'Sarabun-Bold.ttf'));
 const left=36,width=doc.page.width-72,right=left+width,bottom=778;let y=36;
 const status={DRAFT:'ร่าง - ยังไม่ยืนยันส่งจริง',SENT:'ส่งสินค้าแล้ว',RECEIVED:'ปลายทางรับสินค้าแล้ว',CANCELLED:'ยกเลิกเอกสาร'}[order.Status]||text(order.Status);
 const type={CUSTOMER:'ส่งลูกค้า',CLINIC:'ส่งคลินิก',FULFILLMENT:'ส่ง Fulfillment'}[order.DeliveryType]||'';
 function write(value,x,top,w,size=11,bold=false,extra={}){doc.font(bold?'ThaiBold':'Thai').fontSize(size).fillColor('#172033').text(text(value),x,top,{width:w,lineGap:2,...extra});}
 function height(value,w,size=11,bold=false){return doc.font(bold?'ThaiBold':'Thai').fontSize(size).heightOfString(text(value),{width:w,lineGap:2});}
 function rule(top){doc.strokeColor('#cbd5e1').lineWidth(.6).moveTo(left,top).lineTo(right,top).stroke();}
 function box(values,x,top,w){const content=values.filter(Boolean).join('\n');const h=height(content,w-20)+20;doc.roundedRect(x,top,w,h,5).lineWidth(.6).strokeColor('#cbd5e1').stroke();write(content,x+10,top+10,w-20);return h;}
 function header(first){
  y=36;
  if(first){write('บริษัท รวยมั่งคั่ง 69 จำกัด',left,y,330,17,true);write('RUAYMANGKHANG 69 CO., LTD',left,y+25,330,10,true);write('99/64 หมู่ที่ 5 ตำบลบางระกำ อำเภอบางเลน\nจังหวัดนครปฐม 73130\nโทร 084-556-1349  |  เลขผู้เสียภาษี 0735566010770',left,y+43,330,10);write('ใบส่งสินค้าชั่วคราว',right-180,y+3,180,15,true,{align:'right'});write('DELIVERY ORDER',right-180,y+29,180,11,true,{align:'right'});write('เอกสารไม่แสดงราคา',right-180,y+51,180,10,false,{align:'right'});y=139;rule(y);y+=14;
   const billing=text(order.BillingAddress||order.ShippingAddress),shipping=text(order.ShippingAddress);
   const recipient=['ลูกค้า / ปลายทาง: '+text(order.DestinationName),order.BranchName?'สาขา / คลัง: '+text(order.BranchName):'', 'ที่อยู่: '+billing,billing!==shipping?'ที่อยู่จัดส่ง: '+shipping:'',order.TaxId?'เลขผู้เสียภาษี: '+text(order.TaxId):'', 'ผู้รับ: '+text(order.ContactName)+'  โทร '+text(order.Phone)];
   const meta=['เลขที่: '+text(order.DeliveryNo),'วันที่: '+deliveryDate(order.DeliveryDate),'ประเภท: '+type,'สถานะ: '+status,order.PoNo?'PO: '+text(order.PoNo):'',order.SoNo?'SO / Inbound: '+text(order.SoNo):''];
   const h1=box(recipient,left,y,310),h2=box(meta,left+320,y,width-320);y+=Math.max(h1,h2)+16;
  }else{write('ใบส่งสินค้าชั่วคราว / DELIVERY ORDER',left,y,width,14,true);write(text(order.DeliveryNo)+'  |  '+text(order.DestinationName),left,y+25,width,10);write(status,left,y+44,width,10);y+=67;rule(y);y+=12;}
 }
 const columns=[36,80,343,416,474,right];
 function tableHeader(){const heads=['ลำดับ\nITEM','รายการ\nDESCRIPTION','จำนวน\nQTY','หน่วย\nUNIT','ราคา\nPRICE'];doc.rect(left,y,width,35).fill('#eef2f7');for(let i=0;i<heads.length;i++)write(heads[i],columns[i]+6,y+5,columns[i+1]-columns[i]-12,9,true,{align:i===1?'left':'center'});doc.strokeColor('#cbd5e1').rect(left,y,width,35).stroke();y+=35;}
 function newPage(withTable=true){doc.addPage();header(false);if(withTable)tableHeader();}
 header(true);if(y+75>bottom)newPage();else tableHeader();
 for(let i=0;i<lines.length;i++){
  const l=lines[i];const detail=text(l.ProductCode)+'\n'+text(l.ProductName);const blocks=detail.split('\n');let parts=[];
  // Bound very long individual descriptions without clipping; continuation rows retain the item number.
  let part='';for(const character of Array.from(detail)){const trial=part+character;if(part&&height(trial,columns[2]-columns[1]-14)>190){parts.push(part);part=character}else part=trial;}if(part)parts.push(part);
  let first=true;for(const part of parts){const rowHeight=Math.max(32,height(part,columns[2]-columns[1]-14)+16);if(y+rowHeight>bottom)newPage();doc.strokeColor('#d7dee7').lineWidth(.5).rect(left,y,width,rowHeight).stroke();for(const x of columns.slice(1,-1))doc.moveTo(x,y).lineTo(x,y+rowHeight).stroke();write(first?String(i+1):'ต่อ',columns[0]+5,y+8,columns[1]-columns[0]-10,10,false,{align:'center'});write(part,columns[1]+7,y+7,columns[2]-columns[1]-14,11,first);write(first?Number(l.Quantity).toLocaleString('th-TH',{maximumFractionDigits:2}):'',columns[2]+5,y+8,columns[3]-columns[2]-10,11,true,{align:'right'});write(first?text(l.UOM||'-'):'',columns[3]+4,y+8,columns[4]-columns[3]-8,10,false,{align:'center'});write(first?'-':'',columns[4]+4,y+8,right-columns[4]-8,10,false,{align:'center'});y+=rowHeight;first=false;}
 }
 const remarks='หมายเหตุ: '+text(order.Note||'-');const transport=['ขนส่ง: '+text(order.Carrier||'-'),order.TrackingNo?'Tracking: '+text(order.TrackingNo):'',order.VehicleNo?'ทะเบียนรถ: '+text(order.VehicleNo):'',order.Cartons?'กล่อง / หีบห่อ: '+order.Cartons:''].filter(Boolean).join('  |  ');
 const ownership=order.Ownership==='COMPANY'?'สินค้ายังเป็นของบริษัท - ระหว่างทาง / โอนหรือฝากเก็บปลายทาง':'';
 const footerHeight=height(remarks,width)+height(transport,width,10)+height(ownership,width,10)+122;
 if(y+footerHeight>bottom)newPage(false);y+=16;write(remarks,left,y,width);y+=height(remarks,width)+10;write(transport,left,y,width,10);y+=height(transport,width,10)+8;
 write('เอกสารนี้ไม่แสดงมูลค่าสินค้า และไม่ใช่ใบกำกับภาษี',left,y,width,10);y+=20;if(ownership){write(ownership,left,y,width,10);y+=height(ownership,width,10)+8;}
 rule(y);y+=35;const signatures=[['ผู้ส่ง / DELIVERED BY',order.SentBy],['ผู้ขนส่ง / CARRIER',''],['ผู้รับ / RECEIVER',order.ReceivedBy]];for(let i=0;i<3;i++){const x=left+i*(width/3);write('ลงชื่อ __________________',x,y,width/3-8,10);write(signatures[i][0],x,y+21,width/3-8,9);if(signatures[i][1])write(signatures[i][1],x,y+36,width/3-8,9);}
 const pages=doc.bufferedPageRange();for(let i=pages.start;i<pages.start+pages.count;i++){doc.switchToPage(i);const savedBottom=doc.page.margins.bottom;doc.page.margins.bottom=0;write(text(order.DeliveryNo)+'  |  '+status,left,812,width-85,8);write('หน้า '+(i+1)+' / '+pages.count,right-80,812,80,8,false,{align:'right',lineBreak:false});doc.page.margins.bottom=savedBottom;}
 doc.end();
 }catch(error){doc.destroy();reject(error)}
});}
module.exports={createDeliveryPdf,deliveryDate};


