import fs from 'node:fs/promises';
import path from 'node:path';
import OpenAI from 'openai';

const PROJECT_ROOT = process.cwd();
const PUBLIC_DATA_DIR = path.join(PROJECT_ROOT, 'data-public');
const APPLICANT_DIR = path.join(PROJECT_ROOT, 'applicant');

export type Job = {
  id?: string;
  source?: string;
  job_id?: string | number;
  title?: string;
  company?: string;
  location?: string;
  linkedin_url?: string;
  posted_timestamp_estimate?: string;
  application_type?: string;
  salary?: string | null;
  description?: string;
  score?: number;
  matched_positive_terms?: string[];
  matched_negative_terms?: string[];
  location_signal?: string | null;
};

export type Applicant = {
  applicant_name?: string;
  applicant_number?: string;
  applicant_email?: string;
  applicant_profile?: string;
};

export async function readJsonFile<T>(filePath: string): Promise<T> {
  return JSON.parse(await fs.readFile(filePath, 'utf8')) as T;
}

export async function getJobs(): Promise<Job[]> {
  return readJsonFile<Job[]>(path.join(PUBLIC_DATA_DIR, 'matched-jobs.json'));
}

export async function getApplicantsIndex() {
  const files = await fs.readdir(APPLICANT_DIR);
  return files
    .filter((file) => file.endsWith('.json') && file !== 'example-applicant.json')
    .sort()
    .map((file) => ({
      id: path.basename(file, '.json'),
      filename: file,
      label: path.basename(file, '.json').replace(/[-_]/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase()),
    }));
}

export async function getApplicant(applicantId: string): Promise<Applicant> {
  return readJsonFile<Applicant>(path.join(APPLICANT_DIR, `${applicantId}.json`));
}

export async function getMeta() {
  const jobsPath = path.join(PUBLIC_DATA_DIR, 'matched-jobs.json');
  const stats = await fs.stat(jobsPath);
  const jobs = await getJobs();
  return {
    lastUpdated: stats.mtime.toISOString(),
    totalRuntimeSeconds: null,
    matchedJobsCount: jobs.length,
  };
}

export async function findJob(jobId: string): Promise<Job | undefined> {
  const target = String(jobId || '').trim();
  const normalized = target.replace(/^linkedin:/, '');
  const jobs = await getJobs();
  return jobs.find((job) => {
    const id = String(job.id ?? '').trim();
    const composite = `${job.source ?? 'unknown'}:${job.job_id ?? 'unknown'}`;
    const rawJobId = String(job.job_id ?? '').trim();
    return id === target || composite === target || rawJobId === target || rawJobId === normalized || id === `linkedin:${normalized}`;
  });
}

export function buildTemplateCoverLetter(job: Job, applicant: Applicant): string {
  const applicantName = applicant.applicant_name || 'Candidate';
  const applicantEmail = applicant.applicant_email || '';
  const applicantNumber = applicant.applicant_number || '';
  const applicantProfile = applicant.applicant_profile || '';
  const title = job.title || 'the role';
  const company = job.company || 'your company';
  const description = job.description || '';
  const strengths = (job.matched_positive_terms || []).slice(0, 4).join(', ');
  const profileExcerpt = applicantProfile.slice(0, 900).trim();

  const body = [
    `Dear Hiring Team at ${company},`,
    '',
    `I am excited to apply for the ${title} role. My background aligns strongly with this opportunity, especially in the areas of ${strengths || 'Python, SQL, and analytics engineering'}.`,
    '',
    profileExcerpt,
    '',
    'What stands out to me about this role is the chance to apply that experience in a way that supports real business decisions and scalable data workflows. Based on the job description, I believe I would be a strong fit for the mix of technical execution, analytics thinking, and cross-functional collaboration the role calls for.',
  ];

  if (description) {
    body.push(
      '',
      'I am particularly drawn to the parts of the role that emphasize:',
      `- ${title} responsibilities at ${company}`,
      '- Working with data systems, reporting, and business stakeholders',
      '- Building reliable workflows and translating data into action',
    );
  }

  body.push(
    '',
    'Thank you for your time and consideration. I would welcome the opportunity to discuss how my experience could support your team.',
    '',
    'Sincerely,',
    applicantName,
  );

  if (applicantEmail) body.push(applicantEmail);
  if (applicantNumber) body.push(applicantNumber);

  return body.join('\n');
}

