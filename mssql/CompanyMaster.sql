SET XACT_ABORT ON;
BEGIN TRANSACTION;
IF OBJECT_ID('dbMaster.dbo.CompanyProfile') IS NULL CREATE TABLE dbMaster.dbo.CompanyProfile(CompanyId int NOT NULL PRIMARY KEY CHECK(CompanyId=1),ProfileJson nvarchar(max) NOT NULL CHECK(ISJSON(ProfileJson)=1),Revision int NOT NULL DEFAULT 1,UpdatedBy nvarchar(50),UpdatedAt datetime2 NOT NULL DEFAULT SYSDATETIME());
IF NOT EXISTS(SELECT 1 FROM dbMaster.dbo.CompanyProfile WHERE CompanyId=1) INSERT dbMaster.dbo.CompanyProfile(CompanyId,ProfileJson) VALUES(1,N'{"NameTH":"บริษัท รวยมั่งคั่ง 69 จำกัด","NameEN":"RUAYMANGKHANG 69 CO., LTD","AddressTH":"99/64 หมู่ที่ 5 ตำบลบางระกำ อำเภอบางเลน\nจังหวัดนครปฐม 73130","AddressEN":"99/64 Moo 5 Bang Rakam Subdistrict,\nBang Len District, Nakhon Pathom 73130","TaxId":"0735566010770","BranchCode":"00000","Phone":"084-556-1349","Email":"","LogoText":"69","LogoCaption":"RMK"}');
IF COL_LENGTH('dbWMS.dbo.DeliveryOrders','CompanySnapshot') IS NULL ALTER TABLE dbWMS.dbo.DeliveryOrders ADD CompanySnapshot nvarchar(max) NULL;
COMMIT;
