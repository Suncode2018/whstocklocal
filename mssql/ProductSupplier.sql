USE dbMaster;
IF COL_LENGTH('dbo.tblProducts','SupplierId') IS NULL ALTER TABLE dbo.tblProducts ADD SupplierId int NULL;
GO
IF NOT EXISTS(SELECT 1 FROM sys.foreign_keys WHERE name='FK_tblProducts_Supplier') ALTER TABLE dbo.tblProducts ADD CONSTRAINT FK_tblProducts_Supplier FOREIGN KEY(SupplierId) REFERENCES dbo.tblSuppliers(SupplierId);
UPDATE p SET SupplierId=s.SupplierId FROM dbo.tblProducts p JOIN dbo.tblSuppliers s ON s.SupplierCode=p.SupplierCode WHERE p.SupplierId IS NULL AND NULLIF(LTRIM(RTRIM(p.SupplierCode)),'') IS NOT NULL;
