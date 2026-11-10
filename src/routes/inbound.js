
const receiveCan = (req, type, action = 'VIEW') =>
    req.navigation?.user.Role === 'ADMIN' ||
    !!req.navigation &&
    require('../middleware/navigation').hasAction(
        req.navigation.profile,
        req.navigation.mode,
        'RECEIVE_' + type,
        action
    );

const express = require('express');
const jwt = require('jsonwebtoken');
const { randomUUID } = require('crypto');
const { poolPromise, sql } = require('../config/db');

const router = express.Router();

const types = ['RM', 'PKG', 'SEMI', 'FG'];

const categoryCodes = {
    RM: ['RM'],
    PKG: ['PKG', 'PACK'],
    SEMI: ['SEMI', 'SFG'],
    FG: ['FG']
};

const qty = v =>
    (typeof v === 'string' || typeof v === 'number') &&
    /^\d{1,12}(?:\.\d{1,2})?$/.test(String(v)) &&
    Number(v) > 0;

const guid = v =>
    typeof v === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

const fail = (status, message) => {
    const e = new Error(message);
    e.status = status;
    throw e;
};

router.use((req, res, next) => {
    try {
        const match = /^Bearer\s+(\S+)$/i.exec(
            req.headers.authorization || ''
        );

        if (!match) {
            return res.status(401).json({
                success: false,
                message: 'กรุณาเข้าสู่ระบบ'
            });
        }

        req.user = jwt.verify(
            match[1],
            process.env.JWT_SECRET ||
            'super_secret_local_warehouse_jwt_key_2026'
        );

        const role = String(req.user.role || '').toUpperCase();

        const permissions = String(req.user.permissions || '')
            .toUpperCase()
            .split(',')
            .map(s => s.trim());

        if (
            !['ADMIN', 'USER'].includes(role) &&
            !permissions.some(p => ['ALL', 'RECEIVE'].includes(p))
        ) {
            return res.status(403).json({
                success: false,
                message: 'ไม่มีสิทธิ์รับสินค้า'
            });
        }

        next();
    } catch {
        return res.status(401).json({
            success: false,
            message: 'เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่'
        });
    }
});

router.param('id', async (req, res, next, value) => {
    try {
        if (!/^[1-9]\d*$/.test(value) ||
            Number(value) > 2147483647) {
            fail(400, 'เลขที่ใบรับไม่ถูกต้อง');
        }

        const p = await poolPromise;

        const row = (
            await p.request()
                .input('Id', sql.Int, Number(value))
                .query(
                    'SELECT ReceiveType FROM dbWMS.dbo.InboundOrders WHERE InboundId=@Id'
                )
        ).recordset[0];

        if (!row) fail(404, 'ไม่พบใบรับ');

        if (!receiveCan(
            req,
            row.ReceiveType,
            req.method === 'GET' ? 'VIEW' : 'CONFIRM'
        )) {
            fail(403, 'ไม่มีสิทธิ์ทำรายการรับสินค้ากลุ่มนี้');
        }

        next();
    } catch (e) {
        error(res, e);
    }
});

// Error Logging - ปรับปรุง
function error(res, e) {
    console.error('[INBOUND ERROR]', {
        message: e.message,
        code: e.code,
        number: e.number,
        status: e.status,
        originalError: e.originalError?.message
    });

    res.status(e.status || 500).json({
        success: false,
        message: e.status
            ? e.message
            : 'เกิดข้อผิดพลาดในระบบรับสินค้า กรุณาติดต่อผู้ดูแลระบบ'
    });
}

router.get('/manufacturer-options', async (req, res) => {
    try {
        const date = req.query.date;

        if (
            typeof date !== 'string' ||
            !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
            !Number.isFinite(Date.parse(date)) ||
            new Date(date).toISOString().slice(0, 10) !== date
        ) {
            fail(400, 'ระบุวันที่เอกสารให้ถูกต้อง');
        }

        const pool = await poolPromise;

        const rows = await require(
            '../services/inbound-manufacturer'
        ).choices(pool.request(), date);

        res.json({
            success: true,
            data: rows.filter(
                x => x.CategoryCode !== 'FG' &&
                    receiveCan(req, x.CategoryCode, 'EDIT')
            )
        });
    } catch (e) {
        error(res, e);
    }
});

router.get('/master', async (req, res) => {
    try {
        const pool = await poolPromise;

        const r = await pool.request().query(`
            SELECT
                rs.PackUnit,
                rs.ContentPerPack,
                rs.ContentUnit,
                rs.BasePerContentUnit,
                rs.BaseUnit,
                p.ProductId,
                p.ProductCode,
                p.ProductName,
                p.ThaiName,
                p.Barcode,
                UPPER(c.CategoryCode) AS CategoryCode,
                COALESCE(u.UnitCode,p.PackageType,N'') AS UOM
            FROM dbMaster.dbo.tblProducts p
            JOIN dbMaster.dbo.tblCategories c
                ON c.CategoryID=p.CategoryId
            LEFT JOIN dbMaster.dbo.tblUnits u
                ON u.UnitId=p.UnitId
            LEFT JOIN dbMaster.dbo.tblRMPackSpecs rs
                ON rs.ProductId=p.ProductId
            WHERE p.IsActive=1
            ORDER BY p.ProductCode;

            SELECT whid,whname,whdescription
            FROM dbMaster.dbo.tblWH
            ORDER BY whid;

            SELECT whid,LocationCode,Zone
            FROM dbMaster.dbo.Locations
            WHERE IsActive=1
            ORDER BY whid,LocationCode;

            SELECT SupplierId,SupplierCode,SupplierName,SupplyTypes
            FROM dbMaster.dbo.tblSuppliers
            WHERE IsActive=1
            ORDER BY SupplierCode;
        `);

        res.json({
            success: true,
            allowedTypes: types.filter(t => receiveCan(req, t)),
            products: r.recordsets[0]
                .map(p => ({
                    ...p,
                    ReceiveType:
                        types.find(
                            t => categoryCodes[t].includes(p.CategoryCode)
                        ) || null
                }))
                .filter(p => receiveCan(req, p.ReceiveType)),
            warehouses: r.recordsets[1],
            locations: r.recordsets[2],
            suppliers: r.recordsets[3].filter(
                s => String(s.SupplyTypes)
                    .split(',')
                    .some(t => receiveCan(req, t))
            )
        });
    } catch (e) {
        error(res, e);
    }
});

