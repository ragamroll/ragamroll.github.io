// Pure scheduling math: turn a MIDI sequence into timed note events. No DOM, no Tone.
export function midiToFreq(m) {
  return 440 * Math.pow(2, (m - 69) / 12);
}

function secPerTick(sequence) {
  return 60 / sequence.tempoBpm / sequence.ppq;
}

export function scheduleEvents(sequence) {
  const spt = secPerTick(sequence);
  const events = [];
  for (const track of sequence.tracks) {
    const name = track.channel === 0 ? 'melody' : 'tala';
    for (const n of track.notes) {
      const startSec = n.startTicks * spt, durSec = n.durTicks * spt;
      const freq = n.freq;
      const ev = { midi: n.pitch, startSec, durSec, track: name };
      // Optional microtonal override (experimental 53-EDO scale). Absent unless
      // an app-level retune set it — so the default event shape is unchanged.
      if (freq != null) ev.freq = freq;
      events.push(ev);
    }
  }
  events.sort((a, b) => a.startSec - b.startSec);
  return events;
}

export function totalSeconds(sequence) {
  return sequence.totalTicks * secPerTick(sequence);
}
