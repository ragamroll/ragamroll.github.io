// Minimal Standard MIDI File (SMF) format-1 writer + a small reader for tests.
// No dependencies. All multi-byte integers big-endian.

export function vlq(n) {                          // variable-length quantity
  let buffer = n & 0x7f;
  const out = [];
  while ((n >>= 7) > 0) { buffer <<= 8; buffer |= ((n & 0x7f) | 0x80); }
  while (true) { out.push(buffer & 0xff); if (buffer & 0x80) buffer >>= 8; else break; }
  return out;
}
export function readVlq(bytes, pos) {
  let value = 0, i = pos, b;
  do { b = bytes[i++]; value = (value << 7) | (b & 0x7f); } while (b & 0x80);
  return { value, next: i };
}

const str = (s) => [...s].map(c => c.charCodeAt(0));
const u32 = (n) => [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];
const u16 = (n) => [(n >>> 8) & 0xff, n & 0xff];

function chunk(id, data) { return [...str(id), ...u32(data.length), ...data]; }

function conductorTrack(tempoBpm) {
  // Clamp to the 3-byte tempo-meta range; degenerate BPM (0/negative) -> 120.
  const usPerQuarter = Math.min(0xffffff, Math.max(1, Math.round(60000000 / (tempoBpm > 0 ? tempoBpm : 120))));
  const data = [];
  data.push(...vlq(0), 0xff, 0x51, 0x03, (usPerQuarter >> 16) & 0xff, (usPerQuarter >> 8) & 0xff, usPerQuarter & 0xff);
  data.push(...vlq(0), 0xff, 0x2f, 0x00);          // End of Track
  return chunk('MTrk', data);
}

function noteTrack({ channel, program, notes }) {
  // Build absolute-time events, then delta-encode.
  const evs = [];
  if (program != null) evs.push({ tick: 0, order: 0, bytes: [0xc0 | (channel & 0x0f), program & 0x7f] });
  for (const n of notes) {
    evs.push({ tick: n.startTicks, order: 1, bytes: [0x90 | (channel & 0x0f), n.pitch & 0x7f, 0x40] });
    evs.push({ tick: n.startTicks + n.durTicks, order: 0, bytes: [0x80 | (channel & 0x0f), n.pitch & 0x7f, 0x00] });
  }
  // Sort by tick; at equal tick, note-off (order 0) before note-on (order 1); program is order 0 at tick 0.
  evs.sort((a, b) => a.tick - b.tick || a.order - b.order);
  const data = [];
  let last = 0;
  for (const e of evs) { data.push(...vlq(e.tick - last), ...e.bytes); last = e.tick; }
  data.push(...vlq(0), 0xff, 0x2f, 0x00);          // End of Track
  return chunk('MTrk', data);
}

export function writeSMF({ ppq, tempoBpm, tracks }) {
  const ntrks = 1 + tracks.length;
  const header = chunk('MThd', [...u16(1), ...u16(ntrks), ...u16(ppq)]);
  const body = [...conductorTrack(tempoBpm), ...tracks.flatMap(noteTrack)];
  return Uint8Array.from([...header, ...body]);
}

// --- minimal reader (tests + fidelity oracle) ---
export function readSMF(bytes) {
  let pos = 0;
  const readChunk = () => {
    const id = String.fromCharCode(bytes[pos], bytes[pos + 1], bytes[pos + 2], bytes[pos + 3]);
    const len = (bytes[pos + 4] << 24) | (bytes[pos + 5] << 16) | (bytes[pos + 6] << 8) | bytes[pos + 7];
    const start = pos + 8; pos = start + len;
    return { id, start, end: start + len };
  };
  const mthd = readChunk();
  const ppq = (bytes[mthd.start + 4] << 8) | bytes[mthd.start + 5];
  const notes = [];
  while (pos < bytes.length) {
    const trk = readChunk();
    let i = trk.start, tick = 0, running = 0;
    const open = new Map();   // pitch|channel -> startTick
    while (i < trk.end) {
      const dt = readVlq(bytes, i); tick += dt.value; i = dt.next;
      let status = bytes[i];
      if (status & 0x80) { i++; running = status; } else { status = running; }
      const type = status & 0xf0, ch = status & 0x0f;
      if (status === 0xff) { i++; const l = readVlq(bytes, i); i = l.next + l.value; }   // meta: skip type byte + length-prefixed payload
      else if (status === 0xf0 || status === 0xf7) { const l = readVlq(bytes, i); i = l.next + l.value; }  // sysex: length-prefixed payload
      else if (type === 0xc0 || type === 0xd0) { i += 1; }
      else if (type === 0x90) {
        const pitch = bytes[i++], vel = bytes[i++];
        if (vel > 0) open.set(`${pitch}|${ch}`, tick);
        else { const s = open.get(`${pitch}|${ch}`); if (s != null) { notes.push({ pitch, startTicks: s, durTicks: tick - s, channel: ch }); open.delete(`${pitch}|${ch}`); } }
      } else if (type === 0x80) {
        const pitch = bytes[i++]; i++; const s = open.get(`${pitch}|${ch}`);
        if (s != null) { notes.push({ pitch, startTicks: s, durTicks: tick - s, channel: ch }); open.delete(`${pitch}|${ch}`); }
      } else { i += 2; }   // other 2-data-byte messages
    }
  }
  return { ppq, notes };
}