router.get('/', async (req, res) => {
    try {
        const pool = await poolPromise;

        const r = await pool.request().query(`
            SELECT
                o.*,
                w.whname,
                COUNT(l.LineId) AS TotalLines,
                SUM(l.OrderedQuantity) AS OrderedQuantity,
                SUM(l.ReceivedQuantity) AS ReceivedQuantity
            FROM dbWMS.dbo.InboundOrders o
            JOIN dbWMS.dbo.InboundLines l
                ON l.InboundId=o.InboundId
            LEFT JOIN dbMaster.dbo.tblWH w
                ON w.whid=o.WhId
            GROUP BY
                o.InboundId,
                o.RequestId,
                o.ReceiveNo,
                o.ReceiveType,
                o.WhId,
                o.ReferenceNo,
                o.SupplierName,
                o.SupplierId,
                o.SupplierDocumentNo,
                o.DocumentDate,
                o.VatRate,
                o.Status,
                o.CreatedBy,
                o.CreatedAt,
                o.SourceMode,
                o.PlanId,
                o.IsCancelled,
                o.CancelledBy,
                o.CancelledAt,
                o.CancelReason,
                w.whname
            ORDER BY o.InboundId DESC
        `);

        res.json({
            success: true,
            data: r.recordset.filter(
                o => receiveCan(req, o.ReceiveType)
            )
        });
    } catch (e) {
        error(res, e);
    }
});

router.get('/:id/lines', async (req, res) => {
    try {
        if (!/^\d+$/.test(req.params.id)) {
            fail(400, 'เลขที่ใบรับไม่ถูกต้อง');
        }

        const pool = await poolPromise;

        const r = await pool.request()
            .input('Id', sql.Int, req.params.id)
            .query(`
                SELECT
                    rp.PackCount,
                    rp.PackUnit,
                    rp.CapacityBase,
                    l.*,
                    p.ProductCode,
                    p.ProductName,
                    p.Barcode,
                    COALESCE(u.UnitCode,p.PackageType,N'') AS UOM
                FROM dbWMS.dbo.InboundLines l
                LEFT JOIN dbWMS.dbo.RMInboundPacks rp
                    ON rp.LineId=l.LineId
                JOIN dbMaster.dbo.tblProducts p
                    ON p.ProductId=l.ProductId
                LEFT JOIN dbMaster.dbo.tblUnits u
                    ON u.UnitId=p.UnitId
                WHERE l.InboundId=@Id
                ORDER BY l.LineId;

                SELECT r.*
                FROM dbWMS.dbo.InboundReceipts r
                JOIN dbWMS.dbo.InboundLines l
                    ON l.LineId=r.LineId
                WHERE l.InboundId=@Id
                ORDER BY r.ReceiptId DESC;

                SELECT *
                FROM dbWMS.dbo.InboundProductionInfo
                WHERE InboundId=@Id
            `);

        if (!r.recordsets[0].length) {
            fail(404, 'ไม่พบใบรับ');
        }

        res.json({
            success: true,
            data: r.recordsets[0],
            receipts: r.recordsets[1],
            production: r.recordsets[2]?.[0] || null
        });
    } catch (e) {
        error(res, e);
    }
});

