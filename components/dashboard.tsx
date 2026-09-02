'use client';

import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useMemo, useState } from 'react';
import { storeCoverLetter } from '@/lib/cover-letter-storage';
import type { Job } from '@/lib/job-checker';
import FilterBar from './filter-bar';
import Hero from './hero';
import JobCard, { type CoverLetterState, jobKey } from './job-card';
import { useNow } from './relative-time';

type ApplicantOption = { id: string; filename: string; label: string };
type Meta = { lastUpdated: string; totalRuntimeSeconds: number | null; matchedJobsCount: number | null };

const SORT_OPTIONS = [
  { value: 'score', label: 'Top score' },
  { value: 'recent', label: 'Newest' },
] as const;

type SortMode = (typeof SORT_OPTIONS)[number]['value'];

function n(v?: number) { return typeof v === 'number' && Number.isFinite(v) ? v : 0; }
function salaryNumber(value?: string | null) {
  const digits = String(value || '').replace(/[^\d]/g, '');
  return digits ? Number(digits) : null;
}

export default function Dashboard({
  initialJobs,
  initialApplicants,
  initialMeta,
}: {
  initialJobs: Job[];
  initialApplicants: ApplicantOption[];
  initialMeta: Meta;
}) {
  const now = useNow(30000);
  const [jobs, setJobs] = useState(initialJobs);
  const [applicants, setApplicants] = useState(initialApplicants);
  const [meta, setMeta] = useState(initialMeta);
  const [minScore, setMinScore] = useState(0);
  const [salaryFilter, setSalaryFilter] = useState('100000');
  const [locationFilter, setLocationFilter] = useState('');
  const [search, setSearch] = useState('');
  const [sortMode, setSortMode] = useState<SortMode>('score');
  const [applicantId, setApplicantId] = useState(initialApplicants[0]?.id || '');
  const [applicantNote, setApplicantNote] = useState(
    initialApplicants.length
      ? `${initialApplicants.length} applicant profile${initialApplicants.length === 1 ? '' : 's'} loaded.`
      : 'Add applicant JSON files under applicant/ to enable applicant selection.',
  );
  const [coverLetterStatus, setCoverLetterStatus] = useState<Record<string, CoverLetterState>>({});

  useEffect(() => {
    let active = true;
    const refresh = async () => {
      const [jobsRes, applicantsRes, metaRes] = await Promise.all([
        fetch('/api/jobs', { cache: 'no-store' }),
        fetch('/api/applicants', { cache: 'no-store' }),
        fetch('/api/meta', { cache: 'no-store' }),
      ]);
      if (!active) return;
      if (jobsRes.ok) setJobs(await jobsRes.json());
      if (applicantsRes.ok) setApplicants(await applicantsRes.json());
      if (metaRes.ok) setMeta(await metaRes.json());
    };
    const interval = setInterval(refresh, 60000);
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, []);

  const maxScore = useMemo(() => Math.max(0, ...jobs.map((job) => n(job.score))), [jobs]);
  const locations = useMemo(
    () => [...new Set(jobs.map((job) => job.location).filter(Boolean))].sort() as string[],
    [jobs],
  );

  const filteredJobs = useMemo(() => {
    const query = search.trim().toLowerCase();
    const filtered = jobs.filter((job) => {
      if (n(job.score) < minScore) return false;
      const salaryMin = salaryFilter ? Number(salaryFilter) : null;
      if (salaryMin !== null) {
        const value = salaryNumber(job.salary);
        if (value !== null && value < salaryMin) return false;
      }
      if (locationFilter && job.location !== locationFilter) return false;
      if (query) {
        const haystack = `${job.title || ''} ${job.company || ''}`.toLowerCase();
        if (!haystack.includes(query)) return false;
      }
      return true;
    });
    filtered.sort((a, b) => {
      if (sortMode === 'recent') {
        return new Date(b.posted_timestamp_estimate || 0).getTime() - new Date(a.posted_timestamp_estimate || 0).getTime();
      }
      return n(b.score) - n(a.score);
    });
    return filtered;
  }, [jobs, minScore, salaryFilter, locationFilter, search, sortMode]);

  async function triggerCoverLetter(job: Job) {
    if (!applicantId) {
      setApplicantNote('Select an applicant profile before running cover letter actions.');
      return;
    }
    const uniqueJobId = jobKey(job);
    if (coverLetterStatus[uniqueJobId]?.status === 'generating') return;
    setCoverLetterStatus((current) => ({ ...current, [uniqueJobId]: { status: 'generating' } }));
    setApplicantNote(`Generating cover letter for ${uniqueJobId}…`);

    try {
      const res = await fetch('/api/cover-letter', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobId: uniqueJobId, applicantId }),
      });
      const payload = await res.json();
      if (!res.ok || !payload.ok) throw new Error(payload.error || 'Cover letter trigger failed');
      const applicantLabel = applicants.find((applicant) => applicant.id === applicantId)?.label || applicantId;
      storeCoverLetter(uniqueJobId, applicantId, {
        text: payload.coverLetter || '',
        applicantId,
        applicantLabel,
        jobTitle: job.title || uniqueJobId,
        company: job.company || 'Unknown company',
        generatedAt: payload.generatedAt || new Date().toISOString(),
      });
      const href = `/letters/${encodeURIComponent(uniqueJobId)}?applicantId=${encodeURIComponent(applicantId)}`;
      setCoverLetterStatus((current) => ({ ...current, [uniqueJobId]: { status: 'ready', text: payload.coverLetter, href } }));
      setApplicantNote(`Cover letter ready for ${payload.jobId || uniqueJobId}.`);
    } catch (error) {
      setCoverLetterStatus((current) => {
        const next = { ...current };
        delete next[uniqueJobId];
        return next;
      });
      setApplicantNote(`Cover letter trigger failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  function resetFilters() {
    setMinScore(0);
    setSalaryFilter('');
    setLocationFilter('');
    setSearch('');
  }

  return (
    <div className="shell">
      <header className="topbar">
        <div className="brand">
          <svg className="brand-mark" viewBox="0 0 24 24" fill="none" aria-hidden>
            <path d="M12 2 14.8 9.2 22 12 14.8 14.8 12 22 9.2 14.8 2 12 9.2 9.2z" fill="currentColor" />
          </svg>
          <span>Job Checker</span>
        </div>
        <div className="topbar-note">Auto-refresh every 60s</div>
      </header>

      <Hero jobs={jobs} meta={meta} now={now} />

      <FilterBar
        applicants={applicants}
        applicantId={applicantId}
        onApplicantChange={setApplicantId}
        applicantNote={applicantNote}
        minScore={minScore}
        onMinScoreChange={setMinScore}
        maxScore={maxScore}
        salaryFilter={salaryFilter}
        onSalaryChange={setSalaryFilter}
        locationFilter={locationFilter}
        onLocationChange={setLocationFilter}
        locations={locations}
        search={search}
        onSearchChange={setSearch}
      />

      <section className="results">
        <div className="results-bar">
          <div className="results-count">
            <span className="results-count-value">{filteredJobs.length}</span>
            <span className="muted">of {jobs.length} matched roles</span>
          </div>
          <div className="sort-toggle" role="group" aria-label="Sort order">
            {SORT_OPTIONS.map((option) => {
              const active = sortMode === option.value;
              return (
                <button
                  key={option.value}
                  type="button"
                  className={`sort-btn${active ? ' is-active' : ''}`}
                  onClick={() => setSortMode(option.value)}
                >
                  {active && <motion.span layoutId="sort-active-pill" className="seg-pill" transition={{ type: 'spring', stiffness: 500, damping: 38 }} />}
                  <span className="seg-label">{option.label}</span>
                </button>
              );
            })}
          </div>
        </div>

        {filteredJobs.length > 0 ? (
          <div className="jobs-grid">
            <AnimatePresence mode="popLayout">
              {filteredJobs.map((job) => {
                const uniqueJobId = jobKey(job);
                return (
                  <JobCard
                    key={uniqueJobId}
                    job={job}
                    maxScore={maxScore}
                    coverState={coverLetterStatus[uniqueJobId]}
                    onGenerate={triggerCoverLetter}
                    now={now}
                  />
                );
              })}
            </AnimatePresence>
          </div>
        ) : (
          <motion.div className="empty-state" initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }}>
            <div className="radar" aria-hidden />
            <h3>No roles pass the current filters</h3>
            <p>Loosen the score, salary, or search filters to widen the scan.</p>
            <button type="button" className="empty-reset" onClick={resetFilters}>Reset filters</button>
          </motion.div>
        )}
      </section>

      <footer className="site-footer">
        <span>Job Checker pipeline</span>
        <span className="muted">Weighted matches · score-based ranking</span>
      </footer>
    </div>
  );
}
