/* Select the current page rather than retaining another screen's active menu. */
(()=>{document.querySelectorAll('.warehouse-sidebar a[href]').forEach(a=>{const current=new URL(a.href,location.href).pathname===location.pathname;a.classList.toggle('active',current);if(current)a.setAttribute('aria-current','page');else a.removeAttribute('aria-current');});})();
if(!document.querySelector('script[src*="workflow-icons.js"]')){const iconScript=document.createElement('script');iconScript.src='/js/workflow-icons.js?v=20261120-workflow-icons-1';document.head.append(iconScript);}
/* Save sidebar group preferences per signed-in user and UI surface. */
(() => {
  const surface = location.pathname.startsWith('/handheld/') ? 'HANDHELD' : 'DESKTOP';
  let preferences = {};
  let saveQueue = Promise.resolve();
  function setGroup(group, expanded) {
    group.classList.toggle('is-collapsed', !expanded);
    group.querySelector('.sidebar-section-title').setAttribute('aria-expanded', String(expanded));
    group.querySelector('.sidebar-group-items').hidden = !expanded;
    group.querySelector('.sidebar-section-title i').className = 'bi ' + (expanded ? 'bi-chevron-down' : 'bi-chevron-right');
  }
  function serializeGroups() {
    document.querySelectorAll('.warehouse-sidebar .sidebar-group[data-sidebar-group]').forEach(group => {
      preferences[group.dataset.sidebarGroup] = !group.querySelector('.sidebar-group-items').hidden;
    });
  }
  function savePreferences() {
    serializeGroups();
    saveQueue = saveQueue.then(async () => {
      try {
        await fetch('/api/preferences/sidebar', {
          method: 'PUT',
          headers: authHeaders(),
          body: JSON.stringify({ surface, states: preferences })
        });
      } catch (error) { console.warn('บันทึกสถานะเมนูไม่สำเร็จ', error); }
    });
  }
  function restoreGroups() {
    document.querySelectorAll('.warehouse-sidebar .sidebar-group[data-sidebar-group]').forEach(group => {
      const active = Boolean(group.querySelector('[aria-current="page"]'));
      const saved = preferences[group.dataset.sidebarGroup];
      setGroup(group, active || saved === true);
      preferences[group.dataset.sidebarGroup] = active || saved === true;
    });
  }
  window.toggleSidebarGroup = function(name) {
    const group = document.querySelector('[data-sidebar-group="' + name + '"]');
    if (!group) return;
    const expanded = group.querySelector('.sidebar-group-items').hidden;
    setGroup(group, expanded);
    savePreferences();
  };
  restoreGroups();
  fetch('/api/preferences/sidebar?surface=' + surface, { headers: authHeaders() })
    .then(response => response.ok ? response.json() : null)
    .then(result => {
      if (!result?.success) return;
      preferences = result.states || {};
      restoreGroups();
      savePreferences();
    }).catch(error => console.warn('โหลดสถานะเมนูไม่สำเร็จ', error));
  if (window.innerWidth < 992) document.getElementById('adminWrapper')?.classList.add('sidebar-collapsed');
})();

/* Operations reuse the same pages for scanners and supervisors. */
(()=>{let user;try{user=JSON.parse(localStorage.getItem('user')||'{}')}catch{return}if(['ADMIN','USER'].includes(user.role))return;document.querySelectorAll('[onclick="openDeliveryForm()"],#plannerSave,[onclick="autoAllocateStorage()"]').forEach(e=>e.hidden=true);const home=document.createElement('a');home.href='/handheld/index.html';home.textContent='← เมนูงานของฉัน';home.className='btn btn-outline-primary m-2';document.querySelector('main')?.prepend(home);})();
