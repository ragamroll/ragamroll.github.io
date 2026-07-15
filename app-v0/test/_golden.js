import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const root = (name, file) => join(HERE, 'golden', name, file);

export const golden = (name, file) => readFileSync(root(name, file), 'utf8');
export const goldenJSON = (name, file) => JSON.parse(golden(name, file));
export const INPUTS = ['swaravali', 'hamsa', 'vathapi'];
