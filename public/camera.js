'use strict';
const CODE = eventCode();
const GKEY = 'guest:' + CODE;
let ev, guest = store.get(GKEY), shotsLeft = 0;
let stream = null, facing = 'environment', flashOn = false, film = store.get('film', 'classic');
let busy = false;

const show = id => $$('.screen').forEach(s => s.classList.toggle('hidden', s.id !== id));

// ---------- offline-safe upload queue (IndexedDB) ----------
const idb = (() => {
  let dbp;
  const open = () => dbp || (dbp = new Promise((res, rej) => {
    const r = indexedDB.open('wc-queue', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('shots', { keyPath: 'id', autoIncrement: true });
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  }));
  const tx = async (mode, fn) => {
    const db = await open();
    return new Promise((res, rej) => {
      const t = db.transaction('shots', mode), st = t.objectStore('shots'), out = fn(st);
      t.oncomplete = () => res(out && out.result); t.onerror = () => rej(t.error);
    });
  };
  return {
    add: v => tx('readwrite', s => s.add(v)),
    all: () => tx('readonly', s => s.getAll()),
    del: k => tx('readwrite', s => s.delete(k)),
  };
})();
const memQueue = []; // fallback when IndexedDB is unavailable (private mode)
let pendingCount = 0, flushing = false;

async function enqueue(item) {
  try { await idb.add(item); } catch { memQueue.push(item); }
  pendingCount++; renderPending(); flushQueue();
}
async function flushQueue() {
  if (flushing) return; flushing = true;
  try {
    let items = [];
    try { items = await idb.all(); } catch {}
    items = items.concat(memQueue.filter(m => !items.includes(m)));
    items = items.filter(i => i.code === CODE);
    pendingCount = items.length; renderPending();
    for (const it of items) {
      const fd = new FormData();
      fd.append('guestId', it.guestId); fd.append('filter', it.filter);
      fd.append('photo', it.blob, 'shot.jpg');
      try {
        await api(`/api/events/${CODE}/photos`, { method: 'POST', body: fd });
      } catch (e) {
        if (!e.status || e.status >= 500) throw e; // network trouble: retry later
        toast(e.message); // 4xx: drop it (roll finished, closed, etc.)
      }
      if (it.id != null) await idb.del(it.id).catch(() => {});
      const mi = memQueue.indexOf(it); if (mi >= 0) memQueue.splice(mi, 1);
      pendingCount--; renderPending();
    }
  } catch { setTimeout(() => { flushing = false; flushQueue(); }, 5000); return; }
  flushing = false;
  if (pendingCount > 0) flushQueue(); // shots taken while we were uploading
}
function renderPending() {
  const p = $('#pending');
  p.classList.toggle('hidden', pendingCount <= 0);
  p.textContent = `Saving ${pendingCount} shot${pendingCount === 1 ? '' : 's'}…`;
}
window.addEventListener('online', flushQueue);

// ---------- event / guest ----------
async function init() {
  try { ev = await api(`/api/events/${CODE}`); }
  catch { document.body.innerHTML = '<div class="wrap center"><h1>Event not found</h1><p class="muted">Check the QR code or link.</p></div>'; return; }
  document.title = `${ev.name} · Camera`;
  $$('.ev-name').forEach(e => e.textContent = ev.name);
  $('.ev-sub').textContent = ev.subtitle || '';
  $('.ev-shots').textContent = ev.shotsPerGuest;
  $('.ev-reveal').textContent = ev.revealed ? 'Photos are already developed' :
    ev.revealAt ? `Photos reveal ${fmtDate(ev.revealAt)}` : 'Photos reveal when the hosts say so';
  $('#galleryLink').href = $('#doneGallery').href = `/e/${CODE}/gallery`;

  if (guest) {
    try { const g = await api(`/api/events/${CODE}/guests/${guest.guestId}`); shotsLeft = g.shotsLeft; }
    catch { guest = null; }
  }
  if (!guest) return show('join');
  await openCamera();
}

$('#joinForm').addEventListener('submit', async e => {
  e.preventDefault();
  const name = e.target.name.value.trim(); if (!name) return;
  try {
    guest = await api(`/api/events/${CODE}/guests`, { method: 'POST', body: { name } });
    store.set(GKEY, guest); store.set('guestName', name);
    shotsLeft = ev.shotsPerGuest;
    await openCamera();
  } catch (err) { toast(err.message); }
});
$('#joinForm').name.value = store.get('guestName', '');

// ---------- camera ----------
async function openCamera() {
  let queued = 0;
  try { queued = (await idb.all()).filter(i => i.code === CODE).length; } catch {}
  shotsLeft = Math.max(0, shotsLeft - queued);
  if (ev.closed || shotsLeft <= 0) return finish();
  show('camera'); renderCounter(); renderFilters(); flushQueue();
  await startStream();
}

async function startStream() {
  stopStream();
  const msg = $('#vfMsg');
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return fallbackMode('Camera not available in this browser.');
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: { ideal: facing }, width: { ideal: 1920 }, height: { ideal: 1920 } },
    });
    const v = $('#video'); v.srcObject = stream; await v.play().catch(() => {});
    v.classList.toggle('mirror', facing === 'user');
    msg.classList.add('hidden');
    const caps = stream.getVideoTracks()[0].getCapabilities?.() || {};
    $('#flashBtn').dataset.torch = caps.torch ? '1' : '';
  } catch (e) {
    fallbackMode('Camera access was blocked. Allow camera access in your browser settings, or tap the shutter to use your phone camera.');
  }
}
function stopStream() { if (stream) stream.getTracks().forEach(t => t.stop()); stream = null; }
function fallbackMode(text) {
  const m = $('#vfMsg'); m.textContent = text; m.classList.remove('hidden');
}

