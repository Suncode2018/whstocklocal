/*
  Safely clear the receiving lines for ONE ReceiveId.
  This removes linked CN lines, CN headers, and shortage reports first,
  then removes ReceiveOrderLines. The ReceiveOrders header is preserved.

  1) Set @ReceiveId to the ReceiveId shown by the preview query.
  2) Run once with @Execute = 0 to review the target.
  3) Set @Execute = 1 and run again to perform the delete.
*/
SET NOCOUNT ON;
SET XACT_ABORT ON;

DECLARE @ReceiveId INT = NULL; -- TODO: enter ReceiveId, e.g. 12
DECLARE @Execute BIT = 0;      -- 0 = preview only; 1 = execute delete

IF @ReceiveId IS NULL
  THROW 50001, 'Set @ReceiveId to the receiving record you intend to clear.', 1;

IF NOT EXISTS (SELECT 1 FROM dbo.ReceiveOrders WHERE ReceiveId = @ReceiveId)
  THROW 50002, 'ReceiveId was not found in dbo.ReceiveOrders.', 1;

SELECT o.ReceiveId, o.ReceiveNo, o.PONumber, o.Status,
  (SELECT COUNT(*) FROM dbo.ReceiveOrderLines l WHERE l.ReceiveId = o.ReceiveId) AS ReceiveLineCount,
  (SELECT COUNT(*) FROM dbo.ReceiveShortages s WHERE s.ReceiveId = o.ReceiveId) AS ShortageCount,
  (SELECT COUNT(*)
   FROM dbo.CreditNotes cn
   JOIN dbo.CreditNoteLines cni ON cni.CreditNoteId = cn.CreditNoteId
   WHERE cn.ReceiveId = o.ReceiveId) AS CreditNoteLineCount,
  (SELECT COUNT(*) FROM dbo.CreditNotes cn WHERE cn.ReceiveId = o.ReceiveId) AS CreditNoteCount
FROM dbo.ReceiveOrders o
WHERE o.ReceiveId = @ReceiveId;

IF @Execute = 0
BEGIN
  PRINT 'Preview only: no data was deleted. Set @Execute = 1 to proceed.';
  RETURN;
END;

BEGIN TRY
  BEGIN TRANSACTION;

  DECLARE @ShortageIds TABLE (ShortageId INT PRIMARY KEY);
  INSERT INTO @ShortageIds (ShortageId)
  SELECT ShortageId FROM dbo.ReceiveShortages WHERE ReceiveId = @ReceiveId;

  -- CN line references both the CN header and shortage report.
  DELETE cni
  FROM dbo.CreditNoteLines cni
  WHERE cni.CreditNoteId IN (SELECT CreditNoteId FROM dbo.CreditNotes WHERE ReceiveId = @ReceiveId)
     OR cni.ShortageId IN (SELECT ShortageId FROM @ShortageIds);

  DELETE FROM dbo.CreditNotes WHERE ReceiveId = @ReceiveId;
  DELETE FROM dbo.ReceiveShortages WHERE ReceiveId = @ReceiveId;
  DELETE FROM dbo.ReceiveOrderLines WHERE ReceiveId = @ReceiveId;

  COMMIT TRANSACTION;
  PRINT 'Deleted receiving lines and their linked shortage/CN data. ReceiveOrders header was preserved.';
END TRY
BEGIN CATCH
  IF XACT_STATE() <> 0 ROLLBACK TRANSACTION;
  THROW;
END CATCH;
