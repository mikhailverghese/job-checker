import { notFound } from 'next/navigation';
import { findJob } from '@/lib/job-checker';

type SearchParams = Record<string, string | string[] | undefined>;

type LetterPageProps = {
  searchParams?: Promise<SearchParams>;
  params: Promise<{ jobId: string }>;
};

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function LetterPage({ params, searchParams }: LetterPageProps) {
  const [{ jobId }, resolvedSearchParams] = await Promise.all([
    params,
    searchParams ?? Promise.resolve({} as SearchParams),
  ]);
  const text = first(resolvedSearchParams.text)?.trim() || '';
  const applicant = first(resolvedSearchParams.applicant)?.trim() || '';
  const job = await findJob(decodeURIComponent(jobId));

  if (!job || !text) notFound();

  const title = job.title || 'Cover letter';
  const company = job.company || 'Unknown company';

  return (
    <main className="page-shell letter-page-shell">
      <section className="card letter-page-card">
        <div className="eyebrow">Cover letter</div>
        <h1>{title}</h1>
        <p className="lede">{company}{applicant ? ` • ${applicant}` : ''}</p>
        <div className="letter-page-actions">
          <button type="button" className="cover-letter-button" onClick={() => window.print()}>
            Save as PDF
          </button>
          <a className="cover-letter-button secondary-button" href="/">
            Back to dashboard
          </a>
        </div>
        <article className="letter-document">
          <pre className="letter-document-body">{text}</pre>
        </article>
      </section>
    </main>
  );
}
