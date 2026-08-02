import { BOXES, EDO, defaultShrutiStep } from './shruti.js';

// Sa reference pitch -> MIDI note name. Ragamroll convention: MIDI 60 = C5
// (the O=5 middle octave), so octave = floor(midi/12).
const NOTE_NAMES = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];

export function noteName(hz) {
  if (!(hz > 0)) return '';
  const midi = 69 + 12 * Math.log2(hz / 440);
  const r = Math.round(midi), cents = Math.round((midi - r) * 100);
  const name = NOTE_NAMES[((r % 12) + 12) % 12] + Math.floor(r / 12);
  return name + (cents ? (cents > 0 ? ` +${cents}¢` : ` ${cents}¢`) : '');
}

export const stepOf = (freq, saRefHz) => EDO * Math.log2(freq / saRefHz);

// 12-EDO semitone (relative to Sa) -> 53-EDO step, via each pitch-class's
// default shruti (mirrors draw.js). Used when parsing pasted notation.
export const stepOfSemitone = (semi) => { const oct = Math.floor(semi / 12), pc = semi - oct * 12; return oct * EDO + defaultShrutiStep(pc); };

export function alignSeq(a, b) {
  const n = a.length, m = b.length, GAP = -1;
  const dp = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = 0; i <= n; i++) dp[i][0] = i * GAP;
  for (let j = 0; j <= m; j++) dp[0][j] = j * GAP;
  for (let i = 1; i <= n; i++) for (let j = 1; j <= m; j++) {
    const diag = dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 1 : -1);
    dp[i][j] = Math.max(diag, dp[i - 1][j] + GAP, dp[i][j - 1] + GAP);
  }
  let i = n, j = m; const cols = [];
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && dp[i][j] === dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 1 : -1)) { cols.unshift({ a: i - 1, b: j - 1 }); i--; j--; }
    else if (i > 0 && dp[i][j] === dp[i - 1][j] + GAP) { cols.unshift({ a: i - 1, b: null }); i--; }
    else { cols.unshift({ a: null, b: j - 1 }); j--; }
  }
  return cols;
}

export function computeOnsets(f) {
  if (f.length < 4 || f[0].rms == null) return [];
  const rms = f.map((p) => p.rms || 0);
  const nov = rms.map((v, i) => (i > 0 ? Math.max(0, v - rms[i - 1]) : 0));
  const mean = nov.reduce((a, b) => a + b, 0) / nov.length;
  const std = Math.sqrt(nov.reduce((a, b) => a + (b - mean) * (b - mean), 0) / nov.length);
  const thr = mean + 1.3 * std;
  const minGap = 5;   // frames (~0.06s)
  const onsets = []; let last = -1e9;
  for (let i = 1; i < nov.length - 1; i++) {
    if (nov[i] > thr && nov[i] >= nov[i - 1] && nov[i] > nov[i + 1] && (i - last) >= minGap) { onsets.push(f[i].time); last = i; }
  }
  return onsets;
}

// Frame loop: process PCM audio via injected detector -> pitch contour.
// Returns array of {time, frequency, clarity, rms} for each frame (detector
// and frameSize/hopSize injected to avoid hard coupling; DOM-free).
export function contourFromPCM(channelData, sampleRate, detector, { frameSize = 2048, hopSize = 512 } = {}) {
  const out = [];
  for (let offset = 0; offset < channelData.length - frameSize; offset += hopSize) {
    const inputBuffer = channelData.subarray(offset, offset + frameSize);
    const [frequency, clarity] = detector.findPitch(inputBuffer, sampleRate);
    const timeInSeconds = offset / sampleRate;
    const inRange = frequency >= 50 && frequency <= 1200;
    let e = 0; for (let k = 0; k < inputBuffer.length; k++) e += inputBuffer[k] * inputBuffer[k];
    out.push({ time: parseFloat(timeInSeconds.toFixed(3)), frequency: inRange ? parseFloat(frequency.toFixed(2)) : null, clarity: parseFloat(clarity.toFixed(2)), rms: parseFloat(Math.sqrt(e / inputBuffer.length).toFixed(4)) });
  }
  return out;
}

