import * as Tone from '../../vendor/tone.js';
import { midiToFreq } from '../schedule.js';
import { outputDelay } from '../backend.js';
import { SYNTH_VOICES, STRING_PARAMS, STRING_DEFAULTS } from '../voices.js';

// The ONLY module that references Tone.js. Encapsulates all Tone version specifics.
// v14: Tone.Transport is the global transport. If a future vendored bundle exposes
// only getTransport()/getContext(), swap the helper below — nothing else changes.
// NOTE: Tone.Transport is a GLOBAL singleton — only one player instance is
// supported; a second createPlayer() would clobber the first one's schedules.
const transport = () => (Tone.Transport ?? Tone.getTransport());
const destination = () => (Tone.Destination ?? Tone.getDestination());
const rawCtx = () => { const c = Tone.getContext && Tone.getContext(); return c && c.rawContext; };

// Volume-fraction (0..1) -> Tone dB. 0 -> silence. Linear-log; used for master.
const gainDb = (v) => (v > 0 ? 20 * Math.log10(v) : -Infinity);
// Tala/drone taper: square the slider so the softer band spans more of the
// travel — the old low end now sits around mid-slider (~-12 dB at 0.5).
const trackDb = (v) => gainDb(v * v);
// Tala sits a further -8 dB under the taper (it should stay under the melody).
const talaDb = (v) => trackDb(v) - 8;
// Drone variant: extra headroom since its three S/P/>S voices sum.
const droneDb = (v) => trackDb(v) - 14;

// A PLUCKED string, without a sample. Karplus-Strong: a burst of pink noise into a lowpass
// comb filter whose delay is one period long, so the noise circulates, loses its highs each
// pass and decays into a pitch. It is how a plucked string actually behaves, which is why
// it convinces at the attack in a way an oscillator with a fast envelope does not.
//
// Built from the parts rather than from Tone.PluckSynth, for the reason that matters here:
// a gamaka is a pitch curve, and PluckSynth exposes no frequency to ramp — its pitch lives
// in a comb filter it keeps to itself. Owning the filter means owning `delayTime`, which is
// the pitch, so this voice can bend.
//
// It bends by 1/f: the delay IS the period, so equal steps in pitch are not equal steps in
// delay and every point of the curve is inverted on its way in. Ramping the delay of a
// running comb filter is also the honest way to slide a string — it is what moving a finger
// along one does to its length.
// ---- the plucked strings ---------------------------------------------------------------
//
// ONE plucked voice, called Pluck. There were two for a while — a bright one and a darker
// one under an instrument's name — and they were not different enough to be worth a menu
// entry each. What is left is the darker of them: a heavy string over a big resonating box.
//
// It is NOT named after an instrument. A name like that is a claim the sound has to earn,
// and a synthesised string a player would recognise is a far higher bar than one that sounds
// good. The old name is still accepted from a saved preference; it is not offered.
//
// Every number here is a STARTING POINT, not a setting: the instrument panel edits them
// live, because which of them turns a clean string into something with a body in it is a
// question for an ear on a phrase, not for a value written down by whoever built it.
//
// There was a sitar here too, with a waveshaper for the jawari's buzz and a bank of comb
// filters for the tarab. It sounded like a bad phone line — the shaper broke up the note
// instead of colouring it — and a nonlinearity that has to be got exactly right to be
// anything but noise is not worth carrying on the chance of a later fix. Its machinery went
// with it rather than sitting unused: the drone-tracking the tarab needed is gone from the
// backend too.
//
// Karplus-Strong throughout: a burst of noise into a comb filter whose delay is one period
// long, so the noise circulates, loses its highs each pass and decays into a pitch. Built
// from the parts rather than from Tone.PluckSynth because a gamaka is a pitch curve, and
// PluckSynth keeps its pitch in a comb filter it does not share. Owning the filter means
// owning the delay, which IS the pitch, so these voices bend.
// THE PICK, once and for all: a fixed burst of noise, not a fresh random one per note.
//
// Karplus-Strong excites the string with noise, and Tone.Noise obliges with a different
// eight milliseconds every time. Measured, that made two identical strikes differ by two to
// three times in level — 54% spread across six notes with the room off and three seconds
// between them, so nothing was overlapping and nothing was decaying into anything. Every
// note of a phrase varied that much too; it was not a quirk of the audition.
//
// One buffer, generated from a fixed seed, played from its start each time. A real pluck
// does vary — but not by a factor of three, and not in a way a player cannot control. What
// is left is a string that answers the same way twice, which is the only thing an ear can
// judge a setting against.
let PICK_BUFFER = null;
function pickBuffer() {
  if (PICK_BUFFER) return PICK_BUFFER;
  const ctx = rawCtx();
  if (!ctx) return null;
  const n = Math.floor(ctx.sampleRate * 0.25);
  const buf = ctx.createBuffer(1, n, ctx.sampleRate);
  const d = buf.getChannelData(0);
  // A small LCG, so the burst is the same in every session and on every machine, and a
  // one-pole to pinken it: white noise into a string is brighter than any finger.
  let seed = 20260817, last = 0;
  for (let i = 0; i < n; i++) {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    const white = (seed / 0xffffffff) * 2 - 1;
    last = 0.85 * last + 0.15 * white;
    d[i] = last * 0.42;      // levelled against the other voices; the one-pole eats most of it
  }
  PICK_BUFFER = new Tone.ToneAudioBuffer(buf);
  return PICK_BUFFER;
}

