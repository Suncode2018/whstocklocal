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