router.post('/', async (req, res) => {
    let tx;
    try {
        const b = { ...(req.body || {}) };

        b.sourceMode = b.sourceMode ||
            (b.receiveType === 'FG' ? 'PRODUCTION' : 'EXISTING_PO');

        if (
            !['EXISTING_PO', 'NEW_PO', 'PRODUCTION'].includes(b.sourceMode) ||
            (b.receiveType === 'FG') !==
                (b.sourceMode === 'PRODUCTION')
        ) {
            fail(400, 'ประเภทเอกสารต้นทางไม่ตรงกับกลุ่มสินค้า');
        }

        if (b.sourceMode === 'NEW_PO' && guid(b.requestId)) {
            b.referenceNo = 'PO-' + b.requestId.toUpperCase();
        }

        if (b.sourceMode === 'PRODUCTION') {
            b.supplierId = null;
            b.supplierName = 'ฝ่ายผลิต';
            b.vatRate = null;

            if (Array.isArray(b.lines)) {
                b.lines = b.lines.map(l => ({
                    ...l,
                    supplierProductCode: null,
                    unitPrice: null
                }));
            }
        }

        if (!receiveCan(req, b.receiveType, 'EDIT')) {
            fail(403, 'ไม่มีสิทธิ์สร้างใบรับสินค้ากลุ่มนี้');
        }

        if (
            b.sourceMode !== 'PRODUCTION' &&
            (!Number.isInteger(b.supplierId) || b.supplierId <= 0)
        ) {
            fail(400, 'กรุณาเลือก Supplier จาก Master');
        }

        if (
            !types.includes(b.receiveType) ||
            !Number.isInteger(b.whid) ||
            b.whid <= 0 ||
            !guid(b.requestId) ||
            typeof b.referenceNo !== 'string' ||
            !b.referenceNo.trim() ||
            b.referenceNo.length > 60 ||
            typeof b.supplierName !== 'string' ||
            b.supplierName.length > 150 ||
            !Array.isArray(b.lines) ||
            !b.lines.length ||
            b.lines.length > 100 ||
            b.lines.some(
                l => !Number.isInteger(l.productId) || !qty(l.quantity)
            ) ||
            new Set(b.lines.map(l => l.productId)).size !== b.lines.length
        ) {
            fail(
                400,
                'ตรวจประเภท คลัง เอกสาร และจำนวนสินค้าให้ถูกต้อง (ไม่เกิน 100 รายการ)'
            );
        }

        const validDate = v =>
            !v ||
            (
                typeof v === 'string' &&
                /^\d{4}-\d{2}-\d{2}$/.test(v) &&
                Number.isFinite(Date.parse(v)) &&
                new Date(v).toISOString().slice(0, 10) === v
            );

        if (
            (b.supplierDocumentNo != null &&
                (typeof b.supplierDocumentNo !== 'string' ||
                    b.supplierDocumentNo.length > 60)) ||
            !validDate(b.documentDate) ||
            (b.vatRate != null &&
                (!/^\d{1,3}(?:\.\d{1,2})?$/.test(String(b.vatRate)) ||
                    Number(b.vatRate) > 100)) ||
            b.lines.some(l =>
                (l.supplierProductCode != null &&
                    (typeof l.supplierProductCode !== 'string' ||
                        l.supplierProductCode.length > 60)) ||
                (l.unitPrice != null &&
                    (!['string', 'number'].includes(typeof l.unitPrice) ||
                        !/^\d{1,10}(?:\.\d{1,4})?$/.test(String(l.unitPrice))))
            )
        ) {
            fail(400, 'ตรวจเลขเอกสาร วันที่ VAT และราคาต่อหน่วยให้ถูกต้อง');
        }

        if (b.sourceMode === 'PRODUCTION') {
            for (const [key, max] of [
                ['formulaCode', 60],
                ['formulaName', 200],
                ['productionSender', 150],
                ['productionRemark', 500]
            ]) {
                if (
                    b[key] != null &&
                    (typeof b[key] !== 'string' || b[key].length > max)
                ) {
                    fail(400, 'ตรวจข้อมูลใบรับจากการผลิต');
                }
            }

            for (const l of b.lines) {
                for (const key of ['anaNo', 'lotNo']) {
                    if (
                        l[key] != null &&
                        (typeof l[key] !== 'string' ||
                            l[key].length > 60)
                    ) {
                        fail(400, 'ANA และ LOT ต้องไม่เกิน 60 ตัวอักษร');
                    }
                }
            }
        }

        if (
            b.sourceMode === 'NEW_PO' &&
            (!b.documentDate ||
                b.lines.some(l =>
                    l.unitPrice == null || l.unitPrice === ''
                ))
        ) {
            fail(400, 'สร้าง PO ต้องระบุวันที่และราคาต่อหน่วยทุกรายการ');
        }

        if (
            b.sourceMode === 'EXISTING_PO' &&
            b.receiveType === 'PKG' &&
            (!b.supplierDocumentNo?.trim() || !b.documentDate)
        ) {
            fail(400, 'รับ Pack ต้องระบุเลขใบส่งสินค้าและวันที่เอกสาร');
        }

        const pool = await poolPromise;
        tx = new sql.Transaction(pool);
        await tx.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);

        const request = () => new sql.Request(tx);

        const prior = await request()
            .input('Request', sql.UniqueIdentifier, b.requestId)
            .query(`
                SELECT *
                FROM dbWMS.dbo.InboundOrders WITH(UPDLOCK,HOLDLOCK)
                WHERE RequestId=@Request
            `);

        if (prior.recordset.length) {
            const h = prior.recordset[0];

            if (h.IsCancelled) {
                fail(409, 'ใบรับนี้ยกเลิกแล้ว กรุณาสร้างรายการใหม่');
            }

            const saved = (
                await request()
                    .input('Order', sql.Int, h.InboundId)
                    .query(`
                        SELECT
                            l.ProductId,
                            l.OrderedQuantity,
                            l.SupplierProductCode,
                            l.UnitPrice,
                            l.AnaNo,
                            l.ProductionLotNo,
                            rp.PackCount,
                            rp.ContentPerPack
                        FROM dbWMS.dbo.InboundLines l
                        LEFT JOIN dbWMS.dbo.RMInboundPacks rp
                            ON rp.LineId=l.LineId
                        WHERE InboundId=@Order
                    `)
            ).recordset;

            for (const l of b.lines) {
                if (
                    l.packCount != null &&
                    l.packContentPerPack == null
                ) {
                    l.packContentPerPack = saved.find(
                        x => x.ProductId === l.productId
                    )?.ContentPerPack;
                }
            }

            const canon = rows => rows.map(l => [
                l.ProductId ?? l.productId,
                Number(l.OrderedQuantity ?? l.quantity),
                (l.SupplierProductCode ?? l.supplierProductCode ?? '').trim(),
                (l.UnitPrice ?? l.unitPrice) == null
                    ? null
                    : Number(l.UnitPrice ?? l.unitPrice),
                (l.AnaNo ?? l.anaNo ?? '').trim(),
                (l.ProductionLotNo ?? l.lotNo ?? '').trim(),
                l.PackCount ?? l.packCount ?? null,
                l.packCount == null && l.PackCount == null
                    ? null
                    : Number(l.ContentPerPack ?? l.packContentPerPack ?? 0)
            ]).sort((a, b) => a[0] - b[0]);

            if ((h.PlanId || null) !== (b.planId || null)) {
                fail(409, 'แผนต่างจากคำขอเดิม');
            }

            if (
                h.SourceMode !== b.sourceMode ||
                h.ReceiveType !== b.receiveType ||
                h.WhId !== b.whid ||
                h.SupplierId !== b.supplierId ||
                h.ReferenceNo !== b.referenceNo.trim() ||
                (h.SupplierDocumentNo || '') !==
                    (b.supplierDocumentNo?.trim() || '') ||
                (h.DocumentDate
                    ? new Date(h.DocumentDate).toISOString().slice(0, 10)
                    : '') !== (b.documentDate || '') ||
                (h.VatRate == null ? null : Number(h.VatRate)) !==
                    (b.vatRate == null ? null : Number(b.vatRate)) ||
                JSON.stringify(canon(saved)) !==
                    JSON.stringify(canon(b.lines))
            ) {
                fail(
                    409,
                    'รหัสคำขอถูกใช้กับใบรับข้อมูลอื่นแล้ว กรุณาตรวจใบรับเดิม'
                );
            }

            if (b.sourceMode === 'PRODUCTION') {
                const info = (
                    await request()
                        .input('I', sql.Int, h.InboundId)
                        .query(`
                            SELECT *
                            FROM dbWMS.dbo.InboundProductionInfo
                            WHERE InboundId=@I
                        `)
                ).recordset[0] || {};

                if ([
                    ['FormulaCode', 'formulaCode'],
                    ['FormulaName', 'formulaName'],
                    ['ProductionSender', 'productionSender'],
                    ['Remark', 'productionRemark']
                ].some(
                    ([a, k]) => (info[a] || '') !== (b[k] || '').trim()
                )) {
                    fail(409, 'ข้อมูลการผลิตต่างจากคำขอเดิม');
                }
            }

            await tx.commit();

            return res.json({
                success: true,
                InboundId: h.InboundId,
                ReceiveNo: h.ReceiveNo
            });
        }

        if (b.sourceMode !== 'PRODUCTION' && !b.documentDate) {
            fail(400, 'ระบุวันที่เอกสารเพื่อตรวจผู้ผลิต–สินค้า');
        }

        const manufacturerRows =
            b.sourceMode === 'PRODUCTION'
                ? []
                : await require(
                    '../services/inbound-manufacturer'
                ).choices(request(), b.documentDate);

        const manufacturerLinks =
            b.sourceMode === 'PRODUCTION'
                ? []
                : b.lines.map(l =>
                    require('../services/inbound-manufacturer')
                        .selectLink(
                            manufacturerRows,
                            l,
                            b.supplierId
                        )
                );

        const linkedPlan = await require(
            '../services/plan-documents'
        ).validate(request, 'inbound', b);

        const supplier =
            b.sourceMode === 'PRODUCTION'
                ? {
                    SupplierName: 'ฝ่ายผลิต',
                    SupplyTypes: 'FG'
                }
                : (
                    await request()
                        .input('Id', sql.Int, b.supplierId)
                        .query(`
                            SELECT SupplierName,SupplyTypes
                            FROM dbMaster.dbo.tblSuppliers WITH(HOLDLOCK)
                            WHERE SupplierId=@Id AND IsActive=1
                        `)
                ).recordset[0];

        if (
            !supplier ||
            !supplier.SupplyTypes.split(',').includes(b.receiveType)
        ) {
            fail(
                400,
                'Supplier ไม่เปิดใช้งานหรือไม่รองรับกลุ่มสินค้านี้'
            );
        }

        for (const line of b.lines) {
            if (line.supplierProductCode) {
                const mapped = (
                    await request()
                        .input('Supplier', sql.Int, b.supplierId)
                        .input(
                            'Code',
                            sql.NVarChar(60),
                            line.supplierProductCode.trim()
                        )
                        .query(`
                            SELECT ProductId,IsActive
                            FROM dbMaster.dbo.tblSupplierProducts WITH(HOLDLOCK)
                            WHERE SupplierId=@Supplier
                              AND SupplierProductCode=@Code
                        `)
                ).recordset[0];

                if (
                    mapped &&
                    (!mapped.IsActive ||
                        mapped.ProductId !== line.productId)
                ) {
                    fail(
                        400,
                        'รหัสสินค้าผู้ขายไม่ตรงกับ Master หรือถูกปิดใช้งาน'
                    );
                }
            }
        }

        const wh = await request()
            .input('Wh', sql.Int, b.whid)
            .query(`
                SELECT whid
                FROM dbMaster.dbo.tblWH
                WHERE whid=@Wh
            `);

        if (!wh.recordset.length) {
            fail(400, 'ไม่พบคลัง');
        }

        for (const line of b.lines) {
            const p = (
                await request()
                    .input('Id', sql.Int, line.productId)
                    .query(`
                        SELECT UPPER(c.CategoryCode) AS Code
                        FROM dbMaster.dbo.tblProducts p
                        JOIN dbMaster.dbo.tblCategories c
                            ON c.CategoryID=p.CategoryId
                        WHERE p.ProductId=@Id AND p.IsActive=1
                    `)
            ).recordset[0];

            if (
                !p ||
                !categoryCodes[b.receiveType].includes(p.Code)
            ) {
                fail(
                    400,
                    'สินค้าไม่ตรงประเภทใบรับหรือถูกปิดใช้งาน'
                );
            }
        }

        const packSpecs = new Map();

        for (const l of b.lines) {
            if (l.packCount == null) continue;

            if (
                b.receiveType !== 'RM' ||
                !Number.isInteger(l.packCount) ||
                l.packCount < 1 ||
                l.packCount > 200
            ) {
                fail(
                    400,
                    'รับแบบกล่องใช้ RM จำนวนเต็ม 1–200 ภาชนะ'
                );
            }

            const spec = (
                await request()
                    .input('P', sql.Int, l.productId)
                    .query(`
                        SELECT s.*,u.UnitCode CurrentUnit
                        FROM dbMaster.dbo.tblRMPackSpecs s WITH(HOLDLOCK)
                        JOIN dbMaster.dbo.tblProducts p
                            ON p.ProductId=s.ProductId
                        JOIN dbMaster.dbo.tblUnits u
                            ON u.UnitId=p.UnitId
                        WHERE s.ProductId=@P
                    `)
            ).recordset[0];

            if (!spec || spec.BaseUnit !== spec.CurrentUnit) {
                fail(
                    409,
                    'กำหนดหน่วยบรรจุ RM ให้ตรงกับหน่วยสต๊อก'
                );
            }

            if (l.packContentPerPack != null) {
                if (
                    require('../services/rm-units')
                        .scaled(l.packContentPerPack) <= 0n
                ) {
                    fail(400, 'ปริมาณต่อกล่องต้องมากกว่า 0');
                }

                spec.ContentPerPack = l.packContentPerPack;
            }

            spec.CapacityBase = Number(
                require('../services/rm-units')
                    .baseAmount('1', spec, true)
            );

            if (
                Number(l.quantity) !== Number(
                    require('../services/rm-units')
                        .baseAmount(l.packCount, spec, true)
                )
            ) {
                fail(
                    409,
                    'อัตราบรรจุเปลี่ยน กรุณาโหลดรายการใหม่'
                );
            }

            packSpecs.set(l.productId, spec);
        }

        const no =
            'RCV-' +
            b.receiveType +
            '-' +
            randomUUID().slice(0, 18).toUpperCase();

        const order = await request()
            .input('Request', sql.UniqueIdentifier, b.requestId)
            .input('No', sql.NVarChar(40), no)
            .input('Type', sql.VarChar(4), b.receiveType)
            .input('Wh', sql.Int, b.whid)
            .input('Ref', sql.NVarChar(60), b.referenceNo.trim())
            .input(
                'Supplier',
                sql.NVarChar(150),
                supplier.SupplierName
            )
            .input('SupplierId', sql.Int, b.supplierId)
            .input(
                'Doc',
                sql.NVarChar(60),
                b.supplierDocumentNo?.trim() || null
            )
            .input('Date', sql.Date, b.documentDate || null)
            .input('Vat', sql.Decimal(5, 2), b.vatRate ?? null)
            .input(
                'By',
                sql.NVarChar(50),
                String(req.user.username || req.user.id).slice(0, 50)
            )
            .input('SourceMode', sql.VarChar(16), b.sourceMode)
            .query(`
                INSERT INTO dbWMS.dbo.InboundOrders
                (
                    SourceMode,
                    RequestId,
                    ReceiveNo,
                    ReceiveType,
                    WhId,
                    ReferenceNo,
                    SupplierName,
                    SupplierId,
                    SupplierDocumentNo,
                    DocumentDate,
                    VatRate,
                    CreatedBy
                )
                OUTPUT inserted.InboundId,inserted.ReceiveNo
                VALUES
                (
                    @SourceMode,
                    @Request,
                    @No,
                    @Type,
                    @Wh,
                    @Ref,
                    @Supplier,
                    @SupplierId,
                    @Doc,
                    @Date,
                    @Vat,
                    @By
                )
            `);

        if (linkedPlan) {
            await request()
                .input('P', sql.Int, linkedPlan)
                .input('I', sql.Int, order.recordset[0].InboundId)
                .query(`
                    UPDATE dbWMS.dbo.InboundOrders
                    SET PlanId=@P
                    WHERE InboundId=@I
                `);
        }

        for (const l of b.lines) {
            await request()
                .input('Order', sql.Int, order.recordset[0].InboundId)
                .input('Product', sql.Int, l.productId)
                .input('Qty', sql.Decimal(18, 2), l.quantity)
                .input(
                    'SupplierCode',
                    sql.NVarChar(60),
                    l.supplierProductCode?.trim() || null
                )
                .input(
                    'Price',
                    sql.Decimal(18, 4),
                    l.unitPrice ?? null
                )
                .input(
                    'Ana',
                    sql.NVarChar(60),
                    b.sourceMode === 'PRODUCTION'
                        ? l.anaNo?.trim() || null
                        : null
                )
                .input(
                    'Lot',
                    sql.NVarChar(60),
                    b.sourceMode === 'PRODUCTION'
                        ? l.lotNo?.trim() || null
                        : null
                )
                .query(`
                    INSERT INTO dbWMS.dbo.InboundLines
                    (
                        InboundId,
                        ProductId,
                        OrderedQuantity,
                        SupplierProductCode,
                        UnitPrice,
                        AnaNo,
                        ProductionLotNo
                    )
                    VALUES
                    (
                        @Order,
                        @Product,
                        @Qty,
                        @SupplierCode,
                        @Price,
                        @Ana,
                        @Lot
                    )
                `);
        }

        for (const link of manufacturerLinks) {
            await request()
                .input('Order', sql.Int, order.recordset[0].InboundId)
                .input('Product', sql.Int, link.ProductId)
                .input('Link', sql.Int, link.LinkId)
                .input('M', sql.Int, link.ManufacturerId)
                .input('S', sql.Int, link.SupplierId)
                .input('Date', sql.Date, b.documentDate)
                .input(
                    'Json',
                    sql.NVarChar(sql.MAX),
                    JSON.stringify(link)
                )
                .query(`
                    INSERT dbWMS.dbo.InboundManufacturerLinks
                    (
                        LineId,
                        LinkId,
                        ManufacturerId,
                        SupplierId,
                        DocumentDate,
                        LinkSnapshot
                    )
                    SELECT
                        LineId,
                        @Link,
                        @M,
                        @S,
                        @Date,
                        @Json
                    FROM dbWMS.dbo.InboundLines
                    WHERE InboundId=@Order
                      AND ProductId=@Product
                `);
        }

        for (const l of b.lines) {
            const spec = packSpecs.get(l.productId);
            if (!spec) continue;

            await request()
                .input('Order', sql.Int, order.recordset[0].InboundId)
                .input('P', sql.Int, l.productId)
                .input('Count', sql.Int, l.packCount)
                .input('Pack', sql.NVarChar(30), spec.PackUnit)
                .input(
                    'Per',
                    sql.Decimal(18, 6),
                    spec.ContentPerPack
                )
                .input('Unit', sql.NVarChar(30), spec.ContentUnit)
                .input(
                    'Factor',
                    sql.Decimal(18, 6),
                    spec.BasePerContentUnit
                )
                .input('Base', sql.NVarChar(30), spec.BaseUnit)
                .input(
                    'Capacity',
                    sql.Decimal(18, 2),
                    spec.CapacityBase
                )
                .query(`
                    INSERT dbWMS.dbo.RMInboundPacks
                    SELECT
                        LineId,
                        @Count,
                        @Pack,
                        @Per,
                        @Unit,
                        @Factor,
                        @Base,
                        @Capacity
                    FROM dbWMS.dbo.InboundLines
                    WHERE InboundId=@Order
                      AND ProductId=@P
                `);
        }

        if (b.sourceMode === 'PRODUCTION') {
            await request()
                .input('I', sql.Int, order.recordset[0].InboundId)
                .input(
                    'Code',
                    sql.NVarChar(60),
                    b.formulaCode?.trim() || null
                )
                .input(
                    'Name',
                    sql.NVarChar(200),
                    b.formulaName?.trim() || null
                )
                .input(
                    'Sender',
                    sql.NVarChar(150),
                    b.productionSender?.trim() || null
                )
                .input(
                    'Remark',
                    sql.NVarChar(500),
                    b.productionRemark?.trim() || null
                )
                .query(`
                    INSERT dbWMS.dbo.InboundProductionInfo
                    (
                        InboundId,
                        FormulaCode,
                        FormulaName,
                        ProductionSender,
                        Remark
                    )
                    VALUES
                    (
                        @I,
                        @Code,
                        @Name,
                        @Sender,
                        @Remark
                    )
                `);
        }

        if (b.sourceMode === 'NEW_PO') {
            const po = (
                await request()
                    .input('No', sql.NVarChar(60), b.referenceNo)
                    .input(
                        'Order',
                        sql.Int,
                        order.recordset[0].InboundId
                    )
                    .input('Supplier', sql.Int, b.supplierId)
                    .input('Type', sql.VarChar(4), b.receiveType)
                    .input('Wh', sql.Int, b.whid)
                    .input('Date', sql.Date, b.documentDate)
                    .input('Vat', sql.Decimal(5, 2), b.vatRate ?? 0)
                    .input(
                        'By',
                        sql.NVarChar(50),
                        String(req.user.username || req.user.id)
                            .slice(0, 50)
                    )
                    .query(`
                        INSERT dbWMS.dbo.PurchaseOrders
                        (
                            PONo,
                            InboundId,
                            SupplierId,
                            ReceiveType,
                            WhId,
                            DocumentDate,
                            VatRate,
                            CreatedBy
                        )
                        OUTPUT inserted.PurchaseOrderId
                        VALUES
                        (
                            @No,
                            @Order,
                            @Supplier,
                            @Type,
                            @Wh,
                            @Date,
                            @Vat,
                            @By
                        )
                    `)
            ).recordset[0];

            for (const l of b.lines) {
                await request()
                    .input('Po', sql.Int, po.PurchaseOrderId)
                    .input('Product', sql.Int, l.productId)
                    .input('Qty', sql.Decimal(18, 2), l.quantity)
                    .input('Price', sql.Decimal(18, 4), l.unitPrice)
                    .input(
                        'Code',
                        sql.NVarChar(60),
                        l.supplierProductCode?.trim() || null
                    )
                    .query(`
                        INSERT dbWMS.dbo.PurchaseOrderLines
                        (
                            PurchaseOrderId,
                            ProductId,
                            Quantity,
                            UnitPrice,
                            SupplierProductCode
                        )
                        VALUES
                        (
                            @Po,
                            @Product,
                            @Qty,
                            @Price,
                            @Code
                        )
                    `);
            }
        }

        await tx.commit();

        res.status(201).json({
            success: true,
            ...order.recordset[0]
        });
    } catch (e) {
        if (tx) {
            try {
                await tx.rollback();
            } catch {}
        }
        error(res, e);
    }
});



