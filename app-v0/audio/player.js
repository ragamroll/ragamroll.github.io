import { createToneBackend } from './backends/tone.js';

// Factory + swap point. Adding a backend = one case + one new backends/*.js file;
// the app passes only `name`, so swapping needs zero app changes.
export function createPlayer(name = 'tone') {
  switch (name) {
    case 'tone': return createToneBackend();
    default: throw new Error(`unknown synth backend: ${name}`);
  }
}
