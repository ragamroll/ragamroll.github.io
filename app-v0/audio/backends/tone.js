import * as Tone from '../../vendor/tone.js';
import { midiToFreq } from '../schedule.js';
import { outputDelay, makePlayClock, makeLatencyMeter } from '../backend.js';
import { SYNTH_VOICES, STRING_PARAMS, STRING_DEFAULTS, PLUCKZ_DEFAULTS, pluckzTable } from '../voices.js';

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
// The tala keeps the SOFTER taper off its slider but not the squared one, and not the -8dB
// the drone-style taper had under it. Measured against the string as it now sounds, that
// combination put the tala 28dB under the melody at the middle of its own slider — which is
// not "under the melody", it is not there. A gentler curve and a lift bring it to about
// six decibels under at the same position: present, and still underneath.
//
// The lift is +8 rather than +2 because the accent-strum voice is a pair of PluckSynths,
// which are quiet for their nominal level in a way the envelope-driven percussion voices
// are not — the number is trimmed against what the strum actually sounds like, not against
// what its dB says.
const talaDb = (v) => gainDb(v) + 8;
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
    _spec: STRING_PARAMS,          // what a panel may move on this voice
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
      // WHERE the body resonates, not just how much. These are not on the panel — they are
      // what makes one box a different box rather than a louder one — but a named setting
      // moves them, and a value that lands in P without reaching the filter is a setting
      // that appears to be applied and is not. It would have taken until the voice was next
      // rebuilt to be heard, which is the next press of Play.
      else if (key === 'bodyHz') value.forEach((hz, i) => { if (bodies[i]) bodies[i].frequency.value = hz; });
      else if (key === 'bodyQ') value.forEach((q, i) => { if (bodies[i]) bodies[i].Q.value = q; });
      else if (key === 'tameHz') tame.frequency.value = value;
      else if (key === 'roomSize') room.roomSize.value = value;
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

// ---- Pluckz --------------------------------------------------------------------
//
// The tone of the buzz-string notation player, reproduced rather than approximated. It is
// here for a reason that is not "another instrument": that player's gamaka database — 3242
// raga-specific ornaments — was authored BY EAR against this timbre. Playing an imported
// shape on the tone it was judged on is how you tell whether the shape survived the move;
// on any other voice, a difference could be the ornament or could be the instrument.
//
// Three things carry the tone, and nothing else about it is load-bearing.
//
// ONE: a fixed harmonic table, chosen by register. Note how weak the fundamental is against
// the fourth harmonic in the low table — that is a veena's bridge robbing the fundamental,
// and it is most of what makes this recognisable. It is not a mistake to be corrected.
//
// TWO: a plucked envelope that belongs to the STRING, not to the note — 10ms up, and six
// seconds of exponential decay whatever the note's length. A short note simply stops part of
// the way down. Scaling the decay to the note is what makes every note end at the same
// loudness, and that is what stops it sounding plucked.
//
// THREE: a 20ms echo at 0.3, PARALLEL with the dry path. It reads as body resonance rather
// than as a repeat, and taking it out thins the sound audibly. It is tone, not an effect: not
// a send, not optional.
//
// And one addition. Those tables stop at the 13th harmonic — about 1.7kHz on a low sa — so
// on their own they give a tone with no attack transient at all, which an ear hears as
// somewhere between a string and a reed. A short burst of band-limited noise puts the attack
// back. An OSCILLATOR carrying the missing harmonics was tried first and cannot be tuned out
// of clicking: a periodic burst repeats every fundamental period, and three identical repeats
// inside one attack is what an ear calls a click. Only aperiodic excitation is free of them.
// The pick's noise, once per session from a fixed seed so a strike answers the same way
// twice, pinked with a one-pole because white noise into a string is brighter than any
// finger. Its own buffer rather than the plucked string's: a different length, because the
// sweep below may run for a quarter of a second, and a different seed.
let PLUCKZ_NOISE = null;
function pluckzNoise() {
  if (PLUCKZ_NOISE) return PLUCKZ_NOISE;
  const ctx = rawCtx();
  if (!ctx) return null;
  const n = Math.floor(ctx.sampleRate * 0.3);
  const buf = ctx.createBuffer(1, n, ctx.sampleRate);
  const d = buf.getChannelData(0);
  let seed = 20260818, last = 0;
  for (let i = 0; i < n; i++) {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    last = 0.85 * last + 0.15 * ((seed / 4294967295) * 2 - 1);
    d[i] = last * 0.42;
  }
  PLUCKZ_NOISE = new Tone.ToneAudioBuffer(buf);
  return PLUCKZ_NOISE;
}

