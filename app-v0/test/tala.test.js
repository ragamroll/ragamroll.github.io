import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parse } from '../core/parser.js';
import { buildTalaTrack } from '../core/midi/tala.js';
import { SITAR } from '../core/midi/gm.js';

// adi,1 -> measure 8, beat 1, accents [1,5,7] (slots are 1-based, 1 slot = 1 unit = 240 ticks)
test('strikes land on accented slots, tonic+fifth, over the span', () => {
  const model = parse('Raga=c12,0 O=5 Tala=adi,1 S R G m P d N >s');  // 8 units = one cycle
  const totalTicks = 8 * 240;
  const t = buildTalaTrack(model, totalTicks, 480);
  assert.equal(t.channel, 1);
  assert.equal(t.program, SITAR);
  const starts = [...new Set(t.notes.map(n => n.startTicks))].sort((a, b) => a - b);
  assert.deepEqual(starts, [0 * 240, 4 * 240, 6 * 240]);      // accents 1,5,7 -> slots 0,4,6
  // both tonic (60) and fifth (67) at slot 0 for c12,0
  assert.ok(t.notes.some(n => n.startTicks === 0 && n.pitch === 60));
  assert.ok(t.notes.some(n => n.startTicks === 0 && n.pitch === 67));
});
test('does NOT strike on a non-accented slot', () => {
  const model = parse('Raga=c12,0 O=5 Tala=adi,1 S R G m P d N >s');
  const t = buildTalaTrack(model, 8 * 240, 480);
  assert.ok(t.notes.length > 0);                              // guard against vacuous pass on empty track
  assert.ok(!t.notes.some(n => n.startTicks === 1 * 240));    // slot 2 (index 1) is not an accent
  assert.ok(!t.notes.some(n => n.startTicks === 2 * 240));
});
test('returns empty track for degenerate measure (Tala=adi,0) — no hang', () => {
  const t = buildTalaTrack(parse('Raga=c12,0 O=5 Tala=adi,0 S'), 240, 480);
  assert.equal(t.notes.length, 0);
  assert.equal(t.channel, 1);
});
test('returns empty track for negative beat (Tala=adi,-1)', () => {
  const t = buildTalaTrack(parse('Raga=c12,0 O=5 Tala=adi,-1 S'), 240, 480);
  assert.equal(t.notes.length, 0);
});
test('returns empty track when totalTicks is 0', () => {
  const t = buildTalaTrack(parse('Raga=c12,0 O=5 Tala=adi,1 S'), 0, 480);
  assert.equal(t.notes.length, 0);
});
test('cycle repeats to cover the span', () => {
  const model = parse('Raga=c12,0 O=5 Tala=adi,1 S');
  const t = buildTalaTrack(model, 16 * 240, 480);            // two cycles
  assert.ok(t.notes.some(n => n.startTicks === 8 * 240));    // start of 2nd cycle (accent 1)
});
test('raga offset transposes the drone (hamsadhwani,4 -> tonic 64, fifth 71)', () => {
  const model = parse('Raga=hamsadhwani,4 O=5 Tala=adi,1 S');
  const t = buildTalaTrack(model, 8 * 240, 480);
  assert.ok(t.notes.some(n => n.startTicks === 0 && n.pitch === 64));   // S = C5+4
  assert.ok(t.notes.some(n => n.startTicks === 0 && n.pitch === 71));   // P = G5+4
});
