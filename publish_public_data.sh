#!/usr/bin/env bash
set -euo pipefail

PROJECT_ROOT="/root/projects/job-checker"
cd "$PROJECT_ROOT"

FILES=(
  "data-public/matched-jobs.json"
  "data-public/meta.json"
)

if ! git diff --quiet -- "${FILES[@]}"; then
  git add "${FILES[@]}"

  if git diff --cached --quiet -- "${FILES[@]}"; then
    echo "No staged public data changes to publish."
    exit 0
  fi

  git commit -m "data: refresh public matched jobs export"
  git push origin main
  exit 0
fi

echo "No public data changes to publish."
