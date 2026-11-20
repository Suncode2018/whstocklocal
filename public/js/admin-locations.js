/* ============================================================
   admin-locations.js — จัดการข้อมูลโลเคชั่นเชื่อมโยงกับคลังสินค้า (tblWH)
   ============================================================ */

let editingLocationId = null;
let locationSaving = false;
let warehousesCache = [];
let locationLoadVersion = 0;
let locationsMasterRows = [];
let locationPage = 1;
const locationPageSize = 50;
const locationHtml = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

// ฟังก์ชัน Fetch แบบปลอดภัย (ลองทั้ง 2 Path กรณีตั้ง Route ต่างกัน)
async function fetchSafeLocations() {
  const headers = typeof authHeaders === 'function' ? authHeaders() : {};
  let res = await fetch('/api/master/locations', { headers });
  return res;
}

// 1. โหลดรายชื่อคลังสินค้า
async function loadWarehouseDropdowns() {
  try {
    const res = await fetch('/api/warehouses', { headers: typeof authHeaders === 'function' ? authHeaders() : {} });
    if (!res.ok) return;
    warehousesCache = await res.json();

    const filterSelect = document.getElementById('locWarehouseFilter');
    if (filterSelect) {
      const cur = filterSelect.value;
      filterSelect.innerHTML = '<option value="">ทุกคลังสินค้า (All Warehouses)</option>' + 
        warehousesCache.map(w => `<option value="${w.whid}">${w.whname} — ${w.whdescription || ''}</option>`).join('');
      filterSelect.value = cur;
    }

    const modalSelect = document.getElementById('modalLocWhId');
    if (modalSelect) {
      modalSelect.innerHTML = warehousesCache.map(w => `<option value="${w.whid}">${w.whname} — ${w.whdescription || ''}</option>`).join('');
    }
  } catch (err) {
    console.warn('โหลดรายชื่อคลังสินค้าไม่สำเร็จ:', err);
  }
}

// 2. ดึงรายการ Locations ทั้งหมด
async function loadLocationsMaster(showToast = false) {
  const tbody = document.getElementById('locationsTableBody');
  if (!tbody) return;
  const version = ++locationLoadVersion;
  const hasLoadedRows = tbody.dataset.loaded === 'true';
  tbody.setAttribute('aria-busy', 'true');
  if (!hasLoadedRows) tbody.innerHTML = `<tr><td colspan="5" class="text-center py-4 text-muted"><span class="spinner-border spinner-border-sm me-2 text-primary"></span>กำลังโหลดข้อมูลโลเคชั่น...</td></tr>`;

  try {
    const [, res] = await Promise.all([loadWarehouseDropdowns(), fetchSafeLocations()]);
    if (!res.ok) throw new Error('API เส้นทาง locations ไม่ตอบสนอง (HTTP ' + res.status + ')');
    const data = await res.json();
    if (version !== locationLoadVersion) return;
    const locations = Array.isArray(data) ? data : (data.data || []);

    locationsMasterRows = locations;
    locationPage = 1;
    renderLocationTable();
    tbody.dataset.loaded = 'true';

    if (showToast && typeof Swal !== 'undefined') {
      Swal.fire({ icon: 'success', title: 'รีเฟรชข้อมูลเรียบร้อย', timer: 1000, showConfirmButton: false });
    }
  } catch (err) {
    if (version !== locationLoadVersion) return;
    if (!hasLoadedRows) tbody.innerHTML = `<tr><td colspan="5" class="text-center py-4 text-danger">เกิดข้อผิดพลาด: ${locationHtml(err.message)}</td></tr>`;
  } finally {
    if (version === locationLoadVersion) tbody.removeAttribute('aria-busy');
  }
}

