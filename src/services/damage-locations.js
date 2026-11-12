const isAdmin=req=>String(req.user?.role||req.navigation?.user?.Role||'').toUpperCase()==='ADMIN';
// Permit is bound to this SQL transaction, never to a reusable pooled connection alone.
async function authorize(q,req){await q().input('DamageAdmin',require('../config/db').sql.Bit,isAdmin(req)?1:0).query(`
 DECLARE @Tx bigint; SELECT @Tx=transaction_id FROM sys.dm_tran_current_transaction;
 UPDATE dbWMS.dbo.DamageStockPermits WITH(UPDLOCK,HOLDLOCK) SET TransactionId=@Tx,CanWithdraw=@DamageAdmin,CanDeposit=1 WHERE SessionId=@@SPID;
 IF @@ROWCOUNT=0 INSERT dbWMS.dbo.DamageStockPermits VALUES(@@SPID,@Tx,@DamageAdmin,1);`);}
module.exports={isAdmin,authorize};
