/* Idempotent audit history table for BOM changes. Run against dbMaster. */
IF OBJECT_ID(N'dbo.tblBOMAudit',N'U') IS NULL
BEGIN
  CREATE TABLE dbo.tblBOMAudit(
    AuditId BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_tblBOMAudit PRIMARY KEY,
    BOMId INT NOT NULL,
    FGProductId INT NOT NULL,
    VersionNo INT NOT NULL,
    Revision INT NOT NULL,
    ActionCode VARCHAR(20) NOT NULL,
    Actor NVARCHAR(100) NOT NULL,
    BeforeJson NVARCHAR(MAX) NULL,
    AfterJson NVARCHAR(MAX) NOT NULL,
    CreatedAt DATETIME2 NOT NULL CONSTRAINT DF_tblBOMAudit_CreatedAt DEFAULT SYSDATETIME(),
    CONSTRAINT CK_tblBOMAudit_ActionCode CHECK(ActionCode IN ('CREATE','EDIT','ACTIVATE','ARCHIVE'))
  );
END;
GO
IF NOT EXISTS(SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID(N'dbo.tblBOMAudit') AND name=N'IX_tblBOMAudit_BOMId_CreatedAt')
  CREATE INDEX IX_tblBOMAudit_BOMId_CreatedAt ON dbo.tblBOMAudit(BOMId,CreatedAt DESC,AuditId DESC);
GO
