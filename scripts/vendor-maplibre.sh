#!/usr/bin/env bash
# Copies MapLibre GL JS 4.7.1 into vendor/maplibre-gl so the 3D map works without a CDN
# (and the service worker can cache it). Needs Node/npm and network access.
set -euo pipefail
cd "$(dirname "$0")/.."
tmp="$(mktemp -d)"
( cd "$tmp" && npm pack maplibre-gl@4.7.1 --silent && tar xzf maplibre-gl-4.7.1.tgz )
mkdir -p vendor/maplibre-gl
cp "$tmp/package/dist/maplibre-gl.js" "$tmp/package/dist/maplibre-gl.css" vendor/maplibre-gl/
cp "$tmp/package/LICENSE.txt" vendor/maplibre-gl/LICENSE.txt
rm -rf "$tmp"
echo "MapLibre GL JS 4.7.1 vendored into vendor/maplibre-gl/"
