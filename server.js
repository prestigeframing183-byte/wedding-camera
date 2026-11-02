'use strict';
const express = require('express');
const multer = require('multer');
const QRCode = require('qrcode');
const archiver = require('archiver');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
const DB_FILE = path.join(DATA_DIR, 'db.json');
const MAX_SHOTS = 100;

fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// ---------- tiny JSON store ----------
let db = { events: {} };
if (fs.existsSync(DB_FILE)) db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
let saveTimer = null;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const tmp = DB_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(db));
    fs.renameSync(tmp, DB_FILE);
  }, 50);
}
function flush() {
  clearTimeout(saveTimer);
  fs.writeFileSync(DB_FILE, JSON.stringify(db));
}

const id = (n = 12) => crypto.randomBytes(n).toString('base64url').slice(0, n);
const code = () => {
  const a = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  do { s = Array.from(crypto.randomBytes(6), b => a[b % a.length]).join(''); } while (db.events[s]);
  return s;
};

function isRevealed(ev) { return ev.revealAt != null && Date.now() >= ev.revealAt; }
function isAdmin(ev, req) {
  const key = req.query.key || req.get('x-admin-key');
  return !!key && key.length === ev.adminKey.length &&
    crypto.timingSafeEqual(Buffer.from(key), Buffer.from(ev.adminKey));
}
function publicEvent(ev) {
  return {
    code: ev.code, name: ev.name, subtitle: ev.subtitle, date: ev.date,
    shotsPerGuest: ev.shotsPerGuest, revealAt: ev.revealAt, revealed: isRevealed(ev),
    closed: !!ev.closed, photoCount: ev.photos.length,
    guestCount: Object.keys(ev.guests).length, now: Date.now(),
  };
}
function photoOut(ev, p, viewerGuest) {
  return {
    id: p.id, guestName: (ev.guests[p.guestId] || {}).name || 'Guest',
    takenAt: p.takenAt, filter: p.filter, likes: p.likes.length,
    liked: viewerGuest ? p.likes.includes(viewerGuest) : false,
    url: `/p/${ev.code}/${p.id}.jpg`,
  };
}
function parseReveal(body, date) {
  const mode = body.revealMode || 'nextMorning';
  if (mode === 'instant') return Date.now();
  if (mode === 'manual') return null;
  if (mode === 'custom') {
    const t = Date.parse(body.revealAt);
    if (Number.isNaN(t)) throw new Error('Invalid reveal time');
    return t;
  }
  // nextMorning: 9am the day after the event (local server time)
  const d = date ? new Date(date + 'T00:00:00') : new Date();
  d.setDate(d.getDate() + 1); d.setHours(9, 0, 0, 0);
  return d.getTime();
}

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '100kb' }));
app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));

function loadEvent(req, res, next) {
  const ev = db.events[String(req.params.code || '').toUpperCase()];
  if (!ev) return res.status(404).json({ error: 'Event not found' });
  req.ev = ev; next();
}
function requireAdmin(req, res, next) {
  if (!isAdmin(req.ev, req)) return res.status(403).json({ error: 'Host key required' });
  next();
}

// ---------- events ----------
app.post('/api/events', (req, res) => {
  const b = req.body || {};
  const name = String(b.name || '').trim().slice(0, 80);
  if (!name) return res.status(400).json({ error: 'Event name is required' });
  const shots = Math.max(1, Math.min(MAX_SHOTS, parseInt(b.shotsPerGuest, 10) || 24));
  const date = /^\d{4}-\d{2}-\d{2}$/.test(b.date || '') ? b.date : null;
  let revealAt;
  try { revealAt = parseReveal(b, date); } catch (e) { return res.status(400).json({ error: e.message }); }
  const ev = {
    code: code(), adminKey: id(24), name, subtitle: String(b.subtitle || '').slice(0, 120),
    date, shotsPerGuest: shots, revealAt, closed: false, createdAt: Date.now(),
    guests: {}, photos: [],
  };
  db.events[ev.code] = ev; save();
  res.status(201).json({ code: ev.code, adminKey: ev.adminKey });
});

