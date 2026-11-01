let putawayLocations = [];
let putawayDraftLineCount = 0;
let putawayDraftReceiveId = null;

const putawayEsc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));

async function putawayApi(path = '', options = {}) {
  const response = await fetch(`/api/putaway${path}`, { ...options, headers: { ...authHeaders(), ...(options.headers || {}) } });
  const payload = await response.json();
  if (response.status === 403 && payload.isExpired) { logout(); throw new Error('เซสชันหมดอายุ'); }
  if (!response.ok || !payload.success) throw new Error(payload.message || 'ทำรายการ PUTAWAY ไม่สำเร็จ');
  return payload;
}

async function loadPutawayManager() {
  const tbody = document.getElementById('putawayTaskTableBody');
  if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="7" class="text-center text-muted py-4">กำลังโหลดใบงาน...</td></tr>';
  try {
    const [taskPayload, locationPayload] = await Promise.all([putawayApi(), putawayApi('/locations')]);
    putawayLocations = locationPayload.data || [];
    const tasks = taskPayload.data || [];
    tbody.innerHTML = tasks.length ? tasks.map(task => {
      const status = { OPEN: 'รอจัดเก็บ', IN_PROGRESS: 'กำลังจัดเก็บ', COMPLETED: 'เสร็จแล้ว', CANCELLED: 'ยกเลิก' }[task.Status] || task.Status;
      const badge = task.Status === 'COMPLETED' ? 'bg-success' : (task.Status === 'CANCELLED' ? 'bg-secondary' : (task.Status === 'IN_PROGRESS' ? 'bg-primary' : 'bg-warning text-dark'));
      const volume = Number(task.PlannedVolumeCm3 || 0).toLocaleString('th-TH', { maximumFractionDigits: 3 });
      const volumeInfo = Number(task.LinesWithoutVolume || 0) ? ` · ยังไม่ระบุ ${task.LinesWithoutVolume} รายการ` : '';
      return `<tr><td><code>${putawayEsc(task.TaskNo)}</code>${task.PONumber ? `<div class="small text-muted">จาก PO ${putawayEsc(task.PONumber)}</div>` : ''}</td><td>${task.TotalLines} รายการ<div class="small text-muted">${task.MovedQuantity}/${task.PlannedQuantity} หน่วย</div><div class="small text-primary">${volume} cm³${volumeInfo}</div></td><td><span class="badge ${badge}">${status}</span></td><td>${putawayEsc(task.Note || '-')}</td><td>${putawayEsc(task.CreatedByName)}<div class="small text-muted">${new Date(task.CreatedAt).toLocaleString('th-TH')}</div></td><td><button class="btn btn-sm btn-outline-primary" onclick="viewPutawayTask(${Number(task.TaskId)})">ดูใบงาน</button></td><td>${task.Status === 'OPEN' ? `<button class="btn btn-sm btn-outline-danger" onclick="cancelPutawayTask(${Number(task.TaskId)})">ยกเลิก</button>` : '-'}</td></tr>`;
    }).join('') : '<tr><td colspan="7" class="text-center text-muted py-4">ยังไม่มีใบงาน PUTAWAY</td></tr>';
  } catch (error) {
    tbody.innerHTML = `<tr><td colspan="7" class="text-center text-danger py-4">${putawayEsc(error.message)}</td></tr>`;
  }
}

