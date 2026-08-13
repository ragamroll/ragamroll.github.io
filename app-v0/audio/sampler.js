// Sampled instruments: a real violin or flute in place of a synthesised voice.
//
// Raw Web Audio, not Tone.Sampler, and for one reason: a GAMAKA IS A PITCH CURVE. The
// melody voice has to bend continuously through it, which the synth does by ramping an
// oscillator's frequency — and a sampler triggers a note at a fixed pitch. A buffer's
// playbackRate is the only thing here that bends, so a note is one AudioBufferSourceNode
// with its rate automated along the same curve the oscillator would have followed.
//
// Bending by rate shifts duration and formants with the pitch, which is what any detuned
// sampler does. Keeping the ratio near 1 is what keeps it honest, so a set carries several
// notes and each note picks the NEAREST — a gamaka's excursion is a few shrutis, and the
// nearest sample is usually within a tone.
//
// The samples are not ours and are not hosted here: they come from
// nbrosowsky/tonejs-instruments (MIT) over a CDN. So a voice must survive not having
// them — offline, a blocked CDN, a slow first note — and it does: every note falls back
// to the synth voice the caller hands it, per note, silently. A missing sample costs the
// timbre, never the sound.
const CDN = 'https://cdn.jsdelivr.net/gh/nbrosowsky/tonejs-instruments@master/samples/';

// What each set actually has. Checked against the repo rather than assumed: a name that
// 404s is a note that falls back forever, quietly, and would look like a bad sample.
// A set is fetched WHOLE when it is picked, so its size is a wait a reader sits through:
// violin is ~340KB a sample, harmonium ~215KB, guitar ~100KB. Enough notes that the
// nearest is within a few semitones — a wider stretch drags the formants with the pitch
// and a reed or a bowed string starts to sound like a tape running slow — and no more.
export const SAMPLE_SETS = {
  violin: { label: 'Violin', dir: 'violin', notes: ['A3', 'C4', 'E4', 'G4', 'A4', 'C5', 'A5', 'C6'] },
  flute: { label: 'Flute', dir: 'flute', notes: ['C4', 'E4', 'A4', 'C5', 'A5', 'C6'] },
  // The cheapest samples of the three, so it can afford the closest spacing.
  guitar: { label: 'Guitar', dir: 'guitar-electric', notes: ['A2', 'C3', 'Ds3', 'Fs3', 'A3', 'C4', 'Ds4', 'Fs4', 'A4', 'C5'] },
  // A sustained reed, where a stretched sample is most audible — but also the heaviest
  // after violin, so it takes the octave in four rather than in three.
  harmonium: { label: 'Harmonium', dir: 'harmonium', notes: ['A2', 'C3', 'Ds3', 'A3', 'C4', 'Ds4', 'A4', 'C5'] },
};

export const isSampled = (name) => Object.prototype.hasOwnProperty.call(SAMPLE_SETS, name);

// 'A4' / 'Cs4' -> Hz. Sharps are 's' in this repo's filenames; flats do not appear.
const SEMI = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
export function noteHz(name) {
  const m = /^([A-G])(s?)(-?\d)$/.exec(name);
  if (!m) return NaN;
  const midi = 12 * (parseInt(m[3], 10) + 1) + SEMI[m[1]] + (m[2] ? 1 : 0);
  return 440 * Math.pow(2, (midi - 69) / 12);
}

// One decode per URL per session, shared by every voice: a set is a few hundred KB and
// re-decoding it on each load() would stall the first note of every playback.
const cache = new Map();
function loadBuffer(ctx, url) {
  if (!cache.has(url)) {
    cache.set(url, fetch(url)
      .then((r) => { if (!r.ok) throw new Error(String(r.status)); return r.arrayBuffer(); })
      .then((b) => new Promise((res, rej) => ctx.decodeAudioData(b, res, rej)))
      .catch((e) => { cache.delete(url); throw e; }));   // a failure is not memoized: the next play retries
  }
  return cache.get(url);
}

