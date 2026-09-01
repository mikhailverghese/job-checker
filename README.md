# Job Checker

Public-facing repository for an automated job search dashboard, with the private runtime state kept out of git.

## Setup

1. Create a real config from the example:
   ```bash
   cp config/config.example.json config/config.local.json
   ```
2. Update the app to point at your local config, or copy values into your own untracked runtime config.
3. Set LinkedIn credentials:
   ```bash
   export LINKEDIN_EMAIL="you@example.com"
   export LINKEDIN_PASSWORD="your-password"
   ```
4. Run the pipeline:
   ```bash
   source .venv/bin/activate
   python pipeline/job_checker.py
   ```

## Output

Private/local runtime output:
- `output/raw_jobs.json`
- `output/matched_jobs.json`
- `output/matched_jobs.csv`
- `data/seen_jobs.json`

Public-safe exported dashboard data:
- `data-public/matched-jobs.json`
- `data-public/applicants.json`
- `data-public/meta.json`

## Dashboard

Serve the latest matched jobs snapshot locally:

```bash
source .venv/bin/activate
set -a
source .env
set +a
python dashboard/server.py
```

Default URL:

```bash
http://<server-ip>:8787
```

The dashboard reads the latest public-safe matched jobs export on each load and shows:
- matched jobs
- score
- applicant count
- matched positive/negative terms
- LinkedIn save state

The cover letter UI now uses an API-based text response instead of local PDF generation. The dashboard server includes a local `/api/cover-letter` implementation that uses a dedicated project OpenAI key and defaults to `gpt-4.1-mini`, matching the earlier n8n workflow more closely while avoiding local n8n, Playwright PDF generation, and subprocess execution.

## Repository structure

- `pipeline/` - private ingestion and scoring logic source
- `dashboard/` - public-facing dashboard app layer
- `data-public/` - public-facing derived JSON files for the dashboard
- `applicant/` - intentionally public candidate profile data
- `config/` - example configuration only

## Public repo notes

This repository is intended to be safe for public sharing.

Kept public on purpose:
- pipeline and dashboard source code
- public candidate example/profile data
- example and reference config
- public dashboard metadata/data format files

Not committed:
- real environment variables
- browser session/profile data
- debug HTML/screenshots
- generated outputs
- local runtime state

If you run this locally, keep your real credentials and browser state out of git.

## Notes

This version is tuned for:
- Analytics Engineer
- Data Engineer
- BI Engineer
- BI Analyst
- Data Analyst

with NYC/NJ/remote filtering and weighted positive/negative term scoring.
