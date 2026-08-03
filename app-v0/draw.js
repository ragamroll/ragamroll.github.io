// Gamaka draw page. Opens the current composition (localStorage, or a shared
// #pako link) as a pitch/time roll and lets the user draw a pitch curve per note.
// Pitch is 53-EDO (22-shruti): notes sit on their default shruti, snap targets
// the 22 shrutis, audio is microtonal. Curves + the srgm source pack into a
// #pako link (melody + gamakas).
import { parse, TALA_MAP } from './core/parser.js';
import { setRagas, getRagas, resolveRagaName } from './core/raga-base.js';
import { setRagaExt, getRagaExt } from './core/raga-ext.js';
import { chooseSeed } from './core/raga-seed.js';
import { midiToFreq } from './audio/schedule.js';
import { BOXES, EDO, stepFreq, defaultShrutiStep } from './core/shruti.js';
import { encodeShareToken, decodeShareToken } from './core/share.js';
import { VERSION, BUILD_DATE } from './version.js';
import { midiToName } from './core/tuning.js';
import { serializeInline } from './core/gamaka-inline.js';
import { extractAnchors, pointsToAnchors, addAnchor, removeAnchor, moveAnchor } from './core/gamaka-curve.js';
import { buildSequence } from './core/midi/sequence.js';
import { writeSMF } from './core/midi/smf.js';
import { serializeModel, snapToRagaRow, snapToAkshara, placePaint, splitSpans, ragaRowsInRange, octMarks } from './core/note-edit.js';
import { buildRagaSteps } from './core/detect-raga-helper.js';
// Aliased: shruti.js exports a DIFFERENT stepForLetter(scale, letter). This one
// is (letter, approxStep, ragaSwaraName) -> the raga's own step for that letter.
import { stepToSwara, stepForLetter as stepForRagaLetter } from './core/detect.js';

const LS_KEY = 'ragamroll.srgm';
const SHRUTI = [...new Set(BOXES.map(b => b.step))].sort((a, b) => a - b);   // 22 steps in an octave

// ---------- model built from the parsed composition ----------
let NOTES = [];        // [{step, dur, swara, octave, curve:null|[[u,step]...]}]
let saRef = 60, saFreq = midiToFreq(60), tempoBpm = 120, TOTAL = 0;
let saPlay = null;     // Sa reference-pitch override (midi); null = auto (= saRef, the layout anchor)
let compTempo = 120;   // the composition's own tempo; the tempo slider is a multiplier of this
let starts = [], gridPitches = [], stepMin = -26, stepMax = 66, srcText = '';
let contentEnd = 0;   // true content end from buildModel's starts-loop cursor `t` (rests included; 0 for a blank piece)
let userGridMin = null, userGridMax = null, userGridBottom = null;  // handle-stretched roll bounds (view-state, NOT saved)
let talaMeasure = 0, talaAccents = [], talaBeat = 0;   // cycle length + 1-based accent slots + akshara length (length-units)
let docName = 'ragamroll';               // base filename for Save / Export MIDI
let curRaga = '', curTala = '', curTalaName = 'adi';   // readout + current tala name (for the picker)
let defaultRaga = 'c12';                                 // set at boot to the first raga in the picker list
const blankSrc = () => `Raga=${defaultRaga},0\nTala=adi,4\nO=5 L=1\n`;   // Blank/New skeleton (no notes)

function stepOfSemitone(semi){ const oct = Math.floor(semi / 12), pc = semi - oct * 12; return oct * EDO + defaultShrutiStep(pc); }
function buildModel(src){
  srcText = src || '';
  const model = parse(srcText);
  // Keep the ordinal of each in-model note among ALL note tokens (rests included),
  // so serialization lands the gamaka on the exact source token (rests + out-of-raga
  // swaras are note events too and must be counted). `tok` = that ordinal.
  const allNotes = model.events.filter(e => e.type === 'note');
  const keep = []; allNotes.forEach((e, ord) => { if (!e.rest && e.absLen > 0) keep.push(ord); });
  const notes = keep.map(ord => allNotes[ord]);
  compTempo = (model.meta && model.meta.tempo > 0) ? model.meta.tempo : 120;
  tempoBpm = compTempo;   // reset to the composition tempo on (re)load; the slider re-applies its multiplier
  const sNote = notes.find(n => n.swara === 'S' || n.swara === 's');
  saRef = sNote ? sNote.midi - (sNote.octave - 5) * 12 : (notes.length ? Math.min(...notes.map(n => n.midi)) : 60);
  saPlay = null;          // reset Sa override to auto on a new composition
  saFreq = midiToFreq(saRef);   // saRef is the LAYOUT anchor (steps); saPlay only retunes playback
  // The raga has to be resolved BEFORE the notes: each note's step is read back
  // through the raga's own shruti for its letter, not just the 12-EDO
  // reconstruction. stepOfSemitone puts every semitone on its default JI-12
  // shruti, which is wrong wherever the raga assigns that letter a different
  // comma (mela_1's G1 is step 8; semitone 2 defaults to 9), so a piece written
  // out and read back moved by a comma. The notation already names the raga, so
  // nothing extra is needed in it — the reader just has to ask. stepForRagaLetter
  // falls through to the reconstruction when the raga has no such letter, and
  // when there is no raga at all.
  const rk = [...model.events].reverse().find(e => e.type === 'raga');
  curRaga = rk ? String(rk.key[0]) : '';
  const { ragaSwaraName: readBackNames } = buildRagaSteps(curRaga || '');
  NOTES = notes.map((n, i) => {
    const step = stepForRagaLetter(n.swara.toUpperCase(), stepOfSemitone(n.midi - saRef), readBackNames);
    // Inline gamaka is stored NOTE-RELATIVE (delta); the roll model is absolute.
    const curve = (Array.isArray(n.gamaka) && n.gamaka.length) ? n.gamaka.map(([u, d]) => [u, step + d]) : null;
    return { step, dur: n.absLen, swara: n.swara.toUpperCase(), octave: n.octave, curve, tok: keep[i] };
  });
  // True composition time: advance the cursor over rests too (silent gaps, no box),
  // so the roll's time axis matches the audio and the tala grid — a leading/interior
  // rest shows as empty time instead of being compressed out.
  starts = []; let t = 0, ki = 0;
  for (let o = 0; o < allNotes.length; o++){
    if (ki < keep.length && keep[ki] === o){ starts.push(t); ki++; }
    if (allNotes[o].absLen > 0) t += allNotes[o].absLen;
  }
  contentEnd = t;   // true content end (rests included) — see recomputeGridBounds()
  const tp = [...model.events].reverse().find(e => e.type === 'tala');   // accent strums (veena) at tala accents
  talaMeasure = (tp && tp.props && tp.props.measure > 0) ? tp.props.measure : 0;
  talaAccents = (tp && tp.props && Array.isArray(tp.props.accents)) ? tp.props.accents : [];
  talaBeat = (tp && tp.props && tp.props.beat > 0) ? tp.props.beat : 0;
  curTala = tp ? `beat ${tp.props.beat}` : '';
  curTalaName = (srcText.match(/(?:^|\s)Tala=([A-Za-z0-9]+)/) || [])[1] || 'adi';
  recomputeGridBounds();
  markerA = 0; markerB = TOTAL;   // segment bounds default to the whole piece; draggable in the gutter
}
// Recompute TOTAL/stepMin/stepMax/gridPitches from the current NOTES/starts/
// talaMeasure/curRaga/userGrid* module state. Pulled out of buildModel's tail so a
// live handle-stretch (userGrid* changed, nothing re-parsed) can re-derive the grid
// bounds without re-running the parser. Does NOT touch userGrid* itself — only
// loadSrc/applyShared reset those (new composition), same invariant as before.
function recomputeGridBounds(){
  const notesEnd = contentEnd;   // real content end, rests included (0 for a blank piece) — set in buildModel from the starts-loop cursor
  let autoTotal = notesEnd || 1;
  // Blank piece: seed ~2 tala cycles of empty time grid (or 8 units with no tala),
  // instead of a single unit of grid that renders as no usable canvas.
  if (NOTES.length === 0) autoTotal = talaMeasure > 0 ? talaMeasure * 2 : 8;
  TOTAL = userGridBottom != null ? Math.max(userGridBottom, notesEnd, 1) : autoTotal;
  const ps = NOTES.map(n => n.step);
  let notesMin, notesMax, autoMin, autoMax;
  if (ps.length){ notesMin = Math.min(...ps); notesMax = Math.max(...ps); autoMin = notesMin - 9; autoMax = notesMax + 9; }
  else { notesMin = 0; notesMax = EDO; autoMin = -9; autoMax = EDO + 9; }   // blank piece: seed a sensible one-octave-ish pitch range
  stepMin = userGridMin != null ? Math.min(userGridMin, notesMin) : autoMin;
  stepMax = userGridMax != null ? Math.max(userGridMax, notesMax) : autoMax;
  if (!(stepMax > stepMin)) { stepMin = -26; stepMax = 66; }
  gridPitches = buildGridPitches();
}
// Pitch-header rows: the raga's swara rows spanning the current [stepMin,stepMax], plus any
// out-of-raga note pitches. So the full scale shows across the visible range (blank or not) and
// stretching the pitch handles reveals new rows to paint on. No raga (c12) -> note pitches only.
function buildGridPitches(){
  const { ragaSteps, ragaSwaraName } = ragaCtx();
  const rows=new Map();
  if (ragaSteps) for (const s of ragaRowsInRange(ragaSteps, stepMin, stepMax))
    rows.set(s, { step:s, label:(ragaSwaraName.get(((s%EDO)+EDO)%EDO)||'') + (Math.floor(s/EDO)+5) });
  for (const n of NOTES) if (!rows.has(n.step)) rows.set(n.step, { step:n.step, label:n.swara+n.octave });
  return [...rows.values()].sort((a,b)=>a.step-b.step);
}
const freqOf = step => stepFreq(saFreq, step);
// Is a swara (53-EDO step from Sa) nearest a black piano key, given the chosen Sa?
// 53-EDO shrutis don't align exactly with 12-EDO — this snaps to the nearest semitone.
const BLACK_PC = new Set([1,3,6,8,10]);
function keyIsBlack(step){ const saMidi=(saPlay==null?saRef:saPlay); const m=Math.round(saMidi+12*step/EDO); return BLACK_PC.has(((m%12)+12)%12); }
const secPerUnit = () => 30 / tempoBpm;
function snapStep(s){ const oct = Math.floor(s / EDO), base = s - oct * EDO; let best = SHRUTI[0], bd = Infinity;
  for (const sh of [...SHRUTI, EDO]){ const d = Math.abs(base - sh); if (d < bd){ bd = d; best = sh; } }
  return oct * EDO + best; }

// ---------- canvas ----------
const cv = document.getElementById('cv'), ctx = cv.getContext('2d');
let CSSW=0, CSSH=0, dpr=1, mode='roll', sel=-1, drawing=false, drawSpan=22, dragIdx=-1;
// Roll-mode long-press grab (move/resize a note). paintMode is wired to the
// `+ note` toolbar toggle below; grab and paint gestures are mutually exclusive.
let grab=null, pressTimer=0, pressXY=null, justGrabbed=false, paintMode=false, gamakaMode=false;   // grab: {idx, kind:'move'|'resize', oldStep, oldDur, pid}
let paint=null;   // paint={ts, step?, rest?, dur, pid} — in-progress paint-a-note/rest drag (roll mode, paintMode on)
let gamaStroke=null;   // in-roll gamaka gesture: {gi, pid, dragIdx, downX, downY, buffer, mode:'anchor'|'free'|'pending'}
const HANDLE_PX=18;
const REST_LANE_PX=22;   // width of the rest-paint gutter at the left edge of the plot area (roll, paint mode)
const ROLL_TOUCH_ACTION='pan-y';   // touchAction roll mode uses when idle (matches resizeCanvas below)
// Grid stretch-handles (pitch-low/pitch-high/time-bottom) — shared sizing between
// the render() draw and hitGridHandle()'s hit-test so they stay in lockstep.
const GRIP_THICK=14, GRIP_LEN=HANDLE_PX*2.6;
let handleDrag=null;   // {which:'pmin'|'pmax'|'tbottom', pid}
// TEMP DEBUG (grid-handle grab diagnosis) — remove after diagnosing.
// Roll is always fully expanded: scale time so the SHORTEST note cell is at least
// CELL_PX tall — enough to render its swara glyph, mobile portrait included.
const CELL_PX = 24;
let zoom = 1;   // expand multiplier (1 = fully expanded: shortest cell = CELL_PX)
function pxPerUnit(){ if (!NOTES.length) return CELL_PX; const minDur=Math.min(...NOTES.map(n=>n.dur)); return CELL_PX/Math.max(0.25,minDur); }
function pxU(){ return pxPerUnit()*zoom; }                          // pixels per length-unit (virtual roll space)
function virtH(){ return Math.round(PAD.t + TOTAL*pxU() + PAD.b); } // full virtual scroll height (roll)
const yVirt = t => PAD.t + t*pxU();                                // roll virtual y (content coords, pre-scroll)
const sTop = () => (mode==='roll' ? document.getElementById('holder').scrollTop : 0);
let playing=false, paused=false, playStart=0, rafId=0, playPos=null;   // playhead (length-units)
let playFromU=0, playToU=0, pausedAt=0, pausedTo=0;                    // playback range + pause point
let markerA=0, markerB=0, ctxTime=0, markerDrag=null;                 // A–B segment markers (length-units) + drag state
const cssvar = k => getComputedStyle(document.documentElement).getPropertyValue(k).trim();
const PAD = { l:40, r:12, t:24, b:12 };
const plot = () => ({ x:PAD.l, y:PAD.t, w:CSSW-PAD.l-PAD.r, h:CSSH-PAD.t-PAD.b });
function xRange(){ if (mode==='draw'){ const c=NOTES[sel].step; return [c-drawSpan, c+drawSpan]; } return [stepMin, stepMax]; }
function X(s){ const [a,b]=xRange(), p=plot(); return p.x + (s-a)/(b-a)*p.w; }
function stepAtX(px){ const [a,b]=xRange(), p=plot(); return a + (px-p.x)/p.w*(b-a); }
function yStartEnd(){ if (mode==='draw') return [starts[sel], starts[sel]+NOTES[sel].dur]; return [0, TOTAL]; }
// Draw mode fits the single note to the viewport. Roll mode is WINDOWED: time maps
// to a virtual space (PAD.t + t*pxU) taller than the canvas; only the slice under
// the scroll offset (sTop) is drawn, so a long piece never needs a giant canvas.
function Y(t){ if (mode==='draw'){ const [a,b]=yStartEnd(), p=plot(); return p.y + (t-a)/(b-a)*p.h; }
  return PAD.t + t*pxU() - sTop(); }