router.post('/:id/receive', async (req, res) => {
    let tx;
    try {
        const b = req.body || {};

        if (
            !/^\d+$/.test(req.params.id) ||
            !guid(b.requestId) ||
            !Number.isInteger(b.lineId) ||
            !qty(b.quantity) ||
            typeof b.locationCode !== 'string' ||
            !b.locationCode ||
            b.locationCode.length > 50 ||
            typeof b.lotNo !== 'string' ||
            b.lotNo.length > 60
        ) {
            fail(400, 'กรุณาระบุรายการ จำนวนรับ และตำแหน่งให้ถูกต้อง');
        }

        for (const v of [b.mfgDate, b.expDate]) {
            if (
                v &&
                (!/^\d{4}-\d{2}-\d{2}$/.test(v) ||
                    !Number.isFinite(Date.parse(v)) ||
                    new Date(v).toISOString().slice(0, 10) !== v)
            ) {
                fail(400, 'วันที่ไม่ถูกต้อง');
            }
        }

        if (b.mfgDate && b.expDate && b.expDate < b.mfgDate) {
            fail(400, 'วันหมดอายุต้องไม่ก่อนวันผลิต');
        }

        const pool = await poolPromise;
        tx = new sql.Transaction(pool);
        await tx.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);

        const request = () => new sql.Request(tx);

        const hint = (
            await request()
                .input('I', sql.Int, Number(req.params.id))
                .query(`
                    SELECT WhId
                    FROM dbWMS.dbo.InboundOrders
                    WHERE InboundId=@I
                `)
        ).recordset[0];

        if (hint) {
            await request()
                .input('W', sql.Int, hint.WhId)
                .query(`
                    SELECT whid
                    FROM dbMaster.dbo.tblWH WITH(UPDLOCK,HOLDLOCK)
                    WHERE whid=@W
                `);
        }

        const o = (
            await request()
                .input('Id', sql.Int, req.params.id)
                .query(`
                    SELECT *
                    FROM dbWMS.dbo.InboundOrders WITH(UPDLOCK,HOLDLOCK)
                    WHERE InboundId=@Id
                `)
        ).recordset[0];

        if (!o) fail(404, 'ไม่พบใบรับ');

        if (o.IsCancelled) {
            fail(409, 'ใบรับนี้ยกเลิกแล้ว ไม่สามารถรับเพิ่ม');
        }

        const prior = (
            await request()
                .input('Key', sql.UniqueIdentifier, b.requestId)
                .query(`
                    SELECT r.*,l.InboundId
                    FROM dbWMS.dbo.InboundReceipts r WITH(UPDLOCK,HOLDLOCK)
                    JOIN dbWMS.dbo.InboundLines l
                        ON l.LineId=r.LineId
                    WHERE r.RequestId=@Key
                `)
        ).recordset[0];

        if (prior) {
            if (
                prior.LineId !== b.lineId ||
                prior.InboundId !== Number(req.params.id) ||
                Number(prior.Quantity) !== Number(b.quantity) ||
                prior.LocationCode.toUpperCase() !==
                    b.locationCode.trim().toUpperCase() ||
                (prior.LotNo || '') !== b.lotNo.trim() ||
                [
                    ['MfgDate', 'mfgDate'],
                    ['ExpDate', 'expDate']
                ].some(
                    ([db, key]) =>
                        (prior[db]
                            ? new Date(prior[db])
                                .toISOString()
                                .slice(0, 10)
                            : '') !== (b[key] || '')
                )
            ) {
                fail(
                    409,
                    'รหัสคำขอถูกใช้กับข้อมูลรับสินค้าอื่นแล้ว กรุณาตรวจประวัติ'
                );
            }

            await tx.commit();

            return res.json({
                success: true,
                duplicate: true
            });
        }

        const line = (
            await request()
                .input('Line', sql.Int, b.lineId)
                .input('Order', sql.Int, o.InboundId)
                .query(`
                    SELECT l.*,p.Barcode
                    FROM dbWMS.dbo.InboundLines l WITH(UPDLOCK,HOLDLOCK)
                    JOIN dbMaster.dbo.tblProducts p
                        ON p.ProductId=l.ProductId
                    WHERE l.LineId=@Line
                      AND l.InboundId=@Order
                `)
        ).recordset[0];

        if (!line) {
            fail(400, 'รายการไม่อยู่ในใบรับ');
        }

        if (
            o.SourceMode === 'PRODUCTION' &&
            line.ProductionLotNo &&
            line.ProductionLotNo !== b.lotNo.trim()
        ) {
            fail(400, 'LOT ที่ตรวจรับต้องตรงกับใบส่งจากการผลิต');
        }

        if (
            Math.round(Number(b.quantity) * 100) >
            Math.round(
                (line.OrderedQuantity - line.ReceivedQuantity) * 100
            )
        ) {
            fail(409, 'จำนวนรับเกินยอดคงค้าง กรุณารีเฟรชข้อมูล');
        }

        const pack = (
            await request()
                .input('Line', sql.Int, b.lineId)
                .query(`
                    SELECT *
                    FROM dbWMS.dbo.RMInboundPacks WITH(HOLDLOCK)
                    WHERE LineId=@Line
                `)
        ).recordset[0];

        if (pack) {
            const count =
                Number(b.quantity) / Number(pack.CapacityBase);

            if (
                !Number.isInteger(count) ||
                count < 1 ||
                count > 200 ||
                !b.lotNo.trim()
            ) {
                fail(
                    400,
                    'รับ RM เป็นภาชนะเต็ม 1–200 กล่อง และระบุ Supplier Lot'
                );
            }

            const wh = (
                await request()
                    .input('Wh', sql.Int, o.WhId)
                    .query(`
                        SELECT whname
                        FROM dbMaster.dbo.tblWH
                        WHERE whid=@Wh
                    `)
            ).recordset[0];

            if (wh?.whname !== 'WH01') {
                fail(
                    400,
                    'รับภาชนะ RM จาก Supplier เข้าคลัง WH01 เท่านั้น'
                );
            }
        }

        const loc = (
            await request()
                .input('Wh', sql.Int, o.WhId)
                .input('Loc', sql.NVarChar(50), b.locationCode)
                .query(`
                    SELECT LocationCode
                    FROM dbMaster.dbo.Locations
                    WHERE whid=@Wh
                      AND LocationCode=@Loc
                      AND IsActive=1
                      AND UPPER(Zone)=NCHAR(82)+NCHAR(67)+NCHAR(86)
                `)
        ).recordset[0];

        if (!loc) {
            fail(
                400,
                'กรุณาเลือกตำแหน่งโซนรับเข้า RCV ในคลังที่เลือก'
            );
        }

        const by = String(
            req.user.username || req.user.id
        ).slice(0, 50);

        await request()
            .input('Wh', sql.Int, o.WhId)
            .input('Product', sql.Int, line.ProductId)
            .input('Barcode', sql.NVarChar(50), line.Barcode)
            .input('Loc', sql.NVarChar(50), loc.LocationCode)
            .input('Qty', sql.Decimal(18, 2), b.quantity)
            .input('Ref', sql.NVarChar(60), o.ReceiveNo)
            .input('By', sql.NVarChar(50), by)
            .query(`
                DECLARE @Old DECIMAL(18,2),@StockId INT;

                SELECT
                    @Old=Quantity,
                    @StockId=StockId
                FROM dbWMS.dbo.tblStock WITH(UPDLOCK,HOLDLOCK)
                WHERE whid=@Wh
                  AND ProductId=@Product
                  AND LocationCode=@Loc;

                SET @Old=COALESCE(@Old,0);

                IF @StockId IS NULL
                    INSERT INTO dbWMS.dbo.tblStock
                    (
                        whid,
                        ProductId,
                        Barcode,
                        LocationCode,
                        Quantity,
                        CreatedAt,
                        UpdatedAt
                    )
                    VALUES
                    (
                        @Wh,
                        @Product,
                        @Barcode,
                        @Loc,
                        @Qty,
                        SYSDATETIME(),
                        SYSDATETIME()
                    );
                ELSE
                    UPDATE dbWMS.dbo.tblStock
                    SET
                        Quantity=Quantity+@Qty,
                        UpdatedAt=SYSDATETIME()
                    WHERE StockId=@StockId;

                INSERT INTO dbWMS.dbo.tblStockTransactions
                (
                    TransType,
                    whid,
                    ProductId,
                    Barcode,
                    LocationCode,
                    QtyChange,
                    QtyAfter,
                    RefDocNo,
                    Remark,
                    CreatedBy,
                    CreatedAt
                )
                VALUES
                (
                    N'RECEIVE',
                    @Wh,
                    @Product,
                    @Barcode,
                    @Loc,
                    @Qty,
                    @Old+@Qty,
                    @Ref,
                    N'รับสินค้าผ่านตรวจ',
                    @By,
                    SYSDATETIME()
                );
            `);

        const received = await request()
            .input('Request', sql.UniqueIdentifier, b.requestId)
            .input('Line', sql.Int, b.lineId)
            .input('Loc', sql.NVarChar(50), loc.LocationCode)
            .input('Qty', sql.Decimal(18, 2), b.quantity)
            .input('Lot', sql.NVarChar(60), b.lotNo.trim() || null)
            .input('Mfg', sql.Date, b.mfgDate || null)
            .input('Exp', sql.Date, b.expDate || null)
            .input('By', sql.NVarChar(50), by)
            .query(`
                INSERT INTO dbWMS.dbo.InboundReceipts
                (
                    RequestId,
                    LineId,
                    LocationCode,
                    Quantity,
                    LotNo,
                    MfgDate,
                    ExpDate,
                    ReceivedBy
                )
                VALUES
                (
                    @Request,
                    @Line,
                    @Loc,
                    @Qty,
                    @Lot,
                    @Mfg,
                    @Exp,
                    @By
                );

                SELECT CAST(SCOPE_IDENTITY() AS int) ReceiptId;

                UPDATE dbWMS.dbo.InboundLines
                SET ReceivedQuantity=ReceivedQuantity+@Qty
                WHERE LineId=@Line;
            `);

        if (pack) {
            for (
                let i = 0;
                i < Number(b.quantity) / Number(pack.CapacityBase);
                i++
            ) {
                await request()
                    .input(
                        'Code',
                        sql.VarChar(50),
                        'BOX-' + randomUUID()
                    )
                    .input('Wh', sql.Int, o.WhId)
                    .input('P', sql.Int, line.ProductId)
                    .input(
                        'Loc',
                        sql.NVarChar(50),
                        loc.LocationCode
                    )
                    .input(
                        'Lot',
                        sql.NVarChar(60),
                        b.lotNo.trim()
                    )
                    .input('Exp', sql.Date, b.expDate || null)
                    .input(
                        'Qty',
                        sql.Decimal(18, 2),
                        pack.CapacityBase
                    )
                    .input(
                        'Receipt',
                        sql.Int,
                        received.recordset[0].ReceiptId
                    )
                    .input('By', sql.NVarChar(100), by)
                    .query(`
                        INSERT dbWMS.dbo.RMContainers
                        (
                            ContainerCode,
                            WhId,
                            ProductId,
                            LocationCode,
                            LotNo,
                            ExpiryDate,
                            CapacityBase,
                            RemainingBase,
                            Status,
                            InboundReceiptId,
                            CreatedBy
                        )
                        VALUES
                        (
                            @Code,
                            @Wh,
                            @P,
                            @Loc,
                            @Lot,
                            @Exp,
                            @Qty,
                            @Qty,
                            'SEALED',
                            @Receipt,
                            @By
                        )
                    `);
            }
        }

        await request()
            .input('Id', sql.Int, o.InboundId)
            .query(`
                UPDATE dbWMS.dbo.InboundOrders
                SET Status=
                    CASE
                        WHEN EXISTS(
                            SELECT 1
                            FROM dbWMS.dbo.InboundLines
                            WHERE InboundId=@Id
                              AND ReceivedQuantity<OrderedQuantity
                        )
                        THEN 'PARTIAL'
                        ELSE 'COMPLETED'
                    END
                WHERE InboundId=@Id
            `);

        await tx.commit();

        res.json({ success: true });
    } catch (e) {
        if (tx) {
            try {
                await tx.rollback();
            } catch {}
        }
        error(res, e);
    }
});

