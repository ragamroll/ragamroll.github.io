// MIDI fidelity oracle: our generated melody vs JFugue's own rendering of the
// same composition (web/test/golden/<name>/jfugue.mid, produced by
// tools/gen-golden.groovy from the reference Groovy NotationParser).
//
// JFugue emits rests as pitched notes; our builder emits silence (a tick gap).
// So our melody's non-rest pitch sequence must appear as an in-order
// subsequence of JFugue's melody-note pitch sequence.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parse } from '../core/parser.js';
import { buildSequence } from '../core/midi/sequence.js';
import { writeSMF, readSMF } from '../core/midi/smf.js';
import { INPUTS } from './_golden.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const srcOf = (n) => readFileSync(join(HERE, '..', 'examples', `${n}.srgm`), 'utf8');
const midOf = (n) => new Uint8Array(readFileSync(join(HERE, 'golden', n, 'jfugue.mid')));

for (const name of INPUTS) {
  test(`melody pitch sequence matches JFugue: ${name}`, () => {
    const model = parse(srcOf(name));
    const ours = readSMF(writeSMF(buildSequence(model)))
      .notes.filter(n => n.channel === 0)
      .sort((a, b) => a.startTicks - b.startTicks)
      .map(n => n.pitch);

    // The subsequence match alone cannot catch note omission: tie the decoded
    // melody length to the model's non-rest note count.
    const expectedNoteCount = model.events.filter(e => e.type === 'note' && !e.rest).length;
    assert.equal(ours.length, expectedNoteCount,
      `melody note count ${ours.length} != model non-rest ${expectedNoteCount}`);

    // JFugue melody voice: the lowest channel present (we only render V0 here).
    const jf = readSMF(midOf(name));
    const jfMelodyCh = Math.min(...jf.notes.map(n => n.channel));
    const jfPitches = jf.notes.filter(n => n.channel === jfMelodyCh)
      .sort((a, b) => a.startTicks - b.startTicks)
      .map(n => n.pitch);

    // In-order subsequence match: JFugue's extra notes are the pitched rests.
    let i = 0;
    for (const p of jfPitches) { if (i < ours.length && p === ours[i]) i++; }
    assert.ok(ours.length > 0, 'our melody decoded no notes');
    assert.equal(i, ours.length,
      `only matched ${i}/${ours.length} melody pitches against ${jfPitches.length} JFugue notes`);
  });
}
