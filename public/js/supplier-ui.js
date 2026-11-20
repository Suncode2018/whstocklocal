function supplierMenuGroups(menus) {
  const groups = new Map();
  for (const menu of menus) {
    if (!groups.has(menu.group)) groups.set(menu.group, []);
    groups.get(menu.group).push(menu);
  }
  const order = ['ข้อมูลหลัก', 'งานคลัง', 'รายงาน', 'ตั้งค่าระบบ'];
  const subgroupOrder = {
    'งานคลัง': ['รับเข้าและจัดเก็บ', 'เบิกและเคลื่อนย้าย', 'ควบคุมสต๊อก'],
    'รายงาน': ['ภาพรวม', 'สต๊อก', 'การผลิต'],
    'ตั้งค่าระบบ': ['บัญชีผู้ใช้', 'กำหนดสิทธิ์']
  };
  const orderedGroups = [...order.filter(group => groups.has(group)), ...[...groups.keys()].filter(group => !order.includes(group))];
  return orderedGroups.flatMap(group => group === 'ข้อมูลหลัก'
    ? orderRelatedMasterItems(groups.get(group))
    : orderSubgroupItems(groups.get(group), subgroupOrder[group] || []));
}

function orderRelatedMasterItems(menus) {
  const items = menus.map(withDefaultSubgroup);
  const rank = ['สินค้าและโครงสร้างคลัง', 'คู่ค้าและผู้ผลิต', 'ผู้ขนส่ง', 'ลูกค้า', 'การผลิต'];
  return orderSubgroupItems(items, rank);
}

function withDefaultSubgroup(menu) {
  const defaults = {
    PRODUCTS: 'สินค้าและโครงสร้างคลัง', WAREHOUSES: 'สินค้าและโครงสร้างคลัง', LOCATIONS: 'สินค้าและโครงสร้างคลัง',
    SUPPLIERS: 'คู่ค้าและผู้ผลิต', MANUFACTURER_PRODUCTS: 'คู่ค้าและผู้ผลิต',
    TRANSPORT: 'ผู้ขนส่ง', TRANSPORT_PRODUCTS: 'ผู้ขนส่ง', CUSTOMERS: 'ลูกค้า', CUSTOMER_PRODUCTS: 'ลูกค้า',
    BOM: 'การผลิต', SHORTAGE_REASONS: 'การผลิต',
    RECEIVE: 'รับเข้าและจัดเก็บ', PUTAWAY: 'รับเข้าและจัดเก็บ', PICK: 'เบิกและเคลื่อนย้าย', LOAD: 'เบิกและเคลื่อนย้าย', TRANSFER: 'เบิกและเคลื่อนย้าย',
    WAREHOUSE_TRACKING: 'ควบคุมสต๊อก', CHECK: 'ควบคุมสต๊อก', CYCLECOUNT: 'ควบคุมสต๊อก', LOOKUP: 'ควบคุมสต๊อก',
    REPORTS: 'ภาพรวม', STOCK: 'สต๊อก', STOCK_DAILY: 'สต๊อก', BOM_STOCK: 'การผลิต',
    USERS: 'บัญชีผู้ใช้', ROLES: 'กำหนดสิทธิ์', PERMISSIONS: 'กำหนดสิทธิ์'
  };
  return { ...menu, subgroup: menu.subgroup || defaults[menu.code] || null };
}

function orderSubgroupItems(menus, rank = []) {
  const positions = new Map(rank.map((name, index) => [name, index]));
  return menus
    .map((menu, index) => ({ menu: withDefaultSubgroup(menu), index }))
    .sort((a, b) => {
      const aRank = positions.has(a.menu.subgroup) ? positions.get(a.menu.subgroup) : rank.length;
      const bRank = positions.has(b.menu.subgroup) ? positions.get(b.menu.subgroup) : rank.length;
      return aRank - bRank || a.index - b.index;
    })
    .map(({ menu }) => menu);
}

function toggleSupplierSidebar(force) {
  const wrapper = document.getElementById('adminWrapper');
  if (!wrapper) return;
  const expanded = force === undefined ? wrapper.classList.contains('sidebar-collapsed') : force;
  wrapper.classList.toggle('sidebar-collapsed', !expanded);
  const shade = document.getElementById('supplierSideShade');
  if (shade) shade.hidden = !(expanded && innerWidth < 992);
  document.querySelectorAll('[onclick="toggleSidebar()"],[onclick="toggleSupplierSidebar()"]')
    .forEach(button => button.setAttribute('aria-expanded', String(expanded)));
}

(() => {
  const wrapper = document.getElementById('adminWrapper');
  if (!wrapper) return;
  window.toggleSidebar = () => toggleSupplierSidebar();
  const shade = document.createElement('button');
  shade.type = 'button';
  shade.id = 'supplierSideShade';
  shade.className = 'supplier-side-shade';
  shade.hidden = true;
  shade.setAttribute('aria-label', 'ปิดเมนู');
  shade.addEventListener('click', () => toggleSupplierSidebar(false));
  document.body.append(shade);
  if (innerWidth < 992) wrapper.classList.add('sidebar-collapsed');
  window.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !document.querySelector('dialog[open],.modal.show')) toggleSupplierSidebar(false);
  });
  window.addEventListener('resize', () => {
    shade.hidden = innerWidth >= 992 || wrapper.classList.contains('sidebar-collapsed');
  });
})();

