let receiveOrders = [];
let receiveProducts = [];
let receiveDraftLines = [];
let receiveShortages = [];

const receiveEsc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const receiveReasonLabels = { SHORT_SHIPMENT: 'ส่งมาไม่ครบ', DAMAGED: 'สินค้าเสียหาย/ชำรุด', OTHER: 'อื่น ๆ' };

async function receivingApi(path, options = {}) {
  const response = await fetch(`/api/receiving${path}`, {
    ...options,
    headers: { ...authHeaders(), ...(options.headers || {}) }
  });
  const payload = await response.json();
  if (response.status === 403 && payload.isExpired) { logout(); throw new Error('เซสชันหมดอายุ'); }
  if (!response.ok || payload.success === false) throw new Error(payload.message || 'ทำรายการรับสินค้าไม่สำเร็จ');
  return payload;
}

async function loadReceiveOrders() {
  const tbody = document.getElementById('receiveOrdersTableBody');
  if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="7" class="text-center py-4 text-muted">กำลังโหลดใบรับสินค้า...</td></tr>';
  try {
    const payload = await receivingApi('');
    receiveOrders = payload.data || [];
    if (!receiveOrders.length) {
      tbody.innerHTML = '<tr><td colspan="7" class="text-center py-4 text-muted">ยังไม่มีใบรับสินค้า สร้างใบรับตาม PO เพื่อเปิดงานให้ Handheld</td></tr>';
      return;
    }
    tbody.innerHTML = receiveOrders.map(order => {
      const completed = order.Status === 'COMPLETED' || order.Status === 'COMPLETED_SHORT';
      const cancelled = order.Status === 'CANCELLED';
      const badge = completed ? 'bg-success' : (cancelled ? 'bg-secondary' : 'bg-warning text-dark');
      return `<tr>
        <td><code>${receiveEsc(order.ReceiveNo)}</code></td>
        <td><strong>${receiveEsc(order.PONumber)}</strong></td>
        <td>${receiveEsc(order.SupplierName || '-')}</td>
        <td>${order.TotalLines} SKU<div class="small text-muted">รับ ${order.ReceivedQuantity}/${order.OrderedQuantity}</div></td>
        <td><span class="badge ${badge}">${order.Status === 'COMPLETED_SHORT' ? 'ปิดรับ / ออก CN แล้ว' : (completed ? 'รับครบแล้ว' : (cancelled ? 'ยกเลิก' : 'เปิดให้ Handheld'))}</span></td>
        <td>${receiveEsc(order.CreatedByName)}<div class="small text-muted">${new Date(order.CreatedAt).toLocaleString('th-TH')}</div></td>
        <td class="text-nowrap"><button class="btn btn-sm btn-outline-primary" onclick="viewReceiveOrder(${Number(order.ReceiveId)})">ดูรายการ</button>${Number(order.ReceivedQuantity) > 0 && !cancelled ? ` <button class="btn btn-sm btn-indigo" onclick="openPutawayFromReceive(${Number(order.ReceiveId)})" title="สร้างใบงานจัดเก็บจากยอดรับ PO">สร้าง PUTAWAY</button>` : ''}</td>
      </tr>`;
    }).join('');
  } catch (error) {
    tbody.innerHTML = `<tr><td colspan="7" class="text-center py-4 text-danger">${receiveEsc(error.message)}</td></tr>`;
  }
  await Promise.all([loadReceiveShortages(), loadCreditNotes()]);
}

