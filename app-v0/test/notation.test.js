import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parse } from '../core/parser.js';
import { seqToLine } from '../core/renderers/notation.js';
import { golden, INPUTS } from './_golden.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const src = (name) => readFileSync(join(HERE, '..', 'examples', `${name}.srgm`), 'utf8');

for (const name of INPUTS) {
  test(`seqToLine(1,3,true) matches golden: ${name}`, () => {
    const { events } = parse(src(name));
    assert.equal(seqToLine(events, 1, 3, true), golden(name, 'line-1-3.txt'));
  });
  test(`seqToLine(2,2,true) matches golden: ${name}`, () => {
    const { events } = parse(src(name));
    assert.equal(seqToLine(events, 2, 2, true), golden(name, 'line-2-2.txt'));
  });
  test(`seqToLine(1,1,false) matches golden: ${name}`, () => {
    const { events } = parse(src(name));
    assert.equal(seqToLine(events, 1, 1, false), golden(name, 'line-1-1.txt'));
  });
}
