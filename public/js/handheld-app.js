/* ============================================================
   handheld-app.js — Dynamic Handheld PDA Logic
   ============================================================ */

let currentMode = null;
let userPayload = null;
let handheldCycleSessionId = null;
let handheldCycleItems = [];
let handheldCycleSessions = [];

const FALLBACK_MENUS = [
  { key: 'RECEIVE',    icon: '📦', bg: '#dcfce7', color: '#16a34a', title: 'รับสินค้า',      sub: 'สแกนรับเข้าสต็อก' },
  { key: 'PICK',       icon: '🚀', bg: '#fee2e2', color: '#dc2626', title: 'เบิกจ่าย',       sub: 'สแกนตัดจ่ายสินค้า' },
  { key: 'TRANSFER',   icon: '↔️', bg: '#fef3c7', color: '#d97706', title: 'ย้ายตำแหน่ง',   sub: 'โอนย้ายที่จัดเก็บ' },
  { key: 'CHECK',      icon: '🔍', bg: '#ede9fe', color: '#7c3aed', title: 'ตรวจนับสต็อก',  sub: 'ตรวจนับสต็อกสินค้าคงเหลือ' },
  { key: 'LOAD',       icon: '🚚', bg: '#fee2e2', color: '#c2410c', title: 'จัดโหลดสินค้า',  sub: 'กระบวนการโหลดสินค้าขึ้นรถ' },
  { key: 'PUTAWAY',    icon: '📥', bg: '#e0f2fe', color: '#0284c7', title: 'จัดเก็บสินค้า',   sub: 'นำสินค้าไปจัดเก็บเข้าตำแหน่ง' },
  { key: 'CYCLECOUNT', icon: '🔄', bg: '#e0e7ff', color: '#3730a3', title: 'ตรวจนับประจำรอบ', sub: 'ตรวจสอบสต็อกประจำรอบ' },
  { key: 'LOOKUP',     icon: '🔍', bg: '#ede9fe', color: '#7c3aed', title: 'เช็คสต็อกด่วน', sub: 'ดูยอดคงเหลือด่วน' }
];

let dynamicMenuConfig = [...FALLBACK_MENUS];

/* ── Init ── */
async function initHandheld() {
  userPayload = requireAuth(['ADMIN','POWERUSER','OPERATOR']);
  if (!userPayload) return;

  const nameEl = document.getElementById('hhUsername');
  const roleEl = document.getElementById('hhRole');
  if (nameEl) nameEl.textContent = userPayload.fullname || userPayload.username;
  if (roleEl) roleEl.textContent = userPayload.role === 'ADMIN' ? 'ADMIN' : 'PDA';

  await loadDynamicMenus();
}

/* ── ดึงข้อมูลรายการสิทธิ์แบบ Dynamic จากตาราง Permissions ── */
async function loadDynamicMenus() {
  const grid = document.getElementById('menuGrid');
  if (grid) {
    grid.innerHTML = `<div class="col-12 text-center py-4 text-muted"><span class="spinner-border spinner-border-sm me-2"></span>กำลังโหลดรายการเมนู...</div>`;
  }

  try {
    const res = await fetch('/api/permissions/all', { headers: authHeaders() });
    if (res.ok) {
      const data = await res.json();
      const allPermsFromDB = Array.isArray(data) ? data : (data.data || []);
      
      if (allPermsFromDB.length > 0) {
        dynamicMenuConfig = allPermsFromDB
          .filter(p => p.IsActive == 1 || p.IsActive === true)
          .map(p => {
            const code = (p.PermissionCode || '').trim().toUpperCase();
            let icon = '📦', bg = '#dcfce7', color = '#16a34a', sub = p.Description || 'ระบบจัดการคลังสินค้า';
            
            if (code === 'PICK') { icon = '🚀'; bg = '#fee2e2'; color = '#dc2626'; }
            else if (code === 'TRANSFER') { icon = '↔️'; bg = '#fef3c7'; color = '#d97706'; }
            else if (code === 'CHECK') { icon = '🔍'; bg = '#ede9fe'; color = '#7c3aed'; }
            else if (code === 'LOAD') { icon = '🚚'; bg = '#fee2e2'; color = '#c2410c'; }
            else if (code === 'PUTAWAY') { icon = '📥'; bg = '#e0f2fe'; color = '#0284c7'; }
            else if (code === 'CYCLECOUNT' || code === 'CYCLE_COUNT') { icon = '🔄'; bg = '#e0e7ff'; color = '#3730a3'; }
            else if (code === 'LOOKUP') { icon = '🔍'; bg = '#ede9fe'; color = '#7c3aed'; }

            return {
              key: code,
              icon: icon,
              bg: bg,
              color: color,
              title: p.PermissionName || code,
              sub: sub
            };
          });
      }
    }
  } catch (err) {
    console.warn('โหลดสิทธิ์ Dynamic ล้มเหลว เปลี่ยนไปใช้ Fallback Menu:', err);
  }

  renderMenuGrid();
}

