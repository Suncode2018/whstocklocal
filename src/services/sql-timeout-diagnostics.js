// Read-only diagnostics; do not cancel sessions or change server settings.
let lastCapture=0;
module.exports=function(poolPromise,label,error){
 if(error?.code!=='ETIMEOUT'||Date.now()-lastCapture<60000)return;
 lastCapture=Date.now();
 Promise.resolve(poolPromise).then(async pool=>{
 const request=pool.request();request.timeout=3000;
 const result=await request.query(`SELECT r.session_id,r.status,r.blocking_session_id,r.wait_type,r.wait_time,r.open_transaction_count,DB_NAME(r.database_id) AS DatabaseName,m.requested_memory_kb,m.granted_memory_kb
 FROM sys.dm_exec_requests r JOIN sys.dm_exec_sessions u ON u.session_id=r.session_id AND u.is_user_process=1 LEFT JOIN sys.dm_exec_query_memory_grants m ON m.session_id=r.session_id WHERE r.session_id<>@@SPID AND (r.blocking_session_id<>0 OR r.wait_type IS NOT NULL);
 SELECT session_id,status,open_transaction_count,host_name,program_name FROM sys.dm_exec_sessions WHERE is_user_process=1 AND open_transaction_count>0 AND session_id<>@@SPID;`);
 console.warn('SQL timeout diagnostics',JSON.stringify({endpoint:label,capturedAt:new Date().toISOString(),waitingRequests:result.recordsets[0],openTransactions:result.recordsets[1]}));
 }).catch(e=>console.warn('SQL timeout diagnostics unavailable:',e.code||'UNKNOWN'));
};