async function loadReceiveShortages() {
  const tbody = document.getElementById('receiveShortagesBody');
  if (!tbody) return;
  try {
    const payload = await receivingApi('/pending-shortages');
    const rows = payload.data || [];
    receiveShortages = rows;
    tbody.innerHTML = rows.length ? rows.map(row => `<tr>
      <td><strong>${receiveEsc(row.PONumber)}</strong><div class="small text-muted">${receiveEsc(row.ReceiveNo)}</div></td>
      <td>${receiveEsc(row.ItemCode)}<div>${receiveEsc(row.ItemName)}</div><code>${receiveEsc(row.Barcode)}</code></td>
      <td><strong>${row.Quantity} ${receiveEsc(row.UOM || '')}</strong></td>
      <td>${receiveEsc(row.ReasonName || receiveReasonLabels[row.ReasonCode] || row.ReasonCode)}${row.Note ? `<div class="small text-muted">${receiveEsc(row.Note)}</div>` : ''}</td>
      <td>${receiveEsc(row.RecordedByName)}<div class="small text-muted">${new Date(row.RecordedAt).toLocaleString('th-TH')}</div></td>
      <td class="text-nowrap"><button class="btn btn-sm btn-indigo" onclick="issueReceiveCreditNote(${Number(row.ShortageId)})">ออก CN (รวม PO)</button> <button class="btn btn-sm btn-outline-danger" onclick="cancelReceiveShortage(${Number(row.ShortageId)})" title="ยกเลิกรายการที่บันทึกผิด">ยกเลิก</button></td>
    </tr>`).join('') : '<tr><td colspan="6" class="text-center py-3 text-muted">ไม่มีรายการขาดส่งรอออก CN</td></tr>';
  } catch (error) { tbody.innerHTML = `<tr><td colspan="6" class="text-center py-3 text-danger">${receiveEsc(error.message)}</td></tr>`; }
}

async function loadCreditNotes() {
  const tbody = document.getElementById('creditNotesBody');
  if (!tbody) return;
  try {
    const payload = await receivingApi('/credit-notes');
    const rows = payload.data || [];
    tbody.innerHTML = rows.length ? rows.map(row => `<tr>
      <td><strong>${receiveEsc(row.CreditNoteNo)}</strong></td><td>${receiveEsc(row.PONumber)}</td>
      <td>${receiveEsc(row.Items || '-')}</td>
      <td>${Number(row.Subtotal).toLocaleString('th-TH',{minimumFractionDigits:2})}</td><td>${Number(row.TaxAmount).toLocaleString('th-TH',{minimumFractionDigits:2})}</td><td><strong>${Number(row.TotalAmount).toLocaleString('th-TH',{minimumFractionDigits:2})}</strong></td>
      <td>${receiveEsc(row.IssuedByName)}<div class="small text-muted">${new Date(row.IssuedAt).toLocaleString('th-TH')}</div></td>
    </tr>`).join('') : '<tr><td colspan="7" class="text-center py-3 text-muted">ยังไม่มี CN ที่ออกจากระบบ</td></tr>';
  } catch (error) { tbody.innerHTML = `<tr><td colspan="7" class="text-center py-3 text-danger">${receiveEsc(error.message)}</td></tr>`; }
}

