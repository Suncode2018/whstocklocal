let shortageReasonMasterRows = [];

const shortageReasonEsc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));

async function shortageReasonApi(path = '', options = {}) {
  const response = await fetch(`/api/receiving/reasons${path}`, {
    ...options,
    headers: { ...authHeaders(), ...(options.headers || {}) }
  });
  const payload = await response.json();
  if (response.status === 403 && payload.isExpired) { logout(); throw new Error('เซสชันหมดอายุ'); }
  if (!response.ok || !payload.success) throw new Error(payload.message || 'จัดการ Master เหตุผลขาดส่งไม่สำเร็จ');
  return payload;
}

async function loadShortageReasonMaster() {
  const tbody = document.getElementById('shortageReasonsTableBody');
  if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="6" class="text-center py-3 text-muted">กำลังโหลด...</td></tr>';
  try {
    const payload = await shortageReasonApi();
    shortageReasonMasterRows = payload.data || [];
    tbody.innerHTML = shortageReasonMasterRows.length ? shortageReasonMasterRows.map(reason => {
      const active = reason.IsActive === true || reason.IsActive === 1;
      return `<tr>
        <td><code>${shortageReasonEsc(reason.ReasonCode)}</code></td>
        <td><strong>${shortageReasonEsc(reason.ReasonName)}</strong></td>
        <td>${reason.RequiresNote ? '<span class="badge bg-warning text-dark">บังคับกรอก</span>' : 'ไม่บังคับ'}</td>
        <td>${reason.SortOrder}</td>
        <td><span class="badge ${active ? 'bg-success' : 'bg-secondary'}">${active ? 'Active' : 'Inactive'}</span></td>
        <td class="text-nowrap"><button class="btn btn-sm btn-outline-primary" onclick="editShortageReason(${Number(reason.ReasonId)})" title="แก้ไข"><i class="bi bi-pencil"></i></button> ${active ? `<button class="btn btn-sm btn-outline-danger" onclick="deactivateShortageReason(${Number(reason.ReasonId)})" title="ปิดใช้งาน"><i class="bi bi-toggle-off"></i></button>` : ''}</td>
      </tr>`;
    }).join('') : '<tr><td colspan="6" class="text-center py-3 text-muted">ยังไม่มีเหตุผลขาดส่ง</td></tr>';
  } catch (error) { tbody.innerHTML = `<tr><td colspan="6" class="text-center py-3 text-danger">${shortageReasonEsc(error.message)}</td></tr>`; }
}

async function addShortageReason() {
  const result = await Swal.fire({
    title: 'เพิ่มเหตุผลขาดส่ง',
    html: '<label class="form-label-wms text-start w-100" for="newReasonCode">รหัส (อังกฤษ/ตัวเลข/underscore)</label><input id="newReasonCode" class="form-control form-control-wms mb-2" maxlength="30" placeholder="เช่น SUPPLIER_DELAY"><label class="form-label-wms text-start w-100" for="newReasonName">ชื่อที่แสดงใน Handheld</label><input id="newReasonName" class="form-control form-control-wms mb-2" maxlength="100" placeholder="เช่น ผู้ขายส่งล่าช้า"><label class="form-label-wms text-start w-100" for="newReasonSort">ลำดับการแสดง</label><input id="newReasonSort" class="form-control form-control-wms mb-2" type="number" step="1" value="50"><div class="form-check text-start"><input id="newReasonNote" class="form-check-input" type="checkbox"><label for="newReasonNote" class="form-check-label">บังคับให้ผู้แจ้งกรอกหมายเหตุ</label></div>',
    showCancelButton: true, confirmButtonText: 'เพิ่มเหตุผล', cancelButtonText: 'ยกเลิก',
    preConfirm: () => {
      const reasonCode = document.getElementById('newReasonCode').value.trim().toUpperCase();
      const reasonName = document.getElementById('newReasonName').value.trim();
      const sortOrder = Number(document.getElementById('newReasonSort').value);
      if (!/^[A-Z0-9_]{2,30}$/.test(reasonCode)) { Swal.showValidationMessage('รหัสต้องมี 2–30 ตัว และใช้ A-Z, 0-9 หรือ underscore'); return false; }
      if (!reasonName) { Swal.showValidationMessage('กรุณาระบุชื่อเหตุผล'); return false; }
      if (!Number.isInteger(sortOrder)) { Swal.showValidationMessage('ลำดับต้องเป็นจำนวนเต็ม'); return false; }
      return { reasonCode, reasonName, sortOrder, requiresNote: document.getElementById('newReasonNote').checked };
    }
  });
  if (!result.isConfirmed) return;
  try {
    await shortageReasonApi('', { method: 'POST', body: JSON.stringify(result.value) });
    toast('success', 'เพิ่มเหตุผลขาดส่งแล้ว');
    await loadShortageReasonMaster();
  } catch (error) { toast('error', error.message); }
}

