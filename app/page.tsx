import Dashboard from '@/components/dashboard';
import { getApplicantsIndex, getJobs, getMeta } from '@/lib/job-checker';

export default async function HomePage() {
  const [jobs, applicants, meta] = await Promise.all([getJobs(), getApplicantsIndex(), getMeta()]);
  return <Dashboard initialJobs={jobs} initialApplicants={applicants} initialMeta={meta} />;
}