// 3. Filter in memory and render only one page to keep large location masters fast.
function filteredLocationRows() {
  const q = (document.getElementById('locSearchInput')?.value || '').trim().toLocaleLowerCase();
  const whFilter = document.getElementById('locWarehouseFilter')?.value || '';
  const status = document.getElementById('locStatusFilter')?.value || '';
  return locationsMasterRows.filter(loc => {
    const isActive = loc.IsActive !== false && loc.IsActive !== 0;
    const whName = loc.whname || warehousesCache.find(w => String(w.whid) === String(loc.whid))?.whname || `WH-${loc.whid || 1}`;
    const searchable = [loc.LocationCode, loc.Zone, loc.Description, whName].join(' ').toLocaleLowerCase();
    return (!whFilter || String(loc.whid || '') === whFilter) && (!status || (status === 'active') === isActive) && (!q || searchable.includes(q));
  });
}
function renderLocationTable(keepPage = false) {
  const tbody = document.getElementById('locationsTableBody');
  if (!tbody) return;
  const rows = filteredLocationRows();
  const pages = Math.max(1, Math.ceil(rows.length / locationPageSize));
  locationPage = keepPage ? Math.max(1, Math.min(locationPage, pages)) : 1;
  const start = (locationPage - 1) * locationPageSize;
  const shown = rows.slice(start, start + locationPageSize);
  tbody.innerHTML = shown.map((loc, index) => {
    const id = Number(loc.LocationId || loc.id);
    const whName = loc.whname || warehousesCache.find(w => String(w.whid) === String(loc.whid))?.whname || `WH-${loc.whid || 1}`;
    const code = loc.LocationCode || '—';
    const zone = String(loc.Zone || '—');
    const desc = loc.Description || '';
    const damageLocked = zone.toUpperCase() === 'DAMAGE' && !(typeof wmsNavigation !== 'undefined' && String(wmsNavigation?.user?.role || wmsNavigation?.user?.Role).toUpperCase() === 'ADMIN');
    const isActive = loc.IsActive !== false && loc.IsActive !== 0;
    const dims = [loc.CapacityWidthCm, loc.CapacityLengthCm, loc.CapacityHeightCm].map(Number);
    const hasDims = dims.every(Number.isFinite) && dims.every(value => value > 0);
    const volume = Number(loc.CapacityVolumeCm3 || (hasDims ? dims[0] * dims[1] * dims[2] : 0));
    const dimensions = hasDims ? `${dims.map(value => value.toLocaleString('th-TH')).join(' × ')} cm` : 'ไม่ระบุขนาด';
    const volumeLabel = volume > 0 ? `${volume.toLocaleString('th-TH')} cm³` : 'ไม่ระบุความจุ';
    return `<tr data-whid="${locationHtml(loc.whid || '')}">
      <td><div class="location-master-identity"><strong>${locationHtml(code)}</strong><span title="${locationHtml(desc)}">${locationHtml(desc || 'ไม่มีคำอธิบาย')}</span></div></td>
      <td><div class="location-master-context"><span class="badge bg-light text-dark border">${locationHtml(whName)}</span><span class="badge ${zone.toUpperCase() === 'DAMAGE' ? 'bg-danger-subtle text-danger' : 'bg-secondary-subtle text-dark'}">${locationHtml(zone.toUpperCase() === 'DAMAGE' ? 'DAMAGE · ชำรุด' : zone)}</span></div></td>
      <td><div class="location-master-capacity"><strong>${locationHtml(dimensions)}</strong><span>${locationHtml(volumeLabel)}</span></div></td>
      <td><span class="badge rounded-pill ${isActive ? 'bg-success-subtle text-success' : 'bg-secondary-subtle text-secondary'}">${isActive ? 'ใช้งาน' : 'ปิดใช้งาน'}</span></td>
      <td class="text-end text-nowrap"><button type="button" class="btn btn-sm btn-outline-primary" data-location-edit="${id}" ${damageLocked ? 'disabled' : ''} title="แก้ไข ${locationHtml(code)}" aria-label="แก้ไข ${locationHtml(code)}"><i class="bi bi-pencil-square"></i></button> <button type="button" class="btn btn-sm btn-outline-secondary" data-location-delete="${id}" ${damageLocked ? 'disabled' : ''} title="ปิดใช้งาน ${locationHtml(code)}" aria-label="ปิดใช้งาน ${locationHtml(code)}"><i class="bi bi-pause-circle"></i></button></td>
    </tr>`;
  }).join('') || `<tr><td colspan="5" class="text-center py-5 text-muted">${locationsMasterRows.length ? 'ไม่พบ Location ที่ตรงกับตัวกรอง' : 'ยังไม่มี Location ในระบบ · เพิ่ม Location เพื่อเริ่มจัดเก็บสินค้า'}</td></tr>`;
  document.getElementById('locResultsCount').textContent = `พบ ${rows.length.toLocaleString('th-TH')} จาก ${locationsMasterRows.length.toLocaleString('th-TH')} Location`;
  document.getElementById('locPageInfo').textContent = rows.length ? `หน้า ${locationPage.toLocaleString('th-TH')} / ${pages.toLocaleString('th-TH')}` : '';
  document.getElementById('locPrev').disabled = locationPage <= 1;
  document.getElementById('locNext').disabled = locationPage >= pages;
  tbody.onclick = event => {
    const edit = event.target.closest('[data-location-edit]');
    const remove = event.target.closest('[data-location-delete]');
    if (edit) { const loc = locationsMasterRows.find(item => Number(item.LocationId || item.id) === Number(edit.dataset.locationEdit)); if (loc) openEditLocation(loc); }
    if (remove) deleteLocation(Number(remove.dataset.locationDelete));
  };
}
function filterLocationTable() { renderLocationTable(); }
function changeLocationPage(delta) { locationPage += delta; renderLocationTable(true); }
function clearLocationFilters() {
  document.getElementById('locSearchInput').value = '';
  document.getElementById('locWarehouseFilter').value = '';
  document.getElementById('locStatusFilter').value = '';
  renderLocationTable();
}

