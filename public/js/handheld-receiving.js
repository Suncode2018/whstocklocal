let handheldReceiveOrders = [];
let handheldReceiveLines = [];

const handheldReceiveEsc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));

async function loadHandheldReceiveOrders(keepOrder = true) {
  const orderSelect = document.getElementById('hhReceiveOrder');
  const selectedBefore = keepOrder ? (orderSelect.value || '') : '';
  orderSelect.innerHTML = '<option value="">กำลังโหลดใบรับ...</option>';
  document.getElementById('hhReceiveSummary').textContent = '';
  try {
    const [ordersResponse, locationsResponse] = await Promise.all([
      fetch('/api/receiving', { headers: authHeaders() }),
      fetch('/api/receiving/locations', { headers: authHeaders() })
    ]);
    const [ordersPayload, locationsPayload] = await Promise.all([ordersResponse.json(), locationsResponse.json()]);
    if (ordersResponse.status === 403 && ordersPayload.isExpired) { logout(); return; }
    if (!ordersResponse.ok || !ordersPayload.success) throw new Error(ordersPayload.message || 'โหลดใบรับสินค้าไม่สำเร็จ');
    if (!locationsResponse.ok || !locationsPayload.success) throw new Error(locationsPayload.message || 'โหลดโลเคชั่นไม่สำเร็จ');
    handheldReceiveOrders = (ordersPayload.data || []).filter(order => order.Status === 'OPEN');
    const locations = locationsPayload.data || [];
    const locationSelect = document.getElementById('hhReceiveLocation');
    const previousLocation = locationSelect.value;
    locationSelect.innerHTML = locations.length
      ? '<option value="">เลือกโลเคชั่นรับเข้า</option>' + locations.map(location => `<option value="${handheldReceiveEsc(location.LocationCode)}">${handheldReceiveEsc(location.LocationCode)}${location.Zone ? ` · ${handheldReceiveEsc(location.Zone)}` : ''}</option>`).join('')
      : '<option value="">ไม่พบโลเคชั่นที่เปิดใช้งาน</option>';
    if (locations.some(location => location.LocationCode === previousLocation)) locationSelect.value = previousLocation;
    else {
      const receivingLocation = locations.find(location => location.LocationCode === 'RCV-01') || locations[0];
      if (receivingLocation) locationSelect.value = receivingLocation.LocationCode;
    }
    orderSelect.innerHTML = handheldReceiveOrders.length
      ? '<option value="">เลือกใบรับสินค้า</option>' + handheldReceiveOrders.map(order => `<option value="${order.ReceiveId}">${handheldReceiveEsc(order.PONumber)} · ${handheldReceiveEsc(order.SupplierName || 'ไม่ระบุ Supplier')} · ${order.ReceivedQuantity}/${order.OrderedQuantity}</option>`).join('')
      : '<option value="">ไม่มีใบรับ PO ที่เปิดอยู่</option>';
    if (handheldReceiveOrders.some(order => String(order.ReceiveId) === String(selectedBefore))) orderSelect.value = selectedBefore;
    else if (handheldReceiveOrders.length === 1) orderSelect.value = String(handheldReceiveOrders[0].ReceiveId);
    if (orderSelect.value) await selectHandheldReceiveOrder();
    else {
      handheldReceiveLines = [];
      document.getElementById('hhReceiveSummary').textContent = handheldReceiveOrders.length ? 'เลือกใบรับ PO เพื่อเริ่มทำรายการ' : 'ยังไม่มีใบรับ PO ที่เปิดอยู่ ให้ Admin/Power User สร้างใบรับก่อน';
      document.getElementById('hhReceiveLines').innerHTML = '';
      document.getElementById('hhReceiveProductHint').textContent = 'เลือกใบรับ แล้วสแกนสินค้า';
    }
  } catch (error) {
    orderSelect.innerHTML = '<option value="">โหลดใบรับสินค้าไม่สำเร็จ</option>';
    document.getElementById('hhReceiveSummary').textContent = error.message;
  }
}

