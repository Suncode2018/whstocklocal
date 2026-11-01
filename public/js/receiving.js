let receiveOrders = [];
let receiveProducts = [];
let receiveDraftLines = [];

const receiveEsc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));

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
      const completed = order.Status === 'COMPLETED';
      const cancelled = order.Status === 'CANCELLED';
      const badge = completed ? 'bg-success' : (cancelled ? 'bg-secondary' : 'bg-warning text-dark');
      return `<tr>
        <td><code>${receiveEsc(order.ReceiveNo)}</code></td>
        <td><strong>${receiveEsc(order.PONumber)}</strong></td>
        <td>${receiveEsc(order.SupplierName || '-')}</td>
        <td>${order.TotalLines} SKU<div class="small text-muted">รับ ${order.ReceivedQuantity}/${order.OrderedQuantity}</div></td>
        <td><span class="badge ${badge}">${completed ? 'รับครบแล้ว' : (cancelled ? 'ยกเลิก' : 'เปิดให้ Handheld')}</span></td>
        <td>${receiveEsc(order.CreatedByName)}<div class="small text-muted">${new Date(order.CreatedAt).toLocaleString('th-TH')}</div></td>
        <td><button class="btn btn-sm btn-outline-primary" onclick="viewReceiveOrder(${Number(order.ReceiveId)})">ดูรายการ</button></td>
      </tr>`;
    }).join('');
  } catch (error) {
    tbody.innerHTML = `<tr><td colspan="7" class="text-center py-4 text-danger">${receiveEsc(error.message)}</td></tr>`;
  }
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
      html: `<div class="table-responsive"><table class="table table-sm align-middle"><thead><tr><th>Barcode</th><th>สินค้า</th><th>สั่ง</th><th>รับแล้ว</th><th>คงเหลือ</th></tr></thead><tbody>${lines.map(line => `<tr><td>${receiveEsc(line.Barcode)}</td><td>${receiveEsc(line.ItemName)}</td><td>${line.OrderedQuantity} ${receiveEsc(line.UOM || '')}</td><td>${line.ReceivedQuantity}</td><td>${line.RemainingQuantity}</td></tr>`).join('')}</tbody></table></div>`,
      confirmButtonText: 'ปิด'
    });
  } catch (error) { toast('error', error.message); }
}
