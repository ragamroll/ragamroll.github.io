// Build a raga preview: the srgm to play (arohana, avarohana, then phrases —
// or a straight scale up/down when none authored) and the 53-EDO scale to tune
// it with. Pure; the dialog does the audio.
import { deriveArohaAvarohana, ragaSwarasC16, scaleFromC16 } from './raga-ext.js';

// srgm string for the preview, parsed later in the raga's own context.
export function ragaPreviewSrgm(name, ext, ragas, { bpm = 150 } = {}) {
  const c12 = ragas?.[name]?.C12_SWARAS;
  let aroha = ext?.arohana;
  let avaroha = ext?.avarohana;
  if (!aroha || !avaroha) {
    const d = deriveArohaAvarohana(c12);
    aroha = aroha || d.arohana;
    avaroha = avaroha || d.avarohana;
  }
  // arohana + avarohana are one continuous octave-aware phrase (avarohana
  // continues from the raised octave). Phrases are standalone, so reset the
  // octave (O=5) before each. L=2 gives each swara a bit of length.
  let body = `${aroha} ${avaroha}`;
  for (const ph of (ext?.phrases || [])) body += ` O=5 z2 ${ph}`;
  return `Raga=${name},0 O=5 L=2 T${bpm} ${body}`;
}

// Partial 53-EDO scale {S,P,+present:step} from the raga's C16 swaras (authored
// or derived), for the playback retune.
export function ragaPreviewScale(name, ext, ragas) {
  return scaleFromC16(ext?.swaras || ragaSwarasC16(ragas, name));
}
