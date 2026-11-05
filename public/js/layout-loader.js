async function initLayout(activeMenuId) {
  try {
    // 1. ตรวจสอบ Login ผ่าน Token/Payload
    const payload = typeof requireAuth === 'function' ? requireAuth(['ADMIN', 'POWERUSER']) : null;
    if (!payload && typeof requireAuth === 'function') return;

    // 2. ดึง Navbar เข้ามาใส่ในแท็ก #navbarContainer
    const navRes = await fetch('/includes/navbar.html');
    if (navRes.ok) document.getElementById('navbarContainer').innerHTML = await navRes.text();

    // 3. ดึง Sidebar เข้ามาใส่ในแท็ก #sidebarContainer
    const sideRes = await fetch('/includes/sidebar.html');
    if (sideRes.ok) {
      document.getElementById('sidebarContainer').innerHTML = await sideRes.text();
      
      // ตั้งค่า Active เมนูของหน้านั้นๆ
      if (activeMenuId) {
        const activeLink = document.getElementById(activeMenuId);
        if (activeLink) {
          activeLink.classList.add('active');
          const group = activeLink.closest('.sidebar-group');
          if (group) setSidebarGroup(group.dataset.sidebarGroup, true, false);
        }
      }
    }

    // 4. แสดงชื่อและ Role
    if (payload) {
      const displayName = [payload.fullname, payload.fullName, payload.Fullname, payload.FullName, payload.username, payload.Username]
        .find(val => val != null && String(val).trim()) || 'ผู้ใช้งาน';
      if (document.getElementById('userName')) document.getElementById('userName').textContent = displayName;
      if (document.getElementById('userRole')) document.getElementById('userRole').textContent = payload.role || 'USER';
    }

    if (window.innerWidth < 992) document.getElementById('adminWrapper')?.classList.add('sidebar-collapsed');
  } catch (err) {
    console.error('Layout initialization error:', err);
  }
}

function toggleSidebar() {
  document.getElementById('adminWrapper')?.classList.toggle('sidebar-collapsed');
}

function setSidebarGroup(groupName, expanded) {
  const group = document.querySelector(`[data-sidebar-group="${groupName}"]`);
  if (!group) return;
  const heading = group.querySelector('.sidebar-section-title');
  const items = group.querySelector('.sidebar-group-items');
  group.classList.toggle('is-collapsed', !expanded);
  heading?.setAttribute('aria-expanded', String(expanded));
  if (items) items.hidden = !expanded;
  const icon = heading?.querySelector('i');
  if (icon) icon.className = `bi ${expanded ? 'bi-chevron-down' : 'bi-chevron-right'}`;
}

function toggleSidebarGroup(groupName) {
  const group = document.querySelector(`[data-sidebar-group="${groupName}"]`);
  if (group) setSidebarGroup(groupName, group.classList.contains('is-collapsed'));
}

function doLogout() {
  Swal.fire({
    title: 'ออกจากระบบ?',
    text: 'ต้องการออกจากระบบใช่หรือไม่',
    icon: 'question',
    showCancelButton: true,
    confirmButtonColor: '#ef4444',
    confirmButtonText: 'ออกจากระบบ',
    cancelButtonText: 'อยู่ต่อ'
  }).then(r => { if (r.isConfirmed && typeof logout === 'function') logout(); });
}

// ฟังก์ชันโหลด Layout สำหรับ Power User
async function initPowerUserLayout(activeMenuId) {
  try {
    const payload = typeof requireAuth === 'function' ? requireAuth(['POWERUSER', 'ADMIN']) : null;
    if (!payload && typeof requireAuth === 'function') return;

    // 1. ดึง Navbar
    const navRes = await fetch('/includes/navbar.html');
    if (navRes.ok) document.getElementById('navbarContainer').innerHTML = await navRes.text();

    // 2. ดึง Sidebar สำหรับ Power User
    const sideRes = await fetch('/includes/sidebar-poweruser.html');
    if (sideRes.ok) {
      document.getElementById('sidebarContainer').innerHTML = await sideRes.text();
      if (activeMenuId) {
        const activeLink = document.getElementById(activeMenuId);
        if (activeLink) {
          activeLink.classList.add('active');
          const group = activeLink.closest('.sidebar-group');
          if (group) setSidebarGroup(group.dataset.sidebarGroup, true);
        }
      }
    }

    // 3. แสดงชื่อและ Role
    if (payload) {
      const displayName = [payload.fullname, payload.fullName, payload.Fullname, payload.FullName, payload.username, payload.Username]
        .find(val => val != null && String(val).trim()) || 'ผู้ใช้งาน';
      if (document.getElementById('userName')) document.getElementById('userName').textContent = displayName;
      if (document.getElementById('userRole')) {
        document.getElementById('userRole').textContent = payload.role || 'POWERUSER';
        document.getElementById('userRole').className = 'badge bg-success ms-1';
      }
    }

    if (window.innerWidth < 992) document.getElementById('adminWrapper')?.classList.add('sidebar-collapsed');
  } catch (err) {
    console.error('PowerUser Layout init error:', err);
  }
}