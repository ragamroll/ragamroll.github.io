// Exact per-row audio start times for the ascii roll. Pure math, no DOM.
//
// The roll (seqToRoll) draws Math.trunc(absLen) rows per note event (rests
// included), so a row is NOT a fixed time slice — driving the playhead from
// position*totalRows drifts. buildRowTimes replays the same iteration and
// records each row's exact start second; rowAt maps an audio time back to
// the row index.

/**
 * One entry per roll row: the second at which that row becomes active.
 * Matches seqToRoll's row generation: for each `type === 'note'` event
 * (rests included), Math.trunc(absLen) rows, evenly spaced within the note's
 * duration. The cursor advances by the full duration even for 0-row notes so
 * time stays aligned. Length = sum of trunc(absLen) over note events.
 *
 * @param {{events: Array, meta?: {tempo?: number}}} model parsed model
 * @param {number} [ppq]
 * @returns {number[]}
 */
export function buildRowTimes(model, ppq = 480) {
  const tempoBpm = (model.meta && model.meta.tempo > 0) ? model.meta.tempo : 120;
  const secPerUnit = 240 * (60 / tempoBpm / ppq); // 1 length-unit = eighth = ppq/2 ticks
  const times = [];
  let cursor = 0;
  for (const e of model.events) {
    if (e.type !== 'note') continue;
    const rows = Math.trunc(e.absLen);
    const durSec = e.absLen * secPerUnit;
    if (rows > 0) {
      const rowDur = durSec / rows;
      for (let i = 0; i < rows; i++) times.push(cursor + i * rowDur);
    }
    cursor += durSec; // always advance, even for 0-row notes
  }
  return times;
}

/**
 * Index of the last row whose start time <= t (binary search).
 * 0 if t precedes the first row (or the array is empty); length-1 beyond the last.
 *
 * @param {number[]} rowTimes
 * @param {number} t seconds
 * @returns {number}
 */
export function rowAt(rowTimes, t) {
  const n = rowTimes.length;
  if (n === 0 || t <= rowTimes[0]) return 0;
  if (t >= rowTimes[n - 1]) return n - 1;
  let lo = 0, hi = n - 1; // invariant: rowTimes[lo] <= t < rowTimes[hi]
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (rowTimes[mid] <= t) lo = mid; else hi = mid;
  }
  return lo;
}
