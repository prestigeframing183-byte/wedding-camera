'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs'); const os = require('os'); const path = require('path');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'wc-'));
const { app } = require('../server');

const JPEG = Buffer.from('/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=', 'base64');

test('event lifecycle', async t => {
  const srv = app.listen(0); t.after(() => srv.close());
  const base = `http://localhost:${srv.address().port}`;
  const j = (p, o = {}) => fetch(base + p, { ...o, headers: { 'content-type': 'application/json', ...(o.headers || {}) }, body: o.body && JSON.stringify(o.body) });

  let r = await j('/api/events', { method: 'POST', body: { name: 'A & B', shotsPerGuest: 2, revealMode: 'manual' } });
  assert.equal(r.status, 201);
  const { code, adminKey } = await r.json();

  r = await j(`/api/events/${code}/guests`, { method: 'POST', body: { name: 'Sam' } });
  const { guestId } = await r.json();

  const shoot = () => { const fd = new FormData(); fd.append('guestId', guestId); fd.append('photo', new Blob([JPEG], { type: 'image/jpeg' }), 'x.jpg'); return fetch(`${base}/api/events/${code}/photos`, { method: 'POST', body: fd }); };
  assert.equal((await shoot()).status, 201);
  assert.equal((await shoot()).status, 201);
  assert.equal((await shoot()).status, 409, 'roll limit enforced');

  assert.equal((await j(`/api/events/${code}/photos`)).status, 423, 'hidden before reveal');
  const hostList = await (await j(`/api/events/${code}/photos?key=${adminKey}`)).json();
  assert.equal(hostList.length, 2, 'host sees photos early');
  assert.equal((await fetch(base + hostList[0].url)).status, 423, 'file hidden too');

  r = await j(`/api/events/${code}`, { method: 'PATCH', headers: { 'x-admin-key': 'nope' }, body: { revealMode: 'instant' } });
  assert.equal(r.status, 403);
  r = await j(`/api/events/${code}`, { method: 'PATCH', headers: { 'x-admin-key': adminKey }, body: { revealMode: 'instant' } });
  assert.equal((await r.json()).revealed, true);

  const list = await (await j(`/api/events/${code}/photos?viewer=${guestId}`)).json();
  assert.equal(list.length, 2);
  assert.equal((await fetch(base + list[0].url)).status, 200);
  r = await j(`/api/events/${code}/photos/${list[0].id}/like`, { method: 'POST', body: { guestId } });
  assert.deepEqual(await r.json(), { likes: 1, liked: true });

  r = await fetch(`${base}/api/events/${code}/download.zip`);
  assert.equal(r.status, 200);
  assert.equal(Buffer.from(await r.arrayBuffer()).subarray(0, 2).toString(), 'PK');
  assert.equal((await fetch(`${base}/api/events/${code}/qr.png`)).headers.get('content-type'), 'image/png');
});