app.get('/api/events/:code', loadEvent, (req, res) => {
  const out = publicEvent(req.ev);
  if (isAdmin(req.ev, req)) {
    out.isHost = true;
    out.guests = Object.entries(req.ev.guests).map(([gid, g]) => ({
      id: gid, name: g.name, shots: req.ev.photos.filter(p => p.guestId === gid).length,
    }));
  }
  res.json(out);
});

app.patch('/api/events/:code', loadEvent, requireAdmin, (req, res) => {
  const ev = req.ev, b = req.body || {};
  if (b.name != null) ev.name = String(b.name).trim().slice(0, 80) || ev.name;
  if (b.subtitle != null) ev.subtitle = String(b.subtitle).slice(0, 120);
  if (b.shotsPerGuest != null) ev.shotsPerGuest = Math.max(1, Math.min(MAX_SHOTS, parseInt(b.shotsPerGuest, 10) || ev.shotsPerGuest));
  if (b.closed != null) ev.closed = !!b.closed;
  if (b.revealMode) {
    try { ev.revealAt = parseReveal(b, ev.date); } catch (e) { return res.status(400).json({ error: e.message }); }
  }
  save(); res.json(publicEvent(ev));
});

app.get('/api/events/:code/qr.png', loadEvent, async (req, res) => {
  const url = `${req.protocol}://${req.get('host')}/e/${req.ev.code}`;
  const png = await QRCode.toBuffer(url, { width: 600, margin: 2, color: { dark: '#2b2118', light: '#ffffff' } });
  res.type('png').send(png);
});

// ---------- guests ----------
app.post('/api/events/:code/guests', loadEvent, (req, res) => {
  const name = String((req.body || {}).name || '').trim().slice(0, 40);
  if (!name) return res.status(400).json({ error: 'Name is required' });
  const gid = id(16);
  req.ev.guests[gid] = { name, joinedAt: Date.now() }; save();
  res.status(201).json({ guestId: gid, name });
});

app.get('/api/events/:code/guests/:gid', loadEvent, (req, res) => {
  const g = req.ev.guests[req.params.gid];
  if (!g) return res.status(404).json({ error: 'Guest not found' });
  const used = req.ev.photos.filter(p => p.guestId === req.params.gid).length;
  res.json({ name: g.name, shotsUsed: used, shotsLeft: Math.max(0, req.ev.shotsPerGuest - used) });
});

// ---------- photos ----------
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 12 * 1024 * 1024, files: 1 },
  fileFilter: (req, f, cb) => cb(null, /^image\/(jpeg|png|webp)$/.test(f.mimetype)),
});

app.post('/api/events/:code/photos', loadEvent, upload.single('photo'), (req, res) => {
  const ev = req.ev, gid = req.body.guestId;
  if (!ev.guests[gid]) return res.status(403).json({ error: 'Join the event first' });
  if (ev.closed) return res.status(409).json({ error: 'The camera is closed for this event' });
  if (!req.file) return res.status(400).json({ error: 'Photo is required' });
  const used = ev.photos.filter(p => p.guestId === gid).length;
  if (used >= ev.shotsPerGuest) return res.status(409).json({ error: 'Your roll is finished' });
  const pid = id(12);
  const dir = path.join(UPLOAD_DIR, ev.code);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, pid + '.jpg'), req.file.buffer);
  ev.photos.push({ id: pid, guestId: gid, takenAt: Date.now(), filter: String(req.body.filter || '').slice(0, 20), likes: [] });
  save();
  res.status(201).json({ id: pid, shotsLeft: ev.shotsPerGuest - used - 1 });
});

