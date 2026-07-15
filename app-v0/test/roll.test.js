import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parse } from '../core/parser.js';
import { seqToRoll } from '../core/renderers/roll.js';
import { golden, INPUTS } from './_golden.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const src = (name) => readFileSync(join(HERE, '..', 'examples', `${name}.srgm`), 'utf8');

for (const name of INPUTS) {
  test(`seqToRoll matches golden: ${name}`, () => {
    const { events, seqProps } = parse(src(name));
    assert.equal(seqToRoll(events, seqProps), golden(name, 'roll.txt'));
  });
}
