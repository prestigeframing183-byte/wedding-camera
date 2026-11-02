'use strict';
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];

async function api(path, opts = {}) {
  const o = { ...opts, headers: { ...(opts.headers || {}) } };
  if (o.body && !(o.body instanceof FormData)) {
    o.headers['Content-Type'] = 'application/json';
    o.body = JSON.stringify(o.body);
  }
  const r = await fetch(path, o);
  if (r.status === 204) return null;
  const data = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error(data.error || r.statusText); e.status = r.status; e.data = data; throw e; }
  return data;
}

const store = {
  get(k, d = null) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

let toastTimer;
function toast(msg) {
  let t = $('.toast');
  if (!t) { t = document.createElement('div'); t.className = 'toast'; document.body.appendChild(t); }
  t.textContent = msg; t.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
}

function eventCode() { return location.pathname.split('/')[2].toUpperCase(); }

function fmtDate(ts) {
  return new Date(ts).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

/** Renders a live countdown into el; calls done() when it hits zero. Server clock offset is applied. */
function countdown(el, target, serverNow, done) {
  const skew = serverNow ? serverNow - Date.now() : 0;
  const tick = () => {
    let ms = target - (Date.now() + skew);
    if (ms <= 0) { clearInterval(iv); el.innerHTML = ''; done && done(); return; }
    const d = Math.floor(ms / 864e5); ms %= 864e5;
    const h = Math.floor(ms / 36e5); ms %= 36e5;
    const m = Math.floor(ms / 6e4); const s = Math.floor((ms % 6e4) / 1e3);
    const parts = d ? [[d, 'days'], [h, 'hrs'], [m, 'min']] : [[h, 'hrs'], [m, 'min'], [s, 'sec']];
    el.innerHTML = parts.map(([v, l]) => `<div><b>${String(v).padStart(2, '0')}</b><small>${l}</small></div>`).join('');
  };
  const iv = setInterval(tick, 1000); tick();
  return () => clearInterval(iv);
}
