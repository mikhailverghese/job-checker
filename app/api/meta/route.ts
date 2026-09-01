import { NextResponse } from 'next/server';
import { getMeta } from '@/lib/job-checker';

export async function GET() {
  const meta = await getMeta();
  return NextResponse.json(meta, { headers: { 'Cache-Control': 'no-store' } });
}
