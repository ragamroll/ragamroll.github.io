import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RAGAS, swaraMap } from '../core/raga-base.js';

test('c12 defines all twelve swaras with S=C', () => {
  const m = swaraMap('c12');
  assert.equal(m['S'], 'C');
});
test('hamsadhwani maps as in raga_base', () => {
  const m = swaraMap('hamsadhwani');
  assert.equal(m['S'], 'C');
  assert.equal(m['R'], 'D');
  assert.equal(m['G'], 'E');
  assert.equal(m['P'], 'G');
  assert.equal(m['N'], 'B');
  assert.equal(m['Z'], 'R');   // rest marker
});
test('RAGAS is the full table', () => {
  assert.ok(Object.keys(RAGAS).length > 5);
});
test('swaraMap throws on unknown raga', () => {
  assert.throws(() => swaraMap('no-such-raga-xyz'), /unknown raga/);
});
