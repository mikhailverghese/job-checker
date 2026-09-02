'use client';

import { animate, motion, useMotionValue } from 'motion/react';
import { useEffect, useState } from 'react';
import type { Job } from '@/lib/job-checker';
import { RelativeTime } from './relative-time';

function n(v?: number) { return typeof v === 'number' && Number.isFinite(v) ? v : 0; }

export function AnimatedNumber({ value, decimals = 0 }: { value: number; decimals?: number }) {
  const mv = useMotionValue(0);
  const [display, setDisplay] = useState((0).toFixed(decimals));

  useEffect(() => {
    const unsubscribe = mv.on('change', (v) => setDisplay(v.toFixed(decimals)));
    const controls = animate(mv, value, { duration: 1.1, ease: [0.22, 1, 0.36, 1] });
    return () => {
      unsubscribe();
      controls.stop();
    };
  }, [value, decimals, mv]);

  return <span className="stat-value">{display}</span>;
}

const heroContainer = {
  hidden: {},
  show: { transition: { staggerChildren: 0.09, delayChildren: 0.1 } },
};

const heroItem = {
  hidden: { opacity: 0, y: 26 },
  show: { opacity: 1, y: 0, transition: { type: 'spring' as const, stiffness: 190, damping: 24 } },
};

type Meta = { lastUpdated: string; totalRuntimeSeconds: number | null; matchedJobsCount: number | null };

export default function Hero({ jobs, meta, now }: { jobs: Job[]; meta: Meta; now: number | null }) {
  const averageScore = jobs.length ? jobs.reduce((a, j) => a + n(j.score), 0) / jobs.length : 0;
  const topScore = jobs.reduce((mx, j) => Math.max(mx, n(j.score)), 0);
  const easyApplyCount = jobs.filter((j) => j.application_type === 'Easy Apply').length;

  const stats = [
    { label: 'Matched roles', value: jobs.length, decimals: 0 },
    { label: 'Average score', value: averageScore, decimals: 1 },
    { label: 'Top score', value: topScore, decimals: 0 },
    { label: 'Easy Apply', value: easyApplyCount, decimals: 0 },
  ];

  return (
    <motion.section className="hero" variants={heroContainer} initial="hidden" animate="show">
      <motion.div className="hero-copy" variants={heroItem}>
        <div className="eyebrow">
          <span className="eyebrow-dot" aria-hidden />
          Job search snapshot
        </div>
        <h1 className="hero-title">
          Weighted job matches, <span className="hero-grad">ranked and live.</span>
        </h1>
        <p className="lede">
          The latest matched jobs from the job-checker pipeline, scored against your skill profile and refreshed automatically.
        </p>
      </motion.div>

      <div className="hero-side">
        <motion.div className="live-pill" variants={heroItem}>
          <span className="live-dot" aria-hidden />
          <span className="live-pill-text">
            Pipeline live · updated <RelativeTime iso={meta.lastUpdated} now={now} />
          </span>
        </motion.div>
        <motion.div className="hero-stats" variants={heroItem}>
          {stats.map((stat) => (
            <div className="stat" key={stat.label}>
              <AnimatedNumber value={stat.value} decimals={stat.decimals} />
              <span className="stat-label">{stat.label}</span>
            </div>
          ))}
        </motion.div>
      </div>
    </motion.section>
  );
}
