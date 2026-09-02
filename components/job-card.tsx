'use client';

import { motion } from 'motion/react';
import { useId } from 'react';
import type { Job } from '@/lib/job-checker';
import { RelativeTime } from './relative-time';

export type CoverLetterState = { status: 'generating' | 'ready'; text?: string; href?: string };

function n(v?: number) { return typeof v === 'number' && Number.isFinite(v) ? v : 0; }

export function jobKey(job: Job) {
  return job.id || `${job.source || 'unknown'}:${job.job_id || 'unknown'}`;
}

function ScoreRing({ score, maxScore }: { score: number; maxScore: number }) {
  const gradientId = useId();
  const radius = 24;
  const circumference = 2 * Math.PI * radius;
  const fraction = maxScore > 0 ? Math.min(1, score / maxScore) : 0;

  return (
    <div className="score-ring" title={`Score ${score} of max ${maxScore}`}>
      <svg viewBox="0 0 56 56" aria-hidden>
        <defs>
          <linearGradient id={gradientId} x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="var(--accent)" />
            <stop offset="100%" stopColor="var(--accent-2)" />
          </linearGradient>
        </defs>
        <circle className="ring-track" cx="28" cy="28" r={radius} />
        <motion.circle
          className="ring-value"
          cx="28"
          cy="28"
          r={radius}
          stroke={`url(#${gradientId})`}
          transform="rotate(-90 28 28)"
          initial={{ strokeDashoffset: circumference }}
          animate={{ strokeDashoffset: circumference * (1 - fraction) }}
          transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1], delay: 0.2 }}
        />
      </svg>
      <span className="score-ring-value">{score}</span>
    </div>
  );
}

function CoverButton({ state, onGenerate }: { state?: CoverLetterState; onGenerate: () => void }) {
  const isGenerating = state?.status === 'generating';
  const isReady = state?.status === 'ready';

  if (isReady && state?.href) {
    return (
      <motion.button
        type="button"
        className="cover-btn is-ready"
        initial={{ scale: 0.9 }}
        animate={{ scale: 1 }}
        transition={{ type: 'spring', stiffness: 400, damping: 22 }}
        onClick={() => window.open(state.href, '_blank', 'noopener')}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden>
          <path d="M4 12.5 9 17.5 20 6.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        View letter
      </motion.button>
    );
  }

  return (
    <motion.button
      type="button"
      className={`cover-btn${isGenerating ? ' is-generating' : ''}`}
      whileTap={{ scale: isGenerating ? 1 : 0.96 }}
      disabled={isGenerating}
      onClick={onGenerate}
    >
      {isGenerating && (
        <svg className="spinner" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden>
          <path d="M12 3a9 9 0 1 0 9 9" strokeLinecap="round" />
        </svg>
      )}
      {isGenerating ? 'Writing letter…' : 'Generate letter'}
    </motion.button>
  );
}

export default function JobCard({
  job,
  maxScore,
  coverState,
  onGenerate,
  now,
}: {
  job: Job;
  maxScore: number;
  coverState?: CoverLetterState;
  onGenerate: (job: Job) => void;
  now: number | null;
}) {
  const uniqueJobId = jobKey(job);
  const positiveTerms = job.matched_positive_terms?.length ? job.matched_positive_terms : ['None'];
  const negativeTerms = job.matched_negative_terms?.length ? job.matched_negative_terms : [];
  const locationSignal = job.location_signal;

  function handlePointerMove(event: React.PointerEvent<HTMLElement>) {
    const el = event.currentTarget;
    const rect = el.getBoundingClientRect();
    el.style.setProperty('--mx', `${event.clientX - rect.left}px`);
    el.style.setProperty('--my', `${event.clientY - rect.top}px`);
  }

  return (
    <motion.article
      className="job-card"
      layout
      onPointerMove={handlePointerMove}
      initial={{ opacity: 0, y: 28, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -14, scale: 0.97, transition: { duration: 0.16 } }}
      transition={{ type: 'spring', stiffness: 240, damping: 26 }}
    >
      <div className="job-head">
        <ScoreRing score={n(job.score)} maxScore={maxScore} />
        <div className="job-headline">
          <h3 className="job-title">
          <a href={job.linkedin_url} target="_blank" rel="noreferrer">{job.title || 'Untitled role'}</a>
          </h3>
          <div className="company-line">{job.company || 'Unknown company'}</div>
          <div className="location-line">
            {locationSignal && (
              <span className={`loc-dot ${locationSignal === 'positive' ? 'is-positive' : 'is-negative'}`} aria-hidden />
            )}
            {job.location || 'Unknown location'}
          </div>
        </div>
      </div>

      <div className="chips">
        {job.salary && <span className="chip chip-salary">{job.salary}</span>}
        <RelativeTime iso={job.posted_timestamp_estimate} now={now} className="chip chip-time" />
        {job.application_type === 'Easy Apply' && (
          <span className="chip chip-easy">
            <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden><path d="M13 2 3 14h7l-1 8 10-12h-7l1-8z" /></svg>
            Easy Apply
          </span>
        )}
        <span className="chip chip-source">{job.source || 'unknown'}</span>
      </div>

      <div className="tag-rows">
        <div className="tag-row">
          <span className="tag-row-label">Matched</span>
          <div className="tag-list">
            {positiveTerms.map((tag) => (
              <span key={`pos-${uniqueJobId}-${tag}`} className={tag === 'None' ? 'tag tag-none' : 'tag tag-pos'}>{tag}</span>
            ))}
          </div>
        </div>
        <div className="tag-row">
          <span className="tag-row-label">Penalties</span>
          <div className="tag-list">
            {(negativeTerms.length ? negativeTerms : ['None']).map((tag) => (
              <span key={`neg-${uniqueJobId}-${tag}`} className={tag === 'None' ? 'tag tag-none' : 'tag tag-neg'}>{tag}</span>
            ))}
          </div>
        </div>
      </div>

      <div className="job-footer">
        <span className="job-id">ID {job.job_id || 'n/a'}</span>
        <CoverButton state={coverState} onGenerate={() => onGenerate(job)} />
      </div>
    </motion.article>
  );
}
