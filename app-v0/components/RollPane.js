import { html } from '../vendor/htm-preact.js';
import { useRef, useEffect } from '../vendor/hooks.module.js';
import { createRagamRoll } from '../core/ragamroll.js';
import { buildRollModel } from '../core/roll-model.js';

// The roll, on the app's page. A thin wrapper: Preact owns three elements and
// nothing inside them, because the roll is a canvas and there is no tree to diff —
// every frame of it is imperative drawing. So the instance is created once, told
// about a new piece when one arrives, and otherwise left alone.
//
// It is also why the playhead is NOT a prop. Passing it would re-render through the
// vdom sixty times a second to change one line's position. The parent takes the
// instance out of `api` and drives it directly from its own rAF loop, which is where
// the transport clock already lives.
export function RollPane({ model, api, style }) {
  const holder = useRef(null), content = useRef(null), canvas = useRef(null);
  const roll = useRef(null);

  useEffect(() => {
    const r = createRagamRoll({ holder: holder.current, content: content.current, canvas: canvas.current }, {
      palette: () => ({ amber: '#d8a13f', amberS: 'rgba(216,161,63,.55)', teal: '#46c39a',
        terra: '#c96b5a', hair: 'rgba(236,231,217,.10)', muted: '#9a9280',
        panel2: '#1a1a1a', mono: 'ui-monospace, Menlo, Consolas, monospace' }),
    });
    roll.current = r;
    if (api) api.current = r;
    // The pane is resized by the splitters, not only by the window, so the canvas
    // has to follow the element rather than the viewport.
    const ro = new ResizeObserver(() => r.resize());
    ro.observe(holder.current);
    r.resize();
    return () => { ro.disconnect(); roll.current = null; if (api && api.current === r) api.current = null; };
  }, []);

  useEffect(() => {
    const r = roll.current; if (!r || !model) return;
    try { r.setModel(buildRollModel(model)); } catch { return; }   // a half-typed piece: keep the last good roll
    r.setPlayhead(null).resize();
  }, [model]);

  return html`<div class="pane roll" style=${style}>
    <div class="roll-holder" ref=${holder}><div ref=${content}><canvas ref=${canvas}></canvas></div></div>
  </div>`;
}