/* ── แสดงผลเมนูตามสิทธิ์ผู้ใช้งาน (Case-insensitive) ── */
function renderMenuGrid() {
  const perms = userPayload.permissions ? userPayload.permissions.split(',').map(s => s.trim().toUpperCase()) : [];
  const isAdmin = userPayload.role === 'ADMIN';
  const grid = document.getElementById('menuGrid');

  if (!grid) return;

  const allowed = dynamicMenuConfig.filter(m => {
    const menuKey = (m.key || '').trim().toUpperCase();
    // รองรับทั้งแบบตรงกัน และแปลงขีดล่าง/ติดกัน (เช่น CYCLE_COUNT และ CYCLECOUNT)
    const normalizedKey = menuKey.replace(/_/g, '');
    return isAdmin || perms.includes('ALL') || perms.includes(menuKey) || perms.map(p => p.replace(/_/g, '')).includes(normalizedKey);
  });

  if (!allowed.length) {
    grid.innerHTML = `<div class="col-12 text-center py-4 text-muted">
      <div style="font-size:3rem">🔒</div>
      <p class="mt-2">ไม่มีเมนูที่ได้รับอนุญาต<br><small>กรุณาตรวจสอบสิทธิ์ผู้ใช้งาน หรือติดต่อผู้ดูแลระบบ</small></p>
    </div>`;
    return;
  }

  grid.innerHTML = allowed.map(m => `
    <div class="col-6">
      <div class="menu-card" onclick="selectMode('${m.key}')" style="cursor: pointer;">
        <div class="menu-icon-wrap" style="background:${m.bg}; color:${m.color}">${m.icon}</div>
        <div class="menu-title fw-bold">${m.title}</div>
        <div class="menu-sub text-muted" style="font-size:0.75rem;">${m.sub}</div>
      </div>
    </div>`).join('');
}

/* ── Switch to operation screen ── */
function selectMode(mode) {
  currentMode = mode;
  if (mode === 'RECEIVE') {
    document.getElementById('menuScreen').style.display = 'none';
    document.getElementById('opScreen').style.display = 'none';
    document.getElementById('cycleCountScreen').style.display = 'none';
    document.getElementById('receiveScreen').style.display = 'block';
    loadHandheldReceiveOrders();
    return;
  }
  if (mode === 'CYCLECOUNT' || mode === 'CYCLE_COUNT') {
    document.getElementById('menuScreen').style.display = 'none';
    document.getElementById('opScreen').style.display = 'none';
    document.getElementById('receiveScreen').style.display = 'none';
    document.getElementById('cycleCountScreen').style.display = 'block';
    loadHandheldCycleCounts();
    return;
  }
  const cfg = dynamicMenuConfig.find(m => m.key === mode) || { title: mode, sub: '', icon: '📦' };
  beep();

  document.getElementById('menuScreen').style.display = 'none';
  document.getElementById('opScreen').style.display   = 'block';

  document.getElementById('opIcon').textContent  = cfg.icon;
  document.getElementById('opTitle').textContent = cfg.title;
  document.getElementById('opSub').textContent   = cfg.sub;
  document.getElementById('resultPanel').innerHTML = '';

  const locationRow = document.getElementById('locationRow');
  if (locationRow) locationRow.style.display = mode !== 'LOOKUP' ? 'block' : 'none';

  const qtyRow = document.getElementById('qtyRow');
  if (qtyRow) qtyRow.style.display = mode !== 'LOOKUP' ? 'block' : 'none';

  clearOpForm();
  setTimeout(() => document.getElementById('scanBarcode')?.focus(), 300);
}

