// Moving the seam between two adjacent events without changing what is heard.
//
// A phrase the ear takes as one gesture is often written as two notes, because a
// pitch detector had to put a boundary SOMEWHERE. Dragging that boundary should
// re-notate the same sound, not re-perform it.
//
// A gamaka is not a signal. It is a list of exact anchors on the 53-EDO grid, and the
// note's own step makes each one an absolute pitch. So two adjacent notes are already
// ONE list of (time, step) points, and moving the seam is choosing where to cut that
// list — not measuring a curve and fitting a new one to it.
//
// That distinction is the whole of this module. The first version sampled the pair
// into hundreds of points and re-fitted them: it drifted, it needed an epsilon nobody
// could justify, and it turned a three-anchor note into thirty. Cutting the list keeps
// every original anchor exactly where it was and adds exactly one — the point at the
// cut, valued with the same interpolation the players use.
//
// Everything here is absolute steps. Deltas are a serialisation detail and a trap at
// this layer: re-basing onto a different note's step is precisely the operation that
// must not change the pitch.
import { sampleCurve } from './gamaka-inline.js';

/**
 * The anchors of a run of adjacent events, in ABSOLUTE time and ABSOLUTE steps.
 *
 * items: [{ t0, dur, step, curve|null, rest? }] in order, contiguous.
 * A note with no curve is two points: its step, held.
 *
 * A REST contributes NO anchors. That is deliberate, and it is what bridges a gap:
 * the note before it ends exactly at the rest's start and the note after begins
 * exactly at its end, so the interpolation between those two points spans the silence
 * and carries the line from one pitch to the other. Absorb a rest between two notes
 * and you get the transition between them, not a flat hold at one of the two.
 *
 * The edge cases fall out of the same rule rather than needing their own. A LEADING
 * rest has nothing before it, so the first anchor is the following note's opening and
 * the silence reads as that pitch held; a TRAILING rest holds the last note's closing.
 * Someone who wants the discontinuity kept simply does not absorb the rest — they
 * resize it instead.
 */
// How many interior anchors define the transition across a rest.
//
// The bridge is INVENTED — silence has no pitch — so it is ours to define, and we
// define it in anchors rather than as one long interpolated segment. That matters when
// the seam lands inside it: a partial segment has to be re-parameterised over a shorter
// span, which no finite anchor set reproduces exactly, and a rest can be long enough
// for that error to reach the ear. Anchors are cut losslessly. Three quarters the drift
// from ~10 cents to ~3, matching what a cut between two notes already achieves.
const BRIDGE_ANCHORS = 3;

export function anchorsOf(items) {
  const list = items.filter((it) => it && it.dur > 0);
  const pts = [];
  const gaps = [];
  for (const it of list) {
    if (it.rest) { gaps.push([it.t0, it.t0 + it.dur]); continue; }
    if (!it.curve || it.curve.length < 2) pts.push([it.t0, it.step], [it.t0 + it.dur, it.step]);
    else for (const [u, sv] of it.curve) pts.push([it.t0 + u * it.dur, sv]);
  }
  // Where two events meet they each own that instant. Two points there at the SAME
  // pitch are one place and collapse to one; two at DIFFERENT pitches are a leap, and
  // collapsing those would delete it — the very thing that distinguishes two notes
  // from one line. A zero-length segment is exactly how a jump is written.
  const out = [];
  for (const p of pts) {
    const last = out[out.length - 1];
    if (last && Math.abs(p[0] - last[0]) < 1e-9 && Math.abs(p[1] - last[1]) < 1e-9) out[out.length - 1] = p;
    else out.push(p);
  }
  // Now write the transitions across the rests down as anchors. A rest whose
  // neighbours sit at the SAME pitch crosses nothing and gets none — otherwise every
  // plain note next to a rest would come back wearing an ornament.
  const bridged = [];
  for (const [a, b] of gaps) {
    const before = out.find(([t]) => Math.abs(t - a) < 1e-9);
    const after = out.find(([t]) => Math.abs(t - b) < 1e-9);
    if (!before || !after || Math.abs(after[1] - before[1]) < 1e-9) continue;
    for (let k = 1; k <= BRIDGE_ANCHORS; k++) {
      const t = a + (b - a) * (k / (BRIDGE_ANCHORS + 1));
      bridged.push([t, pitchAt(out, t)]);
    }
  }
  if (!bridged.length) return out;
  return [...out, ...bridged].sort((x, y) => x[0] - y[0]);
}

/**
 * The pitch at an absolute time, read with the SAME interpolation the players use, so
 * "the value at the cut" is the value that would have sounded there.
 */
export function pitchAt(pts, t) {
  if (!pts.length) return 0;
  if (t <= pts[0][0]) return pts[0][1];
  if (t >= pts[pts.length - 1][0]) return pts[pts.length - 1][1];
  for (let k = 1; k < pts.length; k++) {
    if (t <= pts[k][0]) {
      const [ta, sa] = pts[k - 1], [tb, sb] = pts[k];
      if (tb - ta < 1e-9) return sb;
      return sampleCurve([[0, sa], [1, sb]], (t - ta) / (tb - ta));
    }
  }
  return pts[pts.length - 1][1];
}

