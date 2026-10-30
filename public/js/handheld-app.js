/* ============================================================
   handheld-app.js — Dynamic Handheld PDA Logic
   ============================================================ */

let currentMode = null;
let userPayload = null;

// รายการเมนูสำรอง (Fallback Menu) เผื่อกรณีเชื่อมต่อ API ไม่ได้
const FALLBACK_MENUS = [
  { key: 'RECEIVE',  icon: '📦', bg: '#dcfce7', color: '#16a34a', title: 'รับสินค้า',      sub: 'สแกนรับเข้าสต็อก' },
  { key: 'PICK',     icon: '🚀', bg: '#fee2e2', color: '#dc2626', title: 'เบิกจ่าย',       sub: 'สแกนตัดจ่ายสินค้า' },
  { key: 'TRANSFER', icon: '↔️', bg: '#fef3c7', color: '#d97706', title: 'ย้ายตำแหน่ง',   sub: 'โอนย้ายที่จัดเก็บ' },
  { key: 'CHECK',    icon: '🔍', bg: '#ede9fe', color: '#7c3aed', title: 'ตรวจนับสต็อก',  sub: 'ตรวจนับสต็อกสินค้าคงเหลือ' },
  { key: 'LOAD',     icon: '🚚', bg: '#fee2e2', color: '#c2410c', title: 'จัดโหลดสินค้า',  sub: 'กระบวนการโหลดสินค้าขึ้นรถ' },
  { key: 'PUTAWAY',  icon: '📥', bg: '#e0f2fe', color: '#0284c7', title: 'จัดเก็บสินค้า',   sub: 'นำสินค้าไปจัดเก็บเข้าตำแหน่ง' },
  { key: 'LOOKUP',   icon: '🔍', bg: '#ede9fe', color: '#7c3aed', title: 'เช็คสต็อกด่วน', sub: 'ดูยอดคงเหลือด่วน' }
];

let dynamicMenuConfig = [...FALLBACK_MENUS];

/* ── Init ── */
async function initHandheld() {
  userPayload = requireAuth(['ADMIN','OPERATOR']);
  if (!userPayload) return;

  const nameEl = document.getElementById('hhUsername');
  const roleEl = document.getElementById('hhRole');
  if (nameEl) nameEl.textContent = userPayload.fullname || userPayload.username;
  if (roleEl) roleEl.textContent = userPayload.role === 'ADMIN' ? 'ADMIN' : 'PDA';

  startSessionCountdown();
  await loadDynamicMenus();
}

/* ── 1. ดึงข้อมูลรายการสิทธิ์แบบ Dynamic จากตาราง Permissions (SQL Server) ── */
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

/* ── 2. แสดงผลเมนูตามสิทธิ์ผู้ใช้งาน (Filtered Grid แบบ Case-insensitive) ── */
function renderMenuGrid() {
  const perms = userPayload.permissions ? userPayload.permissions.split(',').map(s => s.trim().toUpperCase()) : [];
  const isAdmin = userPayload.role === 'ADMIN';
  const grid = document.getElementById('menuGrid');

  if (!grid) return;

  const allowed = dynamicMenuConfig.filter(m => {
    const menuKey = (m.key || '').trim().toUpperCase();
    return isAdmin || perms.includes('ALL') || perms.includes(menuKey);
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
  document.getElementById('menuScreen').style.display = 'block';
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