// Audio-visual tala preview: turn a TALA_MAP entry [aksharas, [accentPos…]]
// into a strum sequence + the per-akshara accent marks. Pure — no DOM, no audio.
//
// The accent positions are the start aksharas of each anga (limb). The anga's
// length is the gap to the next accent (or to the cycle end), which tells its
// type in traditional Carnatic notation:
//   length 1 → anudrutam (U),  length 2 → drutam (O),  length ≥3 → laghu (I).
// The first anga is the cycle start (the aavartana's first laghu), the strongest
// beat; every other limb start is an accent too.

// Angas as {start, len, type} in cycle order. type ∈ 'I' | 'O' | 'U'.
export function talaAngas(entry) {
  const [aksharas, accents] = entry;
  const angas = [];
  for (let k = 0; k < accents.length; k++) {
    const start = accents[k];
    const end = k + 1 < accents.length ? accents[k + 1] : aksharas + 1;
    const len = end - start;
    angas.push({ start, len, type: len === 1 ? 'U' : len === 2 ? 'O' : 'I' });
  }
  return angas;
}

// Per-akshara marks for the box row: { ch, role }. ch is the traditional anga
// glyph (I/O/U) at an anga start, '' on a plain in-anga akshara. role drives
// styling: 'start' (cycle start), 'anga' (other limb start), 'plain'.
export function talaMarks(entry) {
  const [aksharas, accents] = entry;
  const start = accents[0];
  const marks = [];
  for (let i = 0; i < aksharas; i++) marks.push({ ch: '', role: 'plain' });
  for (const a of talaAngas(entry)) {
    marks[a.start - 1] = { ch: a.type, role: a.start === start ? 'start' : 'anga' };
  }
  return marks;
}

// Strum pitch per akshara position (1-based). Every limb start is accented so the
// cycle's structure is audible:
//   cycle start (first laghu)   → lower Sa (an octave below the reference)
//   other laghu / anudrutam     → higher Sa (an octave above)
//   first drutam                → Pa   (the "first O")
//   later drutams               → Ma   (the "second O", and any beyond)
//   plain in-limb aksharas      → Sa
function pitchPlan(entry, saMidi) {
  const angas = talaAngas(entry);
  const start = angas[0].start;
  // Drutam (O) starts, excluding the cycle start, in cycle order.
  const drutams = angas.filter((a) => a.type === 'O' && a.start !== start).map((a) => a.start);
  return (pos) => {
    if (pos === start) return saMidi - 12;       // cycle start → lower Sa
    const anga = angas.find((a) => a.start === pos);
    if (!anga) return saMidi;                    // plain in-limb beat → Sa
    if (anga.type === 'O') {                     // drutam
      return drutams.indexOf(pos) === 0 ? saMidi + 7 : saMidi + 5;   // Pa / Ma
    }
    return saMidi + 12;                          // laghu / anudrutam start → higher Sa
  };
}

export function talaPreview(entry, { bpm = 110, cycles = 3, saMidi = 60 } = {}) {
  const [aksharas] = entry;
  const beatSec = 60 / bpm;
  const pitchFor = pitchPlan(entry, saMidi);
  const events = [];
  for (let c = 0; c < cycles; c++) {
    for (let i = 0; i < aksharas; i++) {
      events.push({
        midi: pitchFor(i + 1),
        startSec: (c * aksharas + i) * beatSec,
        durSec: beatSec * 0.8,
        track: 'tala',
      });
    }
  }
  return { events, totalSec: cycles * aksharas * beatSec, aksharas, accents: entry[1], cycles, beatSec };
}
