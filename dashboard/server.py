from __future__ import annotations

import json
import os
from datetime import datetime, UTC
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse

import requests

ROOT = Path(__file__).resolve().parent
PROJECT_ROOT = ROOT.parent
OUTPUT = PROJECT_ROOT / "output"
PUBLIC_DATA = PROJECT_ROOT / "data-public"
APPLICANT_DIR = PROJECT_ROOT / "applicant"
PUBLIC_MATCHED_JOBS = PUBLIC_DATA / "matched-jobs.json"


class Handler(SimpleHTTPRequestHandler):
    def translate_path(self, path: str) -> str:
        parsed_path = urlparse(path).path
        if parsed_path in ("/", "/index.html"):
            return str(ROOT / "index.html")
        if parsed_path in ("/matched_jobs.json", "/matched-jobs.json"):
            return str(PUBLIC_DATA / "matched-jobs.json")
        if parsed_path == "/raw_jobs.json":
            return str(OUTPUT / "raw_jobs.json")
        if parsed_path == "/meta.json":
            return str(PUBLIC_DATA / "meta.json")
        if parsed_path == "/applicants.json":
            return str(PUBLIC_DATA / "applicants.json")
        return str(ROOT / parsed_path.lstrip("/"))

    def do_GET(self):
        parsed_path = urlparse(self.path).path
        if parsed_path == "/meta.json":
            write_meta()
        if parsed_path == "/applicants.json":
            write_applicants()
        return super().do_GET()

    def do_POST(self):
        parsed_path = urlparse(self.path).path
        if parsed_path != "/api/cover-letter":
            self.send_error(404, "Not Found")
            return

        try:
            content_length = int(self.headers.get("Content-Length", "0"))
            raw = self.rfile.read(content_length)
            payload = json.loads(raw.decode("utf-8"))
            job_id = str(payload.get("jobId") or payload.get("unique_job_id") or "").strip()
            applicant_id = str(payload.get("applicantId") or payload.get("applicant_id") or "").strip()
            if not job_id or not applicant_id:
                raise ValueError("jobId and applicantId are required")

            applicant_path = APPLICANT_DIR / f"{applicant_id}.json"
            if not applicant_path.exists():
                raise FileNotFoundError(f"Applicant file not found: {applicant_path.name}")
            if not PUBLIC_MATCHED_JOBS.exists():
                raise FileNotFoundError("Public matched jobs file not found. Run the pipeline first.")

            jobs = json.loads(PUBLIC_MATCHED_JOBS.read_text())
            applicant = json.loads(applicant_path.read_text())
            matched_job = next(
                (
                    job for job in jobs
                    if str(job.get("id", "")).strip() == job_id
                    or (
                        str(job.get("source", "")).strip() + ":" + str(job.get("job_id", "")).strip()
                    ) == job_id
                ),
                None,
            )
            if not matched_job:
                raise ValueError("Job not found in public matched jobs dataset")

            cover_letter, generation_mode = build_cover_letter(matched_job, applicant)
            response = {
                "ok": True,
                "jobId": job_id,
                "applicantId": applicant_id,
                "coverLetter": cover_letter,
                "generationMode": generation_mode,
                "generatedAt": datetime.now(UTC).isoformat(),
            }
            body = json.dumps(response).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        except Exception as exc:
            body = json.dumps({"ok": False, "error": str(exc)}).encode("utf-8")
            self.send_response(400)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)


def write_meta() -> None:
    matched_path = PUBLIC_DATA / "matched-jobs.json"
    payload = {
        "lastUpdated": datetime.now(UTC).isoformat(),
        "totalRuntimeSeconds": None,
        "matchedJobsCount": None,
    }
    if matched_path.exists():
        try:
            jobs = json.loads(matched_path.read_text())
            payload["matchedJobsCount"] = len(jobs)
            payload["lastUpdated"] = datetime.fromtimestamp(matched_path.stat().st_mtime, UTC).isoformat()
        except Exception:
            pass
    PUBLIC_DATA.mkdir(parents=True, exist_ok=True)
    (PUBLIC_DATA / "meta.json").write_text(json.dumps(payload, indent=2))


def write_applicants() -> None:
    applicants: list[dict[str, str]] = []
    if APPLICANT_DIR.exists():
        for path in sorted(APPLICANT_DIR.glob("*.json")):
            if path.name == "example-applicant.json":
                continue
            applicants.append(
                {
                    "id": path.stem,
                    "filename": path.name,
                    "label": path.stem.replace("-", " ").replace("_", " ").title(),
                }
            )
    PUBLIC_DATA.mkdir(parents=True, exist_ok=True)
    (PUBLIC_DATA / "applicants.json").write_text(json.dumps(applicants, indent=2))


def normalize_cover_letter(text: str) -> str:
    cleaned = text.replace("\r\n", "\n").strip()
    cleaned = cleaned.replace("Dear Hiring Team", "Dear Hiring Manager")
    while "\n\n\n" in cleaned:
        cleaned = cleaned.replace("\n\n\n", "\n\n")
    return cleaned


def build_cover_letter(job: dict, applicant: dict) -> tuple[str, str]:
    applicant_name = applicant.get("applicant_name", "Candidate")
    applicant_email = applicant.get("applicant_email", "")
    applicant_number = applicant.get("applicant_number", "")
    applicant_profile = applicant.get("applicant_profile", "")
    title = job.get("title", "the role")
    company = job.get("company", "your company")
    description = job.get("description", "")
    strengths = ", ".join(job.get("matched_positive_terms", [])[:4])
    profile_excerpt = applicant_profile[:900].strip()

    api_key = os.getenv("JOB_CHECKER_OPENAI_API_KEY")
    if api_key:
        try:
            generated = generate_cover_letter_with_openai(job, applicant, api_key)
            if generated:
                return normalize_cover_letter(generated), "openai"
        except Exception:
            return normalize_cover_letter(build_template_cover_letter(job, applicant)), "template"

    return normalize_cover_letter(build_template_cover_letter(job, applicant)), "template"


