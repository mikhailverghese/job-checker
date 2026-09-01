import { NextRequest, NextResponse } from 'next/server';
import { buildCoverLetter, findJob, getApplicant } from '@/lib/job-checker';

export async function POST(request: NextRequest) {
  try {
    const payload = await request.json();
    const jobId = String(payload?.jobId || payload?.unique_job_id || '').trim();
    const applicantId = String(payload?.applicantId || payload?.applicant_id || '').trim();

    if (!jobId || !applicantId) {
      return NextResponse.json({ ok: false, error: 'jobId and applicantId are required' }, { status: 400 });
    }

    const [job, applicant] = await Promise.all([findJob(jobId), getApplicant(applicantId)]);
    if (!job) {
      return NextResponse.json({ ok: false, error: 'Job not found in public matched jobs dataset' }, { status: 404 });
    }

    const { coverLetter, generationMode } = await buildCoverLetter(job, applicant);
    return NextResponse.json({
      ok: true,
      jobId,
      applicantId,
      coverLetter,
      generationMode,
      generatedAt: new Date().toISOString(),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}