router.post('/:id/cancel', async (req, res) => {
    let tx;

    try {
        if (req.user.role !== 'ADMIN') {
            fail(403, 'เฉพาะ Admin ยกเลิกใบรับได้');
        }

        const reason = req.body?.reason;

        if (
            typeof reason !== 'string' ||
            !reason.trim() ||
            reason.length > 500
        ) {
            fail(400, 'ระบุเหตุผลยกเลิกไม่เกิน 500 ตัวอักษร');
        }

        const p = await poolPromise;
        tx = new sql.Transaction(p);

        await tx.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);

        const q = () => new sql.Request(tx);

        const hint = (
            await q()
                .input('I', sql.Int, Number(req.params.id))
                .query(`
                    SELECT WhId
                    FROM dbWMS.dbo.InboundOrders
                    WHERE InboundId=@I
                `)
        ).recordset[0];

        if (!hint) {
            fail(404, 'ไม่พบใบรับ');
        }

        await q()
            .input('W', sql.Int, hint.WhId)
            .query(`
                SELECT whid
                FROM dbMaster.dbo.tblWH WITH(UPDLOCK,HOLDLOCK)
                WHERE whid=@W
            `);

        const result = await require(
            '../services/inbound-cancel'
        )(
            q,
            Number(req.params.id),
            String(req.user.username || req.user.id).slice(0, 100),
            reason.trim()
        );

        await tx.commit();

        res.json({
            success: true,
            ...result
        });
    } catch (e) {
        if (tx) {
            try {
                await tx.rollback();
            } catch {}
        }

        if (e.number === 51000) {
            e.status = 409;
        }

        error(res, e);
    }
});

module.exports = router;
