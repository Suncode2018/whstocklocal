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
  document.querySelectorAll('.supervisor-sidebar .sidebar-group').forEach(group => {
    setGroup(group, group.querySelector('[aria-current="page"]') ? true : state[group.dataset.sidebarGroup] !== false);
  });
  if (window.innerWidth < 992) document.getElementById('adminWrapper')?.classList.add('sidebar-collapsed');
})();
