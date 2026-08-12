// The raga as a switchboard: one octave of keys with the raga's own swaras written
// into them, the ascent's wires arcing over the top and the descent's under the bottom.
//
// A vakra raga's backwards step is then just a wire that runs the other way — bhairavi
// ascends S G R G M P D N, and no by-position row could ever show that its G comes twice.
//
// Pure: a string in, an SVG string out, no DOM and no document. It was written inside
// tools/build-notation-index.mjs, which is why the app's raga browser had no diagram —
// the one thing on that page a reader looks at first could not be reached from a
// component. Here, the generator and the app draw the SAME switchboard.
//
// The caller supplies the stylesheet: the classes below (.kbd, .k, .bk, .kl, .wire, .ah)
// carry no colours of their own, so a page can draw it in its own palette.
import { boxForLetters } from './raga-shruti.js';
import { BOXES } from './shruti.js';

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// The 22 shrutis fall under 12 semitones: each comma pair (a/b) lives inside one
// semitone, and S and P have no comma to choose. So the strip is laid out on the
// SEMITONES — SS rr RR gg GG mm MM PP dd DD nn NN — each two boxes wide, with the
// raga lighting the box for the comma it actually uses. Equal-width shrutis hid
// that: 22 cells in a row say nothing about which Ri a raga takes, only that it
// takes one.
//
// Grouped straight off BOXES (ordered by step, `pair` naming the comma pair) rather
// than by a table written out here, so a change to the shruti model cannot leave
// this strip describing the old one.
const GROUPS = (() => {
  const out = [];
  for (let i = 0; i < BOXES.length; i++) {
    const b = BOXES[i];
    if (b.fixed) { out.push({ boxes: [i] }); continue; }
    out.push({ boxes: [i, i + 1] });     // a and b of the same pair
    i++;
  }
  // The letters the user reads them by, and the piano's black keys. Black is the
  // SEMITONE (1,3,6,8,10), not the letter's case: m is shuddha madhyama and white,
  // M is prati madhyama and black.
  const L = ['S', 'r', 'R', 'g', 'G', 'm', 'M', 'P', 'd', 'D', 'n', 'N'];
  const BLACK = new Set([1, 3, 6, 8, 10]);
  return out.map((g, k) => ({ ...g, label: L[k] ?? '?', black: BLACK.has(k) }));
})();
// ---- the raga as a switchboard -----------------------------------------------
// One octave of keys, S to S, with the raga's swaras written into the keys they
// occupy; the ascent's wires arc over the top and the descent's under the bottom,
// each plugging into the key it arrives at. A vakra raga's backwards step is then
// just a wire that runs the other way -- bhairavi ascends S G R G M P D N, and no
// by-position row could ever show that its G comes twice.
//
// SVG rather than boxes with an overlay: the wires have to meet the keys exactly,
// and one coordinate system is the only way that stays true at every width.
const BW = 12, GAP = 3, KH = 20, LANE = 8, BASE = 10, HEAD = 5, POST = 12, DOT = 2.2;   // user units
const KEYS = [...GROUPS, { boxes: [0], label: 'S', black: false, octave: true }];  // closing upper S
const KEY_W = 2 * BW;
const KEY_X = KEYS.map((_, i) => i * (KEY_W + GAP));
const SVG_W = KEYS.length * KEY_W + (KEYS.length - 1) * GAP;
const boxToKey = new Map();          // box index -> [key, which half] (-1 = undivided)
GROUPS.forEach((g, k) => g.boxes.forEach((bi, half) => boxToKey.set(bi, [k, g.boxes.length === 1 ? -1 : half])));

// A note's x centre: the key it sits in, and within a split key the half its comma
// takes. An octave up, only the closing S exists -- which is what an ascent arrives
// at, and where a descent begins.
const noteX = (box, oct) => {
  if (oct > 0) return KEY_X[KEYS.length - 1] + KEY_W / 2;
  const [k, half] = boxToKey.get(box) ?? [0, -1];
  return KEY_X[k] + (half < 0 ? KEY_W / 2 : half * BW + BW / 2);
};

// The written notation as a walk. An octave mark is the transition INTO a note, so
// it is applied before the note is recorded, and the walk is then shifted so its
// lowest octave is 0 -- an avarohana written from the upper S therefore starts at
// the right-hand key and comes down, which is exactly how it is sung.
function walk(text) {
  const out = [];
  let oct = 0;
  for (const t of String(text).trim().split(/\s+/).filter(Boolean)) {
    const m = t.match(/^([<>]*)([A-Za-z])/);
    if (!m) continue;
    for (const ch of m[1]) oct += ch === '>' ? 1 : -1;
    out.push({ letter: m[2].toUpperCase(), oct });
  }
  const lo = out.length ? Math.min(...out.map((o) => o.oct)) : 0;
  return out.map((o) => ({ ...o, oct: o.oct - lo }));
}

