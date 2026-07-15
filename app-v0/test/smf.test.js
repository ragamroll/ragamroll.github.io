import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeSMF, readSMF, vlq, readVlq } from '../core/midi/smf.js';

test('VLQ round-trips (incl. multi-byte)', () => {
  for (const n of [0, 1, 127, 128, 8192, 0x0FFFFFFF]) {
    const bytes = vlq(n);
    const { value, next } = readVlq(bytes, 0);
    assert.equal(value, n);
    assert.equal(next, bytes.length);
  }
});
test('header identifies a format-1 file with correct ntrks and division', () => {
  const bytes = writeSMF({ ppq: 480, tempoBpm: 120, tracks: [{ channel: 0, program: 0, notes: [] }] });
  assert.deepEqual([...bytes.slice(0, 4)], [0x4d, 0x54, 0x68, 0x64]); // "MThd"
  const format = (bytes[8] << 8) | bytes[9];
  const ntrks = (bytes[10] << 8) | bytes[11];
  const division = (bytes[12] << 8) | bytes[13];
  assert.equal(format, 1);
  assert.equal(ntrks, 2);        // conductor + 1 track
  assert.equal(division, 480);
});
test('a note survives a write/read round-trip at the right tick and duration', () => {
  const seq = { ppq: 480, tempoBpm: 120, tracks: [
    { channel: 0, program: 65, notes: [{ pitch: 60, startTicks: 0, durTicks: 240 }, { pitch: 64, startTicks: 240, durTicks: 480 }] },
  ]};
  const dec = readSMF(writeSMF(seq));
  const notes = dec.notes.sort((a, b) => a.startTicks - b.startTicks);
  assert.equal(notes.length, 2);
  assert.deepEqual({ p: notes[0].pitch, s: notes[0].startTicks, d: notes[0].durTicks }, { p: 60, s: 0, d: 240 });
  assert.deepEqual({ p: notes[1].pitch, s: notes[1].startTicks, d: notes[1].durTicks }, { p: 64, s: 240, d: 480 });
});
// Hand-build a raw SMF (format 0, one track) from event bytes, to exercise the
// reader on constructs our writer never emits (meta/sysex between notes).
function rawSMF(trackEventBytes) {
  const track = [...trackEventBytes, 0x00, 0xff, 0x2f, 0x00]; // + End of Track
  return Uint8Array.from([
    0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 0, 0, 1, 0x01, 0xe0,          // MThd, format 0, 1 trk, ppq 480
    0x4d, 0x54, 0x72, 0x6b, (track.length >>> 24) & 0xff, (track.length >>> 16) & 0xff, (track.length >>> 8) & 0xff, track.length & 0xff,
    ...track,
  ]);
}
test('a meta event between note-on and note-off does not break the note decode', () => {
  // Regression guard for the status===0xff meta check: 0xff & 0xf0 === 0xf0, so a
  // `type === 0xff` comparison never matches and the meta payload is misparsed.
  const bytes = rawSMF([
    0x00, 0x90, 0x3c, 0x40,                   // t=0    note-on  C4
    0x81, 0x70, 0xff, 0x51, 0x03, 0x07, 0xa1, 0x20, // t=240  meta tempo (FF 51 03 tt tt tt)
    0x81, 0x70, 0x80, 0x3c, 0x00,             // t=480  note-off C4
  ]);
  const dec = readSMF(bytes);
  assert.equal(dec.notes.length, 1);
  assert.deepEqual({ p: dec.notes[0].pitch, s: dec.notes[0].startTicks, d: dec.notes[0].durTicks }, { p: 60, s: 0, d: 480 });
});
test('a sysex event between notes is skipped whole — no phantom notes from its payload', () => {
  // Payload deliberately contains 0x90 0x40 0x40 (looks like a note-on if misparsed).
  const bytes = rawSMF([
    0x00, 0x90, 0x3c, 0x40,                   // t=0    note-on  C4
    0x60, 0xf0, 0x05, 0x7e, 0x90, 0x40, 0x40, 0xf7, // t=96   sysex F0, len 5, payload
    0x81, 0x10, 0x80, 0x3c, 0x00,             // t=240  note-off C4
  ]);
  const dec = readSMF(bytes);
  assert.equal(dec.notes.length, 1);          // no note decoded from inside the sysex payload
  assert.deepEqual({ p: dec.notes[0].pitch, s: dec.notes[0].startTicks, d: dec.notes[0].durTicks }, { p: 60, s: 0, d: 240 });
});
test('multiple tracks are all emitted and decoded', () => {
  const seq = { ppq: 480, tempoBpm: 100, tracks: [
    { channel: 0, program: 0, notes: [{ pitch: 60, startTicks: 0, durTicks: 240 }] },
    { channel: 1, program: 104, notes: [{ pitch: 67, startTicks: 0, durTicks: 240 }] },
  ]};
  const dec = readSMF(writeSMF(seq));
  assert.equal(dec.notes.length, 2);
  assert.ok(dec.notes.some(n => n.pitch === 60 && n.channel === 0));
  assert.ok(dec.notes.some(n => n.pitch === 67 && n.channel === 1));
});