// Absolute points over [from,to] -> one note's own [[u, absoluteStep]] curve, or null
// when it never leaves its step. A two-identical-point curve would put a {gamaka:…}
// on every plain note in the piece.
function sliceCurve(pts, from, to, step, flatEps, fill = 3) {
  if (!(to > from)) return null;
  const span = to - from;
  const inside = pts.filter(([t]) => t > from + 1e-9 && t < to - 1e-9);

  // A cut that lands BETWEEN two anchors leaves a partial segment, and a partial
  // smoothstep re-parameterised over the shorter span is a different shape — the one
  // place this operation is not exact. So the cut segment, and only it, gets a few
  // interior points read from the original line. Anchors elsewhere are untouched.
  // A flat segment needs no interior points: a smoothstep between two equal values is
  // exactly constant, so every filled point would repeat its neighbours. Cutting into
  // a held note is the common case at a note's far edge, and without this the absorbed
  // note arrives wearing four identical anchors — noise in a file someone has to read.
  // Exact equality only. Anything looser would be curve simplification, which is a
  // different thing and does not belong here.
  // The bounding values are passed IN rather than read back with pitchAt, because at a
  // junction two anchors share an instant and pitchAt there answers with the earlier
  // one — the pitch on the far side of a leap, not the one this segment starts from.
  const cutFill = (a, b, va, vb) => {
    const out = [];
    if (va === vb) return out;
    for (let k = 1; k <= fill; k++) { const t = a + (b - a) * (k / (fill + 1)); out.push([t, pitchAt(pts, t)]); }
    return out;
  };
  const nextAnchorAfter = (t) => pts.find(([pt]) => pt > t + 1e-9);
  const prevAnchorBefore = (t) => [...pts].reverse().find(([pt]) => pt < t - 1e-9);
  const extra = [];
  const startsMidSegment = !pts.some(([pt]) => Math.abs(pt - from) < 1e-9);
  const endsMidSegment = !pts.some(([pt]) => Math.abs(pt - to) < 1e-9);
  // >= / <=, not > / <: the anchor bounding the cut segment is very often the slice's
  // own endpoint, and excluding that case skipped the fill on the side that needed it.
  if (startsMidSegment) { const n = nextAnchorAfter(from); if (n && n[0] <= to) extra.push(...cutFill(from, n[0], pitchAt(pts, from), n[1])); }
  if (endsMidSegment) { const p = prevAnchorBefore(to); if (p && p[0] >= from) extra.push(...cutFill(p[0], to, p[1], pitchAt(pts, to))); }

  const cur = [[0, pitchAt(pts, from)],
    ...[...inside, ...extra].sort((x, y) => x[0] - y[0]).map(([t, sv]) => [(t - from) / span, sv]),
    [1, pitchAt(pts, to)]];
  for (const [, sv] of cur) if (Math.abs(sv - step) > flatEps) return cur;
  return null;
}

/**
 * Re-cut a span at `seam`, preserving the pitch across it.
 *
 * Both sides keep their OWN steps — their letters do not change under the drag — so
 * whatever the line does relative to each is carried in that side's gamaka. That is
 * the treatment an off-raga note already gets, where its offset from the nearest raga
 * step rides in the ornament rather than renaming the note.
 *
 * `swallow` says which side the seam is allowed to consume, and it is the caller's
 * grip that decides. A note's edge trades with the NEIGHBOUR on that side, so the
 * neighbour is what can disappear — never the note being held, which would delete the
 * thing under the pointer. Holding the second of the pair (dragging its near edge back)
 * means the first may go; holding the first (dragging its far edge on) means the
 * second may. The side that survives always keeps at least `minDur`.
 *
 * The vanished side comes back null, its line already inside the survivor's curve.
 */
export function resplitAt({ points, t0, end, seam, prevStep, nextStep, minDur = 1, flatEps = 0.02, swallow = 'first' }) {
  if (swallow === 'second') {
    const cut = Math.min(end, Math.max(seam, t0 + minDur));
    const gone = end - cut < minDur;
    const to = gone ? end : cut;
    const prev = { dur: to - t0, curve: sliceCurve(points, t0, to, prevStep, flatEps) };
    if (gone) return { prev, next: null };
    return { prev, next: { dur: end - cut, curve: sliceCurve(points, cut, end, nextStep, flatEps) } };
  }
  const cut = Math.max(t0, Math.min(seam, end - minDur));
  const gone = cut - t0 < minDur;
  const from = gone ? t0 : cut;
  const next = { dur: end - from, curve: sliceCurve(points, from, end, nextStep, flatEps) };
  if (gone) return { prev: null, next };
  return { prev: { dur: cut - t0, curve: sliceCurve(points, t0, cut, prevStep, flatEps) }, next };
}
