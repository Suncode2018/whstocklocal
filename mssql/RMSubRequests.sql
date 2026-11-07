USE dbWMS;
IF OBJECT_ID('dbo.RMSubRequests','U') IS NULL CREATE TABLE dbo.RMSubRequests(
 RequestId int IDENTITY PRIMARY KEY,RequestKey uniqueidentifier NOT NULL UNIQUE,RequestNo nvarchar(40) NOT NULL UNIQUE,
 ProductId int NOT NULL,PackCount int NOT NULL CHECK(PackCount BETWEEN 1 AND 200),SpecRevision int NOT NULL,
 SourceWhId int NOT NULL,DestinationWhId int NOT NULL,DestinationLocation nvarchar(50) NOT NULL,
 ReferenceNo nvarchar(60) NOT NULL,Note nvarchar(255) NULL,Status varchar(12) NOT NULL DEFAULT 'PENDING' CHECK(Status IN('PENDING','APPROVED','REJECTED')),
 TransferId int NULL REFERENCES dbo.RMSubTransfers(TransferId),CreatedBy nvarchar(100) NOT NULL,CreatedAt datetime2 NOT NULL DEFAULT SYSDATETIME(),
 ApprovedBy nvarchar(100) NULL,ApprovedAt datetime2 NULL,RejectionReason nvarchar(255) NULL
);
