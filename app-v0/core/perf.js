// WHAT THE DEVICE ACTUALLY DID, recorded while a piece plays.
//
// Reported from a phone: the roll skips, as if catching up, and the sound crackles with it.
// It cannot be reproduced on a desktop — measured, at twenty times the CPU throttling — and
// there is no console on a phone to ask. So the app records what happened and shows it,
// short enough to be typed into a message if nothing else works.
//
// THREE DIFFERENT FAULTS look alike from the outside and are told apart here:
//
//   - the MAIN THREAD was blocked   -> long tasks, and frame gaps that follow them
//   - the AUDIO THREAD starved      -> note margins going to zero while frames stay smooth
//   - something LEAKED              -> live sources climbing across a session
//
// Bounded memory on purpose. This runs for as long as the app is open, so nothing here keeps
// a sample: gaps go into a histogram, and everything else is a count, a max or a min. A
// diagnostic that grows without limit is a diagnostic that causes what it measures.

// Bucket edges in milliseconds. Chosen around the frame budget rather than round numbers:
// 16.7 is one frame at 60Hz, 33 is two, and past 100 the reader has SEEN it happen.
const EDGES = [8, 12, 17, 25, 33, 50, 100, 200, 400];

function bucket(ms) {
  for (let i = 0; i < EDGES.length; i++) if (ms < EDGES[i]) return i;
  return EDGES.length;
}

export function createPerf() {
  let bins = new Array(EDGES.length + 1).fill(0);
  let frames = 0, frameMax = 0;
  let longCount = 0, longMax = 0, longMs = 0;
  let notes = 0, late = 0, minMargin = Infinity;
  let sourcesNow = 0, sourcesMax = 0;
  let playMs = 0, plays = 0;
  let device = null;

  // Percentile off the histogram: the bucket the nth sample falls in, reported as its upper
  // edge. Coarse by construction — the question is "is this a frame, two frames, or a visible
  // stall", and a number to the millisecond would suggest a precision it lacks.
  //
  // CLAMPED TO THE WORST FRAME ACTUALLY SEEN. A bucket's upper edge can be above anything
  // that happened: eight frames whose worst was 120ms reported a p95 of 200, which is a
  // number no frame ever took. A reader comparing p95 against max would rightly not believe
  // either of them.
  const pct = (q) => {
    if (!frames) return 0;
    const want = Math.ceil(frames * q);
    let seen = 0;
    for (let i = 0; i < bins.length; i++) {
      seen += bins[i];
      if (seen >= want) return Math.round(Math.min(i < EDGES.length ? EDGES[i] : EDGES[EDGES.length - 1], frameMax));
    }
    return Math.round(Math.min(EDGES[EDGES.length - 1], frameMax));
  };

  return {
    // One animation frame went by. Called from the loop that already runs; the cost is one
    // subtraction and one array bump.
    frame(ms) {
      if (!(ms > 0) || ms > 60000) return;         // a tab that was away is not a slow frame
      bins[bucket(ms)]++; frames++;
      if (ms > frameMax) frameMax = ms;
    },
    // The browser says the main thread was blocked for this long.
    longTask(ms) {
      if (!(ms > 0)) return;
      longCount++; longMs += ms;
      if (ms > longMax) longMax = ms;
    },
    // How far AHEAD of its audio time a scheduled note was handed to the voice. It should be
    // roughly the lookahead; at or below zero the note was built after the moment it was for,
    // which is a crackle with a cause rather than a guess.
    noteMargin(sec) {
      if (typeof sec !== 'number' || !isFinite(sec)) return;
      notes++;
      if (sec <= 0) late++;
      if (sec < minMargin) minMargin = sec;
    },
    // Live one-shot sources in the voice. Climbing across a session is a leak; steady is not.
    sources(n) {
      if (!(n >= 0)) return;
      sourcesNow = n;
      if (n > sourcesMax) sourcesMax = n;
    },
    played(ms) { if (ms > 0) { playMs += ms; plays++; } },
    setDevice(d) { device = d; },

    // ONE LINE, and it has to survive being retyped by hand off a phone screen. Fixed order,
    // no words that are not load-bearing.
    summary() {
      const f = (x, d = 0) => (Number.isFinite(x) ? x.toFixed(d) : '-');
      return [
        `${f(playMs / 1000)}s/${plays}`,
        `lt ${longCount}/${f(longMax)}ms`,
        `fr ${f(pct(0.5))}/${f(pct(0.95))}/${f(frameMax)}`,
        `late ${late}/${notes}`,
        minMargin === Infinity ? 'mrg -' : `mrg ${f(minMargin * 1000)}ms`,
        `src ${sourcesNow}/${sourcesMax}`,
      ].join(' ');
    },

    detail() {
      return {
        playSeconds: +(playMs / 1000).toFixed(1), plays,
        longTasks: longCount, longestMs: Math.round(longMax), blockedMs: Math.round(longMs),
        frames, framesP50: pct(0.5), framesP95: pct(0.95), frameMaxMs: Math.round(frameMax),
        overOneFrame: bins.slice(bucket(17)).reduce((a, x) => a + x, 0),
        notes, lateNotes: late,
        worstMarginMs: minMargin === Infinity ? null : +(minMargin * 1000).toFixed(1),
        liveSources: sourcesNow, mostSources: sourcesMax,
        histogram: EDGES.map((e, i) => [e, bins[i]]).concat([['more', bins[EDGES.length]]]),
        device,
      };
    },

    reset() {
      bins = new Array(EDGES.length + 1).fill(0);
      frames = 0; frameMax = 0;
      longCount = 0; longMax = 0; longMs = 0;
      notes = 0; late = 0; minMargin = Infinity;
      sourcesMax = sourcesNow;
      playMs = 0; plays = 0;
    },
  };
}

// The browser's own report that the main thread was blocked. Separate from the recorder so
// the recorder stays pure and testable, and so a browser without the entry type simply
// records nothing rather than throwing.
export function watchLongTasks(perf) {
  try {
    const po = new PerformanceObserver((list) => {
      for (const e of list.getEntries()) perf.longTask(e.duration);
    });
    po.observe({ entryTypes: ['longtask'] });
    return () => po.disconnect();
  } catch (_) { return () => {}; }
}

// What this device is, for reading the numbers above against. Everything here is a fact the
// device reports about itself; none of it identifies anyone.
export function deviceFacts(ctx, extra = {}) {
  const c = ctx || null;
  const disp = (m) => { try { return matchMedia(m).matches; } catch (_) { return false; } };
  return {
    sampleRate: c ? c.sampleRate : null,
    baseLatencyMs: c && c.baseLatency != null ? +(c.baseLatency * 1000).toFixed(1) : null,
    outputLatencyMs: c && c.outputLatency != null ? +(c.outputLatency * 1000).toFixed(1) : null,
    dpr: +(globalThis.devicePixelRatio || 1).toFixed(2),
    viewport: `${Math.round(globalThis.innerWidth || 0)}x${Math.round(globalThis.innerHeight || 0)}`,
    installed: disp('(display-mode: standalone)') || disp('(display-mode: fullscreen)'),
    cores: navigator.hardwareConcurrency || null,
    ...extra,
  };
}