/* ── Back to menu ── */
function backToMenu() {
  currentMode = null;
  document.getElementById('opScreen').style.display   = 'none';
  document.getElementById('receiveScreen').style.display = 'none';
  document.getElementById('cycleCountScreen').style.display = 'none';
  document.getElementById('menuScreen').style.display = 'block';
}

function handheldCycleEsc(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
}

async function loadHandheldCycleCounts(keepSession = true) {
  const select = document.getElementById('hhCycleSession');
  const previous = keepSession ? (select?.value || handheldCycleSessionId || '') : '';
  if (select) select.innerHTML = '<option value="">กำลังโหลดรอบตรวจนับ...</option>';
  try {
    const response = await fetch('/api/cycle-counts', { headers: authHeaders() });
    const result = await response.json();
    if (response.status === 403 && result.isExpired) { logout('Session หมดอายุ'); return; }
    if (!response.ok || !result.success) throw new Error(result.message || 'โหลดรอบตรวจนับไม่สำเร็จ');
    const openSessions = (result.data || []).filter(session => session.Status === 'OPEN');
    handheldCycleSessions = openSessions;
    if (!select) return;
    select.innerHTML = openSessions.length
      ? '<option value="">เลือกรอบตรวจนับ</option>' + openSessions.map(session => `<option value="${session.SessionId}">${handheldCycleEsc(session.SessionName)} · ${handheldCycleEsc(session.ScopeValue || session.ScopeType)} · ${session.CountedItems || 0}/${session.TotalItems || 0}</option>`).join('')
      : '<option value="">ไม่มีรอบตรวจนับที่ใช้งานอยู่</option>';
    const retained = openSessions.find(session => String(session.SessionId) === String(previous));
    select.value = retained ? String(retained.SessionId) : (openSessions.length === 1 ? String(openSessions[0].SessionId) : '');
    if (select.value) await selectHandheldCycleSession();
    else {
      handheldCycleSessionId = null;
      document.getElementById('hhCycleSummary').textContent = openSessions.length ? 'เลือกรอบตรวจนับเพื่อดูสินค้าและโลเคชั่น' : 'ไม่พบรอบที่เปิดอยู่ (รอบมีอายุ 24 ชั่วโมง)';
      document.getElementById('hhCycleLocation').innerHTML = '<option value="">ทุกโลเคชั่น</option>';
      renderHandheldCycleItems();
    }
  } catch (error) {
    if (select) select.innerHTML = '<option value="">โหลดรอบตรวจนับไม่สำเร็จ</option>';
    document.getElementById('hhCycleSummary').textContent = error.message;
  }
}

async function selectHandheldCycleSession() {
  const sessionId = document.getElementById('hhCycleSession')?.value;
  handheldCycleSessionId = sessionId || null;
  document.getElementById('hhCycleItems').innerHTML = '<div class="text-center text-muted py-4"><span class="spinner-border spinner-border-sm me-2"></span>กำลังโหลดรายการ...</div>';
  document.getElementById('hhCycleMessage').innerHTML = '';
  if (!sessionId) { handheldCycleItems = []; renderHandheldCycleItems(); return; }
  try {
    const response = await fetch(`/api/cycle-counts/${encodeURIComponent(sessionId)}/items`, { headers: authHeaders() });
    const items = await response.json();
    if (!response.ok || !items.success) throw new Error(items.message || 'โหลดรายการ Cycle Count ไม่สำเร็จ');
    const session = handheldCycleSessions.find(item => String(item.SessionId) === String(sessionId));
    if (!session || session.Status !== 'OPEN') throw new Error('รอบตรวจนับหมดอายุหรือถูกปิดแล้ว');
    handheldCycleItems = items.data || [];
    const done = Number(session.CountedItems) || 0;
    const total = Number(session.TotalItems) || 0;
    const percent = total ? Math.round(done * 100 / total) : 0;
    document.getElementById('hhCycleSummary').innerHTML = `<div class="d-flex justify-content-between"><strong>${handheldCycleEsc(session.SessionName)}</strong><span>${done}/${total}</span></div><div class="progress mt-2" role="progressbar" aria-valuenow="${percent}" aria-valuemin="0" aria-valuemax="100"><div class="progress-bar bg-success" style="width:${percent}%"></div></div>`;
    const locationSelect = document.getElementById('hhCycleLocation');
    const previousLocation = locationSelect.value;
    const locations = [...new Set(handheldCycleItems.map(item => item.LocationCode).filter(Boolean))];
    locationSelect.innerHTML = '<option value="">ทุกโลเคชั่น</option>' + locations.map(location => `<option value="${handheldCycleEsc(location)}">${handheldCycleEsc(location)}</option>`).join('');
    if (locations.includes(previousLocation)) locationSelect.value = previousLocation;
    else if (locations.length) locationSelect.value = locations[0];
    renderHandheldCycleItems();
    setTimeout(() => document.getElementById('hhCycleBarcode')?.focus(), 100);
  } catch (error) {
    handheldCycleItems = [];
    document.getElementById('hhCycleSummary').textContent = error.message;
    document.getElementById('hhCycleItems').innerHTML = `<div class="alert alert-warning mb-0">${handheldCycleEsc(error.message)}</div>`;
  }
}

