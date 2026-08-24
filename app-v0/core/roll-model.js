// What a RagaM-Roll draws: notation turned into notes on a shruti grid.
//
// Pure, so the three pages that show a roll derive the same picture from the same
// notation instead of each reconstructing it. The renderer takes what comes out of
// here; nothing in here knows about a canvas.
//
// The step of a note is NOT the 12-EDO reconstruction of its MIDI number. A raga
// assigns its own comma to each letter, so the pitch is read back through the raga
// first and only falls through to the reconstruction where the raga has no such
// letter — or where there is no raga at all.
import { EDO, defaultShrutiStep } from './shruti.js';
import { stepForLetter as stepForRagaLetter } from './detect.js';
import { buildRagaSteps } from './detect-raga-helper.js';
import { ragaRowsInRange } from './note-edit.js';

const stepOfSemitone = (semi) => { const oct = Math.floor(semi / 12), pc = semi - oct * 12; return oct * EDO + defaultShrutiStep(pc); };

// Parsed notation -> the roll's notes, their start times, and the piece's own
// tonic, raga and tala. `tok` is each note's ordinal among ALL note tokens, rests
// included, so an edit can be written back to the source token it came from.
export function buildRollModel(model) {
  const allNotes = model.events.filter((e) => e.type === 'note');
  const keep = []; allNotes.forEach((e, ord) => { if (!e.rest && e.absLen > 0) keep.push(ord); });
  const kept = keep.map((ord) => allNotes[ord]);

  const sNote = kept.find((n) => n.swara === 'S' || n.swara === 's');
  const saRef = sNote ? sNote.midi - (sNote.octave - 5) * 12
    : (kept.length ? Math.min(...kept.map((n) => n.midi)) : 60);

  const rk = [...model.events].reverse().find((e) => e.type === 'raga');
  const raga = rk ? String(rk.key[0]) : '';
  const { ragaSwaraName: readBack } = buildRagaSteps(raga || '');

  const notes = kept.map((n, i) => {
    const step = stepForRagaLetter(n.swara.toUpperCase(), stepOfSemitone(n.midi - saRef), readBack);
    // Inline gamaka is stored NOTE-RELATIVE (a delta per point); the roll is absolute.
    const curve = (Array.isArray(n.gamaka) && n.gamaka.length) ? n.gamaka.map(([u, d]) => [u, step + d]) : null;
    // `gka` rides along untouched: it is where this note came from in another notation
    // system, and the roll shows it beside the note rather than reading it as music.
    return { step, dur: n.absLen, swara: n.swara.toUpperCase(), octave: n.octave, curve, tok: keep[i],
      gka: typeof n.gka === 'string' ? n.gka : null,
      // What is sung on this note, aligned to it by hand in the lane editor: the source
      // notation's written swaras and the sahitya. Carried like `gka` — the roll's
      // geometry, the audio and the MIDI are all indifferent to them.
      written: typeof n.written === 'string' ? n.written : null,
      sahitya: typeof n.sahitya === 'string' ? n.sahitya : null };
  });

  // Real composition time: the cursor advances over rests too, so a leading or
  // interior silence shows as empty time rather than being compressed out and
  // sliding everything after it off the tala grid.
  //
  // The rests are collected as we go. A rest is a real part of the music — the
  // silence between phrases is written, not absent — so it is returned rather than
  // left as a gap for the reader to infer. Same `tok` numbering as the notes, so an
  // edit can find the token that wrote it.
  const starts = [], rests = []; let t = 0, ki = 0;
  for (let o = 0; o < allNotes.length; o++) {
    if (ki < keep.length && keep[ki] === o) { starts.push(t); ki++; }
    const e = allNotes[o];
    if (e.rest && e.absLen > 0) rests.push({ t0: t, dur: e.absLen, tok: o });
    if (e.absLen > 0) t += e.absLen;
  }

  const tp = [...model.events].reverse().find((e) => e.type === 'tala');
  const P = (tp && tp.props) || {};
  return { notes, starts, rests, contentEnd: t, saRef, raga,
    tempo: (model.meta && model.meta.tempo > 0) ? model.meta.tempo : 120,
    tala: { measure: P.measure > 0 ? P.measure : 0,
      accents: Array.isArray(P.accents) ? P.accents : [],
      beat: P.beat > 0 ? P.beat : 0 },
    talaProps: tp ? P : null };
}

