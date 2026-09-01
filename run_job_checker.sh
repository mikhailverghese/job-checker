#!/usr/bin/env bash
set -euo pipefail
cd /root/projects/job-checker
set -a
source .env
set +a
exec .venv/bin/python3 pipeline/job_checker.py
