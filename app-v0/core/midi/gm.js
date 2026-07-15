// General MIDI instrument name -> 0-based program number (subset used by srgm).
// 0-based: GM "program 1" (Acoustic Grand Piano) is byte 0.
export const GM = {
  PIANO: 0,
  ACOUSTIC_GRAND: 0,
  VIOLIN: 40,
  FLUTE: 73,
  ALTO_SAX: 65,
  TENOR_SAX: 66,
  SITAR: 104,
};
export const SITAR = GM.SITAR;
export function gmProgram(name) {
  if (name == null) return 0;
  return Object.prototype.hasOwnProperty.call(GM, name) ? GM[name] : 0;
}