window.addEventListener('wms-navigation', event => {
  const navigation = event.detail;
  const sidebar = document.querySelector('.admin-sidebar');
  if (!sidebar) return;

  for (const id of ['supplierShellUser', 'userName']) {
    const element = document.getElementById(id);
    if (element) element.textContent = navigation.user.fullname || navigation.user.username;
  }
  const role = document.getElementById('supplierShellRole');
  if (role) role.textContent = navigation.user.role;
  const brand = document.querySelector('.brand-sub');
  if (brand) brand.textContent = (navigation.user.role === 'ADMIN' ? 'Admin' : 'Desktop') + ' • จัดการข้อมูลและงานคลังสินค้า';
  if (['/admin/index.html', '/desktop/master.html'].includes(location.pathname)) return;

  sidebar.replaceChildren();
  const home = document.createElement('a');
  home.href = '/desktop/index.html';
  home.className = 'supplier-side-home';
  home.innerHTML = '<i class="bi bi-grid" aria-hidden="true"></i><span>ศูนย์งานคลังสินค้า</span>';
  sidebar.append(home);

  let groupName = null;
  let groupItems = null;
  let subgroupItems = new Map();
  const current = typeof navigationPageCode === 'function' ? navigationPageCode() : null;
  const icons = {
    CHECK: 'clipboard-check', TRANSPORT: 'truck', TRANSPORT_PRODUCTS: 'truck',
    CUSTOMER_PRODUCTS: 'person-lines-fill', PRODUCTS: 'box-seam', SUPPLIERS: 'truck',
    CUSTOMERS: 'people', MANUFACTURER_PRODUCTS: 'building-gear', BOM: 'diagram-3',
    WAREHOUSES: 'buildings', LOCATIONS: 'geo-alt', RECEIVE: 'box-arrow-in-down',
    PUTAWAY: 'box-seam', PICK: 'box-arrow-up', LOAD: 'truck', CYCLECOUNT: 'clipboard-check',
    TRANSFER: 'arrow-left-right', LOOKUP: 'search', STOCK: 'bar-chart', STOCK_DAILY: 'calendar3',
    BOM_STOCK: 'clipboard-data', USERS: 'people', ROLES: 'person-badge',
    PERMISSIONS: 'shield-check', SHORTAGE_REASONS: 'exclamation-diamond'
  };

  for (const menu of supplierMenuGroups(navigation.menus)) {
    if (menu.group !== groupName) {
      groupName = menu.group;
      subgroupItems = new Map();
      const section = document.createElement('section');
      section.className = 'sidebar-group';
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'sidebar-section-title';
      const isActiveGroup = navigation.menus.some(item => item.group === groupName && item.code === current);
      button.setAttribute('aria-expanded', String(isActiveGroup));
      const label = document.createElement('span');
      label.textContent = groupName;
      const chevron = document.createElement('i');
      chevron.className = 'bi bi-chevron-down';
      button.append(label, chevron);
      groupItems = document.createElement('div');
      groupItems.className = 'sidebar-group-items';
      groupItems.hidden = !isActiveGroup;
      chevron.className = 'bi bi-chevron-' + (isActiveGroup ? 'down' : 'right');
      button.addEventListener('click', () => {
        const items = itemsForButton(button);
        const expand = items.hidden;
        if (expand) {
          sidebar.querySelectorAll('.sidebar-section-title').forEach(otherButton => {
            if (otherButton === button) return;
            const otherItems = itemsForButton(otherButton);
            if (otherItems) otherItems.hidden = true;
            otherButton.setAttribute('aria-expanded', 'false');
            const otherChevron = otherButton.querySelector('i');
            if (otherChevron) otherChevron.className = 'bi bi-chevron-right';
          });
        }
        items.hidden = !expand;
        button.setAttribute('aria-expanded', String(expand));
        chevron.className = 'bi bi-chevron-' + (expand ? 'down' : 'right');
      });
      section.append(button, groupItems);
      sidebar.append(section);
    }

    let destination = groupItems;
    const subgroup = menu.subgroup || ({
      TRANSPORT: 'ผู้ขนส่ง', TRANSPORT_PRODUCTS: 'ผู้ขนส่ง',
      CUSTOMERS: 'ลูกค้า', CUSTOMER_PRODUCTS: 'ลูกค้า'
    })[menu.code] || null;
    if (subgroup) {
      destination = subgroupItems.get(subgroup);
      if (!destination) {
        const subgroupElement = document.createElement('div');
        subgroupElement.className = 'sidebar-subgroup';
        const heading = document.createElement('div');
        heading.className = 'sidebar-subgroup-title';
        heading.textContent = subgroup;
        destination = document.createElement('div');
        destination.className = 'sidebar-subgroup-items';
        subgroupElement.append(heading, destination);
        groupItems.append(subgroupElement);
        subgroupItems.set(subgroup, destination);
      }
    }

    const link = document.createElement('a');
    link.className = 'sidebar-menu-item' + (menu.code === current ? ' active' : '');
    link.href = menu.path;
    link.dataset.navigationCode = menu.code;
    if (menu.code === current) link.setAttribute('aria-current', 'page');
    const icon = document.createElement('i');
    icon.className = 'bi bi-' + (icons[menu.code] || 'grid');
    icon.setAttribute('aria-hidden', 'true');
    const text = document.createElement('span');
    text.textContent = menu.name;
    link.append(icon, text);
    destination.append(link);
  }
});

function itemsForButton(button) {
  return button.nextElementSibling;
}
