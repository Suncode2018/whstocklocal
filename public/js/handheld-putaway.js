let handheldPutawayTasks = [];
let handheldPutawayTask = null;
let handheldPutawayLines = [];

const handheldPutawayEsc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));

async function loadHandheldPutawayTasks(keepTask = true) {
  const select = document.getElementById('hhPutawayTask');
  const previous = keepTask ? (select.value || '') : '';
  select.innerHTML = '<option value="">กำลังโหลดใบงาน PUTAWAY...</option>';
  try {
    const response = await fetch('/api/putaway', { headers: authHeaders() });
    const payload = await response.json();
    if (response.status === 403 && payload.isExpired) { logout(); return; }
    if (!response.ok || !payload.success) throw new Error(payload.message || 'โหลดใบงาน PUTAWAY ไม่สำเร็จ');
    handheldPutawayTasks = (payload.data || []).filter(task => ['OPEN', 'IN_PROGRESS'].includes(task.Status));
    select.innerHTML = handheldPutawayTasks.length
      ? '<option value="">เลือกใบงาน</option>' + handheldPutawayTasks.map(task => `<option value="${Number(task.TaskId)}">${handheldPutawayEsc(task.TaskNo)} · ${Number(task.MovedQuantity)}/${Number(task.PlannedQuantity)} ชิ้น</option>`).join('')
      : '<option value="">ไม่มีใบงาน PUTAWAY ที่เปิดอยู่</option>';
    const retained = handheldPutawayTasks.find(task => String(task.TaskId) === String(previous));
    select.value = retained ? String(retained.TaskId) : (handheldPutawayTasks.length === 1 ? String(handheldPutawayTasks[0].TaskId) : '');
    if (select.value) await selectHandheldPutawayTask();
    else {
      handheldPutawayTask = null;
      handheldPutawayLines = [];
      document.getElementById('hhPutawaySummary').textContent = handheldPutawayTasks.length ? 'เลือกใบงานเพื่อเริ่มจัดเก็บสินค้า' : 'ให้ Admin/Power User สร้างใบงานจากยอดที่โลเคชั่นต้นทางก่อน';
      document.getElementById('hhPutawayLines').innerHTML = '';
    }
  } catch (error) {
    select.innerHTML = '<option value="">โหลดใบงานไม่สำเร็จ</option>';
    document.getElementById('hhPutawaySummary').textContent = error.message;
  }
}

async function selectHandheldPutawayTask() {
  const taskId = document.getElementById('hhPutawayTask').value;
  const host = document.getElementById('hhPutawayLines');
  document.getElementById('hhPutawayMessage').innerHTML = '';
  if (!taskId) { handheldPutawayTask = null; handheldPutawayLines = []; host.innerHTML = ''; return; }
  host.innerHTML = '<div class="text-center text-muted py-3">กำลังโหลดรายการจัดเก็บ...</div>';
  try {
    const response = await fetch(`/api/putaway/${encodeURIComponent(taskId)}/lines`, { headers: authHeaders() });
    const payload = await response.json();
    if (response.status === 403 && payload.isExpired) { logout(); return; }
    if (!response.ok || !payload.success) throw new Error(payload.message || 'โหลดรายการในใบงานไม่สำเร็จ');
    handheldPutawayTask = payload.data.task;
    handheldPutawayLines = payload.data.lines || [];
    const total = handheldPutawayLines.reduce((sum, line) => sum + Number(line.PlannedQuantity), 0);
    const moved = handheldPutawayLines.reduce((sum, line) => sum + Number(line.MovedQuantity), 0);
    document.getElementById('hhPutawaySummary').innerHTML = `<div class="d-flex justify-content-between"><strong>${handheldPutawayEsc(handheldPutawayTask.TaskNo)}</strong><span>${moved}/${total} ชิ้น</span></div>${handheldPutawayTask.Note ? `<div class="small text-muted mt-1">${handheldPutawayEsc(handheldPutawayTask.Note)}</div>` : ''}`;
    renderHandheldPutawayLines();
    document.getElementById('hhPutawayBarcode').focus();
  } catch (error) {
    handheldPutawayTask = null; handheldPutawayLines = [];
    document.getElementById('hhPutawaySummary').textContent = error.message;
    host.innerHTML = '';
  }
}