// Apply the clarity gate to the stored raw frames -> {time, frequency}.
// (Frames whose clarity is missing — old saved sessions — pass through.)
export function gateContour(pitchDataPoints, clarityThresh) {
  return pitchDataPoints.map((p) => ({
    time: p.time,
    frequency: (p.frequency != null && (p.clarity == null || p.clarity >= clarityThresh)) ? p.frequency : null,
  }));
}

const BRIDGE_STEPS = 5;            // max endpoint pitch gap (53-EDO) to bridge
const HALF = Math.SQRT2;           // half-octave ratio (octave-nearest test)
const CLAMP = 60;          // draw's max gamaka span (± steps); EDO imported from shruti.js
const TARGET = 120;        // downsample the ~86 fps contour to this many points

const C12 = ['S', 'r', 'R', 'g', 'G', 'm', 'M', 'P', 'd', 'D', 'n', 'N'];   // internal to notesToSrgm (no-raga chromatic tokens); not exported

export function cleanContour(points, bridgeMs) {
  const pts = points.map(p => ({ time: p.time, frequency: p.frequency }));
  const vi = pts.filter(p => p.frequency !== null);
  if (vi.length < 2) return pts;
  const sorted = vi.map(p => p.frequency).slice().sort((a, b) => a - b);
  const gmed = sorted[Math.floor(sorted.length / 2)];

  // 1. octave continuity — each frame to the octave nearest the previous.
  let prev = null;
  for (const p of vi) {
    let f = p.frequency;
    const ref = prev == null ? gmed : prev;
    for (let k = 0; k < 5; k++) {
      if (f / ref > HALF) f /= 2;
      else if (ref / f > HALF) f *= 2;
      else break;
    }
    p.frequency = f; prev = f;
  }

  // 2. median-3 despike.
  const src = vi.map(p => p.frequency);
  for (let i = 1; i < vi.length - 1; i++) {
    const a = src[i - 1], b = src[i], c = src[i + 1];
    vi[i].frequency = a <= b ? (b <= c ? b : (a <= c ? c : a)) : (a <= c ? a : (b <= c ? c : b));
  }

  // 3. bridge only short, close-pitch gaps.
  let i = 0;
  while (i < pts.length) {
    if (pts[i].frequency === null) {
      let j = i; while (j < pts.length && pts[j].frequency === null) j++;
      const a = pts[i - 1], b = pts[j];
      if (a && b && a.frequency && b.frequency && (b.time - a.time) * 1000 <= bridgeMs
          && Math.abs(EDO * Math.log2(b.frequency / a.frequency)) <= BRIDGE_STEPS) {
        for (let k = i; k < j; k++) {
          const r = (pts[k].time - a.time) / (b.time - a.time);
          pts[k].frequency = a.frequency * Math.pow(b.frequency / a.frequency, r);
        }
      }
      i = j;
    } else i++;
  }
  return pts;
}

export function buildSrgm(points, duration) {
  const voiced = points.filter(p => p.frequency !== null);
  if (voiced.length < 2 || !(duration > 0)) return null;
  const saRef = voiced[0].frequency;

  let pts = voiced.map(p => {
    const u = p.time / duration;
    let step = Math.round(EDO * Math.log2(p.frequency / saRef));
    step = Math.max(-CLAMP, Math.min(CLAMP, step));
    return [u, step];
  });

  // Decimate to TARGET, always keeping the first and last frame.
  if (pts.length > TARGET) {
    const stride = (pts.length - 1) / (TARGET - 1);
    const out = [];
    for (let i = 0; i < TARGET; i++) out.push(pts[Math.round(i * stride)]);
    pts = out;
  }
  pts[0][0] = 0;
  pts[pts.length - 1][0] = 1;

  // Round u to 2dp, force strictly-increasing u, drop consecutive same-step.
  const clean = [];
  for (let [u, s] of pts) {
    u = Math.min(1, Math.max(0, Math.round(u * 100) / 100));
    const prev = clean[clean.length - 1];
    if (prev) {
      if (u <= prev[0]) continue;            // keep u strictly increasing
      if (s === prev[1]) { clean[clean.length - 1] = [prev[0], s]; continue; } // collapse flat runs
    }
    clean.push([u, s]);
  }
  if (clean.length < 2) return null;
  clean[clean.length - 1][0] = 1;

  const vec = clean.map(([u, s]) => `[${u},${s}]`).join(',');
  const len = Math.max(1, Math.round(duration * 4)); // T120: 1 unit = 0.25s
  return (
    `% Generated from an audio pitch contour by pitchy.html\n` +
    `% One Sa note; gamaka = detected pitch relative to the first voiced ` +
    `frame (Sa = ${saRef.toFixed(1)} Hz), ${clean.length} points.\n` +
    `T120\nRaga=c12,0\nTala=adi,1\nO=5 L=1\n` +
    `S${len}{gamaka:[${vec}]}\n`
  );
}

