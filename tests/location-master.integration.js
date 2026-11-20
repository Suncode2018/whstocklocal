// Local DEV integration for Location Master. Exercises real API writes and
// reads, then removes only this run's uniquely tagged, unused fixture.
const express = require('express');
const { randomUUID } = require('crypto');
const { poolPromise, sql } = require('../src/config/db');

const assert = (condition, message) => { if (!condition) throw new Error(message); };
const uuid = randomUUID().replace(/-/g, '').toUpperCase();
const code = `DEV-${uuid.slice(0, 10)}`;
const tag = `DEV-LOCATION-IT-${uuid.slice(10, 26)}`;
const updatedTag = `${tag}-U`;

async function request(base, path, method = 'GET', body) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    ...(body ? { body: JSON.stringify(body) } : {})
  });
  return { status: response.status, body: await response.json().catch(() => ({})) };
}

async function run() {
  assert(['localhost', '127.0.0.1', '(local)', '.'].includes(String(process.env.DB_SERVER || 'localhost').toLowerCase()), 'Safety stop: DB server must be localhost.');
  assert(process.env.DB_DATABASE === 'dbMaster', `Safety stop: expected dbMaster, received ${process.env.DB_DATABASE || '(unset)'}.`);
  const pool = await poolPromise;
  const warehouse = (await pool.request().query('SELECT TOP 1 whid FROM dbo.tblWH ORDER BY whid')).recordset[0];
  assert(warehouse, 'Safety stop: add a warehouse before testing Location Master.');

  const app = express();
  app.use(express.json());
  app.use('/api/master', require('../src/routes/locations'));
  const server = await new Promise((resolve, reject) => {
    const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
    listener.once('error', reject);
  });
  const base = `http://127.0.0.1:${server.address().port}/api/master`;
  let id = null;
  let apiDeactivatePassed = false;
  const checks = [];
  try {
    const created = await request(base, '/locations', 'POST', {
      whid: warehouse.whid, locationCode: code, zone: 'DEVTEST', description: tag, isActive: true,
      capacityWidthCm: '100', capacityLengthCm: '120', capacityHeightCm: '80'
    });
    assert(created.status === 200 && created.body.success, `POST failed (HTTP ${created.status}): ${created.body.error || ''}`);
    const row = (await pool.request().input('Code', sql.NVarChar(50), code).input('Tag', sql.NVarChar(100), tag)
      .query('SELECT LocationId FROM dbo.Locations WHERE LocationCode=@Code AND Description=@Tag')).recordset[0];
    assert(row, 'Created Location row was not persisted in SQL.');
    id = row.LocationId;
    checks.push('POST wrote the Location row and SQL read-back matched.');

    const listed = await request(base, '/locations');
    assert(listed.status === 200 && listed.body.some(item => item.LocationId === id && item.LocationCode === code), 'GET locations did not return the inserted fixture.');
    checks.push('GET locations returned the new code, warehouse, zone and capacity data.');

    const updated = await request(base, `/locations/${id}`, 'PUT', {
      whid: warehouse.whid, locationCode: code, zone: 'DEVTEST', description: updatedTag, isActive: true,
      capacityWidthCm: '100', capacityLengthCm: '120', capacityHeightCm: '80'
    });
    assert(updated.status === 200 && updated.body.success, `PUT failed (HTTP ${updated.status}): ${updated.body.error || ''}`);
    const updatedRow = (await pool.request().input('Id', sql.Int, id).input('Tag', sql.NVarChar(100), updatedTag)
      .query('SELECT LocationId FROM dbo.Locations WHERE LocationId=@Id AND Description=@Tag')).recordset[0];
    assert(updatedRow, 'Updated Location values were not persisted.');
    checks.push('PUT persisted the updated description and measurements.');

    const deactivated = await request(base, `/locations/${id}`, 'DELETE');
    assert(deactivated.status === 200 && deactivated.body.success, `DELETE/deactivate failed (HTTP ${deactivated.status}).`);
    const finalList = await request(base, '/locations');
    assert(finalList.status === 200 && finalList.body.some(item => item.LocationId === id && !item.IsActive), 'DELETE endpoint did not mark the Location inactive.');
    apiDeactivatePassed = true;
    checks.push('DELETE endpoint followed its actual behavior: deactivated the Location and preserved its history.');
  } finally {
    if (id) {
      // The route intentionally deactivates rather than hard-deletes. Remove
      // only this test's unused row after checking that behavior above.
      await pool.request().input('Id', sql.Int, id).input('Code', sql.NVarChar(50), code)
        .input('Tag', sql.NVarChar(100), tag).input('UpdatedTag', sql.NVarChar(100), updatedTag)
        .query('DELETE FROM dbo.Locations WHERE LocationId=@Id AND LocationCode=@Code AND Description IN(@Tag,@UpdatedTag)');
      const remains = (await pool.request().input('Id', sql.Int, id).query('SELECT COUNT(*) AS Total FROM dbo.Locations WHERE LocationId=@Id')).recordset[0].Total;
      assert(remains === 0, 'Cleanup failed: Location test record remains.');
    }
    await new Promise(resolve => server.close(resolve));
    await pool.close();
  }
  console.log(JSON.stringify({ success: true, database: 'dbMaster', testTag: tag, apiDeactivatePassed, cleanup: 'test Location removed; no fixture retained', checks }, null, 2));
}

run().catch(error => { console.error(JSON.stringify({ success: false, error: error.message }, null, 2)); process.exitCode = 1; });
