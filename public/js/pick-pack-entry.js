/* Optional pack-count entry for PCS picking; requests still use the stock base unit. */
(()=>{
  if(!window.WmsPacking)return;
  const quantity=()=>document.getElementById('pickQuantity');
  const originalSelect=window.selectPickingStock;
  window.selectPickingStock=function(...args){
    originalSelect.apply(this,args);
    const input=quantity();
    if(pickType==='PKG'||pickType==='SEMI'){
      if(pickSelected&&!pickingCondition(pickSelected))WmsPacking.mount(input,pickSelected.ProductId);
      else WmsPacking.clear(input);
    }else WmsPacking.clear(input);
  };
  const originalReset=window.resetPickingSelection;
  window.resetPickingSelection=function(...args){
    WmsPacking.clear(quantity());
    return originalReset.apply(this,args);
  };
  const originalFGLocation=window.openFGLocation;
  window.openFGLocation=async function(...args){
    await originalFGLocation.apply(this,args);
    const input=document.getElementById('fgPickQuantity');
    if(input)WmsPacking.clear(input);
  };
  const originalCloseFG=window.closeFGPickDialog;
  window.closeFGPickDialog=function(...args){
    const input=document.getElementById('fgPickQuantity');
    if(input)WmsPacking.clear(input);
    return originalCloseFG.apply(this,args);
  };
})();
