/* ==========================================================
   admin-users.js — หน้า "จัดการผู้ใช้งาน" (เฉพาะ ADMIN)
   ปรับปรุงให้ดึง Roles จากฐานข้อมูลจริงผ่าน /api/roles แบบ Dynamic
   ========================================================== */
(function () {
  const API = '/api/users';
  const ROLES_API = '/api/roles';

  // รายการสำรองกรณีต่อ API /api/roles ไม่ได้
  const FALLBACK_ROLES = [{key:'ADMIN',badge:'bg-danger',name:'ผู้ดูแลระบบ'},{key:'USER',badge:'bg-primary',name:'ผู้ใช้งาน'}];

  let dynamicRoles = [];
  let users = [];
  let demo = false;
  let loaded = false;
  const filt = { q: '', role: '', status: 'all' };

  const $ = id => document.getElementById(id);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const attr = v => esc(JSON.stringify(v));

  // แผนที่จับคู่สี Badge ให้แต่ละ Role อัตโนมัติ
  const ROLE_BADGE_MAP = {ADMIN:'bg-danger',USER:'bg-primary'};

  const roleList = () => (dynamicRoles.length ? dynamicRoles : FALLBACK_ROLES);
  const roleInfo = key => roleList().find(r => r.key === key) || { key, badge: ROLE_BADGE_MAP[key] || 'bg-secondary', name: key };
  const me = () => { try { return JSON.parse(localStorage.getItem('user') || '{}'); } catch (_) { return {}; } };
  const isSelf = u => { const m = me(); return (m.id != null && String(m.id) === String(u.id)) || (m.userId != null && String(m.userId) === String(u.id)) || (m.username && m.username === u.username); };
  const activeAdmins = () => users.filter(u => u.role === 'ADMIN' && u.active).length;

  const Toast = Swal.mixin({ toast: true, position: 'top-end', showConfirmButton: false, timer: 2200, timerProgressBar: true });

  /* ---------- ดึงข้อมูล Roles จากฐานข้อมูลจริง ---------- */
  async function fetchDbRoles() {
    try {
      const token = localStorage.getItem('token');
      const res = await fetch(ROLES_API, {
        headers: { ...(token ? { Authorization: 'Bearer ' + token } : {}) }
      });
      if (!res.ok) return;
      const data = await res.json();
      const list = Array.isArray(data) ? data : (data.data || []);
      
      // กรองเอาเฉพาะ Role ที่ Active
      dynamicRoles = list
        .filter(r => r.IsActive !== false && r.IsActive !== 0)
        .map(r => {
          const code = (r.RoleCode || r.role || r.Role || '').toUpperCase();
          return {
            key: code,
            badge: ROLE_BADGE_MAP[code] || 'bg-secondary',
            name: r.RoleName || r.name || code
          };
        });
    } catch (err) {
      console.warn('โหลด Roles จาก API ไม่สำเร็จ กำลังใช้ค่าสำรอง:', err);
    }
  }

  /* ---------- API ---------- */
  async function api(method, path, body) {
    const token = localStorage.getItem('token');
    const res = await fetch(API + path, {
      method,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
      body: body ? JSON.stringify(body) : undefined
    });
    let data = null;
    try { data = await res.json(); } catch (_) {}
    if (!res.ok) {
      const err = new Error((data && (data.error || data.message)) || ('เกิดข้อผิดพลาด (' + res.status + ')'));
      err.status = res.status;
      throw err;
    }
    return data;
  }

  function norm(u) {
    const active = u.active ?? u.is_active ?? u.IsActive ?? (u.status ? String(u.status).toUpperCase() === 'ACTIVE' : true);
    return {
      id: u.UserId ?? u.user_id ?? u.id,
      username: u.username ?? u.Username,
      fullname: u.FullName ?? u.fullname ?? u.full_name ?? u.name ?? '',
      role: String(u.role || u.Role || '').toUpperCase(),
      active: !!(active === true || active === 1 || active === '1' || active === 'True'),
      last_login: u.last_login ?? u.lastLogin ?? u.CreatedAt ?? null,
      permissions: u.permissions ?? u.Permissions ?? 'RECEIVE,PUTAWAY'
    };
  }

  function sample() {
    return [
      { UserId: 3, Username: 'admin', FullName: 'ผู้ดูแลระบบ', Role: 'ADMIN', IsActive: true, CreatedAt: '2026-10-30T10:00:00', Permissions: 'ALL' },
      { UserId: 4, Username: 'picker01', FullName: 'picker01', Role: 'USER', IsActive: true, CreatedAt: '2026-10-30T10:30:00', Permissions: 'RECEIVE,PUTAWAY' },
      { UserId: 6, Username: 'picker02', FullName: 'picker02', Role: 'USER', IsActive: true, CreatedAt: '2026-10-30T20:15:00', Permissions: 'PUTAWAY' },
      { UserId: 10, Username: 'poweruser', FullName: 'poweruser01', Role: 'USER', IsActive: true, CreatedAt: '2026-11-01T08:00:00', Permissions: 'ALL' }
    ].map(norm);
  }

  /* ---------- โหลด / วาด ---------- */
  async function loadUsers(force) {
    // 1. ดึง Roles ล่าสุดจากฐานข้อมูลก่อน
    await fetchDbRoles();
    fillRoleFilter();

    if (loaded && !force) { render(); return; }
    $('usersTableBody').innerHTML = '<tr><td colspan="7" class="text-center py-4 text-muted"><span class="spinner-border spinner-border-sm me-2"></span>กำลังโหลด...</td></tr>';
    try {
      const d = await api('GET', '');
      users = (Array.isArray(d) ? d : (d.users || d.data || [])).map(norm);
      demo = false;
    } catch (e) {
      if (e.status === 401 && typeof logout === 'function') { logout(); return; }
      {
        $('usersTableBody').innerHTML = `<tr><td colspan="7" class="text-center py-4"><div class="text-danger mb-2">โหลดข้อมูลไม่สำเร็จ: ${esc(e.message)}</div><button class="btn btn-sm btn-outline-primary" onclick="loadUsers(true)">ลองอีกครั้ง</button></td></tr>`;
        return;
      }
    }
    loaded = true;
    render();
  }

  function fillRoleFilter() {
    const sel = $('userRoleFilter');
    if (!sel) return;
    const cur = sel.value;
    sel.innerHTML = '<option value="">ทุก Role</option>' + roleList().map(r => `<option value="${esc(r.key)}">${esc(r.key)} — ${esc(r.name || '')}</option>`).join('');
    sel.value = cur;
  }

  function syncRoleCounts() {
    if (dynamicRoles.length) {
      dynamicRoles.forEach(r => { r.users = users.filter(u => u.role === r.key).length; });
      if (typeof renderRoles === 'function') renderRoles();
    }
  }

  const COLORS = ['#6366f1', '#0ea5e9', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#14b8a6'];
  const colorOf = s => COLORS[[...String(s)].reduce((a, c) => a + c.charCodeAt(0), 0) % COLORS.length];
  const fmtTime = t => {
    if (!t) return '<span class="text-muted">ยังไม่เคยเข้าใช้</span>';
    const d = new Date(t);
    return isNaN(d) ? esc(t) : d.toLocaleString('th-TH', { dateStyle: 'medium', timeStyle: 'short' });
  };

  function render() {
    const banner = $('demoBanner');
    if (banner) banner.classList.toggle('d-none', !demo);

    const total = users.length, on = users.filter(u => u.active).length;
    const chipContainer = $('userChips');
    if (chipContainer) {
      const chip = (k, label, n) => `<button type="button" class="chip ${filt.status === k ? 'on' : ''}" onclick="userSetStatus('${k}')">${label}<b>${n}</b></button>`;
      chipContainer.innerHTML = chip('all', 'ทั้งหมด', total) + chip('active', 'ใช้งานอยู่', on) + chip('off', 'ถูกระงับ', total - on);
    }

    const q = filt.q.trim().toLowerCase();
    const list = users.filter(u =>
      (!filt.role || u.role === filt.role) &&
      (filt.status === 'all' || (filt.status === 'active') === u.active) &&
      (!q || (u.username + ' ' + u.fullname + ' ' + u.role).toLowerCase().includes(q))
    );

    if (!list.length) {
      $('usersTableBody').innerHTML = `<tr><td colspan="7"><div class="empty-state"><div style="font-size:2.5rem">🔍</div>
        <div class="fw-semibold mt-1">${total ? 'ไม่พบผู้ใช้ที่ตรงกับตัวกรอง' : 'ยังไม่มีผู้ใช้งาน'}</div>
        <div class="small text-muted mb-2">${total ? 'ลองล้างตัวกรองหรือเปลี่ยนคำค้นหา' : 'เริ่มจากกด "เพิ่มผู้ใช้"'}</div>
        ${total ? '<button class="btn btn-sm btn-outline-secondary" onclick="userClearFilters()">ล้างตัวกรอง</button>' : '<button class="btn btn-indigo btn-sm" onclick="openAddUser()">เพิ่มผู้ใช้</button>'}
      </div></td></tr>`;
      return;
    }

    $('usersTableBody').innerHTML = list.map(u => {
      const r = roleInfo(u.role), self = isSelf(u);
      const ini = (u.fullname || u.username || '?').trim().charAt(0).toUpperCase();
      const isAdminUser = u.role === 'ADMIN' || u.username.toLowerCase() === 'admin';

      const statusActionBtn = isAdminUser
        ? `<button class="btn btn-sm btn-outline-secondary" disabled title="ไม่อนุญาตให้ระงับบัญชีผู้ดูแลระบบสูงสุด" aria-label="ระงับไม่ได้"><i class="bi bi-shield-lock"></i></button>`
        : `<div class="form-check form-switch m-0 d-flex align-items-center gap-2">
             <input class="form-check-input" type="checkbox" role="switch" style="width:2.6em;height:1.4em" ${u.active ? 'checked' : ''} ${self ? 'disabled title="ไม่สามารถระงับบัญชีของตัวเอง"' : ''}
               onchange="userToggle(${attr(u.id)}, this.checked)" aria-label="เปิด/ระงับบัญชี">
             <span class="small ${u.active ? 'text-success' : 'text-muted'}">${u.active ? 'Active' : 'Inactive'}</span>
           </div>`;

      return `<tr class="${u.active ? '' : 'row-off'}">
        <td>${u.id}</td>
        <td><div class="user-cell">
          <div class="avatar" style="background:${colorOf(u.username)}">${esc(ini)}</div>
          <div><div class="fw-semibold">${esc(u.fullname || u.username)}${self ? ' <span class="badge bg-light text-dark border ms-1">คุณ</span>' : ''}</div>
          <div class="text-muted small">@${esc(u.username)}</div></div></div></td>
        <td><span class="badge ${esc(r.badge)}">${esc(u.role)}</span><div class="text-muted small d-none d-md-block">${esc(r.name || '')}</div></td>
        <td><code>${esc(u.permissions || '-')}</code></td>
        <td>${statusActionBtn}</td>
        <td class="small">${fmtTime(u.last_login)}</td>
        <td class="text-end text-nowrap">
          <button class="btn btn-sm btn-outline-primary me-1" onclick="openUserMenus(${attr(u.id)})" title="กำหนดช่องทางและสิทธิ์การทำงาน">กำหนดสิทธิ์</button>
          <button class="btn btn-sm btn-outline-primary border-0 me-1" onclick="userEdit(${attr(u.id)})" title="แก้ไข" aria-label="แก้ไข"><i class="bi bi-pencil fs-6"></i></button>
          <button class="btn btn-sm btn-outline-warning border-0" onclick="userReset(${attr(u.id)})" title="รีเซ็ตรหัสผ่าน" aria-label="รีเซ็ตรหัสผ่าน"><i class="bi bi-key fs-6"></i></button>
        </td></tr>`;
    }).join('');

    syncRoleCounts();
  }

  /* ---------- ตัวกรอง ---------- */
  window.userFilter = (k, v) => { filt[k] = v; render(); };
  window.userSetStatus = s => { filt.status = s; render(); };
  window.userClearFilters = () => {
    filt.q = ''; filt.role = ''; filt.status = 'all';
    const s1 = $('userSearch'), s2 = $('userRoleFilter');
    if (s1) s1.value = ''; if (s2) s2.value = '';
    render();
  };

  /* ---------- สร้างรหัสผ่านสุ่ม ---------- */
  function genPassword(len = 10) {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
    const a = new Uint32Array(len); crypto.getRandomValues(a);
    return [...a].map(n => chars[n % chars.length]).join('');
  }

  /* ---------- ฟอร์มเพิ่ม/แก้ไข (ดึง Roles จาก Database) ---------- */
  function formHtml(u) {
    const edit = !!u;
    const currentRole = u ? u.role : 'USER';
    
    // สร้าง Dropdown ตัวเลือก Role จากฐานข้อมูลจริง
    const opts = roleList().map(r => {
      const isSelected = r.key === currentRole ? 'selected' : '';
      return `<option value="${esc(r.key)}" ${isSelected}>${esc(r.key)} — ${esc(r.name || '')}</option>`;
    }).join('');

    const self = edit && isSelf(u);
    return `
      <div class="text-start">
        <div class="mb-3">
          <label class="form-label-wms" for="uf-username">ชื่อผู้ใช้ (Username)</label>
          <input id="uf-username" class="form-control" autocomplete="off" autocapitalize="none" spellcheck="false" placeholder="เช่น picker03" value="${esc(u ? u.username : '')}" ${edit ? 'disabled' : ''}>
          <div class="hint">${edit ? 'ชื่อผู้ใช้เปลี่ยนไม่ได้' : 'a-z, 0-9, จุด ขีดกลาง หรือขีดล่าง • 3–20 ตัว'}</div>
        </div>
        <div class="mb-3">
          <label class="form-label-wms" for="uf-fullname">ชื่อ-นามสกุล (Full Name)</label>
          <input id="uf-fullname" class="form-control" autocomplete="off" placeholder="เช่น สมชาย ใจดี" value="${esc(u ? u.fullname : '')}">
        </div>
        <div class="row mb-3">
          <div class="col-6">
            <label class="form-label-wms" for="uf-role">Role (สิทธิ์)</label>
            <select id="uf-role" class="form-select" ${self ? 'disabled' : ''}>${opts}</select>
          </div>
          <div class="col-6">
            <label class="form-label-wms" for="uf-permissions">Permissions</label>
            <input id="uf-permissions" class="form-control" placeholder="เช่น RECEIVE,PUTAWAY" value="${esc(u ? u.permissions : 'RECEIVE,PUTAWAY')}">
          </div>
        </div>
        ${edit ? '' : `
        <div class="mb-1">
          <label class="form-label-wms" for="uf-pass">รหัสผ่านเริ่มต้น (Password)</label>
          <div class="input-group">
            <input id="uf-pass" type="text" class="form-control" autocomplete="new-password" placeholder="อย่างน้อย 6 ตัวอักษร">
            <button type="button" class="btn btn-outline-secondary" id="uf-gen" title="สุ่มรหัสผ่านให้"><i class="bi bi-magic me-1"></i>สุ่มให้</button>
          </div>
          <div class="hint">แจ้งรหัสนี้ให้พนักงาน แล้วแนะนำให้เปลี่ยนหลังเข้าใช้ครั้งแรก</div>
        </div>`}
      </div>`;
  }

  async function openForm(u) {
    const edit = !!u;
    // ก่อนเปิดฟอร์ม ตรวจสอบให้แน่ใจว่าดึง Roles จาก Database เรียบร้อยแล้ว
    await fetchDbRoles();

    Swal.fire({
      title: edit ? 'แก้ไขผู้ใช้' : 'เพิ่มผู้ใช้ใหม่',
      html: formHtml(u),
      showCancelButton: true, confirmButtonText: edit ? 'บันทึก' : 'เพิ่มผู้ใช้', cancelButtonText: 'ยกเลิก',
      confirmButtonColor: '#4f46e5', focusConfirm: false, showLoaderOnConfirm: true,
      didOpen: () => {
        const g = $('uf-gen');
        if (g) g.onclick = () => { $('uf-pass').value = genPassword(); };
        const f = edit ? $('uf-fullname') : $('uf-username'); f && f.focus();
        Swal.getHtmlContainer().querySelectorAll('input').forEach(i => i.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); Swal.clickConfirm(); } }));
      },
      preConfirm: async () => {
        const username = edit ? u.username : $('uf-username').value.trim().toLowerCase();
        const fullname = $('uf-fullname').value.trim();
        const role = edit && isSelf(u) ? u.role : $('uf-role').value;
        const permissions = $('uf-permissions').value.trim();
        const password = edit ? null : $('uf-pass').value;

        if (!edit) {
          if (!/^[a-z0-9._-]{3,20}$/.test(username)) return Swal.showValidationMessage('ชื่อผู้ใช้ต้องเป็น a-z 0-9 . _ - ยาว 3–20 ตัว');
          if (users.some(x => x.username.toLowerCase() === username)) return Swal.showValidationMessage('ชื่อผู้ใช้นี้มีอยู่แล้ว');
        }
        if (!fullname) return Swal.showValidationMessage('กรุณากรอกชื่อ-นามสกุล');
        if (!edit && (!password || password.length < 6)) return Swal.showValidationMessage('รหัสผ่านต้องมีอย่างน้อย 6 ตัวอักษร');
        if (edit && u.role === 'ADMIN' && role !== 'ADMIN' && u.active && activeAdmins() <= 1)
          return Swal.showValidationMessage('ต้องมีผู้ดูแลระบบ (ADMIN) ที่ใช้งานอยู่อย่างน้อย 1 คน');

        try {
          if (edit) {
            if (!demo) await api('PUT', '/' + encodeURIComponent(u.id), { fullname, role, permissions });
            u.fullname = fullname; u.role = role; u.permissions = permissions;
          } else {
            let created = null;
            if (!demo) created = await api('POST', '', { username, fullname, role, password, permissions });
            await loadUsers(true);
          }
        } catch (e) {
          return Swal.showValidationMessage(e.message);
        }
        return true;
      }
    }).then(r => {
      if (r.isConfirmed) { Toast.fire({ icon: 'success', title: edit ? 'บันทึกการแก้ไขแล้ว' : 'เพิ่มผู้ใช้เรียบร้อย' }); render(); }
    });
  }

  window.openAddUser = () => openForm(null);
  window.userEdit = id => { const u = users.find(x => String(x.id) === String(id)); if (u) openForm(u); };

  /* ---------- เปิด/ระงับบัญชี ---------- */
  window.userToggle = async (id, active) => {
    const u = users.find(x => String(x.id) === String(id));
    if (!u) return;
    if (isSelf(u)) { render(); return; }
    if (u.role === 'ADMIN' || u.username.toLowerCase() === 'admin') {
      render();
      Swal.fire({ icon: 'error', title: 'ไม่สามารถระงับบัญชีนี้ได้', text: 'ไม่อนุญาตให้ระงับบัญชีผู้ดูแลระบบสูงสุด (ADMIN)', confirmButtonColor: '#4f46e5' });
      return;
    }
    if (!active && u.role === 'ADMIN' && activeAdmins() <= 1) {
      render();
      Swal.fire({ icon: 'warning', title: 'ระงับไม่ได้', text: 'ต้องมีผู้ดูแลระบบ (ADMIN) ที่ใช้งานอยู่อย่างน้อย 1 คน', confirmButtonColor: '#4f46e5' });
      return;
    }
    if (!active) {
      const r = await Swal.fire({
        icon: 'question', title: `ระงับบัญชี @${u.username}?`,
        text: 'ผู้ใช้จะเข้าสู่ระบบไม่ได้ แต่ประวัติการสแกนยังอยู่ครบ และเปิดใช้งานใหม่ได้ทุกเมื่อ',
        showCancelButton: true, confirmButtonColor: '#ef4444', confirmButtonText: 'ระงับบัญชี', cancelButtonText: 'ยกเลิก'
      });
      if (!r.isConfirmed) { render(); return; }
    }
    try {
      if (!demo) await api('PATCH', '/' + encodeURIComponent(u.id) + '/status', { active });
      u.active = active;
      Toast.fire({ icon: 'success', title: active ? 'เปิดใช้งานบัญชีแล้ว' : 'ระงับบัญชีแล้ว' });
    } catch (e) {
      Swal.fire({ icon: 'error', title: 'ทำรายการไม่สำเร็จ', text: e.message, confirmButtonColor: '#4f46e5' });
    }
    render();
  };

  /* ---------- รีเซ็ตรหัสผ่าน ---------- */
  window.userReset = async id => {
    const u = users.find(x => String(x.id) === String(id));
    if (!u) return;
    const c = await Swal.fire({
      icon: 'question', title: `รีเซ็ตรหัสผ่าน @${u.username}?`,
      text: 'ระบบจะสร้างรหัสผ่านชั่วคราวใหม่ให้ รหัสเดิมจะใช้ไม่ได้ทันที',
      showCancelButton: true, confirmButtonColor: '#d97706', confirmButtonText: 'รีเซ็ตรหัสผ่าน', cancelButtonText: 'ยกเลิก',
      showLoaderOnConfirm: true,
      preConfirm: async () => {
        const pw = genPassword();
        try { if (!demo) await api('POST', '/' + encodeURIComponent(u.id) + '/reset-password', { password: pw }); return pw; }
        catch (e) { Swal.showValidationMessage(e.message); return false; }
      }
    });
    if (!c.isConfirmed) return;
    const pw = c.value;
    await Swal.fire({
      icon: 'success', title: 'รีเซ็ตรหัสผ่านแล้ว',
      html: `<div class="small text-muted mb-2">รหัสผ่านชั่วคราวของ <b>@${esc(u.username)}</b><br>แสดงครั้งเดียว กรุณาคัดลอกและแจ้งผู้ใช้</div>
             <div class="copy-box" id="pwBox">${esc(pw)}</div>`,
      showCancelButton: true, confirmButtonText: '<i class="bi bi-clipboard me-1"></i>คัดลอก', cancelButtonText: 'ปิด',
      confirmButtonColor: '#4f46e5', allowOutsideClick: false,
      preConfirm: async () => {
        try { await navigator.clipboard.writeText(pw); Toast.fire({ icon: 'success', title: 'คัดลอกแล้ว' }); }
        catch (_) { const r = document.createRange(); r.selectNode($('pwBox')); getSelection().removeAllRanges(); getSelection().addRange(r); Toast.fire({ icon: 'info', title: 'เลือกข้อความแล้ว กด Ctrl+C' }); }
        return false;
      }
    });
  };

  window.loadUsers = loadUsers;
})();