export function normalizeCoverLetter(text: string): string {
  let cleaned = text.replace(/\r\n/g, '\n').trim();
  cleaned = cleaned.replace('Dear Hiring Team', 'Dear Hiring Manager');
  while (cleaned.includes('\n\n\n')) cleaned = cleaned.replace(/\n\n\n/g, '\n\n');
  return cleaned;
}

export async function generateCoverLetterWithOpenAI(job: Job, applicant: Applicant, apiKey: string): Promise<string> {
  const client = new OpenAI({ apiKey });
  const response = await client.responses.create({
    model: process.env.JOB_CHECKER_OPENAI_MODEL || 'gpt-4.1-mini',
    input: [
      {
        role: 'system',
        content: [{ type: 'input_text', text: [
          'You write strong, natural cover letters for job applications.',
          '',
          'Write a concise, specific cover letter using the provided job and applicant information. The letter should feel human, direct, and professional, not generic or overly polished. It should sound like a capable candidate wrote it, not an AI system.',
          '',
          'Requirements:',
          '- Start with exactly: Dear Hiring Manager',
          '- Do not use placeholders of any kind',
          '- Do not invent experience, tools, employers, or achievements that are not supported by the applicant information',
          '- Focus on matching the applicant\'s real background to the job\'s real requirements',
          '- Use natural business writing, with varied sentence structure',
          '- Avoid obvious AI-style phrasing, clichés, and exaggerated enthusiasm',
          '- Avoid em dashes and avoid unnecessary hyphen-heavy phrasing',
          '- Keep it tailored to the specific role and company',
          '- Keep it reasonably concise, around 250 to 400 words',
          '- End with a simple professional closing',
          '',
          'Output only the final cover letter text, with no commentary, no analysis, and no JSON.',
        ].join('\n') }],
      },
      {
        role: 'user',
        content: [{ type: 'input_text', text: [
          `APPLICANT NAME:\n${applicant.applicant_name || 'Not provided'}`,
          `APPLICANT PHONE:\n${applicant.applicant_number || 'Not provided'}`,
          `APPLICANT EMAIL:\n${applicant.applicant_email || 'Not provided'}`,
          `APPLICANT PROFILE:\n${applicant.applicant_profile || 'Not provided'}`,
          `JOB TITLE:\n${job.title || 'Not provided'}`,
          `COMPANY:\n${job.company || 'Not provided'}`,
          `MATCHED STRENGTHS:\n${(job.matched_positive_terms || []).slice(0, 6).join(', ') || 'Not provided'}`,
          `JOB DESCRIPTION:\n${job.description || 'Not provided'}`,
        ].join('\n\n') }],
      },
    ],
  });

  const outputText = response.output_text?.trim();
  if (!outputText) throw new Error('OpenAI response did not contain any text output');
  return outputText;
}

export async function buildCoverLetter(job: Job, applicant: Applicant): Promise<{ coverLetter: string; generationMode: 'openai' | 'template' }> {
  const apiKey = process.env.JOB_CHECKER_OPENAI_API_KEY;
  if (apiKey) {
    try {
      const generated = await generateCoverLetterWithOpenAI(job, applicant, apiKey);
      return { coverLetter: normalizeCoverLetter(generated), generationMode: 'openai' };
    } catch {
      return { coverLetter: normalizeCoverLetter(buildTemplateCoverLetter(job, applicant)), generationMode: 'template' };
    }
  }

  return { coverLetter: normalizeCoverLetter(buildTemplateCoverLetter(job, applicant)), generationMode: 'template' };
}
