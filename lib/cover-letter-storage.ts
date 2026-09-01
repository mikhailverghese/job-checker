export type StoredCoverLetter = {
  text: string;
  applicantId: string;
  applicantLabel: string;
  jobTitle: string;
  company: string;
  generatedAt: string;
};

const PREFIX = 'job-checker:cover-letter:';

export function buildCoverLetterStorageKey(jobId: string, applicantId: string) {
  return `${PREFIX}${jobId}::${applicantId}`;
}

export function storeCoverLetter(jobId: string, applicantId: string, letter: StoredCoverLetter) {
  if (typeof window === 'undefined') return;
  window.sessionStorage.setItem(buildCoverLetterStorageKey(jobId, applicantId), JSON.stringify(letter));
}

export function readCoverLetter(jobId: string, applicantId: string): StoredCoverLetter | null {
  if (typeof window === 'undefined') return null;
  const raw = window.sessionStorage.getItem(buildCoverLetterStorageKey(jobId, applicantId));
  if (!raw) return null;

  try {
    return JSON.parse(raw) as StoredCoverLetter;
  } catch {
    return null;
  }
}
