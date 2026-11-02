'use strict';
/* Shared gallery grid + lightbox, used by the guest gallery and the host dashboard. */
function Gallery(el, { code, adminKey = null, viewer = null, onDelete = null }) {
  let photos = [], idx = 0, lb = null;
  const q = adminKey ? `?key=${encodeURIComponent(adminKey)}` : '';
  const src = p => p.url + q;

  function render(list) {
    photos = list;
    el.innerHTML = photos.length ? photos.map((p, i) => `
      <div class="tile" data-i="${i}">
        <img loading="lazy" src="${src(p)}" alt="Photo by ${esc(p.guestName)}">
        <div class="meta"><span>${esc(p.guestName)}</span><span>${p.likes ? '♥ ' + p.likes : ''}</span></div>
        ${onDelete ? `<button class="del" data-del="${p.id}" title="Delete">✕</button>` : ''}
      </div>`).join('') : '<p class="muted center" style="grid-column:1/-1">No photos yet.</p>';
  }
  el.addEventListener('click', async e => {
    const del = e.target.dataset.del;
    if (del) { e.stopPropagation(); if (confirm('Delete this photo for everyone?')) onDelete(del); return; }
    const t = e.target.closest('.tile'); if (t) open(+t.dataset.i);
  });

  function open(i) {
    idx = i;
    if (!lb) {
      lb = document.createElement('div'); lb.className = 'lightbox';
      lb.innerHTML = `
        <button class="btn small ghost close" style="color:#fff;border-color:rgba(255,255,255,.3)">Close</button>
        <div class="lb-img"><img></div>
        <button class="nav prev">‹</button><button class="nav next">›</button>
        <div class="lb-bar"><span class="who"></span><span class="spacer"></span>
          ${viewer ? '<button class="heart">♥ <span></span></button>' : ''}
          <a class="dl">Download</a></div>`;
      document.body.appendChild(lb);
      lb.querySelector('.close').onclick = close;
      lb.querySelector('.prev').onclick = () => step(-1);
      lb.querySelector('.next').onclick = () => step(1);
      const heart = lb.querySelector('.heart');
      if (heart) heart.onclick = like;
      let x0 = null;
      const area = lb.querySelector('.lb-img');
      area.addEventListener('touchstart', e => { x0 = e.touches[0].clientX; }, { passive: true });
      area.addEventListener('touchend', e => {
        if (x0 == null) return; const dx = e.changedTouches[0].clientX - x0; x0 = null;
        if (Math.abs(dx) > 50) step(dx < 0 ? 1 : -1);
      });
      area.addEventListener('dblclick', like);
      document.addEventListener('keydown', e => {
        if (!lb || lb.classList.contains('hidden')) return;
        if (e.key === 'Escape') close(); if (e.key === 'ArrowLeft') step(-1); if (e.key === 'ArrowRight') step(1);
      });
    }
    lb.classList.remove('hidden'); show();
  }
  function show() {
    const p = photos[idx];
    lb.querySelector('img').src = src(p);
    lb.querySelector('.who').textContent = `${p.guestName} · ${new Date(p.takenAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })} · ${idx + 1}/${photos.length}`;
    const dl = lb.querySelector('.dl'); dl.href = src(p) + (q ? '&' : '?') + 'download=1';
    const h = lb.querySelector('.heart');
    if (h) { h.classList.toggle('on', p.liked); h.querySelector('span').textContent = p.likes || ''; }
  }
  function step(d) { idx = (idx + d + photos.length) % photos.length; show(); }
  function close() { lb.classList.add('hidden'); }
  async function like() {
    if (!viewer) return;
    const p = photos[idx];
    try {
      const r = await api(`/api/events/${code}/photos/${p.id}/like`, { method: 'POST', body: { guestId: viewer } });
      p.likes = r.likes; p.liked = r.liked; show(); render(photos);
    } catch (e) { toast(e.message); }
  }
  return { render };
}
