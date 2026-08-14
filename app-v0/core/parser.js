import { noteToMidi } from './tuning.js';
import { swaraMap, resolveRagaName } from './raga-base.js';
import { GM } from './midi/gm.js';
import { parseAttrs, curveOf, blockEnd } from './gamaka-inline.js';

/**
 * The version of the notation this app WRITES. Files without a V= are version 1: the era
 * when a note's curve was written under `gamaka` rather than `gcurve`.
 */
export const NOTATION_VERSION = 2;

// Split into whitespace-delimited tokens, but keep a note's trailing {…} block
// attached (brace-balanced; whitespace/newlines inside preserved) as one token.
function tokenizeSrgm(s) {
  const toks = [];
  const isWs = (c) => c === ' ' || c === '\t' || c === '\n' || c === '\r' || c === '\f' || c === '\v';
  let i = 0;
  while (i < s.length) {
    if (isWs(s[i])) { i++; continue; }
    let j = i;
    while (j < s.length && !isWs(s[j]) && s[j] !== '{') j++;
    if (s[j] !== '{') { toks.push(s.slice(i, j)); i = j; continue; }
    const k = blockEnd(s, j);   // quote-aware: a value may carry braces of its own
    toks.push(s.slice(i, k));   // note + {…} (or to end if unbalanced)
    i = k;
  }
  return toks;
}

// Peel a "NOTE{…}" token; requires a brace-balanced, correctly-closed block.
const NOTE_ATTR_RE = /^((?:>*|<*)[sSrRgGmMpPdDnNzZ]\d*)\{([\s\S]*)\}$/;

// tala_map: name -> [beatsPerCycleUnit, [accentedAngaStarts...]]  (verbatim)
export const TALA_MAP = {
  'dhruva':      [14, [1, 5, 7, 11]],
  'matya':       [10, [1, 5, 7]],
  'rupaka':      [6,  [1, 3]],
  'rupaka3':     [5,  [1, 3]],
  'jhampa':      [10, [1, 8, 9]],
  'triputa':     [7,  [1, 4, 6]],
  'ata':         [14, [1, 6, 11, 13]],
  'eka':         [4,  [1]],
  'adi':         [8,  [1, 5, 7]],
  'khandachapu': [10, [1]],
  'misrachapu':  [14, [1]],
};

const SWARA_RE = /^(>*|<*)([sSrRgGmMpPdDnNzZ])(\d*)$/;
const T_RE = /^T(\d+)$/;
const I_RE = /^I\[([^\]]+)\]$/;

// Integer.decode equivalent: handles "0x..", "0..", leading "-", plain decimal.
function decodeInt(s) {
  if (s == null) return NaN;
  const n = Number(s);                      // Number() parses 0x.. and decimals
  return Number.isNaN(n) ? NaN : Math.trunc(n);
}

// A piece with no tala: alapana, and the arohana/avarohana and signature phrases
// the detector notates, which are sung free of any cycle. measure 0 is already the
// "no cycle" case everywhere downstream — buildTalaTrack emits no track, draw draws
// no tala grid and schedules no accent strums — so naming it is all that was
// missing. `alapana` is the same thing under the name a musician would use.
export const NO_TALA = new Set(['none', 'nil', 'alapana']);

// tala_elem(v) where v = [name, beat]
function talaElem(v) {
  const name = (v && v[0] != null) ? v[0] : 'adi';
  if (NO_TALA.has(String(name).toLowerCase())) return { tala: [0, []], beat: 0, measure: 0, accents: [] };
  const tala = TALA_MAP[name] ?? TALA_MAP['adi'];   // unknown tala -> adi (no crash)
  let beat;
  const b = decodeInt(v && v[1]);
  beat = Number.isNaN(b) ? 4 : b;
  if (!(beat > 0)) beat = 4;                 // non-positive beat -> measure 0 -> infinite layout; fall back to 4
  const measure = tala[0] * beat;
  const accents = tala[1].map(it => (it - 1) * beat + 1);
  return { tala, beat, measure, accents };
}

