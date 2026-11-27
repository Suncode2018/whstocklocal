'use strict';

const categoryType=value=>{
 const category=String(value||'').toUpperCase();
 if(['PKG','PACK'].includes(category))return'PKG';
 if(['SEMI','SFG'].includes(category))return'SEMI';
 if(category==='RM')return'RM';
 return'';
};
const statusFor=(doc,lines)=>{
 if(doc.Status==='CANCELLED')return'CANCELLED';
 if(lines.length&&lines.every(line=>Number(line.PickedQuantity)+0.000001>=Number(line.RequiredQuantity)))return'ISSUED';
 if(lines.some(line=>Number(line.PickedQuantity)>0))return'PARTIAL';
 return'DRAFT';
};
const workflowFor=status=>{
 const cancelled=status==='CANCELLED',started=status==='PARTIAL'||status==='ISSUED',complete=status==='ISSUED';
 const steps=[
  {code:'CREATED',label:'สร้างใบเบิก',state:'DONE'},
  {code:'WAITING',label:'รอเบิก',state:cancelled?'SKIPPED':started?'DONE':'CURRENT'},
  {code:'PICKING',label:'กำลังเบิก',state:cancelled?'SKIPPED':complete?'DONE':started?'CURRENT':'PENDING'},
  {code:'COMPLETED',label:'เบิกครบแล้ว',state:cancelled?'SKIPPED':complete?'DONE':'PENDING'}
 ];
 return{status:cancelled?'CANCELLED':complete?'COMPLETED':started?'PICKING':'WAITING',label:cancelled?'ยกเลิก':complete?'เบิกครบแล้ว':started?'กำลังเบิก':'รอเบิก',nextAction:cancelled||complete?null:'PICK',steps};
};

async function loadProgress(request,sql,doc){
 const query=request().input('Issue',sql.Int,doc.IssueId).input('IssueNo',sql.NVarChar(40),doc.IssueNo);
 const lines=(await query.query(`
  SELECT IssueLineId,[LineNo],ProductId,ProductCode,ProductName,CategoryCode,RequiredQuantity,UnitCode
  FROM dbWMS.dbo.ProductionIssueLines WHERE IssueId=@Issue ORDER BY [LineNo];
  SELECT ProductId,PickType,SUM(Quantity) AS PickedQuantity
  FROM dbWMS.dbo.PickOperations WHERE ReferenceNo=@IssueNo
  GROUP BY ProductId,PickType;
  SELECT o.PickId,o.PickNo,o.PickType,o.WhId,w.whname,o.ProductId,p.ProductCode,p.ProductName,o.FromLocationCode,o.Quantity,o.CreatedBy,o.CreatedAt
  FROM dbWMS.dbo.PickOperations o
  LEFT JOIN dbMaster.dbo.tblWH w ON w.whid=o.WhId
  LEFT JOIN dbMaster.dbo.tblProducts p ON p.ProductId=o.ProductId
  WHERE o.ReferenceNo=@IssueNo ORDER BY o.PickId`)).recordsets;
 const picked=new Map();
 for(const row of lines[1]){
  const key=`${row.ProductId}|${categoryType(row.PickType)}`;
  if(!picked.has(key))picked.set(key,0);
  picked.set(key,picked.get(key)+Number(row.PickedQuantity||0));
 }
 const remaining=new Map(picked),result=[];
 for(const line of lines[0]){
  const key=`${line.ProductId}|${categoryType(line.CategoryCode)}`,qty=remaining.get(key)||0,allocated=Math.min(Number(line.RequiredQuantity),qty);
  remaining.set(key,Math.max(0,qty-allocated));
  result.push({...line,PickedQuantity:allocated,RemainingQuantity:Math.max(0,Number(line.RequiredQuantity)-allocated)});
 }
 const fulfillmentStatus=statusFor(doc,result),progress={document:{...doc,FulfillmentStatus:fulfillmentStatus},workflow:workflowFor(fulfillmentStatus),lines:result,picks:lines[2]};
 const byUnit=new Map();for(const line of result){const unit=String(line.UnitCode||'');const totals=byUnit.get(unit)||{unit,requiredQuantity:0,pickedQuantity:0,remainingQuantity:0};totals.requiredQuantity+=Number(line.RequiredQuantity);totals.pickedQuantity+=Number(line.PickedQuantity);totals.remainingQuantity+=Number(line.RemainingQuantity);byUnit.set(unit,totals)}
 progress.summary={lineCount:result.length,completeCount:result.filter(x=>x.RemainingQuantity<=0.000001).length,byUnit:[...byUnit.values()]};
 return progress;
}

async function validateIssuePick(request,sql,{referenceNo,whid,pickType,lines}){
 const ref=String(referenceNo||'').trim();
 if(!/^PRD-ISS-/i.test(ref))return null;
 const doc=(await request().input('No',sql.NVarChar(40),ref).query('SELECT * FROM dbWMS.dbo.ProductionIssueRequests WITH(UPDLOCK,HOLDLOCK) WHERE IssueNo=@No')).recordset[0];
 if(!doc)throw Object.assign(new Error('ไม่พบใบขอเบิกผลิต '+ref),{status:404});
 if(doc.Status==='CANCELLED')throw Object.assign(new Error('ใบขอเบิกนี้ถูกยกเลิกแล้ว'),{status:409});
 if(!(JSON.parse(doc.WarehouseIdsJson||'[]').map(Number)).includes(Number(whid)))throw Object.assign(new Error('คลังที่เลือกไม่ได้อยู่ในใบขอเบิกนี้'),{status:403});
 const progress=await loadProgress(request,sql,doc),expected=categoryType(pickType),required=new Map();
 for(const line of progress.lines){
  const type=categoryType(line.CategoryCode);
  if(type!==expected)continue;
  const current=required.get(line.ProductId)||{required:0,picked:0,code:line.ProductCode};
  current.required+=Number(line.RequiredQuantity);current.picked+=Number(line.PickedQuantity);required.set(line.ProductId,current);
 }
 const totals=new Map();for(const line of lines)totals.set(line.productId,(totals.get(line.productId)||0)+Number(line.quantity));
 for(const [productId,quantity] of totals){
  const line=required.get(productId);
  if(!line)throw Object.assign(new Error('สินค้า '+productId+' ไม่อยู่ในใบขอเบิกนี้ หรือประเภทสินค้าไม่ตรง'),{status:409});
  if(quantity>line.required-line.picked+0.000001)throw Object.assign(new Error(`${line.code} เบิกเกินยอดคงเหลือในใบขอเบิก (${Math.max(0,line.required-line.picked)} คงเหลือ)`),{status:409});
 }
 return doc;
}

module.exports={categoryType,loadProgress,validateIssuePick,workflowFor};