function openPutawayForm() {
  const form = document.getElementById('putawayTaskForm');
  if (!form) return;
  form.style.display = 'block';
  putawayDraftReceiveId = null;
  const sourceInfo = document.getElementById('putawaySourceInfo');
  if (sourceInfo) { sourceInfo.textContent = ''; sourceInfo.classList.add('d-none'); }
  document.getElementById('putawayTaskNote').value = '';
  document.getElementById('putawayDraftLines').innerHTML = '';
  putawayDraftLineCount = 0;
  addPutawayDraftLine();
  form.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

async function openPutawayFromReceive(receiveId) {
  try {
    const payload = await putawayApi(`/from-receive/${Number(receiveId)}/preview`);
    const { order, lines } = payload.data;
    if (!lines.length) {
      toast('warning', `ใบรับ ${order.PONumber} ไม่มีสินค้าเหลือในโลเคชั่นรับเข้าให้วางแผนจัดเก็บ`);
      return;
    }
    await loadPutawayManager();
    switchTab('OP_PUTAWAY');
    openPutawayForm();
    putawayDraftReceiveId = Number(receiveId);
    const sourceInfo = document.getElementById('putawaySourceInfo');
    if (sourceInfo) {
      sourceInfo.textContent = `สร้างจากใบรับ PO ${order.PONumber} (${order.ReceiveNo}) · แสดงเฉพาะยอดรับที่ยังไม่ถูกวางแผนและยังมีสต็อกต้นทาง`;
      sourceInfo.classList.remove('d-none');
    }
    document.getElementById('putawayTaskNote').value = `จัดเก็บจาก PO ${order.PONumber}`;
    const body = document.getElementById('putawayDraftLines');
    body.innerHTML = '';
    putawayDraftLineCount = 0;
    for (const line of lines) {
      addPutawayDraftLine();
      const row = body.lastElementChild;
      row.querySelector('[data-field="barcode"]').value = line.Barcode;
      const unitVolume = line.UnitVolumeCm3 == null ? 'ยังไม่ระบุปริมาตร' : `${Number(line.UnitVolumeCm3).toLocaleString('th-TH')} cm³/${line.UOM || 'หน่วย'}`;
      row.querySelector('[data-field="productInfo"]').textContent = `${line.ItemCode} · ${line.ItemName} · เหลือ ${line.AvailableQuantity} ${line.UOM || ''} · ${unitVolume}`;
      row.querySelector('[data-field="from"]').value = line.FromLocationCode;
      row.querySelector('[data-field="quantity"]').value = line.AvailableQuantity;
      row.querySelector('[data-field="quantity"]').max = line.AvailableQuantity;
      row.querySelector('[data-field="barcode"]').readOnly = true;
      row.querySelector('[data-field="from"]').disabled = true;
      row.querySelector('[data-field="quantity"]').title = `วางแผนได้สูงสุด ${line.AvailableQuantity} ${line.UOM || ''}`;
      row.querySelector('[data-field="barcode"]').title = `${line.ItemCode} · ${line.ItemName} · เหลือวางแผน ${line.AvailableQuantity} ${line.UOM || ''}`;
    }
    document.getElementById('putawayTaskForm').scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (error) { toast('error', error.message); }
}

function closePutawayForm() {
  const form = document.getElementById('putawayTaskForm');
  if (form) form.style.display = 'none';
  putawayDraftReceiveId = null;
}

function putawayLocationOptions(selected = '', kind = 'any') {
  const options = putawayLocations.filter(location => kind === 'receiving' ? location.LocationCode.startsWith('RCV-') : (kind === 'storage' ? /^[AB]-/.test(location.LocationCode) : true));
  return '<option value="">เลือกโลเคชั่น</option>' + options.map(location => {
    const occupied = Number(location.UsedVolumeCm3 || 0) + Number(location.ReservedVolumeCm3 || 0);
    const isStorage = /^[AB]-/.test(location.LocationCode);
    const capacity = !isStorage ? '' : (location.CapacityVolumeCm3 == null ? ' · ยังไม่กำหนดความจุ' : ` · ใช้/จอง ${occupied.toLocaleString('th-TH')} จาก ${Number(location.CapacityVolumeCm3).toLocaleString('th-TH')} cm³`);
    return `<option value="${putawayEsc(location.LocationCode)}" ${location.LocationCode === selected ? 'selected' : ''}>${putawayEsc(location.LocationCode)}${location.Zone ? ` · ${putawayEsc(location.Zone)}` : ''}${capacity}</option>`;
  }).join('');
}

function addPutawayDraftLine() {
  const body = document.getElementById('putawayDraftLines');
  if (!body) return;
  const index = putawayDraftLineCount++;
  body.insertAdjacentHTML('beforeend', `<tr data-putaway-line="${index}"><td><input class="form-control form-control-wms" data-field="barcode" placeholder="สแกน Barcode" autocomplete="off"><div class="small text-muted" data-field="productInfo"></div></td><td><select class="form-select form-control-wms" data-field="from">${putawayLocationOptions('', 'receiving')}</select></td><td><select class="form-select form-control-wms" data-field="to">${putawayLocationOptions('', 'storage')}</select></td><td><input class="form-control form-control-wms" data-field="quantity" type="number" min="1" step="1" value="1"></td><td><button type="button" class="btn btn-sm btn-outline-danger" onclick="this.closest('tr').remove()" aria-label="ลบบรรทัด">ลบ</button></td></tr>`);
}

async function savePutawayTask() {
  const rows = [...document.querySelectorAll('#putawayDraftLines tr')];
  const lines = rows.map(row => ({
    barcode: row.querySelector('[data-field="barcode"]').value.trim(),
    fromLocationCode: row.querySelector('[data-field="from"]').value,
    toLocationCode: row.querySelector('[data-field="to"]').value,
    quantity: Number(row.querySelector('[data-field="quantity"]').value)
  }));
  if (!lines.length || lines.some(line => !line.barcode || !line.fromLocationCode || !line.toLocationCode || line.fromLocationCode === line.toLocationCode || !Number.isInteger(line.quantity) || line.quantity <= 0)) {
    toast('warning', 'ตรวจ Barcode, ต้นทาง, ปลายทาง และจำนวนของทุกรายการ');
    return;
  }
  try {
    const payload = await putawayApi('', { method: 'POST', body: JSON.stringify({ sourceReceiveId: putawayDraftReceiveId, note: document.getElementById('putawayTaskNote').value.trim(), lines }) });
    toast('success', `${payload.taskNo} สร้างใบงานแล้ว`);
    closePutawayForm();
    putawayDraftReceiveId = null;
    await loadPutawayManager();
  } catch (error) { toast('error', error.message); }
}

async function viewPutawayTask(taskId) {
  try {
    const payload = await putawayApi(`/${taskId}/lines`);
    const { task, lines } = payload.data;
    const html = `<div class="text-start"><div class="mb-2"><strong>${putawayEsc(task.TaskNo)}</strong> · ${putawayEsc(task.Status)}${task.PONumber ? `<div class="small text-muted">จาก PO ${putawayEsc(task.PONumber)} (${putawayEsc(task.ReceiveNo)})</div>` : ''}</div><div class="table-responsive"><table class="table table-sm"><thead><tr><th>สินค้า</th><th>ต้นทาง → ปลายทาง</th><th>จำนวน / ปริมาตร</th></tr></thead><tbody>${lines.map(line => `<tr><td>${putawayEsc(line.ItemName)}<div class="small text-muted">${putawayEsc(line.Barcode)}</div></td><td>${putawayEsc(line.FromLocationCode)} → ${putawayEsc(line.ToLocationCode)}</td><td>${line.MovedQuantity}/${line.PlannedQuantity} ${putawayEsc(line.UOM || '')}<div class="small text-muted">${line.PlannedVolumeCm3 == null ? 'ไม่ระบุปริมาตร' : `${Number(line.PlannedVolumeCm3).toLocaleString('th-TH')} cm³`}</div></td></tr>`).join('')}</tbody></table></div>${task.Note ? `<div class="small text-muted">หมายเหตุ: ${putawayEsc(task.Note)}</div>` : ''}</div>`;
    await Swal.fire({ title: 'รายละเอียดใบงาน PUTAWAY', html, width: 780, confirmButtonText: 'ปิด' });
  } catch (error) { toast('error', error.message); }
}

async function cancelPutawayTask(taskId) {
  const confirm = await Swal.fire({ title: 'ยกเลิกใบงาน?', text: 'ยกเลิกได้เฉพาะใบงานที่ยังไม่มีการย้ายสินค้า', icon: 'warning', showCancelButton: true, confirmButtonText: 'ยกเลิกใบงาน', cancelButtonText: 'กลับ' });
  if (!confirm.isConfirmed) return;
  try {
    await putawayApi(`/${taskId}`, { method: 'DELETE' });
    toast('success', 'ยกเลิกใบงานแล้ว คืนยอดจองต้นทางเรียบร้อย');
    await loadPutawayManager();
  } catch (error) { toast('error', error.message); }
}
