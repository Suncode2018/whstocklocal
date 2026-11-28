-- Run mssql/ProductionIssueRequests.sql first. This migration adds versioned form metadata
-- and nullable snapshots to existing issue documents; it does not alter stock balances.
USE dbWMS;
GO

IF OBJECT_ID(N'dbo.ProductionIssueFormTemplates',N'U') IS NULL
BEGIN
    CREATE TABLE dbo.ProductionIssueFormTemplates(
        FormTemplateId INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_ProductionIssueFormTemplates PRIMARY KEY,
        FormCode NVARCHAR(30) NOT NULL,
        FormRevision NVARCHAR(20) NOT NULL,
        EffectiveDate DATE NOT NULL,
        CompanyName NVARCHAR(200) NOT NULL,
        DocumentTitle NVARCHAR(200) NOT NULL,
        IsActive BIT NOT NULL CONSTRAINT DF_ProductionIssueFormTemplates_IsActive DEFAULT 0,
        Version INT NOT NULL CONSTRAINT DF_ProductionIssueFormTemplates_Version DEFAULT 1,
        CreatedBy NVARCHAR(100) NOT NULL,
        CreatedAt DATETIME2 NOT NULL CONSTRAINT DF_ProductionIssueFormTemplates_CreatedAt DEFAULT SYSDATETIME(),
        UpdatedBy NVARCHAR(100) NOT NULL,
        UpdatedAt DATETIME2 NOT NULL CONSTRAINT DF_ProductionIssueFormTemplates_UpdatedAt DEFAULT SYSDATETIME(),
        CONSTRAINT UQ_ProductionIssueFormTemplates_CodeRevision UNIQUE(FormCode,FormRevision)
    );
    CREATE UNIQUE INDEX UX_ProductionIssueFormTemplates_OneActive
        ON dbo.ProductionIssueFormTemplates(FormCode) WHERE IsActive=1;
END;
GO

IF COL_LENGTH(N'dbo.ProductionIssueRequests',N'FormTemplateId') IS NULL
    ALTER TABLE dbo.ProductionIssueRequests ADD FormTemplateId INT NULL;
IF COL_LENGTH(N'dbo.ProductionIssueRequests',N'FormCodeSnapshot') IS NULL
    ALTER TABLE dbo.ProductionIssueRequests ADD FormCodeSnapshot NVARCHAR(30) NULL;
IF COL_LENGTH(N'dbo.ProductionIssueRequests',N'FormRevisionSnapshot') IS NULL
    ALTER TABLE dbo.ProductionIssueRequests ADD FormRevisionSnapshot NVARCHAR(20) NULL;
IF COL_LENGTH(N'dbo.ProductionIssueRequests',N'FormEffectiveDateSnapshot') IS NULL
    ALTER TABLE dbo.ProductionIssueRequests ADD FormEffectiveDateSnapshot DATE NULL;
IF COL_LENGTH(N'dbo.ProductionIssueRequests',N'FormCompanyNameSnapshot') IS NULL
    ALTER TABLE dbo.ProductionIssueRequests ADD FormCompanyNameSnapshot NVARCHAR(200) NULL;
IF COL_LENGTH(N'dbo.ProductionIssueRequests',N'FormDocumentTitleSnapshot') IS NULL
    ALTER TABLE dbo.ProductionIssueRequests ADD FormDocumentTitleSnapshot NVARCHAR(200) NULL;
GO

IF NOT EXISTS(SELECT 1 FROM dbo.ProductionIssueFormTemplates WHERE FormCode=N'FR-PD-02' AND FormRevision=N'Rev.00')
BEGIN
    INSERT dbo.ProductionIssueFormTemplates(FormCode,FormRevision,EffectiveDate,CompanyName,DocumentTitle,IsActive,CreatedBy,UpdatedBy)
    VALUES(N'FR-PD-02',N'Rev.00','2024-10-02',N'บริษัท รวยมั่งคั่ง 69 จำกัด',N'ใบเบิกสินค้าเพื่อผลิต',1,N'SYSTEM',N'SYSTEM');
END;
GO

IF NOT EXISTS(SELECT 1 FROM sys.foreign_keys WHERE name=N'FK_ProductionIssueRequests_FormTemplate')
    ALTER TABLE dbo.ProductionIssueRequests WITH CHECK
    ADD CONSTRAINT FK_ProductionIssueRequests_FormTemplate
        FOREIGN KEY(FormTemplateId) REFERENCES dbo.ProductionIssueFormTemplates(FormTemplateId);
GO
