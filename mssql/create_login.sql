-- Current application uses existing SQL login and two databases.
-- Create/restore dbMaster and dbWMS from a current export before running this script.
-- Run as a SQL Server administrator. No passwords or master data are reset.
USE dbMaster;
IF SUSER_ID(N'myadmin') IS NULL THROW 51000,N'Create the SQL login myadmin first using your approved password.',1;
IF USER_ID(N'myadmin') IS NULL CREATE USER myadmin FOR LOGIN myadmin;
ALTER ROLE db_datareader ADD MEMBER myadmin;
ALTER ROLE db_datawriter ADD MEMBER myadmin;
GO
USE dbWMS;
IF USER_ID(N'myadmin') IS NULL CREATE USER myadmin FOR LOGIN myadmin;
ALTER ROLE db_datareader ADD MEMBER myadmin;
ALTER ROLE db_datawriter ADD MEMBER myadmin;
GO
