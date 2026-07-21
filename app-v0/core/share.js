// Share a composition by packing its srgm source into a compact URL fragment.
// The source is zlib-deflated (byte-compatible with pako.deflate — the same
// "pako:" convention Mermaid/PlantUML use) via the browser-native
// CompressionStream, then base64url-encoded behind a "pako:" prefix. No library,
// no build step. Works in Node too (globalThis CompressionStream), so it's unit
// tested there.

const enc = new TextEncoder();
const dec = new TextDecoder();

function b64urlEncode(bytes) {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64urlDecode(str) {
  const s = str.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function deflate(str) {
  const cs = new CompressionStream('deflate');   // zlib (RFC1950) — pako.deflate default
  const buf = await new Response(new Blob([enc.encode(str)]).stream().pipeThrough(cs)).arrayBuffer();
  return new Uint8Array(buf);
}
async function inflate(bytes) {
  const ds = new DecompressionStream('deflate');
  const buf = await new Response(new Blob([bytes]).stream().pipeThrough(ds)).arrayBuffer();
  return dec.decode(buf);
}

// source -> "pako:<base64url>"
export async function encodeShareToken(source) {
  return 'pako:' + b64urlEncode(await deflate(String(source ?? '')));
}
// "pako:<base64url>" (or a bare base64url) -> source. Throws on malformed input.
export async function decodeShareToken(token) {
  const t = String(token || '').replace(/^pako:/, '');
  return inflate(b64urlDecode(t));
}

// A full shareable URL for the current page carrying `source` in the hash.
export async function shareUrl(source, loc = (typeof location !== 'undefined' ? location : null)) {
  const base = loc ? loc.origin + loc.pathname + loc.search : '';
  return `${base}#${await encodeShareToken(source)}`;
}

// Decode a pasted share link into its source. Accepts a full URL from ANY host
// (`https://host/path#pako:…`), a bare `pako:…` token, or just the base64url —
// so a link generated on one instance opens on another. Throws on malformed input.
export async function sourceFromShareInput(input) {
  const s = String(input || '').trim();
  const m = /pako:[A-Za-z0-9\-_]+/.exec(s);   // the token wherever it sits in the string
  return decodeShareToken(m ? m[0] : s);      // fall back to treating the whole input as a bare token
}

// If the location hash carries a pako token, return the decoded source; else null
// (also null on a corrupt token, so a bad link never throws into app startup).
export async function readSharedSource(loc = (typeof location !== 'undefined' ? location : null)) {
  const h = (loc && loc.hash ? loc.hash : '').replace(/^#/, '');
  if (!h.startsWith('pako:')) return null;
  try { return await decodeShareToken(h); } catch { return null; }
}
