// Legacy share links: gamaka curves keyed by note INDEX, written before the notation
// could carry an ornament inline.
//
// Separate from core/share.js on purpose. That module is shape-detection and compression
// and is imported by every page; this one parses notation and re-serialises it, and only
// the host that edits notation needs it.
//
// The conversion happens ONCE, on the way in: the curves become inline `{gamaka:…}` in
// the notation, which is the only thing this app stores. A reader who opens an eight-year
// -old link and saves it has a file in today's format, without being told anything.
import { parse } from './parser.js';
import { buildRollModel } from './roll-model.js';
import { applyEdit } from './note-edit.js';

export function inlineLegacyCurves(srgm, curves) {
  if (!curves || typeof curves !== 'object') return srgm;
  let model;
  try { model = buildRollModel(parse(srgm)); } catch { return srgm; }
  const changed = new Set();
  for (const k of Object.keys(curves)) {
    const i = Number(k), n = model.notes[i];
    const c = curves[k];
    if (!n || !Array.isArray(c) || !c.length) continue;      // an index the piece no longer has
    n.curve = c.map((p) => [p[0], p[1]]);
    changed.add(n.tok);
  }
  if (!changed.size) return srgm;
  // applyEdit reads the notes it is re-emitting from a map keyed by TOKEN — the notation
  // is walked token by token, and an index into an array is not something a walk can look
  // a note up by.
  const byTok = new Map(model.notes.map((x) => [x.tok, { step: x.step, dur: x.dur, octave: x.octave, curve: x.curve }]));
  try { return applyEdit(srgm, { model: byTok, changed }); } catch { return srgm; }
}
