/* Keep the core warehouse workflow icons recognizable and consistent. */
(() => {
  if (!document.getElementById('workflowIconsTheme')) {
    const theme = document.createElement('link');
    theme.id = 'workflowIconsTheme';
    theme.rel = 'stylesheet';
    theme.href = '/css/workflow-icons.css?v=20261120-icon-refresh-1';
    document.head.append(theme);
  }
  const iconByPath = new Map([
    ['receive.html', 'bi-box-arrow-in-down-left'],
    ['putaway.html', 'bi-inboxes-fill'],
    ['check.html', 'bi-clipboard2-check-fill'],
    ['pick.html', 'bi-box-arrow-up-right'],
    ['cycle-count.html', 'bi-clipboard2-data-fill'],
    ['load.html', 'bi-truck']
  ]);
  document.querySelectorAll('.sidebar-menu-item[href], .sidebar-menu-item[id^="tab-op-"]').forEach(item => {
    const target = item.getAttribute('href') || '';
    const filename = target.split('?')[0].split('/').pop();
    const iconName = iconByPath.get(filename) || iconByPath.get(item.id.replace(/^tab-op-/, '').toLowerCase() + '.html');
    if (!iconName) return;
    const icon = item.querySelector('i');
    if (!icon) return;
    icon.className = icon.className.replace(/\bbi-[\w-]+\b/g, '').trim() + ' bi ' + iconName;
  });
})();
