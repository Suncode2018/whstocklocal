/* Run AFTER ResetProduct_T588880095.sql completes. Retains product and audit history. */
USE dbMaster;
SET NOCOUNT ON;
SET XACT_ABORT ON;
DECLARE @Execute bit=0;
DECLARE @Confirmation nvarchar(100)=N'';
DECLARE @Code nvarchar(50)=N'T588880095',@P int,@Run uniqueidentifier=NEWID(),@Json nvarchar(max),@N int;
IF @@TRANCOUNT<>0 THROW 51000,N'Use a new query window without an existing transaction.',1;
IF @Execute=1 AND @Confirmation<>N'RESET-PACK:T588880095' THROW 51000,N'Confirmation mismatch.',1;
BEGIN TRY
 BEGIN TRAN;
 IF (SELECT COUNT(*) FROM dbo.tblProducts WITH(UPDLOCK,HOLDLOCK) WHERE ProductCode=@Code)<>1
 THROW 51000,N'Expected exactly one product.',1;
 SELECT @P=ProductId FROM dbo.tblProducts WHERE ProductCode=@Code;
 DECLARE @Blocked bit=0;
 IF EXISTS(SELECT 1 FROM dbWMS.dbo.tblStock WITH(UPDLOCK,HOLDLOCK) WHERE ProductId=@P AND Quantity<>0)
 SET @Blocked=1;
 IF EXISTS(SELECT 1 FROM dbWMS.dbo.InboundLines WITH(UPDLOCK,HOLDLOCK) WHERE ProductId=@P)
 OR EXISTS(SELECT 1 FROM dbWMS.dbo.DeliveryLines WITH(UPDLOCK,HOLDLOCK) WHERE ProductId=@P)
 SET @Blocked=1;
 IF OBJECT_ID(N'dbo.tblProductPalletVersions',N'U') IS NOT NULL
 BEGIN
 DECLARE @Used bit;
 EXEC sys.sp_executesql N'SELECT @B=CASE WHEN EXISTS(SELECT 1 FROM dbo.tblProductPalletVersions WITH(UPDLOCK,HOLDLOCK) WHERE ProductId=@P) THEN 1 ELSE 0 END',N'@P int,@B bit OUTPUT',@P,@Used OUTPUT;
 IF @Used=1 SET @Blocked=1;
 END;
 SELECT @N=COUNT(*),@Json=NULL FROM dbo.tblProductPackVersions WITH(UPDLOCK,HOLDLOCK) WHERE ProductId=@P;
 SELECT @Json=(SELECT * FROM dbo.tblProductPackVersions WHERE ProductId=@P FOR JSON PATH,INCLUDE_NULL_VALUES);
 SELECT @@SERVERNAME ServerName,DB_NAME() DatabaseName,@Code ProductCode,@P ProductId,@Execute ExecuteMode,1-CAST(@Blocked AS int) CanExecute,@N RowsToDelete;
 SELECT * FROM dbo.tblProductPackVersions WHERE ProductId=@P ORDER BY VersionNo;
 IF @Execute=0 BEGIN ROLLBACK; RETURN; END;
 IF @Blocked=1 THROW 51000,N'Stock, receipt, delivery or pallet references remain. Complete product reset first.',1;
 IF OBJECT_ID(N'dbo.ProductPackResetBackup',N'U') IS NULL
 CREATE TABLE dbo.ProductPackResetBackup(RunId uniqueidentifier NOT NULL PRIMARY KEY,ProductId int NOT NULL,ProductCode nvarchar(50) NOT NULL,RowsJson nvarchar(max) NOT NULL,Actor nvarchar(128) NOT NULL,CreatedAt datetime2 NOT NULL DEFAULT SYSUTCDATETIME());
 INSERT dbo.ProductPackResetBackup(RunId,ProductId,ProductCode,RowsJson,Actor) VALUES(@Run,@P,@Code,COALESCE(@Json,N'[]'),ORIGINAL_LOGIN());
 DELETE FROM dbo.tblProductPackVersions WHERE ProductId=@P;
 IF @@ROWCOUNT<>@N THROW 51000,N'Row count changed.',1;
 COMMIT;
 SELECT @Run BackupRunId,@Code ProductCode,N'Pack versions reset complete' Result;
END TRY
BEGIN CATCH
 IF @@TRANCOUNT>0 ROLLBACK;
 THROW;
END CATCH;