function tAtY(py){ if (mode==='draw'){ const [a,b]=yStartEnd(), p=plot(); return a + (py-p.y)/p.h*(b-a); }
  return (py + sTop() - PAD.t)/pxU(); }

function fit(){ const h=(window.visualViewport&&window.visualViewport.height)||window.innerHeight;
  document.getElementById('wrap').style.height=h+'px'; requestAnimationFrame(resizeCanvas); }
function resizeCanvas(){ const hd=document.getElementById('holder'); const baseH=Math.max(150,hd.clientHeight);
  dpr=Math.min(2,window.devicePixelRatio||1);
  CSSW=hd.clientWidth; CSSH=baseH;   // canvas is always viewport-sized (windowed) — never overflows the browser limit
  const content=document.getElementById('content');
  if (mode==='roll'){ content.style.height=virtH()+'px'; }   // a tall empty div gives the scrollbar its range
  else { content.style.height=baseH+'px'; hd.scrollTop=0; }   // draw mode: one note fills the viewport, no scroll
  cv.width=CSSW*dpr; cv.height=CSSH*dpr; cv.style.width=CSSW+'px'; cv.style.height=CSSH+'px';
  cv.style.touchAction = mode==='draw' ? 'none' : ROLL_TOUCH_ACTION;   // draw: no scroll; roll: allow vertical scroll
  ctx.setTransform(dpr,0,0,dpr,0,0); render(); }

function render(){
  const p=plot(); ctx.clearRect(0,0,CSSW,CSSH);
  const amber=cssvar('--amber'),amberS=cssvar('--amberSoft'),teal=cssvar('--teal'),terra=cssvar('--terra'),hair=cssvar('--hair2'),muted=cssvar('--muted');
  ctx.font='11px '+cssvar('--mono'); const [sa,sb]=xRange();
  // Octave bands (pitch axis): alternate shade per octave (53-EDO); Sa lines at
  // multiples of EDO, with the MIDDLE Sa (step 0) drawn distinctly.
  { const oLo=Math.floor(sa/EDO), oHi=Math.ceil(sb/EDO);
    for (let k=oLo;k<oHi;k++){ if ((((k%2)+2)%2)!==0) continue; const x0=Math.max(p.x,X(k*EDO)), x1=Math.min(p.x+p.w,X((k+1)*EDO));
      if (x1>x0){ ctx.fillStyle='rgba(216,161,63,.05)'; ctx.fillRect(x0,p.y,x1-x0,p.h); } }
    for (let k=oLo;k<=oHi;k++){ const s=k*EDO; if (s<sa-1||s>sb+1) continue; const x=X(s);
      ctx.strokeStyle=(k===0)?terra:amberS; ctx.lineWidth=(k===0)?2:1; ctx.globalAlpha=(k===0)?.5:.28;
      ctx.beginPath(); ctx.moveTo(x,p.y); ctx.lineTo(x,p.y+p.h); ctx.stroke(); ctx.globalAlpha=1; } }
  // Left gutter (holds the draggable A/B segment handles).
  ctx.fillStyle=cssvar('--panel2'); ctx.globalAlpha=.55; ctx.fillRect(0,0,PAD.l,CSSH); ctx.globalAlpha=1;
  ctx.strokeStyle=hair; ctx.lineWidth=1; ctx.beginPath(); ctx.moveTo(PAD.l,0); ctx.lineTo(PAD.l,CSSH); ctx.stroke();
  // Rest gutter: a faint band at the left edge of the plot area, paint mode only —
  // pressing inside it paints a rest (silent gap) instead of a note (see the paint
  // pointerdown listener's `restLane` check, same REST_LANE_PX).
  if (mode==='roll' && paintMode){ ctx.fillStyle='rgba(216,161,63,.09)'; ctx.fillRect(p.x,p.y,REST_LANE_PX,p.h);
    ctx.strokeStyle=hair; ctx.lineWidth=1; ctx.beginPath(); ctx.moveTo(p.x+REST_LANE_PX,p.y); ctx.lineTo(p.x+REST_LANE_PX,p.y+p.h); ctx.stroke();
    ctx.fillStyle=muted; ctx.globalAlpha=.8; ctx.textAlign='center'; ctx.font='bold 11px '+cssvar('--mono');
    ctx.fillText('z', p.x+REST_LANE_PX/2, p.y+13); ctx.globalAlpha=1; ctx.font='11px '+cssvar('--mono'); }
  if (mode==='draw'){ for (let oct=Math.floor(sa/EDO)-1; oct<=Math.floor(sb/EDO)+1; oct++) for (const sh of SHRUTI){ const s=oct*EDO+sh;
    if (s<sa||s>sb) continue; const x=X(s); ctx.strokeStyle=hair; ctx.globalAlpha=.5; ctx.beginPath(); ctx.moveTo(x,p.y); ctx.lineTo(x,p.y+p.h); ctx.stroke(); ctx.globalAlpha=1; } }
  for (const g of gridPitches){ if (g.step<sa-1||g.step>sb+1) continue; const x=X(g.step);
    ctx.strokeStyle=hair; ctx.lineWidth=1; ctx.beginPath(); ctx.moveTo(x,p.y); ctx.lineTo(x,p.y+p.h); ctx.stroke();
    // Header label as a piano-key chip: dark = black key, light = white key
    // (nearest 12-EDO semitone to the chosen Sa).
    const black=keyIsBlack(g.step); ctx.font='bold 10px '+cssvar('--mono');
    const cw=ctx.measureText(g.label).width+8, ch=14, cx=x-cw/2, cy=p.y-19;
    ctx.fillStyle=black?'#20242b':'#efe6d0'; roundRect(cx,cy,cw,ch,4); ctx.fill();
    ctx.strokeStyle='rgba(0,0,0,.25)'; ctx.lineWidth=.5; ctx.stroke();
    ctx.fillStyle=black?'#efe6d0':'#20242b'; ctx.textAlign='center'; ctx.textBaseline='middle'; ctx.fillText(g.label, x, cy+ch/2+.5); ctx.textBaseline='alphabetic';
    ctx.font='11px '+cssvar('--mono'); }
  const [ta,tb]=yStartEnd();
  // Visible time window (roll: only the scrolled slice; draw: the whole note).
  const vLo = mode==='roll' ? (sTop()-PAD.t)/pxU()-1 : ta-1e-6;
  const vHi = mode==='roll' ? (sTop()+CSSH-PAD.t)/pxU()+1 : tb+1e-6;
  // Tala grid (time axis): akshara pulse (faint), anga/accent starts (amber),
  // avartana cycle boundaries (terra, bold) with a cycle number.
  if (mode==='roll' && talaMeasure>0){
    const angOff=talaAccents.map(a=>a-1);                                   // 0-based anga-start offsets in a cycle
    const angs=angOff.map((o,i)=>[o, i+1<angOff.length?angOff[i+1]:talaMeasure]);   // [start,end) per anga
    const glyphOf=(s,e)=>{ const k=talaBeat>0?Math.round((e-s)/talaBeat):0; return k===2?'O':(k===1?'U':'I'); };  // O drutam · U anudrutam · I laghu
    const gline=(t,col,w,al)=>{ if (t<vLo||t>vHi||t<-1e-6||t>TOTAL+1e-6) return; const y=Y(t);
      ctx.strokeStyle=col; ctx.lineWidth=w; ctx.globalAlpha=al; ctx.beginPath(); ctx.moveTo(p.x,y); ctx.lineTo(p.x+p.w,y); ctx.stroke(); ctx.globalAlpha=1; };
    const c0=Math.floor(Math.max(0,vLo)/talaMeasure)*talaMeasure;
    // Anga part bands — alternate shade, like the octave bands but on the time axis.
    for (let c=c0; c<vHi && c<TOTAL; c+=talaMeasure){ angs.forEach(([s,e],i)=>{ if (i%2!==0) return;
      const y0=Math.max(p.y,Y(c+s)), y1=Math.min(p.y+p.h,Y(Math.min(c+e,TOTAL))); if (y1>y0){ ctx.fillStyle='rgba(70,195,154,.05)'; ctx.fillRect(p.x,y0,p.w,y1-y0); } }); }
    if (talaBeat>0){ for (let t=Math.max(0,Math.floor(vLo/talaBeat)*talaBeat); t<=Math.min(TOTAL,vHi); t+=talaBeat) gline(t,muted,0.6,.13); }  // akshara pulse
    // Anga starts (accent lines) + I/O/U glyph.
    for (let c=c0; c<vHi && c<TOTAL; c+=talaMeasure){ angs.forEach(([s,e])=>{ const t=c+s; if (t>TOTAL) return; gline(t,amber,1,.3);
      if (t>=vLo&&t<=vHi){ const y=Y(t); ctx.fillStyle=amber; ctx.globalAlpha=.8; ctx.textAlign='left'; ctx.font='bold 10px '+cssvar('--mono'); ctx.fillText(glyphOf(s,e), PAD.l+3, y-4); ctx.globalAlpha=1; ctx.font='11px '+cssvar('--mono'); } }); }
    // Avartana (cycle) boundaries + number.
    for (let t=Math.max(0,Math.floor(vLo/talaMeasure)*talaMeasure); t<=Math.min(TOTAL,vHi); t+=talaMeasure){ gline(t,terra,1.8,.5);
      if (t<TOTAL-1e-6){ const y=Y(t); ctx.fillStyle=terra; ctx.globalAlpha=.75; ctx.textAlign='left'; ctx.font='bold 10px '+cssvar('--mono'); ctx.fillText(String(Math.round(t/talaMeasure)+1), PAD.l+3, y+12); ctx.globalAlpha=1; ctx.font='11px '+cssvar('--mono'); } }
  }
  // Note onsets (irregular) — kept faint so the tala grid reads as the metric guide.
  for (let i=0;i<=NOTES.length;i++){ const t=(i<NOTES.length)?starts[i]:TOTAL; if (t<vLo||t>vHi) continue; const y=Y(t);
    ctx.strokeStyle=terra; ctx.globalAlpha=(talaMeasure>0)?.12:.22; ctx.lineWidth=.7;
    ctx.beginPath(); ctx.moveTo(p.x,y); ctx.lineTo(p.x+p.w,y); ctx.stroke(); ctx.globalAlpha=1; }
  const colW = mode==='draw' ? 0 : Math.max(9, p.w/(stepMax-stepMin)*4);
  for (let i=0;i<NOTES.length;i++){ if (mode==='draw'&&i!==sel) continue;
    if (mode==='roll'){ const s0=starts[i], s1=s0+NOTES[i].dur; if (s1<vLo||s0>vHi) continue; }   // cull off-screen notes
    const nn=NOTES[i], y0=Y(starts[i]), y1=Y(starts[i]+nn.dur), x=X(nn.step), selNow=i===sel;
    const w = mode==='draw' ? Math.max(30,p.w*0.14) : colW;
    // Roll note boxes are piano-key colored (dark = black key, light = white key);
    // draw mode keeps the amber highlight for the note being edited.
    const black = mode==='roll' && keyIsBlack(nn.step);
    ctx.fillStyle = mode==='draw' ? (selNow?'rgba(216,161,63,.16)':'rgba(216,161,63,.07)') : (black?'rgba(32,36,43,.82)':'rgba(239,230,208,.85)');
    ctx.strokeStyle = selNow?amber:amberS; ctx.lineWidth=selNow?2:1.3; ctx.setLineDash(mode==='draw'?[5,4]:[]);
    roundRect(x-w/2, y0+1, w, Math.max(3,y1-y0-2), 5); ctx.fill(); ctx.stroke(); ctx.setLineDash([]);
    if (nn.curve) drawCurve(nn, starts[i], starts[i]+nn.dur, teal, mode==='draw'?3:2);
    if (mode!=='draw'){ ctx.fillStyle = black?'#efe6d0':'#20242b'; ctx.textAlign='center'; ctx.fillText(nn.swara, x, y0+13); }
    if (grab && grab.idx===i){ ctx.fillStyle='#9fc'; ctx.globalAlpha=0.9; ctx.fillRect(x-10, y1-4, 20, 8); ctx.globalAlpha=1; } }
  if (mode==='roll' && gamakaMode) for (let i=0;i<NOTES.length;i++){ const c=NOTES[i].curve; if (!c) continue;
    const t0=starts[i], t1=t0+NOTES[i].dur;
    for (const [u,st] of c){ const cx=X(st), cy=Y(t0+(t1-t0)*u);
      ctx.fillStyle=teal; ctx.globalAlpha=.9; ctx.beginPath(); ctx.arc(cx,cy,4,0,6.283); ctx.fill(); ctx.globalAlpha=1;
      ctx.strokeStyle='rgba(0,0,0,.35)'; ctx.lineWidth=.7; ctx.stroke(); } }
  if (paint){ const y0=Y(paint.ts), y1=Y(paint.ts+paint.dur);
    if (paint.rest){ const xc=p.x+REST_LANE_PX/2;
      ctx.fillStyle='#999'; ctx.globalAlpha=0.4; roundRect(xc-8,y0,16,Math.max(4,y1-y0),4); ctx.fill(); ctx.globalAlpha=1; }
    else { const xc=X(paint.step);
      ctx.fillStyle='#9fc'; ctx.globalAlpha=0.35; roundRect(xc-8,y0,16,Math.max(4,y1-y0),4); ctx.fill(); ctx.globalAlpha=1; } }
  if (mode==='draw'&&!NOTES[sel].curve){ ctx.fillStyle=muted; ctx.textAlign='center'; ctx.font='13px '+cssvar('--sans');
    ctx.fillText('drag top→bottom to draw the pitch', p.x+p.w/2, p.y+p.h/2); }
  if (mode==='draw'&&NOTES[sel].curve&&!drawing){ const c=NOTES[sel].curve,[t0,t1]=yStartEnd();
    for (let k=0;k<c.length;k++){ const cx=X(c[k][1]),cy=Y(t0+(t1-t0)*c[k][0]);
      ctx.beginPath();ctx.arc(cx,cy,6.5,0,7);ctx.fillStyle=cssvar('--bg');ctx.fill();
      ctx.lineWidth=2;ctx.strokeStyle=teal;ctx.stroke(); ctx.beginPath();ctx.arc(cx,cy,2.4,0,7);ctx.fillStyle=teal;ctx.fill(); } }
  if (mode==='roll'){   // A–B segment: dashed bounds + shaded region (handles live in the gutter)
    const lo=Math.min(markerA,markerB), hi=Math.max(markerA,markerB);
    if (lo>0.01||hi<TOTAL-0.01){ const y0=Y(lo),y1=Y(hi); ctx.fillStyle='rgba(216,161,63,.07)'; ctx.fillRect(p.x,y0,p.w,y1-y0); }
    const mk=(m)=>{ const y=Y(m); if (y<p.y-2||y>CSSH) return; ctx.strokeStyle=amber; ctx.globalAlpha=.8; ctx.setLineDash([6,4]); ctx.lineWidth=1.4; ctx.beginPath(); ctx.moveTo(PAD.l,y); ctx.lineTo(p.x+p.w,y); ctx.stroke(); ctx.setLineDash([]); ctx.globalAlpha=1; };
    mk(markerA); mk(markerB); }
  if (mode==='roll'&&playPos!=null){ const y=Y(playPos);   // playhead sweeps down as the roll plays
    ctx.strokeStyle=teal; ctx.globalAlpha=.95; ctx.lineWidth=2; ctx.beginPath(); ctx.moveTo(p.x,y); ctx.lineTo(p.x+p.w,y); ctx.stroke(); ctx.globalAlpha=1;
    ctx.fillStyle=teal; ctx.beginPath(); ctx.moveTo(p.x,y-4); ctx.lineTo(p.x+7,y); ctx.lineTo(p.x,y+4); ctx.closePath(); ctx.fill(); }
  if (mode==='roll') drawGridHandles(teal);
  positionHandles();
}
// Grip dots inside a handle tab, perpendicular to its drag axis (a row of dots
// along the axis you CAN'T drag hints "grab and slide the other way").
function gripDots(cx,cy,axis){ ctx.fillStyle='#08110d';
  for (let i=-1;i<=1;i++){ if (axis==='h') ctx.fillRect(cx-1, cy+i*4-1, 2, 2); else ctx.fillRect(cx+i*4-1, cy-1, 2, 2); } }
