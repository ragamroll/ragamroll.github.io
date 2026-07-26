// Gamaka draw page. Opens the current composition (localStorage, or a shared
// #pako link) as a pitch/time roll and lets the user draw a pitch curve per note.
// Pitch is 53-EDO (22-shruti): notes sit on their default shruti, snap targets
// the 22 shrutis, audio is microtonal. Curves + the srgm source pack into a
// #pako link (melody + gamakas).
import { parse } from './core/parser.js';
import { setRagas } from './core/raga-base.js';
import { setRagaExt } from './core/raga-ext.js';
import { midiToFreq } from './audio/schedule.js';
import { BOXES, EDO, stepFreq, defaultShrutiStep } from './core/shruti.js';
import { encodeShareToken, decodeShareToken } from './core/share.js';
import { VERSION, BUILD_DATE } from './version.js';
import { midiToName } from './core/tuning.js';
import { serializeInline } from './core/gamaka-inline.js';
import { buildSequence } from './core/midi/sequence.js';
import { writeSMF } from './core/midi/smf.js';

const LS_KEY = 'ragamroll.srgm';
const SHRUTI = [...new Set(BOXES.map(b => b.step))].sort((a, b) => a - b);   // 22 steps in an octave

// ---------- model built from the parsed composition ----------
let NOTES = [];        // [{step, dur, swara, octave, curve:null|[[u,step]...]}]
let saRef = 60, saFreq = midiToFreq(60), tempoBpm = 120, TOTAL = 0;
let saPlay = null;     // Sa reference-pitch override (midi); null = auto (= saRef, the layout anchor)
let compTempo = 120;   // the composition's own tempo; the tempo slider is a multiplier of this
let starts = [], gridPitches = [], stepMin = -26, stepMax = 66, srcText = '';
let talaMeasure = 0, talaAccents = [];   // cycle length (length-units) + 1-based accent slots
let docName = 'ragamroll';               // base filename for Save / Export MIDI
let curRaga = '', curTala = '';          // readout

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
  NOTES = notes.map((n, i) => {
    const step = stepOfSemitone(n.midi - saRef);
    // Inline gamaka is stored NOTE-RELATIVE (delta); the roll model is absolute.
    const curve = (Array.isArray(n.gamaka) && n.gamaka.length) ? n.gamaka.map(([u, d]) => [u, step + d]) : null;
    return { step, dur: n.absLen, swara: n.swara.toUpperCase(), octave: n.octave, curve, tok: keep[i] };
  });
  starts = []; let t = 0; for (const n of NOTES){ starts.push(t); t += n.dur; } TOTAL = t || 1;
  const tp = [...model.events].reverse().find(e => e.type === 'tala');   // accent strums (veena) at tala accents
  talaMeasure = (tp && tp.props && tp.props.measure > 0) ? tp.props.measure : 0;
  talaAccents = (tp && tp.props && Array.isArray(tp.props.accents)) ? tp.props.accents : [];
  const rk = [...model.events].reverse().find(e => e.type === 'raga');
  curRaga = rk ? String(rk.key[0]) : '';
  curTala = tp ? `beat ${tp.props.beat}` : '';
  const seen = new Map();
  for (const n of NOTES){ if (!seen.has(n.step)) seen.set(n.step, { step: n.step, label: n.swara + n.octave }); }
  gridPitches = [...seen.values()].sort((a, b) => a.step - b.step);
  const ps = NOTES.map(n => n.step);
  stepMin = Math.min(...ps) - 9; stepMax = Math.max(...ps) + 9;
  if (!(stepMax > stepMin)) { stepMin = -26; stepMax = 66; }
}
const freqOf = step => stepFreq(saFreq, step);
const secPerUnit = () => 30 / tempoBpm;
function snapStep(s){ const oct = Math.floor(s / EDO), base = s - oct * EDO; let best = SHRUTI[0], bd = Infinity;
  for (const sh of [...SHRUTI, EDO]){ const d = Math.abs(base - sh); if (d < bd){ bd = d; best = sh; } }
  return oct * EDO + best; }