function renderHandheldPutawayLines() {
  const host = document.getElementById('hhPutawayLines');
  host.innerHTML = handheldPutawayLines.map(line => `<article class="cycle-item ${Number(line.RemainingQuantity) === 0 ? 'is-counted' : ''}"><div class="cycle-item-main"><strong>${handheldPutawayEsc(line.ItemName)}</strong><small>${handheldPutawayEsc(line.Barcode)}</small><small>${handheldPutawayEsc(line.FromLocationCode)} → ${handheldPutawayEsc(line.ToLocationCode)}</small></div><div class="cycle-item-qty"><span>จัดเก็บ ${line.MovedQuantity}/${line.PlannedQuantity}</span><strong class="${Number(line.RemainingQuantity) === 0 ? 'is-complete' : ''}">${Number(line.RemainingQuantity) ? `เหลือ ${line.RemainingQuantity}` : 'เสร็จแล้ว'}</strong></div></article>`).join('');
}

function lookupHandheldPutawayBarcode() {
  const barcode = document.getElementById('hhPutawayBarcode').value.trim();
  const line = handheldPutawayLines.find(item => item.Barcode === barcode && Number(item.RemainingQuantity) > 0);
  const hint = document.getElementById('hhPutawayProductHint');
  if (!line) { hint.innerHTML = '<span class="text-danger">ไม่พบบาร์โค้ดนี้ในใบงาน หรือรายการจัดเก็บครบแล้ว</span>'; return; }
  hint.innerHTML = `<strong>${handheldPutawayEsc(line.ItemName)}</strong><br>ต้นทาง ${handheldPutawayEsc(line.FromLocationCode)} → ปลายทางตามใบงาน ${handheldPutawayEsc(line.ToLocationCode)}<br>เหลือจัดเก็บ ${line.RemainingQuantity} ${handheldPutawayEsc(line.UOM || '')}`;
  document.getElementById('hhPutawayTarget').value = '';
  const qty = document.getElementById('hhPutawayQty');
  qty.max = String(line.RemainingQuantity);
  qty.value = String(line.RemainingQuantity);
  document.getElementById('hhPutawayTarget').focus();
}

async function submitHandheldPutaway() {
  const taskId = document.getElementById('hhPutawayTask').value;
  const barcode = document.getElementById('hhPutawayBarcode').value.trim();
  const targetLocationCode = document.getElementById('hhPutawayTarget').value.trim().toUpperCase();
  const quantityValue = document.getElementById('hhPutawayQty').value;
  const quantity = Number(quantityValue);
  const line = handheldPutawayLines.find(item => item.Barcode === barcode && Number(item.RemainingQuantity) > 0);
  const message = document.getElementById('hhPutawayMessage');
  if (!taskId || !handheldPutawayTask) { message.innerHTML = '<div class="alert alert-warning py-2">เลือกใบงาน PUTAWAY ก่อน</div>'; return; }
  if (!line) { message.innerHTML = '<div class="alert alert-warning py-2">สแกนสินค้าที่อยู่ในใบงานและยังจัดเก็บไม่ครบ</div>'; return; }
  if (targetLocationCode !== line.ToLocationCode) { message.innerHTML = `<div class="alert alert-warning py-2">ปลายทางไม่ตรงใบงาน ต้องเป็น ${handheldPutawayEsc(line.ToLocationCode)}</div>`; document.getElementById('hhPutawayTarget').focus(); return; }
  if (quantityValue === '' || !Number.isInteger(quantity) || quantity <= 0 || quantity > Number(line.RemainingQuantity)) { message.innerHTML = `<div class="alert alert-warning py-2">จำนวนต้องเป็น 1 ถึง ${line.RemainingQuantity}</div>`; document.getElementById('hhPutawayQty').focus(); return; }
  const button = document.getElementById('hhPutawaySubmit');
  button.disabled = true;
  try {
    const response = await fetch(`/api/putaway/${encodeURIComponent(taskId)}/move`, { method: 'POST', headers: authHeaders(), body: JSON.stringify({ barcode, targetLocationCode, quantity }) });
    const payload = await response.json();
    if (response.status === 403 && payload.isExpired) { logout(); return; }
    if (!response.ok || !payload.success) throw new Error(payload.message || 'บันทึกจัดเก็บไม่สำเร็จ');
    if (typeof beepOK === 'function') beepOK();
    await loadHandheldPutawayTasks(true);
    document.getElementById('hhPutawayMessage').innerHTML = `<div class="alert alert-success py-2">${handheldPutawayEsc(payload.message)}</div>`;
    document.getElementById('hhPutawayBarcode').value = '';
    document.getElementById('hhPutawayTarget').value = '';
    document.getElementById('hhPutawayQty').value = '1';
    if (document.getElementById('hhPutawayTask').value) document.getElementById('hhPutawayBarcode').focus();
  } catch (error) {
    if (typeof beepError === 'function') beepError();
    message.innerHTML = `<div class="alert alert-danger py-2">${handheldPutawayEsc(error.message)}</div>`;
  } finally { button.disabled = false; }
}