def build_template_cover_letter(job: dict, applicant: dict) -> str:
    applicant_name = applicant.get("applicant_name", "Candidate")
    applicant_email = applicant.get("applicant_email", "")
    applicant_number = applicant.get("applicant_number", "")
    applicant_profile = applicant.get("applicant_profile", "")
    title = job.get("title", "the role")
    company = job.get("company", "your company")
    description = job.get("description", "")
    strengths = ", ".join(job.get("matched_positive_terms", [])[:4])
    profile_excerpt = applicant_profile[:900].strip()

    body = [
        f"Dear Hiring Team at {company},",
        "",
        f"I am excited to apply for the {title} role. My background aligns strongly with this opportunity, especially in the areas of {strengths or 'Python, SQL, and analytics engineering'}.",
        "",
        f"{profile_excerpt}",
        "",
        "What stands out to me about this role is the chance to apply that experience in a way that supports real business decisions and scalable data workflows. Based on the job description, I believe I would be a strong fit for the mix of technical execution, analytics thinking, and cross-functional collaboration the role calls for.",
    ]

    if description:
        body.extend([
            "",
            "I am particularly drawn to the parts of the role that emphasize:",
            f"- {title} responsibilities at {company}",
            f"- Working with data systems, reporting, and business stakeholders",
            f"- Building reliable workflows and translating data into action",
        ])

    body.extend([
        "",
        "Thank you for your time and consideration. I would welcome the opportunity to discuss how my experience could support your team.",
        "",
        "Sincerely,",
        applicant_name,
    ])

    if applicant_email:
        body.append(applicant_email)
    if applicant_number:
        body.append(applicant_number)

    return "\n".join(body)


def generate_cover_letter_with_openai(job: dict, applicant: dict, api_key: str) -> str:
    applicant_name = applicant.get("applicant_name", "Candidate")
    applicant_email = applicant.get("applicant_email", "")
    applicant_number = applicant.get("applicant_number", "")
    applicant_profile = applicant.get("applicant_profile", "")
    title = job.get("title", "")
    company = job.get("company", "")
    description = job.get("description", "")
    strengths = ", ".join(job.get("matched_positive_terms", [])[:6])

    system_prompt = (
        "You write strong, natural cover letters for job applications.\n\n"
        "Write a concise, specific cover letter using the provided job and applicant information. "
        "The letter should feel human, direct, and professional, not generic or overly polished. "
        "It should sound like a capable candidate wrote it, not an AI system.\n\n"
        "Requirements:\n"
        "- Start with exactly: Dear Hiring Manager\n"
        "- Do not use placeholders of any kind\n"
        "- Do not invent experience, tools, employers, or achievements that are not supported by the applicant information\n"
        "- Focus on matching the applicant's real background to the job's real requirements\n"
        "- Use natural business writing, with varied sentence structure\n"
        "- Avoid obvious AI-style phrasing, clichés, and exaggerated enthusiasm\n"
        "- Avoid em dashes and avoid unnecessary hyphen-heavy phrasing\n"
        "- Keep it tailored to the specific role and company\n"
        "- Keep it reasonably concise, around 250 to 400 words\n"
        "- End with a simple professional closing\n\n"
        "Output only the final cover letter text, with no commentary, no analysis, and no JSON."
    )

    user_prompt = (
        f"APPLICANT NAME:\n{applicant_name or 'Not provided'}\n\n"
        f"APPLICANT PHONE:\n{applicant_number or 'Not provided'}\n"
        f"APPLICANT EMAIL:\n{applicant_email or 'Not provided'}\n\n"
        f"APPLICANT PROFILE:\n{applicant_profile or 'Not provided'}\n\n"
        f"JOB TITLE:\n{title or 'Not provided'}\n\n"
        f"COMPANY:\n{company or 'Not provided'}\n\n"
        f"MATCHED STRENGTHS:\n{strengths or 'Not provided'}\n\n"
        f"JOB DESCRIPTION:\n{description or 'Not provided'}"
    )

    response = requests.post(
        "https://api.openai.com/v1/responses",
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
        json={
            "model": os.getenv("JOB_CHECKER_OPENAI_MODEL", "gpt-4.1-mini"),
            "input": [
                {"role": "system", "content": [{"type": "input_text", "text": system_prompt}]},
                {"role": "user", "content": [{"type": "input_text", "text": user_prompt}]},
            ],
        },
        timeout=60,
    )
    response.raise_for_status()
    payload = response.json()

    chunks: list[str] = []

    direct_text = payload.get("output_text")
    if isinstance(direct_text, str) and direct_text.strip():
        chunks.append(direct_text.strip())

    output = payload.get("output", [])
    for item in output:
        for content in item.get("content", []):
            text = content.get("text")
            if isinstance(text, str) and text.strip():
                chunks.append(text.strip())
            if content.get("type") == "output_text":
                nested_text = content.get("text")
                if isinstance(nested_text, str) and nested_text.strip():
                    chunks.append(nested_text.strip())

    result = "\n".join(chunk for chunk in chunks if chunk).strip()
    if not result:
        raise ValueError("OpenAI response did not contain any text output")
    return result


if __name__ == "__main__":
    write_meta()
    write_applicants()
    port = int(os.getenv("JOB_CHECKER_DASHBOARD_PORT", "8787"))
    server = ThreadingHTTPServer(("0.0.0.0", port), Handler)
    print(f"Dashboard serving on http://0.0.0.0:{port}")
    server.serve_forever()
