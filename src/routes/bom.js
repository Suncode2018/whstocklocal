const express = require('express');
const { poolPromise, sql } = require('../config/db');
const access = require('../middleware/access');

const router = express.Router();
router.use(access.authenticate, access.business);

const fail = (status, message) => { const error = new Error(message); error.status = status; throw error; };
const respondError = (res, error) => res.status(error.status || 500).json({ success: false, message: error.status ? error.message : 'ทำรายการสูตรไม่สำเร็จ ตรวจการเชื่อมต่อและ BOM.sql' });
const masterSQL = `SELECT p.ProductId,p.ProductCode,p.ProductName,p.ThaiName,p.Barcode,p.UnitId,UPPER(c.CategoryCode) AS CategoryCode,u.UnitCode AS UOM,p.IsActive FROM dbMaster.dbo.tblProducts p JOIN dbMaster.dbo.tblCategories c ON c.CategoryID=p.CategoryId LEFT JOIN dbMaster.dbo.tblUnits u ON u.UnitId=p.UnitId WHERE p.IsActive=1`;
let auditSchemaPromise;

async function ensureAuditTable(pool) {
  if (!auditSchemaPromise) auditSchemaPromise = pool.request().query(`
    IF OBJECT_ID(N'dbMaster.dbo.tblBOMAudit',N'U') IS NULL
    BEGIN
      CREATE TABLE dbMaster.dbo.tblBOMAudit(
        AuditId BIGINT IDENTITY(1,1) NOT NULL PRIMARY KEY,
        BOMId INT NOT NULL,
        FGProductId INT NOT NULL,
        VersionNo INT NOT NULL,
        Revision INT NOT NULL,
        ActionCode VARCHAR(20) NOT NULL,
        Actor NVARCHAR(100) NOT NULL,
        BeforeJson NVARCHAR(MAX) NULL,
        AfterJson NVARCHAR(MAX) NOT NULL,
        CreatedAt DATETIME2 NOT NULL CONSTRAINT DF_tblBOMAudit_CreatedAt DEFAULT SYSDATETIME()
      );
    END;
    IF NOT EXISTS(SELECT 1 FROM dbMaster.sys.indexes WHERE object_id=OBJECT_ID(N'dbMaster.dbo.tblBOMAudit') AND name=N'IX_tblBOMAudit_BOMId_CreatedAt')
      CREATE INDEX IX_tblBOMAudit_BOMId_CreatedAt ON dbMaster.dbo.tblBOMAudit(BOMId,CreatedAt DESC,AuditId DESC);
  `).catch(error => { auditSchemaPromise = null; throw error; });
  await auditSchemaPromise;
}

async function snapshotBOM(request, id) {
  const result = await request.input('SnapshotBOMId', sql.Int, id).query(`
    SELECT (SELECT h.BOMId,h.FGProductId,h.VersionNo,h.BaseQuantity,h.Status,h.Note,h.Revision,h.CreatedBy,h.CreatedAt,h.UpdatedAt,h.ActivatedBy,h.ActivatedAt,
      JSON_QUERY((SELECT l.BOMLineId,l.ComponentProductId,l.Quantity,l.UnitId FROM dbMaster.dbo.tblBOMLines l WHERE l.BOMId=h.BOMId ORDER BY l.BOMLineId FOR JSON PATH)) AS Lines
    FROM dbMaster.dbo.tblBOMHeaders h WHERE h.BOMId=@SnapshotBOMId FOR JSON PATH,WITHOUT_ARRAY_WRAPPER) AS SnapshotJson
  `);
  return result.recordset[0]?.SnapshotJson || null;
}

async function writeAudit(request, { id, fgProductId, versionNo, revision, action, actor, beforeJson, afterJson }) {
  await request.input('AuditBOMId', sql.Int, id)
    .input('AuditFGId', sql.Int, fgProductId)
    .input('AuditVersion', sql.Int, versionNo)
    .input('AuditRevision', sql.Int, revision)
    .input('AuditAction', sql.VarChar(20), action)
    .input('AuditActor', sql.NVarChar(100), actor)
    .input('AuditBefore', sql.NVarChar(sql.MAX), beforeJson)
    .input('AuditAfter', sql.NVarChar(sql.MAX), afterJson)
    .query(`INSERT dbMaster.dbo.tblBOMAudit(BOMId,FGProductId,VersionNo,Revision,ActionCode,Actor,BeforeJson,AfterJson)
      VALUES(@AuditBOMId,@AuditFGId,@AuditVersion,@AuditRevision,@AuditAction,@AuditActor,@AuditBefore,@AuditAfter)`);
}