function renderHandheldCycleItems() {
  const host = document.getElementById('hhCycleItems');
  if (!host) return;
  const location = document.getElementById('hhCycleLocation')?.value || '';
  const items = handheldCycleItems.filter(item => !location || item.LocationCode === location);
  if (!items.length) { host.innerHTML = '<div class="text-center text-muted py-3">ไม่พบรายการสินค้าในโลเคชั่นนี้</div>'; return; }
  host.innerHTML = `<div class="cycle-items">${items.map(item => {
    const counted = item.CountedQuantity != null;
    return `<article class="cycle-item ${counted ? 'is-counted' : ''}"><div class="cycle-item-main"><strong>${handheldCycleEsc(item.ItemName)}</strong><small>${handheldCycleEsc(item.Barcode)}</small></div><div class="cycle-item-qty"><span>คาดหมาย ${item.ExpectedQuantity} ${handheldCycleEsc(item.UOM || '')}</span><strong>${counted ? `นับได้ ${item.CountedQuantity}` : 'รอตรวจ'}</strong></div></article>`;
  }).join('')}</div>`;
}

function focusHandheldCycleQty() { document.getElementById('hhCycleQty')?.focus(); }

async function submitHandheldCycleCount() {
  const barcode = document.getElementById('hhCycleBarcode')?.value.trim();
  const locationCode = document.getElementById('hhCycleLocation')?.value;
  const quantityValue = document.getElementById('hhCycleQty')?.value;
  const countedQuantity = Number.parseInt(quantityValue, 10);
  const message = document.getElementById('hhCycleMessage');
  if (!handheldCycleSessionId) { message.innerHTML = '<div class="alert alert-warning py-2">กรุณาเลือกรอบตรวจนับ</div>'; return; }
  if (!barcode) { message.innerHTML = '<div class="alert alert-warning py-2">กรุณาสแกนบาร์โค้ดสินค้า</div>'; document.getElementById('hhCycleBarcode')?.focus(); return; }
  if (!locationCode) { message.innerHTML = '<div class="alert alert-warning py-2">กรุณาเลือกโลเคชั่นของสินค้าที่กำลังนับ</div>'; document.getElementById('hhCycleLocation')?.focus(); return; }
  if (quantityValue === '' || !Number.isInteger(countedQuantity) || countedQuantity < 0) { message.innerHTML = '<div class="alert alert-warning py-2">กรุณาระบุจำนวนจริงตั้งแต่ 0 ขึ้นไป</div>'; focusHandheldCycleQty(); return; }
  const button = document.getElementById('hhCycleSubmit');
  button.disabled = true;
  message.innerHTML = '<div class="text-muted py-2"><span class="spinner-border spinner-border-sm me-2"></span>กำลังบันทึกผลตรวจนับ...</div>';
  try {
    const response = await fetch(`/api/cycle-counts/${encodeURIComponent(handheldCycleSessionId)}/count`, {
      method: 'POST', headers: authHeaders(), body: JSON.stringify({ barcode, locationCode, countedQuantity })
    });
    const result = await response.json();
    if (response.status === 403 && result.isExpired) { logout('Session หมดอายุ'); return; }
    if (!response.ok || !result.success) throw new Error(result.message || 'บันทึกไม่สำเร็จ');
    if (typeof beepOK === 'function') beepOK();
    message.innerHTML = `<div class="alert alert-success py-2 mb-2">บันทึก ${handheldCycleEsc(barcode)} ที่ ${handheldCycleEsc(locationCode)} = ${countedQuantity} แล้ว</div>`;
    document.getElementById('hhCycleBarcode').value = '';
    document.getElementById('hhCycleQty').value = '';
    await loadHandheldCycleCounts(true);
    document.getElementById('hhCycleMessage').innerHTML = `<div class="alert alert-success py-2 mb-2">บันทึก ${handheldCycleEsc(barcode)} ที่ ${handheldCycleEsc(locationCode)} = ${countedQuantity} แล้ว</div>`;
  } catch (error) {
    if (typeof beepError === 'function') beepError();
    message.innerHTML = `<div class="alert alert-danger py-2">${handheldCycleEsc(error.message)}</div>`;
  } finally { button.disabled = false; }
}