// The 3 grid stretch-handles: pitch-low/pitch-high (drag horizontally — resize the
// pitch axis) and time-bottom (drag vertically — resize the time axis; the top of
// the time axis stays pinned at t=0). Positions here MUST match hitGridHandle()'s
// hit-test math exactly (shared GRIP_THICK/GRIP_LEN constants).
function drawGridHandles(teal){ const p=plot();
  const drawTab=(cx,cy,w,h,axis)=>{ ctx.fillStyle=teal; ctx.globalAlpha=.85; roundRect(cx-w/2,cy-h/2,w,h,4); ctx.fill(); ctx.globalAlpha=1;
    ctx.strokeStyle='rgba(0,0,0,.3)'; ctx.lineWidth=.6; ctx.stroke(); gripDots(cx,cy,axis); };
  const yMid=p.y+p.h/2;
  // pitch-low: nudged a few px right of the plot edge so it clears the A/B gutter border.
  drawTab(Math.max(p.x+GRIP_THICK/2+3, X(stepMin)), yMid, GRIP_THICK, GRIP_LEN, 'h');
  // pitch-high.
  drawTab(X(stepMax), yMid, GRIP_THICK, GRIP_LEN, 'h');
  // time-bottom: a STICKY '+ time' button pinned to the bottom of the viewport (always
  // visible; click-to-extend — no scrolling to find it). Drawn last so it sits on top.
  const yBot=CSSH-GRIP_THICK/2-6;
  drawTab(p.x+p.w/2, yBot, GRIP_LEN, GRIP_THICK, 'v');
  ctx.fillStyle='#031'; ctx.font='bold 12px '+cssvar('--mono'); ctx.textAlign='center'; ctx.textBaseline='middle';
  ctx.fillText('+ time', p.x+p.w/2, yBot); ctx.textBaseline='alphabetic'; ctx.font='11px '+cssvar('--mono');
}
// Hit-test the 3 grid handles (roll mode only); returns 'pmin'|'pmax'|'tbottom'|null.
// Mirrors drawGridHandles()'s positions with a generous (HANDLE_PX) touch radius.
function hitGridHandle(x,y){ if (mode!=='roll') return null; const p=plot();
  const yMid=p.y+p.h/2, halfLen=GRIP_LEN/2+HANDLE_PX*0.4, halfThick=GRIP_THICK/2+HANDLE_PX;
  const xLo=Math.max(p.x+GRIP_THICK/2+3, X(stepMin));
  const xHi=X(stepMax);
  const yBot=CSSH-GRIP_THICK/2-6;   // STICKY: pinned to the viewport bottom, always present
  if (Math.abs(x-xLo)<=halfThick && Math.abs(y-yMid)<=halfLen) return 'pmin';
  if (Math.abs(x-xHi)<=halfThick && Math.abs(y-yMid)<=halfLen) return 'pmax';
  if (Math.abs(y-yBot)<=halfThick && Math.abs(x-(p.x+p.w/2))<=halfLen) return 'tbottom';
  return null;
}
// Time-bottom handle is CLICK-to-extend (not drag): each click adds one avartana
// (or 8 units with no tala) of empty grid and scrolls the roll so the new bottom —
// with the handle on it — sits near the viewport bottom, ready for the next click.
function extendTime(){ const inc=talaMeasure>0?talaMeasure:8;
  userGridBottom=(userGridBottom!=null?userGridBottom:TOTAL)+inc;
  recomputeGridBounds(); resizeCanvas();
  const hd=document.getElementById('holder');
  hd.scrollTop=Math.max(0, Math.min(Math.max(0,virtH()-hd.clientHeight), PAD.t + TOTAL*pxU() - (hd.clientHeight-40)));
  render(); }
function startHandleDrag(which,e){ const {x}=evtPos(e);
  handleDrag={ which, pid:e.pointerId, startX:x, startStepMin:stepMin, startStepMax:stepMax,
    pxPerStep: plot().w/Math.max(1,(stepMax-stepMin)) };   // FROZEN px-per-step at grab start
  cv.style.touchAction='none'; try{ cv.setPointerCapture(e.pointerId); }catch(_){}; render(); }
// Position the draggable A/B gutter handles at their marker times. The gutter is
// absolute-in-content (scrolls with the roll), so handles sit at VIRTUAL y and stay
// aligned with their marker lines as you scroll.
function positionHandles(){ const g=$('gutter'); if (mode!=='roll'){ g.style.display='none'; return; } g.style.display='';
  $('mkA').style.top=yVirt(markerA)+'px'; $('mkB').style.top=yVirt(markerB)+'px'; }
function roundRect(x,y,w,h,r){ r=Math.min(r,w/2,h/2); ctx.beginPath(); ctx.moveTo(x+r,y); ctx.arcTo(x+w,y,x+w,y+h,r); ctx.arcTo(x+w,y+h,x,y+h,r); ctx.arcTo(x,y+h,x,y,r); ctx.arcTo(x,y,x+w,y,r); ctx.closePath(); }
function sampleCurve(c,u){ if (c.length===1) return c[0][1];
  for (let k=1;k<c.length;k++){ if (u<=c[k][0]){ const [u0,s0]=c[k-1],[u1,s1]=c[k]; let t=(u-u0)/Math.max(1e-6,u1-u0); t=t*t*(3-2*t); return s0+(s1-s0)*t; } }
  return c[c.length-1][1]; }
function drawCurve(nn,t0,t1,color,wd){ const c=nn.curve; if (!c||!c.length) return;
  ctx.strokeStyle=color; ctx.lineWidth=wd; ctx.lineJoin='round'; ctx.lineCap='round'; ctx.beginPath();
  const N=Math.max(24,c.length*10);
  for (let k=0;k<=N;k++){ const u=k/N,st=sampleCurve(c,u),y=Y(t0+(t1-t0)*u),x=X(st); k?ctx.lineTo(x,y):ctx.moveTo(x,y); }
  ctx.stroke(); }

// ---------- interaction ----------
function evtPos(e){ const r=cv.getBoundingClientRect(); return { x:e.clientX-r.left, y:e.clientY-r.top }; }
// roll: selection is a click/tap (so a drag can scroll the tall roll)
cv.addEventListener('click', e=>{ if (mode!=='roll') return;
  if (justGrabbed){ justGrabbed=false; return; }   // suppress the click that follows a long-press grab/drag/release
  ensureAudio(); const {x,y}=evtPos(e); const i=hitNote(x,y); if (i>=0) enterDraw(i); });
let dEdit=null;   // draw-mode curve gesture: {downX,downY,hi,origCurve,mode:'pending'|'drag'|'free'}
const DEDIT_EPS=6;
// Is (x,y) on the selected note's curve LINE (draw-mode coords), for tap-to-add?
function onCurveLineDraw(x,y){ const c=NOTES[sel].curve; if (!c) return false; const [t0,t1]=yStartEnd();
  const u=Math.max(0,Math.min(1,(tAtY(y)-t0)/Math.max(1e-6,t1-t0))); const st=sampleCurve(c,u); return Math.abs(X(st)-x)<=14; }
cv.addEventListener('pointerdown', e=>{ if (mode!=='draw') return; try{ cv.setPointerCapture(e.pointerId); }catch(_){} ; ensureAudio(); const {x,y}=evtPos(e);
  dEdit={ downX:x, downY:y, hi:(NOTES[sel].curve?hitHandle(x,y):-1), origCurve:(NOTES[sel].curve?NOTES[sel].curve.map(p=>p.slice()):null), mode:'pending' }; });
