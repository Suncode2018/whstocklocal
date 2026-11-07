const fail=(status,message)=>{throw Object.assign(Error(message),{status})};
function scaled(v){const s=typeof v==='number'?v.toFixed(6):String(v);if(!/^\d{1,12}(?:\.\d{1,6})?$/.test(s))fail(400,'จำนวนต้องเป็นบวก ทศนิยมไม่เกิน 6 ตำแหน่ง');const[a,b='']=s.split('.');return BigInt(a)*1000000n+BigInt(b.padEnd(6,'0'))}
function baseAmount(q,spec,whole=false){const n=scaled(q)*scaled(spec.BasePerContentUnit)*(whole?scaled(spec.ContentPerPack):1n),d=whole?10000000000000000n:10000000000n;if(n%d!==0n)fail(400,'จำนวนนี้แปลงเป็นหน่วยสต๊อกไม่ได้พอดี ระบบสต๊อกรองรับทศนิยม 2 ตำแหน่ง');const cents=n/d;if(cents<=0n||cents>999999999999999999n)fail(400,'จำนวนในหน่วยสต๊อกไม่ถูกต้อง');return String(cents/100n)+'.'+String(cents%100n).padStart(2,'0')}
module.exports={scaled,baseAmount};
