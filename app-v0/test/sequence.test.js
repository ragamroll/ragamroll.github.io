import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parse } from '../core/parser.js';
import { buildSequence } from '../core/midi/sequence.js';

test('notes map to pitch/onset/duration; PPQ=480, unit=240 ticks', () => {
  const seq = buildSequence(parse('Raga=c12,0 O=5 S R2'));
  const m = seq.tracks[0];
  assert.equal(seq.ppq, 480);
  assert.equal(m.channel, 0);
  assert.equal(m.notes[0].pitch, 60);              // S = C5
  assert.equal(m.notes[0].startTicks, 0);
  assert.equal(m.notes[0].durTicks, 240);          // absLen 1 -> 240
  assert.equal(m.notes[1].pitch, 62);              // R = D5
  assert.equal(m.notes[1].startTicks, 240);
  assert.equal(m.notes[1].durTicks, 480);          // absLen 2 -> 480
});
test('does not emit a note for a rest, but advances time', () => {
  const seq = buildSequence(parse('Raga=c12,0 O=5 S z2 R'));
  const m = seq.tracks[0];
  assert.equal(m.notes.length, 2);                 // S and R only — the rest is silent
  assert.equal(m.notes[1].pitch, 62);              // R
  assert.equal(m.notes[1].startTicks, 240 + 480);  // after S(240) + rest(480)
  assert.equal(seq.totalTicks, 240 + 480 + 240);
});
test('tempo comes from meta.tempo, else default 120', () => {
  assert.equal(buildSequence(parse('Raga=c12,0 O=5 T90 S')).tempoBpm, 90);
  assert.equal(buildSequence(parse('Raga=c12,0 O=5 S')).tempoBpm, 120);
});
test('degenerate tempo T0 falls back to 120 (valid MIDI tempo bytes)', () => {
  const seq = buildSequence(parse('Raga=c12,0 O=5 T0 S'));
  assert.equal(seq.tempoBpm, 120);
});
test('zero-duration note S0 emits no note (no stuck note); others unaffected', () => {
  const seq = buildSequence(parse('Raga=c12,0 O=5 S0 R'));
  const m = seq.tracks[0];
  assert.equal(m.notes.length, 1);                 // only R — S0 is skipped
  assert.equal(m.notes[0].pitch, 62);              // R = D5
  assert.ok(m.notes.every(n => n.durTicks > 0), 'no zero-duration notes in the track');
});
test('program comes from meta.instrument', () => {
  const seq = buildSequence(parse('Raga=c12,0 O=5 I[ALTO_SAX] S'));
  assert.equal(seq.tracks[0].program, 65);
});
test('buildSequence returns melody + tala tracks', () => {
  const seq = buildSequence(parse('Raga=c12,0 O=5 Tala=adi,1 S R G m P d N >s'));
  assert.equal(seq.tracks.length, 2);
  assert.equal(seq.tracks[1].channel, 1);
});