router.get('/master', async (req, res) => {
  try { const pool = await poolPromise; const result = await pool.request().query(masterSQL); res.json({ success: true, products: result.recordset }); }
  catch (error) { respondError(res, error); }
});

router.get('/', async (req, res) => {
  try {
    const pool = await poolPromise;
    const result = await pool.request().query(`SELECT h.*,p.ProductCode,p.ProductName,u.UnitCode AS UOM,(SELECT COUNT(*) FROM dbMaster.dbo.tblBOMLines l WHERE l.BOMId=h.BOMId) AS LineCount FROM dbMaster.dbo.tblBOMHeaders h JOIN dbMaster.dbo.tblProducts p ON p.ProductId=h.FGProductId LEFT JOIN dbMaster.dbo.tblUnits u ON u.UnitId=p.UnitId ORDER BY h.UpdatedAt DESC,h.BOMId DESC`);
    res.json({ success: true, data: result.recordset });
  } catch (error) { respondError(res, error); }
});

router.get('/:id/history', async (req, res) => {
  try {
    if (!/^\d+$/.test(req.params.id)) fail(400, 'รหัสสูตรไม่ถูกต้อง');
    const pool = await poolPromise; await ensureAuditTable(pool);
    const result = await pool.request().input('Id', sql.Int, req.params.id).query(`SELECT AuditId,BOMId,FGProductId,VersionNo,Revision,ActionCode,Actor,BeforeJson,AfterJson,CreatedAt FROM dbMaster.dbo.tblBOMAudit WHERE BOMId=@Id ORDER BY CreatedAt DESC,AuditId DESC`);
    res.json({ success: true, data: result.recordset });
  } catch (error) { respondError(res, error); }
});

router.get('/:id', async (req, res) => {
  try {
    if (!/^\d+$/.test(req.params.id)) fail(400, 'รหัสสูตรไม่ถูกต้อง');
    const pool = await poolPromise;
    const result = await pool.request().input('Id', sql.Int, req.params.id).query(`SELECT * FROM dbMaster.dbo.tblBOMHeaders WHERE BOMId=@Id;SELECT l.*,p.ProductCode,p.ProductName,u.UnitCode AS UOM FROM dbMaster.dbo.tblBOMLines l JOIN dbMaster.dbo.tblProducts p ON p.ProductId=l.ComponentProductId LEFT JOIN dbMaster.dbo.tblUnits u ON u.UnitId=l.UnitId WHERE l.BOMId=@Id ORDER BY l.BOMLineId`);
    if (!result.recordsets[0].length) fail(404, 'ไม่พบสูตร');
    res.json({ success: true, header: result.recordsets[0][0], lines: result.recordsets[1] });
  } catch (error) { respondError(res, error); }
});

