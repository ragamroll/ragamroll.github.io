import { test } from 'node:test';
import assert from 'node:assert/strict';
import { golden, INPUTS } from './_golden.js';

test('golden files load and are non-empty', () => {
  for (const name of INPUTS) {
    assert.ok(golden(name, 'roll.txt').length > 0, `${name} roll`);
  }
});