async function issueReceiveCreditNote(shortageId) {
  const row = receiveShortages.find(item => Number(item.ShortageId) === Number(shortageId));
  if (!row) { toast('warning', 'ไม่พบรายการขาดส่งหรือรายการถูกดำเนินการแล้ว'); await loadReceiveOrders(); return; }
  const batch = receiveShortages.filter(item => Number(item.ReceiveId) === Number(row.ReceiveId));
  const result = await Swal.fire({
    title: 'ออก CN สำหรับ PO นี้', width: 900,
    html: `<div class="text-start small mb-3">PO <strong>${receiveEsc(row.PONumber)}</strong> · รวมรายการขาดส่งรอ CN ${batch.length} รายการ<br><span class="text-muted">กรอกราคาต่อหน่วยตาม PO และ VAT ของแต่ละสินค้า (ใส่ 0 หากไม่คิดภาษี)</span></div><div class="table-responsive" style="max-height:42vh"><table class="table table-sm align-middle text-start"><thead><tr><th>สินค้า / จำนวนขาด</th><th style="min-width:130px">ราคาต่อหน่วย</th><th style="min-width:110px">VAT %</th></tr></thead><tbody>${batch.map(item => `<tr><td>${receiveEsc(item.ItemCode)} · ${receiveEsc(item.ItemName)}<div class="small text-muted">ขาด ${item.Quantity} ${receiveEsc(item.UOM || '')}</div></td><td><input id="cn-price-${Number(item.ShortageId)}" class="form-control form-control-wms" type="number" min="0" step="0.0001" placeholder="0.00"></td><td><input id="cn-vat-${Number(item.ShortageId)}" class="form-control form-control-wms" type="number" min="0" max="100" step="0.01" value="0"></td></tr>`).join('')}</tbody></table></div>`,
    showCancelButton: true, confirmButtonText: 'ยืนยันออก CN', cancelButtonText: 'กลับ',
    preConfirm: () => {
      const lines = batch.map(item => {
        const priceInput = document.getElementById(`cn-price-${Number(item.ShortageId)}`);
        const vatInput = document.getElementById(`cn-vat-${Number(item.ShortageId)}`);
        return { shortageId: Number(item.ShortageId), unitPrice: Number(priceInput.value), vatRate: Number(vatInput.value), priceMissing: priceInput.value === '' };
      });
      if (lines.some(line => line.priceMissing || !Number.isFinite(line.unitPrice) || line.unitPrice < 0)) { Swal.showValidationMessage('กรอกราคาต่อหน่วยให้ครบและถูกต้อง'); return false; }
      if (lines.some(line => !Number.isFinite(line.vatRate) || line.vatRate < 0 || line.vatRate > 100)) { Swal.showValidationMessage('กรอก VAT ระหว่าง 0 ถึง 100'); return false; }
      return { lines: lines.map(({ shortageId, unitPrice, vatRate }) => ({ shortageId, unitPrice, vatRate })) };
    }
  });
  if (!result.isConfirmed) return;
  try {
    const payload = await receivingApi('/credit-notes/issue', { method: 'POST', body: JSON.stringify(result.value) });
    toast('success', `ออก ${payload.creditNoteNo} สำเร็จ ยอดรวม ${Number(payload.totals?.TotalAmount || 0).toLocaleString('th-TH',{minimumFractionDigits:2})} บาท`);
    await loadReceiveOrders();
  } catch (error) { toast('error', error.message); }
}

async function cancelReceiveShortage(shortageId) {
  const confirm = await Swal.fire({ title: 'ยกเลิกรายการขาดส่ง?', text: 'จำนวนนี้จะกลับไปเป็นยอดที่ Handheld รับเข้าได้', icon: 'warning', showCancelButton: true, confirmButtonText: 'ยกเลิกรายการ', cancelButtonText: 'กลับ' });
  if (!confirm.isConfirmed) return;
  try {
    await receivingApi(`/shortages/${shortageId}`, { method: 'DELETE' });
    toast('success', 'ยกเลิกรายการขาดส่งแล้ว');
    await loadReceiveOrders();
  } catch (error) { toast('error', error.message); }
}

async function openReceiveOrderForm() {
  document.getElementById('receiveOrderForm').style.display = 'block';
  if (!receiveProducts.length) {
    try {
      const response = await fetch('/api/products', { headers: authHeaders() });
      const payload = await response.json();
      if (!response.ok || !payload.success) throw new Error(payload.message || 'โหลดสินค้าไม่สำเร็จ');
      receiveProducts = payload.data || [];
      document.getElementById('receiveProductsList').innerHTML = receiveProducts.map(product =>
        `<option value="${receiveEsc(product.Barcode)}" label="${receiveEsc(product.ItemCode)} · ${receiveEsc(product.ItemName)}"></option>`
      ).join('');
    } catch (error) { toast('error', error.message); }
  }
  document.getElementById('receivePONumber').focus();
}

function closeReceiveOrderForm() {
  document.getElementById('receiveOrderForm').style.display = 'none';
  document.getElementById('receivePONumber').value = '';
  document.getElementById('receiveSupplier').value = '';
  document.getElementById('receiveProductBarcode').value = '';
  document.getElementById('receiveOrderedQty').value = '1';
  receiveDraftLines = [];
  renderReceiveDraftLines();
}

