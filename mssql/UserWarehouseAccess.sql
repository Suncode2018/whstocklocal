USE dbMaster;
IF OBJECT_ID('dbo.UserWarehouseAccess','U') IS NULL CREATE TABLE dbo.UserWarehouseAccess(UserId int NOT NULL REFERENCES dbo.Users(UserId),WhId int NOT NULL REFERENCES dbo.tblWH(whid),CreatedAt datetime2 NOT NULL DEFAULT SYSDATETIME(),PRIMARY KEY(UserId,WhId));
