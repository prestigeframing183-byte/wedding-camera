'use strict';
/* Film "development": tone curves, colour cast, saturation, grain, vignette and date stamp. */
const FILMS = {
  classic: { label: 'Classic', css: 'contrast(1.08) saturate(1.1) sepia(.15)', gain: [1.04, 1.0, 0.94], contrast: 1.1, lift: 0.04, sat: 1.08, grain: 14, vignette: 0.45 },
  golden: { label: 'Golden', css: 'sepia(.35) saturate(1.4) contrast(1.05) brightness(1.05)', gain: [1.1, 1.02, 0.84], contrast: 1.06, lift: 0.05, sat: 1.25, grain: 12, vignette: 0.4 },
  mono: { label: 'B&W', css: 'grayscale(1) contrast(1.25)', gain: [1, 1, 1], contrast: 1.28, lift: 0.03, sat: 0, grain: 20, vignette: 0.55 },
  faded: { label: 'Faded', css: 'contrast(.85) saturate(.75) brightness(1.08)', gain: [0.98, 1.0, 1.04], contrast: 0.86, lift: 0.12, sat: 0.75, grain: 10, vignette: 0.3 },
  none: { label: 'Natural', css: 'none', gain: [1, 1, 1], contrast: 1, lift: 0, sat: 1, grain: 0, vignette: 0 },
};

function developCanvas(canvas, filmKey, { dateStamp = true } = {}) {
  const f = FILMS[filmKey] || FILMS.classic;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const w = canvas.width, h = canvas.height;
  if (filmKey !== 'none') {
    const img = ctx.getImageData(0, 0, w, h), d = img.data;
    const luts = [0, 1, 2].map(c => {
      const lut = new Uint8ClampedArray(256);
      for (let i = 0; i < 256; i++) {
        let v = i / 255;
        v = (v - 0.5) * f.contrast + 0.5;
        v = f.lift + v * (1 - f.lift);
        lut[i] = v * f.gain[c] * 255;
      }
      return lut;
    });
    const cx = w / 2, cy = h / 2, inv = 1 / (cx * cx + cy * cy);
    for (let y = 0, p = 0; y < h; y++) {
      const dy2 = (y - cy) * (y - cy);
      for (let x = 0; x < w; x++, p += 4) {
        let r = luts[0][d[p]], g = luts[1][d[p + 1]], b = luts[2][d[p + 2]];
        const l = 0.299 * r + 0.587 * g + 0.114 * b;
        r = l + (r - l) * f.sat; g = l + (g - l) * f.sat; b = l + (b - l) * f.sat;
        const vig = 1 - f.vignette * ((x - cx) * (x - cx) + dy2) * inv;
        const n = f.grain ? (Math.random() - 0.5) * f.grain : 0;
        d[p] = r * vig + n; d[p + 1] = g * vig + n; d[p + 2] = b * vig + n;
      }
    }
    ctx.putImageData(img, 0, 0);
  }
  if (dateStamp) {
    const t = new Date();
    const s = `'${String(t.getFullYear()).slice(2)}  ${t.getMonth() + 1}  ${t.getDate()}`;
    const size = Math.round(Math.min(w, h) * 0.045);
    ctx.font = `bold ${size}px "Courier New", ui-monospace, monospace`;
    ctx.textAlign = 'right'; ctx.textBaseline = 'bottom';
    ctx.shadowColor = 'rgba(255,120,30,.9)'; ctx.shadowBlur = size * 0.4;
    ctx.fillStyle = '#ff9a3c';
    ctx.fillText(s, w - size * 1.2, h - size * 0.9);
    ctx.shadowBlur = 0;
  }
  return canvas;
}

/** Draw a source (video or image) into a canvas, capped at maxSide, optionally mirrored. */
function frameToCanvas(src, sw, sh, { maxSide = 1600, mirror = false, targetAspect = null } = {}) {
  let sx = 0, sy = 0, cw = sw, ch = sh;
  if (targetAspect) { // crop source to the on-screen viewfinder aspect
    if (sw / sh > targetAspect) { cw = sh * targetAspect; sx = (sw - cw) / 2; }
    else { ch = sw / targetAspect; sy = (sh - ch) / 2; }
  }
  const scale = Math.min(1, maxSide / Math.max(cw, ch));
  const c = document.createElement('canvas');
  c.width = Math.round(cw * scale); c.height = Math.round(ch * scale);
  const ctx = c.getContext('2d', { willReadFrequently: true });
  if (mirror) { ctx.translate(c.width, 0); ctx.scale(-1, 1); }
  ctx.drawImage(src, sx, sy, cw, ch, 0, 0, c.width, c.height);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  return c;
}