async function save(req, res) {
  let transaction;
  try {
    const body = req.body || {}, editing = !!req.params.id;
    const validQuantity = value => /^\d{1,12}(?:\.\d{1,6})?$/.test(String(value)) && Number(value) > 0;
    if (!Number.isInteger(body.fgProductId) || !validQuantity(body.baseQuantity) || typeof body.note !== 'string' || body.note.length > 500 || !Array.isArray(body.lines) || !body.lines.length || body.lines.length > 200 || body.lines.some(line => !Number.isInteger(line.productId) || !validQuantity(line.quantity) || line.productId === body.fgProductId) || new Set(body.lines.map(line => line.productId)).size !== body.lines.length || (editing && (!/^\d+$/.test(req.params.id) || !Number.isInteger(body.revision)))) fail(400, 'เลือก FG และส่วนประกอบให้ครบ จำนวนต้องมากกว่า 0 และไม่ซ้ำ');

    const pool = await poolPromise; await ensureAuditTable(pool);
    transaction = new sql.Transaction(pool); await transaction.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
    const request = () => new sql.Request(transaction);
    await request().input('LockProductId', sql.Int, body.fgProductId).query('SELECT ProductId FROM dbMaster.dbo.tblProducts WITH(UPDLOCK,HOLDLOCK) WHERE ProductId=@LockProductId');
    const products = (await request().query(masterSQL)).recordset;
    const fg = products.find(product => product.ProductId === body.fgProductId);
    if (!fg || fg.CategoryCode !== 'FG' || !fg.UnitId || !fg.UOM) fail(400, 'FG ต้องเปิดใช้งานและมีหน่วยนับ');
    const components = body.lines.map(line => products.find(product => product.ProductId === line.productId));
    if (components.some(product => !product || !['RM','PKG','PACK','SEMI','SFG'].includes(product.CategoryCode) || !product.UnitId || !product.UOM)) fail(400, 'ส่วนประกอบต้องเป็น RM/Pack/Semi ที่เปิดใช้งานและมีหน่วยนับ');

    let id, beforeJson = null, versionNo, revision;
    const actor = String(req.user.username || req.user.id).slice(0, 100);
    if (editing) {
      const old = (await request().input('Id', sql.Int, req.params.id).query('SELECT * FROM dbMaster.dbo.tblBOMHeaders WITH(UPDLOCK,HOLDLOCK) WHERE BOMId=@Id')).recordset[0];
      if (!old || old.Status !== 'DRAFT' || old.FGProductId !== body.fgProductId || old.Revision !== body.revision) fail(409, 'สูตรถูกแก้ไขหรือเปิดใช้แล้ว กรุณาโหลดใหม่');
      id = old.BOMId; versionNo = old.VersionNo; beforeJson = await snapshotBOM(request(), id);
      await request().input('UpdateBOMId', sql.Int, id).input('Qty', sql.Decimal(18,6), body.baseQuantity).input('Note', sql.NVarChar(500), body.note.trim()).query('UPDATE dbMaster.dbo.tblBOMHeaders SET BaseQuantity=@Qty,Note=@Note,Revision=Revision+1,UpdatedAt=SYSDATETIME() WHERE BOMId=@UpdateBOMId;DELETE FROM dbMaster.dbo.tblBOMLines WHERE BOMId=@UpdateBOMId');
    } else {
      const inserted = (await request().input('NewFGId', sql.Int, body.fgProductId).input('NewQty', sql.Decimal(18,6), body.baseQuantity).input('NewNote', sql.NVarChar(500), body.note.trim()).input('CreatedBy', sql.NVarChar(50), actor.slice(0,50)).query('INSERT INTO dbMaster.dbo.tblBOMHeaders(FGProductId,VersionNo,BaseQuantity,Note,CreatedBy) OUTPUT inserted.BOMId,inserted.VersionNo SELECT @NewFGId,COALESCE(MAX(VersionNo),0)+1,@NewQty,@NewNote,@CreatedBy FROM dbMaster.dbo.tblBOMHeaders WITH(UPDLOCK,HOLDLOCK) WHERE FGProductId=@NewFGId')).recordset[0];
      id = inserted.BOMId; versionNo = inserted.VersionNo;
    }
    for (const [index, line] of body.lines.entries()) await request().input('LineBOMId', sql.Int, id).input('LineProductId', sql.Int, line.productId).input('LineQty', sql.Decimal(18,6), line.quantity).input('LineUnitId', sql.Int, components[index].UnitId).query('INSERT INTO dbMaster.dbo.tblBOMLines(BOMId,ComponentProductId,Quantity,UnitId) VALUES(@LineBOMId,@LineProductId,@LineQty,@LineUnitId)');
    const afterJson = await snapshotBOM(request(), id);
    const newHeader = JSON.parse(afterJson);
    revision = newHeader.Revision;
    await writeAudit(request(), { id, fgProductId: body.fgProductId, versionNo, revision, action: editing ? 'EDIT' : 'CREATE', actor, beforeJson, afterJson });
    await transaction.commit();
    res.json({ success: true, BOMId: id });
  } catch (error) { if (transaction) try { await transaction.rollback(); } catch {} respondError(res, error); }
}

router.post('/', access.admin, save);
router.put('/:id', access.admin, save);

