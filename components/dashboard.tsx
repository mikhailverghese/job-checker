'use client';

import { useEffect, useMemo, useState } from 'react';
import { storeCoverLetter } from '@/lib/cover-letter-storage';
import type { Job } from '@/lib/job-checker';

type ApplicantOption = { id: string; filename: string; label: string };
type Meta = { lastUpdated: string; totalRuntimeSeconds: number | null; matchedJobsCount: number | null };
type CoverLetterState = { status: 'generating' | 'ready'; text?: string; href?: string };

function n(v?: number) { return typeof v === 'number' ? v : 0; }
function salaryNumber(value?: string | null) { const digits = String(value || '').replace(/[^\d]/g, ''); return digits ? Number(digits) : null; }
function renderRelativeTime(isoString?: string) {
  if (!isoString) return 'n/a';
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) return 'n/a';
  const diffMs = Date.now() - date.getTime();
  if (diffMs < 0) return 'just now';
  const minutes = Math.floor(diffMs / 60000);
  const hours = Math.floor(diffMs / 3600000);
  const days = Math.floor(diffMs / 86400000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  return `${days} day${days === 1 ? '' : 's'} ago`;
}

export default function Dashboard({ initialJobs, initialApplicants, initialMeta }: { initialJobs: Job[]; initialApplicants: ApplicantOption[]; initialMeta: Meta }) {
  const [jobs, setJobs] = useState(initialJobs);
  const [applicants, setApplicants] = useState(initialApplicants);
  const [meta, setMeta] = useState(initialMeta);
  const [minScore, setMinScore] = useState(0);
  const [salaryFilter, setSalaryFilter] = useState('100000');
  const [locationFilter, setLocationFilter] = useState('');
  const [applicantId, setApplicantId] = useState(initialApplicants[0]?.id || '');
  const [applicantNote, setApplicantNote] = useState(
    initialApplicants.length ? `Loaded ${initialApplicants.length} applicant profile${initialApplicants.length === 1 ? '' : 's'}.` : 'Add applicant JSON files under applicant/ to enable applicant selection.',
  );
  const [coverLetterStatus, setCoverLetterStatus] = useState<Record<string, CoverLetterState>>({});

  useEffect(() => {
    const refresh = async () => {
      const [jobsRes, applicantsRes, metaRes] = await Promise.all([
        fetch('/api/jobs', { cache: 'no-store' }),
        fetch('/api/applicants', { cache: 'no-store' }),
        fetch('/api/meta', { cache: 'no-store' }),
      ]);
      if (jobsRes.ok) setJobs(await jobsRes.json());
      if (applicantsRes.ok) setApplicants(await applicantsRes.json());
      if (metaRes.ok) setMeta(await metaRes.json());
    };
    const interval = setInterval(refresh, 60000);
    return () => clearInterval(interval);
  }, []);

  const maxScore = useMemo(() => Math.max(0, ...jobs.map((job) => n(job.score))), [jobs]);
  const locations = useMemo(() => [...new Set(jobs.map((job) => job.location).filter(Boolean))].sort() as string[], [jobs]);
  const filteredJobs = useMemo(() => jobs.filter((job) => {
    if (n(job.score) < minScore) return false;
    const salaryMin = salaryFilter ? Number(salaryFilter) : null;
    if (salaryMin !== null) {
      const value = salaryNumber(job.salary);
      if (value !== null && value < salaryMin) return false;
    }
    if (locationFilter && job.location !== locationFilter) return false;
    return true;
  }).sort((a, b) => n(b.score) - n(a.score)), [jobs, minScore, salaryFilter, locationFilter]);

  async function triggerCoverLetter(job: Job) {
    if (!applicantId) {
      setApplicantNote('Select an applicant profile before running cover letter actions.');
      return;
    }
    const uniqueJobId = `${job.source || 'unknown'}:${job.job_id || 'unknown'}`;
    if (coverLetterStatus[uniqueJobId]?.status === 'generating') return;
    setCoverLetterStatus((current) => ({ ...current, [uniqueJobId]: { status: 'generating' } }));
    setApplicantNote(`Generating cover letter for ${uniqueJobId}...`);

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

  return (
    <div className="page-shell">
      <section className="card hero">
        <div className="eyebrow">Job search snapshot</div>
        <h1>Weighted job matches in one place.</h1>
        <p className="lede">This dashboard shows the latest matched jobs from the job-checker pipeline, with skill-based scoring.</p>
        <div className="hero-stats">
          <div><div className="muted">Matched jobs</div><strong>{jobs.length}</strong></div>
          <div><div className="muted">Average score</div><strong>{jobs.length ? (jobs.reduce((a, j) => a + n(j.score), 0) / jobs.length).toFixed(1) : '0.0'}</strong></div>
        </div>
        <div className="hero-meta">Updated {renderRelativeTime(meta.lastUpdated)}</div>
      </section>

      <section className="card applicant-card">
        <div className="label">Applicant selection</div>
        <h2 style={{ margin: '10px 0 0', fontFamily: "Georgia, 'Times New Roman', serif" }}>Choose the applicant profile</h2>
        <div className="applicant-picker">
          <select value={applicantId} onChange={(event) => setApplicantId(event.target.value)}>
            {applicants.length ? applicants.map((applicant) => <option key={applicant.id} value={applicant.id}>{applicant.label}</option>) : <option value="">No applicant profiles found</option>}
          </select>
        </div>
        <div className="applicant-note">{applicantNote}</div>
      </section>

      <section className="card">
        <div className="section-head">
          <div>
            <div className="label">Matched roles</div>
            <h2>Latest dashboard view</h2>
          </div>
        </div>
        <div className="filters">
          <select value={String(minScore)} onChange={(event) => setMinScore(Number(event.target.value || 0))}>
            <option value="0">Min score: any</option>
            {Array.from({ length: maxScore + 1 }, (_, i) => <option key={i} value={i}>{i}+</option>)}
          </select>
          <select value={salaryFilter} onChange={(event) => setSalaryFilter(event.target.value)}>
            <option value="">Any salary</option>
            <option value="100000">$100k+</option>
            <option value="125000">$125k+</option>
            <option value="150000">$150k+</option>
            <option value="175000">$175k+</option>
            <option value="200000">$200k+</option>
          </select>
          <select value={locationFilter} onChange={(event) => setLocationFilter(event.target.value)}>
            <option value="">All locations</option>
            {locations.map((location) => <option key={location} value={location}>{location}</option>)}
          </select>
        </div>
        <div className="jobs-grid">
          {filteredJobs.map((job) => {
            const uniqueJobId = `${job.source || 'unknown'}:${job.job_id || 'unknown'}`;
            const coverState = coverLetterStatus[uniqueJobId];
            const isGenerating = coverState?.status === 'generating';
            const isReady = coverState?.status === 'ready';
            const locationClass = job.location_signal === 'positive' ? 'meta location-positive' : job.location_signal === 'negative' ? 'meta location-negative' : 'meta';
            return (
              <article key={uniqueJobId} className="job-card">
                <div className="job-top">
                  <div>
                    <div className="job-id-label">Job ID {job.job_id || 'n/a'}</div>
                    <h3 className="job-title"><a href={job.linkedin_url} target="_blank" rel="noreferrer">{job.title || 'Untitled role'}</a></h3>
                    <div className="company">{job.company || 'Unknown company'}</div>
                    <div className={locationClass}>{job.location || 'Unknown location'}</div>
                  </div>
                  <div className="job-side">
                    <div className="score-pill">Score {n(job.score)}</div>
                    <div className="posted-time">{renderRelativeTime(job.posted_timestamp_estimate)}</div>
                  </div>
                </div>
                <div className="job-stats"><div className="job-descriptor"><strong>Salary:</strong> {job.salary || 'n/a'}</div></div>
                <div className="signals"><h4>Positive signals</h4><div>{(job.matched_positive_terms?.length ? job.matched_positive_terms : ['None']).map((tag) => <span key={`pos-${uniqueJobId}-${tag}`} className="tag">{tag}</span>)}</div></div>
                <div className="signals"><h4>Negative signals</h4><div>{(job.matched_negative_terms?.length ? job.matched_negative_terms : ['None']).map((tag) => <span key={`neg-${uniqueJobId}-${tag}`} className={tag === 'None' ? 'tag' : 'tag neg'}>{tag}</span>)}</div></div>
                <div className="job-footer">
                  <div>{job.application_type === 'Easy Apply' ? <span className="easy-apply">⚡ Easy Apply</span> : null}</div>
                  <div className="source-wrap">
                    {isReady && coverState?.href ? (
                      <button
                        className="cover-letter-button"
                        type="button"
                        onClick={() => window.open(coverState.href, '_blank', 'noopener')}
                      >
                        View Letter
                      </button>
                    ) : (
                      <button className={`cover-letter-button${isGenerating ? ' is-disabled' : ''}`} type="button" disabled={isGenerating} onClick={() => triggerCoverLetter(job)}>
                        {isGenerating ? 'Generating...' : 'Generate Letter'}
                      </button>
                    )}
                    <span className="source-badge">{job.source || 'unknown'}</span>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
        <div className="footer-note">{filteredJobs.length} of {jobs.length} matched jobs shown.</div>
      </section>
    </div>
  );
}
