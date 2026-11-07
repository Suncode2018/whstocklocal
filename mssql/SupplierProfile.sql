USE dbMaster;
IF COL_LENGTH('dbo.tblSuppliers','GoodsServices') IS NULL ALTER TABLE dbo.tblSuppliers ADD GoodsServices NVARCHAR(500) NULL;
IF COL_LENGTH('dbo.tblSuppliers','ApprovalDate') IS NULL ALTER TABLE dbo.tblSuppliers ADD ApprovalDate DATE NULL;
ALTER TABLE dbo.tblSuppliers ALTER COLUMN Phone NVARCHAR(150) NULL;
