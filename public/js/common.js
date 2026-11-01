/* ============================================================
   common.js — ฟังก์ชันกลางสำหรับระบบ WMS
   ============================================================ */

// ตรวจสอบ Token และสิทธิ์การเข้าใช้งานหน้าเว็บ
function requireAuth(allowedRoles = []) {
  const token = localStorage.getItem('token');
  const userStr = localStorage.getItem('user');

  if (!token || !userStr) {
    window.location.href = '/index.html?msg=' + encodeURIComponent('กรุณาเข้าสู่ระบบก่อน');
    return null;
  }

  try {
    const user = JSON.parse(userStr);
    if (allowedRoles.length > 0 && !allowedRoles.includes(user.role)) {
      window.location.href = '/index.html?msg=' + encodeURIComponent('ไม่มีสิทธิ์เข้าถึงหน้านี้');
      return null;
    }
    return user;
  } catch (err) {
    console.error('Auth parse error:', err);
    logout();
    return null;
  }
}

// สร้าง Header สำหรับแนบไปกับคำขอ API ที่ต้องใช้สิทธิ์
function authHeaders() {
  const token = localStorage.getItem('token');
  return {
    'Authorization': 'Bearer ' + (token || ''),
    'Content-Type': 'application/json'
  };
}

// ฟังก์ชันออกจากระบบ
function logout() {
  localStorage.removeItem('token');
  localStorage.removeItem('user');
  window.location.href = '/index.html';
}