cv.addEventListener('pointermove', e=>{ if (mode!=='draw' || !dEdit) return; const {x,y}=evtPos(e);
  if (dEdit.mode==='pending' && (Math.abs(x-dEdit.downX)>DEDIT_EPS || Math.abs(y-dEdit.downY)>DEDIT_EPS)){
    if (dEdit.hi>=0){ pushUndo(); dEdit.mode='drag'; dragIdx=dEdit.hi; liveOn(); liveSet(NOTES[sel].curve[dEdit.hi][1]); }
    else { pushUndo(); dEdit.mode='free'; drawing=true; NOTES[sel].curve=[]; liveOn(); addPoint(x,y); render(); return; } }
  if (dEdit.mode==='drag'){ dragHandle(x,y); render(); return; }
  if (dEdit.mode==='free'){ addPoint(x,y); render(); return; } });
cv.addEventListener('pointerup', e=>{ if (mode!=='draw' || !dEdit) return; const {x,y}=evtPos(e); const g=dEdit; dEdit=null;
  if (g.mode==='drag'){ if (document.getElementById('snap').checked) NOTES[sel].curve[dragIdx][1]=snapStep(NOTES[sel].curve[dragIdx][1]); dragIdx=-1; liveOff(); render(); autoPlay(); scheduleShare(); return; }
  if (g.mode==='free'){ drawing=false; liveOff(); finalizeCurve(); render(); autoPlay(); scheduleShare(); return; }
  // tap (no drag): on a handle -> remove; on the curve line -> add
  if (g.hi>=0){ pushUndo(); NOTES[sel].curve=removeAnchor(NOTES[sel].curve, g.hi);
    const has=!!(NOTES[sel].curve&&NOTES[sel].curve.length); document.getElementById('clear').disabled=!has; document.getElementById('copy').disabled=!has;
    liveOff(); render(); autoPlay(); scheduleShare(); return; }
  if (NOTES[sel].curve && onCurveLineDraw(x,y)){ pushUndo(); const [t0,t1]=yStartEnd();
    const u=Math.max(0,Math.min(1,(tAtY(y)-t0)/Math.max(1e-6,t1-t0))); const st=document.getElementById('snap').checked ? snapStep(Math.round(stepAtX(x))) : Math.round(stepAtX(x));
    NOTES[sel].curve=addAnchor(NOTES[sel].curve, u, st); render(); autoPlay(); scheduleShare(); return; }
  liveOff(); });
cv.addEventListener('pointercancel', ()=>{ if (dEdit){ if (dEdit.mode!=='pending') NOTES[sel].curve=dEdit.origCurve; dEdit=null; } drawing=false; dragIdx=-1; liveOff(); render(); });
// roll: on desktop (mouse), grabbing a note is immediate on press-drag; touch/pen
// still long-press (300ms) to disambiguate from scroll. body-drag MOVEs (pitch,
// snapped to the raga's rows), end-cap-handle-drag RESIZEs (duration, snapped to
// the tala akshara).
function startGrab(i, y, pid){ ensureAudio();
  const y1=Y(starts[i]+NOTES[i].dur);                  // far-time edge
  const kind=(Math.abs(y - y1)<=HANDLE_PX*1.4)?'resize':'move';
  grab={ idx:i, kind, oldStep:NOTES[i].step, oldDur:NOTES[i].dur, pid };
  cv.style.touchAction='none';   // own the gesture: a RESIZE is a vertical drag, exactly the
  // axis 'pan-y' permits, so without this the native touch-scroll fights the grab.
  try{ cv.setPointerCapture(pid); }catch(_){}
  render(); }
cv.addEventListener('pointerdown', e=>{ if (mode!=='roll' || paintMode || gamakaMode) return;
  { const {x,y}=evtPos(e); const gh=hitGridHandle(x,y); if (gh){ if (gh==='tbottom') extendTime(); else startHandleDrag(gh,e); return; } }
  // Defensive: a missed pointerup/pointercancel (OS interruption) can leave a stale
  // grab/press from a previous touch. Reset it before starting the new press so an
  // early pointermove on THIS touch can't mutate the wrong (previously grabbed) note.
  if (grab || pressXY){ clearTimeout(pressTimer); pressXY=null;
    if (grab){ NOTES[grab.idx].step=grab.oldStep; NOTES[grab.idx].dur=grab.oldDur; }   // revert the in-flight mutation before dropping the stale grab
    grab=null; cv.style.touchAction=ROLL_TOUCH_ACTION; }
  const {x,y}=evtPos(e);
  const i=hitNote(x,y); if (i<0) return;                 // empty grid -> let it scroll
  pressXY={x,y,id:e.pointerId}; clearTimeout(pressTimer);
  if (e.pointerType==='mouse'){ startGrab(i, y, e.pointerId); return; }   // desktop: no long-press needed
  pressTimer=setTimeout(()=>{ if (!pressXY) return; startGrab(i, y, e.pointerId); }, 300); });
cv.addEventListener('pointermove', e=>{ if (mode!=='roll') return; const {x,y}=evtPos(e);
  if (!grab){ if (pressXY && (Math.abs(x-pressXY.x)>8||Math.abs(y-pressXY.y)>8)){ clearTimeout(pressTimer); pressXY=null; } return; }
  if (e.pointerId!==grab.pid) return;   // ignore a second concurrent touch while grabbing
  if (grab.kind==='move'){ const raw=stepAtX(Math.max(plot().x,Math.min(plot().x+plot().w,x)));
    NOTES[grab.idx].step=snapToRagaRow(Math.round(raw), ragaRowSteps());
  } else { const t=tAtY(y); const beat=talaBeat||1; let d=snapToAkshara(t-starts[grab.idx], beat);
    NOTES[grab.idx].dur=Math.max(beat, d); }
  render(); });
cv.addEventListener('pointerup', async e=>{ if (mode!=='roll') return;
  if (grab && e.pointerId!==grab.pid) return;   // ignore a second concurrent touch's release; the owning grab stays live
  clearTimeout(pressTimer);
  const g=grab; pressXY=null; grab=null; if (!g){ return; }   // no grab (plain tap) -> let the click handler select
  cv.style.touchAction=ROLL_TOUCH_ACTION;   // grab over (committed or no-op) — give the scroll gesture back
  if (g.kind==='move'){ const changed=NOTES[g.idx].step!==g.oldStep;
    if (!changed){ render(); return; }   // no actual move (e.g. plain mouse click) — let the click handler select
    justGrabbed=true;   // a real edit happened — suppress the click-select that may follow this release
    pushUndo(); await onMoveDrop(g.idx, g.oldStep); }
  else { const changed=NOTES[g.idx].dur!==g.oldDur; if (!changed){ render(); return; }
    justGrabbed=true;
    pushUndo(); await commitEdit({ changed:new Set([NOTES[g.idx].tok]), deriveOctave:false }); }
});
cv.addEventListener('pointercancel', e=>{ if (mode!=='roll') return;
  if (grab && e.pointerId!==grab.pid) return;   // ignore a second concurrent touch's cancel; the owning grab stays live
  clearTimeout(pressTimer); pressXY=null;
  if (grab){ NOTES[grab.idx].step=grab.oldStep; NOTES[grab.idx].dur=grab.oldDur; grab=null; cv.style.touchAction=ROLL_TOUCH_ACTION; render(); } });
// Paint mode (`+ note` toggled on): drag on the grid creates a note — pitch snaps to
// a raga row, length to the tala akshara. Capture-phase + the !paintMode guard on the
// grab handlers above keep paint and grab gestures mutually exclusive. `paint` tracks
// its owning pointerId (`pid`), same pattern as `grab`, so a second concurrent touch
// can't overwrite the in-progress gesture and corrupt the eventual commit.
cv.addEventListener('pointerdown', e=>{ if (mode!=='roll' || !paintMode) return;
  { const {x,y}=evtPos(e); const gh=hitGridHandle(x,y); if (gh){ if (gh==='tbottom') extendTime(); else startHandleDrag(gh,e); return; } }
  if (paint) return;   // a paint is already active (e.g. a second finger) — ignore
  ensureAudio();
  const {x,y}=evtPos(e); const beat=talaBeat||1;
  const ts=Math.max(0, snapToAkshara(tAtY(y), beat));
  const restLane = x < plot().x + REST_LANE_PX;
  if (restLane){ paint={ ts, rest:true, dur:beat, pid:e.pointerId }; }
  else { const step=snapToRagaRow(Math.round(stepAtX(x)), ragaRowSteps()); paint={ ts, step, dur:beat, pid:e.pointerId }; }
  try{ cv.setPointerCapture(e.pointerId); }catch(_){}; render(); }, true);
cv.addEventListener('pointermove', e=>{ if (!paint || e.pointerId!==paint.pid) return; const {y}=evtPos(e); const beat=talaBeat||1;
  paint.dur=Math.max(beat, snapToAkshara(tAtY(y)-paint.ts, beat)); render(); }, true);
cv.addEventListener('pointerup', async e=>{ if (!paint || e.pointerId!==paint.pid) return;
  if (!paintMode){ paint=null; render(); return; }   // Fix #7: `+ note` toggled off mid-drag — abort, don't commit
  const p=paint; paint=null;
  justGrabbed=true;   // suppress the trailing click so a freshly-painted note doesn't auto-open gamaka editing
  const durs=NOTES.map(n=>n.dur);
  const place=placePaint({ ts:p.ts, dur:p.dur, notes:NOTES, starts, durs, total:TOTAL });
  pushUndo(); await applyPaint(place, p); }, true);
// Defensive, mirroring the grab gesture's pointercancel: an OS-interrupted paint
// (app backgrounded mid-drag, etc.) must not leave `paint` set — that would render
// the green preview forever with no gesture left to dismiss it. Paint doesn't touch
// cv.style.cursor/touchAction per-gesture (unlike grab, which owns the drag axis),
// so there is nothing else to restore here beyond nulling the state and re-rendering.
cv.addEventListener('pointercancel', e=>{ if (!paint || e.pointerId!==paint.pid) return; paint=null; render(); }, true);
// In-roll gamaka drawing/editing (`✎ gamaka` toggled on). Grid handles + `+ time`
// are checked first (so you can zoom while editing). The note under the initial
// press is the stroke's target; drag on empty note area = freehand redraw.
const MOVE_EPS=6;   // px before a press counts as a drag (vs a tap)
function uAt(i,y){ return Math.max(0,Math.min(1,(tAtY(y)-starts[i])/Math.max(1e-6,NOTES[i].dur))); }
function stepAt(x){ const p=plot(); return snapStep(Math.round(stepAtX(Math.max(p.x,Math.min(p.x+p.w,x))))); }
// Roll-coord hit-test of note gi's anchors; returns the anchor index or -1.
function hitAnchor(gi,x,y){ const c=NOTES[gi].curve; if (!c) return -1; const t0=starts[gi],t1=t0+NOTES[gi].dur;
  for (let k=0;k<c.length;k++){ const cx=X(c[k][1]),cy=Y(t0+(t1-t0)*c[k][0]); if ((x-cx)*(x-cx)+(y-cy)*(y-cy)<=16*16) return k; } return -1; }
// Is (x,y) on note gi's curve LINE (within ~12px), for tap-to-add? Sample at the press u.
function onCurveLine(gi,x,y){ const c=NOTES[gi].curve; if (!c) return false; const u=uAt(gi,y);
  const st=sampleCurve(c,u); return Math.abs(X(st)-x)<=12; }