function renderCounter() {
  const c = $('.counter'); $('#left').textContent = String(shotsLeft).padStart(2, '0');
  c.classList.remove('bump'); void c.offsetWidth; c.classList.add('bump');
}
function renderFilters() {
  $('#filters').innerHTML = Object.entries(FILMS).map(([k, f]) => `<button data-k="${k}" class="${k === film ? 'on' : ''}">${f.label}</button>`).join('');
  $('#video').style.filter = FILMS[film].css;
}
$('#filters').addEventListener('click', e => {
  const k = e.target.dataset.k; if (!k) return;
  film = k; store.set('film', k); renderFilters();
});
$('#flipBtn').addEventListener('click', () => { facing = facing === 'user' ? 'environment' : 'user'; startStream(); });
$('#flashBtn').addEventListener('click', () => {
  flashOn = !flashOn;
  $('#flashBtn').classList.toggle('on', flashOn);
  $('#flashBtn small').textContent = flashOn ? 'on' : 'off';
});

async function setTorch(on) {
  const t = stream && stream.getVideoTracks()[0];
  if (t && $('#flashBtn').dataset.torch) { try { await t.applyConstraints({ advanced: [{ torch: on }] }); } catch {} }
}
const wait = ms => new Promise(r => setTimeout(r, ms));

$('#shutter').addEventListener('click', async () => {
  if (busy || shotsLeft <= 0) return;
  if (!stream) return $('#fileInput').click();
  busy = true;
  try {
    const v = $('#video');
    if (flashOn) {
      if (facing === 'user' || !$('#flashBtn').dataset.torch) { $('#screenFlash').classList.add('on'); await wait(180); }
      else { await setTorch(true); await wait(350); }
    }
    const vf = $('#vf').getBoundingClientRect();
    const canvas = frameToCanvas(v, v.videoWidth, v.videoHeight, { mirror: facing === 'user', targetAspect: vf.width / vf.height });
    $('#screenFlash').classList.remove('on'); if (flashOn) setTorch(false);
    const sf = $('#sflash'); sf.classList.remove('go'); void sf.offsetWidth; sf.classList.add('go');
    if (navigator.vibrate) navigator.vibrate(30);
    await take(canvas);
  } finally { busy = false; }
});

$('#fileInput').addEventListener('change', async e => {
  const file = e.target.files[0]; e.target.value = ''; if (!file) return;
  const bmp = await createImageBitmap(file).catch(() => null);
  if (!bmp) return toast('Could not read that photo');
  await take(frameToCanvas(bmp, bmp.width, bmp.height));
});

async function take(canvas) {
  shotsLeft--; renderCounter();
  developCanvas(canvas, film);
  const blob = await new Promise(r => canvas.toBlob(r, 'image/jpeg', 0.88));
  await enqueue({ code: CODE, guestId: guest.guestId, filter: film, blob, at: Date.now() });
  if (shotsLeft <= 0) setTimeout(finish, 600);
}

function finish() {
  stopStream(); show('done');
  if (ev.closed) $('#doneMsg').textContent = 'The camera for this event has been closed.';
  const cd = $('#doneCountdown');
  if (ev.revealed) { $('#doneMsg').textContent += ' The photos are ready!'; return; }
  if (ev.revealAt) countdown(cd, ev.revealAt, ev.now, () => { $('#doneMsg').textContent = 'The photos are ready!'; });
  else $('#doneMsg').textContent += ' Photos will appear when the hosts reveal them.';
}

document.addEventListener('visibilitychange', () => {
  if (document.hidden) stopStream();
  else if (!$('#camera').classList.contains('hidden') && shotsLeft > 0) startStream();
});

init();