// Lane per wire: the lowest one whose spans it does not overlap. Purely to stop two
// arcs sitting on top of each other -- which wire is outer no longer has to mean
// anything, because a key visited twice is on a post and the ANCHORS carry the
// order. Height used to encode nesting as well, and buying that cost every card
// vertical space for something the posts now say outright.
//
// Touching at an endpoint is not overlapping, so M->D sits beside S->M at the same
// height rather than above it.
// Lane per wire within one depth band. Ordered by CONTAINMENT: a wire whose span
// encloses another's arcs further out, so the inner one fits beneath it instead of
// cutting across. Greedy-by-arrival gave the enclosing wire whichever lane happened
// to be free — reethigowlai's S->G then ran under the G->R nested inside it, and
// bageshri's D->M under the M->P it encloses.
//
// Containment orders only wires that nest; where spans merely cross, no ordering
// helps and none is invented. What is kept is that two wires which do not overlap at
// all share a lane, so a band stays flat instead of climbing a step per wire, and
// touching at an endpoint is not overlapping.
function lanes(spans) {
  const n = spans.length;
  const sp = spans.map(([a, b]) => [Math.min(a, b), Math.max(a, b)]);
  const len = (i) => sp[i][1] - sp[i][0];
  const holds = (i, j) => sp[i][0] <= sp[j][0] && sp[j][1] <= sp[i][1] && len(i) > len(j);
  const depth = new Array(n).fill(-1);
  const calc = (i) => {
    if (depth[i] >= 0) return depth[i];
    depth[i] = 0;                                  // set before recursing; holds() is a
    let d = 0;                                     // strict order, so this cannot cycle
    for (let j = 0; j < n; j++) if (j !== i && holds(i, j)) d = Math.max(d, calc(j) + 1);
    return (depth[i] = d);
  };
  for (let i = 0; i < n; i++) calc(i);
  const taken = [], lane = new Array(n);
  // Same depth and conflicting: the LATER wire takes the lower lane, so of a
  // departure and its return the return nests inside the leg that left.
  for (const i of [...Array(n).keys()].sort((x, y) => depth[x] - depth[y] || y - x)) {
    let L = depth[i];
    while ((taken[L] || []).some(([x, y]) => sp[i][0] < y && x < sp[i][1])) L++;
    (taken[L] ||= []).push(sp[i]);
    lane[i] = L;
  }
  return lane;
}

// Each visit gets ONE anchor, first visit farthest from the box and the last on the
// box itself, and the wire arriving at a visit leaves from the same point. That
// continuity is the whole reading of the diagram: a path is followed by starting
// where the last arrow ended. Reethigowlai ascends S G R G — S(box) to G(anchor),
// G(anchor) to R(box), R(box) to G(box) — and the two arrows at G's anchor meet
// there in a V rather than crossing.
//
// An earlier version split a turning point's arrival from its departure, one ring
// apart, to stop those two arrows meeting. It stopped them meeting by breaking the
// chain: the eye arrived at one point and had to find the next arrow beginning at
// another, on the same visit to the same swara.
// Which visit to a revisited key sits on the anchor, and which on the box.
//
// The step that runs AGAINST the phrase's direction is the one lifted clear; the
// forward motion stays along the keys. In the ascent the phrase runs left to right,
// so a leftward wire is retrograde, and it attaches to the anchor at the revisited
// key. That reproduces both readings given by hand:
//
//   reethigowlai  S G R G   the retrograde wire is G->R, its G end being the
//                           revisit, so S(box) -> G(anchor) -> R(box) -> G(box)
//   ahiri         S R S G   the retrograde wire is R->S, its S end being the
//                           revisit, so S(box) -> R(box) -> S(anchor) -> G(box)
//
// Neither "first visit outermost" nor "last visit outermost" gives both: each gets
// one of them backwards.
//
// Three or more visits keep first-visit-outermost. Two of them then want the box
// under the rule above and only one can have it, and the earlier reading of
// reethigowlai's descent -- D M G outermost, G M P next in, P M G on the boxes --
// is first-visit-outermost. So that is what is kept where the rule cannot decide.
function endpoints(nodes) {
  const total = new Map();
  for (const n of nodes) total.set(n.x, (total.get(n.x) || 0) + 1);
  const forward = nodes.length > 1 ? Math.sign(nodes[nodes.length - 1].x - nodes[0].x) || 1 : 1;
  const retro = (i) => {                       // is this visit next to a backwards step?
    const back = (a, b) => a && b && Math.sign(b.x - a.x) === -forward;
    return back(nodes[i], nodes[i + 1]) || back(nodes[i - 1], nodes[i]);
  };
  const order = new Map();                     // x -> the visit indices, in the order they take depths
  for (const [x, n] of total) {
    const at = nodes.map((v, i) => (v.x === x ? i : -1)).filter((i) => i >= 0);
    order.set(x, n === 2 ? at.slice().sort((a, b) => (retro(a) ? 1 : 0) - (retro(b) ? 1 : 0)) : at.slice().reverse());
  }
  return nodes.map((n, i) => {
    const a = order.get(n.x).indexOf(i);       // 0 -> the box, then one ring out per visit
    return { x: n.x, in: a, out: a };
  });
}