// ---------- canvas ----------
const cv = document.getElementById('cv'), ctx = cv.getContext('2d');
let CSSW=0, CSSH=0, dpr=1, mode='roll', sel=-1, drawing=false, drawSpan=22, dragIdx=-1;
// Roll is always fully expanded: scale time so the SHORTEST note cell is at least
// CELL_PX tall — enough to render its swara glyph, mobile portrait included.
const CELL_PX = 24;
function pxPerUnit(){ if (!NOTES.length) return CELL_PX; const minDur=Math.min(...NOTES.map(n=>n.dur)); return CELL_PX/Math.max(0.25,minDur); }
let playing=false, paused=false, playStart=0, rafId=0, playPos=null;   // playhead (length-units)
let playFromU=0, playToU=0, pausedAt=0, pausedTo=0;                    // playback range + pause point
let markerA=null, markerB=null, ctxTime=0;                            // A–B segment markers (length-units)
const cssvar = k => getComputedStyle(document.documentElement).getPropertyValue(k).trim();
const PAD = { l:40, r:12, t:24, b:12 };
const plot = () => ({ x:PAD.l, y:PAD.t, w:CSSW-PAD.l-PAD.r, h:CSSH-PAD.t-PAD.b });
function xRange(){ if (mode==='draw'){ const c=NOTES[sel].step; return [c-drawSpan, c+drawSpan]; } return [stepMin, stepMax]; }
function X(s){ const [a,b]=xRange(), p=plot(); return p.x + (s-a)/(b-a)*p.w; }
function stepAtX(px){ const [a,b]=xRange(), p=plot(); return a + (px-p.x)/p.w*(b-a); }
function yStartEnd(){ if (mode==='draw') return [starts[sel], starts[sel]+NOTES[sel].dur]; return [0, TOTAL]; }
function Y(t){ const [a,b]=yStartEnd(), p=plot(); return p.y + (t-a)/(b-a)*p.h; }
function tAtY(py){ const [a,b]=yStartEnd(), p=plot(); return a + (py-p.y)/p.h*(b-a); }

function fit(){ const h=(window.visualViewport&&window.visualViewport.height)||window.innerHeight;
  document.getElementById('wrap').style.height=h+'px'; requestAnimationFrame(resizeCanvas); }
function resizeCanvas(){ const hd=document.getElementById('holder'); const baseH=Math.max(150,hd.clientHeight);
  CSSW=hd.clientWidth; CSSH = mode==='roll' ? Math.max(baseH, Math.round(TOTAL*pxPerUnit()) + PAD.t + PAD.b) : baseH;
  dpr=Math.min(2,window.devicePixelRatio||1); cv.width=CSSW*dpr; cv.height=CSSH*dpr; cv.style.width=CSSW+'px'; cv.style.height=CSSH+'px';
  cv.style.touchAction = mode==='draw' ? 'none' : 'pan-y';   // draw: no scroll; roll: allow vertical scroll
  ctx.setTransform(dpr,0,0,dpr,0,0); render(); }