/**
 * Fetch a set's samples ahead of being asked to play them.
 *
 * The voice is built when a sequence is LOADED, which is when Play is pressed — so without
 * this the first seconds of the first playback are the fallback synth while the buffers
 * are still arriving over the network. Picking the instrument is the moment a reader has
 * declared an interest, and there is usually a while between that and pressing Play.
 */
export function warmSamples(ctx, setName) {
  const set = SAMPLE_SETS[setName];
  if (!set || !ctx) return Promise.resolve();
  return Promise.all(set.notes.map((n) => loadBuffer(ctx, `${CDN}${set.dir}/${n}.mp3`).catch(() => {})));
}

/**
 * A sampled melody voice.
 *
 * @param ctx     the raw AudioContext
 * @param setName a key of SAMPLE_SETS
 * @param dest    an AudioNode to play into
 * @param fallback { attack(freq,time,vel), curve(points,time,dur,vel), release(time) } —
 *                the synth voice used for any note whose sample is not (yet) here
 */
export function createSampledVoice(ctx, setName, dest, fallback) {
  const set = SAMPLE_SETS[setName];
  const notes = (set ? set.notes : []).map((n) => ({ name: n, hz: noteHz(n), buf: null }));
  let live = [];          // sources still sounding, so dispose() can stop them

  const load = () => Promise.all(notes.map((n) => loadBuffer(ctx, `${CDN}${set.dir}/${n.name}.mp3`)
    .then((buf) => { n.buf = buf; })
    .catch(() => { /* this note stays unsampled; the voice still works */ })));

  // The nearest sample by RATIO, not by distance in Hz: an octave is the same stretch
  // whichever end of the keyboard it is at, and a semitone at the bottom is a few Hz.
  const nearest = (hz) => {
    let best = null, bd = Infinity;
    for (const n of notes) {
      if (!n.buf) continue;
      const d = Math.abs(Math.log2(hz / n.hz));
      if (d < bd) { bd = d; best = n; }
    }
    return best;
  };

  // One note: a source whose playbackRate follows the pitch, and a gain that opens and
  // closes around it so nothing clicks.
  function sound(points, time, durSec, vel) {
    const first = points[0];
    const n = nearest(first);
    if (!n) return false;                       // nothing loaded yet: the caller falls back
    const src = ctx.createBufferSource();
    src.buffer = n.buf;
    const g = ctx.createGain();
    src.connect(g); g.connect(dest);

    const rate = (hz) => hz / n.hz;
    src.playbackRate.setValueAtTime(rate(first), time);
    for (let k = 1; k < points.length; k++) {
      src.playbackRate.linearRampToValueAtTime(rate(points[k]), time + (durSec * k) / (points.length - 1));
    }

    const A = 0.012, R = Math.min(0.12, durSec * 0.4);
    g.gain.setValueAtTime(0, time);
    g.gain.linearRampToValueAtTime(vel, time + A);
    g.gain.setValueAtTime(vel, Math.max(time + A, time + durSec - R));
    g.gain.linearRampToValueAtTime(0, time + durSec);

    // The sample is longer than the note, so the source is told when to stop; without
    // this a short note plays the whole recording under everything that follows it.
    src.start(time);
    src.stop(time + durSec + 0.02);
    live.push(src);
    src.onended = () => { live = live.filter((s) => s !== src); try { src.disconnect(); g.disconnect(); } catch (_) { /* torn down */ } };
    return true;
  }

  return {
    load,
    /** True once at least one note of the set is playable. */
    ready: () => notes.some((n) => n.buf),
    note(freq, time, durSec, vel) {
      if (!sound([freq, freq], time, durSec, vel)) fallback.plain(freq, time, durSec, vel);
    },
    curve(points, time, durSec, vel) {
      if (!sound(points, time, durSec, vel)) fallback.curve(points, time, durSec, vel);
    },
    dispose() {
      for (const s of live) { try { s.stop(); } catch (_) { /* already ended */ } }
      live = [];
    },
  };
}