function makeString(kind, over = {}) {
  // A LIVE object. Everything below reads P at the moment it is used rather than baking a
  // number into a node at build time, so a value the panel moves is in the next note — and
  // the ones that ARE node properties are written straight through by set().
  const P = { ...STRING_DEFAULTS, ...over };
  // A setting saved before Sustain was a time: it was a loop gain, and what it MEANT was a
  // decay, so it is converted rather than dropped on the floor.
  if (over.resonance != null && over.sustain == null) {
    P.sustain = Math.max(0.2, Math.min(9, -6.908 / (220 * Math.log(Math.min(0.9999, over.resonance)))));
  }
  if (over.tameDb != null && over.damping == null) P.damping = -over.tameDb;
  // THE LOOP GAIN, worked out per note from the decay time asked for.
  //
  // A comb filter's delay is one period, so a fixed gain decays in a fixed number of
  // PERIODS — which is a fixed number of seconds only at one pitch. Measured: the same
  // setting gave 1.22s at 110Hz and 0.31s at 440Hz, so the instrument changed character
  // across its own range and the slider meant something different in every octave.
  //
  // Solving g for a given time makes the decay the same everywhere, which is both what a
  // player expects and what makes a slider in seconds honest. Capped short of 1: a loop at
  // unity gain never stops.
  const gainFor = (freq) => Math.min(0.9995, Math.exp(-6.908 / (Math.max(20, freq) * P.sustain)));
  const out = new Tone.Volume(P.out).toDestination();
  // A LITTLE ROOM. A dry comb filter is a string in a vacuum, and nothing in the world
  // sounds like that. Very little: measured, a wet of .14 held a plucked note at 73% of its
  // attack a second in, which is not a pluck any more — a room that sustains will smear a
  // fast phrase into one chord.
  const room = new Tone.JCReverb({ roomSize: P.roomSize, wet: P.roomWet });
  room.connect(out);

  // THE BODY, and it does NOT follow the note. A box resonates where it resonates
  // whatever is played on it, and that fixed response — brightening some notes, darkening
  // others — is a large part of why an instrument sounds like an instrument rather than a
  // frequency. A bare string measures as almost nothing under 700Hz, which is what "thin"
  // means when you take it literally.
  const bodies = P.bodyHz.map((hz, i) => {
    const f = new Tone.Filter({ type: 'peaking', frequency: hz, Q: P.bodyQ[i] });
    f.gain.value = [P.body1, P.body2, P.body3][i];
    return f;
  });
  const tame = new Tone.Filter({ type: 'highshelf', frequency: P.tameHz });
  // Damping is how much the body ABSORBS, so more of it is less top. The panel says 0..24dB
  // of damping and this is where the sign lives — it used to be a shelf gain of -24..0,
  // which put "more damping" at the left end of a slider labelled Damping.
  tame.gain.value = -P.damping;
  for (let i = 0; i < bodies.length - 1; i++) bodies[i].connect(bodies[i + 1]);
  bodies[bodies.length - 1].connect(tame);
  tame.connect(room);
  // DRIVE, between the strings and the body. Soft CLIPPING, not a shaping curve of its own:
  // a Chebyshev on a decaying string broke the note into bursts as its level crossed the
  // curve, which is what killed the sitar. Clipping is what a loud string does to the air
  // around it, and a little of it is what "thick" means.
  // With MAKEUP GAIN, because clipping is mostly a loudness control otherwise: measured,
  // turning drive up took the note from .11 to .48 and moved its centroid by fifty hertz —
  // so the ear hears "louder", calls it better, and the actual change goes unheard. Taken
  // back out, what is left is the shape of the clipping, which is the thing being judged.
  const drive = new Tone.Distortion({ distortion: P.drive, oversample: '2x' });
  const makeup = new Tone.Gain(1);
  const setDrive = (x) => {
    drive.distortion = x;
    drive.wet.value = x > 0 ? 1 : 0;
    makeup.gain.value = 1 / (1 + 3.2 * x);
  };
  setDrive(P.drive);
  drive.connect(makeup); makeup.connect(bodies[0]);
  const bodyIn = drive;

  // TWO STRINGS, a few cents apart and panned apart. Plucked instruments string their
  // courses in pairs, and the slow beating between them is most of what "full" means for a
  // plucked note: one string is one string however it is filtered.
  const strings = [-0.3, 0.3].map((pan, i) => {
    const p = new Tone.Panner(pan);
    p.connect(bodyIn);
    const comb = new Tone.LowpassCombFilter({ dampening: P.dampening, resonance: gainFor(220) });
    comb.connect(p);
    // The pick, band-limited and following the note: full-spectrum noise into the loop is
    // hiss the string never had, since a string cannot carry what it cannot hold.
    const pick = new Tone.Filter({ type: 'lowpass', frequency: 2000, Q: 0.3 });
    pick.connect(comb);
    // The burst's level, set per note. One node rather than one per strike: the melody is
    // monophonic and the audition is sequential, so nothing overlaps here.
    const pickGain = new Tone.Gain(1);
    pickGain.connect(pick);
    return { comb, pick, pickGain, panner: p, i, sources: [] };
  });

  // Short, because the melody is monophonic and these voices ring: at T333 the next note is
  // a quarter of a second away, and a string still sounding into it is a chord nobody wrote.
  const REST = 0.15;
  const pluck = (freq, time, vel) => {
    for (const st of strings) {
      const f = Math.max(20, freq) * (st.i ? P.detune : 1), d = 1 / f;
      st.comb.delayTime.cancelScheduledValues(time);
      st.comb.delayTime.setValueAtTime(d, time);
      st.comb.resonance.cancelScheduledValues(time);
      st.comb.resonance.setValueAtTime(gainFor(f), time);
      st.pick.frequency.setValueAtTime(Math.min(7000, f * P.pickMul), time);
      st.pickGain.gain.setValueAtTime(Math.max(0.05, vel) * 0.7, time);
      const buf = pickBuffer();
      if (buf) {
        // One-shot, from the START of the buffer every time. A source that is played from
        // wherever it happens to be is the random pluck this replaced.
        const src = new Tone.ToneBufferSource({ url: buf, fadeOut: 0.002 });
        src.connect(st.pickGain);
        src.start(time, 0, d * P.attackNoise);
        src.onended = () => { src.dispose(); st.sources = st.sources.filter((x) => x !== src); };
        st.sources.push(src);
      }
    }
  };
  // Damped in STEPS, not by a ramp. Ramping the feedback of a comb filter down does not
  // fade it: measured, linearRampTo(0) made the string SWELL to five times its level on the
  // way — a pumping artefact of feeding a delay line a moving gain — before it died. Two
  // scheduled values instead: the hand stops the string, then lets go of it.
  const damp = (time) => {
    for (const st of strings) {
      st.comb.resonance.cancelScheduledValues(time);
      st.comb.resonance.setValueAtTime(0.55, time);
      st.comb.resonance.setValueAtTime(0, time + REST);
    }
  };
  return {
    _kind: kind,
    // The level this voice was BUILT at. A host that mutes and unmutes has to be able to
    // put it back, and the only number it could put back before was 0 — which threw away
    // every voice's own balance the moment it was loaded.
    get _db() { return P.out; },
    volume: out.volume,
    // What this voice is set to, and what a panel may move. The values live in P; the ones
    // that are properties of a node are pushed there as they change, and the rest are read
    // at the next pluck.
    params() { return { ...P }; },
    set(key, value) {
      if (!(key in P)) return;
      P[key] = value;
      if (key === 'dampening') for (const st of strings) st.comb.dampening = value;
      else if (key === 'drive') setDrive(value);
      else if (key === 'body1') bodies[0].gain.value = value;
      else if (key === 'body2') bodies[1].gain.value = value;
      else if (key === 'body3') bodies[2].gain.value = value;
      else if (key === 'damping') tame.gain.value = -value;
      else if (key === 'roomWet') room.wet.value = value;
      else if (key === 'out') out.volume.value = value;
    },
    triggerAttackRelease(freq, dur, time, vel = 0.8) { pluck(freq, time, vel); damp(time + dur); },
    // Everything cancelled and the string stopped dead. The audition needs it: each preview
    // schedules its own damp at its own end, so a note struck while the last one was ringing
    // was cut off mid-ring by an event belonging to a note that had already finished —
    // measured at half the level of a clean strike, which is what "it doesn't sound newly
    // triggered" was.
    silence(time) {
      for (const st of strings) {
        st.comb.resonance.cancelScheduledValues(time);
        st.comb.delayTime.cancelScheduledValues(time);
        st.comb.resonance.setValueAtTime(0, time);
        for (const src of st.sources.slice()) { try { src.stop(time); } catch { /* already done */ } }
      }
    },
    // The gamaka, as a slide along the string. The points arrive in Hz; the delay line
    // wants seconds per period, so each one is inverted as it is written — and both strings
    // slide together, keeping the pair's few cents all the way through the gesture.
    curve(points, time, dur, vel = 0.8) {
      pluck(points[0], time, vel);
      const N = points.length;
      for (const st of strings) {
        for (let k = 1; k < N; k++) {
          st.comb.delayTime.linearRampToValueAtTime(
            1 / (Math.max(20, points[k]) * (st.i ? P.detune : 1)), time + (dur * k) / (N - 1));
        }
      }
      damp(time + dur);
    },
    dispose() {
      for (const st of strings) {
        for (const src of st.sources.slice()) { try { src.dispose(); } catch { /* already done */ } }
        st.pickGain.dispose(); st.pick.dispose(); st.comb.dispose(); st.panner.dispose();
      }
      for (const f of bodies) f.dispose();
      drive.dispose(); makeup.dispose(); tame.dispose(); room.dispose(); out.dispose();
    },
  };
}

