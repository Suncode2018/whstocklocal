USE dbWMS;
SET XACT_ABORT ON;
IF OBJECT_ID('dbo.DamageStockPermits','U') IS NULL
 CREATE TABLE dbo.DamageStockPermits(SessionId int PRIMARY KEY,TransactionId bigint NOT NULL,CanWithdraw bit NOT NULL,CanDeposit bit NOT NULL);
EXEC(N'CREATE OR ALTER TRIGGER dbo.TR_Stock_DamageGuard ON dbo.tblStock AFTER INSERT,UPDATE,DELETE AS
BEGIN
 SET NOCOUNT ON;
 DECLARE @Withdraw bit=0,@Deposit bit=0,@Tx bigint;
 SELECT @Tx=transaction_id FROM sys.dm_tran_current_transaction;
 SELECT @Withdraw=CanWithdraw,@Deposit=CanDeposit FROM dbo.DamageStockPermits WHERE SessionId=@@SPID AND TransactionId=@Tx;
 IF ISNULL(@Withdraw,0)=0 AND EXISTS(
 SELECT 1 FROM deleted d JOIN dbMaster.dbo.Locations l ON l.whid=d.whid AND l.LocationCode=d.LocationCode AND UPPER(l.Zone)=''DAMAGE''
 LEFT JOIN inserted i ON i.StockId=d.StockId
 WHERE d.Quantity<>0 AND (i.StockId IS NULL OR i.Quantity<d.Quantity OR i.whid<>d.whid OR i.ProductId<>d.ProductId OR i.LocationCode<>d.LocationCode))
 THROW 51070,N''สินค้าในโลเคชั่น DAMAGE นำออกหรือปรับลดได้เฉพาะ ADMIN'',1;
 IF ISNULL(@Withdraw,0)=0 AND ISNULL(@Deposit,0)=0 AND EXISTS(
 SELECT 1 FROM inserted i JOIN dbMaster.dbo.Locations l ON l.whid=i.whid AND l.LocationCode=i.LocationCode AND UPPER(l.Zone)=''DAMAGE''
 LEFT JOIN deleted d ON d.StockId=i.StockId WHERE i.Quantity<>ISNULL(d.Quantity,0))
 THROW 51070,N''รายการ DAMAGE ต้องย้ายเข้าผ่านเมนูโอนย้าย หรือให้ ADMIN จัดการ'',1;
END');
