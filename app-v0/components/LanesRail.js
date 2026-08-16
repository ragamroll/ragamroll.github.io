import { html } from '../vendor/htm-preact.js';
import { useRef, useEffect, useMemo, useState } from '../vendor/hooks.module.js';
import { buildRollModel } from '../core/roll-model.js';

// What is SUNG, beside the roll — the source notation's written swaras and the sahitya,
// aligned to the notes by hand in the lane editor and carried on the notes themselves.
//
// It is a READER here. The alignment is a judgement of the ear made a note at a time, and
// the page that makes it is /lanes.html; what the app owes is to show the result against
// the piece, at the same pitch of scroll, while it plays.
//
// Time is the roll's axis, so this borrows the roll's own mapping rather than deriving a
// second one: `yVirt(t)` places a group in the tall virtual space the roll scrolls
// through, and the rail then holds a single inner div translated by the holder's
// scrollTop. One transform per scroll, hundreds of boxes laid out once — the alternative,
// re-rendering every box against a new scroll position, is a vdom diff sixty times a
// second to move a column of text that has not changed.

// The groups on each note, in time order. A note can carry several written swaras (a whole
// gesture's worth) or several syllables, separated by spaces; they subdivide the note's own
// span, which is exactly how the lane editor lays them out — so the two pages draw the same
// alignment rather than two readings of it.
function laneRows(model) {
  let rm;
  try { rm = buildRollModel(model); } catch { return []; }
  const rows = [];
  rm.notes.forEach((n, i) => {
    const t0 = rm.starts[i];
    for (const [lane, text] of [['w', n.written], ['s', n.sahitya]]) {
      if (typeof text !== 'string' || !text.trim()) continue;
      const parts = text.trim().split(/\s+/);
      parts.forEach((p, j) => rows.push({
        lane, text: p, t: t0 + (n.dur * j) / parts.length, dur: n.dur / parts.length,
      }));
    }
  });
  return rows;
}

// Does this piece carry an alignment at all? Most do not, and a rail of empty columns is
// width taken from the roll for nothing.
export function hasLanes(model) {
  if (!model || !Array.isArray(model.events)) return false;
  return model.events.some((e) => e.type === 'note'
    && ((typeof e.written === 'string' && e.written.trim())
      || (typeof e.sahitya === 'string' && e.sahitya.trim())));
}

export function LanesRail({ model, rollRef, holderRef, side = 'left', headRef }) {
  const inner = useRef(null);
  const rows = useMemo(() => laneRows(model), [model]);
  // The height of the roll's virtual space, and the reason this component re-renders. It
  // changes on a new piece, a time zoom, a grid stretch and a pane resize — every one of
  // which moves where a group belongs — and only some of those pass through a prop.
  const [virt, setVirt] = useState(0);

  useEffect(() => {
    const hd = holderRef.current;
    if (!hd) return undefined;
    const sync = () => {
      const r = rollRef.current;
      if (!r || !inner.current) return;
      setVirt(r.virtH());
      inner.current.style.transform = `translateY(${-hd.scrollTop}px)`;
    };
    sync();
    hd.addEventListener('scroll', sync, { passive: true });
    // The tall content div IS the virtual space, so its height is the one signal that
    // catches every way the mapping can change — including a zoom or a stretch, which
    // reach the roll imperatively and never re-render this.
    const ro = new ResizeObserver(sync);
    if (hd.firstElementChild) ro.observe(hd.firstElementChild);
    ro.observe(hd);
    return () => { hd.removeEventListener('scroll', sync); ro.disconnect(); };
  }, [model, side]);

  const r = rollRef.current;
  const y = (t) => (r ? r.yVirt(t) : 0);
  return html`<div class=${'lanes-rail ' + side} style=${`order:${side === 'left' ? 0 : 4}`}>
    <div class="lanes-inner" ref=${inner} style=${`height:${virt}px`}>
      <!-- The playhead, in the SAME virtual space as the groups: it lives inside the inner
           div, so the scroll that moves them moves it, and the app writes its position
           straight to this element on the frame it already computes one. Passing it as a
           prop would re-render this column sixty times a second to move a line. -->
      <div class="lane-head" ref=${headRef} hidden></div>
      ${r && rows.map((g, i) => html`<div key=${i} class=${'lane-box ' + g.lane}
        style=${`top:${y(g.t).toFixed(1)}px;height:${Math.max(9, y(g.t + g.dur) - y(g.t) - 1).toFixed(1)}px`}
        title=${g.text}><span>${g.text}</span></div>`)}
    </div>
  </div>`;
}