cv.addEventListener('pointerdown', e=>{ if (mode!=='roll' || !gamakaMode) return;
  { const {x,y}=evtPos(e); const gh=hitGridHandle(x,y); if (gh){ if (gh==='tbottom') extendTime(); else startHandleDrag(gh,e); return; } }
  if (gamaStroke) return;
  ensureAudio(); const {x,y}=evtPos(e); const i=hitNote(x,y); if (i<0) return;
  try{ cv.setPointerCapture(e.pointerId); }catch(_){};
  const dragIdx = NOTES[i].curve ? hitAnchor(i,x,y) : -1;
  gamaStroke={ gi:i, pid:e.pointerId, downX:x, downY:y, dragIdx, buffer:null, mode: dragIdx>=0 ? 'anchor' : 'pending', origCurve:NOTES[i].curve };
}, true);
cv.addEventListener('pointermove', e=>{ if (!gamaStroke || e.pointerId!==gamaStroke.pid) return; const {x,y}=evtPos(e);
  const g=gamaStroke;
  if (g.mode==='anchor'){ if (Math.abs(x-g.downX)>MOVE_EPS || Math.abs(y-g.downY)>MOVE_EPS){
      if (!g.moved){ pushUndo(); g.moved=true; }
      NOTES[g.gi].curve=moveAnchor(NOTES[g.gi].curve, g.dragIdx, uAt(g.gi,y), stepAt(x)); render(); }
    return; }
  if (g.mode==='pending' && (Math.abs(x-g.downX)>MOVE_EPS || Math.abs(y-g.downY)>MOVE_EPS)){
    // begin a freehand redraw of the target note's curve
    pushUndo(); g.mode='free'; g.buffer=[]; NOTES[g.gi].curve=null;
  }
  if (g.mode==='free'){ const u=uAt(g.gi,y), st=stepAt(x);
    if (g.buffer.length && u<=g.buffer[g.buffer.length-1][0]) g.buffer[g.buffer.length-1][1]=st; else g.buffer.push([u,st]);
    NOTES[g.gi].curve=g.buffer.slice(); render(); }
}, true);
cv.addEventListener('pointerup', e=>{ if (!gamaStroke || e.pointerId!==gamaStroke.pid) return; const g=gamaStroke; gamaStroke=null;
  justGrabbed=true;   // suppress any trailing click (don't fall into the full-screen editor)
  const {x,y}=evtPos(e); const moved=Math.abs(x-g.downX)>MOVE_EPS||Math.abs(y-g.downY)>MOVE_EPS;
  if (g.mode==='free'){ NOTES[g.gi].curve=pointsToAnchors(g.buffer); render(); scheduleShare(); return; }
  if (g.mode==='anchor'){ if (g.moved){ scheduleShare(); }
    else { pushUndo(); NOTES[g.gi].curve=removeAnchor(NOTES[g.gi].curve, g.dragIdx); render(); scheduleShare(); }  // tap = remove
    return; }
  // mode 'pending' with no move: tap on the curve line adds an anchor there
  if (!moved && NOTES[g.gi].curve && onCurveLine(g.gi,x,y)){ pushUndo();
    NOTES[g.gi].curve=addAnchor(NOTES[g.gi].curve, uAt(g.gi,y), stepAt(x)); render(); scheduleShare(); }
}, true);
cv.addEventListener('pointercancel', e=>{ if (!gamaStroke || e.pointerId!==gamaStroke.pid) return; NOTES[gamaStroke.gi].curve=gamaStroke.origCurve; gamaStroke=null; render(); }, true);
// Grid stretch-handle drag (pitch-low/pitch-high/time-bottom). These are separate
// listeners (not folded into grab/paint) because a handle-drag must fire in BOTH
// normal and paint mode — startHandleDrag() is invoked from the top of both roll
// pointerdowns above, before their own mode-specific logic runs. No-op unless
// handleDrag is set, so they coexist peacefully with the grab/paint handlers.
cv.addEventListener('pointermove', e=>{ if (!handleDrag || e.pointerId!==handleDrag.pid) return; const {x,y}=evtPos(e);
  const hd=document.getElementById('holder'), content=document.getElementById('content');
  if (handleDrag.which==='tbottom'){
    userGridBottom=Math.max(snapToAkshara(tAtY(y), talaBeat||1), (talaBeat||1));
    recomputeGridBounds(); content.style.height=virtH()+'px';
    // Fix 3 scroll-follow: glue the bottom edge under the cursor so the new time is visible live.
    hd.scrollTop=Math.max(0, Math.min(Math.max(0,virtH()-hd.clientHeight), PAD.t + TOTAL*pxU() - y));
  } else {
    // Frozen-scale: bound = start bound + cursor pixel-travel / start px-per-step. Independent of
    // the live (rescaling) stepMin/stepMax, so no feedback loop pins the value.
    const dSteps=(x-handleDrag.startX)/handleDrag.pxPerStep;
    const base=(handleDrag.which==='pmin')?handleDrag.startStepMin:handleDrag.startStepMax;
    const st=snapToRagaRow(Math.round(base+dSteps), ragaRowSteps());
    if (handleDrag.which==='pmin') userGridMin=st; else userGridMax=st;
    recomputeGridBounds(); content.style.height=virtH()+'px';
  }
  render(); });
cv.addEventListener('pointerup', e=>{ if (!handleDrag || e.pointerId!==handleDrag.pid) return; handleDrag=null; cv.style.touchAction=ROLL_TOUCH_ACTION; });
cv.addEventListener('pointercancel', e=>{ if (!handleDrag || e.pointerId!==handleDrag.pid) return; handleDrag=null; cv.style.touchAction=ROLL_TOUCH_ACTION; render(); });
// Discoverability: hover the grid stretch-handles shows a resize cursor (idle only —
// not while any drag/grab/paint gesture is in progress). No log param -> hitGridHandle
// stays silent here, so this high-frequency listener doesn't flood the console (Fix 5).
cv.addEventListener('pointermove', e=>{ if (mode!=='roll' || handleDrag || grab || paint) return;
  const {x,y}=evtPos(e); const h=hitGridHandle(x,y);
  cv.style.cursor = h ? (h==='tbottom'?'pointer':'col-resize') : (paintMode?'crosshair':''); });
// A moved note is committed with the current gamaka-on-move default; if it carried
// a gamaka, a toast offers the other behaviour for ~4s. The model stores the curve
// ABSOLUTE, so 'preserve pitch' = leave the curve (serialize emits shifted relative
// deltas); 'move with note' = shift the abs curve by +Δstep so the relative deltas
// stay verbatim and the whole curve rides the note.
async function onMoveDrop(idx, oldStep){
  const n=NOTES[idx], dStep=n.step-oldStep;
  // Derive octave the same way the letter itself is derived (stepToSwara), not via
  // a raw Math.floor(step/EDO) — that disagrees with stepToSwara's c12 wrap-to-next-
  // octave behaviour near the top of an octave, which could spell the wrong octave.
  const ctx=ragaCtx();
  const newOct=stepToSwara(n.step, ctx).octave, oldOct=stepToSwara(oldStep, ctx).octave;
  n.octave=newOct;
  const hasCurve=!!(n.curve && n.curve.length);
  // Capture the mode once, before the await below — gmovesel can change live while
  // commitEdit is in flight, and the toast must describe/flip the mode that was
  // actually applied to this drop, not whatever the dropdown reads afterward.
  const appliedMode=gamakaOnMove;
  const applyMode=(mode)=>{ if (!hasCurve) return;
    // The abs curve is left exactly as it was pre-drop; the mode only decides
    // whether to shift it by dStep so it rides the note (move-with-note) or
    // stays put so the note's pitch through the curve is unchanged (preserve-pitch).
    if (mode==='move-with-note') n.curve=n.curve.map(([u,s])=>[u,s+dStep]);
    /* preserve-pitch: leave abs curve as-is */ };
  applyMode(appliedMode);
  await commitEdit({ changed:new Set([n.tok]), deriveOctave:newOct!==oldOct });
  if (!hasCurve) return;
  const other=appliedMode==='preserve-pitch'?'move-with-note':'preserve-pitch';
  const label=appliedMode==='preserve-pitch'?'move with note':'preserve pitch';
  showToast(`Gamaka: ${appliedMode==='preserve-pitch'?'pitch preserved':'moved with note'}`, `switch to ${label}`, async ()=>{
    // Flip: after buildModel, re-find the note by its tok and reshift the abs curve
    // by the opposite of what appliedMode implied, then re-commit.
    const j=NOTES.findIndex(x=>x.tok===n.tok); if (j<0) return; const m=NOTES[j];
    if (!m.curve || !m.curve.length) return;
    if (other==='move-with-note') m.curve=m.curve.map(([u,s])=>[u,s+dStep]);
    else m.curve=m.curve.map(([u,s])=>[u,s-dStep]);
    pushUndo(); await commitEdit({ changed:new Set([m.tok]), deriveOctave:false }); });
}
// Build the serializeModel insert for a painted note or rest. For 'split', the host
// is cut into a HEAD (kept by the host token) and a TAIL continuation (same pitch,
// inserted after the new item) via splitSpans — this preserves the host's original
// sustain instead of discarding it. For 'fill'/'append' the item lands at the
// DRAGGED time `p.ts`, not just after the anchor — a leading rest is inserted ahead
// of it whenever there's a time gap (append past the true content end, or fill/split
// before the very first note, via serializeModel's `inserts.get(-1)` prepend).
async function applyPaint(place, p){
  const item = p.rest ? { rest:true, dur:p.dur }
    : { step:p.step, octave:Math.floor(p.step/EDO)+5, dur:p.dur, curve:null };
  const model=modelByTok(); const changed=new Set(); const inserts=new Map();
  if (place.kind==='append' && place.anchorTok<0){        // empty piece: seed directly in srcText
    const lead = p.ts>0 ? ('z'+(Math.round(p.ts)>1?Math.round(p.ts):'')+' ') : '';
    const len=Math.max(1,Math.round(p.dur));
    // Octave marks are needed here (unlike commitEdit's derived path) because this
    // branch writes srcText directly, bypassing serializeModel's deriveOctave — the
    // blank skeleton's O=5 baseline means a bare letter always parses back to octave
    // 5, silently flattening a note painted in an upper/lower row (Fix 1).
    const sw = stepToSwara(p.step, ragaCtx());
    const body = len > 1 ? String(len) : '';
    const tok = p.rest ? ('z' + body) : (octMarks(sw.octave - 5) + sw.letter + body);   // bare swara/z when len===1 (Task 3 convention)
    buildModel(srcText.replace(/\s*$/,'') + '\n' + lead + tok + '\n');
    syncControls(); resizeCanvas(); render(); await rebuildShare(); return; }
  if (place.kind==='split'){
    const hostIdx=NOTES.findIndex(n=>n.tok===place.host);
    const host=model.get(place.host);
    const { head, tail }=splitSpans(starts[hostIdx], host.dur, p.ts, p.dur);
    if (head<=0){
      // Degenerate: paint lands at/before the host's own start — a zero-length head
      // would emit a bogus token. Insert BEFORE the host instead (anchor on the
      // previous surviving note), or — no previous note — prepend via inserts.get(-1),
      // with a leading rest if `p.ts` is after the very start of the piece.
      if (hostIdx>0) inserts.set(NOTES[hostIdx-1].tok, [item]);
      else inserts.set(-1, p.ts>0 ? [{rest:true,dur:p.ts}, item] : [item]);
    } else {
      host.dur=head; changed.add(place.host);
      // Tail continuation carries the host's original remainder onward, same pitch,
      // no gamaka curve of its own — only emitted when there IS a remainder.
      const tailNote = tail>0 ? { step:host.step, octave:host.octave, dur:tail, curve:null } : null;
      inserts.set(place.host, tailNote ? [item, tailNote] : [item]);
    }
  } else if (place.kind==='append'){                       // append past the true content end
    const gap = Math.round(p.ts - contentEnd);
    inserts.set(place.anchorTok, gap>0 ? [{rest:true,dur:gap}, item] : [item]);
  } else if (place.anchorTok<0){                            // fill: before the very first note
    const lead = p.ts>0 ? [{rest:true, dur:p.ts}] : [];
    inserts.set(-1, [...lead, item]);
  } else {                                                   // fill: mid-piece
    inserts.set(place.anchorTok, [item]);
  }
  const newSrc=serializeModel(srcText, { model, changed, inserts, deletes:new Set(), deriveOctave:true, ctx:ragaCtx() });
  buildModel(newSrc); syncControls(); resizeCanvas(); render(); await rebuildShare();
}
function hitNote(x,y){ for (let i=0;i<NOTES.length;i++){ const y0=Y(starts[i]),y1=Y(starts[i]+NOTES[i].dur),xc=X(NOTES[i].step),w=Math.max(16,plot().w/(stepMax-stepMin)*4);
  if (y>=y0&&y<=y1&&x>=xc-w/2-6&&x<=xc+w/2+6) return i; } return -1; }
function addPoint(x,y){ const p=plot(),[ba,bb]=yStartEnd();
  let u=Math.max(0,Math.min(1,(tAtY(y)-ba)/(bb-ba)));
  const st=stepAtX(Math.max(p.x,Math.min(p.x+p.w,x)));
  const c=NOTES[sel].curve; if (c.length&&u<=c[c.length-1][0]) c[c.length-1][1]=st; else c.push([u,st]);
  liveSet(st); document.getElementById('read').textContent='≈'+freqOf(st).toFixed(0)+' Hz'; }
function finalizeCurve(){ let c=NOTES[sel].curve; if (!c||c.length<2){ NOTES[sel].curve=null; document.getElementById('clear').disabled=true; document.getElementById('copy').disabled=true; return; }
  c=extractAnchors(c);
  if (document.getElementById('snap').checked) c=c.map(pt=>[pt[0],snapStep(pt[1])]);
  if (c[0][0]>0.001) c=[[0,c[0][1]],...c];
  if (c[c.length-1][0]<0.999) c=[...c,[1,c[c.length-1][1]]];
  NOTES[sel].curve=c; document.getElementById('clear').disabled=false; document.getElementById('copy').disabled=false; }
function hitHandle(x,y){ const c=NOTES[sel].curve; if (!c) return -1; const [t0,t1]=yStartEnd();
  for (let k=0;k<c.length;k++){ const cx=X(c[k][1]),cy=Y(t0+(t1-t0)*c[k][0]); if ((x-cx)*(x-cx)+(y-cy)*(y-cy)<=18*18) return k; } return -1; }