function render(){
  const p=plot(); ctx.clearRect(0,0,CSSW,CSSH);
  const amber=cssvar('--amber'),amberS=cssvar('--amberSoft'),teal=cssvar('--teal'),terra=cssvar('--terra'),hair=cssvar('--hair2'),muted=cssvar('--muted');
  ctx.font='11px '+cssvar('--mono'); const [sa,sb]=xRange();
  if (mode==='draw'){ for (let oct=Math.floor(sa/EDO)-1; oct<=Math.floor(sb/EDO)+1; oct++) for (const sh of SHRUTI){ const s=oct*EDO+sh;
    if (s<sa||s>sb) continue; const x=X(s); ctx.strokeStyle=hair; ctx.globalAlpha=.5; ctx.beginPath(); ctx.moveTo(x,p.y); ctx.lineTo(x,p.y+p.h); ctx.stroke(); ctx.globalAlpha=1; } }
  for (const g of gridPitches){ if (g.step<sa-1||g.step>sb+1) continue; const x=X(g.step);
    ctx.strokeStyle=hair; ctx.lineWidth=1; ctx.beginPath(); ctx.moveTo(x,p.y); ctx.lineTo(x,p.y+p.h); ctx.stroke();
    ctx.fillStyle=muted; ctx.textAlign='center'; ctx.fillText(g.label, x, p.y-8); }
  const [ta,tb]=yStartEnd();
  for (let i=0;i<=NOTES.length;i++){ const t=(i<NOTES.length)?starts[i]:TOTAL; if (t<ta-1e-6||t>tb+1e-6) continue; const y=Y(t);
    const sam=(t===0); ctx.strokeStyle=terra; ctx.globalAlpha=sam?.85:.22; ctx.lineWidth=sam?2.2:.8;
    ctx.beginPath(); ctx.moveTo(p.x,y); ctx.lineTo(p.x+p.w,y); ctx.stroke(); ctx.globalAlpha=1; }
  const colW = mode==='draw' ? 0 : Math.max(9, p.w/(stepMax-stepMin)*4);
  for (let i=0;i<NOTES.length;i++){ if (mode==='draw'&&i!==sel) continue;
    const nn=NOTES[i], y0=Y(starts[i]), y1=Y(starts[i]+nn.dur), x=X(nn.step), selNow=i===sel;
    const w = mode==='draw' ? Math.max(30,p.w*0.14) : colW;
    ctx.fillStyle = selNow?'rgba(216,161,63,.16)':'rgba(216,161,63,.07)';
    ctx.strokeStyle = selNow?amber:amberS; ctx.lineWidth=selNow?2:1.3; ctx.setLineDash(mode==='draw'?[5,4]:[]);
    roundRect(x-w/2, y0+1, w, Math.max(3,y1-y0-2), 5); ctx.fill(); ctx.stroke(); ctx.setLineDash([]);
    if (nn.curve) drawCurve(nn, starts[i], starts[i]+nn.dur, teal, mode==='draw'?3:2);
    if (mode!=='draw'){ ctx.fillStyle=amber; ctx.textAlign='center'; ctx.fillText(nn.swara, x, y0+13); } }
  if (mode==='draw'&&!NOTES[sel].curve){ ctx.fillStyle=muted; ctx.textAlign='center'; ctx.font='13px '+cssvar('--sans');
    ctx.fillText('drag top→bottom to draw the pitch', p.x+p.w/2, p.y+p.h/2); }
  if (mode==='draw'&&NOTES[sel].curve&&!drawing){ const c=NOTES[sel].curve,[t0,t1]=yStartEnd();
    for (let k=0;k<c.length;k++){ const cx=X(c[k][1]),cy=Y(t0+(t1-t0)*c[k][0]);
      ctx.beginPath();ctx.arc(cx,cy,6.5,0,7);ctx.fillStyle=cssvar('--bg');ctx.fill();
      ctx.lineWidth=2;ctx.strokeStyle=teal;ctx.stroke(); ctx.beginPath();ctx.arc(cx,cy,2.4,0,7);ctx.fillStyle=teal;ctx.fill(); } }
  if (mode==='roll'){   // A–B segment markers
    if (markerA!=null&&markerB!=null){ const y0=Y(Math.min(markerA,markerB)), y1=Y(Math.max(markerA,markerB)); ctx.fillStyle='rgba(216,161,63,.07)'; ctx.fillRect(p.x,y0,p.w,y1-y0); }
    const mk=(m,lbl)=>{ if (m==null) return; const y=Y(m); ctx.strokeStyle=amber; ctx.setLineDash([6,4]); ctx.lineWidth=1.6; ctx.beginPath(); ctx.moveTo(p.x,y); ctx.lineTo(p.x+p.w,y); ctx.stroke(); ctx.setLineDash([]); ctx.fillStyle=amber; ctx.textAlign='left'; ctx.font='bold 11px '+cssvar('--mono'); ctx.fillText(lbl,p.x+3,y-3); };
    mk(markerA,'A'); mk(markerB,'B'); }
  if (mode==='roll'&&playPos!=null){ const y=Y(playPos);   // playhead sweeps down as the roll plays
    ctx.strokeStyle=teal; ctx.globalAlpha=.95; ctx.lineWidth=2; ctx.beginPath(); ctx.moveTo(p.x,y); ctx.lineTo(p.x+p.w,y); ctx.stroke(); ctx.globalAlpha=1;
    ctx.fillStyle=teal; ctx.beginPath(); ctx.moveTo(p.x,y-4); ctx.lineTo(p.x+7,y); ctx.lineTo(p.x,y+4); ctx.closePath(); ctx.fill(); }
}
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
cv.addEventListener('click', e=>{ if (mode!=='roll') return; ensureAudio(); const {x,y}=evtPos(e); const i=hitNote(x,y); if (i>=0) enterDraw(i); });
cv.addEventListener('pointerdown', e=>{ if (mode!=='draw') return; cv.setPointerCapture(e.pointerId); ensureAudio(); const {x,y}=evtPos(e);
  if (NOTES[sel].curve){ const hi=hitHandle(x,y); if (hi>=0){ dragIdx=hi; liveOn(); liveSet(NOTES[sel].curve[hi][1]); return; } }
  drawing=true; NOTES[sel].curve=[]; liveOn(); addPoint(x,y); render(); });