app.get('/api/events/:code/photos', loadEvent, (req, res) => {
  const ev = req.ev, admin = isAdmin(ev, req);
  if (!admin && !isRevealed(ev)) return res.status(423).json({ error: 'Photos are still developing', revealAt: ev.revealAt });
  const sort = req.query.sort === 'popular'
    ? (a, b) => b.likes.length - a.likes.length || b.takenAt - a.takenAt
    : (a, b) => a.takenAt - b.takenAt;
  let list = [...ev.photos];
  if (req.query.guest) list = list.filter(p => p.guestId === req.query.guest);
  res.json(list.sort(sort).map(p => photoOut(ev, p, req.query.viewer)));
});

app.post('/api/events/:code/photos/:pid/like', loadEvent, (req, res) => {
  const ev = req.ev, gid = (req.body || {}).guestId;
  if (!isRevealed(ev)) return res.status(423).json({ error: 'Not revealed yet' });
  if (!ev.guests[gid]) return res.status(403).json({ error: 'Join the event first' });
  const p = ev.photos.find(x => x.id === req.params.pid);
  if (!p) return res.status(404).json({ error: 'Photo not found' });
  const i = p.likes.indexOf(gid);
  if (i >= 0) p.likes.splice(i, 1); else p.likes.push(gid);
  save(); res.json({ likes: p.likes.length, liked: i < 0 });
});

app.delete('/api/events/:code/photos/:pid', loadEvent, requireAdmin, (req, res) => {
  const ev = req.ev, i = ev.photos.findIndex(x => x.id === req.params.pid);
  if (i < 0) return res.status(404).json({ error: 'Photo not found' });
  ev.photos.splice(i, 1); save();
  fs.rm(path.join(UPLOAD_DIR, ev.code, req.params.pid + '.jpg'), { force: true }, () => {});
  res.status(204).end();
});

app.get('/p/:code/:pid.jpg', loadEvent, (req, res) => {
  const ev = req.ev;
  if (!isRevealed(ev) && !isAdmin(ev, req)) return res.status(423).send('Still developing');
  const p = ev.photos.find(x => x.id === req.params.pid);
  if (!p) return res.status(404).send('Not found');
  res.set('Cache-Control', 'private, max-age=86400');
  if (req.query.download) res.attachment(`${ev.name}-${p.id}.jpg`);
  res.sendFile(path.join(UPLOAD_DIR, ev.code, p.id + '.jpg'));
});

app.get('/api/events/:code/download.zip', loadEvent, (req, res) => {
  const ev = req.ev;
  if (!isRevealed(ev) && !isAdmin(ev, req)) return res.status(423).json({ error: 'Still developing' });
  res.attachment(`${ev.name.replace(/[^\w\- ]+/g, '').trim() || 'photos'}.zip`);
  const zip = archiver('zip', { store: true });
  zip.on('error', () => res.destroy());
  zip.pipe(res);
  ev.photos.forEach((p, i) => {
    const f = path.join(UPLOAD_DIR, ev.code, p.id + '.jpg');
    const who = ((ev.guests[p.guestId] || {}).name || 'guest').replace(/[^\w\- ]+/g, '');
    if (fs.existsSync(f)) zip.file(f, { name: `${String(i + 1).padStart(4, '0')}-${who}.jpg` });
  });
  zip.finalize();
});

// ---------- pages ----------
const page = f => (req, res) => res.sendFile(path.join(__dirname, 'public', f));
app.get('/e/:code', page('camera.html'));
app.get('/e/:code/gallery', page('gallery.html'));
app.get('/h/:code', page('host.html'));

app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) return res.status(400).json({ error: err.message });
  console.error(err); res.status(500).json({ error: 'Server error' });
});

if (require.main === module) {
  app.listen(PORT, () => console.log(`Wedding Camera running on http://localhost:${PORT}`));
  for (const s of ['SIGINT', 'SIGTERM']) process.on(s, () => { flush(); process.exit(0); });
}
module.exports = { app, db, flush };