// Stalks go BEHIND the wires and the anchors go on top: an anchor is the point a
// wire plugs into, and drawn underneath it vanishes exactly where wires converge —
// which is every key that has a post, since a post means the key was visited twice.
function posts(anch, up, y0, step) {
  const deepest = new Map();
  for (const p of anch) deepest.set(p.x, Math.max(deepest.get(p.x) || 0, p.a));
  let stalks = '', dots = '';
  for (const [x, a] of deepest) {
    if (a < 1) continue;
    const k = up ? -1 : 1, end = y0 + k * a * step;
    stalks += `<path class="post" d="M${x.toFixed(1)},${y0.toFixed(1)} L${x.toFixed(1)},${end.toFixed(1)}"/>`;
    for (let i = 1; i <= a; i++) dots += `<circle class="anchor" cx="${x.toFixed(1)}" cy="${(y0 + k * i * step).toFixed(1)}" r="${DOT}"/>`;
  }
  return { stalks, dots };
}

// The arrowhead goes at the MIDDLE of a wire, not its end. At the end, three of them
// crowd every junction — the arrival, the departure and the post all meet there — and
// the direction of travel becomes unreadable exactly where the reader needs it. In
// the middle each arrow sits alone on its own line.
const arrow = (x, y, deg) => `<path class="ah" d="M-3.4,-2.6 L3.2,0 L-3.4,2.6 z" transform="translate(${x.toFixed(1)},${y.toFixed(1)}) rotate(${deg.toFixed(1)})"/>`;
// A THIRD of the way along, not the middle. Where a phrase goes out and comes back
// over the same span -- ahiri's S R S -- two midpoint arrows land on top of each
// other; a third of the way from each start puts them at opposite ends of the span.
const onCubic = (P0, C1, C2, P3) => (t) => {
  const u = 1 - t;
  const at = (i) => u*u*u*P0[i] + 3*u*u*t*C1[i] + 3*u*t*t*C2[i] + t*t*t*P3[i];
  const d = (i) => 3*u*u*(C1[i]-P0[i]) + 6*u*t*(C2[i]-C1[i]) + 3*t*t*(P3[i]-C2[i]);
  return [at(0), at(1), Math.atan2(d(1), d(0)) * 180 / Math.PI];
};
const onLine = (P0, P1) => (t) => [P0[0] + (P1[0]-P0[0])*t, P0[1] + (P1[1]-P0[1])*t,
  Math.atan2(P1[1]-P0[1], P1[0]-P0[0]) * 180 / Math.PI];

// Where to mark each wire. A fixed fraction fails whichever value it takes: at one
// third two arrows on a there-and-back pair sit 11 units apart with a 7-unit head, and
// alternating merely moves the collision elsewhere — ranjani ended with two 0.4 apart.
// So each wire takes, from a handful of positions along it, the one furthest from the
// marks already placed. Greedy and deterministic, and it optimises the thing that
// actually matters instead of a proxy for it.
const placeArrows = (fns) => {
  // Every wire, sampled, so a mark can be kept off its NEIGHBOURS as well as off the
  // other marks. Avoiding only the other arrowheads let ahiri's R->S mark sit against
  // the S->R curve running beside it, and the two then read as two heads on one curve.
  const traces = fns.map((f) => Array.from({ length: 21 }, (_, i) => f(i / 20)));
  const put = [];
  return fns.map((f, k) => {
    let best = null, bestScore = -Infinity;
    for (const t of [0.3, 0.4, 0.5, 0.6, 0.7]) {
      const p = f(t);
      const toMarks = put.length ? Math.min(...put.map((q) => Math.hypot(p[0]-q[0], p[1]-q[1]))) : 99;
      let toWires = 99;
      traces.forEach((tr, j) => { if (j !== k) for (const q of tr) toWires = Math.min(toWires, Math.hypot(p[0]-q[0], p[1]-q[1])); });
      // Priority, not a weighted sum: never crowd another arrowhead, and subject to
      // that stay off the neighbouring wires. Weighting them let wire-clearance buy
      // its way past a head sitting 7 units away, which is the collision that matters.
      const ok = toMarks >= 9;
      const score = (ok ? 1e6 : 0) + (ok ? Math.min(toWires, 10) * 10 : toMarks);
      if (score > bestScore) { bestScore = score; best = p; }
    }
    put.push(best);
    return arrow(best[0], best[1], best[2]);
  }).join('');
};

