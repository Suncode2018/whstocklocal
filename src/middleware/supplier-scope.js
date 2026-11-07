const nav=require('./navigation'),{catalog}=require('../config/navigation');
const types=value=>[...new Set(String(value||'').split(',').map(x=>x.trim().toUpperCase()).filter(Boolean))];
function can(req,type,action='VIEW'){const n=req.navigation;if(n?.user.Role==='ADMIN')return true;if(action==='VIEW'&&n&&!n.profile.DESKTOP.some(c=>c.startsWith('SUPPLIERS'))&&nav.hasAction(n.profile,n.mode,'RECEIVE_'+type,'VIEW'))return true;const c=catalog.find(m=>m.scopeParent==='SUPPLIERS'&&m.categoryCode===type);return !!n&&!!c&&nav.hasAction(n.profile,n.mode,c.code,action)}
function allowed(req,row,action='VIEW'){const list=types(row.SupplyTypes);return list.length>0&&(action==='VIEW'?list.some(t=>can(req,t,action)):list.every(t=>can(req,t,action)))}
function visible(req,row){const n=req.navigation;if(n?.user.Role==='ADMIN')return true;if(allowed(req,row))return true;return false}
module.exports={types,can,allowed,visible};