export function computeAxis(data, saOverride) {
  const v = data.filter(p => p.frequency !== null);
  const saRefHz = (saOverride != null) ? saOverride : (v.length ? v[0].frequency : 0);
  let stepMin = -4, stepMax = 4; const LINES = [];
  if (!(saRefHz > 0)) return { saRefHz: 0, stepMin, stepMax, LINES };
  const steps = v.map(p => stepOf(p.frequency, saRefHz));
  stepMin = Math.floor(Math.min(...steps)) - 4;
  stepMax = Math.ceil(Math.max(...steps)) + 4;
  if (!(stepMax > stepMin)) { stepMin = -4; stepMax = 4; }
  const o0 = Math.floor(stepMin / EDO), o1 = Math.ceil(stepMax / EDO);
  for (let o = o0; o <= o1; o++) for (const b of BOXES) { const s = o * EDO + b.step; if (s >= stepMin && s <= stepMax) LINES.push(s); }
  LINES.sort((a, b) => a - b);
  return { saRefHz, stepMin, stepMax, LINES };
}

export function computeCrossings(data, LINES, saRefHz) {
  const crossings = [];
  let prev = null;
  for (const p of data) {
    if (p.frequency === null) { prev = null; continue; }
    const s = stepOf(p.frequency, saRefHz), t = p.time;
    if (prev) {
      const lo = Math.min(prev.s, s), hi = Math.max(prev.s, s);
      for (const L of LINES) {
        if (L > lo && L < hi) {
          const f = (L - prev.s) / (s - prev.s);
          crossings.push({ step: L, t: prev.t + f * (t - prev.t) });
        }
      }
    }
    prev = { s, t };
  }
  return crossings;
}

export function swaraNameForStep(absStep, ragaSteps, ragaSwaraName) {
  const mod = ((absStep % EDO) + EDO) % EDO;
  if (ragaSteps && ragaSwaraName.has(mod)) return ragaSwaraName.get(mod);
  const b = BOXES.find((x) => x.step === mod);
  return b ? b.names[0] : '?';
}

export function letterToModStep(L, ragaSwaraName) {
  if (ragaSwaraName.size) for (const [mod, name] of ragaSwaraName) if ((name[0] || '').toUpperCase() === L) return mod;
  return L === 'S' ? 0 : L === 'P' ? 31 : null;
}

export function stepForLetter(L, ref, ragaSwaraName) {
  const mod = letterToModStep(L, ragaSwaraName);
  if (mod == null) return Math.round(ref);
  const k = Math.round((ref - mod) / EDO);
  let best = mod + k * EDO;
  for (const kk of [k - 1, k + 1]) if (Math.abs(mod + kk * EDO - ref) < Math.abs(best - ref)) best = mod + kk * EDO;
  return best;
}

export function gamakaForNote(n, cleanedPoints, saRefHz) {
  const dur = n.t1 - n.t0;
  if (!(dur > 0) || !(saRefHz > 0)) return null;
  let pts = [];
  for (const p of cleanedPoints) {
    if (p.frequency == null || p.time < n.t0 - 1e-6 || p.time > n.t1 + 1e-6) continue;
    pts.push([(p.time - n.t0) / dur, Math.round(stepOf(p.frequency, saRefHz) - n.step)]);
  }
  if (pts.length < 2) return null;
  const N = 24;
  if (pts.length > N) { const stride = (pts.length - 1) / (N - 1); const out = []; for (let i = 0; i < N; i++) out.push(pts[Math.round(i * stride)]); pts = out; }
  pts[0][0] = 0; pts[pts.length - 1][0] = 1;
  const clean = [];
  for (let [u, d] of pts) {
    u = Math.min(1, Math.max(0, Math.round(u * 100) / 100)); d = Math.max(-60, Math.min(60, d));
    const pv = clean[clean.length - 1];
    if (pv) { if (u <= pv[0]) continue; if (d === pv[1]) { clean[clean.length - 1] = [pv[0], d]; continue; } }
    clean.push([u, d]);
  }
  if (clean.length < 2) return null;
  clean[clean.length - 1][0] = 1;
  if (clean.every((p) => p[1] === 0)) return null;   // steady swara -> no gamaka
  return clean;
}

