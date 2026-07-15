// Port of NotationParser.SeqToRoll — vertical ascii pianoroll with beat markers.
export function seqToRoll(events, seqProps) {
  const colMin = seqProps.lowest_midi_note;
  const colMax = seqProps.highest_midi_note + 1;

  let dispTxt = '';
  let curRow = 0;
  let beat = 0, measure = 0, accents = [];

  for (const v of events) {
    if (v.type === 'tala') {
      ({ beat, measure, accents } = v.props);
    }
    if (v.type === 'note') {
      const disp = v.swara[0];
      let cols = v.midi;
      cols = (cols > 0) ? cols : (colMin > 0 ? colMin - 1 : 0);
      const rows = Math.trunc(v.absLen);
      for (let row = 1; row <= rows; row++) {
        curRow++;
        let spacer = ' ';
        const bb = curRow % beat;
        const aa = curRow % measure;
        if (bb === 1) spacer = '.';
        if (aa === 1) spacer = '=';
        else if (accents.includes(aa)) spacer = '-';
        let line = spacer.repeat(cols - colMin + 1);
        switch (row) {
          case 1:  line += disp; break;
          case 2:  line += (rows > 4) ? String(rows) : '!'; break;
          default: line += '!'; break;
        }
        line += spacer.repeat(colMax - cols);
        if (aa === 1) line += ' ' + Math.trunc(1 + curRow / measure);
        dispTxt += line + '\n';
      }
    }
  }
  return dispTxt;
}
