// Read-only diagnostics. A separate, small pool keeps DMV inspection available
// when the application pool itself is saturated.
const { sql, config } = require('../config/db');

let lastCapture = 0;
let diagnosticsPoolPromise;

function poolSnapshot(pool) {
  const internal = pool?.pool;
  if (!internal) return null;
  return {
    max: internal.max,
    used: internal.numUsed(),
    free: internal.numFree(),
    pendingAcquires: internal.numPendingAcquires(),
    pendingCreates: internal.numPendingCreates()
  };
}

function getDiagnosticsPool() {
  if (!diagnosticsPoolPromise) {
    diagnosticsPoolPromise = new sql.ConnectionPool({
      ...config,
      connectionTimeout: 3000,
      requestTimeout: 4000,
      pool: { max: 1, min: 0, idleTimeoutMillis: 30000 }
    }).connect().catch(error => {
      diagnosticsPoolPromise = null;
      throw error;
    });
  }
  return diagnosticsPoolPromise;
}

module.exports = function captureSqlTimeout(poolPromise, endpoint, error) {
  if (error?.code !== 'ETIMEOUT' || Date.now() - lastCapture < 15000) return;
  lastCapture = Date.now();

  Promise.resolve(poolPromise).then(async appPool => {
    const appPoolState = poolSnapshot(appPool);
    try {
      const diagnosticsPool = await getDiagnosticsPool();
      const requestStartedAt = Date.now();
      const requests = await diagnosticsPool.request().query(`
        SELECT r.session_id, r.status, r.blocking_session_id, r.wait_type,
          r.wait_time, r.wait_resource, r.open_transaction_count,
          DB_NAME(r.database_id) AS database_name, s.program_name
        FROM sys.dm_exec_requests r
        JOIN sys.dm_exec_sessions s ON s.session_id=r.session_id
        WHERE r.session_id<>@@SPID AND s.is_user_process=1
          AND (r.blocking_session_id<>0 OR r.wait_type IS NOT NULL OR r.total_elapsed_time>=1000)
        ORDER BY r.total_elapsed_time DESC;
      `);
      const openTransactions = await diagnosticsPool.request().query(`
        SELECT session_id, status, open_transaction_count, host_name, program_name
        FROM sys.dm_exec_sessions
        WHERE is_user_process=1 AND open_transaction_count>0 AND session_id<>@@SPID;
      `);
      console.warn('SQL timeout diagnostics', JSON.stringify({
        endpoint,
        capturedAt: new Date().toISOString(),
        appPool: appPoolState,
        diagnosticsDurationMs: Date.now() - requestStartedAt,
        waitingRequests: requests.recordset,
        openTransactions: openTransactions.recordset
      }));
    } catch (diagnosticError) {
      console.warn('SQL timeout diagnostics unavailable', JSON.stringify({
        endpoint,
        appPool: appPoolState,
        code: diagnosticError.code || 'UNKNOWN',
        message: diagnosticError.message
      }));
    }
  }).catch(diagnosticError => {
    console.warn('SQL timeout diagnostics unavailable', JSON.stringify({
      endpoint,
      code: diagnosticError.code || 'UNKNOWN'
    }));
  });
};