function wires(nodes, up, y0) {
  const ep = endpoints(nodes);
  // A wire leaves on its source's OUT anchor and arrives on its target's IN anchor.
  const anch = ep.map((e) => ({ x: e.x, a: Math.max(e.in, e.out) }));   // for the posts
  const spans = [];
  for (let i = 1; i < ep.length; i++) spans.push([{ x: ep[i - 1].x, a: ep[i - 1].out }, { x: ep[i].x, a: ep[i].in }]);
  const maxA = anch.reduce((m, p) => Math.max(m, p.a), 0);
  const k = up ? -1 : 1;
  // Ring 1 sits OUTSIDE every box-level arc, measured rather than fixed: at a fixed
  // distance a long arc between two boxes reached past the ring and cut through the
  // wires running along it.
  const boxSpan = spans.map(([a, b]) => (a.a === 0 && b.a === 0
    ? Math.max(6 + Math.abs(b.x - a.x) * 0.10, 8) : 0));
  const step = Math.max(POST, Math.max(0, ...boxSpan) + 10);
  const yOf = (p) => y0 + k * p.a * step;
  // How deep a wire must travel to clear what lies between its ends: anything at a
  // key strictly between them, one ring deeper than the deepest anchor there. Wires
  // used to hold their own depth and grazed whatever anchor they passed —
  // reethigowlai's D->M ran through P's. Travelling deeper than the obstacle passes
  // over it instead.
  const deepest = new Map();
  for (const p of anch) deepest.set(p.x, Math.max(deepest.get(p.x) || 0, p.a));
  const travelOf = (p1, p2) => {
    // A wire between two BOXES needs to clear nothing: ring 1 is placed outside every
    // box-level arc, so such a wire passes under the anchors by construction. Sending
    // it deep anyway made it long, and long wires cross things.
    if (p1.a === 0 && p2.a === 0) return 0;
    const lo = Math.min(p1.x, p2.x), hi = Math.max(p1.x, p2.x);
    let need = 0;
    for (const [x, d] of deepest) if (x > lo + 0.5 && x < hi - 0.5) need = Math.max(need, d + 1);
    return Math.max(p1.a, p2.a, need);
  };
  const travel = spans.map(([a, b]) => travelOf(a, b));

  // Lanes WITHIN a travel depth. Sending wires deeper to clear anchors put more of
  // them in the same band, where they crossed each other instead — so each band is
  // packed separately, and a wire only has to miss the ones sharing its depth.
  const sub = new Array(spans.length).fill(0);
  for (const d of new Set(travel)) {
    const idx = spans.map((_, i) => i).filter((i) => travel[i] === d);
    const got = lanes(idx.map((i) => [spans[i][0].x, spans[i][1].x]));
    idx.forEach((i, j) => { sub[i] = got[j]; });
  }

  const marks = [];
  const paths = spans.map(([p1, p2], i) => {
    const y1 = yOf(p1), y2 = yOf(p2);
    // Same key, two visits: a wide loop out to the LEFT, because the wire comes back
    // to where it started and a loop that reads as returning has to be seen leaving.
    if (Math.abs(p2.x - p1.x) < 0.01) {
      const w = 18;
      marks.push(onCubic([p1.x, y1], [p1.x - w, y1], [p2.x - w, y2], [p2.x, y2]));
      return `<path d="M${p1.x.toFixed(1)},${y1.toFixed(1)} C${(p1.x - w).toFixed(1)},${y1.toFixed(1)} ${(p2.x - w).toFixed(1)},${y2.toFixed(1)} ${p2.x.toFixed(1)},${y2.toFixed(1)}"/>`;
    }
    const dx = Math.abs(p2.x - p1.x), dir = p2.x > p1.x ? 1 : -1;
    // One shape for every wire: hold a travel depth across the middle, meet each end
    // at its own. Everything asked of these wires falls out of it — an end already at
    // the travel depth is met HORIZONTALLY (its control shares its y), which keeps two
    // wires sharing an anchor from crossing there; an end shallower than the travel
    // depth is left heading AT it rather than sideways, which stops a long climb
    // swinging wide; and between two boxes the travel depth is the span-proportional
    // bulge, so a wire still rises into the key it lands on.
    // A wire between two DEPTHS is drawn straight. Curvature is what put a wire
    // where it did not belong every time: S->G arced up to G's anchor and sagged
    // across the G->R leaving it. A straight line cannot sag, and it is what the
    // hand-drawn version uses.
    const flat = travel[i] === p1.a && travel[i] === p2.a;
    const hMid = travel[i] > 0
      ? travel[i] * step + (flat ? 4 : 0) + sub[i] * 4
      : Math.max(6 + dx * 0.10, 8) + sub[i] * 5;
    const yMid = y0 + k * hMid;
    const e = dx * 0.3;
    const C1 = [p1.x + dir * e, yMid], C2 = [p2.x - dir * e, yMid];
    marks.push(onCubic([p1.x, y1], C1, C2, [p2.x, y2]));
    return `<path d="M${p1.x.toFixed(1)},${y1.toFixed(1)} C${C1[0].toFixed(1)},${C1[1].toFixed(1)} ${C2[0].toFixed(1)},${C2[1].toFixed(1)} ${p2.x.toFixed(1)},${y2.toFixed(1)}"/>`;
  }).join('');

  const p = posts(anch, up, y0, step);
  const deepestMid = Math.max(0, ...travel) * step + Math.max(0, ...sub) * 5;
  return { paths: p.stalks + paths + placeArrows(marks) + p.dots, height: Math.max(deepestMid, maxA * step) + BASE + HEAD };
}

