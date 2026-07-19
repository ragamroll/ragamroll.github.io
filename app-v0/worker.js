// Compilation worker: parse + the heavy ascii renderers run OFF the main thread
// so a large or pathological composition can never block the UI. Posts back the
// parsed model (the main thread needs it for playback / MIDI export) plus the
// notation and roll strings.
//
// A module worker (new Worker(url, {type:'module'})) so it can import the same
// ESM modules the app uses — no build step, no duplication.
import { parse } from './core/parser.js';
import { seqToLine } from './core/renderers/notation.js';
import { seqToRoll } from './core/renderers/roll.js';
import { setRagas } from './core/raga-base.js';

// The worker has its own module instances, so it must load the raga data itself
// (the main thread's setRagas doesn't reach here). Queue any messages that
// arrive before the data is ready, then drain them.
let ready = false;
const pending = [];

fetch('./core/raga-base.json')
  .then((r) => r.json())
  .then((data) => {
    setRagas(data);
    ready = true;
    for (const msg of pending) handle(msg);
    pending.length = 0;
  })
  .catch(() => { ready = true; });   // still answer (parse tolerates a missing raga base for c12-less input)

self.onmessage = (e) => { if (ready) handle(e.data); else pending.push(e.data); };

function handle({ id, text }) {
  let model;
  try { model = parse(text); }
  catch { model = { events: [], seqProps: {}, meta: {}, diagnostics: [] }; }
  let notation = '';
  let roll = '';
  try { notation = seqToLine(model.events, 1, 3, true); } catch { /* keep '' */ }
  try { roll = seqToRoll(model.events, model.seqProps); } catch { /* keep '' */ }
  self.postMessage({ id, model, notation, roll });
}
