import { findJob } from '@/lib/job-checker';
import LetterView from './view';

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
  const applicantId = first(resolvedSearchParams.applicantId)?.trim() || '';
  const decodedJobId = decodeURIComponent(jobId);
  const job = await findJob(decodedJobId);

  if (!job) {
    return (
      <main className="page-shell letter-page-shell">
        <section className="card letter-page-card">
          <div className="eyebrow">Cover letter</div>
          <h1>Letter unavailable</h1>
          <p className="lede">That job could not be found in the current public dataset.</p>
        </section>
      </main>
    );
  }

  return <LetterView jobId={decodedJobId} applicantId={applicantId} jobTitle={job.title || 'Cover letter'} company={job.company || 'Unknown company'} />;
}