function dragHandle(x,y){ const c=NOTES[sel].curve,p=plot(),[ba,bb]=yStartEnd();
  let u=(tAtY(y)-ba)/(bb-ba); const lo=dragIdx===0?0:c[dragIdx-1][0]+0.006, hi=dragIdx===c.length-1?1:c[dragIdx+1][0]-0.006;
  u=Math.max(lo,Math.min(hi,u)); const st=stepAtX(Math.max(p.x,Math.min(p.x+p.w,x)));
  c[dragIdx][0]=u; c[dragIdx][1]=st; liveSet(st); document.getElementById('read').textContent='≈'+freqOf(st).toFixed(0)+' Hz'; }

const $ = id => document.getElementById(id);
let clipRel=null;   // copied curve, stored RELATIVE to its note's step (so it re-anchors on paste)
function enterDraw(i){ sel=i; mode='draw';
  $('mode').textContent='draw the curve'; $('crumb').textContent='note '+(i+1)+' · '+NOTES[i].swara+NOTES[i].octave;
  for (const b of ['clear','copy','paste','back']) $(b).style.display='';   // draw-only buttons appear
  $('back').disabled=false; $('clear').disabled=!NOTES[i].curve; $('copy').disabled=!NOTES[i].curve; $('paste').disabled=!clipRel;
  setPlayBtn('▶','Play note'); $('rangectl').style.display=''; $('snapctl').style.display=''; $('tzoom').style.display='none'; resizeCanvas(); }
$('back').onclick=()=>{ dEdit=null; drawing=false; dragIdx=-1; mode='roll'; sel=-1; $('mode').textContent='select a note'; $('crumb').textContent='';
  for (const b of ['clear','copy','paste','back']) $(b).style.display='none';   // draw-only buttons hidden in roll mode
  $('read').textContent=''; setPlayBtn('▶',playLabel());
  $('rangectl').style.display='none'; $('snapctl').style.display='none'; $('tzoom').style.display=''; resizeCanvas(); };
$('clear').onclick=()=>{ if (sel>=0 && NOTES[sel].curve){ pushUndo(); NOTES[sel].curve=null; $('clear').disabled=true; $('copy').disabled=true; render(); scheduleShare(); } };
function flashBtn(id,msg){ const b=$(id),t=b.textContent; b.textContent=msg; setTimeout(()=>b.textContent=t,1100); }
// Copy stores the curve relative to its note's step; Paste re-anchors it (transpose
// only — preserves the copied shape/tuning exactly), plays the target for feedback.
function copyFrom(i){ if (!NOTES[i].curve) return; const s0=NOTES[i].step; clipRel=NOTES[i].curve.map(([u,s])=>[u, s-s0]); $('paste').disabled=false; }
function pasteTo(i){ if (!clipRel) return; const s0=NOTES[i].step; NOTES[i].curve=clipRel.map(([u,d])=>[u, s0+d]);
  if (sel===i){ $('clear').disabled=false; $('copy').disabled=false; } render(); scheduleShare(); playNote(i); }
$('copy').onclick=()=>{ if (sel>=0&&NOTES[sel].curve){ copyFrom(sel); flashBtn('copy','Copied'); } };
$('paste').onclick=()=>{ if (sel>=0) pasteTo(sel); };
// desktop: right-click / ctrl-click a note in the roll to copy or paste its gamaka
let ctxNote=-1;
// Play button shows only an icon (compact on mobile); the words go in its title.
function setPlayBtn(icon, title){ const b=$('play'); b.textContent=icon; b.title=title; }
function setPlayIdle(){ if (!playing&&!paused) setPlayBtn('▶', playLabel()); }
cv.addEventListener('contextmenu', e=>{ if (mode!=='roll') return; e.preventDefault(); const {x,y}=evtPos(e);
  ctxNote=hitNote(x,y); ctxTime=Math.max(0,Math.min(TOTAL,tAtY(y))); const cm=$('ctxmenu');
  cm.querySelector('[data-act=copy]').disabled=!(ctxNote>=0&&NOTES[ctxNote].curve);
  cm.querySelector('[data-act=paste]').disabled=!(ctxNote>=0&&clipRel);
  cm.querySelector('[data-act=clearmk]').disabled=(markerA<=0.01&&markerB>=TOTAL-0.01);
  cm.style.left=Math.min(e.clientX, window.innerWidth-170)+'px'; cm.style.top=Math.min(e.clientY, window.innerHeight-210)+'px'; cm.style.display='block'; });
function hideCtx(){ $('ctxmenu').style.display='none'; }
$('ctxmenu').addEventListener('click', e=>{ const act=e.target.getAttribute&&e.target.getAttribute('data-act'); if (!act){ hideCtx(); return; }
  if (act==='copy'&&ctxNote>=0) copyFrom(ctxNote);
  else if (act==='paste'&&ctxNote>=0) pasteTo(ctxNote);
  else if (act==='seta'){ markerA=ctxTime; setPlayIdle(); render(); }
  else if (act==='setb'){ markerB=ctxTime; setPlayIdle(); render(); }
  else if (act==='clearmk'){ markerA=0; markerB=TOTAL; setPlayIdle(); render(); }
  else if (act==='playfrom'){ playFrom(ctxTime, (markerB!=null&&markerB>ctxTime)?markerB:TOTAL); }
  hideCtx(); });
// Draggable A/B gutter handles — grab and slide to set the play segment bounds.
function startMk(which){ return e=>{ e.preventDefault(); e.stopPropagation(); markerDrag=which; try{ $('mk'+which).setPointerCapture(e.pointerId); }catch(_){} }; }
$('mkA').addEventListener('pointerdown', startMk('A'));
$('mkB').addEventListener('pointerdown', startMk('B'));
window.addEventListener('pointermove', e=>{ if (!markerDrag) return; const r=cv.getBoundingClientRect();
  const t=Math.max(0,Math.min(TOTAL, tAtY(e.clientY-r.top))); if (markerDrag==='A') markerA=t; else markerB=t; setPlayIdle(); render(); });
window.addEventListener('pointerup', ()=>{ markerDrag=null; });
document.addEventListener('pointerdown', e=>{ if (!$('ctxmenu').contains(e.target)) hideCtx(); });
document.addEventListener('keydown', e=>{ if (e.key==='Escape') hideCtx(); });
$('holder').addEventListener('scroll', ()=>{ hideCtx(); if (mode==='roll') render(); });   // windowed roll: redraw the visible slice
// help popup
$('helpbtn').onclick=()=>{ const h=$('helppop'); h.hidden=!h.hidden; };
$('helpclose').onclick=()=>{ $('helppop').hidden=true; };
document.addEventListener('pointerdown', e=>{ const h=$('helppop'); if (!h.hidden && !h.contains(e.target) && e.target.id!=='helpbtn') h.hidden=true; });
document.addEventListener('keydown', e=>{ if (e.key==='Escape') $('helppop').hidden=true; });
$('rmin').onclick=()=>{ drawSpan=Math.max(10,drawSpan-8); resizeCanvas(); };
$('rplus').onclick=()=>{ drawSpan=Math.min(60,drawSpan+8); resizeCanvas(); };   // 60 ≈ a bit over an octave (53-EDO) each side
// Expand: scale up the roll (taller cells). Windowing means any zoom is safe — the
// canvas stays viewport-sized; only the scroll range grows. 1 = fully expanded floor.
$('tmin').onclick=()=>{ zoom=Math.max(1, Math.round((zoom-0.5)*10)/10); resizeCanvas(); };
$('tplus').onclick=()=>{ zoom=Math.min(8, Math.round((zoom+0.5)*10)/10); resizeCanvas(); };
// `+ note` toggle: paint mode is mutually exclusive with the roll's long-press grab
// (both handlers guard on paintMode, see the pointerdown listeners above), and with
// `✎ gamaka` mode below.
$('paintbtn').onclick=()=>{ paintMode=!paintMode; if (paintMode){ gamakaMode=false; $('gamakabtn').classList.remove('on'); if (gamaStroke){ NOTES[gamaStroke.gi].curve=gamaStroke.origCurve; gamaStroke=null; } }
  $('paintbtn').classList.toggle('on',paintMode); cv.style.cursor=paintMode?'crosshair':''; render(); };
// `✎ gamaka` toggle: shows draggable anchor dots on the roll (rendered in render()) and
// is mutually exclusive with `+ note` paint mode. Pointer handlers land in later tasks.
$('gamakabtn').onclick=()=>{ gamakaMode=!gamakaMode; if (gamakaMode){ paintMode=false; $('paintbtn').classList.remove('on'); }
  if (gamaStroke){ NOTES[gamaStroke.gi].curve=gamaStroke.origCurve; gamaStroke=null; } $('gamakabtn').classList.toggle('on',gamakaMode); cv.style.cursor=gamakaMode?'crosshair':''; render(); };
// Gamaka-on-move default: 'preserve pitch' (leave the abs curve — serialize emits shifted
// relative deltas) or 'move with note' (shift the abs curve so the deltas stay verbatim
// and the curve rides the note). Persisted; the post-move toast always offers the other.
const GKEY='ragamroll.gamakaOnMove';
let gamakaOnMove=localStorage.getItem(GKEY)||'preserve-pitch';
$('gmovesel').value=gamakaOnMove;
$('gmovesel').onchange=e=>{ gamakaOnMove=e.target.value; try{ localStorage.setItem(GKEY,gamakaOnMove); }catch(_){}; };
// Non-blocking toast: ~4s auto-dismiss, optional one-tap action.
let toastTimer=0;
function showToast(msg, actionLabel, onAction){ const t=$('toast'); t.innerHTML='';
  t.append(document.createTextNode(msg));
  if (actionLabel){ const b=document.createElement('button'); b.textContent=actionLabel;
    b.onclick=()=>{ hideToast(); onAction(); }; t.append(b); }
  t.style.display='flex'; clearTimeout(toastTimer); toastTimer=setTimeout(hideToast,4000); }
function hideToast(){ $('toast').style.display='none'; }
// Drone/tala levels are LIVE: each routes through a per-session gain bus, so a
// slider change scales the currently-playing drone / accent strums immediately.
$('dronevol').oninput=e=>{ droneVol=Number(e.target.value); if (session&&session.dBus&&AC) session.dBus.gain.setTargetAtTime(droneVol,AC.currentTime,0.02); };
$('talavol').oninput=e=>{ talaVol=Number(e.target.value); if (session&&session.tBus&&AC) session.tBus.gain.setTargetAtTime(talaVol,AC.currentTime,0.02); };
// Footer build/version — mirrors the app's Footer component (build-app-v0.sh stamps both).
$('footbuild').innerHTML=(BUILD_DATE?`built ${BUILD_DATE} · `:'')+`<span class="ver">${VERSION}</span>`;

// Sa reference pitch (playback transpose) — Auto = the composition's Sa (saRef).
// Changing it retunes saFreq only; the roll layout (steps) is anchored to saRef.
(function fillSa(){ let opts='<option value="">Auto</option>'; for (let m=40;m<=72;m++) opts+=`<option value="${m}">${midiToName(m)}</option>`; $('sapick').innerHTML=opts; })();
$('sapick').onchange=e=>{ saPlay=e.target.value===''?null:Number(e.target.value); saFreq=midiToFreq(saPlay==null?saRef:saPlay); render(); };
// Tempo slider — a multiplier of the composition tempo; affects playback speed only
// (the roll layout is in length-units, independent of tempo).
$('tempo').oninput=e=>{ tempoBpm=Math.round(compTempo*Number(e.target.value)); $('tempolbl').textContent=tempoBpm+' BPM'; };
// Sync the Sa / tempo controls to the current model (after a load/reload).
function syncControls(){ $('sapick').value=saPlay==null?'':String(saPlay);
  const auto=$('sapick').querySelector('option[value=""]'); if (auto) auto.textContent='Auto ('+midiToName(saRef)+')';
  $('tempo').value=String(Math.max(0.5,Math.min(2, tempoBpm/compTempo))); $('tempolbl').textContent=tempoBpm+' BPM';
  $('rt').textContent = curRaga ? `${curRaga} · ${curTala}` : '';
  // Raga/tala pickers apply only to a BLANK piece (no notes) — lock once notes exist.
  const blank = NOTES.length===0;
  $('ragasearch').disabled=!blank; $('talasel').disabled=!blank;
  $('editnote').textContent = blank ? 'pick a raga / tala, then type swaras below' : 'raga · tala locked while notes exist';
  $('ragasearch').value = curRaga || ''; $('talasel').value = curTalaName; }
