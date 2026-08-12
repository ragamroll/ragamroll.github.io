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
import { rollGeometry, gridHandles, abChipBox } from './roll-geometry.js';
import { EDO } from './shruti.js';

// Height of the draggable A/B tabs in the left margin. Shared with the gesture layer,
// which hit-tests a press against it.
export const AB_TAB_H = 14;

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

  // Painting a rest targets the LEFT GUTTER — outside the grid, where the tala marks
  // are. Nothing is labelled: a rest is drawn across the whole width of the roll, so
  // there is no reading of it that a marker would disambiguate. The band that used to
  // sit INSIDE the plot took the leftmost pitch rows with it, and a note on the first
  // row could not be painted at all.
  if (v.paintMode) {
    ctx.fillStyle = 'rgba(216,161,63,.14)';
    ctx.fillRect(0, p.y, v.pad.l, p.h);
  }

  hooks.underGrid && hooks.underGrid(g);

  // The pitch grid, in three weights. All 53 steps of the octave are drawn, because
  // the 53-EDO grid is what a pitch actually sits on and a gamaka wanders freely
  // across it — hiding the steps between the shrutis makes an ornament look like it
  // is floating over nothing.
  //
  // The three tiers differ in KIND, not only in degree — dotted against solid reads
  // instantly, where three shades of the same faint ink do not, and the palette's
  // faintest colour leaves no room below itself anyway:
  //   every step   dotted — the 53-EDO lattice a pitch can land anywhere on
  //   the 22       solid  — shrutis: the named places a pitch rests
  //   the raga's   solid, heavier — the notes this piece is made of
  // Weakest first, so the stronger lines land on top.
  const shrutiSet = new Set(m.shrutiMods || []);
  const ragaSet = new Set(m.gridPitches.map((gp) => gp.step));
  {
    const lo = Math.floor(sa), hi = Math.ceil(sb);
    for (let step = lo; step <= hi; step++) {
      if (ragaSet.has(step)) continue;                       // drawn below, at full weight
      const mod = ((step % EDO) + EDO) % EDO;
      const isShruti = shrutiSet.has(mod);
      const x = X(step);
      ctx.strokeStyle = C.muted;
      ctx.lineWidth = 1;
      ctx.setLineDash(isShruti ? [] : [1, 3]);
      ctx.globalAlpha = isShruti ? 0.34 : 0.30;
      ctx.beginPath(); ctx.moveTo(x, p.y); ctx.lineTo(x, p.y + p.h); ctx.stroke();
      ctx.setLineDash([]);
    }
    ctx.globalAlpha = 1;
  }

  // The raga's own pitch lines, each named by an upright chip: dark for a black key,
  // light for a white one, by the nearest semitone to this Sa.
  for (const gp of m.gridPitches) {
    if (gp.step < sa - 1 || gp.step > sb + 1) continue;
    const x = X(gp.step);
    ctx.strokeStyle = C.muted; ctx.lineWidth = 1.4; ctx.globalAlpha = 0.75;
    ctx.beginPath(); ctx.moveTo(x, p.y); ctx.lineTo(x, p.y + p.h); ctx.stroke();
    ctx.globalAlpha = 1;
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

  // A-B, at the head of the margin it is swept in — beside the swara names, which is
  // what it is: the name of that lane. Lit when a segment is set, because that is when
  // pressing it does something (it clears the range).
  if (mode === 'roll' && v.labels !== false && v.abChip !== false) {
    const box = abChipBox(g, v.pad.l, v.chipH);
    // Lit only for a REAL segment. The gamaka page says "no segment" as A=0 and B=the
    // whole piece rather than as a zero-length range, and a chip lit on every piece that
    // has never been swept says nothing.
    const on = v.markerB > v.markerA && !(v.markerA <= 0 && v.markerB >= TOTAL);
    ctx.fillStyle = on ? C.amber : C.panel2;
    roundRect(ctx, box.x, box.y, box.w, box.h, 4); ctx.fill();
    ctx.strokeStyle = on ? 'rgba(0,0,0,.25)' : C.hair; ctx.lineWidth = .5; ctx.stroke();
    ctx.fillStyle = on ? C.panel2 : C.muted;
    ctx.font = 'bold 10px ' + mono; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('A–B', box.x + box.w / 2, box.y + box.h / 2 + .5);
    ctx.textBaseline = 'alphabetic'; ctx.font = '11px ' + mono;
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
          // In the GUTTER, right up against the grid rather than on top of it. Inside
          // the plot these sat over the first pitch rows and made both hard to read.
          ctx.fillStyle = C.amber; ctx.globalAlpha = .85; ctx.textAlign = 'right'; ctx.font = 'bold 10px ' + mono;
          ctx.fillText(glyphOf(s, e), v.pad.l - 4, y - 3); ctx.globalAlpha = 1; ctx.font = '11px ' + mono; } });
    }
    for (let t = Math.max(0, Math.floor(vLo / T.measure) * T.measure); t <= Math.min(TOTAL, vHi); t += T.measure) {
      gline(t, C.terra, 1.8, .5);
      if (t < TOTAL - 1e-6) { const y = Y(t);
        ctx.fillStyle = C.terra; ctx.globalAlpha = .8; ctx.textAlign = 'right'; ctx.font = 'bold 10px ' + mono;
        ctx.fillText(String(Math.round(t / T.measure) + 1), v.pad.l - 4, y + 11); ctx.globalAlpha = 1; ctx.font = '11px ' + mono; }
    }
  }

  // Rests: silence has duration but no pitch, so it is drawn as a band across the
  // WHOLE width rather than a box on some line. Nothing about it points at a swara,
  // which is exactly what it means. Drawn under the notes so a note that overlaps a
  // rest still reads as the note.
  if (mode === 'roll') for (const r of (m.rests || [])) {
    // Culled in TIME, like the notes below. Comparing the pixel y against the
    // visible-time window mixed two different units, so whether a rest survived
    // depended on where the scroll happened to put it — it came and went.
    if (r.t0 + r.dur < vLo || r.t0 > vHi) continue;
    const y0 = Y(r.t0), y1 = Y(r.t0 + r.dur);
    const selNow = v.selRest === r.tok;
    const h = Math.max(2, y1 - y0);
    ctx.fillStyle = selNow ? 'rgba(216,161,63,.20)' : 'rgba(154,146,128,.16)';
    ctx.fillRect(p.x, y0, p.w, h);
    // Hatched, not just tinted. A flat wash of this weight reads as one more grid
    // band among the tala's own; diagonals read as "nothing here", which is what a
    // rest is, and cannot be confused with a note however faint the tint.
    ctx.save();
    ctx.beginPath(); ctx.rect(p.x, y0, p.w, h); ctx.clip();
    ctx.strokeStyle = selNow ? C.amber : C.muted;
    ctx.globalAlpha = selNow ? .35 : .22; ctx.lineWidth = 1;
    ctx.beginPath();
    for (let d = -h; d < p.w; d += 9) { ctx.moveTo(p.x + d, y1); ctx.lineTo(p.x + d + h, y0); }
    ctx.stroke(); ctx.restore(); ctx.globalAlpha = 1;
    ctx.strokeStyle = selNow ? C.amber : C.muted;
    ctx.globalAlpha = selNow ? .9 : .35; ctx.lineWidth = selNow ? 1.6 : 1;
    ctx.setLineDash([5, 4]);
    ctx.beginPath(); ctx.moveTo(p.x, y0); ctx.lineTo(p.x + p.w, y0);
    ctx.moveTo(p.x, y1); ctx.lineTo(p.x + p.w, y1); ctx.stroke();
    ctx.setLineDash([]); ctx.globalAlpha = 1;
    if (h > 11) {
      // The marker sits in the left gutter lane, where the rest-paint band is, so a
      // rest always reads from the same edge whether you are painting or reading.
      ctx.fillStyle = selNow ? C.amber : C.muted; ctx.globalAlpha = 1;
      ctx.textAlign = 'center'; ctx.font = 'bold 11px ' + mono;
      ctx.fillText('z', p.x + 11, (y0 + y1) / 2 + 4);
      ctx.font = '11px ' + mono; ctx.textAlign = 'left';
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
    // Resize caps at BOTH ends of the note being edited: the far edge sets how long
    // it lasts, the near edge moves the boundary it shares with whatever came before.
    // Drawn only for the note in hand, so a roll being read is not covered in handles.
    if (v.grabIdx === i || v.sel === i) {
      const zone = Math.min(10, Math.max(3, (y1 - y0) / 3));   // matches roll-edit's grab zone
      ctx.fillStyle = '#9fc'; ctx.globalAlpha = v.grabIdx === i ? 0.9 : 0.55;
      ctx.fillRect(x - 10, y0 - zone / 2, 20, zone);
      ctx.fillRect(x - 10, y1 - zone / 2, 20, zone);
      ctx.globalAlpha = 1;
    }
  }

  // A paint in progress. Also shared: it is the same box in both apps, and drawing it
  // from view state means the gesture layer can stay the only thing that knows how a
  // press becomes a length.
  if (v.paint) {
    const y0 = Y(v.paint.ts), y1 = Y(v.paint.ts + v.paint.dur);
    const xc = v.paint.rest ? v.pad.l / 2 : X(v.paint.step);
    ctx.fillStyle = v.paint.rest ? '#999' : '#9fc';
    ctx.globalAlpha = v.paint.rest ? 0.4 : 0.35;
    roundRect(ctx, xc - 8, y0, 16, Math.max(4, y1 - y0), 4); ctx.fill();
    ctx.globalAlpha = 1;
  }

  // In-roll gamaka mode: every curve's anchors, so they can be aimed at without opening
  // anything. Drawn from view state like everything else the gesture layers need shown.
  if (mode === 'roll' && v.gamakaMode) {
    for (let i = 0; i < notes.length; i++) {
      const c = notes[i].curve; if (!c) continue;
      const t0 = starts[i], t1 = t0 + notes[i].dur;
      for (const [u, st] of c) {
        const cx = X(st), cy = Y(t0 + (t1 - t0) * u);
        ctx.fillStyle = C.teal; ctx.globalAlpha = .9;
        ctx.beginPath(); ctx.arc(cx, cy, 4, 0, 6.283); ctx.fill(); ctx.globalAlpha = 1;
        ctx.strokeStyle = 'rgba(0,0,0,.35)'; ctx.lineWidth = .7; ctx.stroke();
      }
    }
  }

  // The curve editor's own furniture: the anchors you grab, and a prompt when there is
  // nothing to grab yet. Shared, because a curve editor without visible anchor points is
  // not one — you cannot aim at what is not drawn. Suppressed mid-stroke (v.drawing),
  // when the freehand trace has hundreds of points and none of them is a handle.
  if (mode === 'draw' && notes[v.sel]) {
    const c = notes[v.sel].curve;
    if (!c) {
      ctx.fillStyle = C.muted; ctx.textAlign = 'center'; ctx.font = '13px ' + (C.sans || 'system-ui, sans-serif');
      ctx.fillText('drag top→bottom to draw the pitch', p.x + p.w / 2, p.y + p.h / 2);
      ctx.font = '11px ' + mono;
    } else if (!v.drawing) {
      const [t0, t1] = g.yRange;
      for (let k = 0; k < c.length; k++) {
        const cx = X(c[k][1]), cy = Y(t0 + (t1 - t0) * c[k][0]);
        ctx.beginPath(); ctx.arc(cx, cy, 6.5, 0, 7); ctx.fillStyle = C.bg || C.panel2; ctx.fill();
        ctx.lineWidth = 2; ctx.strokeStyle = C.teal; ctx.stroke();
        ctx.beginPath(); ctx.arc(cx, cy, 2.4, 0, 7); ctx.fillStyle = C.teal; ctx.fill();
      }
    }
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
    // Grabbable TABS in the margin, so one end of a range can be nudged. Without them
    // every press in the margin throws both markers away and starts the sweep over —
    // which is the lesson pitchy's gutter already learned. Drawn only where the host
    // hosts the gesture; draw still has its own DOM handles.
    if (v.abTabs) {
      const tab = (mm, label) => {
        const y = Y(mm); if (y < p.y - AB_TAB_H || y > v.h) return;
        ctx.fillStyle = C.amber; ctx.globalAlpha = .9;
        roundRect(ctx, 2, y - AB_TAB_H / 2, v.pad.l - 6, AB_TAB_H, 3); ctx.fill();
        ctx.globalAlpha = 1; ctx.fillStyle = C.panel2; ctx.textAlign = 'center';
        ctx.font = 'bold 10px ' + mono;
        ctx.fillText(label, (v.pad.l - 4) / 2, y + 3.5);
        ctx.font = '11px ' + mono;
      };
      if (hi > lo) { tab(lo, 'A'); tab(hi, 'B'); }
    }
  }
  if (mode === 'roll' && v.playPos != null) {
    const y = Y(v.playPos);
    ctx.strokeStyle = C.teal; ctx.globalAlpha = .95; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(p.x, y); ctx.lineTo(p.x + p.w, y); ctx.stroke(); ctx.globalAlpha = 1;
    ctx.fillStyle = C.teal; ctx.beginPath(); ctx.moveTo(p.x, y - 4); ctx.lineTo(p.x + 7, y); ctx.lineTo(p.x, y + 4); ctx.closePath(); ctx.fill();
  }

  // The three grid stretch-handles, drawn last so nothing sits on top of them. They are
  // the roll's now rather than the gamaka page's: both hosts widen the same grid, and a
  // tab drawn by one page and hit-tested by another is exactly the drift this module
  // exists to prevent. The boxes come from roll-geometry, the same ones the gesture
  // grabs by — there is no second copy of the arithmetic to keep in step.
  if (mode === 'roll' && v.handles) {
    const H = gridHandles(g, { w: v.w, h: v.h }, { stepMin: m.stepMin, stepMax: m.stepMax });
    // A row of dots ACROSS the axis you cannot drag: the way a tab hints which way it slides.
    const dots = (cx, cy, axis) => {
      ctx.fillStyle = '#08110d';
      for (let i = -1; i <= 1; i++) {
        if (axis === 'h') ctx.fillRect(cx - 1, cy + i * 4 - 1, 2, 2);
        else ctx.fillRect(cx + i * 4 - 1, cy - 1, 2, 2);
      }
    };
    const tab = (t) => {
      ctx.fillStyle = C.teal; ctx.globalAlpha = .85;
      roundRect(ctx, t.x - t.w / 2, t.y - t.h / 2, t.w, t.h, 4); ctx.fill(); ctx.globalAlpha = 1;
      ctx.strokeStyle = 'rgba(0,0,0,.3)'; ctx.lineWidth = .6; ctx.stroke();
      dots(t.x, t.y, t.axis);
    };
    tab(H.pmin); tab(H.pmax); tab(H.bottom);
    // "+ time" says what the bottom tab DOES, because unlike the pitch edges it is not
    // sitting on the boundary it moves — it is pinned to the viewport.
    ctx.fillStyle = '#031'; ctx.font = 'bold 12px ' + mono;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('+ time', H.bottom.x, H.bottom.y);
    ctx.textBaseline = 'alphabetic'; ctx.font = '11px ' + mono;
  }

  hooks.top && hooks.top(g);
  return g;
}