export function parse(input) {
  // --- state (reset every call: fresh-instance semantics) ---
  let curOctave = 0;
  let curLengthMod = 1;
  let ragaKeyTuple = ['c12', '0'];
  let curSrgAbcMap = swaraMap('c12');
  let curRagaSwaras = new Set(Object.keys(curSrgAbcMap));

  const events = [];
  const meta = { tempo: null, instrument: null, version: 1 };
  const diagnostics = [];
  events.push({ type: 'raga', key: ragaKeyTuple });
  events.push({ type: 'tala', props: talaElem(['adi', '4']) });

  // strip comment lines (lines whose first non-blank char is %) -> single space
  const inStr = input.split('\n').map(s => s.trimStart().startsWith('%') ? ' ' : s).join(' ');

  const octshift = (marks) => {
    for (const ch of marks) {
      if (ch === '>') curOctave++;
      else if (ch === '<') curOctave--;
    }
  };

  // note event: keep ORIGINAL swara letter for display; resolve for midi
  const noteEvent = (swara, octave, relLen) => {
    let s = swara;
    if (curRagaSwaras.has(s)) { /* as-is */ }
    else if (curRagaSwaras.has(s.toUpperCase())) s = s.toUpperCase();
    else if (curRagaSwaras.has(s.toLowerCase())) s = s.toLowerCase();
    else s = 'Z';
    let semis = decodeInt(ragaKeyTuple[1]);
    if (Number.isNaN(semis)) semis = 0;     // missing key -> no transpose
    const isRest = (s === 'Z' || s === 'z');
    let midi;
    if (isRest) {
      // Groovy jfm_element builds the JFugue pattern for a rest as " R "
      // with NO octave suffix (unlike real notes, which get
      // cur_srg_abc_map[swara] + octave appended). JFugue's parser fills
      // in its default octave (5) for the missing octave, and the raga's
      // IntervalPatternTransformer(semitones_above_C) still shifts that
      // resolved value — so a rest's "midi" is always computed at a fixed
      // octave 5 / pitch class 0, ignoring curOctave entirely. Cosmetically
      // odd, but this is the faithful (golden-verified) Groovy behavior.
      midi = noteToMidi('C', 5, semis);
    } else {
      const noteName = curSrgAbcMap[s];
      midi = noteToMidi(noteName, octave, semis);
    }
    const ev = { type: 'note', swara, octave, relLen, midi, absLen: curLengthMod * relLen };
    if (isRest) ev.rest = true;
    return ev;
  };

  let tokenIndex = -1;
  for (const token of tokenizeSrgm(inStr)) {
    tokenIndex++;

    // A note with a trailing {…} attribute block (inline gamaka / sahitya).
    if (token.includes('{')) {
      const am = NOTE_ATTR_RE.exec(token);
      const head = am ? am[1] : token.slice(0, token.indexOf('{'));
      const hm = SWARA_RE.exec(head);
      if (!hm) { diagnostics.push({ token, index: tokenIndex, message: `unrecognized token "${token}" — ignored` }); continue; }
      let attrs = null;
      if (am) { try { attrs = parseAttrs(am[2]); } catch { attrs = null; } }
      octshift(hm[1]);
      const rl = /^\d+$/.test(hm[3]) ? parseInt(hm[3], 10) : 1;
      const ev = noteEvent(hm[2], curOctave, rl);
      if (!attrs) {
        diagnostics.push({ token, index: tokenIndex, message: `malformed attributes on "${token}" — playing the plain note` });
      } else {
        const cv = curveOf(attrs);      // `gcurve`, or `gamaka` from before it was renamed
        if (cv) ev.gamaka = cv;
        if (typeof attrs.sahitya === 'string') ev.sahitya = attrs.sahitya;
        // Provenance: the fragment of ANOTHER notation system that produced this note,
        // written by whatever converted it. Nothing here reads it as music — not the
        // audio, not the MIDI, not the roll's geometry — it exists to be shown beside
        // the note it came from, so a conversion can be checked by eye.
        if (typeof attrs.gka === 'string') ev.gka = attrs.gka;
      }
      events.push(ev);
      continue;
    }

    const m = SWARA_RE.exec(token);
    if (m) {
      octshift(m[1]);                        // mutate octave BEFORE emitting
      const relLen = /^\d+$/.test(m[3]) ? parseInt(m[3], 10) : 1;
      events.push(noteEvent(m[2], curOctave, relLen));
      continue;
    }

    let tm;
    if ((tm = T_RE.exec(token))) { meta.tempo = parseInt(tm[1], 10); continue; }
    if ((tm = I_RE.exec(token))) {
      meta.instrument = tm[1];
      if (!Object.prototype.hasOwnProperty.call(GM, tm[1]))
        diagnostics.push({ token, index: tokenIndex, message: `unknown instrument "${tm[1]}" — defaulting to piano` });
      continue;
    }

    const eq = token.split('=');
    while (eq.length && eq[eq.length - 1] === '') eq.pop();  // Java/Groovy split drops trailing empties
    if (eq.length === 2) {
      const val = eq[1];
      switch (eq[0]) {
        case 'L': case 'l': {
          const f = Number(val);
          if (!Number.isNaN(f) && f > 0) curLengthMod = f;
          break;
        }
        // V= — which version of THIS NOTATION the file is written in. Absent means 1, the
        // era when a note's curve was written under `gamaka`; 2 is `gcurve`, which is what
        // anything written from now on says. A version is not a gate: the reader accepts
        // both keys whatever the file claims, because a hand-typed file may say either and
        // neither is wrong. It is a stamp — so a LATER change with two possible readings
        // (the deferred one to how >/< octave marks scope) can be told apart from a file
        // written before it.
        case 'V': case 'v': {
          const vv = decodeInt(val);
          if (Number.isNaN(vv) || vv < 1) {
            diagnostics.push({ token, index: tokenIndex, message: `notation version "${val}" is not a number — reading this as version 1` });
            break;
          }
          meta.version = vv;
          // A file from the future is read as best we can rather than refused: every
          // version so far has been a superset, and refusing would lose a piece over a
          // number. The diagnostic is what says the reading may be incomplete.
          if (vv > NOTATION_VERSION) {
            diagnostics.push({ token, index: tokenIndex, message: `notation version ${vv} is newer than this app understands (${NOTATION_VERSION}) — reading it anyway` });
          }
          break;
        }
        case 'O': case 'o': {
          if (/^-?\d+$/.test(val)) curOctave = Number(val);
          break;
        }
        case 'Raga': case 'raga': {
          ragaKeyTuple = val.split(',');
          // Case only. A raga written under a folded-away spelling still resolves
          // to its scale (swaraMap follows aliases), but the model keeps the name
          // the notation actually used — rewriting it here would edit the piece.
          ragaKeyTuple[0] = resolveRagaName(ragaKeyTuple[0], { aliases: false });
          events.push({ type: 'raga', key: ragaKeyTuple });
          try {
            curSrgAbcMap = swaraMap(ragaKeyTuple[0]);
            curRagaSwaras = new Set(Object.keys(curSrgAbcMap));
          } catch (_) { /* unknown raga: keep previous map (Groovy would NPE; we tolerate) */ }
          break;
        }
        case 'Tala': case 'tala': {
          const parts = val.split(',');
          // `none` is a declaration, not a misspelling — no diagnostic, no fallback
          // to adi, and no beat to validate.
          if (NO_TALA.has(String(parts[0]).toLowerCase())) {
            events.push({ type: 'tala', props: talaElem(['none']) });
            break;
          }
          if (!Object.prototype.hasOwnProperty.call(TALA_MAP, parts[0])) {
            const lower = String(parts[0]).toLowerCase();     // case-insensitive tala name
            if (Object.prototype.hasOwnProperty.call(TALA_MAP, lower)) {
              parts[0] = lower;
            } else {
              diagnostics.push({ token, index: tokenIndex, message: `unknown tala "${parts[0]}" — using adi` });
              parts[0] = 'adi';
            }
          }
          const bv = decodeInt(parts[1]);
          if (parts.length > 1 && !Number.isNaN(bv) && bv <= 0)
            diagnostics.push({ token, index: tokenIndex, message: `tala beat must be positive — "${parts[1]}" ignored, using 4` });
          events.push({ type: 'tala', props: talaElem(parts) });
          break;
        }
        default:
          diagnostics.push({ token, index: tokenIndex, message: `unrecognized directive "${token}" — ignored` });
      }
    } else if (token === '-') {
      events.push({ type: 'separator' });
    } else {
      diagnostics.push({ token, index: tokenIndex, message: `unrecognized token "${token}" — ignored` });
    }
  }

  return { events, seqProps: getSeqProps(events), meta, diagnostics };
}

// get_seq_props: lowest non-rest midi, highest midi, total note length
function getSeqProps(events) {
  const midiNotes = [];
  const noteLengths = [];
  for (const v of events) {
    if (v.type === 'note') { midiNotes.push(v.midi); noteLengths.push(v.absLen); }
  }
  let lowest = Math.min(...midiNotes);
  if (!(lowest > 0)) {
    // smallest distinct non-zero: sort ascending, unique, take index 1
    const uniq = [...new Set(midiNotes)].sort((a, b) => a - b);
    lowest = uniq[1];
  }
  const highest = Math.max(...midiNotes);
  const seq_len = noteLengths.reduce((a, b) => a + b, 0);
  return { lowest_midi_note: lowest, highest_midi_note: highest, seq_len };
}
