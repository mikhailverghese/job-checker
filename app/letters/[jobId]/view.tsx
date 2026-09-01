'use client';

import Link from 'next/link';
import { jsPDF } from 'jspdf';
import { useEffect, useState } from 'react';
import { readCoverLetter, type StoredCoverLetter } from '@/lib/cover-letter-storage';

function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'cover-letter';
}

export default function LetterView({ jobId, applicantId, jobTitle, company }: { jobId: string; applicantId: string; jobTitle: string; company: string }) {
  const [letter, setLetter] = useState<StoredCoverLetter | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    setLetter(readCoverLetter(jobId, applicantId));
    setLoaded(true);
  }, [jobId, applicantId]);

  const applicantLabel = letter?.applicantLabel || applicantId;

  function downloadPdf() {
    if (!letter?.text) return;

    const author = (applicantLabel || 'Applicant').trim();
    const doc = new jsPDF({ unit: 'pt', format: 'letter' });
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const marginX = 54;
    const topMargin = 56;
    const bottomMargin = 56;
    const contentWidth = pageWidth - marginX * 2;
    let y = topMargin;

    doc.setDocumentProperties({
      title: `Cover Letter - ${jobTitle}`,
      subject: `Cover letter for ${jobTitle} at ${company}`,
      author,
      keywords: 'cover letter, job application',
    });

    doc.setFont('times', 'normal');
    doc.setFontSize(12);
    const paragraphs = letter.text.split(/\n\n+/).map((part) => part.trim()).filter(Boolean);

    for (const paragraph of paragraphs) {
      const lines = doc.splitTextToSize(paragraph, contentWidth);
      const paragraphHeight = lines.length * 18;
      if (y + paragraphHeight > pageHeight - bottomMargin) {
        doc.addPage();
        y = topMargin;
      }
      doc.text(lines, marginX, y, { baseline: 'top' });
      y += paragraphHeight + 12;
    }

    const filename = `${slugify(author)}-cover-letter-${slugify(company)}-${slugify(jobTitle)}.pdf`;
    doc.save(filename);
  }

  return (
    <main className="page-shell letter-page-shell">
      <section className="card letter-page-card">
        <div className="eyebrow">Cover letter</div>
        <h1>{jobTitle}</h1>
        <p className="lede">{company}{applicantLabel ? ` • ${applicantLabel}` : ''}</p>
        <div className="letter-page-actions">
          <button type="button" className="cover-letter-button" onClick={downloadPdf} disabled={!letter?.text}>
            Download PDF
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
