import { createToneBackend } from './backends/tone.js';

// The app's player. It names ONE backend on purpose.
//
// A static import is eager, so a registry listing every backend makes every page that
// touches this module download all of them. Naming 'webaudio' here cost the generated
// raga browser 353KB of Tone it never used — the exact bundle backends/webaudio.js
// exists to avoid — and nothing looked wrong: the right backend was used, the tests
// passed, and only the network panel knew.
//
// So a page that wants a different backend imports THAT module and calls its factory:
//
//   import { createWebAudioBackend } from './backends/webaudio.js';
//
// Every backend implements audio/backend.js, so they remain interchangeable to the
// caller; what cannot be shared is a lookup table, unless this is made async and every
// caller awaits it. The app creates its player during render, so it is not.
export function createPlayer(name = 'tone') {
  switch (name) {
    case 'tone': return createToneBackend();
    default: throw new Error(`unknown synth backend: ${name} — import its module directly`);
  }
}
