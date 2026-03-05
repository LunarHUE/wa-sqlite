#!/usr/bin/env node
// Cross-platform build script — runs the Nix flake inside Docker.
// Requires: Docker Desktop (any platform). No bash needed.

import { spawnSync } from 'child_process';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_DIR = resolve(__dirname, '..');
const NIX_VOLUME = 'lh-wa-sqlite-nix-store';

function run(cmd, args, { fatal = true } = {}) {
  console.log(`==> ${cmd} ${args.join(' ')}`);
  const result = spawnSync(cmd, args, { stdio: 'inherit', shell: false });
  if (fatal && result.status !== 0) {
    process.exit(result.status ?? 1);
  }
  return result;
}

// Normalise the repo path for Docker on Windows (C:\foo -> /c/foo)
function toDockerPath(p) {
  if (process.platform === 'win32') {
    return p.replace(/\\/g, '/').replace(/^([A-Za-z]):/, (_, d) => `/${d.toLowerCase()}`);
  }
  return p;
}

console.log(`==> Ensuring Nix store volume '${NIX_VOLUME}' exists...`);
run('docker', ['volume', 'create', NIX_VOLUME]);

const repoMount = `${toDockerPath(REPO_DIR)}:/work`;

const nixScript = [
  'set -e',
  'mkdir -p /etc/nix',
  'echo "experimental-features = nix-command flakes" >> /etc/nix/nix.conf',
  'echo "sandbox = false" >> /etc/nix/nix.conf',
  'echo "==> Running nix build .#wa-sqlite ..."',
  'nix build .#wa-sqlite -L',
  'echo "==> Copying build outputs to /work/dist/ ..."',
  'mkdir -p /work/dist',
  'cp -rf result/. /work/dist/',
  'echo "==> Done."',
].join('\n');

console.log('==> Building wa-sqlite via Nix in Docker...');
run('docker', [
  'run', '--rm',
  '--privileged',
  '-v', `${NIX_VOLUME}:/nix`,
  '-v', repoMount,
  '-w', '/work',
  'nixos/nix',
  'sh', '-c', nixScript,
]);

console.log('==> Build complete.');
