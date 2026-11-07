USE dbMaster;
SET XACT_ABORT ON;
BEGIN TRANSACTION;
IF NOT EXISTS(SELECT 1 FROM dbo.tblCustomers WITH(UPDLOCK,HOLDLOCK) WHERE CustomerCode=N'C001')
BEGIN
INSERT INTO dbo.tblCustomers(CustomerCode,CustomerName,TaxId,BranchCode,BillingAddress,ShippingAddress,CustomerTypes,Note,SourceTaxId,SourceFile) VALUES(N'C001',N'บริษัท ร่ำรวยพันล้าน289 จำกัด',N'0735565000762','00000',N'ที่อยู่ : 294 ถนนนาสร้าง  ตำบลนครปฐม อำเภอเมืองนครปฐม  จังหวัดนครปฐม  73000',N'ที่อยู่ : 294 ถนนนาสร้าง  ตำบลนครปฐม อำเภอเมืองนครปฐม  จังหวัดนครปฐม  73000','FG',N'นำเข้าจาก Customer.xlsx; เติม 0 นำหน้าเลขภาษีจากค่าตัวเลข 12 หลัก กรุณาตรวจสอบกับเอกสาร',N'735565000762',N'Customer.xlsx');
DECLARE @IdC001 INT=CONVERT(INT,SCOPE_IDENTITY());
INSERT INTO dbo.tblCustomerAudit(CustomerId,Actor,Action,AfterJson) SELECT @IdC001,N'Excel import','IMPORT',(SELECT * FROM dbo.tblCustomers WHERE CustomerId=@IdC001 FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);
END;
IF NOT EXISTS(SELECT 1 FROM dbo.tblCustomers WITH(UPDLOCK,HOLDLOCK) WHERE CustomerCode=N'C002')
BEGIN
INSERT INTO dbo.tblCustomers(CustomerCode,CustomerName,TaxId,BranchCode,BillingAddress,ShippingAddress,CustomerTypes,Note,SourceTaxId,SourceFile) VALUES(N'C002',N'บริษัท ร่ำรวยเฮงเฮง289 จำกัด (สำนักงานใหญ่)',N'0735569002573','00000',N'ที่อยู่ : 294 ถนนนาสร้าง ตำบลนครปฐม อำเภอเมืองนครปฐม จังหวัดนครปฐม 73000',N'ที่อยู่ : 294 ถนนนาสร้าง ตำบลนครปฐม อำเภอเมืองนครปฐม จังหวัดนครปฐม 73000','FG',N'นำเข้าจาก Customer.xlsx; เติม 0 นำหน้าเลขภาษีจากค่าตัวเลข 12 หลัก กรุณาตรวจสอบกับเอกสาร',N'735569002573',N'Customer.xlsx');
DECLARE @IdC002 INT=CONVERT(INT,SCOPE_IDENTITY());
INSERT INTO dbo.tblCustomerAudit(CustomerId,Actor,Action,AfterJson) SELECT @IdC002,N'Excel import','IMPORT',(SELECT * FROM dbo.tblCustomers WHERE CustomerId=@IdC002 FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);
END;
COMMIT;