function makePluckz(over = {}) {
  const P = { ...PLUCKZ_DEFAULTS, ...over };
  const out = new Tone.Volume(P.out).toDestination();
  // The echo, built once and shared: both the tone and the pick feed it, and both feed the
  // output directly as well.
  const echo = new Tone.Delay(0.02), echoGain = new Tone.Gain(0.3);
  echo.connect(echoGain); echoGain.connect(out);

  // A note owns its oscillator, the way the original owns one per phrase — the harmonic
  // table depends on the register, and a voice that is reused across notes would have to
  // rewrite its own waveform between them.
  let live = [];
  const forget = (nodes, at) => {
    live.push(...nodes);
    // Freed a moment after the sound is over, on the page's own thread. A dispose scheduled
    // on the audio clock is a teardown racing the render it is tearing down.
    setTimeout(() => {
      for (const n of nodes) { try { n.dispose(); } catch (_) { /* already gone */ } }
      live = live.filter((n) => !nodes.includes(n));
    }, Math.max(0, (at - (rawCtx() ? rawCtx().currentTime : 0)) * 1000) + 400);
  };

  // freq is the pitch to sound; tableFreq picks the register (a gamaka chooses ONE table,
  // from its mean, rather than switching tables inside a gesture).
  const strike = (freq, tableFreq, time, dur, vel, ramps) => {
    const level = Math.max(0.05, vel);
    const osc = new Tone.Oscillator({ frequency: Math.max(20, freq), type: 'custom',
                                      partials: pluckzTable(tableFreq, P.saHz) });
    const amp = new Tone.Gain(0);
    osc.connect(amp); amp.connect(out); amp.connect(echo);
    amp.gain.setValueAtTime(0.001, time);
    amp.gain.linearRampToValueAtTime(level, time + 0.01);
    // SIX SECONDS, always. The note's length decides where this is cut off, not how fast it
    // falls: that is the difference between a string and an organ stop.
    amp.gain.exponentialRampToValueAtTime(0.001, time + 6);
    if (ramps) for (const [hz, at] of ramps) osc.frequency.linearRampToValueAtTime(Math.max(20, hz), at);
    osc.start(time);
    // OUT OVER A FEW MILLISECONDS, not cut. The original stops its oscillator while the
    // envelope is still well above silence, and ends every note with a small click. This is
    // a deliberate difference from it, and the only one.
    const end = time + dur;
    amp.gain.cancelScheduledValues(end);
    amp.gain.setValueAtTime(Math.max(0.0002, level * Math.pow(0.001 / level, dur / 6)), end);
    amp.gain.exponentialRampToValueAtTime(0.0001, end + 0.005);
    osc.stop(end + 0.008);
    const nodes = [osc, amp];

    if (P.pick > 0) {
      const buf = pluckzNoise();
      if (buf) {
        const src = new Tone.ToneBufferSource({ url: buf, fadeOut: 0.002 });
        // Kept out of the fundamental: the pick is what happens ABOVE the note.
        const hp = new Tone.Filter({ type: 'highpass', frequency: 2 * freq, Q: 0.7 });
        // THE SWEEP, and it is not optional. A real pluck's noise dies bright-first — it
        // stops being broadband well before it stops being audible — and held at a fixed
        // width it is heard as a brush laid over the note rather than as an attack. It also
        // makes `pickTop` mean how bright the attack STARTS, which is the more useful thing
        // for a number to mean.
        const start = Math.min(9000, P.pickTop * freq);
        const settle = Math.min(start, Math.max(120, 3 * freq));
        const lp = new Tone.Filter({ type: 'lowpass', frequency: start, Q: 0.7 });
        lp.frequency.setValueAtTime(start, time);
        lp.frequency.exponentialRampToValueAtTime(settle, time + P.pickDecay);
        const pamp = new Tone.Gain(0);
        src.connect(hp); hp.connect(lp); lp.connect(pamp);
        pamp.connect(out); pamp.connect(echo);      // the echo hears the pick too
        pamp.gain.setValueAtTime(0.0001, time);
        // 8ms, not 3: three milliseconds on its own reads as a click.
        pamp.gain.linearRampToValueAtTime(level * P.pick, time + 0.008);
        pamp.gain.exponentialRampToValueAtTime(0.0001, time + P.pickDecay);
        src.start(time);
        src.stop(time + Math.min(dur, P.pickDecay + 0.05));
        nodes.push(src, hp, lp, pamp);
      }
    }
    forget(nodes, time + dur);
  };

  return {
    _kind: 'pluckz',
    get _db() { return P.out; },
    volume: out.volume,
    params() { return { ...P }; },
    set(key, value) {
      if (!(key in P)) return;        // a string's settings are not this instrument's
      P[key] = value;
      if (key === 'out') out.volume.value = value;
    },
    triggerAttackRelease(freq, dur, time, vel = 0.8) { strike(freq, freq, time, dur, vel, null); },
    // The gamaka is the easy one here. The points arrive as ABSOLUTE frequencies and an
    // oscillator's frequency is what they are — no inversion, unlike the plucked string,
    // whose pitch lives in a comb filter's delay and where delay is 1/f.
    curve(points, time, dur, vel = 0.8) {
      const N = points.length;
      let mean = 0;
      for (const p of points) mean += p;
      mean /= N || 1;
      const ramps = [];
      for (let k = 1; k < N; k++) ramps.push([points[k], time + (dur * k) / (N - 1)]);
      strike(points[0], mean, time, dur, vel, ramps);
    },
    // Nothing is ringing that a new note should have to play over: each note owns its own
    // oscillator, so silencing is stopping the ones that are still sounding.
    silence(time) {
      for (const n of live.slice()) {
        try { if (n.stop) n.stop(time); } catch (_) { /* already stopped */ }
      }
    },
    dispose() {
      for (const n of live.slice()) { try { n.dispose(); } catch (_) { /* already gone */ } }
      live = [];
      echoGain.dispose(); echo.dispose(); out.dispose();
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
function makeMelody(timbre, stringOver, pluckzOver) {
  switch (timbre) {
    // The second name is what this voice was called for one release. A saved preference may
    // still say it, and it means this string; it is not offered in any menu.
    case 'pluck': case 'veena': return makeString('pluck', stringOver);
    // The buzz-string player's tone. Built from a table rather than from parts, and not
    // tunable from the panel — see PLUCKZ_DEFAULTS for why the numbers are where they are.
    case 'pluckz': return makePluckz(pluckzOver);
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
      // The LAST TIME each string was struck, and the invariant that goes with it: a string
      // cannot be plucked twice at the same instant. Tone agrees — a second start at a time
      // that is not strictly greater throws out of the callback it is in, taking the rest of
      // that callback's work with it.
      //
      // The transport handed the same instant to one voice twice when the end of a piece
      // re-fired the opening strum (fixed at its source, in the end callback below); it was
      // seen once more afterwards, rarely, from somewhere not yet identified. This is the
      // layer that owns the rule, so this is where the rule is kept: strike the string that
      // was struck LONGEST AGO, and if even that one was struck at this very instant, do not
      // strike it. Two identical strums at one moment are not two strums — they are one,
      // played twice as loud, and the difference is inaudible either way.
      const struck = voices.map(() => -Infinity);
      let next = 0;
      return {
        volume: out.volume,
        triggerAttackRelease(...a) {
          const time = a[2];
          let i;
          if (typeof time !== 'number') { i = next; next = (next + 1) % voices.length; }
          else {
            i = struck.indexOf(Math.min(...struck));      // the string that has rested longest
            if (!(time > struck[i])) return;              // ...and even it is mid-attack: skip
            struck[i] = time;
          }
          voices[i].triggerAttackRelease(...a);
        },
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
  // What the host last asked the drone to be, so an interrupted one can be built again, and
  // how many have been built — a guard can hear that a drone is sounding but not that it is
  // a NEW one, which is the whole question here.
  let droneWanted = null;
  let droneBuilds = 0;
  let timbre = 'soft-am';   // melody voice preset; applied on the next load()
  let melodyMuted = false;  // remembered so a reload keeps the melody muted
  // The tala's live level, REMEMBERED for the same reason the mute is. It arrives twice: as
  // load()'s talaGain when a piece is played, and from the slider while it plays. Only the
  // first was ever kept, so a rebuilt run came back at the level the piece STARTED at — and
  // since the tala starts muted, a reader who had turned it up got silence back. That is not
  // hypothetical: it is what an interrupted piece did on a phone with the tala soloed.
  let talaVol = null;
  // The audio time that maps to transport zero. It is what lets this ask the AUDIO CLOCK how
  // far the piece should have got, rather than asking the transport, which is the thing that
  // stops when the page is frozen.
  let runOrigin = null;
  let masterDb = 0;         // canonical master level (dB); fades ramp around it
  let fadeTimer = null;     // pending fadeOutStop teardown; cancelled by a new load/play
  let loaded = null;        // the last load()'s arguments, for rebuilding an interrupted run
  // What position() hands the DRAWING: the transport's reading, smoothed between its
  // steps (see makePlayClock). Reset wherever the position moves by something other than
  // time passing — load, play, pause, stop, seek.
  const clock = makePlayClock();
  const meter = makeLatencyMeter();   // steady output delay, for the same reason

  // ---- coming back from an interruption ---------------------------------------------------
  //
  // A phone can take the audio away outright: a call, another app, the screen locking. The
  // context comes back 'suspended' — 'interrupted' on Safari — and nothing resumed it, so the
  // piece stayed silent while the app went on believing it was playing. Nobody was listening
  // for it before this.
  //
  // Resuming is all that is needed to put the sound back. A suspended context's clock stops
  // with it, so the transport picks up where it left off rather than somewhere else, and the
  // playhead re-anchors itself (makePlayClock caps how far it carries a frozen reading).
  //
  // A resume can be refused when there is no user gesture behind it; that is not an error
  // worth reporting, because the next gesture will do it.
  // WHAT AN INTERRUPTION ACTUALLY BREAKS, and it is not the context.
  //
  // Reported from Android: leave the app and the sound breaks up, and coming back does not
  // mend it — the roll goes on animating and what comes out is noise. But pressing Stop and
  // then Play mends it completely. That is the whole diagnosis: Stop and Play do one thing
  // resuming does not, which is BUILD THE VOICES AGAIN and schedule the piece afresh. The
  // context survives the interruption; the graph hanging off it does not.
  //
  // So a run that was playing when the audio was taken away is rebuilt where it stood: the
  // same events, reloaded — which disposes the old voices and makes new ones — then seeked
  // back to where the piece had got to, and started again. What a reader hears is a small
  // break rather than a broken instrument, and the playhead does not jump.
  // HOW FAR THE PIECE SHOULD HAVE GOT, asked of the audio clock. The transport is the thing
  // that stops when the page is frozen; the audio clock is not, so the gap between them IS
  // the interruption, measured rather than inferred from events that may never arrive.
  const expectedSeconds = () => {
    const raw = rawCtx();
    if (!raw || runOrigin == null) return null;
    return raw.currentTime - runOrigin;
  };

  let reviving = false;
  let revivals = 0;
  const revive = () => {
    if (reviving || !loaded || ended) return;
    const tr = transport();
    if (tr.state !== 'started') return;
    // WHERE REAL TIME HAS TAKEN IT, not where the stalled transport stopped. Seeking back to
    // the transport's own reading is what makes the missed minute play again at speed; the
    // audio clock ran throughout, and the piece with it, so this is where the reader is.
    const should = expectedSeconds();
    const at = Math.max(0, Math.min(loaded.totalSec, should == null ? tr.seconds : should));
    reviving = true;
    // SILENCED WHILE IT IS REBUILT, because of what a returning tab does before we get a say.
    //
    // A frozen page does not schedule; when it thaws, the browser flushes every timer it held
    // back, all at once. Each note whose moment has passed is triggered immediately, on top of
    // the others — a burst of the last second or two of the piece played as a chord. Reported
    // as "garbled at first, then it settles", and the settling is the backlog running dry.
    //
    // That burst is committed to the audio thread before this handler ever runs, so it cannot
    // be prevented here; it can be not heard. The output is taken down, the run is rebuilt,
    // and the level comes back — a break in the sound instead of a mess.
    //
    // Ramped rather than switched: a gain that jumps to silence clicks, and a click is what
    // this is trying to spare the reader.
    const d = destination();
    try { d.volume.rampTo(-60, 0.01); } catch (_) { d.volume.value = -60; }
    const unmute = () => {
      try { d.volume.rampTo(masterDb, 0.05); } catch (_) { d.volume.value = masterDb; }
    };
    try {
      // WITH THE MIX AS IT STANDS, not as it stood when Play was pressed. Everything the
      // sliders have done since is live state on the backend, and a rebuild that restores
      // the load-time arguments quietly undoes all of it.
      b.load(loaded.events, loaded.totalSec,
             { ...loaded.opts, talaGain: talaVol != null ? talaVol : loaded.opts.talaGain });
      b.seek(at);
      b.play();
      // THE DRONE TOO, and it is the one that matters most. The melody is a series of short
      // plucks, each built when it is struck; the drone is three oscillators that have been
      // sounding continuously since Play — straight through the interruption. Nothing else
      // rebuilds it: the host only calls droneOff/setDrone when playback starts or stops, and
      // setDrone deliberately does nothing when the frequencies have not changed. So an
      // interrupted drone went on being whatever the interruption left it as, which is what
      // "the audio is all garbled and noisy" sounds like when the garbled thing never stops.
      if (droneWanted) {
        const want = droneWanted;
        b.droneOff();
        b.setDrone(want.freqs, want.vol);
      }
      revivals++;
      // After the rebuild has had time to schedule its first notes, not before: unmuting
      // into the tail of the flush would put the burst back.
      setTimeout(unmute, 120);
    } finally { reviving = false; }
  };

  // AND IT CANNOT WAIT FOR THE CONTEXT TO ADMIT IT. The first version of this rebuilt only
  // when the context reported itself something other than 'running', which is what a clean
  // suspend looks like. Android does not always do that: the app comes back, the context
  // says 'running', the clock advances, and what comes out is noise — which is precisely
  // what was reported, twice, and why the first fix did not take.
  //
  // So the evidence used is HAVING BEEN AWAY, not the context's own account of itself. A
  // rebuild is cheap and a stuck instrument is not: away for more than a moment, or an audio
  // clock that lost time against the wall while we were gone, and the run is rebuilt.
  //
  // The threshold keeps an accidental blur from breaking the sound for no reason — a glance
  // at another window and back does not rebuild anything.
  let hiddenAt = 0, hiddenClock = 0;
  const AWAY_ENOUGH = 1;        // seconds away before a return is treated as an interruption

  // STOP THE MUSIC WHEN NOBODY CAN SCHEDULE IT.
  //
  // Everything above this — the rebuild, the drift, the hush — exists because a piece goes on
  // running while the page that schedules it is frozen. It cannot schedule, so the notes
  // arrive late in a heap; the voices are left mid-flight in a graph the phone has stopped;
  // and waking up means replaying whatever was missed. None of that is reachable if the piece
  // is not running.
  //
  // So it pauses when the page goes away and picks up when it comes back. The cost is stated
  // plainly: this is not a background player, and it cannot become one by accident. A piece
  // that plays on while you read something else needs its notes committed to the audio clock
  // up front and a Media Session so the phone treats this as a media app — real work, not a
  // side effect of leaving the transport running.
  //
  // The rebuild stays as a BACKSTOP, because this pause depends on being told the page went
  // away and a phone is not obliged to tell us. Told, we pause; not told, the audio clock
  // still shows the gap when we get back.
  let pausedByHide = false;
  let retryArmed = false;
  let droneBeforeHide = null;   // the drone is not the transport's, so pausing does not stop it
  const resumeAfterHide = () => {
    if (!pausedByHide) return;
    pausedByHide = false;
    const want = droneBeforeHide;
    Promise.resolve(b.play()).then(() => {
      if (want) { droneBeforeHide = null; b.setDrone(want.freqs, want.vol); }
    }).catch(() => {
      // Refused for want of a gesture. Stay paused and take the next touch as the gesture,
      // rather than leaving a reader with a transport that says it is playing and is not.
      pausedByHide = true;
      if (retryArmed || typeof document === 'undefined') return;
      retryArmed = true;
      const once = () => {
        document.removeEventListener('pointerdown', once);
        document.removeEventListener('keydown', once);
        retryArmed = false;
        resumeAfterHide();
      };
      document.addEventListener('pointerdown', once, { once: true });
      document.addEventListener('keydown', once, { once: true });
    });
  };

  const onHide = () => {
    const raw = rawCtx();
    hiddenAt = Date.now();
    hiddenClock = raw ? raw.currentTime : 0;
    if (transport().state !== 'started') return;
    b.pause();
    pausedByHide = true;
    // A PAUSED TRANSPORT IS NOT SILENCE. It stops notes being STARTED; it does not stop the
    // one that is ringing, and it has no authority at all over the drone, which is
    // independent of the transport by contract and would go on sounding into a page nobody
    // is looking at. Measured: 0.19 of level half a second after the pause.
    droneBeforeHide = droneWanted;
    b.droneOff();
    // AND THAT IS ENOUGH FOR SILENCE, without touching a single voice. A paused transport
    // does not stop a sustaining note and has no authority over the drone — soft-am was
    // still sounding at 0.12 half a second after the pause — but with the transport stopped
    // and the drone gone, idleSuspend() finds nothing playing and suspends the context. A
    // suspended context renders nothing at all, which is a stronger silence than any volume.
    //
    // An earlier version took the master down as well. It could not: the ramp was scheduled
    // on a clock that had just stopped, so the level never moved, and the analyser that was
    // meant to prove the silence had frozen on its last buffer — the same trap as the
    // "residual noise" that turned out to be a stopped context earlier the same day.
  };
  const onShow = () => {
    const raw = rawCtx();
    if (!raw) return;
    // The ordinary way back: we stopped it on the way out, so start it again. Nothing drifted
    // and nothing needs rebuilding, because nothing was running to go wrong.
    if (pausedByHide) { resumeAfterHide(); return; }
    if (transport().state !== 'started') return;
    if (raw.state !== 'running') { raw.resume().then(revive).catch(() => { /* a gesture will */ }); return; }
    // NOT CONDITIONAL ON HAVING SEEN THE HIDE. It was, and that is why a frozen page came
    // back racing on a phone: Android freezes a page before the hidden event is handled, or
    // without delivering it, so `hiddenAt` stayed zero and this returned without doing
    // anything at all. Where the piece OUGHT to be is knowable without any of that.
    const should = expectedSeconds();
    const behind = should == null ? 0 : should - transport().seconds;
    const away = hiddenAt ? (Date.now() - hiddenAt) / 1000 : 0;
    const clockRan = hiddenAt ? raw.currentTime - hiddenClock : 0;
    hiddenAt = 0;
    // A transport half a second behind the audio clock has missed that much of the piece and
    // is about to replay it: Tone hands a woken clock every tick it slept through, in a
    // burst, which is the racing roll and the garble that clears.
    if (behind > 0.5 || away > AWAY_ENOUGH || (hiddenClock && clockRan < away * 0.8)) revive();
  };
  const wake = () => {
    const raw = rawCtx();
    if (!raw || transport().state !== 'started') return;
    if (raw.state === 'running') return;
    raw.resume().then(revive).catch(() => { /* a gesture will */ });
  };
  const onVisible = () => {
    if (typeof document === 'undefined') { wake(); return; }
    if (document.hidden) onHide(); else onShow();
  };
  if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisible);
  {
    const raw = rawCtx();
    if (raw && raw.addEventListener) raw.addEventListener('statechange', wake);
  }
  let total = 0;
  let ended = false;
  const clearFade = () => { if (fadeTimer) { clearTimeout(fadeTimer); fadeTimer = null; } };
  // What the loaded voice asked to be played at, or 0 for one that never said.
  const voiceDb = () => (synth && typeof synth._db === 'number' ? synth._db : 0);
  // Whatever a reader has moved in the instrument panel, kept here so it survives the voice
  // being rebuilt — which happens on every load(), and would otherwise throw the settings
  // away the moment the piece was played again.
  let stringOver = {};
  // Pluckz keeps its OWN. A voice is rebuilt on every play, so anything set on it has to
  // survive the rebuild — and the two voices share the key `out`, so one bucket would hand
  // whichever was tuned last to whichever is loaded now.
  let pluckzOver = {};
  const overFor = (kind) => (kind === 'pluckz' ? pluckzOver : stringOver);

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
      // What the host asked for now, or failing that whatever the slider was last set to.
      const talaGain = opts.talaGain != null ? opts.talaGain : (talaVol != null ? talaVol : 1);
      talaVol = talaGain;
      loaded = { events, totalSec, opts };   // kept so an interrupted run can be rebuilt
      clearFade();         // a new load supersedes any pending fade teardown
      b.disposeMelody();   // keep the drone playing across sequence reloads
      clock.reset();       // a different piece: nothing about the old one carries forward
      total = totalSec;
      ended = false;
      synth = makeMelody(timbre, stringOver, pluckzOver);
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
        tr.schedule(() => {
          // NOTHING IS DONE TO THE TRANSPORT HERE. This callback only notices the end;
          // stopping is the page thread's job, a tick later.
          //
          // Stopping a transport from inside its own scheduled callback does not stop it.
          // It resets to zero and keeps ticking for the remainder of its lookahead, so
          // every event scheduled at 0 FIRES AGAIN — measured against Tone directly, three
          // extra events on every run of the pattern and nineteen once in five. In this
          // app that is the tala's opening strum sounding again a few milliseconds after
          // the piece has finished, on every single play that reached its end: the window
          // after the end measured LOUDER than the piece itself, by up to six times.
          //
          // And when a re-fire landed twice inside one instant, the strum's two PluckSynths
          // were asked for two notes at one time, which throws "Start time must be strictly
          // greater than previous start time" and kills the callback it is in. That error,
          // about one run in seven, is what led here; the extra strum was on every one.
          //
          // The stop below omits its time deliberately. That is what the previous version
          // was avoiding — Tone warns about an implicit "now" while it is invoking a
          // scheduled callback — but out here there is no callback in flight, no flag
          // raised and no warning: "now" on the page thread is simply now.
          ended = true;
          setTimeout(() => {
            const t = transport();
            t.stop();
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
      // A resume must not carry the length of the PAUSE into its first frame.
      clock.reset();
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
      // Where transport zero sits on the audio clock, for expectedSeconds() below.
      { const raw = rawCtx(); runOrigin = raw ? raw.currentTime - transport().seconds : null; }
    },
    pause() { pausedByHide = false; transport().pause(); clock.reset(); },
    // Move the play position without playing. The point is a run that starts somewhere
    // other than the top: scheduled callbacks before `sec` simply never fire, and the
    // ones after it keep the times they were given. Only meaningful between load() and
    // play(), or while paused — a started transport would race its own clock.
    seek(sec) {
      if (total <= 0) return;
      ended = false;            // a seek is a fresh intention, not the end that was reached
      // The position moved without time passing, and a monotonic clock would otherwise
      // refuse to follow a seek BACKWARDS — it would hold the old position until playback
      // caught up with it.
      clock.reset();
      transport().seconds = Math.max(0, Math.min(total, sec));
    },
    stop() {
      ended = false;
      pausedByHide = false;      // a stopped piece is not one waiting to be resumed
      clock.reset();
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
      const tr = transport();
      const s = tr.seconds;
      if (s < 1e-6) return 0;
      // Smoothed for the playhead, not for the audio: transport().seconds moves in the
      // scheduler's steps, and drawing it raw is a line that sits still and then lurches.
      return Math.min(1, clock.read(s, tr.state === 'started') / total);
    },
    // Steadied, because the playhead subtracts this every frame — see makeLatencyMeter.
    // The START runway below still asks outputDelay directly: that is one reading at one
    // moment, and it wants the freshest one rather than the calmest.
    latency() { return meter(rawCtx()); },
    // The instrument panel's surface: what the loaded voice can be told, what it is set to
    // now, and a way to move one. A voice with nothing to say returns null, and a host that
    // asks about one draws no panel.
    voiceParams() {
      if (!synth || typeof synth.params !== 'function') return null;
      // The SPEC IS THE VOICE'S, not this function's idea of one. Handing back the string's
      // parameter list for whatever happens to be loaded is how a panel comes to draw
      // Brightness and Sustain over an instrument that has neither.
      return { kind: synth._kind, spec: synth._spec || null, values: synth.params() };
    },
    setVoiceParam(key, value) {
      overFor(timbre)[key] = value;            // remembered across the next load(), per voice
      if (synth && typeof synth.set === 'function') synth.set(key, value);
      if (key === 'out' && synth) synth.volume.value = melodyMuted ? -Infinity : value;
      // And the AUDITION voice, which is a second instrument and would otherwise go on
      // sounding like the settings you started with.
      if (preview && typeof preview.set === 'function') preview.set(key, value);
    },
    resetVoiceParams() {
      stringOver = {};
      pluckzOver = {};
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
    // How many times a run has been rebuilt after an interruption. A guard cannot hear the
    // difference between a piece that carried on and one that was rebuilt mid-flight — both
    // sound like a piece playing — so the backend counts, the way voiceKind() exists so a
    // guard can ask what it actually got instead of trusting what it asked for.
    revivals() { return revivals; },
    droneBuilds() { return droneBuilds; },
    talaLevel() { return talaVol; },       // what the tala is set to, for a guard to check
    // Whether the backend stopped the music because the page went away, as against a reader
    // having pressed pause. A guard cannot tell those apart by listening.
    haltedByHide() { return pausedByHide; },
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
      droneWanted = { freqs: freqs.slice(), vol };
      if (drone && key === droneKey) { drone.volume.value = db; return; }  // live volume
      b.droneOff();
      droneWanted = { freqs: freqs.slice(), vol };   // droneOff clears it; this is still wanted
      droneBuilds++;
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
        preview = makeMelody(timbre, stringOver, pluckzOver);
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
      talaVol = vol;                         // so a rebuild comes back at THIS level
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
      droneWanted = null;      // asked for silence: an interruption must not bring it back
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
      // A backend that is gone must not leave a handler resuming a context on its behalf.
      if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisible);
      const raw = rawCtx();
      if (raw && raw.removeEventListener) raw.removeEventListener('statechange', wake);
    },
  };
  return b;
}