// Melody voice factory. The srgm melody is monophonic (notes never overlap), so
// each timbre is a single MONO synth — not a PolySynth.
//
// Every voice is TAGGED with the name of the case that built it, and the tag is the case's
// own literal rather than what was asked for. A name the switch does not know falls to the
// default and reports the default's tag, which is how the caller — and the guard — find out
// that they asked for a plucked string and were handed a bowed one.
function makeMelody(timbre, stringOver) {
  switch (timbre) {
    // The second name is what this voice was called for one release. A saved preference may
    // still say it, and it means this string; it is not offered in any menu.
    case 'pluck': case 'veena': return makeString('pluck', stringOver);
    case 'reed':
    case 'reed-fm': {   // a double reed — nadaswaram, shehnai. `reed-fm` is what the picker
                        // called it for a while, and a link or a saved preference may say so.
      // SAWTOOTH, not triangle. A triangle through a gentle lowpass is a sine with a hat on:
      // measured, this voice had a spectral centroid of 251Hz on a 220Hz note and 138 times
      // as much energy below 700Hz as above it — which is the number for "whistle". A reed
      // is a buzzing thing; its sound is the harmonics the filter leaves standing, so there
      // have to be harmonics there to leave.
      const s = new Tone.MonoSynth().toDestination();
      s.set({ oscillator: { type: 'sawtooth' },
              envelope: { attack: 0.09, decay: 0.25, sustain: 0.85, release: 0.5 },
              // Resonant, and opening as the note speaks: a reed's cry is a formant, and a
              // formant is a resonance that moves.
              filter: { Q: 2.2, type: 'lowpass', rolloff: -12 },
              filterEnvelope: { attack: 0.12, decay: 0.35, sustain: 0.55, release: 0.5,
                                baseFrequency: 320, octaves: 2.6 } });
      s._kind = 'reed';
      return s;
    }
    case 'soft-am': {   // AM, gentle reed/soft pad
      const s = new Tone.AMSynth().toDestination();
      s.set({ harmonicity: 2, oscillator: { type: 'sine' }, modulation: { type: 'sine' },
              envelope: { attack: 0.08, decay: 0.2, sustain: 0.85, release: 0.6 },
              modulationEnvelope: { attack: 0.2, decay: 0, sustain: 1, release: 0.5 } });
      s._kind = 'soft-am';
      return s;
    }
    case 'bowed-fm':
    default: {          // FM, bowed-string swell
      const s = new Tone.FMSynth().toDestination();
      s.set({ harmonicity: 2, modulationIndex: 6, oscillator: { type: 'sine' }, modulation: { type: 'sine' },
              envelope: { attack: 0.12, decay: 0.1, sustain: 0.9, release: 0.4, attackCurve: 'sine' },
              modulationEnvelope: { attack: 0.2, decay: 0.2, sustain: 0.8, release: 0.4 } });
      s._kind = 'bowed-fm';
      return s;
    }
  }
}

