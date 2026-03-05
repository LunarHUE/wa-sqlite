#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(dirname "$SCRIPT_DIR")"

# Named volume keeps the Nix store alive between builds for caching
NIX_VOLUME="lh-wa-sqlite-nix-store"

echo "==> Ensuring Nix store volume '${NIX_VOLUME}' exists..."
docker volume create "$NIX_VOLUME" > /dev/null

echo "==> Building wa-sqlite via Nix in Docker..."
docker run --rm \
  --privileged \
  -v "${NIX_VOLUME}:/nix" \
  -v "${REPO_DIR}:/work" \
  -w /work \
  nixos/nix \
  sh -c '
    set -e

    # Enable flakes and nix-command
    mkdir -p /etc/nix
    echo "experimental-features = nix-command flakes" >> /etc/nix/nix.conf
    echo "sandbox = false" >> /etc/nix/nix.conf

    echo "==> Running nix build .#wa-sqlite ..."
    nix build .#wa-sqlite -L

    echo "==> Copying build outputs to /work/dist/ ..."
    mkdir -p /work/dist
    cp -rf result/. /work/dist/

    echo "==> Done."
  '

echo "==> Build complete. Files in dist/:"
ls -lh "$REPO_DIR/dist/"