router.post('/:id/activate', access.admin, async (req, res) => {
  let transaction;
  try {
    if (!/^\d+$/.test(req.params.id) || !Number.isInteger(req.body?.revision)) fail(400, 'ข้อมูลรุ่นสูตรไม่ถูกต้อง');
    const pool = await poolPromise; await ensureAuditTable(pool);
    const hint = (await pool.request().input('HintId', sql.Int, req.params.id).query('SELECT FGProductId FROM dbMaster.dbo.tblBOMHeaders WHERE BOMId=@HintId')).recordset[0];
    if (!hint) fail(404, 'ไม่พบสูตร');
    transaction = new sql.Transaction(pool); await transaction.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
    const request = () => new sql.Request(transaction);
    await request().input('LockFGId', sql.Int, hint.FGProductId).query('SELECT ProductId FROM dbMaster.dbo.tblProducts WITH(UPDLOCK,HOLDLOCK) WHERE ProductId=@LockFGId');
    const header = (await request().input('ActivateId', sql.Int, req.params.id).query('SELECT * FROM dbMaster.dbo.tblBOMHeaders WITH(UPDLOCK,HOLDLOCK) WHERE BOMId=@ActivateId')).recordset[0];
    if (!header || header.Status !== 'DRAFT' || header.Revision !== req.body.revision) fail(409, 'สูตรเปลี่ยนสถานะแล้ว กรุณาโหลดใหม่');
    const beforeJson = await snapshotBOM(request(), header.BOMId);
    const checks = (await request().input('CheckId', sql.Int, header.BOMId).query('SELECT l.ComponentProductId,l.UnitId FROM dbMaster.dbo.tblBOMLines l WHERE BOMId=@CheckId')).recordset;
    const products = (await request().query(masterSQL)).recordset;
    if (!products.some(product => product.ProductId === header.FGProductId && product.CategoryCode === 'FG') || !checks.length || checks.some(line => !products.some(product => product.ProductId === line.ComponentProductId && product.UnitId === line.UnitId && ['RM','PKG','PACK','SEMI','SFG'].includes(product.CategoryCode)))) fail(409, 'สินค้า หน่วย หรือส่วนประกอบเปลี่ยน กรุณาตรวจสูตรอีกครั้ง');
    const activeHeaders = (await request().input('PreviousActiveFGId', sql.Int, header.FGProductId).query("SELECT BOMId FROM dbMaster.dbo.tblBOMHeaders WITH(UPDLOCK,HOLDLOCK) WHERE FGProductId=@PreviousActiveFGId AND Status='ACTIVE'")).recordset;
    const previousActive = [];
    for (const row of activeHeaders) previousActive.push({ id: row.BOMId, before: await snapshotBOM(request(), row.BOMId) });
    await request().input('ActivateFGId', sql.Int, header.FGProductId).input('ActivateBy', sql.NVarChar(50), String(req.user.username || req.user.id).slice(0,50)).input('ActivateBOMId', sql.Int, header.BOMId).query("UPDATE dbMaster.dbo.tblBOMHeaders SET Status='ARCHIVED',Revision=Revision+1,UpdatedAt=SYSDATETIME() WHERE FGProductId=@ActivateFGId AND Status='ACTIVE';UPDATE dbMaster.dbo.tblBOMHeaders SET Status='ACTIVE',Revision=Revision+1,UpdatedAt=SYSDATETIME(),ActivatedBy=@ActivateBy,ActivatedAt=SYSDATETIME() WHERE BOMId=@ActivateBOMId");
    for (const archived of previousActive) {
      const archivedJson = await snapshotBOM(request(), archived.id), archivedHeader = JSON.parse(archivedJson);
      await writeAudit(request(), { id: archivedHeader.BOMId, fgProductId: archivedHeader.FGProductId, versionNo: archivedHeader.VersionNo, revision: archivedHeader.Revision, action: 'ARCHIVE', actor: String(req.user.username || req.user.id).slice(0,100), beforeJson: archived.before, afterJson: archivedJson });
    }
    const afterJson = await snapshotBOM(request(), header.BOMId);
    const updatedHeader = JSON.parse(afterJson);
    await writeAudit(request(), { id: header.BOMId, fgProductId: header.FGProductId, versionNo: header.VersionNo, revision: updatedHeader.Revision, action: 'ACTIVATE', actor: String(req.user.username || req.user.id).slice(0,100), beforeJson, afterJson });
    await transaction.commit(); res.json({ success: true });
  } catch (error) { if (transaction) try { await transaction.rollback(); } catch {} respondError(res, error); }
});

module.exports = router;
