const sql = require('mssql');
require('dotenv').config();

const config = {
  server: process.env.DB_SERVER || 'localhost',
  port: parseInt(process.env.DB_PORT) || 1433,
  database: process.env.DB_DATABASE || 'WarehouseStockDB',
  user: process.env.DB_USER || 'sa',
  password: process.env.DB_PASSWORD || '',
  options: {
    encrypt: process.env.DB_ENCRYPT === 'true',
    trustServerCertificate: process.env.DB_TRUST_SERVER_CERTIFICATE !== 'false',
    enableArithAbort: true
  },
  pool: {
    max: 15,
    min: 0,
    idleTimeoutMillis: 30000
  }
};

const poolPromise = new sql.ConnectionPool(config)
  .connect()
  .then(async pool => {
    console.log('✅ Connected to MSSQL Database successfully.');

    // ⭐ เพิ่มคอลัมน์ Permissions ใน Users อัตโนมัติ หากยังไม่มี
    try {
      await pool.request().query(`
        IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('dbo.Users') AND name = 'Permissions')
        BEGIN
            ALTER TABLE dbo.Users ADD Permissions NVARCHAR(100) NULL;
            EXEC('UPDATE dbo.Users SET Permissions = ''RECEIVE,PICK,TRANSFER,LOOKUP'' WHERE Permissions IS NULL');
        END
      `);
    } catch (e) {
      console.warn('Auto migration info:', e.message);
    }

    try {
      await pool.request().query(`
        IF OBJECT_ID('dbo.CycleCountSessions', 'U') IS NULL
        BEGIN
          CREATE TABLE dbo.CycleCountSessions (
            SessionId INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
            SessionCode NVARCHAR(40) NOT NULL UNIQUE,
            SessionName NVARCHAR(100) NOT NULL,
            ScopeType NVARCHAR(10) NOT NULL,
            ScopeValue NVARCHAR(50) NULL,
            Status NVARCHAR(12) NOT NULL CONSTRAINT DF_CycleCountSessions_Status DEFAULT ('OPEN'),
            CreatedBy INT NOT NULL,
            CreatedAt DATETIME2 NOT NULL CONSTRAINT DF_CycleCountSessions_CreatedAt DEFAULT (SYSUTCDATETIME()),
            ExpiresAt DATETIME2 NOT NULL,
            ClosedBy INT NULL,
            ClosedAt DATETIME2 NULL,
            CONSTRAINT FK_CycleCountSessions_CreatedBy FOREIGN KEY (CreatedBy) REFERENCES dbo.Users(UserId),
            CONSTRAINT FK_CycleCountSessions_ClosedBy FOREIGN KEY (ClosedBy) REFERENCES dbo.Users(UserId),
            CONSTRAINT CK_CycleCountSessions_ScopeType CHECK (ScopeType IN ('ZONE','LOCATION')),
            CONSTRAINT CK_CycleCountSessions_Status CHECK (Status IN ('OPEN','CLOSED'))
          );
        END;
      `);
      const expiryColumn = await pool.request().query("SELECT COL_LENGTH('dbo.CycleCountSessions', 'ExpiresAt') AS ColumnLength");
      if (expiryColumn.recordset[0].ColumnLength == null) {
        await pool.request().query('ALTER TABLE dbo.CycleCountSessions ADD ExpiresAt DATETIME2 NULL');
      }
      await pool.request().query('UPDATE dbo.CycleCountSessions SET ExpiresAt = DATEADD(hour, 24, CreatedAt) WHERE ExpiresAt IS NULL');
      await pool.request().query('ALTER TABLE dbo.CycleCountSessions ALTER COLUMN ExpiresAt DATETIME2 NOT NULL');

      await pool.request().query(`
        IF OBJECT_ID('dbo.CYCLECOUNT', 'U') IS NULL AND OBJECT_ID('dbo.CycleCountItems', 'U') IS NOT NULL
          EXEC sp_rename 'dbo.CycleCountItems', 'CYCLECOUNT';
        IF OBJECT_ID('dbo.CYCLECOUNT', 'U') IS NULL
        BEGIN
          CREATE TABLE dbo.CYCLECOUNT (
            CycleCountItemId INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
            SessionId INT NOT NULL,
            ProductId INT NOT NULL,
            LocationId INT NOT NULL,
            ExpectedQuantity INT NOT NULL,
            CountedQuantity INT NULL,
            CountedBy INT NULL,
            CountedAt DATETIME2 NULL,
            CONSTRAINT FK_CYCLECOUNT_Session FOREIGN KEY (SessionId) REFERENCES dbo.CycleCountSessions(SessionId),
            CONSTRAINT FK_CYCLECOUNT_Product FOREIGN KEY (ProductId) REFERENCES dbo.Products(ProductId),
            CONSTRAINT FK_CYCLECOUNT_Location FOREIGN KEY (LocationId) REFERENCES dbo.Locations(LocationId),
            CONSTRAINT FK_CYCLECOUNT_CountedBy FOREIGN KEY (CountedBy) REFERENCES dbo.Users(UserId),
            CONSTRAINT UQ_CYCLECOUNT UNIQUE (SessionId, ProductId, LocationId)
          );
          CREATE INDEX IX_CYCLECOUNT_Session ON dbo.CYCLECOUNT(SessionId, LocationId);
        END;
      `);
    } catch (e) {
      console.warn('Cycle Count migration info:', e.message);
    }

    try {
      await pool.request().query(`
        IF OBJECT_ID('dbo.StockTransactions', 'U') IS NOT NULL
        BEGIN
          DECLARE @transactionTypeCheck sysname;
          SELECT TOP 1 @transactionTypeCheck = name
          FROM sys.check_constraints
          WHERE parent_object_id = OBJECT_ID('dbo.StockTransactions')
            AND definition LIKE '%TransactionType%';

          IF @transactionTypeCheck IS NOT NULL
          BEGIN
            DECLARE @dropTransactionTypeCheckSql NVARCHAR(MAX);
            SET @dropTransactionTypeCheckSql = N'ALTER TABLE dbo.StockTransactions DROP CONSTRAINT [' + REPLACE(@transactionTypeCheck, ']', ']]') + N']';
            EXEC sp_executesql @dropTransactionTypeCheckSql;
          END;

          IF NOT EXISTS (
            SELECT 1 FROM sys.check_constraints
            WHERE parent_object_id = OBJECT_ID('dbo.StockTransactions')
              AND name = 'CK_StockTransactions_TransactionType'
          )
            EXEC('ALTER TABLE dbo.StockTransactions ADD CONSTRAINT CK_StockTransactions_TransactionType CHECK (TransactionType IN (''ADJUST'', ''CYCLECOUNT'', ''RECEIVE'', ''PICK'', ''CHECK'', ''TRANSFER'', ''LOAD'', ''PUTAWAY''))');
        END;
      `);
    } catch (e) {
      console.warn('Transaction type migration info:', e.message);
    }

    return pool;
  })
  .catch(err => {
    console.error('❌ Database Connection Failed! Bad config: ', err);
    process.exit(1);
  });

module.exports = {
  sql,
  poolPromise
};