// Tala percussion voice factory. All are pitched (so the lower-Sa / Pa / Ma / Sa
// strokes stay distinct) with a short, sustain-0 envelope so each akshara reads
// as a struck stroke. Applied on the next load().
function makeTala(timbre) {
  switch (timbre) {
    case 'mallet': {     // soft pitched mallet — marimba / kalimba
      const s = new Tone.PolySynth(Tone.Synth).toDestination();
      s.set({ oscillator: { type: 'triangle' },
              envelope: { attack: 0.002, decay: 0.28, sustain: 0, release: 0.2 } });
      return s;
    }
    case 'reed':
    default: {           // warm rounded tick — the melody reed, made percussive (default)
      const s = new Tone.PolySynth(Tone.MonoSynth).toDestination();
      s.set({ oscillator: { type: 'triangle' },
              envelope: { attack: 0.01, decay: 0.22, sustain: 0, release: 0.3 },
              filter: { Q: 0.5, type: 'lowpass', rolloff: -24 },
              filterEnvelope: { attack: 0.02, decay: 0.2, sustain: 0.2, release: 0.3, baseFrequency: 200, octaves: 2 } });
      return s;
    }
    case 'membrane': {   // pitched membrane kick — mridangam-ish (the original)
      const s = new Tone.PolySynth(Tone.MembraneSynth).toDestination();
      s.set({ pitchDecay: 0.08, octaves: 1.5, oscillator: { type: 'sine' },
              envelope: { attack: 0.008, decay: 0.32, sustain: 0, release: 0.32 } });
      return s;
    }
    case 'veena': {      // plucked string — the composition's accent strum.
      // The strum is a DYAD: buildSequence puts Sa and Pa on the SAME tick, the way a
      // veena is struck. PluckSynth is monophonic and cannot be wrapped in PolySynth
      // (it isn't Monophonic-based), so a single one took the first note and threw
      // "Start time must be strictly greater than previous start time" on the second
      // — half of every strum, silently, for as long as this voice has existed.
      // Two voices, taken in turn, so both notes of a strum sound.
      const out = new Tone.Volume(0).toDestination();
      const voices = [new Tone.PluckSynth(), new Tone.PluckSynth()];
      for (const v of voices) { v.set({ attackNoise: 0.6, dampening: 2200, resonance: 0.9 }); v.connect(out); }
      let next = 0;
      return {
        volume: out.volume,
        triggerAttackRelease(...a) { const v = voices[next]; next = (next + 1) % voices.length; v.triggerAttackRelease(...a); },
        dispose() { for (const v of voices) v.dispose(); out.dispose(); },
      };
    }
  }
}

