// Tala (rhythm/drone) track generator — kept separate from the melody.
// On each accented slot of the tala cycle, strike the tonic (S) and fifth (P)
// on channel 1 with a sitar program, repeating the cycle to cover totalTicks.
import { SITAR } from './gm.js';

// Groovy Integer.decode-style parse for the raga semitone offset.
function decodeInt(s) { const n = Number(s); return Number.isNaN(n) ? 0 : Math.trunc(n); }

function lastRagaOffset(model) {
  const raga = [...model.events].reverse().find(e => e.type === 'raga');
  return raga ? decodeInt(raga.key[1]) : 0;   // key = [name, semitones]
}
function lastTala(model) {
  const t = [...model.events].reverse().find(e => e.type === 'tala');
  return t ? t.props : null;
}

export function buildTalaTrack(model, totalTicks, ppq) {
  const props = lastTala(model);
  const track = { channel: 1, program: SITAR, notes: [] };
  if (!props || totalTicks <= 0 || !(props.measure > 0)) return track;

  const { measure, accents } = props;          // measure = slots per cycle; accents = 1-based slots
  const semis = lastRagaOffset(model);
  const tonic = 60 + semis;                    // S = C5 + offset
  const fifth = 67 + semis;                    // P = G5 + offset
  const slotTicks = ppq / 2;                   // one tala slot = one length-unit
  const cycleTicks = measure * slotTicks;

  for (let cycleStart = 0; cycleStart < totalTicks; cycleStart += cycleTicks) {
    for (const a of accents) {
      const t = cycleStart + (a - 1) * slotTicks;
      if (t < totalTicks) {
        track.notes.push({ pitch: tonic, startTicks: t, durTicks: slotTicks });
        track.notes.push({ pitch: fifth, startTicks: t, durTicks: slotTicks });
      }
    }
  }
  return track;
}