cv.addEventListener('pointermove', e=>{ if (mode!=='draw') return; const {x,y}=evtPos(e);
  if (dragIdx>=0){ dragHandle(x,y); render(); return; }
  if (!drawing) return; addPoint(x,y); render(); });
cv.addEventListener('pointerup', ()=>{
  if (dragIdx>=0){ if (document.getElementById('snap').checked) NOTES[sel].curve[dragIdx][1]=snapStep(NOTES[sel].curve[dragIdx][1]); dragIdx=-1; liveOff(); render(); autoPlay(); scheduleShare(); return; }
  if (drawing){ drawing=false; liveOff(); finalizeCurve(); render(); autoPlay(); scheduleShare(); } });
cv.addEventListener('pointercancel', ()=>{ if (drawing){ drawing=false; liveOff(); } dragIdx=-1; });
function hitNote(x,y){ for (let i=0;i<NOTES.length;i++){ const y0=Y(starts[i]),y1=Y(starts[i]+NOTES[i].dur),xc=X(NOTES[i].step),w=Math.max(16,plot().w/(stepMax-stepMin)*4);
  if (y>=y0&&y<=y1&&x>=xc-w/2-6&&x<=xc+w/2+6) return i; } return -1; }
function addPoint(x,y){ const p=plot(),[ba,bb]=yStartEnd();
  let u=Math.max(0,Math.min(1,(tAtY(y)-ba)/(bb-ba)));
  const st=stepAtX(Math.max(p.x,Math.min(p.x+p.w,x)));
  const c=NOTES[sel].curve; if (c.length&&u<=c[c.length-1][0]) c[c.length-1][1]=st; else c.push([u,st]);
  liveSet(st); document.getElementById('read').textContent='≈'+freqOf(st).toFixed(0)+' Hz'; }
function extractAnchors(raw){ if (raw.length<=2) return raw.slice();
  const A=[raw[0]]; let dir=0;
  for (let i=1;i<raw.length;i++){ const d=raw[i][1]-raw[i-1][1]; const sd=d>0.3?1:(d<-0.3?-1:0);
    if (sd!==0){ if (dir!==0&&sd!==dir&&Math.abs(raw[i-1][1]-A[A.length-1][1])>=2) A.push(raw[i-1]); dir=sd; } }
  A.push(raw[raw.length-1]); return A; }
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
  $('play').textContent='▶ Play note'; $('rangectl').style.display=''; $('snapctl').style.display=''; resizeCanvas(); }
