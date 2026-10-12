#!/usr/bin/env bash
# Copies Leaflet 1.9.4 into vendor/leaflet so the app works without a CDN
# (and the service worker can cache it). Needs Node/npm and network access.
set -euo pipefail
cd "$(dirname "$0")/.."
tmp="$(mktemp -d)"
( cd "$tmp" && npm pack leaflet@1.9.4 --silent && tar xzf leaflet-1.9.4.tgz )
mkdir -p vendor/leaflet
cp "$tmp/package/dist/leaflet.js" "$tmp/package/dist/leaflet.css" vendor/leaflet/
cp -r "$tmp/package/dist/images" vendor/leaflet/images
cp "$tmp/package/LICENSE" vendor/leaflet/LICENSE
rm -rf "$tmp"
echo "Leaflet 1.9.4 vendored into vendor/leaflet/"
