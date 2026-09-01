#!/usr/bin/env bash
set -euo pipefail
cd /root/projects/job-checker
mkdir -p output/cover_letter_payloads
find output/cover_letter_payloads -mindepth 1 -maxdepth 1 -exec rm -rf {} +
set -a
source .env
set +a
exec .venv/bin/python3 pipeline/job_checker.py
