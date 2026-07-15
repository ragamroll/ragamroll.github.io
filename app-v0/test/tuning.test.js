import { test } from 'node:test';
import assert from 'node:assert/strict';
import { noteToMidi } from '../core/tuning.js';

test('C5 is MIDI 60 (JFugue convention)', () => {
  assert.equal(noteToMidi('C', 5), 60);
});
test('sharps and octaves', () => {
  assert.equal(noteToMidi('F#', 5), 66);
  assert.equal(noteToMidi('C', 6), 72);
  assert.equal(noteToMidi('B', 4), 59);
});
test('Bb resolves like A#', () => {
  assert.equal(noteToMidi('Bb', 5), noteToMidi('A#', 5));
});
test('semitone transpose adds to value', () => {
  assert.equal(noteToMidi('C', 5, 4), 64);   // Raga key offset
});
test('rest is 0 regardless of octave/transpose', () => {
  assert.equal(noteToMidi('R', 5), 0);
  assert.equal(noteToMidi(null, 5, 4), 0);
  assert.equal(noteToMidi('??', 5), 0);       // unknown name -> rest
});
test('octave 0 is JFugue default octave 5 (quirk)', () => {
  assert.equal(noteToMidi('C', 0), 60);
  assert.equal(noteToMidi('D', 0), 62);
  assert.equal(noteToMidi('G', 0), 67);
});
test('non-zero octaves stay linear', () => {
  assert.equal(noteToMidi('C', 1), 12);
  assert.equal(noteToMidi('C', 5), 60);
});
test('rest stays 0 even at octave 0', () => {
  assert.equal(noteToMidi('R', 0), 0);
});