// The per-raga seed map (drafts.json), fetched once. Tries the deployed path
// (./ragas/) then the local-curation path (../tools/out/); empty map if neither
// is reachable (offline / not built) — seeding then falls back to the plain scale.
let _draftsPromise = null;
function loadDrafts(){
  if (!_draftsPromise) _draftsPromise = (async () => {
    for (const url of ['./ragas/drafts.json', '../tools/out/drafts.json']) {
      try { const r = await fetch(url); if (r.ok) return await r.json(); } catch(_){}
    }
    _draftsPromise = null; // total failure (offline / not built) — don't memoize {}, retry next pick
    return {};
  })();
  return _draftsPromise;
}
// Set the Raga=/Tala= directive in the srgm (blank pieces only) and reload.
// A Raga pick seeds the piece with that raga's notation (curated draft, else a
// plain scale); a Tala pick only rewrites the directive (unchanged behaviour).
async function applyRagaTala(kind, name){ if (NOTES.length || !name) return;
  if (kind==='Raga'){
    // #ragasearch is free-text; canonicalize once so a non-canonical typed
    // case (e.g. "Mohanam") still hits drafts[name]/getRagaExt/getRagas().
    const cname = resolveRagaName(name) || name;
    const drafts = await loadDrafts();
    if (NOTES.length) return; // piece may no longer be blank after the async fetch
    const picked = chooseSeed(cname, drafts, getRagaExt(cname), getRagas());
    // seed the piece with the raga's notation, else fall back to a bare blank with Raga= set
    const seed = picked ? picked.srgm : `Raga=${cname},0\nTala=adi,4\nO=5 L=1\n`;
    loadSrc(seed, docName); setEditorH(editorH>10?editorH:Math.round((window.innerHeight||600)*0.35)); return;
  }
  // Tala (blank only): rewrite the Tala= directive and reload (unchanged behaviour)
  let s=srcText; const nv='Tala='+name+',4'; const re=/(^|\s)Tala=\S+/;
  s = re.test(s) ? s.replace(re, (m,p)=>p+nv) : nv+'\n'+s;
  loadSrc(s, docName); setEditorH(editorH>10?editorH:Math.round((window.innerHeight||600)*0.35));
}
// Back to the app: carry the composition CURRENTLY open here into the app (it reads
// the same localStorage key), so the app opens the same piece — not whatever it held.
$('backapp').onclick=e=>{ e.preventDefault(); try{ localStorage.setItem(LS_KEY, srcText); }catch(_){}; location.href='./index.html'; };
// srgm editor: a slide-up panel below the buttons. Drag the grip to resize; tap to
// toggle. Native ctrl-z works for typing; edits reparse (debounced) → rebuild roll.
let editorH=0, gripDrag=null;
function setEditorH(h){ editorH=Math.max(0, Math.min(h, Math.round((window.innerHeight||600)*0.6)));
  $('editpanel').style.height=editorH+'px';
  if (editorH>0 && document.activeElement!==$('editor')) $('editor').value=srcText;
  requestAnimationFrame(resizeCanvas); }
$('grip').addEventListener('pointerdown', e=>{ e.preventDefault(); try{ $('grip').setPointerCapture(e.pointerId); }catch(_){}; gripDrag={y:e.clientY,h:editorH,moved:false}; });
$('grip').addEventListener('pointermove', e=>{ if (!gripDrag) return; const dy=gripDrag.y-e.clientY; if (Math.abs(dy)>3) gripDrag.moved=true; setEditorH(gripDrag.h+dy); });
$('grip').addEventListener('pointerup', ()=>{ if (gripDrag&&!gripDrag.moved) setEditorH(editorH>10?0:Math.round((window.innerHeight||600)*0.35)); gripDrag=null; });
$('editor').addEventListener('input', ()=>{ clearTimeout(editTimer); editTimer=setTimeout(onEditorInput, 300); });
$('ragasearch').onchange=()=>applyRagaTala('Raga', $('ragasearch').value.trim());
$('talasel').onchange=()=>applyRagaTala('Tala', $('talasel').value);
// Fullscreen toggle — on mobile this hides the browser address bar.
$('fsbtn').onclick=()=>{ const d=document, el=d.documentElement;
  if (!d.fullscreenElement && !d.webkitFullscreenElement){ (el.requestFullscreen||el.webkitRequestFullscreen||(()=>{})).call(el); }
  else { (d.exitFullscreen||d.webkitExitFullscreen||(()=>{})).call(d); } };
document.addEventListener('fullscreenchange', ()=>setTimeout(fit,100));

// ---------- audio ----------
let AC=null, live=null;
let droneVol=0.5, talaVol=0.5;   // 0..1; live via the per-session dBus/tBus gains
function ensureAudio(){ if (!AC){ try{ AC=new (window.AudioContext||window.webkitAudioContext)(); }catch(e){ return null; } }
  if (AC.state==='suspended') AC.resume();
  if (!live){ const osc=AC.createOscillator(); osc.type='triangle'; osc.frequency.value=freqOf(0);
    const gain=AC.createGain(); gain.gain.value=0; osc.connect(gain); gain.connect(AC.destination); osc.start();
    const dgain=AC.createGain(); dgain.gain.value=0; dgain.connect(AC.destination);
    for (const s of [-EDO,0]){ const o=AC.createOscillator(); o.type='sine'; o.frequency.value=freqOf(s); o.connect(dgain); o.start(); }
    live={osc,gain,dgain}; }
  return AC; }
function liveOn(){ ensureAudio(); if (!live) return; const now=AC.currentTime;
  live.gain.gain.cancelScheduledValues(now); live.gain.gain.setTargetAtTime(0.20,now,0.008); live.dgain.gain.setTargetAtTime(0.05,now,0.03); }
function liveSet(step){ if (live&&AC) live.osc.frequency.setTargetAtTime(freqOf(step),AC.currentTime,0.006); }
function liveOff(){ if (!live) return; const now=AC.currentTime; live.gain.gain.setTargetAtTime(0,now,0.03); live.dgain.gain.setTargetAtTime(0,now,0.05); }
// Playback session — all voices + drone route through one gain so a new Play
// (or Stop) can cut the previous one instead of stacking melodies over each other.
let session=null;
function newSession(a){ stopPlayback(); const g=a.createGain(); g.gain.value=1; g.connect(a.destination); session={gain:g,oscs:[]}; return g; }
function stopPlayback(){ playing=false; playPos=null; if (rafId){ cancelAnimationFrame(rafId); rafId=0; }
  if (session&&AC){ const a=AC, now=a.currentTime, s=session;
    s.gain.gain.cancelScheduledValues(now); s.gain.gain.setTargetAtTime(0.0001,now,0.02);
    setTimeout(()=>{ for (const o of s.oscs){ try{ o.stop(); o.disconnect(); }catch(e){} } try{ s.dBus&&s.dBus.disconnect(); }catch(e){} try{ s.tBus&&s.tBus.disconnect(); }catch(e){} try{ s.gain.disconnect(); }catch(e){} }, 90);
    session=null; }
  if (mode==='roll') render(); }
// playhead loop — advance a line down the roll and scroll so it stays in view ("rolls up")
function tick(){ if (!playing||!AC) return; const el=Math.max(0, AC.currentTime-playStart);
  const pos=playFromU + el/secPerUnit();
  if (pos>=playToU){ playing=false; playPos=null; setPlayBtn('▶',playLabel()); render(); return; }
  playPos=pos;
  // Auto-scroll so the playhead stays ~40% down the viewport (virtual coords). Setting
  // scrollTop fires the scroll listener → render(); we also render() to be safe.
  const hd=$('holder'); hd.scrollTop=Math.max(0, Math.min(Math.max(0,virtH()-hd.clientHeight), (PAD.t+pos*pxU())-hd.clientHeight*0.4));
  render();
  rafId=requestAnimationFrame(tick); }
function playLabel(){ const lo=Math.min(markerA,markerB), hi=Math.max(markerA,markerB); return (lo>0.01||hi<TOTAL-0.01) ? 'Play A–B' : 'Play phrase'; }
// Per-session drone/tala gain buses (live volume). Created lazily on the current
// session; drone()/strum() feed them at a FIXED nominal level and the bus gain
// (= droneVol / talaVol) scales it live from the sliders.
function droneBus(a,dest){ if (!session) return dest; if (!session.dBus){ const g=a.createGain(); g.gain.value=droneVol; g.connect(dest); session.dBus=g; } return session.dBus; }
function talaBus(a,dest){ if (!session) return dest; if (!session.tBus){ const g=a.createGain(); g.gain.value=talaVol; g.connect(dest); session.tBus=g; } return session.tBus; }
// sustained S–P–S drone (53-EDO): mandra Sa, Sa, Pa. Volume is the dBus gain (live).
function drone(a,dest,now,dur){ const bus=droneBus(a,dest), pk=0.09; for (const st of [-EDO,0,31]){ const o=a.createOscillator(); o.type='sine'; o.frequency.value=freqOf(st);
  const g=a.createGain(); g.gain.setValueAtTime(0,now); g.gain.linearRampToValueAtTime(pk,now+0.12); g.gain.setValueAtTime(pk,now+dur-0.2); g.gain.linearRampToValueAtTime(0,now+dur);
  o.connect(g); g.connect(bus); o.start(now); o.stop(now+dur+0.05); if (session) session.oscs.push(o); } }
// Tala accent strum (veena-like pluck): S + P plucked on each accent slot of the
// cycle that falls inside [from,to]. Volume is the tBus gain (live).
function strum(a,bus,when){ const pk=0.24; for (const st of [0,31]){ const o=a.createOscillator(); o.type='triangle'; o.frequency.value=freqOf(st);
  const g=a.createGain(); g.gain.setValueAtTime(0.0001,when); g.gain.exponentialRampToValueAtTime(pk,when+0.006); g.gain.exponentialRampToValueAtTime(0.0008,when+0.34);
  o.connect(g); g.connect(bus); o.start(when); o.stop(when+0.4); if (session) session.oscs.push(o); } }
// Schedule strums regardless of talaVol (0 just means the bus is silent) so raising
// the slider mid-play brings them in.
function tala(a,dest,from,to,start,spu){ if (!talaMeasure||!talaAccents.length) return; const bus=talaBus(a,dest);
  for (let cyc=0; cyc<to; cyc+=talaMeasure){ for (const acc of talaAccents){ const u=cyc+(acc-1);
    if (u<from-1e-6||u>=to) continue; strum(a,bus,start+(u-from)*spu); } } }
// play note nn from when for dur, sounding the sub-range [uStart,uEnd] of its curve
function voice(a,dest,when,dur,nn,uStart=0,uEnd=1){ const o=a.createOscillator(); o.type='triangle';
  // Attack/release scale with the note so a rapid note never has its hold point
  // land before the attack peak (that produced click/pop on fast passages).
  const atk=Math.min(0.012,dur*0.35), rel=Math.min(0.035,dur*0.45), hold=Math.max(when+atk, when+dur-rel);
  const g=a.createGain(); g.gain.setValueAtTime(0.0001,when); g.gain.linearRampToValueAtTime(0.2,when+atk);
  g.gain.setValueAtTime(0.2,hold); g.gain.linearRampToValueAtTime(0.0001,when+dur);
  if (nn.curve&&nn.curve.length>=2){ const N=64,arr=new Float32Array(N); for (let k=0;k<N;k++) arr[k]=freqOf(sampleCurve(nn.curve,uStart+(uEnd-uStart)*k/(N-1))); o.frequency.setValueCurveAtTime(arr,when,dur); }
  else o.frequency.setValueAtTime(freqOf(nn.step),when);
  o.connect(g); g.connect(dest); o.start(when); o.stop(when+dur+0.05); if (session) session.oscs.push(o); }
function playNote(i){ const a=ensureAudio(); if (!a) return; const dest=newSession(a), now=a.currentTime+0.03, dur=Math.max(0.5,NOTES[i].dur*secPerUnit());
  drone(a,dest,now,dur+0.4); voice(a,dest,now,dur,NOTES[i]); }
function autoPlay(){ if (sel>=0&&NOTES[sel].curve) playNote(sel); }
// play the roll from `from` to `to` length-units (partial notes at the ends sound their portion)
function playFrom(from,to){ const a=ensureAudio(); if (!a) return; from=Math.max(0,from); to=Math.min(TOTAL,to); if (to<=from) return;
  const dest=newSession(a), spu=secPerUnit(), start=a.currentTime+0.06;
  drone(a,dest,start,(to-from)*spu+0.4);
  tala(a,dest,from,to,start,spu);
  for (let i=0;i<NOTES.length;i++){ const s0=starts[i], s1=s0+NOTES[i].dur; const aU=Math.max(from,s0), bU=Math.min(to,s1);
    if (bU<=aU) continue; voice(a,dest,start+(aU-from)*spu, (bU-aU)*spu, NOTES[i], (aU-s0)/NOTES[i].dur, (bU-s0)/NOTES[i].dur); }
  playing=true; paused=false; playStart=start; playFromU=from; playToU=to; playPos=from;
  setPlayBtn('⏸','Pause'); if (rafId) cancelAnimationFrame(rafId); rafId=requestAnimationFrame(tick); }
