import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parse } from '../core/parser.js';
import { goldenJSON, INPUTS } from './_golden.js';

// --- golden model equality, per input ---
for (const name of INPUTS) {
  test(`model matches golden: ${name}`, async () => {
    const { readFileSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    const { dirname, join } = await import('node:path');
    const HERE = dirname(fileURLToPath(import.meta.url));
    const src = readFileSync(join(HERE, '..', 'examples', `${name}.srgm`), 'utf8');
    const { events } = parse(src);
    assert.deepEqual(events, goldenJSON(name, 'model.json'));
  });
  test(`seqProps match golden: ${name}`, async () => {
    const { readFileSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    const { dirname, join } = await import('node:path');
    const HERE = dirname(fileURLToPath(import.meta.url));
    const src = readFileSync(join(HERE, '..', 'examples', `${name}.srgm`), 'utf8');
    const { seqProps } = parse(src);
    assert.deepEqual(seqProps, goldenJSON(name, 'seqprops.json'));
  });
}

// --- edge-case unit tests (negative + boundary) ---
test('empty input -> no note events, no crash', () => {
  const { events, seqProps } = parse('');
  assert.equal(events.filter(e => e.type === 'note').length, 0);
});
test('comment-only lines are ignored', () => {
  const notes = parse('% just a comment\n% another').events.filter(e => e.type === 'note');
  assert.equal(notes.length, 0);
});
test('octave shift persists to following notes', () => {
  // default raga c12, O unset -> octave 0; > raises by one for that note onward
  const ev = parse('Raga=c12,0 O=5 S >S S').events.filter(e => e.type === 'note');
  assert.equal(ev[0].octave, 5);
  assert.equal(ev[1].octave, 6);
  assert.equal(ev[2].octave, 6);   // shift persists, does not reset
});
test('trailing integer is note length; default is 1', () => {
  const ev = parse('Raga=c12,0 O=5 S4 R').events.filter(e => e.type === 'note');
  assert.equal(ev[0].relLen, 4);
  assert.equal(ev[1].relLen, 1);
});
test('unknown token is a diagnostic and is not a note', () => {
  const r = parse('Raga=c12,0 O=5 Q9 S');
  assert.ok(r.diagnostics.some(d => d.token === 'Q9'));
  assert.equal(r.events.filter(e => e.type === 'note').length, 1);
});
test('lone ">" does not shift octave (no swara -> diagnostic)', () => {
  // faithful quirk: ">" alone fails the swara regex; it is ignored (diagnostic)
  const ev = parse('Raga=c12,0 O=5 S > S').events.filter(e => e.type === 'note');
  assert.equal(ev[0].octave, 5);
  assert.equal(ev[1].octave, 5);   // NOT 6 — the ">" was ignored for octave
});
test('separator "-" is a separator event, not a note', () => {
  const ev = parse('Raga=c12,0 O=5 S - R').events;
  assert.ok(ev.some(e => e.type === 'separator'));
  assert.equal(ev.filter(e => e.type === 'note').length, 2);
});

// --- bare/malformed directive tokens (Groovy String.split trailing-empty-drop semantics) ---
// Groovy's "Tala=".split('=') has size 1 (trailing empty dropped) so it never
// matches the splt.size()==2 directive check; it falls through to the
// passthrough branch (now: a diagnostic). JS split() keeps the trailing empty
// (size 2), which used to wrongly enter the directive branch and throw /
// corrupt state.
test('bare "Tala=" does not throw and does not produce a malformed tala event', () => {
  const { events, diagnostics } = parse('Raga=c12,0 O=5 Tala= S');
  assert.ok(diagnostics.some(d => d.token === 'Tala='),
    'bare Tala= must surface as a diagnostic, not be consumed as a directive');
  const notes = events.filter(e => e.type === 'note');
  assert.equal(notes.length, 1);
  assert.equal(notes[0].swara, 'S');
  const talaEvents = events.filter(e => e.type === 'tala');
  assert.equal(talaEvents.length, 1, 'only the default tala event should exist — no malformed extra tala event');
  assert.ok(Number.isFinite(talaEvents[0].props.measure), 'the sole tala event must have a defined, finite measure, not NaN/undefined');
});
test('bare "Raga=" does not throw and does not corrupt raga/note resolution', () => {
  const { events, diagnostics } = parse('Raga= S');
  assert.ok(diagnostics.some(d => d.token === 'Raga='),
    'bare Raga= must surface as a diagnostic, not be consumed as a directive');
  const notes = events.filter(e => e.type === 'note');
  assert.equal(notes.length, 1);
  assert.equal(notes[0].swara, 'S');
  assert.ok(Number.isFinite(notes[0].midi), 'note S must still resolve via the untouched default c12 raga, not a corrupted key');
});
test('bare "L=" does not throw and does not alter the default length modifier', () => {
  const { events, diagnostics } = parse('L= S');
  assert.ok(diagnostics.some(d => d.token === 'L='),
    'bare L= must surface as a diagnostic, not be silently dropped');
  const notes = events.filter(e => e.type === 'note');
  assert.equal(notes.length, 1);
  assert.equal(notes[0].absLen, 1, 'default length mod (1) must be unchanged by the bare L= token');
});
test('real note at default octave 0 is not a rest (JFugue oct0=oct5)', () => {
  const ev = parse('Raga=c12,0 S R G').events.filter(e => e.type === 'note');
  assert.equal(ev[0].swara, 'S');
  assert.equal(ev[0].midi, 60);   // C5, not 0 — would have rendered as a rest before the fix
  assert.ok(ev[0].midi > 0);
});

// --- meta (tempo/instrument), diagnostics, rest flag, indented comments ---
test('T<n> becomes meta.tempo, not a diagnostic or event', () => {
  const r = parse('Raga=c12,0 O=5 T160 S');
  assert.equal(r.meta.tempo, 160);
  assert.equal(r.diagnostics.length, 0);
  assert.ok(!r.events.some(e => e.type === 'jfugue'));
});
test('I[NAME] becomes meta.instrument', () => {
  const r = parse('Raga=c12,0 O=5 I[ALTO_SAX] S');
  assert.equal(r.meta.instrument, 'ALTO_SAX');
  assert.equal(r.diagnostics.length, 0);
});
test('indented % comment is stripped (no diagnostic, no note)', () => {
  const r = parse('Raga=c12,0 O=5\n   % a comment line\nS');
  assert.equal(r.diagnostics.length, 0);
  assert.equal(r.events.filter(e => e.type === 'note').length, 1);
});
test('garbage token emits exactly one diagnostic and no event', () => {
  const r = parse('Raga=c12,0 O=5 V0 S');
  assert.equal(r.diagnostics.length, 1);
  assert.equal(r.diagnostics[0].token, 'V0');
  assert.ok(!r.events.some(e => e.type === 'jfugue'));
});
test('unknown key=val is a diagnostic (was silent jfugue)', () => {
  const r = parse('Raga=c12,0 O=5 Foo=bar S');
  assert.equal(r.diagnostics.length, 1);
  assert.equal(r.diagnostics[0].token, 'Foo=bar');
});
test('rest notes are flagged rest:true; real notes are not', () => {
  const ev = parse('Raga=c12,0 O=5 S z2').events.filter(e => e.type === 'note');
  assert.equal(ev[0].rest, undefined);
  assert.equal(ev[1].rest, true);
});
test('unknown GM instrument emits a diagnostic (defaults to piano)', () => {
  const r = parse('Raga=c12,0 O=5 I[TRUMPET] S');
  assert.equal(r.diagnostics.length, 1);
  assert.equal(r.diagnostics[0].token, 'I[TRUMPET]');
  assert.equal(r.meta.instrument, 'TRUMPET');   // still recorded; builder defaults it
});
test('known GM instrument emits no diagnostic', () => {
  const r = parse('Raga=c12,0 O=5 I[ALTO_SAX] S');
  assert.equal(r.diagnostics.length, 0);
  assert.equal(r.meta.instrument, 'ALTO_SAX');
});
test('unknown tala name does not throw; diagnostic + adi fallback', () => {
  const r = parse('Raga=c12,0 O=5 Tala=zzz,4 S');
  assert.equal(r.diagnostics.length, 1);
  assert.ok(r.diagnostics[0].message.includes('unknown tala'));
  const talas = r.events.filter(e => e.type === 'tala');
  assert.equal(talas.length, 2);                 // default + the fallback one
  assert.ok(talas[1].props.measure > 0, 'fallback tala event must have a valid measure');
});
test('out-of-raga swara resolves to a rest and is flagged', () => {
  // m is not in hamsadhwani -> resolves to Z (rest)
  const ev = parse('Raga=hamsadhwani,4 O=5 m').events.filter(e => e.type === 'note');
  assert.equal(ev[0].rest, true);
});

// --- shipped examples must be diagnostic-clean ---
for (const name of INPUTS) {
  test(`${name}: zero diagnostics`, () => {
    const HERE = dirname(fileURLToPath(import.meta.url));
    const src = readFileSync(join(HERE, '..', 'examples', `${name}.srgm`), 'utf8');
    assert.deepEqual(parse(src).diagnostics, []);
  });
}