async function selectHandheldReceiveOrder() {
  const receiveId = document.getElementById('hhReceiveOrder').value;
  const host = document.getElementById('hhReceiveLines');
  document.getElementById('hhReceiveMessage').innerHTML = '';
  if (!receiveId) { handheldReceiveLines = []; host.innerHTML = ''; return; }
  host.innerHTML = '<div class="text-center text-muted py-3">กำลังโหลดรายการ PO...</div>';
  try {
    const response = await fetch(`/api/receiving/${encodeURIComponent(receiveId)}/lines`, { headers: authHeaders() });
    const payload = await response.json();
    if (response.status === 403 && payload.isExpired) { logout(); return; }
    if (!response.ok || !payload.success) throw new Error(payload.message || 'โหลดรายการ PO ไม่สำเร็จ');
    handheldReceiveLines = payload.data || [];
    const first = handheldReceiveLines[0];
    const order = handheldReceiveOrders.find(item => String(item.ReceiveId) === String(receiveId));
    const ordered = Number(order?.OrderedQuantity) || handheldReceiveLines.reduce((sum, line) => sum + line.OrderedQuantity, 0);
    const received = Number(order?.ReceivedQuantity) || handheldReceiveLines.reduce((sum, line) => sum + line.ReceivedQuantity, 0);
    const percent = ordered ? Math.round(received * 100 / ordered) : 0;
    document.getElementById('hhReceiveSummary').innerHTML = `<div class="d-flex justify-content-between"><strong>PO ${handheldReceiveEsc(order?.PONumber || '')}</strong><span>${received}/${ordered}</span></div><div class="progress mt-2"><div class="progress-bar bg-success" style="width:${percent}%"></div></div>`;
    renderHandheldReceiveLines();
    if (first) setTimeout(() => document.getElementById('hhReceiveBarcode')?.focus(), 100);
  } catch (error) {
    handheldReceiveLines = [];
    document.getElementById('hhReceiveSummary').textContent = error.message;
    host.innerHTML = `<div class="alert alert-warning">${handheldReceiveEsc(error.message)}</div>`;
  }
}

function renderHandheldReceiveLines() {
  const host = document.getElementById('hhReceiveLines');
  if (!handheldReceiveLines.length) { host.innerHTML = '<div class="text-center text-muted py-3">ใบรับนี้ไม่มีรายการสินค้า</div>'; return; }
  host.innerHTML = handheldReceiveLines.map(line => {
    const remaining = Number(line.RemainingQuantity) || 0;
    return `<article class="cycle-item ${remaining === 0 ? 'is-counted' : ''}"><div class="cycle-item-main"><strong>${handheldReceiveEsc(line.ItemName)}</strong><small>${handheldReceiveEsc(line.Barcode)}</small></div><div class="cycle-item-qty"><span>รับ ${line.ReceivedQuantity}/${line.OrderedQuantity} ${handheldReceiveEsc(line.UOM || '')}</span><strong>${remaining ? `เหลือ ${remaining}` : 'ครบแล้ว'}</strong></div></article>`;
  }).join('');
}

function lookupHandheldReceiveBarcode() {
  const barcode = document.getElementById('hhReceiveBarcode').value.trim();
  const line = handheldReceiveLines.find(item => item.Barcode === barcode);
  const hint = document.getElementById('hhReceiveProductHint');
  if (!barcode) { hint.textContent = 'กรุณาสแกนบาร์โค้ดสินค้า'; return; }
  if (!line) { hint.innerHTML = '<span class="text-danger">สินค้านี้ไม่มีอยู่ใน PO ที่เลือก</span>'; document.getElementById('hhReceiveBarcode').focus(); return; }
  const remaining = Number(line.RemainingQuantity) || 0;
  if (!remaining) { hint.innerHTML = '<span class="text-success">รายการนี้รับครบตาม PO แล้ว</span>'; return; }
  hint.innerHTML = `<strong>${handheldReceiveEsc(line.ItemName)}</strong> · รับแล้ว ${line.ReceivedQuantity}/${line.OrderedQuantity} · เหลือ ${remaining} ${handheldReceiveEsc(line.UOM || '')}`;
  const qty = document.getElementById('hhReceiveQty');
  qty.max = String(remaining);
  qty.value = '1';
  qty.focus();
  qty.select();
}