// How much grid to show. `user` carries any bounds a reader has stretched to by
// hand, which only ever widen what the notes need — a stretched grid must not clip
// the piece it was stretched around.
export function gridBounds(m, user = {}) {
  const notesEnd = m.contentEnd;
  let autoTotal = notesEnd || 1;
  // Blank piece: about two tala cycles of empty time, because one unit of grid
  // renders as no usable canvas to write on.
  if (m.notes.length === 0) autoTotal = m.tala.measure > 0 ? m.tala.measure * 2 : 8;
  const total = user.bottom != null ? Math.max(user.bottom, notesEnd, 1) : autoTotal;

  const ps = m.notes.map((n) => n.step);
  let notesMin, notesMax, autoMin, autoMax;
  if (ps.length) { notesMin = Math.min(...ps); notesMax = Math.max(...ps); autoMin = notesMin - 9; autoMax = notesMax + 9; }
  // Blank piece: the middle octave with HALF an octave either side. Nine steps of
  // margin left nowhere to put the first note anyone reaches for outside S..S.
  else { notesMin = 0; notesMax = EDO; autoMin = -Math.round(EDO / 2); autoMax = EDO + Math.round(EDO / 2); }
  let stepMin = user.min != null ? Math.min(user.min, notesMin) : autoMin;
  let stepMax = user.max != null ? Math.max(user.max, notesMax) : autoMax;
  if (!(stepMax > stepMin)) { stepMin = -26; stepMax = 66; }
  return { total, stepMin, stepMax };
}

// The named pitch lines: every row of the raga's own scale across the visible range,
// plus any pitch a note sits on that the raga does not name. Showing the whole scale
// (not just the pitches in use) is what makes an empty stretch of grid writable, and
// what makes an out-of-raga note visibly out of raga. No raga — note pitches only.
export function gridPitches(notes, stepMin, stepMax, raga) {
  const { ragaSteps, ragaSwaraName } = buildRagaSteps(raga || '');
  const rows = new Map();
  const row = (step, name, oct) => ({ step, name, oct, label: pitchLabel(name, oct) });
  if (ragaSteps) for (const s of ragaRowsInRange(ragaSteps, stepMin, stepMax))
    rows.set(s, row(s, ragaSwaraName.get(((s % EDO) + EDO) % EDO) || '', Math.floor(s / EDO) + 5));
  for (const n of notes) if (!rows.has(n.step)) rows.set(n.step, row(n.step, n.swara, n.octave));
  return [...rows.values()].sort((a, b) => a.step - b.step);
}

// HOW A PITCH IS SPELT on the axis. The name and the octave are kept apart on the row and
// put together here, so which parts are shown is a question asked at DRAW time rather than
// one baked into the model: turning the octave off is a re-render, not a rebuild.
//
// The octave leads — "4.R2b", not "R2b4". A label is read left to right and the octave is
// the coarse half of the address; buried at the end it was the last thing read and the
// easiest to mistake for part of the name, which in a spelling that already ends in a digit
// and a letter is a real confusion.
//
// The COMMA is the trailing a/b: the two 53-EDO steps a syntonic comma apart that share a
// swara slot. It is the finest distinction on the axis and not everyone reading wants it,
// so it comes off separately — and only where there IS one. S and P have no comma and no
// variety digit, and must not lose their last letter to a careless strip.
export function pitchLabel(name, oct, opts = {}) {
  const { octave = true, comma = true } = opts;
  const n = comma ? String(name) : String(name).replace(/(\d)[ab]$/, '$1');
  return octave && oct != null ? `${oct}.${n}` : n;
}

// Is a shruti nearest a black piano key, given where Sa is? 53-EDO does not line up
// with 12-EDO, so this snaps to the nearest semitone — it is a colouring, not a claim
// about the pitch.
const BLACK_PC = new Set([1, 3, 6, 8, 10]);
export function isBlackKey(step, saMidi) {
  const m = Math.round(saMidi + 12 * step / EDO);
  return BLACK_PC.has(((m % 12) + 12) % 12);
}
