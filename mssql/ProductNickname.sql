USE dbMaster;
IF COL_LENGTH('dbo.tblProducts', 'Nickname') IS NULL
  ALTER TABLE dbo.tblProducts ADD Nickname NVARCHAR(255) NULL;
