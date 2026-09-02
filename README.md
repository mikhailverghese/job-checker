# Job Checker

Public-facing repository for an automated job search workflow and dashboard. It combines LinkedIn scraping, weighted job scoring, public-safe data export, and cover letter generation while keeping private runtime state out of git.

## What changed

The public dashboard now runs as a Next.js app that is ready for local development or Vercel deployment. The private pipeline code remains in place and continues to write the public-safe JSON files that power the UI.

## Setup

### 1) Python pipeline setup

Create and use the existing Python environment for scraping and export generation:

```bash
source .venv/bin/activate
set -a
source .env
set +a
python pipeline/job_checker.py
```

This refreshes the public dashboard inputs in `data-public/`.

### 2) Dashboard app setup

Install the Next.js app dependencies:

```bash
npm install
```

Run the dashboard locally:

```bash
npm run dev
```

Default local URL:

```bash
http://localhost:3000
```

Production build check:

```bash
npm run build
npm start
```

## Vercel deployment

This repo is structured so Vercel can deploy the dashboard directly.

Recommended project settings:
- Framework preset: Next.js
- Root directory: repository root
- Install command: `npm install`
- Build command: `npm run build`

Required environment variables for cover letter generation:
- `JOB_CHECKER_OPENAI_API_KEY`
- `JOB_CHECKER_OPENAI_MODEL` (optional, defaults to `gpt-4.1-mini`)

If the OpenAI key is missing or the API call fails, the app falls back to a template-based cover letter.

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

## Dashboard app behavior

The Next.js dashboard reads the latest public-safe matched jobs export and shows:
- matched jobs
- score
- applicant selection
- matched positive and negative terms
- LinkedIn save state metadata already present in the exported JSON

The app exposes Vercel-friendly API routes for:
- `GET /api/jobs`
- `GET /api/meta`
- `GET /api/applicants`
- `POST /api/cover-letter`

`POST /api/cover-letter` mirrors the old dashboard behavior by reading:
- `data-public/matched-jobs.json`
- `applicant/*.json`

and using:
- `JOB_CHECKER_OPENAI_API_KEY`
- `JOB_CHECKER_OPENAI_MODEL`

## Repository structure

- `app/` - Next.js app router pages and API routes
- `components/` - client dashboard UI
- `lib/` - shared server-side data and cover letter helpers
- `pipeline/` - scraping, filtering, scoring, and public data export logic
- `dashboard/` - legacy static dashboard assets and local Python server
- `data-public/` - public-safe derived JSON files for the dashboard
- `applicant/` - intentionally public candidate profile data
- `config/scoring-config.json` - public scoring logic, search targets, weights, and filters
- `config/runtime.example.json` - example runtime/local-machine config
- `config/runtime.local.json` - local runtime overrides, kept out of git

## Legacy dashboard note

`dashboard/server.py` is still present for reference, but the Next.js app is now the primary public dashboard path.

## Config split

The repo now separates public scoring logic from private runtime details.

Public and committed:
- `config/scoring-config.json`
  - search terms
  - location/time keywords
  - positive and negative weights
  - filters and score thresholds

Private and local-only:
- `config/runtime.local.json`
  - browser profile paths
  - output/debug directories
  - scraping runtime preferences
  - other machine-specific settings

To create a local runtime config, copy the example:

```bash
cp config/runtime.example.json config/runtime.local.json
```

## Public repo notes

This repository is intended to be safe for public sharing.

Kept public on purpose:
- pipeline and dashboard source code
- Next.js app source code
- public candidate example/profile data
- public scoring config and reference runtime example
- public dashboard metadata/data format files

Not committed:
- real environment variables
- browser session and profile data
- debug HTML and screenshots
- generated local outputs
- local runtime state

If you run this locally, keep your real credentials and browser state out of git.

## Notes

This version is tuned for:
- Analytics Engineer
- BI Engineer
- BI Analyst
- Data Analyst

with NYC/NJ/remote filtering and weighted positive/negative term scoring.
