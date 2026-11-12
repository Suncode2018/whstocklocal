-- Specific corrective reversal requested by the user. Does not delete history.
USE dbWMS;
SET XACT_ABORT ON;
DECLARE @Execute bit=0; -- 0 = validate and roll back; 1 = commit
BEGIN TRY
 BEGIN TRANSACTION;
 DECLARE @P int=2493,@I int=145,@Ref nvarchar(60)=N'RCV-FG-49E69431-BB24-4FEB';
 IF NOT EXISTS(SELECT 1 FROM dbMaster.dbo.tblProducts WITH(UPDLOCK,HOLDLOCK) WHERE ProductId=@P AND ProductCode=N'T588880024') THROW 51000,'Product identity mismatch',1;
 SELECT whid FROM dbMaster.dbo.tblWH WITH(UPDLOCK,HOLDLOCK) WHERE whid=1;
 IF NOT EXISTS(SELECT 1 FROM dbo.InboundOrders WITH(UPDLOCK,HOLDLOCK) WHERE InboundId=@I AND ReceiveNo=@Ref AND IsCancelled=0 AND WhId=1) THROW 51000,'Receipt not eligible or already cancelled',1;
 IF EXISTS(SELECT 1 FROM dbo.InboundLines WHERE InboundId=@I AND ProductId<>@P) THROW 51000,'Mixed-product receipt; abort',1;
 IF (SELECT SUM(r.Quantity) FROM dbo.InboundReceipts r JOIN dbo.InboundLines l ON l.LineId=r.LineId WHERE l.InboundId=@I)<>18440 THROW 51000,'Receipt quantity changed',1;
 IF EXISTS(SELECT 1 FROM dbo.tblStockTransactions WITH(UPDLOCK,HOLDLOCK) WHERE ProductId=@P AND TransId>612) THROW 51000,'New activity exists; review again',1;
 IF (SELECT SUM(Quantity) FROM dbo.tblStock WITH(UPDLOCK,HOLDLOCK) WHERE ProductId=@P)<>28720 THROW 51000,'Stock total changed',1;
 SELECT h.PlanId,h.PlanNo,l.ToLocationCode,l.MovedQuantity INTO #Plans FROM dbo.StoragePlans h JOIN dbo.StoragePlanLines l ON l.PlanId=h.PlanId JOIN dbo.InboundReceipts r ON r.ReceiptId=h.InboundReceiptId JOIN dbo.InboundLines il ON il.LineId=r.LineId WHERE il.InboundId=@I AND h.Status='COMPLETED';
 IF (SELECT COUNT(*) FROM #Plans)<>7 OR (SELECT SUM(MovedQuantity) FROM #Plans)<>18440 THROW 51000,'Downstream plan scope changed',1;
 SELECT ToLocationCode,SUM(MovedQuantity) Quantity INTO #Reverse FROM #Plans GROUP BY ToLocationCode;
 IF EXISTS(SELECT 1 FROM #Reverse r LEFT JOIN dbo.tblStock s ON s.whid=1 AND s.ProductId=@P AND s.LocationCode=r.ToLocationCode WHERE s.Quantity IS NULL OR s.Quantity<r.Quantity) THROW 51000,'Destination stock insufficient',1;
 DECLARE @Snapshot nvarchar(max)=(SELECT (SELECT * FROM dbo.tblStock WHERE ProductId=@P FOR JSON PATH) StockBefore,(SELECT * FROM dbo.tblStockTransactions WHERE ProductId=@P FOR JSON PATH) TransactionsBefore,(SELECT * FROM dbo.InboundOrders WHERE InboundId=@I FOR JSON PATH) InboundBefore,(SELECT h.*,l.LineId,l.ToLocationCode,l.Quantity,l.MovedQuantity FROM dbo.StoragePlans h JOIN dbo.StoragePlanLines l ON l.PlanId=h.PlanId WHERE h.ProductId=@P FOR JSON PATH) PlansBefore FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);
 IF OBJECT_ID('dbo.InboundCorrectionBackup','U') IS NULL CREATE TABLE dbo.InboundCorrectionBackup(Id int IDENTITY PRIMARY KEY,InboundId int NOT NULL,ProductId int NOT NULL,Reason nvarchar(500) NOT NULL,SnapshotJson nvarchar(max) NOT NULL,CreatedAt datetime2 NOT NULL DEFAULT SYSDATETIME());
 INSERT dbo.InboundCorrectionBackup(InboundId,ProductId,Reason,SnapshotJson) VALUES(@I,@P,N'User requested reversal of receipt before product consolidation',@Snapshot);
 UPDATE s SET Quantity=s.Quantity-r.Quantity,UpdatedAt=SYSDATETIME() FROM dbo.tblStock s JOIN #Reverse r ON r.ToLocationCode=s.LocationCode WHERE s.whid=1 AND s.ProductId=@P;
 INSERT dbo.tblStockTransactions(TransType,whid,ProductId,LocationCode,QtyChange,QtyAfter,RefDocNo,Remark,CreatedBy,CreatedAt) SELECT N'RECEIVE_CANCEL',1,@P,r.ToLocationCode,-r.Quantity,s.Quantity,@Ref,N'ย้อนใบรับและยอดจัดเก็บเฉพาะใบ 145 ตามคำขอผู้ใช้; คงยอดตั้งต้น',N'admin',SYSDATETIME() FROM #Reverse r JOIN dbo.tblStock s ON s.whid=1 AND s.ProductId=@P AND s.LocationCode=r.ToLocationCode;
 UPDATE h SET Status='CANCELLED' FROM dbo.StoragePlans h WHERE h.PlanId IN(SELECT PlanId FROM #Plans);
 UPDATE dbo.InboundOrders SET IsCancelled=1,CancelledBy=N'admin',CancelledAt=SYSDATETIME(),CancelReason=N'ย้อนใบรับสินค้า T588880024 ก่อนรวมรหัสสินค้า ตามคำขอผู้ใช้; ไม่กระทบยอดตั้งต้น' WHERE InboundId=@I;
 INSERT dbo.InboundCancelAudit(InboundId,Reason,CancelledBy,ReceiptSnapshot) SELECT @I,N'Corrective reversal after putaway; snapshot in InboundCorrectionBackup',N'admin',(SELECT r.*,l.ProductId FROM dbo.InboundReceipts r JOIN dbo.InboundLines l ON l.LineId=r.LineId WHERE l.InboundId=@I FOR JSON PATH);
 IF (SELECT SUM(Quantity) FROM dbo.tblStock WHERE ProductId=@P)<>10280 THROW 51000,'Final stock reconciliation failed',1;
 SELECT @Execute ExecuteMode,N'T588880024' ProductCode,18440 ReversedReceiptQuantity,10280 RemainingOpeningBalance;
 SELECT whid,LocationCode,Quantity FROM dbo.tblStock WHERE ProductId=@P AND Quantity<>0;
 IF @Execute=1 COMMIT; ELSE ROLLBACK;
END TRY
BEGIN CATCH
 IF @@TRANCOUNT>0 ROLLBACK;
 THROW;
END CATCH;
