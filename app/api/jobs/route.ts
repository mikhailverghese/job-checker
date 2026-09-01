import { NextResponse } from 'next/server';
import { getJobs } from '@/lib/job-checker';

export async function GET() {
  const jobs = await getJobs();
  return NextResponse.json(jobs, { headers: { 'Cache-Control': 'no-store' } });
}