// 4. Modal จัดการ Location
function openAddLocation() {
  editingLocationId = null;
  document.getElementById('locModalTitle').textContent = 'เพิ่มโลเคชั่นใหม่';
  if (warehousesCache.length > 0) document.getElementById('modalLocWhId').value = document.getElementById('locWarehouseFilter')?.value || warehousesCache[0].whid;
  document.getElementById('modalLocCode').value = '';
  document.getElementById('modalLocZone').value = '';
  document.getElementById('modalLocDesc').value = '';
  document.getElementById('modalLocWidth').value = '';
  document.getElementById('modalLocLength').value = '';
  document.getElementById('modalLocHeight').value = '';
  document.getElementById('modalLocStatus').value = '1';
  new bootstrap.Modal(document.getElementById('locModal')).show();
}

function openEditLocation(loc) {
  editingLocationId = loc.LocationId || loc.id;
  document.getElementById('locModalTitle').textContent = 'แก้ไขโลเคชั่น: ' + (loc.LocationCode || '');
  document.getElementById('modalLocWhId').value = loc.whid || (warehousesCache[0]?.whid || 1);
  document.getElementById('modalLocCode').value = loc.LocationCode || '';
  document.getElementById('modalLocZone').value = loc.Zone || '';
  document.getElementById('modalLocDesc').value = loc.Description || '';
  document.getElementById('modalLocWidth').value = loc.CapacityWidthCm || '';
  document.getElementById('modalLocLength').value = loc.CapacityLengthCm || '';
  document.getElementById('modalLocHeight').value = loc.CapacityHeightCm || '';
  document.getElementById('modalLocStatus').value = (loc.IsActive === false || loc.IsActive === 0) ? '0' : '1';
  new bootstrap.Modal(document.getElementById('locModal')).show();
}

