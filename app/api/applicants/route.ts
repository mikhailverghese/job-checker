import { NextResponse } from 'next/server';
import { getApplicantsIndex } from '@/lib/job-checker';

export async function GET() {
  const applicants = await getApplicantsIndex();
  return NextResponse.json(applicants, { headers: { 'Cache-Control': 'no-store' } });
}
