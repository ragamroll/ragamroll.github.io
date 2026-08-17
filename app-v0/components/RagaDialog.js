import { html } from '../vendor/htm-preact.js';
import { useState, useEffect, useMemo, useRef } from '../vendor/hooks.module.js';
import { parse } from '../core/parser.js';
import { buildSequence } from '../core/midi/sequence.js';
import { scheduleEvents, totalSeconds } from '../audio/schedule.js';
import { saBaseOf, applyPlaybackPitch } from '../core/retune.js';
import { ragaPreviewSrgm } from '../core/raga-preview.js';
import { getRagaExt, deriveArohaAvarohana } from '../core/raga-ext.js';
import { droneFreqs } from '../audio/drone.js';
import { loadCorpus } from '../core/raga-seed.js';
import { titleCase, padMelaName } from '../core/reference.js';
import { ragaMela } from '../core/raga-shruti.js';
import { switchboardSvg, noOctaveMarks } from '../core/raga-switchboard.js';
import { RollPane } from './RollPane.js';

// The raga browser: what has actually been notated of each raga, and what each raga is.
//
// This was the shruti grid — 22 columns of a/b comma toggles — and is now the corpus the
// /ragas page shows, in the app, where the player already lives. A card per raga; a row
// per recording that has been notated from it (the arohana/avarohana, and the signature
// phrase); press a row and the roll opens under it and plays.
//
// The recordings themselves are not here and never were: the audio lives at ragasurabhi
// and this ships the NOTATION taken from it. So a row plays the way everything else in
// the app plays — the notation, through the app's own player.
//
// The tala is silent by contract rather than by a slider. These are arohanas and phrases
// sung free of any cycle; the notation says `Tala=adi,1` only because the notator always
// writes a tala, so accenting them would be counting something nobody sang.
const hidden = (n) => n === 'c12' || /^mela_\d+$/.test(n);

// Arohana/avarohana text: the authored ext form, else the straight scale.
function arohaAvaroha(ragas, name) {
  const ext = getRagaExt(name);
  if (ext?.arohana) return { aroha: ext.arohana, avaroha: ext.avarohana };
  const d = deriveArohaAvarohana(ragas?.[name]?.C12_SWARAS);
  return { aroha: d.arohana, avaroha: d.avarohana };
}

const KIND_LABEL = { aroha: 'arohana · avarohana', signature: 'signature phrase' };

// The drone starts QUIETER here than under a piece. A recording is one voice moving
// through the raga and the tonic is a reference for it, not an accompaniment to it — at
// the level the transport uses, the drone sits on top of the very ornaments this browser
// exists to let you hear. The slider goes where you like from there.
const PREVIEW_DRONE = 0.22;