async function submitHandheldReceive() {
  const receiveId = document.getElementById('hhReceiveOrder').value;
  const barcode = document.getElementById('hhReceiveBarcode').value.trim();
  const locationCode = document.getElementById('hhReceiveLocation').value;
  const quantityValue = document.getElementById('hhReceiveQty').value;
  const quantity = Number(quantityValue);
  const line = handheldReceiveLines.find(item => item.Barcode === barcode);
  const message = document.getElementById('hhReceiveMessage');
  if (!receiveId) { message.innerHTML = '<div class="alert alert-warning py-2">ไม่มีใบรับ PO ที่เปิดอยู่</div>'; return; }
  if (!line) { message.innerHTML = '<div class="alert alert-warning py-2">สแกนสินค้าที่อยู่ใน PO ก่อน</div>'; document.getElementById('hhReceiveBarcode').focus(); return; }
  if (!locationCode) { message.innerHTML = '<div class="alert alert-warning py-2">เลือกโลเคชั่นรับเข้าก่อน</div>'; document.getElementById('hhReceiveLocation').focus(); return; }
  if (quantityValue === '' || !Number.isInteger(quantity) || quantity <= 0) { message.innerHTML = '<div class="alert alert-warning py-2">จำนวนรับต้องเป็นจำนวนเต็มที่มากกว่า 0</div>'; document.getElementById('hhReceiveQty').focus(); return; }
  if (quantity > line.RemainingQuantity) { message.innerHTML = `<div class="alert alert-warning py-2">รับเกิน PO ไม่ได้ เหลือรับ ${line.RemainingQuantity}</div>`; document.getElementById('hhReceiveQty').focus(); return; }

  const button = document.getElementById('hhReceiveSubmit');
  button.disabled = true;
  message.innerHTML = '<div class="text-muted py-2">กำลังบันทึกรับสินค้า...</div>';
  try {
    const response = await fetch(`/api/receiving/${encodeURIComponent(receiveId)}/receive`, {
      method: 'POST', headers: authHeaders(), body: JSON.stringify({ barcode, locationCode, quantity })
    });
    const payload = await response.json();
    if (response.status === 403 && payload.isExpired) { logout(); return; }
    if (!response.ok || !payload.success) throw new Error(payload.message || 'รับสินค้าไม่สำเร็จ');
    if (typeof beepOK === 'function') beepOK();
    document.getElementById('hhReceiveBarcode').value = '';
    document.getElementById('hhReceiveQty').value = '1';
    message.innerHTML = `<div class="alert alert-success py-2">รับ ${handheldReceiveEsc(barcode)} จำนวน ${quantity} ที่ ${handheldReceiveEsc(locationCode)} แล้ว</div>`;
    await loadHandheldReceiveOrders(true);
    if (document.getElementById('hhReceiveOrder').value) {
      document.getElementById('hhReceiveMessage').innerHTML = `<div class="alert alert-success py-2">รับ ${handheldReceiveEsc(barcode)} จำนวน ${quantity} ที่ ${handheldReceiveEsc(locationCode)} แล้ว</div>`;
      document.getElementById('hhReceiveBarcode').focus();
    }
  } catch (error) {
    if (typeof beepError === 'function') beepError();
    message.innerHTML = `<div class="alert alert-danger py-2">${handheldReceiveEsc(error.message)}</div>`;
  } finally { button.disabled = false; }
}