// Octave marks come off what is SHOWN: every swara sits in the one octave the keys
// draw. walk() still reads them, which is how an ascent lands on the right-hand S.
export const noOctaveMarks = (text) => String(text).replace(/[<>]/g, '');

const lettersIn = (s) => new Set(String(s).toUpperCase().replace(/[^SRGMPDN]/g, '').split(''));

function switchboard(f, ragas, raga) {
  const boxes = boxForLetters(ragas, raga, new Set([...lettersIn(f.aroha), ...lettersIn(f.avaroha)]));
  const xsOf = (text) => walk(text).map((n) => ({ x: noteX(boxes.get(n.letter) ?? 0, n.oct) }));
  const upX = xsOf(f.aroha), downX = xsOf(f.avaroha);
  // Measure first: the bands decide where the keyboard sits.
  const upH = wires(upX, true, 0).height, downH = wires(downX, false, 0).height;
  const keyTop = upH, keyBottom = keyTop + KH, H = keyBottom + downH;
  const U = wires(upX, true, keyTop).paths, D = wires(downX, false, keyBottom).paths;

  const letterAt = new Map();                    // box -> the letter the raga calls it
  for (const [L, b] of boxes) letterAt.set(b, L);
  const label = (x, w, text, black) =>
    `<text class="kl${black ? ' onbk' : ''}" x="${(x + w / 2).toFixed(1)}" y="${(keyTop + KH / 2).toFixed(1)}">${esc(text)}</text>`;
  let keys = '';
  KEYS.forEach((g, k) => {
    const x = KEY_X[k];
    if (g.octave) {                              // the upper S closes the octave
      keys += `<rect class="k" x="${x}" y="${keyTop}" width="${KEY_W}" height="${KH}" rx="2"/>` + label(x, KEY_W, 'S', false);
      return;
    }
    const cls = g.black ? 'k bk' : 'k';
    if (g.boxes.length === 1) {                  // S and P: no comma to choose
      keys += `<rect class="${cls}" x="${x}" y="${keyTop}" width="${KEY_W}" height="${KH}" rx="2"/>`;
      if (letterAt.has(g.boxes[0])) keys += label(x, KEY_W, letterAt.get(g.boxes[0]), g.black);
      return;
    }
    g.boxes.forEach((bi, half) => {
      const bx = x + half * BW;
      keys += `<rect class="${cls}" x="${bx}" y="${keyTop}" width="${BW}" height="${KH}" rx="2"/>`;
      if (letterAt.has(bi)) keys += label(bx, BW, letterAt.get(bi), g.black);
    });
  });

  return `<svg class="kbd" viewBox="0 0 ${SVG_W} ${H.toFixed(0)}" role="img" aria-label="${esc(raga)} — ārohaṇa ${esc(f.aroha)}, avarohaṇa ${esc(f.avaroha)}"><g class="wire">${U}${D}</g>${keys}</svg>`;
}

export { switchboard as switchboardSvg };
