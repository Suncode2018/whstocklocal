'use strict';

const PDFDocument=require('pdfkit');
const QRCode=require('qrcode');
const path=require('node:path');

const clean=value=>String(value??'').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g,'');
const fmt=value=>Number(value||0).toLocaleString('th-TH',{maximumFractionDigits:6});
const issuePickedQuantity=line=>{const quantity=Number(line?.PickedQuantity||0);return Number.isFinite(quantity)&&quantity>0?fmt(quantity):''};
const dateText=value=>{
 const date=value?new Date(value):new Date();
 return Number.isNaN(date.getTime())?'':date.toLocaleDateString('th-TH',{day:'2-digit',month:'2-digit',year:'numeric'});
};
const revisionDateText=value=>{
 const date=value?new Date(value):new Date('2024-10-02T00:00:00Z');
 return Number.isNaN(date.getTime())?'':`${String(date.getUTCDate()).padStart(2,'0')}.${String(date.getUTCMonth()+1).padStart(2,'0')}.${String(date.getUTCFullYear()).slice(-2)}`;
};

async function createProductionIssuePdf(progress){
 const qrBuffer=await QRCode.toBuffer(clean(progress.document.IssueNo),{type:'png',errorCorrectionLevel:'M',margin:1,width:240});
 return new Promise((resolve,reject)=>{
  const {document:d,lines=[]}=progress;
  const formCompany=d.FormCompanyNameSnapshot||d.CompanyName||'บริษัท รวยมั่งคั่ง 69 จำกัด';
  const formTitle=d.FormDocumentTitleSnapshot||d.DocumentTitle||'ใบเบิกสินค้าเพื่อผลิต';
  const formCode=d.FormCodeSnapshot||d.FormCode||'FR-PD-02';
  const formRevision=d.FormRevisionSnapshot||d.FormRevision||'Rev.00';
  const formRevisionDate=revisionDateText(d.FormEffectiveDateSnapshot||d.EffectiveDate);
  const doc=new PDFDocument({size:'A4',margins:{top:30,bottom:38,left:34,right:34},bufferPages:true,info:{Title:'ใบเบิกสินค้าเพื่อผลิต '+clean(d.IssueNo),Author:'WH Stock System'}});
  const chunks=[];
  doc.on('data',chunk=>chunks.push(chunk));
  doc.on('end',()=>resolve(Buffer.concat(chunks)));
  doc.on('error',reject);

  try{
   const fonts=path.join(__dirname,'../assets/fonts');
   doc.registerFont('Thai',path.join(fonts,'Sarabun-Regular.ttf'));
   doc.registerFont('ThaiBold',path.join(fonts,'Sarabun-Bold.ttf'));
   const left=34,right=doc.page.width-34,width=right-left,bottom=doc.page.height-43;
   let y=30;
   const ink='#000000',muted='#000000',line='#000000',pale='#ffffff';
   const text=(value,x,top,w,size=9,bold=false,extra={})=>doc.font(bold?'ThaiBold':'Thai').fontSize(size).fillColor(extra.color||ink).text(clean(value),x,top,{width:w,lineGap:1,...extra});
   const rule=(x1,y1,x2,y2,color=line,thickness=.6)=>doc.strokeColor(color).lineWidth(thickness).moveTo(x1,y1).lineTo(x2,y2).stroke();

   function field(label,value,x,top,w,{size=8,valueSize=9,bold=false,align='left'}={}){
    text(label,x+6,top+4,w-12,7,true,{color:muted});
    text(value||'________________',x+6,top+17,w-12,valueSize,bold,{align});
   }
   function firstPageHeader(){
    text(formCompany,left,y,width,12,true,{align:'center'});y+=20;
    text(formTitle,left,y,width,12,true,{align:'center'});y+=25;
    const metaH=57,firstW=width*.70,docW=width-firstW;
    doc.rect(left,y,firstW,metaH).fillAndStroke('#ffffff','#000000');
    doc.rect(left+firstW,y,docW,metaH).fillAndStroke('#ffffff','#000000');
    field('เลขที่อ้างอิง MO','',left,y,firstW*.38);
    field('รหัสสูตรการผลิต',d.FGProductCode,left+firstW*.38,y,firstW*.25,{bold:true});
    field('ชื่อสูตรการผลิต',d.FGProductName,left+firstW*.63,y,firstW*.37,{valueSize:8,bold:true});
    const issueCellX=left+firstW,qrSize=40,issueTextWidth=docW-qrSize-18;
    text('เลขที่เอกสารใบเบิก',issueCellX+6,y+4,issueTextWidth,7,true);
    text(d.IssueNo,issueCellX+6,y+20,issueTextWidth,8,false);
    doc.image(qrBuffer,right-45,y+8,{width:qrSize,height:qrSize});
    y+=metaH;
    const subH=25,lotW=width*.58,dateW=width-lotW;
    doc.rect(left,y,lotW,subH).fillAndStroke('#ffffff','#000000');
    doc.rect(left+lotW,y,dateW,subH).fillAndStroke('#ffffff','#000000');
    text('Batch / Lot No. ______________________________',left+6,y+6,lotW-12,8);
    text('วัน เดือน ปี  '+dateText(d.CreatedAt),left+lotW+6,y+6,dateW-12,8);
    y+=subH+10;
   }
   function continuationHeader(){
    text('ใบเบิกสินค้าเพื่อผลิต · '+d.IssueNo,left,y,width,10,true);y+=19;
   }

   const widths=[24,80,166,55,43,74,width-24-80-166-55-43-74];
   const xs=[left];for(const colWidth of widths)xs.push(xs[xs.length-1]+colWidth);
   function tableHeader(){
    const labels=['ลำดับที่','รหัสสินค้า','ชื่อสินค้า','จำนวน','หน่วยนับ','ANA No.','หมายเหตุ'];
    const headH=30;
    doc.rect(left,y,width,headH).fillAndStroke('#ffffff','#000000');
    for(let i=0;i<labels.length;i++){
     const centered=i===0||i===3||i===4||i===5;
     text(labels[i],xs[i]+3,y+8,widths[i]-6,7.5,true,{align:centered?'center':'left'});
     if(i>0)rule(xs[i],y,xs[i],y+headH,'#000000',.5);
    }
    y+=headH;
   }

   firstPageHeader();tableHeader();
   for(const [index,item] of lines.entries()){
    const name=clean(item.ProductName);
    const nameHeight=doc.font('Thai').fontSize(8.5).heightOfString(name,{width:widths[2]-10,lineGap:1});
    const rowH=Math.max(40,nameHeight+14);
    if(y+rowH>bottom-85){doc.addPage();y=30;continuationHeader();tableHeader();}
    doc.rect(left,y,width,rowH).fillAndStroke('#ffffff','#000000');
    for(let i=1;i<xs.length-1;i++)rule(xs[i],y,xs[i],y+rowH,'#000000',.5);
    text(index+1,xs[0]+2,y+8,widths[0]-4,8,false,{align:'center'});
    text(item.ProductCode,xs[1]+5,y+8,widths[1]-10,8,true);
    text(name,xs[2]+5,y+7,widths[2]-10,8.5,false);
    text(issuePickedQuantity(item),xs[3]+2,y+8,widths[3]-4,8,false,{align:'center'});
    text(item.UnitCode,xs[4]+2,y+8,widths[4]-4,7.5,false,{align:'center'});
    // ANA/LOT is left blank for the warehouse to record the actual lot issued.
    y+=rowH;
   }

   y+=14;
   const signH=94;
   if(y+signH>bottom){doc.addPage();y=30;continuationHeader();}
   const prodW=width*.42,warehouseW=width-prodW;
   doc.rect(left,y,prodW,signH).fillAndStroke('#ffffff','#000000');
   doc.rect(left+prodW,y,warehouseW,signH).fillAndStroke('#ffffff','#000000');
   doc.rect(left,y,prodW,20).fillAndStroke(pale,'#000000');
   doc.rect(left+prodW,y,warehouseW,20).fillAndStroke(pale,'#000000');
   text('ผลิต',left,y+4,prodW,9,true,{align:'center'});
   text('คลังสินค้า',left+prodW,y+4,warehouseW,9,true,{align:'center'});
   const prodCell=prodW/2,whCell=warehouseW/3;
   const prodRoles=['ผู้ส่ง','ผู้อนุมัติ'];
   for(let i=0;i<2;i++){
    const x=left+i*prodCell;
    if(i)rule(x,y+20,x,y+signH,'#000000',.5);
    text(prodRoles[i],x+3,y+27,prodCell-6,8,true,{align:'center'});
    rule(x+10,y+57,x+prodCell-10,y+57,'#000000',.5);
    text('วันที่ ______________',x+5,y+65,prodCell-10,7.5,false,{align:'center'});
   }
   const whRoles=['ผู้รับสินค้า','ผู้จ่ายสินค้า','ผู้อนุมัติ'];
   for(let i=0;i<3;i++){
    const x=left+prodW+i*whCell;
    if(i)rule(x,y+20,x,y+signH,'#000000',.5);
    text(whRoles[i],x+3,y+27,whCell-6,8,true,{align:'center'});
    rule(x+8,y+57,x+whCell-8,y+57,'#000000',.5);
    text('วันที่ __________',x+3,y+65,whCell-6,7,false,{align:'center'});
   }
   y+=signH+5;
   text(formCode,left,y,width*.5,7,false,{color:muted});
   text(`${formRevision} · ${formRevisionDate}`,right-width*.5,y,width*.5,7,false,{align:'right',color:muted});

   const pages=doc.bufferedPageRange();
   for(let i=0;i<pages.count;i++){
    doc.switchToPage(i);doc.page.margins.bottom=10;
    doc.font('Thai').fontSize(7).fillColor(muted).text(`หน้า ${i+1} / ${pages.count}`,right-62,doc.page.height-27,{width:62,align:'right',lineBreak:false});
   }
   doc.end();
  }catch(error){doc.destroy();reject(error);}
 });
}

module.exports={createProductionIssuePdf,issuePickedQuantity};
