/* ============================================================
   common.js — Shared utilities (parseJwt, session, beep)
   ============================================================ */

/**
 * Decode JWT payload (supports Base64URL + UTF-8 / Thai chars)
 */
function parseJwt(token) {
  try {
    const base64Url = token.split('.')[1];
    const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
    const padded  = base64.padEnd(base64.length + (4 - base64.length % 4) % 4, '=');
    const json    = decodeURIComponent(
      atob(padded).split('').map(c => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2)).join('')
    );
    return JSON.parse(json);
  } catch { return null; }
}

/**
 * Redirect to login & clear storage
 */
function logout(msg = '') {
  localStorage.clear();
  window.location.href = '/index.html' + (msg ? '?msg=' + encodeURIComponent(msg) : '');
}

/**
 * Check JWT on page load — redirect if missing / invalid
 * Returns decoded payload or null (already redirected)
 */
function requireAuth(allowedRoles = []) {
  const token   = localStorage.getItem('token');
  const payload = token ? parseJwt(token) : null;
  if (!payload) { logout('กรุณา Login ใหม่'); return null; }

  // แก้: normalize role เป็น uppercase ก่อนเปรียบเทียบ
  const role = (payload.role || '').toUpperCase();
  payload.role = role; // normalize ใน payload ด้วย

  if (allowedRoles.length && !allowedRoles.map(r => r.toUpperCase()).includes(role)) {
    logout('ไม่มีสิทธิ์เข้าถึงหน้านี้'); return null;
  }
  return payload;
}

/**
 * Render session countdown badge  (#sessionBadge, #sessionTime)
 * Automatically logs out when expired.
 */
function startSessionCountdown() {
  const token = localStorage.getItem('token');
  const payload = token ? parseJwt(token) : null;
  if (!payload) return;

  const badgeEl = document.getElementById('sessionBadge');
  const timeEl  = document.getElementById('sessionTime');

  function tick() {
    const remaining = payload.exp - Math.floor(Date.now() / 1000);
    if (remaining <= 0) { logout('หมดเวลาใช้งาน กรุณา Login ใหม่'); return; }

    const h = Math.floor(remaining / 3600);
    const m = Math.floor((remaining % 3600) / 60);
    const s = remaining % 60;
    const fmt = h > 0
      ? `${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')} ชม.`
      : `${m}:${String(s).padStart(2,'0')} นาที`;

    if (timeEl)  timeEl.textContent = fmt;
    if (badgeEl) {
      badgeEl.className = 'session-badge';
      if (remaining < 300)       badgeEl.classList.add('danger');
      else if (remaining < 1800) badgeEl.classList.add('warning');
    }
  }
  tick();
  setInterval(tick, 1000);
}

/**
 * Simple beep via Web Audio API
 */
function beep(freq = 880, duration = 120, type = 'sine') {
  try {
    const ctx  = new (window.AudioContext || window.webkitAudioContext)();
    const osc  = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain); gain.connect(ctx.destination);
    osc.type = type; osc.frequency.value = freq;
    gain.gain.setValueAtTime(.4, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(.001, ctx.currentTime + duration / 1000);
    osc.start(); osc.stop(ctx.currentTime + duration / 1000);
  } catch {}
}

function beepError() { beep(220, 300, 'sawtooth'); }
function beepOK()    { beep(1000, 100); setTimeout(() => beep(1200, 100), 130); }

/**
 * Show SweetAlert2 toast
 */
function toast(icon, title) {
  Swal.fire({ toast:true, position:'top-end', icon, title: escapeHtml(title), showConfirmButton:false, timer:2500, timerProgressBar:true });
}

/**
 * Auth headers for fetch
 */
function authHeaders(extra = {}) {
  return { 'Content-Type': 'application/json', Authorization: 'Bearer ' + localStorage.getItem('token'), ...extra };
}

/* ============================================================
   Added helpers (security / admin pages)
   ============================================================ */

/** Escape text before putting into innerHTML (prevents XSS) */
function escapeHtml(v) {
  return String(v ?? '').replace(/[&<>"']/g, c => (
    { '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]
  ));
}

/** Date + time, e.g. 30/10/69 14:05 */
function formatDateTime(v) {
  if (!v) return '-';
  const d = new Date(v);
  if (isNaN(d)) return '-';
  return d.toLocaleString('th-TH', { day:'2-digit', month:'2-digit', year:'2-digit', hour:'2-digit', minute:'2-digit' });
}

function debounce(fn, ms = 200) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

/**
 * fetch with auth headers. 401 -> logout (throws Error('unauthorized')),
 * 403 -> toast + throws Error('forbidden').
 */
async function apiFetch(url, options = {}) {
  const { headers, ...rest } = options;
  const res = await fetch(url, { ...rest, headers: authHeaders(headers) });
  if (res.status === 401) { logout('Session หมดอายุ'); throw new Error('unauthorized'); }
  if (res.status === 403) { toast('error', 'ไม่มีสิทธิ์ดำเนินการนี้'); throw new Error('forbidden'); }
  return res;
}

/** Current logged-in user (from JWT) */
function getCurrentUser() {
  const t = localStorage.getItem('token');
  const p = t ? parseJwt(t) : null;
  const username = (p?.username || localStorage.getItem('username') || '').toLowerCase();
  const id = p ? (p.id ?? p.userId ?? p.sub ?? null) : null;
  return { id, username };
}

/** Is this user row (from /api/users) the logged-in account? */
function isSelfUser(u) {
  const me = getCurrentUser();
  if (me.username && String(u.Username || '').toLowerCase() === me.username) return true;
  return me.id != null && String(u.Id) === String(me.id);
}