$('back').onclick=()=>{ mode='roll'; sel=-1; $('mode').textContent='select a note'; $('crumb').textContent='';
  for (const b of ['clear','copy','paste','back']) $(b).style.display='none';   // draw-only buttons hidden in roll mode
  $('read').textContent=''; $('play').textContent='▶ Play phrase';
  $('rangectl').style.display='none'; $('snapctl').style.display='none'; resizeCanvas(); };
$('clear').onclick=()=>{ if (sel>=0){ NOTES[sel].curve=null; $('clear').disabled=true; $('copy').disabled=true; render(); scheduleShare(); } };
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
function setPlayIdle(){ if (!playing&&!paused) $('play').textContent='▶ '+playLabel(); }
cv.addEventListener('contextmenu', e=>{ if (mode!=='roll') return; e.preventDefault(); const {x,y}=evtPos(e);
  ctxNote=hitNote(x,y); ctxTime=Math.max(0,Math.min(TOTAL,tAtY(y))); const cm=$('ctxmenu');
  cm.querySelector('[data-act=copy]').disabled=!(ctxNote>=0&&NOTES[ctxNote].curve);
  cm.querySelector('[data-act=paste]').disabled=!(ctxNote>=0&&clipRel);
  cm.querySelector('[data-act=clearmk]').disabled=(markerA==null&&markerB==null);
  cm.style.left=Math.min(e.clientX, window.innerWidth-170)+'px'; cm.style.top=Math.min(e.clientY, window.innerHeight-210)+'px'; cm.style.display='block'; });
function hideCtx(){ $('ctxmenu').style.display='none'; }
$('ctxmenu').addEventListener('click', e=>{ const act=e.target.getAttribute&&e.target.getAttribute('data-act'); if (!act){ hideCtx(); return; }
  if (act==='copy'&&ctxNote>=0) copyFrom(ctxNote);
  else if (act==='paste'&&ctxNote>=0) pasteTo(ctxNote);
  else if (act==='seta'){ markerA=ctxTime; setPlayIdle(); render(); }
  else if (act==='setb'){ markerB=ctxTime; setPlayIdle(); render(); }
  else if (act==='clearmk'){ markerA=markerB=null; setPlayIdle(); render(); }
  else if (act==='playfrom'){ playFrom(ctxTime, (markerB!=null&&markerB>ctxTime)?markerB:TOTAL); }
  hideCtx(); });
document.addEventListener('pointerdown', e=>{ if (!$('ctxmenu').contains(e.target)) hideCtx(); });
document.addEventListener('keydown', e=>{ if (e.key==='Escape') hideCtx(); });
$('holder').addEventListener('scroll', hideCtx);
// help popup
$('helpbtn').onclick=()=>{ const h=$('helppop'); h.hidden=!h.hidden; };
$('helpclose').onclick=()=>{ $('helppop').hidden=true; };
document.addEventListener('pointerdown', e=>{ const h=$('helppop'); if (!h.hidden && !h.contains(e.target) && e.target.id!=='helpbtn') h.hidden=true; });
document.addEventListener('keydown', e=>{ if (e.key==='Escape') $('helppop').hidden=true; });
$('rmin').onclick=()=>{ drawSpan=Math.max(10,drawSpan-8); resizeCanvas(); };
$('rplus').onclick=()=>{ drawSpan=Math.min(60,drawSpan+8); resizeCanvas(); };   // 60 ≈ a bit over an octave (53-EDO) each side
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
  $('rt').textContent = curRaga ? `${curRaga} · ${curTala}` : ''; }
