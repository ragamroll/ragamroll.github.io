// Build a MIDI-ready sequence (melody track) from the parsed model.
// Timing: 1 length-unit = an eighth note = ppq/2 ticks (240 at PPQ=480).
import { gmProgram } from './gm.js';
import { buildTalaTrack } from './tala.js';

const TICKS_PER_UNIT_AT = (ppq) => ppq / 2; // 1 length-unit = eighth note

export function buildSequence(model, { ppq = 480 } = {}) {
  const tempoBpm = (model.meta?.tempo > 0) ? model.meta.tempo : 120;  // 0/negative/missing -> 120
  const program = gmProgram(model.meta?.instrument ?? null);
  const per = TICKS_PER_UNIT_AT(ppq);

  const notes = [];
  let cursor = 0;
  for (const e of model.events) {
    if (e.type !== 'note') continue;
    const dur = Math.round(e.absLen * per);
    // A rest advances the cursor but emits no note — silence is a tick gap.
    // Zero-duration notes are skipped: on/off at the same tick sorts off-first
    // (dropped by readers, stuck note on real players).
    if (!e.rest && dur > 0) notes.push({ pitch: e.midi, startTicks: cursor, durTicks: dur });
    cursor += dur;
  }
  const melody = { channel: 0, program, notes };
  const tala = buildTalaTrack(model, cursor, ppq);
  return { ppq, tempoBpm, tracks: [melody, tala], totalTicks: cursor };
}
