#!/usr/bin/env bash
# Real extraction (Muse Spark + SAM 3.1) for the three extra invented listings. Costs about $0.5-0.7 each.
set -euo pipefail
cd "$(dirname "$0")/.."
: "${AVAL_BUDGET_USD:=6}"; export AVAL_BUDGET_USD
node src/cli.ts ingest media/studio-demo.mp4 --id loft-providencia --declared fixtures/declared-studio.json --policy fixtures/policy-studio.json
node src/cli.ts ingest media/house-demo.mp4 --id casa-la-reina --declared fixtures/declared-house.json --policy fixtures/policy-house.json
node src/cli.ts ingest media/penthouse-demo.mp4 --id duplex-las-condes --declared fixtures/declared-penthouse.json --policy fixtures/policy-penthouse.json
