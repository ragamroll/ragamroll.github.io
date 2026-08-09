// Drawing a RagaM-Roll: the piano roll adapted to 22-shruti raga music.
//
// Pure in the sense that matters — it takes a 2D context, a model and a view, and
// reaches for nothing else. No module state, no getElementById, no CSS lookups: the
// caller resolves its own palette and passes it, so two rolls can live on one page
// with different sizes, scroll offsets and themes.
//
// What it draws is what a READER needs: the shruti grid with its octave bands and
// piano-key naming, the tala grid, the notes, their gamaka curves, the A–B segment
// and the playhead. What it does not draw is anything about editing — no paint
// preview, no drag handles, no anchor dots. An editor paints those itself, through
// the three hooks below, which exist because that chrome is interleaved with these
// layers rather than sitting on top of them:
//
//   hooks.underGrid(g)  after the gutter, before the pitch lines
//   hooks.overNotes(g)  after the notes, before the A–B markers
//   hooks.top(g)        last
//
// Each is handed the geometry, so an editor never recomputes coordinates the roll
// has already worked out — the two cannot disagree about where a note is.
import { rollGeometry } from './roll-geometry.js';
import { EDO } from './shruti.js';

const roundRect = (ctx, x, y, w, h, r) => {
  r = Math.min(r, w / 2, h / 2);
  ctx.beginPath(); ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
};

// A note's gamaka, sampled through the shared interpolator so the roll draws the
// pitch the players sound.
function drawCurve(ctx, g, curve, t0, t1, colour, width, sample) {
  if (!curve || !curve.length) return;
  ctx.strokeStyle = colour; ctx.lineWidth = width; ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  ctx.beginPath();
  const N = Math.max(24, curve.length * 10);
  for (let k = 0; k <= N; k++) {
    const u = k / N, x = g.X(sample(curve, u)), y = g.Y(t0 + (t1 - t0) * u);
    k ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
  }
  ctx.stroke();
}