export function createToneBackend() {
  let synth = null;      // melody voice (mono)
  let preview = null;    // audition voice — see previewNote; never the melody voice

  let tala = null;       // tala voice — separate so its volume is live
  let drone = null;      // separate sustained voice; survives load/play/stop
  let droneKey = '';     // freqs signature — lets volume change without re-voicing
  let timbre = 'soft-am';   // melody voice preset; applied on the next load()
  let melodyMuted = false;  // remembered so a reload keeps the melody muted
  let masterDb = 0;         // canonical master level (dB); fades ramp around it
  let fadeTimer = null;     // pending fadeOutStop teardown; cancelled by a new load/play
  let total = 0;
  let ended = false;
  const clearFade = () => { if (fadeTimer) { clearTimeout(fadeTimer); fadeTimer = null; } };
  // What the loaded voice asked to be played at, or 0 for one that never said.
  const voiceDb = () => (synth && typeof synth._db === 'number' ? synth._db : 0);
  // Whatever a reader has moved in the instrument panel, kept here so it survives the voice
  // being rebuilt — which happens on every load(), and would otherwise throw the settings
  // away the moment the piece was played again.
  let stringOver = {};

  // Resolve once the context's clock has actually advanced, or after `capMs` either way.
  const clockAwake = (ctx, capMs = 250) => new Promise((resolve) => {
    if (!ctx || typeof ctx.currentTime !== 'number') { resolve(); return; }
    const t0 = ctx.currentTime, started = Date.now();
    const tick = () => {
      if (ctx.currentTime > t0 || Date.now() - started > capMs) { resolve(); return; }
      setTimeout(tick, 10);
    };
    tick();
  });
  const b = {
    onended: null,
    // opts.talaGain (0..1) is the tala track's initial live volume.
    load(events, totalSec, opts = {}) {
      const talaGain = opts.talaGain != null ? opts.talaGain : 1;
      clearFade();         // a new load supersedes any pending fade teardown
      b.disposeMelody();   // keep the drone playing across sequence reloads
      total = totalSec;
      ended = false;
      synth = makeMelody(timbre, stringOver);
      // The voice's OWN level, not zero. Each one is built at the level it was balanced at
      // against the others, and assigning 0 here undid that for every voice at once — which
      // is why tuning a voice's output gain changed nothing about what it played.
      synth.volume.value = melodyMuted ? -Infinity : voiceDb();   // melody mute (hear tala/drone alone)
      // Composition tala (no talaVoice) uses the fixed 'veena' accent-strum voice;
      // the tala browser passes opts.talaVoice from its picker to audition voices.
      tala = makeTala(opts.talaVoice || 'veena');
      tala.volume.value = talaDb(talaGain);     // live-adjustable via setTalaVolume
      const tr = transport();
      tr.cancel();
      tr.position = 0;
      for (const e of events) {
        const isTala = e.track === 'tala';
        const dest = isTala ? tala : synth;
        const vel = isTala ? 0.7 : 0.8;         // fixed velocity; loudness is the track volume
        // e.freq: experimental 53-EDO retune; falls back to 12-TET midi.
        const freq = e.freq != null ? e.freq : midiToFreq(e.midi);
        tr.schedule((time) => {
          // Inline gamaka: ramp the (mono) melody voice's frequency through the
          // sampled curve instead of a fixed pitch. Linear ramps (strictly
          // increasing times) — robust across browsers; same voice = same timbre.
          if (e.gamaka && e.gamaka.length && !isTala && synth.curve) {
            synth.curve(e.gamaka, time, e.durSec, vel);       // a voice that bends its own way
          } else if (e.gamaka && e.gamaka.length) {
            const arr = e.gamaka, N = arr.length;
            synth.triggerAttack(arr[0], time, vel);
            for (let k = 1; k < N; k++) synth.frequency.linearRampToValueAtTime(arr[k], time + e.durSec * k / (N - 1));
            synth.triggerRelease(time + e.durSec);
          } else {
            dest.triggerAttackRelease(freq, e.durSec, time, vel);
          }
        }, e.startSec);
      }
      if (totalSec > 0) {
        tr.schedule((time) => {
          // Halt the transport internally (not via the public b.stop(), which
          // resets `ended`): after a natural end position() must report 1.
          //
          // WITH THE CALLBACK'S OWN TIME, and with everything that is not audio work
          // moved off this callback. Tone raises a flag while it invokes a scheduled
          // callback, and any of its calls made with the time omitted warns — the
          // transport was being stopped at an implicit "now" from inside the audio
          // thread's own dispatch, which is both the warning and a real jitter: "now"
          // there is whenever the callback happened to run, not the moment scheduled.
          //
          // The rest — resetting the position, disposing voices, telling the host — is
          // bookkeeping. It ran here only because this is where the end was noticed, and
          // a dispose on the audio callback is how a teardown ends up racing the render
          // it is tearing down. Handed to a timeout, it happens on the page's own thread
          // a tick later, which is soon enough for something that has already stopped.
          const t = transport();
          t.stop(time);
          ended = true;
          setTimeout(() => {
            t.position = 0;
            if (b.onended) b.onended();
          }, 0);
        }, totalSec);
      }
    },
    async play() {
      if (total <= 0) return;
      clearFade();                      // don't let a stale teardown stop this run
      ended = false;
      await Tone.start();               // unlock AudioContext on the user gesture
      // WAIT FOR THE CLOCK TO MOVE before scheduling anything against it.
      //
      // Tone.start() resolves when the context reports itself running, which is not the
      // same as the hardware having started: on a phone the first output buffers can be
      // dropped while the audio route is still being set up, and a piece that opens on a
      // note loses the front of it. Every note after the first is fine, because by then
      // the clock and the speaker agree — which is what made this look like a fault in
      // one note rather than in the start.
      //
      // Bounded, and a no-op wherever the clock is already ticking: at most ~250ms, and
      // a context that never advances is simply started anyway rather than hanging on a
      // promise that will not settle.
      await clockAwake(rawCtx());
      // STARTED IN THE FUTURE, by the time it takes a buffer to reach the speaker.
      //
      // A piece that opens on a note puts that note's attack at transport time 0, and
      // starting the transport "now" asks for it at an audio time that is already being
      // rendered — so the envelope begins part-way through and the first note comes out
      // clipped, or on a device with a big buffer, missing. Every note after it is fine,
      // which is what made this look like a quirk of the first note rather than of the
      // start. A piece that happens to open on a rest never showed it at all.
      //
      // The runway is the output delay itself, floored at 60ms: whatever the device
      // needs to get sound out is what it needs to get the FIRST sound out.
      transport().start('+' + Math.max(0.06, outputDelay(rawCtx())).toFixed(3));
    },
    pause() { transport().pause(); },
    // Move the play position without playing. The point is a run that starts somewhere
    // other than the top: scheduled callbacks before `sec` simply never fire, and the
    // ones after it keep the times they were given. Only meaningful between load() and
    // play(), or while paused — a started transport would race its own clock.
    seek(sec) {
      if (total <= 0) return;
      ended = false;            // a seek is a fresh intention, not the end that was reached
      transport().seconds = Math.max(0, Math.min(total, sec));
    },
    stop() {
      ended = false;
      const tr = transport();
      tr.stop();
      tr.position = 0;
      tr.cancel();               // drop the leftover schedule
      b.disposeMelody();         // free the melody/tala oscillators (rebuilt on next play)
      b.idleSuspend();           // nothing playing + no drone → suspend the audio context
    },
    // Suspend the AudioContext when fully idle (transport stopped AND no drone),
    // so no ticker / audio-thread work continues. Auto-resumes: play() awaits
    // Tone.start() and setDrone() calls Tone.start(), both of which resume it.
    idleSuspend() {
      const raw = rawCtx();
      if (raw && raw.state === 'running' && transport().state !== 'started' && !drone) {
        raw.suspend().catch(() => {});
      }
    },
    position() {
      if (ended) return 1;              // contract: natural end reads 1 until stop/replay
      if (total <= 0) return 0;
      // Tone's transport can report a ~1e-16 residue after stop(); clamp so the
      // contract's "stop resets position() to 0" holds exactly.
      const s = transport().seconds;
      return s < 1e-6 ? 0 : Math.min(1, s / total);
    },
    latency() { return outputDelay(rawCtx()); },
    // The instrument panel's surface: what the loaded voice can be told, what it is set to
    // now, and a way to move one. A voice with nothing to say returns null, and a host that
    // asks about one draws no panel.
    voiceParams() {
      if (!synth || typeof synth.params !== 'function') return null;
      return { kind: synth._kind, spec: STRING_PARAMS, values: synth.params() };
    },
    setVoiceParam(key, value) {
      stringOver[key] = value;                 // remembered across the next load()
      if (synth && typeof synth.set === 'function') synth.set(key, value);
      if (key === 'out' && synth) synth.volume.value = melodyMuted ? -Infinity : value;
      // And the AUDITION voice, which is a second instrument and would otherwise go on
      // sounding like the settings you started with.
      if (preview && typeof preview.set === 'function') preview.set(key, value);
    },
    resetVoiceParams() {
      stringOver = {};
      for (const v of [synth, preview]) {
        if (v && typeof v.set === 'function')
          for (const [k, d] of Object.entries(STRING_DEFAULTS)) v.set(k, d);
        if (v && v === synth) v.volume.value = melodyMuted ? -Infinity : STRING_DEFAULTS.out;
      }
    },
    // Which voice is loaded, by the name of the case that BUILT it. Ask for a voice the
    // switch does not know and this reports what you got instead of what you wanted, which
    // is the only way that mistake is visible from outside.
    voiceKind() { return synth && synth._kind ? synth._kind : ''; },
    // The voices this backend implements — the list the pickers are built from.
    voices() { return SYNTH_VOICES.map(([v]) => v); },
    // Constant tambura-style drone: sustained Sa/Pa voices, independent of the
    // transport. `vol` (0..1) sets loudness; vol<=0 or empty freqs = off. When
    // only the volume changes (same freqs) the voices keep ringing — no
    // re-attack click. Called on a user gesture, so Tone.start() can unlock.
    setDrone(freqs, vol = 0.5) {
      if (!freqs || !freqs.length || vol <= 0) { b.droneOff(); return; }
      const key = freqs.join(',');
      const db = droneDb(vol);
      if (drone && key === droneKey) { drone.volume.value = db; return; }  // live volume
      b.droneOff();
      Tone.start();
      drone = new Tone.PolySynth(Tone.Synth).toDestination();
      drone.set({ oscillator: { type: 'sine' },
                  envelope: { attack: 0.9, decay: 0, sustain: 1, release: 1.4 } });
      drone.volume.value = db;
      drone.triggerAttack(freqs);
      droneKey = key;
    },
    // Sound ONE note right now, for auditioning while a curve is being shaped.
    //
    // Deliberately NOT the transport: it is triggered at Tone.now() and touches no
    // schedule, so position() and the play/pause state are exactly as they were. That
    // is the contract — an editor asking to hear a note must not be able to disturb
    // playback, and must work with nothing loaded at all.
    //
    // Its own voice, too. The melody voice is monophonic and may be mid-phrase, so
    // borrowing it would cut the note that is playing and land the preview's frequency
    // ramps on top of the scheduled ones. It is also independent of the melody mute:
    // muting the melody is for listening to the tala, and this is an explicit request
    // to hear a pitch.
    previewNote(ev) {
      if (!ev || !(ev.durSec > 0)) return;
      Tone.start();                              // called on a user gesture; unlocks/resumes
      // Built with whatever the instrument panel has been told, and REBUILT when the voice
      // changes: it was made once and kept forever, so auditioning a note after switching
      // voices played the one you had left behind.
      if (!preview || preview._kind !== timbre) {
        if (preview) preview.dispose();
        preview = makeMelody(timbre, stringOver);
      }
      const t = Tone.now();
      // From silence, every time: see the voice's own note on silence().
      if (preview.silence) preview.silence(t);
      const at = preview.silence ? t + 0.01 : t;
      if (ev.gamaka && ev.gamaka.length && preview.curve) {
        preview.curve(ev.gamaka, at, ev.durSec, 0.8);      // a voice that bends its own way
      } else if (ev.gamaka && ev.gamaka.length) {
        const arr = ev.gamaka, N = arr.length;
        preview.triggerAttack(arr[0], at, 0.8);
        for (let k = 1; k < N; k++) preview.frequency.linearRampToValueAtTime(arr[k], at + ev.durSec * k / (N - 1));
        preview.triggerRelease(at + ev.durSec);
      } else {
        const freq = ev.freq != null ? ev.freq : midiToFreq(ev.midi);
        preview.triggerAttackRelease(freq, ev.durSec, at, 0.8);
      }
    },
    // Master output level (0..1): scales everything — melody, tala, drone.
    // 1 → 0 dB (unattenuated), 0 → silence. Live.
    setMasterVolume(vol) {
      masterDb = gainDb(vol);
      destination().volume.value = masterDb;
    },
    // Click-free start/stop by ramping the master output. Both anchor to the
    // stored master level (masterDb) — never the live, possibly mid-ramp value.
    // fadeIn dips to silence then ramps up; fadeOutStop ramps down, then stops +
    // clears the drone and restores the level. The teardown timer is tracked so
    // a following load()/play() cancels it (else it would kill the new run).
    fadeIn(sec = 0.06) {
      clearFade();
      const v = destination().volume;
      v.value = -60;
      v.rampTo(masterDb, sec);
    },
    fadeOutStop(sec = 0.12) {
      const v = destination().volume;
      v.rampTo(-60, sec);
      clearFade();
      fadeTimer = setTimeout(() => {
        fadeTimer = null;
        b.stop(); b.droneOff(); v.value = masterDb;
      }, sec * 1000 + 40);
    },
    // Tala track volume (0..1), live — takes effect on a currently playing piece.
    setTalaVolume(vol) {
      if (tala) tala.volume.value = talaDb(vol);
    },
    // Melody mute (live) — lets the user solo tala + drone to set their levels.
    setMelodyMuted(muted) {
      melodyMuted = muted;
      if (synth) synth.volume.value = muted ? -Infinity : voiceDb();
    },
    // Melody voice, by name; applies on the next load(). Nothing to fetch any more — the
    // sampled sets are gone, and every voice here is made of oscillators and filters.
    setTimbre(name) { timbre = name; },
    droneOff() {
      if (!drone) return;
      try { drone.releaseAll ? drone.releaseAll() : drone.triggerRelease(); } catch {}
      drone.dispose();
      drone = null;
      droneKey = '';
      b.idleSuspend();           // if playback is also stopped, go fully idle
    },
    disposeMelody() {
      const tr = transport();
      tr.cancel();
      tr.stop();
      if (synth) { synth.dispose(); synth = null; }
      if (tala) { tala.dispose(); tala = null; }
    },
    dispose() {
      b.disposeMelody();
      b.droneOff();
      // The preview voice survives load()/stop() on purpose — you audition notes
      // between takes — so only a full dispose releases it.
      if (preview) { preview.dispose(); preview = null; }
    },
  };
  return b;
}