function pausePlayback(){ if (!playing) return; pausedAt=playPos; pausedTo=playToU; stopPlayback(); paused=true; playPos=pausedAt; setPlayBtn('▶','Resume'); render(); }
function segRange(){ return [Math.min(markerA,markerB), Math.max(markerA,markerB)]; }
$('play').onclick=()=>{ if (mode==='draw'){ playNote(sel); return; }
  if (playing){ pausePlayback(); return; }
  if (paused){ playFrom(pausedAt,pausedTo); return; }
  const [lo,hi]=segRange(); playFrom(lo,hi); };
$('stop').onclick=()=>{ stopPlayback(); paused=false; playPos=null; setPlayBtn('▶',playLabel()); if (mode==='roll') render(); };

// ---------- source text (inline gamaka) + share ----------
let shareLink='', shareTimer=null;
// The composition text with the drawn curves inline, each NOTE-RELATIVE (delta).
function inlineSrc(){ const curves={};
  NOTES.forEach((n)=>{ if (n.curve) curves[n.tok]=n.curve.map(([u,s])=>[Math.round(u*100)/100, Math.round(s-n.step)]); });
  return serializeInline(srcText, curves); }

// ---------- model<->srgm edit glue (note-edit core wiring) ----------
// Raga context for step<->swara naming, from the current composition's raga.
function ragaCtx(){ const { ragaSteps, ragaSwaraName } = buildRagaSteps(curRaga || ''); return { useRaga: !!(curRaga && ragaSteps), ragaSteps, ragaSwaraName }; }
// Snapshot of the current model keyed by source-token ordinal (rests excluded).
function modelByTok(){ const m=new Map(); NOTES.forEach(n=>m.set(n.tok,{ step:n.step, dur:n.dur, octave:n.octave, curve:n.curve })); return m; }
// The raga's pitch-classes (single-octave 53-EDO MOD-steps) for pitch snapping.
// IMPORTANT: snapToRagaRow(step, gridSteps) reconstructs the octave from `step`
// itself, so gridSteps must be single-octave mods (0..52), NOT absolute multi-octave
// rows — passing absolute rows would double-count the octave. Raga mode => the
// raga's mod-steps; no-raga (c12) => the distinct pitch-classes of existing notes.
function ragaRowSteps(){ const { ragaSteps }=ragaCtx();
  if (ragaSteps) return [...ragaSteps];
  return [...new Set(NOTES.map(n=>((n.step%EDO)+EDO)%EDO))].sort((a,b)=>a-b); }

// ---- undo (structural edits round-trip through srcText) ----
let undoStack=[];
function pushUndo(){ undoStack.push(srcText); if (undoStack.length>50) undoStack.shift(); }
async function undo(){ hideToast(); if (!undoStack.length) return; const prev=undoStack.pop();
  if (mode==='draw') $('back').click(); buildModel(prev); syncControls(); resizeCanvas(); render(); await rebuildShare(); }
$('undobtn').onclick=()=>{ undo(); };
// Ctrl/Cmd+Z triggers structural undo only in roll mode and only outside the srgm
// editor textarea, so native textarea undo (typing) still works while editing text.
document.addEventListener('keydown', e=>{ if ((e.ctrlKey||e.metaKey) && !e.shiftKey && (e.key==='z'||e.key==='Z') && mode==='roll' && document.activeElement!==$('editor')){ e.preventDefault(); undo(); } });

// Re-serialize the current model to srgm, then rebuild everything from that text.
async function commitEdit({ changed=new Set(), inserts=new Map(), deletes=new Set(), deriveOctave=false }){
  const newSrc=serializeModel(srcText, { model:modelByTok(), changed, inserts, deletes, deriveOctave, ctx:ragaCtx() });
  buildModel(newSrc); syncControls(); resizeCanvas(); render(); await rebuildShare(); }
// Reflect srcText into the editor textarea — but never clobber the box the user
// is actively typing in (that also preserves its native ctrl-z history).
function syncEditor(){ const t=$('editor'); if (t && document.activeElement!==t) t.value=srcText; }
// A draw changed the curves: regenerate the inline srgm, show it in the editor,
// persist it, and refresh the share link.
async function rebuildShare(){ srcText=inlineSrc(); syncEditor();
  try{ localStorage.setItem(LS_KEY, srcText); }catch(_){}
  try{ shareLink=location.origin+location.pathname+'#'+await encodeShareToken(srcText); }catch(e){ shareLink=''; } }
function scheduleShare(){ clearTimeout(shareTimer); shareTimer=setTimeout(rebuildShare,150); }
// Editor edits: reparse the srgm the user typed (debounced), rebuild the roll.
let editTimer=null;
async function onEditorInput(){ hideToast(); if (mode==='draw') $('back').click();   // a reparse changes NOTES; leave draw mode so sel can't dangle
  srcText=$('editor').value; buildModel(srcText);
  syncControls(); resizeCanvas(); render();
  try{ localStorage.setItem(LS_KEY, srcText); }catch(_){}
  try{ shareLink=location.origin+location.pathname+'#'+await encodeShareToken(srcText); }catch(e){ shareLink=''; } }
$('share').onclick=()=>{ const url=shareLink; if (!url){ rebuildShare(); return; }
  const b=$('share'), orig=b.textContent, done=m=>{ b.textContent=m; setTimeout(()=>b.textContent=orig,1800); };
  if (navigator.share){ navigator.share({ title:'RagamRoll gamakas', url }).then(()=>done('Shared ✓')).catch(()=>{}); return; }
  if (navigator.clipboard){ navigator.clipboard.writeText(url).then(()=>done('Copied ✓')).catch(()=>window.prompt('Copy this link:',url)); return; }
  window.prompt('Copy this link:', url); };

// ---------- load / boot ----------
// Debug dump: log the note map (index, source token ordinal, swara, curve points).
function logNotes(tag){ try{ console.log(`[draw] ${tag} — idx:tok swara [pts]:`,
  NOTES.map((n,i)=>`${i}:t${n.tok} ${n.swara}${n.octave}${n.curve?` [${n.curve.length}]`:''}`).join('   ')); }catch(_){}
}
// A share hash is pako(srgm text). Legacy links were pako(JSON {v,src,g}); detect
// and convert those once (apply the index-keyed curves; they re-emit inline).
function applyShared(decoded){
  hideToast();
  userGridMin = userGridMax = userGridBottom = null;   // new composition: start at auto/seed bounds, not a stale stretch
  let legacy=null;
  try{ const o=JSON.parse(decoded); if (o&&typeof o.src==='string') legacy=o; }catch(_){}
  console.log(`[draw] pako decoded — ${legacy?'LEGACY {v,src,g}':'raw srgm text'} (${decoded.length} chars):\n%s`,
    legacy ? JSON.stringify(legacy, null, 1) : decoded);
  if (legacy){ buildModel(legacy.src);
    if (legacy.g) for (const k in legacy.g){ const i=+k; if (NOTES[i]) NOTES[i].curve=legacy.g[k].map(p=>[p[0],p[1]]); } }
  else buildModel(decoded);   // raw srgm text; inline gamaka decoded in buildModel
  logNotes('after applyShared');
}
async function loadComposition(){
  const h=location.hash.replace(/^#/,'');
  if (h){ try{ applyShared(await decodeShareToken(h)); return; }catch(e){ console.warn('[draw] pako decode failed', e); } }
  const ls=localStorage.getItem(LS_KEY) || 'Raga=hamsadhwani,0 O=5 L=1 S R G P N >S';
  console.log(`[draw] loaded from localStorage (${ls.length} chars):\n%s`, ls);
  buildModel(ls); logNotes('after localStorage load');
}
// ---------- composition I/O: Open (examples / file / link), Save, Export MIDI ----------
const baseName = s => String(s||'ragamroll').replace(/^.*[\/\\]/,'').replace(/\.[^.]+$/,'') || 'ragamroll';
// Load a whole new composition into the roll + editor (and persist / reshare).
async function loadSrc(text, name){ hideToast(); if (mode==='draw') $('back').click(); stopPlayback();
  userGridMin = userGridMax = userGridBottom = null;   // new composition: start at auto/seed bounds, not a stale stretch
  if (name) docName=name; buildModel(text); syncControls(); resizeCanvas(); render(); await rebuildShare(); }
async function pasteLink(){ const inp=window.prompt('Paste a RagamRoll share link or pako token:'); if (!inp) return;
  const m=/pako:[A-Za-z0-9\-_]+/.exec(inp); const tok=m?m[0]:inp.trim().replace(/^#/,'');
  try{ if (mode==='draw') $('back').click(); stopPlayback(); applyShared(await decodeShareToken(tok));
    syncControls(); resizeCanvas(); render(); await rebuildShare(); }
  catch(e){ window.alert('That isn’t a valid RagamRoll link — it should contain a pako: token.'); } }
// Open ▾ menu (examples list + open file + paste link)
function hideOpen(){ $('openmenu').style.display='none'; }
$('openbtn').onclick=e=>{ e.stopPropagation(); const m=$('openmenu');
  if (m.style.display==='block'){ hideOpen(); return; }
  m.style.display='block'; const r=$('openbtn').getBoundingClientRect();
  m.style.left=Math.max(6, Math.min(r.left, innerWidth-m.offsetWidth-8))+'px';
  m.style.top=Math.max(6, r.top-m.offsetHeight-6)+'px'; };
document.addEventListener('pointerdown', e=>{ const m=$('openmenu'); if (m.style.display==='block' && !m.contains(e.target) && e.target!==$('openbtn')) hideOpen(); });
$('exsel').onchange=async e=>{ const name=e.target.value; e.target.value=''; if (!name) return; hideOpen();
  try{ loadSrc(await fetch('./examples/'+name+'.srgm').then(r=>{ if(!r.ok) throw 0; return r.text(); }), name); }
  catch(_){ window.alert('Could not load that example.'); } };
$('openmenu').addEventListener('click', e=>{ const act=e.target.getAttribute('data-act'); if (!act) return; hideOpen();
  if (act==='new'){ loadSrc(blankSrc(), 'untitled'); setEditorH(Math.round((window.innerHeight||600)*0.35)); }
  else if (act==='file') $('fileinput').click(); else if (act==='link') pasteLink(); });
$('fileinput').onchange=async e=>{ const f=e.target.files[0]; e.target.value=''; if (f) loadSrc(await f.text(), baseName(f.name)); };
// Save / Export MIDI (gamakas are audio-only; MIDI stays plain)
function download(name, data, type){ const a=document.createElement('a'); a.href=URL.createObjectURL(new Blob([data],{type})); a.download=name; a.click(); URL.revokeObjectURL(a.href); }
$('save').onclick=()=>download(docName+'.srgm', srcText, 'text/plain');
$('exportmidi').onclick=()=>{ try{ download(docName+'.mid', writeSMF(buildSequence(parse(srcText))), 'audio/midi'); }catch(e){ window.alert('MIDI export failed: '+e.message); } };
window.__rr = { notes:()=>NOTES, X, Y, starts:()=>starts, get shareLink(){ return shareLink; }, get playPos(){ return playPos; }, get markerA(){ return markerA; }, get markerB(){ return markerB; }, get talaMeasure(){ return talaMeasure; }, get talaAccents(){ return talaAccents; }, get droneVol(){ return droneVol; }, get talaVol(){ return talaVol; }, inlineSrc:()=>inlineSrc(), rebuild:()=>rebuildShare(), get src(){ return srcText; } };
// Populate the examples dropdown from the manifest (same source as the app).
fetch('./examples/index.json').then(r=>r.json()).then(list=>{
  const sel=$('exsel'); for (const n of list){ const o=document.createElement('option'); o.value=n; o.textContent=n; sel.appendChild(o); }
}).catch(()=>{});
Promise.all([
  fetch('./core/raga-base.json').then(r=>r.json()),
  fetch('./core/raga-ext.json').then(r=>r.json()).catch(()=>({})),
  fetch('./core/raga-add.json').then(r=>r.json()).catch(()=>({})),
]).then(([base,ext,add])=>{ const ragas={ ...base, ...add }; setRagas(ragas); setRagaExt(ext);
    const ragaNames=Object.keys(ragas).filter(n=>!/^mela_\d+$/i.test(n)).sort((a,b)=>a.toLowerCase().localeCompare(b.toLowerCase())); defaultRaga=ragaNames[0]||'c12';
    const rl=$('ragalist'); for (const n of ragaNames){ const o=document.createElement('option'); o.value=n; rl.appendChild(o); }
    const ts=$('talasel'); for (const n of Object.keys(TALA_MAP)){ const o=document.createElement('option'); o.value=n; o.textContent=n; ts.appendChild(o); }
    return loadComposition(); })
  .then(()=>{ window.addEventListener('resize',fit); if (window.visualViewport) window.visualViewport.addEventListener('resize',fit);
    window.addEventListener('orientationchange',()=>setTimeout(fit,200));
    new MutationObserver(render).observe(document.documentElement,{attributes:true,attributeFilter:['data-theme']});
    if (!NOTES.length) $('mode').textContent='no notes — open a composition in the app first';
    syncControls(); fit(); resizeCanvas(); rebuildShare(); });
