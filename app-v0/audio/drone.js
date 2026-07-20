import { midiToFreq } from './schedule.js';
import { stepFreq, P_STEP } from '../core/shruti.js';

// The one true drone voicing, shared by every consumer (composition transport
// and the raga sampler alike) so the drone is a single global device — same Sa,
// same octave, same tuning everywhere. Sustained voices for a Sa MIDI:
// S · P · >S (Sa, Pa a 53-EDO fifth above, upper Sa an octave up).
export function droneFreqs(saMidi) {
  const saFreq = midiToFreq(saMidi);
  return [saFreq, stepFreq(saFreq, P_STEP), saFreq * 2];   // S, P, >S
}
