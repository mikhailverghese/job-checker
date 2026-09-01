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
  const key = buildCoverLetterStorageKey(jobId, applicantId);
  const payload = JSON.stringify(letter);
  window.sessionStorage.setItem(key, payload);
  window.localStorage.setItem(key, payload);
}

export function readCoverLetter(jobId: string, applicantId: string): StoredCoverLetter | null {
  if (typeof window === 'undefined') return null;
  const key = buildCoverLetterStorageKey(jobId, applicantId);
  const raw = window.sessionStorage.getItem(key) || window.localStorage.getItem(key);
  if (!raw) return null;

  try {
    return JSON.parse(raw) as StoredCoverLetter;
  } catch {
    return null;
  }
}