async function editShortageReason(reasonId) {
  const reason = shortageReasonMasterRows.find(item => Number(item.ReasonId) === Number(reasonId));
  if (!reason) return;
  const result = await Swal.fire({
    title: 'แก้ไขเหตุผลขาดส่ง',
    html: `<div class="text-start mb-2"><span class="text-muted">รหัส (แก้ไขไม่ได้)</span><br><code>${shortageReasonEsc(reason.ReasonCode)}</code></div><label class="form-label-wms text-start w-100" for="editReasonName">ชื่อเหตุผล</label><input id="editReasonName" class="form-control form-control-wms mb-2" maxlength="100" value="${shortageReasonEsc(reason.ReasonName)}"><label class="form-label-wms text-start w-100" for="editReasonSort">ลำดับการแสดง</label><input id="editReasonSort" class="form-control form-control-wms mb-2" type="number" step="1" value="${Number(reason.SortOrder)}"><div class="form-check text-start mb-2"><input id="editReasonNote" class="form-check-input" type="checkbox" ${reason.RequiresNote ? 'checked' : ''}><label for="editReasonNote" class="form-check-label">บังคับกรอกหมายเหตุ</label></div><div class="form-check text-start"><input id="editReasonActive" class="form-check-input" type="checkbox" ${reason.IsActive ? 'checked' : ''}><label for="editReasonActive" class="form-check-label">เปิดใช้งานใน Handheld</label></div>`,
    showCancelButton: true, confirmButtonText: 'บันทึก', cancelButtonText: 'ยกเลิก',
    preConfirm: () => {
      const reasonName = document.getElementById('editReasonName').value.trim();
      const sortOrder = Number(document.getElementById('editReasonSort').value);
      if (!reasonName) { Swal.showValidationMessage('กรุณาระบุชื่อเหตุผล'); return false; }
      if (!Number.isInteger(sortOrder)) { Swal.showValidationMessage('ลำดับต้องเป็นจำนวนเต็ม'); return false; }
      return { reasonName, sortOrder, requiresNote: document.getElementById('editReasonNote').checked, isActive: document.getElementById('editReasonActive').checked };
    }
  });
  if (!result.isConfirmed) return;
  try {
    await shortageReasonApi(`/${reasonId}`, { method: 'PUT', body: JSON.stringify(result.value) });
    toast('success', 'บันทึก Master เหตุผลแล้ว');
    await loadShortageReasonMaster();
  } catch (error) { toast('error', error.message); }
}

async function deactivateShortageReason(reasonId) {
  const confirm = await Swal.fire({ title: 'ปิดใช้งานเหตุผลนี้?', text: 'เหตุผลจะไม่แสดงใน Handheld แต่ข้อมูลแจ้งเดิมจะยังอยู่', icon: 'warning', showCancelButton: true, confirmButtonText: 'ปิดใช้งาน', cancelButtonText: 'กลับ' });
  if (!confirm.isConfirmed) return;
  try {
    await shortageReasonApi(`/${reasonId}`, { method: 'DELETE' });
    toast('success', 'ปิดใช้งานเหตุผลแล้ว');
    await loadShortageReasonMaster();
  } catch (error) { toast('error', error.message); }
}
