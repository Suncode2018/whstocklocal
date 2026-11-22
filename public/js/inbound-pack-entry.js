/* Pack-count helper for PCS receipts; quantity and price remain in the master stock unit. */
(()=>{
  if(!window.WmsPacking)return;
  const input=()=>document.getElementById('inboundQuantity');
  const originalShow=window.showInboundFgUnit;
  window.showInboundFgUnit=function(...args){
    const result=originalShow.apply(this,args);
    const qty=input();
    const isPackGroup=inboundType==='PKG'||inboundType==='SEMI'||inboundType==='FG'&&inboundSourceMode!=='PRODUCTION';
    const code=document.getElementById('inboundProduct').value.trim().toLowerCase();
    const product=inboundMaster?.products.find(p=>p.ReceiveType===inboundType&&(String(p.ProductCode).toLowerCase()===code||p.Barcode&&String(p.Barcode).toLowerCase()===code));
    if(isPackGroup&&product)WmsPacking.mount(qty,product.ProductId,document.getElementById('inboundDocumentDate').value||undefined);
    else if(!(inboundType==='FG'&&inboundSourceMode==='PRODUCTION'))WmsPacking.clear(qty);
    return result;
  };
  const originalAdd=window.addInboundLine;
  window.addInboundLine=function(...args){
    const count=inboundDraft.length,entry=WmsPacking.describe(input());
    const result=originalAdd.apply(this,args);
    if(inboundDraft.length>count){
      if(entry){inboundDraft[inboundDraft.length-1].packEntry=entry;renderInboundDraft();}
      WmsPacking.clear(input());
    }
    return result;
  };
  const originalClose=window.closeInboundForm;
  window.closeInboundForm=function(...args){
    WmsPacking.clear(input());
    return originalClose.apply(this,args);
  };
})();
