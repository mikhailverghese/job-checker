'use client';

import { motion } from 'motion/react';

type ApplicantOption = { id: string; filename: string; label: string };

const SALARY_OPTIONS = [
  { value: '', label: 'Any' },
  { value: '100000', label: '$100k' },
  { value: '125000', label: '$125k' },
  { value: '150000', label: '$150k' },
  { value: '175000', label: '$175k' },
  { value: '200000', label: '$200k+' },
];

export default function FilterBar({
  applicants,
  applicantId,
  onApplicantChange,
  applicantNote,
  minScore,
  onMinScoreChange,
  maxScore,
  salaryFilter,
  onSalaryChange,
  locationFilter,
  onLocationChange,
  locations,
  search,
  onSearchChange,
}: {
  applicants: ApplicantOption[];
  applicantId: string;
  onApplicantChange: (id: string) => void;
  applicantNote: string;
  minScore: number;
  onMinScoreChange: (score: number) => void;
  maxScore: number;
  salaryFilter: string;
  onSalaryChange: (salary: string) => void;
  locationFilter: string;
  onLocationChange: (location: string) => void;
  locations: string[];
  search: string;
  onSearchChange: (query: string) => void;
}) {
  const sliderPct = maxScore > 0 ? (minScore / maxScore) * 100 : 0;

  return (
    <motion.section
      className="controls"
      initial={{ opacity: 0, y: 18 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: 'spring', stiffness: 160, damping: 22, delay: 0.25 }}
    >
      <div className="control-group control-applicant">
        <label className="control-label" htmlFor="applicant-select">Applicant profile</label>
        <div className="select-wrap">
          <select id="applicant-select" value={applicantId} onChange={(event) => onApplicantChange(event.target.value)}>
            {applicants.length ? (
              applicants.map((applicant) => <option key={applicant.id} value={applicant.id}>{applicant.label}</option>)
            ) : (
              <option value="">No applicant profiles found</option>
            )}
          </select>
        </div>
        <div className="status-note" role="status" aria-live="polite">{applicantNote}</div>
      </div>

      <div className="control-group control-slider">
        <label className="control-label" htmlFor="min-score">Minimum score</label>
        <div className="range-wrap">
          <input
            id="min-score"
            type="range"
            min={0}
            max={Math.max(maxScore, 1)}
            value={minScore}
            onChange={(event) => onMinScoreChange(Number(event.target.value))}
            style={{ ['--fill' as string]: `${sliderPct}%` }}
            aria-valuetext={`${minScore} plus`}
          />
          <span className="range-value">{minScore}+</span>
        </div>
      </div>

      <div className="control-group control-salary">
        <span className="control-label">Salary floor</span>
        <div className="segmented" role="group" aria-label="Salary floor">
          {SALARY_OPTIONS.map((option) => {
            const active = salaryFilter === option.value;
            return (
              <button
                key={option.value || 'any'}
                type="button"
                className={`seg-btn${active ? ' is-active' : ''}`}
                onClick={() => onSalaryChange(option.value)}
              >
                {active && <motion.span layoutId="salary-active-pill" className="seg-pill" transition={{ type: 'spring', stiffness: 500, damping: 38 }} />}
                <span className="seg-label">{option.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="control-group control-location">
        <label className="control-label" htmlFor="location-select">Location</label>
        <div className="select-wrap">
          <select id="location-select" value={locationFilter} onChange={(event) => onLocationChange(event.target.value)}>
            <option value="">All locations</option>
            {locations.map((location) => <option key={location} value={location}>{location}</option>)}
          </select>
        </div>
      </div>

      <div className="control-group control-search">
        <label className="control-label" htmlFor="job-search">Search</label>
        <div className="search-wrap">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-3.5-3.5" strokeLinecap="round" />
          </svg>
          <input
            id="job-search"
            type="search"
            placeholder="Title or company…"
            value={search}
            onChange={(event) => onSearchChange(event.target.value)}
          />
        </div>
      </div>
    </motion.section>
  );
}