export function RagaDialog({ ragas, player, saMidi = 60, droneLevel = 0.5, ragaName, stopMain, onEdit, onClose }) {
  // The corpus, fetched once when the dialog opens. Absent in a dev tree where the
  // notation generator has never run — then every raga still gets its scale row, which is
  // what the browser could always play, rather than an empty dialog and no explanation.
  const [corpus, setCorpus] = useState(null);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => { loadCorpus().then((c) => { setCorpus(c); setLoaded(true); }).catch(() => setLoaded(true)); }, []);

  const names = useMemo(() => Object.keys(ragas || {}).filter((n) => !hidden(n))
    .sort((a, b) => padMelaName(a).localeCompare(padMelaName(b))), [ragas]);

  // raga -> its recordings. A raga with none still gets a card: the scale is the thing
  // every raga has, and it is playable from the database alone.
  const byRaga = useMemo(() => {
    const m = new Map();
    for (const r of corpus?.ragas || []) m.set(r.raga, r.rows || []);
    return m;
  }, [corpus]);

  const [q, setQ] = useState('');
  const [open, setOpen] = useState(null);        // `${raga}:${kind}` — the row showing its roll
  const [playing, setPlaying] = useState(null);
  const [drone, setDrone] = useState(() => Math.min(droneLevel, PREVIEW_DRONE));
  const rollApi = useRef(null);
  const rafRef = useRef(0);
  const totalRef = useRef(0);

  const stop = () => {
    cancelAnimationFrame(rafRef.current);
    try { player.fadeOutStop(0.12); } catch { try { player.stop(); player.droneOff(); } catch { /* mid-teardown */ } }
    setPlaying(null);
    const r = rollApi.current; if (r) r.setPlayhead(null).render();
  };
  // The preview roll, for guards: what the sheet is actually drawing. Same shape as the
  // app's own window.__app.roll(), and torn down with the dialog so nothing outlives it.
  useEffect(() => {
    if (window.__app) window.__app.previewRoll = () => rollApi.current;
    return () => { if (window.__app) delete window.__app.previewRoll; };
  }, []);
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') { stop(); onClose(); } };
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('keydown', onKey); stop(); };
  }, []);

  // The notation a row plays: a recording's own srgm, or — for a raga with none — the
  // plain scale the database describes.
  const srgmOf = (raga, kind) => {
    if (kind === 'scale') return ragaPreviewSrgm(raga, getRagaExt(raga), ragas);
    return (byRaga.get(raga) || []).find((r) => r.kind === kind)?.srgm || '';
  };

  const play = async (raga, kind) => {
    stopMain?.();
    stop();
    const src = srgmOf(raga, kind); if (!src) return;
    const model = parse(src);
    const seq = buildSequence(model);
    if (totalSeconds(seq) <= 0) return;
    const saBase = saBaseOf(model, ragas);
    applyPlaybackPitch(seq, model, null, saBase, saMidi - (60 + saBase));   // land Sa on the app's Sa
    player.onended = () => stop();
    // talaGain 0, not a filtered track: the events are still scheduled, so nothing about
    // the piece changes — it is the accents that are silent.
    player.load(scheduleEvents(seq), totalSeconds(seq), { talaGain: 0 });
    setPlaying(`${raga}:${kind}`);
    setOpen(`${raga}:${kind}`);
    try {
      await player.play();                      // unlock the AudioContext before the drone
      if (drone > 0) player.setDrone(droneFreqs(saMidi), drone);
      player.fadeIn(0.06);
      // The playhead is read from the audio, not counted alongside it, so it cannot drift
      // from what is sounding. Driven straight into the roll rather than through state:
      // it moves sixty times a second and the vdom has nothing to say about it.
      //
      // Its span comes from the SEQUENCE, not from bounds().total — the grid can be
      // longer than the music (an empty tail, a stretched grid), and the playhead has to
      // track what is sounding rather than what is drawn.
      const secPerUnit = 30 / (model.meta?.tempo > 0 ? model.meta.tempo : 120);
      totalRef.current = totalSeconds(seq) / secPerUnit;
      const tick = () => {
        const r = rollApi.current;
        if (r) {
          const pos = player.position() * totalRef.current;
          r.setPlayhead(pos).render();
          // And the roll SCROLLS to keep up. A recording is longer than the sheet, so
          // without this the playhead walks off the bottom and the picture stops being
          // about the sound. Kept at 40% of the way down, so what is coming is visible.
          const hd = document.querySelector('.rg-sheet .roll-holder');
          if (hd) {
            hd.scrollTop = Math.max(0, Math.min(Math.max(0, r.virtH() - hd.clientHeight),
              r.yVirt(pos) - hd.clientHeight * 0.4));
          }
        }
        rafRef.current = requestAnimationFrame(tick);
      };
      rafRef.current = requestAnimationFrame(tick);
    } catch { stop(); }
  };

  // Live: dragging the drone while a row plays changes what you hear, rather than what
  // the next press will sound like.
  const onDrone = (v) => {
    setDrone(v);
    if (playing) { if (v > 0) player.setDrone(droneFreqs(saMidi), v); else player.droneOff(); }
  };

  const openRow = (raga, kind) => {
    const key = `${raga}:${kind}`;
    if (open === key) { if (playing === key) stop(); setOpen(null); return; }
    play(raga, kind);
    // Bring the card being played into view. The roll takes the lower half, so the card
    // you pressed can easily be the one the list is no longer showing — and what is
    // playing is the one thing you want on screen while it plays.
    requestAnimationFrame(() => {
      const el = document.querySelector(`.rg-card[data-raga="${raga}"]`);
      if (el) el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    });
  };

  const stopEvt = (e) => e.stopPropagation();
  const close = () => { stop(); onClose(); };

  const needle = q.trim().toLowerCase();
  const filtered = needle
    ? names.filter((n) => padMelaName(n).toLowerCase().includes(needle) || n.toLowerCase().includes(needle))
    : names;
  const recorded = filtered.filter((n) => byRaga.has(n)).length;

  const rowsFor = (raga) => {
    const rs = byRaga.get(raga) || [];
    return rs.length ? rs : [{ kind: 'scale', notes: 0 }];
  };

  // The roll is a SHEET at the foot of the dialog, not a panel inside a card. You are
  // comparing ragas: opening one inside its card pushes every other card down the page
  // and takes the list away from you. The sheet stays put while the list scrolls behind
  // it, which is what the /ragas page does and for the same reason.
  const sheet = () => {
    if (!open) return null;
    const [raga, kind] = open.split(':');
    const src = srgmOf(raga, kind);
    if (!src) return null;
    const isPlaying = playing === open;
    return html`<div class="rg-sheet">
      <div class="rg-sheethd">
        <button class=${'rg-play' + (isPlaying ? ' on' : '')} title=${isPlaying ? 'Stop' : 'Play'}
                onClick=${() => (isPlaying ? stop() : play(raga, kind))}>${isPlaying ? '⏹' : '▶'}</button>
        <label class="rg-drone" title="Drone level">
          <input type="range" min="0" max="1" step="0.05" value=${drone}
                 onInput=${(e) => onDrone(parseFloat(e.target.value))} />
        </label>
        <b class="rg-sheetname">${titleCase(padMelaName(raga))}</b>
        <!-- Into the editor. The curation page has carried an "edit in the app" link since
             there was a curation page: a browser is for finding the phrase, and the moment
             you have found it the thing you want is to change it. It was lost when the
             generated page stopped being published and this dialog took its place. -->
        ${onEdit && html`<button class="rg-edit" title="Open this notation in the editor"
          onClick=${() => { stop(); onEdit(src, `${padMelaName(raga)}-${kind}`); }}>Edit ↗</button>`}
        <button title="Close" onClick=${() => { stop(); setOpen(null); }}>✕</button>
      </div>
      <${RollPane} model=${parse(src)} api=${rollApi} allow=${[]} sel=${null} zoom=${1} chrome=${false} />
    </div>`;
  };

  return html`<div class="dialog-backdrop" onClick=${close}>
    <div class="dialog-box raga2-box" onClick=${stopEvt} role="dialog" aria-modal="true" aria-label="Ragas">
      <div class="dialog-head">
        <strong>Ragas</strong>
        <button title="Close" onClick=${close}>✕</button>
      </div>
      <div class="dialog-body">
        <div class="ref-controls">
          <input class="dialog-search" type="search" placeholder="filter ragas…" value=${q}
                 autofocus onInput=${(e) => setQ(e.target.value)} />
          <div class="dialog-count">${filtered.length} / ${names.length} ragas${
            corpus ? html` · ${recorded} notated from recordings` : ''}</div>
        </div>

        ${loaded && !corpus && html`<div class="rg-nocorpus">
          No notated recordings in this build — every raga still plays its scale.
          The corpus is generated by <code>node tools/notate-batch.mjs</code> and published by
          <code>tools/build-app-v0.sh</code>.
        </div>`}

        <div class="rg-scroll">
          ${filtered.map((n) => {
            const mela = ragaMela(ragas, n);
            const { aroha, avaroha } = arohaAvaroha(ragas, n);
            return html`<div key=${n} data-raga=${n} class=${'rg-card' + (n === ragaName ? ' cur' : '')}>
              <div class="rg-hd">
                <b class="rg-name">${titleCase(padMelaName(n))}</b>
                ${mela ? html`<span class="rg-mela">mela ${mela.n}</span>` : ''}
              </div>
              <div class="rg-scale">↑ ${noOctaveMarks(aroha)}<span class="rg-sep">·</span>↓ ${noOctaveMarks(avaroha)}</div>
              <!-- The switchboard: the raga's own swaras in the keys they occupy, the
                   ascent's wires over the top and the descent's under the bottom. It is
                   what a reader looks at first on the /ragas page, and it was missing
                   here only because the generator kept the code to itself. -->
              <div class="rg-kbd" dangerouslySetInnerHTML=${{ __html: switchboardSvg({ aroha, avaroha }, ragas, n) }} />
              ${rowsFor(n).map((r) => {
                const key = `${n}:${r.kind}`;
                const isPlaying = playing === key;
                const isOpen = open === key;
                return html`<div key=${key} class=${'rg-row' + (isOpen ? ' open' : '')}>
                  <div class="rg-rowhd">
                    <button class=${'rg-play' + (isPlaying ? ' on' : '')}
                            title=${isPlaying ? 'Stop' : 'Play'}
                            onClick=${() => (isPlaying ? stop() : openRow(n, r.kind))}>${isPlaying ? '⏹' : '▶'}</button>
                    <span class="rg-kind">${KIND_LABEL[r.kind] || 'scale'}</span>
                    <span class="rg-meta">${r.kind === 'scale'
                      ? 'from the database — nothing recorded'
                      : `${r.notes} notes · ~${r.oct} oct${r.sa ? ` · Sa ${r.sa} Hz` : ''}${r.curated ? ' · checked' : ''}`}</span>
                  </div>
                </div>`;
              })}
            </div>`;
          })}
        </div>
        ${sheet()}
      </div>
    </div>
  </div>`;
}
