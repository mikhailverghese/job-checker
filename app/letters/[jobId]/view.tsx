'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { readCoverLetter, type StoredCoverLetter } from '@/lib/cover-letter-storage';

export default function LetterView({ jobId, applicantId, jobTitle, company }: { jobId: string; applicantId: string; jobTitle: string; company: string }) {
  const [letter, setLetter] = useState<StoredCoverLetter | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    setLetter(readCoverLetter(jobId, applicantId));
    setLoaded(true);
  }, [jobId, applicantId]);

  const applicantLabel = letter?.applicantLabel || applicantId;

  return (
    <main className="page-shell letter-page-shell">
      <section className="card letter-page-card">
        <div className="eyebrow">Cover letter</div>
        <h1>{jobTitle}</h1>
        <p className="lede">{company}{applicantLabel ? ` • ${applicantLabel}` : ''}</p>
        <div className="letter-page-actions">
          <button type="button" className="cover-letter-button" onClick={() => window.print()} disabled={!letter?.text}>
            Save as PDF
          </button>
          <Link className="cover-letter-button secondary-button" href="/">
            Back to dashboard
          </Link>
        </div>
        <article className="letter-document">
          {letter?.text ? (
            <pre className="letter-document-body">{letter.text}</pre>
          ) : loaded ? (
            <div className="letter-empty-state">
              This letter is not available in the current browser session. Generate it again from the dashboard, then click View Letter.
            </div>
          ) : (
            <div className="letter-empty-state">Loading letter…</div>
          )}
        </article>
      </section>
    </main>
  );
}