// Back to the app: carry the composition CURRENTLY open here into the app (it reads
// the same localStorage key), so the app opens the same piece — not whatever it held.
$('backapp').onclick=e=>{ e.preventDefault(); try{ localStorage.setItem(LS_KEY, srcText); }catch(_){}; location.href='./index.html'; };
// Editor dialog: the full srgm (inline gamaka included), freely editable; native
// ctrl-z works for typing. Edits reparse (debounced) and rebuild the roll.
$('editbtn').onclick=()=>{ const t=$('editor'); t.value=srcText; $('editdlg').hidden=false; t.focus(); };
$('editclose').onclick=()=>{ $('editdlg').hidden=true; };
$('editdlg').addEventListener('pointerdown', e=>{ if (e.target===$('editdlg')) $('editdlg').hidden=true; });
document.addEventListener('keydown', e=>{ if (e.key==='Escape' && !$('editdlg').hidden) $('editdlg').hidden=true; });
$('editor').addEventListener('input', ()=>{ clearTimeout(editTimer); editTimer=setTimeout(onEditorInput, 300); });

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
  if (pos>=playToU){ playing=false; playPos=null; $('play').textContent='▶ '+playLabel(); render(); return; }
  playPos=pos; render();
  const hd=$('holder'); hd.scrollTop=Math.max(0, Math.min(CSSH-hd.clientHeight, Y(playPos)-hd.clientHeight*0.4));
  rafId=requestAnimationFrame(tick); }
function playLabel(){ return (markerA!=null&&markerB!=null) ? 'Play A–B' : 'Play phrase'; }
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
  const g=a.createGain(); g.gain.setValueAtTime(0,when); g.gain.linearRampToValueAtTime(0.2,when+0.03); g.gain.setValueAtTime(0.2,when+dur-0.05); g.gain.linearRampToValueAtTime(0,when+dur);
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
  $('play').textContent='⏸ Pause'; if (rafId) cancelAnimationFrame(rafId); rafId=requestAnimationFrame(tick); }
function pausePlayback(){ if (!playing) return; pausedAt=playPos; pausedTo=playToU; stopPlayback(); paused=true; playPos=pausedAt; $('play').textContent='▶ Resume'; render(); }
function segRange(){ const lo=(markerA!=null&&markerB!=null)?Math.min(markerA,markerB):(markerA!=null?markerA:0);
  const hi=(markerA!=null&&markerB!=null)?Math.max(markerA,markerB):(markerB!=null?markerB:TOTAL); return [lo,hi]; }
$('play').onclick=()=>{ if (mode==='draw'){ playNote(sel); return; }
  if (playing){ pausePlayback(); return; }
  if (paused){ playFrom(pausedAt,pausedTo); return; }
  const [lo,hi]=segRange(); playFrom(lo,hi); };
$('stop').onclick=()=>{ stopPlayback(); paused=false; playPos=null; $('play').textContent='▶ '+playLabel(); if (mode==='roll') render(); };

// ---------- source text (inline gamaka) + share ----------
let shareLink='', shareTimer=null;
// The composition text with the drawn curves inline, each NOTE-RELATIVE (delta).
function inlineSrc(){ const curves={};
  NOTES.forEach((n)=>{ if (n.curve) curves[n.tok]=n.curve.map(([u,s])=>[Math.round(u*100)/100, Math.round(s-n.step)]); });
  return serializeInline(srcText, curves); }
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
async function onEditorInput(){ if (mode==='draw') $('back').click();   // a reparse changes NOTES; leave draw mode so sel can't dangle
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
async function loadSrc(text, name){ if (mode==='draw') $('back').click(); stopPlayback();
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
  if (act==='file') $('fileinput').click(); else if (act==='link') pasteLink(); });
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
]).then(([base,ext,add])=>{ setRagas({ ...base, ...add }); setRagaExt(ext); return loadComposition(); })
  .then(()=>{ window.addEventListener('resize',fit); if (window.visualViewport) window.visualViewport.addEventListener('resize',fit);
    window.addEventListener('orientationchange',()=>setTimeout(fit,200));
    new MutationObserver(render).observe(document.documentElement,{attributes:true,attributeFilter:['data-theme']});
    if (!NOTES.length) $('mode').textContent='no notes — open a composition in the app first';
    syncControls(); fit(); resizeCanvas(); rebuildShare(); });
