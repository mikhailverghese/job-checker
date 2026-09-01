#!/usr/bin/env bash
set -euo pipefail

PROJECT_ROOT="/root/projects/job-checker"
PORT="8787"
LOG_FILE="/tmp/job-checker-dashboard.log"

if pgrep -f "python3 dashboard/server.py" >/dev/null 2>&1; then
  exit 0
fi

cd "$PROJECT_ROOT"
set -a
source .env
set +a
nohup python3 dashboard/server.py > "$LOG_FILE" 2>&1 &
