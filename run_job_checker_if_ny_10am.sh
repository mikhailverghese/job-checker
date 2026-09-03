#!/usr/bin/env bash
set -euo pipefail

PROJECT_ROOT="/root/projects/job-checker"
STAMP_DIR="$PROJECT_ROOT/output"
STAMP_FILE="$STAMP_DIR/last_successful_scheduled_run_ny_date.txt"
mkdir -p "$STAMP_DIR"

NY_DATE="$(TZ=America/New_York date +%F)"
NY_HOUR="$(TZ=America/New_York date +%H)"

if [[ "$NY_HOUR" != "10" ]]; then
  exit 0
fi

if [[ -f "$STAMP_FILE" ]] && [[ "$(cat "$STAMP_FILE")" == "$NY_DATE" ]]; then
  exit 0
fi

cd "$PROJECT_ROOT"
./run_job_checker.sh >> "$PROJECT_ROOT/output/cron.log" 2>&1
./publish_public_data.sh >> "$PROJECT_ROOT/output/cron.log" 2>&1
printf '%s\n' "$NY_DATE" > "$STAMP_FILE"