export function renderRoll(ctx, m, v, hooks = {}) {
  const g = rollGeometry({ pad: v.pad, w: v.w, h: v.h, mode: v.mode || 'roll',
    stepMin: m.stepMin, stepMax: m.stepMax, total: m.total,
    pxPerUnit: v.pxPerUnit, scrollTop: v.scrollTop,
    selStep: v.selStep, drawSpan: v.drawSpan, tStart: v.tStart, tEnd: v.tEnd });
  const p = g.plot, C = v.palette, mode = v.mode || 'roll';
  const { X, Y } = g;
  const mono = C.mono, notes = m.notes, starts = m.starts, TOTAL = m.total;
  const [sa, sb] = g.xRange;

  ctx.clearRect(0, 0, v.w, v.h);
  ctx.font = '11px ' + mono;

  // Octave bands and Sa lines: alternate shade per octave, with the MIDDLE Sa drawn
  // distinctly, so a reader can tell which octave they are looking at.
  { const oLo = Math.floor(sa / EDO), oHi = Math.ceil(sb / EDO);
    for (let k = oLo; k < oHi; k++) {
      if ((((k % 2) + 2) % 2) !== 0) continue;
      const x0 = Math.max(p.x, X(k * EDO)), x1 = Math.min(p.x + p.w, X((k + 1) * EDO));
      if (x1 > x0) { ctx.fillStyle = 'rgba(216,161,63,.05)'; ctx.fillRect(x0, p.y, x1 - x0, p.h); }
    }
    for (let k = oLo; k <= oHi; k++) {
      const s = k * EDO; if (s < sa - 1 || s > sb + 1) continue;
      const x = X(s);
      ctx.strokeStyle = (k === 0) ? C.terra : C.amberS; ctx.lineWidth = (k === 0) ? 2 : 1;
      ctx.globalAlpha = (k === 0) ? .5 : .28;
      ctx.beginPath(); ctx.moveTo(x, p.y); ctx.lineTo(x, p.y + p.h); ctx.stroke(); ctx.globalAlpha = 1;
    } }

  // Left gutter — an editor hangs its segment handles here.
  ctx.fillStyle = C.panel2; ctx.globalAlpha = .55; ctx.fillRect(0, 0, v.pad.l, v.h); ctx.globalAlpha = 1;
  ctx.strokeStyle = C.hair; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(v.pad.l, 0); ctx.lineTo(v.pad.l, v.h); ctx.stroke();

  hooks.underGrid && hooks.underGrid(g);

  // The raga's own pitch lines, each named by an upright chip: dark for a black key,
  // light for a white one, by the nearest semitone to this Sa.
  for (const gp of m.gridPitches) {
    if (gp.step < sa - 1 || gp.step > sb + 1) continue;
    const x = X(gp.step);
    ctx.strokeStyle = C.hair; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(x, p.y); ctx.lineTo(x, p.y + p.h); ctx.stroke();
    if (v.labels === false) continue;
    const black = m.isBlack(gp.step);
    ctx.font = 'bold 10px ' + mono;
    const cw = ctx.measureText(gp.label).width + 8, ch = v.chipH;
    ctx.save(); ctx.translate(x, p.y - 6 - cw / 2); ctx.rotate(-Math.PI / 2);
    ctx.fillStyle = black ? '#20242b' : '#efe6d0'; roundRect(ctx, -cw / 2, -ch / 2, cw, ch, 4); ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,.25)'; ctx.lineWidth = .5; ctx.stroke();
    ctx.fillStyle = black ? '#efe6d0' : '#20242b'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(gp.label, 0, .5);
    ctx.restore(); ctx.textBaseline = 'alphabetic';
    ctx.font = '11px ' + mono;
  }

  const [vLo, vHi] = g.visibleTime;

  // The tala grid: akshara pulse, anga starts with their I/O/U glyph, and avartana
  // boundaries numbered. A piece with no cycle (Tala=none, or an alapana) draws none
  // of it rather than a meaningless one.
  const T = m.tala;
  if (mode === 'roll' && T && T.measure > 0) {
    const angOff = T.accents.map((a) => a - 1);
    const angs = angOff.map((o, i) => [o, i + 1 < angOff.length ? angOff[i + 1] : T.measure]);
    const glyphOf = (s, e) => { const k = T.beat > 0 ? Math.round((e - s) / T.beat) : 0; return k === 2 ? 'O' : (k === 1 ? 'U' : 'I'); };
    const gline = (t, col, w, al) => {
      if (t < vLo || t > vHi || t < -1e-6 || t > TOTAL + 1e-6) return;
      const y = Y(t);
      ctx.strokeStyle = col; ctx.lineWidth = w; ctx.globalAlpha = al;
      ctx.beginPath(); ctx.moveTo(p.x, y); ctx.lineTo(p.x + p.w, y); ctx.stroke(); ctx.globalAlpha = 1;
    };
    const c0 = Math.floor(Math.max(0, vLo) / T.measure) * T.measure;
    for (let c = c0; c < vHi && c < TOTAL; c += T.measure) {
      angs.forEach(([s, e], i) => { if (i % 2 !== 0) return;
        const y0 = Math.max(p.y, Y(c + s)), y1 = Math.min(p.y + p.h, Y(Math.min(c + e, TOTAL)));
        if (y1 > y0) { ctx.fillStyle = 'rgba(70,195,154,.05)'; ctx.fillRect(p.x, y0, p.w, y1 - y0); } });
    }
    if (T.beat > 0) for (let t = Math.max(0, Math.floor(vLo / T.beat) * T.beat); t <= Math.min(TOTAL, vHi); t += T.beat) gline(t, C.muted, 0.6, .13);
    for (let c = c0; c < vHi && c < TOTAL; c += T.measure) {
      angs.forEach(([s, e]) => { const t = c + s; if (t > TOTAL) return; gline(t, C.amber, 1, .3);
        if (t >= vLo && t <= vHi) { const y = Y(t);
          ctx.fillStyle = C.amber; ctx.globalAlpha = .8; ctx.textAlign = 'left'; ctx.font = 'bold 10px ' + mono;
          ctx.fillText(glyphOf(s, e), v.pad.l + 3, y - 4); ctx.globalAlpha = 1; ctx.font = '11px ' + mono; } });
    }
    for (let t = Math.max(0, Math.floor(vLo / T.measure) * T.measure); t <= Math.min(TOTAL, vHi); t += T.measure) {
      gline(t, C.terra, 1.8, .5);
      if (t < TOTAL - 1e-6) { const y = Y(t);
        ctx.fillStyle = C.terra; ctx.globalAlpha = .75; ctx.textAlign = 'left'; ctx.font = 'bold 10px ' + mono;
        ctx.fillText(String(Math.round(t / T.measure) + 1), v.pad.l + 3, y + 12); ctx.globalAlpha = 1; ctx.font = '11px ' + mono; }
    }
  }

  // Where each note begins — faint, so the tala grid stays the metric guide.
  for (let i = 0; i <= notes.length; i++) {
    const t = (i < notes.length) ? starts[i] : TOTAL;
    if (t < vLo || t > vHi) continue;
    const y = Y(t);
    ctx.strokeStyle = C.terra; ctx.globalAlpha = (T && T.measure > 0) ? .12 : .22; ctx.lineWidth = .7;
    ctx.beginPath(); ctx.moveTo(p.x, y); ctx.lineTo(p.x + p.w, y); ctx.stroke(); ctx.globalAlpha = 1;
  }

  // The notes, coloured by the key they sit on, with their gamaka drawn through them.
  const colW = mode === 'draw' ? 0 : Math.max(9, p.w / (m.stepMax - m.stepMin) * 4);
  for (let i = 0; i < notes.length; i++) {
    if (mode === 'draw' && i !== v.sel) continue;
    if (mode === 'roll') { const s0 = starts[i], s1 = s0 + notes[i].dur; if (s1 < vLo || s0 > vHi) continue; }
    const nn = notes[i], y0 = Y(starts[i]), y1 = Y(starts[i] + nn.dur), x = X(nn.step), selNow = i === v.sel;
    const w = mode === 'draw' ? Math.max(30, p.w * 0.14) : colW;
    const black = mode === 'roll' && m.isBlack(nn.step);
    ctx.fillStyle = mode === 'draw'
      ? (selNow ? 'rgba(216,161,63,.16)' : 'rgba(216,161,63,.07)')
      : (black ? 'rgba(32,36,43,.82)' : 'rgba(239,230,208,.85)');
    ctx.strokeStyle = selNow ? C.amber : C.amberS; ctx.lineWidth = selNow ? 2 : 1.3;
    ctx.setLineDash(mode === 'draw' ? [5, 4] : []);
    roundRect(ctx, x - w / 2, y0 + 1, w, Math.max(3, y1 - y0 - 2), 5); ctx.fill(); ctx.stroke(); ctx.setLineDash([]);
    if (nn.curve) drawCurve(ctx, g, nn.curve, starts[i], starts[i] + nn.dur, C.teal, mode === 'draw' ? 3 : 2, v.sample);
    if (mode !== 'draw') { ctx.fillStyle = black ? '#efe6d0' : '#20242b'; ctx.textAlign = 'center'; ctx.fillText(nn.swara, x, y0 + 13); }
    if (v.grabIdx === i) { ctx.fillStyle = '#9fc'; ctx.globalAlpha = 0.9; ctx.fillRect(x - 10, y1 - 4, 20, 8); ctx.globalAlpha = 1; }
  }

  hooks.overNotes && hooks.overNotes(g);

  // The A–B segment, and the playhead the host drives.
  if (mode === 'roll') {
    const lo = Math.min(v.markerA, v.markerB), hi = Math.max(v.markerA, v.markerB);
    if (lo > 0.01 || hi < TOTAL - 0.01) { const y0 = Y(lo), y1 = Y(hi); ctx.fillStyle = 'rgba(216,161,63,.07)'; ctx.fillRect(p.x, y0, p.w, y1 - y0); }
    const mk = (mm) => { const y = Y(mm); if (y < p.y - 2 || y > v.h) return;
      ctx.strokeStyle = C.amber; ctx.globalAlpha = .8; ctx.setLineDash([6, 4]); ctx.lineWidth = 1.4;
      ctx.beginPath(); ctx.moveTo(v.pad.l, y); ctx.lineTo(p.x + p.w, y); ctx.stroke(); ctx.setLineDash([]); ctx.globalAlpha = 1; };
    mk(v.markerA); mk(v.markerB);
  }
  if (mode === 'roll' && v.playPos != null) {
    const y = Y(v.playPos);
    ctx.strokeStyle = C.teal; ctx.globalAlpha = .95; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(p.x, y); ctx.lineTo(p.x + p.w, y); ctx.stroke(); ctx.globalAlpha = 1;
    ctx.fillStyle = C.teal; ctx.beginPath(); ctx.moveTo(p.x, y - 4); ctx.lineTo(p.x + 7, y); ctx.lineTo(p.x, y + 4); ctx.closePath(); ctx.fill();
  }

  hooks.top && hooks.top(g);
  return g;
}
