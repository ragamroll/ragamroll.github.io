import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gmProgram, SITAR } from '../core/midi/gm.js';

test('known GM names map to 0-based program numbers', () => {
  assert.equal(gmProgram('PIANO'), 0);
  assert.equal(gmProgram('ALTO_SAX'), 65);
  assert.equal(gmProgram('SITAR'), 104);
});
test('unknown or null name defaults to 0', () => {
  assert.equal(gmProgram('NOT_AN_INSTRUMENT'), 0);
  assert.equal(gmProgram(null), 0);
});
test('SITAR constant is 104', () => { assert.equal(SITAR, 104); });