export function notesFromBoundaries(boundaries, { gamakas, cleanedPoints, saRefHz }) {
  const bs = boundaries.slice().sort((a, b) => a.t - b.t);
  const notes = [];
  for (let i = 0; i < bs.length - 1; i++) {
    if (bs[i].step == null) continue;
    const n = { step: bs[i].step, t0: bs[i].t, t1: bs[i + 1].t, name: bs[i].name };
    if (bs[i].gamaka) n.gamaka = bs[i].gamaka;
    notes.push(n);
  }
  if (gamakas) for (const n of notes) if (!n.gamaka) n.gamaka = gamakaForNote(n, cleanedPoints, saRefHz);
  return notes;
}

// Detect note boundaries from the cleaned pitch contour, snapped onto the
// raga's shruti lines. Pure extraction of detectNotes' body (pitchy.html
// 797-837), minus the DOM guard/pushUndo/statusMsg/render side effects.
// REQUIRES a non-null `ragaSteps` Set (it's iterated below) — callers must
// pick a raga first; the no-raga path goes through buildSrgm, not here.
export function segmentNotes(cleanedPoints, ragaSteps, { stepMin, stepMax, saRefHz, snapOnsets, onsets, ragaSwaraName }) {
  const ragaLines = [];
  const o0 = Math.floor(stepMin / EDO) - 1, o1 = Math.ceil(stepMax / EDO) + 1;
  for (let o = o0; o <= o1; o++) for (const s of ragaSteps) ragaLines.push(o * EDO + s);
  ragaLines.sort((a, b) => a - b);
  const nearestRaga = (step) => { let best = ragaLines[0], bd = Infinity; for (const L of ragaLines) { const d = Math.abs(L - step); if (d < bd) { bd = d; best = L; } } return best; };
  const asg = cleanedPoints.map((p) => p.frequency == null ? null : { t: p.time, abs: nearestRaga(stepOf(p.frequency, saRefHz)) });
  const W = 11;   // ~0.25s median window (frames are ~11ms)
  const sm = asg.map((a, i) => {
    if (!a) return null;
    const win = []; for (let j = Math.max(0, i - W); j <= Math.min(asg.length - 1, i + W); j++) if (asg[j]) win.push(asg[j].abs);
    win.sort((x, y) => x - y); return { t: a.t, abs: win[Math.floor(win.length / 2)] };
  });
  let runs = [], cur = null;
  for (const s of sm) { if (!s) { if (cur) { runs.push(cur); cur = null; } continue; } if (cur && cur.abs === s.abs) cur.t1 = s.t; else { if (cur) runs.push(cur); cur = { abs: s.abs, t0: s.t, t1: s.t }; } }
  if (cur) runs.push(cur);
  runs = runs.filter((r) => r.t1 - r.t0 >= 0.10);
  const merged = [];
  for (const r of runs) { const last = merged[merged.length - 1]; if (last && last.abs === r.abs && r.t0 - last.t1 < 0.35) last.t1 = r.t1; else merged.push({ ...r }); }
  const dn = merged.filter((r) => r.t1 - r.t0 >= 0.13);
  if (!dn.length) return [];
  // Snap each note's START back to the nearest consonant/attack onset just
  // before it (the vowel dwell begins after the consonant), clamped so it
  // can't cross into the previous note.
  if (snapOnsets) {
    for (let i = 0; i < dn.length; i++) {
      const lo = Math.max(dn[i].t0 - 0.18, i > 0 ? dn[i - 1].t0 + 0.06 : 0), hi = dn[i].t0 + 0.03;
      let best = null, bd = Infinity;
      for (const ot of onsets) { if (ot < lo || ot > hi) continue; const d = Math.abs(ot - dn[i].t0); if (d < bd) { bd = d; best = ot; } }
      if (best != null && Math.abs(best - dn[i].t0) > 0.005) { dn[i].t0 = best; if (i > 0 && dn[i - 1].t1 > best) dn[i - 1].t1 = best; }
    }
  }
  const boundaries = [];
  for (let i = 0; i < dn.length; i++) {
    const r = dn[i];
    boundaries.push({ t: r.t0, step: r.abs, name: swaraNameForStep(r.abs, ragaSteps, ragaSwaraName) });
    const next = dn[i + 1];
    if (!next || next.t0 - r.t1 > 0.06) boundaries.push({ t: r.t1, step: null, name: null });   // rest / gap
  }
  return boundaries;
}