async function saveLocation() {
  if(locationSaving)return;
  const whid = parseInt(document.getElementById('modalLocWhId').value, 10);
  const locationCode = document.getElementById('modalLocCode').value.trim().toUpperCase();
  const zone = document.getElementById('modalLocZone').value.trim().toUpperCase();
  const description = document.getElementById('modalLocDesc').value.trim();
  const isActive = document.getElementById('modalLocStatus').value === '1';

  const w = parseFloat(document.getElementById('modalLocWidth').value) || null;
  const l = parseFloat(document.getElementById('modalLocLength').value) || null;
  const h = parseFloat(document.getElementById('modalLocHeight').value) || null;

  if (!whid || !locationCode || !zone) {
    Swal.fire('แจ้งเตือน', 'กรุณาระบุคลังสินค้า, รหัสโลเคชั่น และโซน', 'warning');
    return;
  }

  if ((w || l || h) && (!w || !l || !h || w <= 0 || l <= 0 || h <= 0)) {
    Swal.fire('แจ้งเตือน', 'หากระบุมิติความจุ ต้องระบุทั้ง กว้าง, ยาว, สูง และต้องมากกว่า 0', 'warning');
    return;
  }

  const dimensions = ['modalLocWidth','modalLocLength','modalLocHeight'].map(id=>document.getElementById(id).value.trim());
  if (dimensions.some(v=>v && (!/^\d{1,15}(?:\.\d{1,3})?$/.test(v) || !Number.isFinite(Number(v)) || Number(v)<=0))) {
    Swal.fire('ตรวจสอบขนาด', 'กรอกขนาดเป็นเซนติเมตร จำนวนบวก ทศนิยมไม่เกิน 3 ตำแหน่ง', 'warning');return;
  }
  const payload = {
    whid,
    locationCode,
    zone,
    description,
    isActive,
    capacityWidthCm: dimensions[0] || null,
    capacityLengthCm: dimensions[1] || null,
    capacityHeightCm: dimensions[2] || null,
    capacityVolumeCm3: null // API calculates exact volume from dimensions
  };

  // ใช้ Path ตรงตามที่ระบบเปิดไว้
  const baseUrl = '/api/master/locations';
  const url = editingLocationId ? `${baseUrl}/${editingLocationId}` : baseUrl;
  const method = editingLocationId ? 'PUT' : 'POST';

  locationSaving=true;const saveButton=document.getElementById('locSaveButton');if(saveButton){saveButton.disabled=true;saveButton.textContent='กำลังบันทึก...';}
  try {
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json', ...(typeof authHeaders === 'function' ? authHeaders() : {}) },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if(res.status===409){
      const duplicate=data.code==='DUPLICATE_LOCATION';
      await Swal.fire({icon:'warning',title:duplicate?'รหัสโลเคชั่นซ้ำ':'ไม่สามารถปิดใช้งานโลเคชั่นได้',text:data.error,confirmButtonText:'กลับไปตรวจสอบ'});
      if(duplicate){document.getElementById('modalLocCode').focus();document.getElementById('modalLocCode').select();}return;
    }
    if (!res.ok) throw new Error(data.error || 'บันทึกไม่สำเร็จ');

    bootstrap.Modal.getInstance(document.getElementById('locModal')).hide();
    Swal.fire({ icon: 'success', title: 'บันทึกสำเร็จ', timer: 1500, showConfirmButton: false });
    loadLocationsMaster();
  } catch (err) {
    Swal.fire('ผิดพลาด', err.message, 'error');
  } finally {locationSaving=false;if(saveButton){saveButton.disabled=false;saveButton.textContent='บันทึก';}}
}

async function deleteLocation(id) {
  const confirm = await Swal.fire({
    title: 'ปิดใช้งาน Location?',
    text: 'ระบบจะเก็บประวัติ Location ไว้ และไม่นำไปใช้จัดเก็บสินค้าใหม่',
    icon: 'warning',
    showCancelButton: true,
    confirmButtonColor: '#ef4444',
    confirmButtonText: 'ปิดใช้งาน',
    cancelButtonText: 'ยกเลิก'
  });

  if (!confirm.isConfirmed) return;

  try {
    const res = await fetch(`/api/master/locations/${id}`, {
      method: 'DELETE',
      headers: typeof authHeaders === 'function' ? authHeaders() : {}
    });
    const data = await res.json();
    if(res.status===409){await Swal.fire({icon:'warning',title:'ไม่สามารถปิดใช้งานโลเคชั่นได้',text:data.error,confirmButtonText:'รับทราบ'});return;}
    if (!res.ok) throw new Error(data.error || 'ลบไม่สำเร็จ');

    Swal.fire({ icon: 'success', title: 'ปิดใช้งานแล้ว', timer: 1200, showConfirmButton: false });
    loadLocationsMaster();
  } catch (err) {
    Swal.fire('ผิดพลาด', err.message, 'error');
  }
}