/* ── Clear op form ── */
function clearOpForm() {
  const el = document.getElementById('scanBarcode');
  if (el) { el.value = ''; el.focus(); }
  const q = document.getElementById('scanQty');
  if (q) q.value = '1';
  const l = document.getElementById('scanLocation');
  if (l) l.value = '';
}

/* ── Submit scan ── */
async function submitScan() {
  const barcode  = document.getElementById('scanBarcode')?.value.trim();
  const qty      = parseInt(document.getElementById('scanQty')?.value) || 1;
  const location = document.getElementById('scanLocation')?.value.trim() || '';

  if (!barcode) { beepError(); toast('warning', 'กรุณาสแกนบาร์โค้ด'); return; }

  const resultPanel = document.getElementById('resultPanel');
  resultPanel.innerHTML = `<div class="text-center py-2 text-muted"><span class="spinner-border spinner-border-sm me-1"></span>กำลังบันทึก...</div>`;

  try {
    if (currentMode === 'LOOKUP') {
      const res  = await fetch(`/api/stock/lookup?barcode=${encodeURIComponent(barcode)}`, { headers: authHeaders() });
      const data = await res.json();
      if (!res.ok || data.isExpired) { logout('Session หมดอายุ'); return; }
      beepOK();
      const itemQty = data.qty ?? 0;
      resultPanel.innerHTML = `
        <div class="alert alert-${itemQty > 0 ? 'success' : 'warning'} rounded-12 mt-2">
          <strong>${data.prodName || barcode}</strong><br>
          รหัส: ${data.prodCode || '-'}<br>
          <span style="font-size:1.4rem; font-weight:700">คงเหลือ: ${itemQty} ${data.unit || 'ชิ้น'}</span>
        </div>`;
      clearOpForm();
    } else {
      const res  = await fetch('/api/transactions', {
        method: 'POST', headers: authHeaders(),
        body: JSON.stringify({ barcode, qty, location, type: currentMode })
      });
      const data = await res.json();
      if (res.status === 403 && data.isExpired) { logout('Session หมดอายุ'); return; }
      if (!res.ok) { beepError(); toast('error', data.error || 'บันทึกไม่สำเร็จ'); resultPanel.innerHTML=''; return; }
      beepOK();
      resultPanel.innerHTML = `
        <div class="alert alert-success rounded-12 mt-2">
          ✅ <strong>${data.prodName || barcode}</strong> x${qty}<br>
          <small>${currentMode} — บันทึกเรียบร้อย</small>
        </div>`;
      clearOpForm();
    }
  } catch (err) { 
    beepError(); 
    toast('error', 'เกิดข้อผิดพลาด กรุณาลองใหม่'); 
    resultPanel.innerHTML = ''; 
    console.error('submitScan Error:', err);
  }
}

/* ── Enter key on barcode field ── */
function onBarcodeKeydown(e) {
  if (e.key === 'Enter') submitScan();
}

/* ── Logout ── */
function doLogout() {
  Swal.fire({
    title:'ออกจากระบบ?', text:'ต้องการออกจากระบบหรือไม่',
    icon:'question', showCancelButton:true,
    confirmButtonColor:'#4f46e5', cancelButtonColor:'#6b7280',
    confirmButtonText:'ออกจากระบบ', cancelButtonText:'ยกเลิก'
  }).then(r => { if (r.isConfirmed) logout(); });
}
