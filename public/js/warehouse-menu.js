/* Select the current page rather than retaining another screen's active menu. */
(()=>{document.querySelectorAll('.warehouse-sidebar a[href]').forEach(a=>{const current=new URL(a.href,location.href).pathname===location.pathname;a.classList.toggle('active',current);if(current)a.setAttribute('aria-current','page');else a.removeAttribute('aria-current');});})();
/* Consistent group behavior across Supervisor pages. */
(() => {
  const stateKey = 'wmsSidebarGroups:SUPERVISOR';
  let state = {};
  try { state = JSON.parse(localStorage.getItem(stateKey) || '{}') || {}; } catch (_) {}
  function setGroup(group, expanded) {
    group.classList.toggle('is-collapsed', !expanded);
    group.querySelector('.sidebar-section-title').setAttribute('aria-expanded', String(expanded));
    group.querySelector('.sidebar-group-items').hidden = !expanded;
    group.querySelector('.sidebar-section-title i').className = 'bi ' + (expanded ? 'bi-chevron-down' : 'bi-chevron-right');
  }
  window.toggleSidebarGroup = function(name) {
    const group = document.querySelector('[data-sidebar-group="' + name + '"]');
    if (!group) return;
    const expanded = group.querySelector('.sidebar-group-items').hidden;
    setGroup(group, expanded);
    state[name] = expanded;
    try { localStorage.setItem(stateKey, JSON.stringify(state)); } catch (_) {}
  };
  document.querySelectorAll('.warehouse-sidebar .sidebar-group').forEach(group => {
    setGroup(group, group.querySelector('[aria-current="page"]') ? true : state[group.dataset.sidebarGroup] !== false);
  });
  if (window.innerWidth < 992) document.getElementById('adminWrapper')?.classList.add('sidebar-collapsed');
})();

/* Operations reuse the same pages for scanners and supervisors. */
(()=>{let user;try{user=JSON.parse(localStorage.getItem('user')||'{}')}catch{return}if(['ADMIN','USER'].includes(user.role))return;document.querySelectorAll('[onclick="openDeliveryForm()"],#plannerSave,[onclick="autoAllocateStorage()"]').forEach(e=>e.hidden=true);const home=document.createElement('a');home.href='/handheld/index.html';home.textContent='← เมนูงานของฉัน';home.className='btn btn-outline-primary m-2';document.querySelector('main')?.prepend(home);})();