function addReceiveDraftLine() {
  const barcodeInput = document.getElementById('receiveProductBarcode');
  const barcode = barcodeInput.value.trim();
  const quantityValue = document.getElementById('receiveOrderedQty').value;
  const quantity = Number(quantityValue);
  const product = receiveProducts.find(item => String(item.Barcode) === barcode);
  if (!product) { toast('warning', 'เลือกหรือสแกนบาร์โค้ดสินค้าที่มีในระบบ'); barcodeInput.focus(); return; }
  if (quantityValue === '' || !Number.isInteger(quantity) || quantity <= 0) { toast('warning', 'จำนวนตาม PO ต้องเป็นจำนวนเต็มที่มากกว่า 0'); return; }
  const existing = receiveDraftLines.find(line => line.ProductId === product.ProductId);
  if (existing) existing.orderedQuantity += quantity;
  else receiveDraftLines.push({ product, orderedQuantity: quantity });
  barcodeInput.value = '';
  document.getElementById('receiveOrderedQty').value = '1';
  renderReceiveDraftLines();
  barcodeInput.focus();
}

function renderReceiveDraftLines() {
  const tbody = document.getElementById('receiveDraftLines');
  if (!tbody) return;
  tbody.innerHTML = receiveDraftLines.length ? receiveDraftLines.map((line, index) => `
    <tr><td><code>${receiveEsc(line.product.Barcode)}</code></td><td><strong>${receiveEsc(line.product.ItemCode)}</strong><div>${receiveEsc(line.product.ItemName)}</div></td>
    <td>${line.orderedQuantity} ${receiveEsc(line.product.UOM || '')}</td><td><button class="btn btn-sm btn-outline-danger" onclick="removeReceiveDraftLine(${index})" aria-label="นำสินค้าออก"><i class="bi bi-trash"></i></button></td></tr>
  `).join('') : '<tr><td colspan="4" class="text-center text-muted py-3">ยังไม่มีสินค้าในใบรับ</td></tr>';
}

function removeReceiveDraftLine(index) {
  receiveDraftLines.splice(index, 1);
  renderReceiveDraftLines();
}

async function saveReceiveOrder() {
  const poNumber = document.getElementById('receivePONumber').value.trim();
  if (!poNumber) { toast('warning', 'กรุณาระบุเลขที่ PO'); document.getElementById('receivePONumber').focus(); return; }
  if (!receiveDraftLines.length) { toast('warning', 'กรุณาเพิ่มสินค้าใน PO อย่างน้อย 1 รายการ'); return; }
  const button = document.querySelector('#receiveOrderForm .btn-indigo');
  button.disabled = true;
  try {
    await receivingApi('', {
      method: 'POST',
      body: JSON.stringify({
        poNumber,
        supplierName: document.getElementById('receiveSupplier').value.trim(),
        lines: receiveDraftLines.map(line => ({ barcode: line.product.Barcode, orderedQuantity: line.orderedQuantity }))
      })
    });
    closeReceiveOrderForm();
    toast('success', 'สร้างใบรับ PO และเปิดงานให้ Handheld แล้ว');
    await loadReceiveOrders();
  } catch (error) { toast('error', error.message); }
  finally { button.disabled = false; }
}

async function viewReceiveOrder(receiveId) {
  try {
    const payload = await receivingApi(`/${receiveId}/lines`);
    const order = receiveOrders.find(item => Number(item.ReceiveId) === Number(receiveId));
    const lines = payload.data || [];
    Swal.fire({
      title: receiveEsc(order?.PONumber || 'รายการ PO'),
      width: 850,
      html: `<div class="table-responsive"><table class="table table-sm align-middle"><thead><tr><th>Barcode</th><th>สินค้า</th><th>สั่ง</th><th>รับแล้ว</th><th>แจ้งขาด</th><th>เหลือรับ</th></tr></thead><tbody>${lines.map(line => `<tr><td>${receiveEsc(line.Barcode)}</td><td>${receiveEsc(line.ItemName)}</td><td>${line.OrderedQuantity} ${receiveEsc(line.UOM || '')}</td><td>${line.ReceivedQuantity}</td><td>${line.ShortageQuantity}</td><td>${line.RemainingQuantity}</td></tr>`).join('')}</tbody></table></div>`,
      confirmButtonText: 'ปิด'
    });
  } catch (error) { toast('error', error.message); }
}