// Map an absolute 53-EDO step to its srgm swara letter + ABSOLUTE octave register
// (5 = the O=5 baseline). Pure extraction of notesToSrgm's per-note letter/octave
// logic so the draw editor and pitchy's serializer agree byte-for-byte.
export function stepToSwara(step, { useRaga, ragaSteps, ragaSwaraName } = {}) {
  let o = Math.floor(step / EDO);
  const mod = step - o * EDO;
  let letter;
  if (useRaga) {
    letter = swaraNameForStep(step, ragaSteps, ragaSwaraName)[0].toUpperCase();
  } else {
    let semi = Math.round(12 * mod / EDO);
    if (semi >= 12) { semi -= 12; o += 1; }
    letter = C12[semi];
  }
  return { letter, octave: 5 + o };
}

// Serialize `notes` (as produced by notesFromBoundaries) into srgm notation,
// pure extraction of notesToSrgm (pitchy.html 995-1042).
export function notesToSrgm(notes, { includeGamaka = true, ragaName, useRaga, ragaSteps, ragaSwaraName } = {}) {
  const ns = notes.slice().sort((a, b) => a.t0 - b.t0);
  if (!ns.length) return '';
  // Fine grid (RES units/sec) so quantization is small, and quantize the
  // ABSOLUTE positions — each length is the gap between rounded absolute
  // times, so rounding errors never accumulate. A leading `z` rest preserves
  // the silence before the first note, so the timeline stays audio-aligned.
  const RES = 16;                    // units per second
  const tempo = 30 * RES;            // 1 length-unit = 1/RES seconds (parser: unit = 30/tempo s)
  let qCursor = 0;                   // quantized cursor position, in units
  let curOct = 5;                    // matches O=5; parser octave marks are RELATIVE + persistent
  const toks = [];
  for (const n of ns) {
    const qStart = Math.round(n.t0 * RES);
    if (qStart > qCursor) { toks.push('z' + (qStart - qCursor)); qCursor = qStart; }   // leading rest + gaps
    const { letter, octave: targetOct } = stepToSwara(n.step, { useRaga, ragaSteps, ragaSwaraName });
    // Emit the DELTA from the previous note's octave (>/< accumulate in the parser).
    const dOct = targetOct - curOct;
    const oct = dOct > 0 ? '>'.repeat(dOct) : (dOct < 0 ? '<'.repeat(-dOct) : '');
    curOct = targetOct;
    const len = Math.max(1, Math.round(n.t1 * RES) - qCursor);
    qCursor += len;
    let tok = oct + letter + len;
    if (includeGamaka && n.gamaka && n.gamaka.length >= 2) tok += `{gamaka:[${n.gamaka.map(([u, d]) => `[${u},${d}]`).join(',')}]}`;
    toks.push(tok);
  }
  // Gamaka-bearing tokens go on their own line for readability; plain notes
  // stay grouped on shared lines.
  const lines = []; let cur = [];
  for (const tok of toks) {
    if (/\{gamaka:/.test(tok)) { if (cur.length) { lines.push(cur.join(' ')); cur = []; } lines.push(tok); }
    else cur.push(tok);
  }
  if (cur.length) lines.push(cur.join(' '));
  return `T${tempo}\nRaga=${ragaName || 'c12'},0\nTala=adi,1\nO=5 L=1\n${lines.join('\n')}\n`;
}
