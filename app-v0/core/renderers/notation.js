// Port of NotationParser.SeqToLine — Carnatic-textbook-style single line(s).
export function seqToLine(events, charSpacing = 1, lineSpacing = 1, foldAccents = false) {
  const fold = foldAccents ? '\n'.repeat(lineSpacing) : '';
  let dispTxt = '';
  let beat = 0, measure = 0, accents = [];

  for (const v of events) {
    if (v.type === 'tala') {
      ({ beat, measure, accents } = v.props);
    }
    if (v.type === 'note') {
      dispTxt += v.swara[0];
      const len = Math.trunc(v.absLen);
      if (len > 1) {
        for (let xx1 = 0; xx1 <= len - 2; xx1++) {
          dispTxt += (xx1 % 2 === 0) ? '.' : "'";
        }
      }
    }
  }

  // Guard: a non-positive measure/beat (e.g. a broken Tala= with beat 0) would
  // make `lines` Infinity below and hang the render loop. Degrade to the raw
  // swara line instead of freezing — the parser also flags the bad tala.
  if (!(measure > 0) || !(beat > 0)) return dispTxt;

  const out = [];
  const lines = Math.floor(dispTxt.length / measure);   // floor(BigDecimal range)
  for (let i = 0; i < lines; i++) {
    const ll = dispTxt.slice(i * measure, (i + 1) * measure).split('');
    for (let j = 0; j <= measure - 1; j++) {
      if (accents.includes((j + 1) % measure)) {
        if (j !== 0) out.push(' '.repeat(charSpacing) + '|' + fold);
        else out.push('|' + ' '.repeat(charSpacing));
      }
      if (j % beat === 0 && j !== 0) out.push('  '.repeat(charSpacing));
      out.push(ll[j] + ' '.repeat(charSpacing));
    }
    out.push(' '.repeat(charSpacing) + `| ${i + 1}` + '\n'.repeat(2 * lineSpacing));
  }
  return out.join('');
}
