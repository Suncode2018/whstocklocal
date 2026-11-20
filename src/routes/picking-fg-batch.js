const express = require('express');
const { randomUUID } = require('crypto');
const { poolPromise, sql } = require('../config/db');
const { allocateFGLots, availableFGLots } = require('../services/picking-fifo');

const fail = (status, message) => { throw Object.assign(new Error(message), { status }); };
const canConfirm = req => req.navigation?.user.Role === 'ADMIN' || !!req.navigation && require('../config/navigation').catalog.some(c =>
  c.scopeParent === 'PICK' && c.categoryCode === 'FG' && require('../middleware/navigation').hasAction(req.navigation.profile, req.navigation.mode, c.code, 'CONFIRM'));

module.exports = balances => {
  const router = express.Router();
  router.post('/', async (req, res) => {
    let tx;
    try {
      const lines = req.body?.lines;
      if (!canConfirm(req)) fail(403, 'ไม่มีสิทธิ์เบิก FG');
      if (!Array.isArray(lines) || !lines.length || lines.length > 100) fail(400, 'ชุดเบิก FG ต้องมี 1–100 รายการ');
      const requestIds = new Set();
      const warehouseScope = require('../middleware/warehouse-scope');
      for (const line of lines) {
        if (!line || line.pickType !== 'FG' || !Number.isInteger(line.whid) || line.whid <= 0 || !Number.isInteger(line.productId) || line.productId <= 0 ||
          typeof line.fromLocationCode !== 'string' || !line.fromLocationCode || line.fromLocationCode.length > 50 ||
          typeof line.toLocationCode !== 'string' || !line.toLocationCode || line.toLocationCode.length > 50 ||
          typeof line.requestId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(line.requestId) ||
          !['number', 'string'].includes(typeof line.quantity) || !/^[0-9]{1,12}(?:\.[0-9]{1,2})?$/.test(String(line.quantity)) || Number(line.quantity) <= 0 ||
          typeof line.referenceNo !== 'string' || !line.referenceNo.trim() || line.referenceNo.length > 60 ||
          typeof line.note !== 'string' || line.note.length > 255) fail(400, 'กรุณาตรวจสินค้า Location จำนวน และเลขชุดเบิกให้ครบ');
        if (requestIds.has(line.requestId.toLowerCase())) fail(400, 'มีรหัสคำขอซ้ำในชุดเบิก');
        requestIds.add(line.requestId.toLowerCase());
        if (!warehouseScope.has(req, line.whid)) fail(403, 'ไม่มีสิทธิ์เบิกจากคลังที่เลือก');
      }

      const pool = await poolPromise;
      tx = new sql.Transaction(pool);
      await tx.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
      const rq = () => new sql.Request(tx);
      const results = [];

      for (const line of lines) {
        const wh = (await rq().input('Wh', sql.Int, line.whid).query('SELECT whid FROM dbMaster.dbo.tblWH WITH(UPDLOCK,HOLDLOCK) WHERE whid=@Wh')).recordset[0];
        if (!wh) fail(400, 'ไม่พบคลัง');
        const prior = (await rq().input('Key', sql.UniqueIdentifier, line.requestId).query('SELECT * FROM dbWMS.dbo.PickOperations WITH(UPDLOCK,HOLDLOCK) WHERE RequestId=@Key')).recordset[0];
        const note = line.note.trim();
        if (prior) {
          if (prior.PickType !== 'FG' || prior.ProductId !== line.productId || prior.WhId !== line.whid || prior.FromLocationCode !== line.fromLocationCode ||
            Number(prior.Quantity) !== Number(line.quantity) || prior.ToLocationCode !== line.toLocationCode || prior.ReferenceNo !== line.referenceNo.trim() || prior.Note !== note) {
            fail(409, 'รหัสคำขอถูกใช้กับข้อมูลอื่นแล้ว');
          }
          results.push({ PickId: prior.PickId, PickNo: prior.PickNo, duplicate: true });
          continue;
        }

        const stock = (await rq().query(balances)).recordset.find(s => s.whid === line.whid && s.ProductId === line.productId && s.LocationCode === line.fromLocationCode);
        if (!stock || stock.PickType !== 'FG') fail(400, 'ไม่พบสินค้า FG ในตำแหน่งต้นทาง');
        if (stock.IsDamage) fail(409, 'สินค้าชำรุด DAMAGE ห้ามเบิกปกติ');
        if (Number(line.quantity) > stock.Quantity - stock.ReservedQuantity + 0.000001) fail(409, 'จำนวนเกินยอดพร้อมเบิก กรุณารีเฟรชข้อมูล');

        const lots = await require('../services/stock-lot-details').load(pool, sql, line.productId, [stock], rq);
        if (Math.abs(lots.reduce((sum, lot) => sum + Number(lot.Quantity), 0) - Number(stock.Quantity)) > 0.005) fail(409, 'ยอด LOT ไม่ตรงกับยอดสต๊อก กรุณาตรวจสอบก่อนเบิก');
        const allocation = allocateFGLots(availableFGLots(lots, stock.ReservedQuantity), line.quantity);
        if (!allocation) fail(409, 'ยอด LOT พร้อมหยิบไม่พอ กรุณาปรับจำนวนในชุดเบิก');

        const to = (await rq().input('Wh', sql.Int, line.whid).input('To', sql.NVarChar(50), line.toLocationCode)
          .query("SELECT LocationCode FROM dbMaster.dbo.Locations WITH(HOLDLOCK) WHERE whid=@Wh AND LocationCode=@To AND UPPER(Zone)='OUT' AND IsActive=1")).recordset[0]?.LocationCode;
        if (!to) fail(400, 'FG ต้องย้ายไปตำแหน่ง OUT ในคลังเดียวกัน');

        const pickNo = 'PICK-FG-' + randomUUID().slice(0, 18).toUpperCase();
        const actor = String(req.user.username || req.user.id).slice(0, 50);
        const remark = note || ('ชุดเบิก ' + line.referenceNo.trim()).slice(0, 255);
        await rq().input('Wh', sql.Int, line.whid).input('Product', sql.Int, line.productId).input('Barcode', sql.NVarChar(50), stock.Barcode)
          .input('From', sql.NVarChar(50), line.fromLocationCode).input('To', sql.NVarChar(50), to).input('Qty', sql.Decimal(18, 2), line.quantity)
          .input('No', sql.NVarChar(60), pickNo).input('By', sql.NVarChar(50), actor).input('Note', sql.NVarChar(255), remark).query(`
DECLARE @Old DECIMAL(18,2),@DestinationOld DECIMAL(18,2),@DestinationId INT;
SELECT @Old=Quantity FROM dbWMS.dbo.tblStock WITH(UPDLOCK,HOLDLOCK) WHERE whid=@Wh AND ProductId=@Product AND LocationCode=@From;
IF @Old IS NULL OR @Old<@Qty THROW 51000, N'ยอดสต๊อกไม่เพียงพอ',1;
UPDATE dbWMS.dbo.tblStock SET Quantity=Quantity-@Qty,UpdatedAt=SYSDATETIME() WHERE whid=@Wh AND ProductId=@Product AND LocationCode=@From;
INSERT INTO dbWMS.dbo.tblStockTransactions(TransType,whid,ProductId,Barcode,LocationCode,QtyChange,QtyAfter,RefDocNo,Remark,CreatedBy,CreatedAt) VALUES(N'PICK',@Wh,@Product,@Barcode,@From,-@Qty,@Old-@Qty,@No,@Note,@By,SYSDATETIME());
SELECT @DestinationOld=Quantity,@DestinationId=StockId FROM dbWMS.dbo.tblStock WITH(UPDLOCK,HOLDLOCK) WHERE whid=@Wh AND ProductId=@Product AND LocationCode=@To;
SET @DestinationOld=COALESCE(@DestinationOld,0);
IF @DestinationId IS NULL INSERT INTO dbWMS.dbo.tblStock(whid,ProductId,Barcode,LocationCode,Quantity,CreatedAt,UpdatedAt) VALUES(@Wh,@Product,@Barcode,@To,@Qty,SYSDATETIME(),SYSDATETIME());
ELSE UPDATE dbWMS.dbo.tblStock SET Quantity=Quantity+@Qty,UpdatedAt=SYSDATETIME() WHERE StockId=@DestinationId;
INSERT INTO dbWMS.dbo.tblStockTransactions(TransType,whid,ProductId,Barcode,LocationCode,QtyChange,QtyAfter,RefDocNo,Remark,CreatedBy,CreatedAt) VALUES(N'PICK',@Wh,@Product,@Barcode,@To,@Qty,@DestinationOld+@Qty,@No,N'FG พักรอส่งที่ OUT',@By,SYSDATETIME());`);

        const pick = (await rq().input('Key', sql.UniqueIdentifier, line.requestId).input('No', sql.NVarChar(40), pickNo).input('Wh', sql.Int, line.whid)
          .input('Product', sql.Int, line.productId).input('From', sql.NVarChar(50), line.fromLocationCode).input('To', sql.NVarChar(50), to)
          .input('Qty', sql.Decimal(18, 2), line.quantity).input('Document', sql.NVarChar(60), line.referenceNo.trim()).input('Note', sql.NVarChar(255), note)
          .input('By', sql.NVarChar(50), actor).query("INSERT INTO dbWMS.dbo.PickOperations(RequestId,PickNo,PickType,WhId,ProductId,FromLocationCode,ToLocationCode,Quantity,ReferenceNo,Note,CreatedBy) OUTPUT inserted.PickId VALUES(@Key,@No,'FG',@Wh,@Product,@From,@To,@Qty,@Document,@Note,@By)")).recordset[0];
        for (let i = 0; i < allocation.length; i++) {
          const lot = allocation[i];
          await rq().input('Pick', sql.Int, pick.PickId).input('Line', sql.Int, i + 1).input('Wh', sql.Int, line.whid).input('Product', sql.Int, line.productId)
            .input('From', sql.NVarChar(50), line.fromLocationCode).input('To', sql.NVarChar(50), to).input('Ana', sql.NVarChar(100), lot.AnaNo)
            .input('Lot', sql.NVarChar(100), lot.LotNo).input('Date', sql.DateTime2, lot.FifoDate ? new Date(lot.FifoDate) : null).input('Qty', sql.Decimal(18, 2), lot.Quantity)
            .query('INSERT INTO dbWMS.dbo.FGLotPickLines(PickId,[LineNo],WhId,ProductId,FromLocationCode,ToLocationCode,AnaNo,LotNo,FifoDate,Quantity) VALUES(@Pick,@Line,@Wh,@Product,@From,@To,@Ana,@Lot,@Date,@Qty)');
        }
        results.push({ PickId: pick.PickId, PickNo: pickNo, duplicate: false });
      }
      await tx.commit();
      res.status(201).json({ success: true, atomic: true, results });
    } catch (e) {
      if (tx) try { await tx.rollback(); } catch {}
      const message = e.number === 208 && String(e.message).includes('FGLotPickLines') ? 'ยังไม่ได้ติดตั้ง mssql/FGLotPickTracking.sql กรุณาติดตั้งก่อนเบิก FG แบบ FIFO/LOT' : e.number === 51000 ? 'ยอดสต๊อกเปลี่ยนระหว่างยืนยัน กรุณาโหลดข้อมูลแล้วตรวจชุดเบิกใหม่' : e.status ? e.message : 'ทำรายการเบิก FG ทั้งชุดไม่สำเร็จ';
      console.error('FG batch picking:', e.code || e.status);
      res.status(e.status || (e.number === 208 ? 503 : e.number === 51000 ? 409 : 500)).json({ success: false, message });
    }
  });
  return router;
};
