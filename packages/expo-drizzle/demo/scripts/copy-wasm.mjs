#!/usr/bin/env node
// Copies the wa-sqlite-async WASM binary into /public so Next.js can serve it.
import { copyFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const require = createRequire(import.meta.url);
const wasmPkg = path.dirname(require.resolve('@lunarhue/wa-sqlite-wasm/wa-sqlite-async.mjs'));
const src = path.join(wasmPkg, 'wa-sqlite-async.wasm');
const dest = fileURLToPath(new URL('../public/wa-sqlite-async.wasm', import.meta.url));

await copyFile(src, dest);
console.log('Copied wa-sqlite-async.wasm → public/');
