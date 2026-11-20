// DEV-only Master Data CRUD integration smoke. Creates one uniquely tagged
// warehouse through the real route, verifies reads/updates, then removes it.
const express = require('express');
const { randomUUID } = require('crypto');
const { poolPromise, sql } = require('../src/config/db');

const assert = (condition, message) => { if (!condition) throw new Error(message); };
const tag = `DEV-MASTER-IT-${randomUUID().slice(0, 24)}`;
const updatedTag = `${tag}-U`;
const code = `W${randomUUID().replace(/\D/g, '').padEnd(9, '0').slice(0, 9)}`;

async function call(base, path, method = 'GET', body) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    ...(body ? { body: JSON.stringify(body) } : {})
  });
  return { status: response.status, body: await response.json().catch(() => ({})) };
}

async function run() {
  assert(['localhost', '127.0.0.1', '(local)', '.'].includes(String(process.env.DB_SERVER || 'localhost').toLowerCase()),
    'Safety stop: database server is not configured as localhost.');
  assert(process.env.DB_DATABASE === 'dbMaster', `Safety stop: expected local dbMaster, got ${process.env.DB_DATABASE || '(unset)'}.`);

  const pool = await poolPromise;
  const serverName = (await pool.request().query('SELECT @@SERVERNAME AS ServerName')).recordset[0].ServerName;
  const app = express();
  app.use(express.json());
  app.use('/api/warehouses', require('../src/routes/warehouses'));
  const server = await new Promise((resolve, reject) => {
    const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
    listener.once('error', reject);
  });
  const base = `http://127.0.0.1:${server.address().port}/api/warehouses`;
  let createdId = null;
  let removedByApi = false;
  const results = [];

  try {
    const created = await call(base, '', 'POST', { whname: code, whdescription: tag });
    assert(created.status === 200 && created.body.success, `Create failed: HTTP ${created.status}.`);
    const row = (await pool.request().input('Name', sql.NVarChar(10), code).input('Tag', sql.NVarChar(50), tag)
      .query('SELECT whid, whname, whdescription FROM dbo.tblWH WHERE whname=@Name AND whdescription=@Tag')).recordset[0];
    assert(row, 'Created master row could not be read back from SQL.');
    createdId = row.whid;
    results.push('POST created a uniquely tagged warehouse and SQL read-back matched.');

    const read = await call(base, `/${createdId}`);
    assert(read.status === 200 && read.body.whid === createdId && read.body.whdescription === tag, 'GET by ID did not return the created master row.');
    const list = await call(base, '');
    assert(list.status === 200 && list.body.some(item => item.whid === createdId), 'GET list did not include the created master row.');
    results.push('GET list and GET by ID returned the new record.');

    const updated = await call(base, `/${createdId}`, 'PUT', { whname: code, whdescription: updatedTag });
    assert(updated.status === 200 && updated.body.success, `Update failed: HTTP ${updated.status}.`);
    const reread = await call(base, `/${createdId}`);
    assert(reread.status === 200 && reread.body.whdescription === updatedTag, 'Updated value was not persisted.');
    results.push('PUT persisted the update and GET confirmed the new value.');

    const deleted = await call(base, `/${createdId}`, 'DELETE');
    assert(deleted.status === 200 && deleted.body.success, `Delete failed: HTTP ${deleted.status}.`);
    removedByApi = true;
    const missing = await call(base, `/${createdId}`);
    assert(missing.status === 404, `Deleted record still visible (HTTP ${missing.status}).`);
    results.push('DELETE removed the test record and GET returned 404.');
  } finally {
    if (createdId && !removedByApi) {
      // Cleanup is limited to the generated ID and this run's exact DEV tag.
      await pool.request().input('Id', sql.Int, createdId).input('Name', sql.NVarChar(10), code)
        .input('Tag', sql.NVarChar(50), tag).input('UpdatedTag', sql.NVarChar(50), updatedTag)
        .query('DELETE FROM dbo.tblWH WHERE whid=@Id AND whname=@Name AND whdescription IN(@Tag,@UpdatedTag)');
    }
    await new Promise(resolve => server.close(resolve));
    await pool.close();
  }

  console.log(JSON.stringify({ success: true, server: serverName, database: 'dbMaster', testTag: tag, checks: results, cleanup: 'test warehouse deleted; no DEV fixture retained' }, null, 2));
}

run().catch(error => {
  console.error(JSON.stringify({ success: false, error: error.message }, null, 2));
  process.exitCode = 1;
});
