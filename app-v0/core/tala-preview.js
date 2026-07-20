// Audio-visual tala preview: turn a TALA_MAP entry [aksharas, [accentPos…]]
// into a strum sequence + the per-akshara accent marks. Pure — no DOM, no audio.
//
// Roles per akshara (1-based position): the first accent is the SAM (cycle
// start, strongest), the other accent positions are secondary, the rest plain.
// Each role gets a distinct strum pitch so the cycle is audible as well as
// visible.

export function talaMarks(entry) {
  const [aksharas, accents] = entry;
  const acc = new Set(accents);
  const sam = accents[0];
  const marks = [];
  for (let i = 1; i <= aksharas; i++) marks.push(i === sam ? 'X' : (acc.has(i) ? 'o' : '·'));
  return marks;   // e.g. adi → ['X','·','·','·','o','·','o','·']
}

export function talaPreview(entry, { bpm = 110, cycles = 3, saMidi = 60 } = {}) {
  const [aksharas, accents] = entry;
  const acc = new Set(accents);
  const sam = accents[0];
  const beatSec = 60 / bpm;
  const pitchFor = (pos) => (pos === sam ? saMidi + 12 : acc.has(pos) ? saMidi + 7 : saMidi);
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
  return { events, totalSec: cycles * aksharas * beatSec, aksharas, accents, cycles, beatSec };
}
