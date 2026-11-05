#!/usr/bin/env bash
# Builds the routing data for the toll-free motorcycle router. Run once on the server (and again whenever you
# want fresher OpenStreetMap data, e.g. every month). Needs Docker and ~4 GB free disk for Java.
#   ./prepare.sh                 -> Java (Jakarta, Bandung, Yogyakarta, Surabaya...)
#   REGION=sumatra ./prepare.sh  -> another Geofabrik region of Indonesia (list: download.geofabrik.de/asia/indonesia.html)
set -euo pipefail
cd "$(dirname "$0")"
REGION="${REGION:-java}"
IMAGE="${OSRM_IMAGE:-osrm/osrm-backend:v5.27.1}"
mkdir -p data
if [ ! -f "data/${REGION}.osm.pbf" ]; then
  curl -fL --retry 3 -o "data/${REGION}.osm.pbf" "https://download.geofabrik.de/asia/indonesia/${REGION}-latest.osm.pbf"
fi
cp motorcycle-id.lua data/motorcycle-id.lua
run() { docker run --rm -t -v "$PWD/data:/data" "$IMAGE" "$@"; }
# the profile must sit beside car.lua (in /opt) so that require('car') works
dr() { docker run --rm -t -v "$PWD/data:/data" -v "$PWD/motorcycle-id.lua:/opt/motorcycle-id.lua:ro" "$IMAGE" "$@"; }
dr osrm-extract -p /opt/motorcycle-id.lua "/data/${REGION}.osm.pbf"
run osrm-partition "/data/${REGION}.osrm"
run osrm-customize "/data/${REGION}.osrm"
echo "${REGION}" > data/REGION
echo "Done. Start it with:  docker compose up -d"
