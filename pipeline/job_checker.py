from __future__ import annotations

import csv
import json
import os
import re
import time
from dataclasses import dataclass, asdict
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any
from urllib.parse import quote

from playwright.sync_api import TimeoutError as PlaywrightTimeoutError
from playwright.sync_api import sync_playwright


@dataclass
class JobPosting:
    source: str
    title: str
    company: str
    location: str
    linkedin_url: str
    job_id: str | None
    posted_text: str
    posted_date: str | None
    posted_timestamp_estimate: str | None
    workplace_type: str | None
    application_type: str | None
    salary: str | None
    applicant_count: int | None
    description: str
    search_term: str
    score: int = 0
    matched_positive_terms: list[str] | None = None
    matched_negative_terms: list[str] | None = None
    accepted: bool = False
    rejection_reason: str | None = None
    linkedin_saved: bool = False
    location_signal: str | None = None


class JobChecker:
    def __init__(
        self,
        scoring_config_path: str = "config/scoring-config.json",
        runtime_config_path: str = "config/runtime.local.json",
    ) -> None:
        self.root = Path(__file__).resolve().parent.parent
        self.public_data_dir = self.root / "data-public"
        self.public_matched_jobs_json = self.public_data_dir / "matched-jobs.json"
        self.config = self._load_config(scoring_config_path, runtime_config_path)
        self.storage = self.config["storage"]
        self.debug = self.config.get("debug", {})
        self.seen_jobs_path = self.root / self.storage["seen_jobs_path"]
        self.matched_jobs_json = self.root / self.storage["matched_jobs_json"]
        self.matched_jobs_csv = self.root / self.storage["matched_jobs_csv"]
        self.raw_jobs_json = self.root / self.storage["raw_jobs_json"]
        self.screenshots_dir = self.root / self.debug.get("screenshots_dir", "output/debug/screenshots")
        self.html_dir = self.root / self.debug.get("html_dir", "output/debug/html")
        self.profile_dir = self.root / self.config["linkedin"].get("profile_dir", "browser-profile/linkedin")
        self.profile_name = self.config["linkedin"].get("profile_name", "Default")
        self.email = os.getenv(self.config["linkedin"]["email_env"])
        self.password = os.getenv(self.config["linkedin"]["password_env"])

    def _deep_merge(self, base: dict[str, Any], override: dict[str, Any]) -> dict[str, Any]:
        result = dict(base)
        for key, value in override.items():
            if isinstance(value, dict) and isinstance(result.get(key), dict):
                result[key] = self._deep_merge(result[key], value)
            else:
                result[key] = value
        return result

    def _load_json_config(self, config_path: str, required: bool = True) -> dict[str, Any]:
        path = self.root / config_path
        if not path.exists():
            if required:
                raise FileNotFoundError(f"Config file not found: {path}")
            return {}
        return json.loads(path.read_text())

    def _load_config(self, scoring_config_path: str, runtime_config_path: str) -> dict[str, Any]:
        scoring = self._load_json_config(scoring_config_path, required=True)
        runtime = self._load_json_config(runtime_config_path, required=False)
        return self._deep_merge(scoring, runtime)

    def load_seen_jobs(self) -> set[str]:
        if not self.seen_jobs_path.exists():
            return set()
        return set(json.loads(self.seen_jobs_path.read_text()))

    def save_seen_jobs(self, seen_jobs: set[str]) -> None:
        self.seen_jobs_path.parent.mkdir(parents=True, exist_ok=True)
        self.seen_jobs_path.write_text(json.dumps(sorted(seen_jobs), indent=2))

    def normalize_text(self, text: str | None) -> str:
        return re.sub(r"\s+", " ", (text or "").strip().lower())

    def contains_any(self, text: str, keywords: list[str]) -> bool:
        normalized = self.normalize_text(text)
        return any(keyword.lower() in normalized for keyword in keywords)

    def is_recent(self, posted_text: str) -> bool:
        return self.contains_any(posted_text, self.config["time_keywords"])

    def matches_location(self, location: str) -> bool:
        if self.config["filters"].get("include_remote") and "remote" in self.normalize_text(location):
            return True
        return self.contains_any(location, self.config["location_keywords"])

    def score_posting(self, posting: JobPosting) -> JobPosting:
        title_corpus = self.normalize_text(posting.title)
        location_corpus = self.normalize_text(posting.location)
        corpus = self.normalize_text(
            " ".join(
                [
                    posting.title,
                    posting.company,
                    posting.location,
                    posting.posted_text,
                    posting.workplace_type or "",
                    posting.application_type or "",
                    posting.salary or "",
                    posting.description,
                ]
            )
        )

        pos_matches: list[str] = []
        neg_matches: list[str] = []
        score = 0

        def add_match(match_list: list[str] | None, weight: int) -> None:
            nonlocal score
            if match_list is not None:
                match_list.append(term)
            score += int(weight)

        location_positive_matched = False
        location_negative_matched = False

        for term, weight in self.config["weights"].get("title_positive", {}).items():
            if term in title_corpus:
                add_match(None, int(weight))

        for term, weight in self.config["weights"].get("title_negative", {}).items():
            if term in title_corpus:
                add_match(None, int(weight))

        for term, weight in self.config["weights"].get("location_positive", {}).items():
            if term in location_corpus:
                location_positive_matched = True
                add_match(None, int(weight))

        for term, weight in self.config["weights"].get("location_negative", {}).items():
            if term in location_corpus:
                location_negative_matched = True
                add_match(None, int(weight))

        for term, weight in self.config["weights"]["positive"].items():
            if term in corpus:
                add_match(pos_matches, int(weight))

        for term, weight in self.config["weights"]["negative"].items():
            if term in corpus:
                add_match(neg_matches, int(weight))

        if not neg_matches:
            score += int(self.config["filters"].get("no_negative_bonus", 0))

        if location_negative_matched:
            posting.location_signal = "negative"
        elif location_positive_matched:
            posting.location_signal = "positive"
        else:
            posting.location_signal = None

        posting.score = score
        posting.matched_positive_terms = pos_matches
        posting.matched_negative_terms = neg_matches

        if not self.is_recent(posting.posted_text):
            posting.accepted = False
            posting.rejection_reason = "not_recent"
            return posting

        if not self.matches_location(posting.location):
            posting.accepted = False
            posting.rejection_reason = "location_mismatch"
            return posting

        if len(pos_matches) < int(self.config["filters"]["min_positive_matches"]):
            posting.accepted = False
            posting.rejection_reason = "not_enough_positive_matches"
            return posting

        if score < int(self.config["filters"]["min_score"]):
            posting.accepted = False
            posting.rejection_reason = "below_score_threshold"
            return posting

        posting.accepted = True
        return posting

    def _save_screenshot(self, page, name: str) -> None:
        if not self.debug.get("enabled", False):
            return
        self.screenshots_dir.mkdir(parents=True, exist_ok=True)
        page.screenshot(path=str(self.screenshots_dir / f"{name}.png"), full_page=True)

    def _save_html(self, page, name: str) -> None:
        if not self.debug.get("enabled", False) or not self.debug.get("save_html_on_failure", False):
            return
        self.html_dir.mkdir(parents=True, exist_ok=True)
        (self.html_dir / f"{name}.html").write_text(page.content())

    def login(self, page) -> None:
        if not self.email or not self.password:
            raise ValueError("Missing LinkedIn credentials in environment variables")
        page.goto("https://www.linkedin.com/login", wait_until="domcontentloaded")
        page.wait_for_timeout(3000)
        self._save_screenshot(page, "00_login_page")
        self._save_html(page, "00_login_page")
        selectors = [
            "#username",
            "input[name='session_key']",
            "input[autocomplete='username']",
            "input[autocomplete='username webauthn']",
            "input[type='email']"
        ]
        email_filled = False
        for selector in selectors:
            try:
                locators = page.locator(selector)
                count = locators.count()
                for idx in range(count):
                    locator = locators.nth(idx)
                    try:
                        if not locator.is_visible(timeout=1000):
                            continue
                        locator.click(timeout=3000)
                        locator.fill("")
                        locator.type(self.email, delay=50)
                        email_filled = True
                        break
                    except Exception:
                        continue
                if email_filled:
                    break
            except Exception:
                continue

        if not email_filled:
            self._save_screenshot(page, "00_login_page_missing_username")
            self._save_html(page, "00_login_page_missing_username")
            raise RuntimeError("Could not find LinkedIn username input on login page")

        page.wait_for_timeout(1000)

        password_selectors = [
            "#password",
            "input[name='session_password']",
            "input[autocomplete='current-password']",
            "input[type='password']"
        ]
        password_filled = False
        for selector in password_selectors:
            try:
                locators = page.locator(selector)
                count = locators.count()
                for idx in range(count):
                    locator = locators.nth(idx)
                    try:
                        if not locator.is_visible(timeout=1000):
                            continue
                        locator.click(timeout=3000)
                        locator.fill("")
                        locator.type(self.password, delay=50)
                        password_filled = True
                        break
                    except Exception:
                        continue
                if password_filled:
                    break
            except Exception:
                continue

        if not password_filled:
            self._save_screenshot(page, "00_login_page_missing_password")
            self._save_html(page, "00_login_page_missing_password")
            raise RuntimeError("Could not find LinkedIn password input on login page")

        submit_selectors = [
            "button[type='submit']",
            "button:has-text('Sign in')",
            "button[aria-label='Sign in']",
            "button:has(span:has-text('Sign in'))"
        ]
        submitted = False
        for selector in submit_selectors:
            try:
                locators = page.locator(selector)
                count = locators.count()
                for idx in range(count):
                    locator = locators.nth(idx)
                    try:
                        if not locator.is_visible(timeout=1000):
                            continue
                        locator.click(timeout=5000)
                        submitted = True
                        break
                    except Exception:
                        continue
                if submitted:
                    break
            except Exception:
                continue

        if not submitted:
            self._save_screenshot(page, "00_login_page_missing_submit")
            self._save_html(page, "00_login_page_missing_submit")
            raise RuntimeError("Could not find LinkedIn sign in button on login page")
        page.wait_for_timeout(5000)
        page.wait_for_load_state("domcontentloaded")
        try:
            page.goto("https://www.linkedin.com/feed/", wait_until="domcontentloaded")
            page.wait_for_timeout(2000)
            page.goto("https://www.linkedin.com/jobs/", wait_until="domcontentloaded")
            page.wait_for_timeout(2000)
        except Exception:
            pass
        if self.debug.get("save_login_screenshot", False):
            self._save_screenshot(page, "01_after_login")
            self._save_html(page, "01_after_login")

    def scrape_search_term(self, page, search_term: str, seen_keys: set[str] | None = None) -> list[JobPosting]:
        query = quote(search_term)
        geo_id = self.config["linkedin"].get("geo_id")
        distance = self.config["linkedin"].get("distance", 50)
        time_range_seconds = self.config["linkedin"].get("time_range_seconds", 86400)
        url = (
            "https://www.linkedin.com/jobs/search/"
            f"?keywords={query}"
            f"&geoId={geo_id}"
            f"&distance={distance}"
            f"&f_TPR=r{time_range_seconds}"
        )
        page.goto(url, wait_until="domcontentloaded")
        page.wait_for_timeout(2500)
        safe_term = re.sub(r"[^a-z0-9]+", "_", search_term.lower()).strip("_")
        if self.debug.get("save_search_screenshot", False):
            self._save_screenshot(page, f"02_search_{safe_term}")
            self._save_html(page, f"02_search_{safe_term}")

        card_selectors = [
            "div.base-search-card",
            "div.job-search-card",
            "li.jobs-search-results__list-item",
            "div.job-card-container"
        ]
        cards = None
        total_available = 0
        max_jobs = int(self.config["linkedin"]["max_jobs_per_search"])
        for selector in card_selectors:
            locator = page.locator(selector)
            current_count = locator.count()
            if current_count > 0:
                cards = locator
                total_available = current_count
                break

        if not cards or total_available == 0:
            self._save_html(page, f"no_cards_{safe_term}")
            return []

        results: list[JobPosting] = []

        for i in range(total_available):
            if len(results) >= max_jobs:
                break
            card = cards.nth(i)
            title = self._safe_text_from_scope(card, [
                ".base-search-card__title",
                ".job-search-card__title",
                "h3",
                "a.base-card__full-link"
            ])
            company = self._safe_text_from_scope(card, [
                ".base-search-card__subtitle",
                ".job-search-card__subtitle",
                "h4",
                ".hidden-nested-link"
            ])
            location = self._safe_text_from_scope(card, [
                ".job-search-card__location",
                ".base-search-card__metadata",
                ".job-search-card__listdate"
            ])
            posted_text = self._safe_text_from_scope(card, [
                "time",
                ".job-search-card__listdate",
                ".job-search-card__footer-item"
            ])
            posted_date = self._safe_attr_from_scope(card, [
                "time"
            ], "datetime") or None
            linkedin_url = self._safe_attr_from_scope(card, [
                "a.base-card__full-link",
                "a.job-card-container__link",
                "a"
            ], "href") or page.url
            linkedin_url = self._canonical_job_url(linkedin_url)

            job_id = self._extract_job_id(linkedin_url)
            dedupe_key = job_id or linkedin_url
            if seen_keys is not None and dedupe_key in seen_keys:
                continue

            description = ""
            applicant_count = None
            card_text_raw = card.inner_text()
            page_text = self.normalize_text(card_text_raw)
            workplace_type = self._extract_workplace_type(page_text)
            application_type = "Easy Apply" if "easy apply" in page_text else "External"
            salary = self._extract_salary(card_text_raw)
            posted_timestamp_estimate = self._estimate_posted_timestamp(posted_text, posted_date)

            detail_links = [
                "a.base-card__full-link",
                "a.job-card-container__link",
                "a"
            ]
            detail_opened = False
            for selector in detail_links:
                try:
                    link_locator = card.locator(selector).first
                    if link_locator.count() == 0:
                        continue
                    href = link_locator.get_attribute("href")
                    if href:
                        if "/jobs/view/" in href:
                            member_href = re.sub(r"https://www\.linkedin\.com/jobs/view/", "https://www.linkedin.com/jobs/collections/recommended/?currentJobId=", href)
                            member_href = member_href.split("?")[0].replace("-at-", "")
                            job_id_match = self._extract_job_id(href)
                            if job_id_match:
                                href = f"https://www.linkedin.com/jobs/view/{job_id_match}/"
                        detail_page = page.context.new_page()
                        detail_page.goto(href, wait_until="domcontentloaded")
                        detail_page.wait_for_timeout(1500)
                        description = self._safe_text(detail_page, [
                            ".show-more-less-html__markup",
                            ".description__text",
                            ".jobs-description__content",
                            ".jobs-box__html-content"
                        ])
                        detail_text_raw = detail_page.locator("body").inner_text()
                        detail_text = self.normalize_text(detail_text_raw)
                        detail_html = detail_page.content()
                        compensation_block_salary = self._safe_text(detail_page, [
                            ".salary.compensation__salary",
                            ".compensation__salary-range .salary"
                        ])
                        top_card_salary = self._safe_text(detail_page, [
                            ".job-details-jobs-unified-top-card__tertiary-description-container",
                            ".job-details-jobs-unified-top-card__tertiary-description-container span",
                            ".job-details-jobs-unified-top-card__primary-description-container",
                            ".job-details-jobs-unified-top-card__primary-description-container span",
                            ".topcard__flavor-row",
                            ".topcard__flavor-row span",
                            ".job-insight"
                        ])
                        if job_id == "4431117332":
                            self._save_html(detail_page, f"stuut_detail_debug_{safe_term}_{i}")
                        if not workplace_type:
                            workplace_type = self._extract_workplace_type(detail_text)
                        if application_type != "Easy Apply" and "easy apply" in detail_text:
                            application_type = "Easy Apply"
                        if compensation_block_salary:
                            compensation_block_value = self._extract_salary(compensation_block_salary)
                            if compensation_block_value:
                                salary = compensation_block_value
                        elif top_card_salary:
                            top_card_salary_value = self._extract_salary(top_card_salary)
                            if top_card_salary_value:
                                salary = top_card_salary_value
                        if not salary:
                            salary = self._extract_salary(detail_text_raw, detail_html)
                        applicant_count = self._extract_exact_applicant_count(detail_page)
                        if job_id == "4406817128":
                            self._save_screenshot(detail_page, f"flatiron_applicant_debug_{safe_term}_{i}")
                            self._save_html(detail_page, f"flatiron_applicant_debug_{safe_term}_{i}")
                        if self.debug.get("save_first_detail_screenshot", False):
                            self._save_screenshot(detail_page, f"03_detail_{safe_term}_{i}")
                            self._save_html(detail_page, f"03_detail_{safe_term}_{i}")
                        detail_page.close()
                        detail_opened = True
                        break
                except PlaywrightTimeoutError:
                    self._save_html(page, f"timeout_click_{i}")
                    continue
                except Exception:
                    self._save_html(page, f"generic_click_error_{i}")
                    continue

            if not detail_opened:
                self._save_html(page, f"missing_detail_{i}")

            if not title:
                continue

            results.append(
                JobPosting(
                    source="linkedin",
                    title=title,
                    company=company,
                    location=location,
                    linkedin_url=linkedin_url,
                    job_id=job_id,
                    posted_text=posted_text,
                    posted_date=posted_date,
                    posted_timestamp_estimate=posted_timestamp_estimate,
                    workplace_type=workplace_type,
                    application_type=application_type,
                    salary=salary,
                    applicant_count=applicant_count,
                    description=description,
                    search_term=search_term,
                )
            )

        return results

    def _safe_text(self, page, selectors: list[str]) -> str:
        for selector in selectors:
            try:
                locator = page.locator(selector).first
                if locator.count() > 0:
                    text = locator.inner_text().strip()
                    if text:
                        return text
            except Exception:
                continue
        return ""

    def _safe_text_from_scope(self, scope, selectors: list[str]) -> str:
        for selector in selectors:
            try:
                locator = scope.locator(selector).first
                if locator.count() > 0:
                    text = locator.inner_text().strip()
                    if text:
                        return text
            except Exception:
                continue
        return ""

    def _safe_attr_from_scope(self, scope, selectors: list[str], attr: str) -> str:
        for selector in selectors:
            try:
                locator = scope.locator(selector).first
                if locator.count() > 0:
                    value = locator.get_attribute(attr)
                    if value:
                        return value
            except Exception:
                continue
        return ""

    def _extract_job_id(self, url: str) -> str | None:
        match = re.search(r"/jobs/view/(?:[^/]*-)?(\d+)", url)
        if match:
            return match.group(1)
        match = re.search(r"currentJobId=(\d+)", url)
        if match:
            return match.group(1)
        return None

    def _canonical_job_url(self, url: str) -> str:
        job_id = self._extract_job_id(url)
        if job_id:
            return f"https://www.linkedin.com/jobs/view/{job_id}/"
        return url.split("?")[0]

    def _extract_workplace_type(self, text: str) -> str | None:
        if "hybrid" in text:
            return "hybrid"
        if "remote" in text:
            return "remote"
        if "on-site" in text or "onsite" in text:
            return "on-site"
        return None

    def _parse_salary_amounts(self, salary_text: str) -> list[float]:
        salary_text = salary_text.replace('—', '-').replace('–', '-')
        amounts = re.findall(r"\$?\s*([\d,]+(?:\.\d+)?)\s*([kKmM]?)", salary_text)
        values: list[float] = []
        for amount_text, suffix in amounts:
            cleaned = amount_text.replace(',', '').strip()
            if not cleaned:
                continue
            value = float(cleaned)
            suffix = suffix.lower()
            if suffix == 'k':
                value *= 1_000
            elif suffix == 'm':
                value *= 1_000_000
            values.append(value)
        return values

    def _normalize_salary_value(self, salary_text: str, surrounding_text: str, *, hourly: bool = False) -> str | None:
        normalized_salary_text = salary_text.replace('—', '-').replace('–', '-')

        annual_range_match = re.search(
            r"\$\s*([\d,]+(?:\.\d+)?)\s*/\s*(?:yr|year|annually|annual)\s*-\s*\$\s*([\d,]+(?:\.\d+)?)\s*/\s*(?:yr|year|annually|annual)",
            normalized_salary_text,
            flags=re.IGNORECASE,
        )
        if annual_range_match:
            high = float(annual_range_match.group(2).replace(',', ''))
            return f"${int(round(high)):,}"

        values = self._parse_salary_amounts(normalized_salary_text)
        if not values:
            return None

        max_value = max(values)
        normalized_context = self.normalize_text(surrounding_text)
        if hourly or any(marker in normalized_context for marker in ["/hr", "per hour", "hourly", "/ hour", "an hour", " hr", "hr "]):
            max_value = max_value * 40 * 52

        return f"${int(round(max_value)):,}"

    def _extract_salary(self, text: str, html: str | None = None) -> str | None:
        candidates: list[tuple[int, str, str, bool]] = []

        def add_candidate(score: int, salary_text: str, context: str, hourly: bool = False) -> None:
            lower_context = context.lower()
            if any(token in lower_context for token in ["equity", "stock", "options", "rsu"]):
                score -= 10
            if any(token in lower_context for token in ["base salary", "salary range", "compensation range", "annual salary", "base pay", "pay rate"]):
                score += 10
            candidates.append((score, salary_text, context, hourly))

        search_spaces = [text]
        if html:
            search_spaces.insert(0, html)

        annual_patterns = [
            (20, r"Base Salary:\s*(\$?\s*[\d,]+(?:\.\d+)?\s*[kKmM]?(?:\s*(?:-|–|—|to)\s*\$?\s*[\d,]+(?:\.\d+)?\s*[kKmM]?)?)"),
            (18, r"base pay[:\s]+(\$?\s*[\d,]+(?:\.\d+)?\s*[kKmM]?(?:\s*(?:-|–|—|to)\s*\$?\s*[\d,]+(?:\.\d+)?\s*[kKmM]?)?)"),
            (18, r"base pay range[^\d$]{0,120}(\$?\s*[\d,]+(?:\.\d+)?\s*[kKmM]?(?:\s*(?:-|–|—|to)\s*\$?\s*[\d,]+(?:\.\d+)?\s*[kKmM]?)?)"),
            (17, r"Compensation Range:\s*(?:USD\s*)?(\$\s*[\d,]+(?:\.\d+)?\s*(?:-|–|—|to)\s*(?:USD\s*)?\$\s*[\d,]+(?:\.\d+)?(?:\s*/\s*(?:annually|annual|yr|year))?)"),
            (16, r"Compensation Range:\s*(\$?\s*[\d,]+(?:\.\d+)?\s*[kKmM]?(?:\s*(?:-|–|—|to)\s*\$?\s*[\d,]+(?:\.\d+)?\s*[kKmM]?)?)"),
            (15, r"estimated annual pay range[^\d]{0,80}(\$?\s*[\d,]+(?:\.\d+)?\s*[kKmM]?(?:\s*(?:-|–|—|to)\s*\$?\s*[\d,]+(?:\.\d+)?\s*[kKmM]?)?)"),
            (15, r"annual pay range[^\d]{0,80}(\$?\s*[\d,]+(?:\.\d+)?\s*[kKmM]?(?:\s*(?:-|–|—|to)\s*\$?\s*[\d,]+(?:\.\d+)?\s*[kKmM]?)?)"),
            (15, r"pay range for this position[^\d]{0,80}(\$?\s*[\d,]+(?:\.\d+)?\s*[kKmM]?(?:\s*(?:-|–|—|to)\s*\$?\s*[\d,]+(?:\.\d+)?\s*[kKmM]?)?)"),
            (14, r"salary range[^\d]{0,80}(\$?\s*[\d,]+(?:\.\d+)?\s*[kKmM]?(?:\s*(?:-|–|—|to)\s*\$?\s*[\d,]+(?:\.\d+)?\s*[kKmM]?)?)\s*(?:usd\s*)?(?:annual|annually|per year|/year|/yr)?"),
            (12, r"compensation[^\d]{0,80}(\$?\s*[\d,]+(?:\.\d+)?\s*[kKmM]?(?:\s*(?:-|–|—|to)\s*\$?\s*[\d,]+(?:\.\d+)?\s*[kKmM]?)?)"),
            (2, r"equity[:\s]+(\$?\s*[\d,]+(?:\.\d+)?\s*[kKmM]?(?:\s*(?:-|–|—|to)\s*\$?\s*[\d,]+(?:\.\d+)?\s*[kKmM]?)?)"),
        ]

        hourly_patterns = [
            (18, r"pay rate[:\s]+(\$?\s*[\d,]+(?:\.\d+)?\s*(?:-|–|—|to)\s*\$?\s*[\d,]+(?:\.\d+)?\s*/\s*(?:hr|hour))"),
            (18, r"pay rate[:\s]+(\$?\s*[\d,]+(?:\.\d+)?\s*/\s*(?:hr|hour)\s*(?:-|–|—|to)\s*\$?\s*[\d,]+(?:\.\d+)?\s*/\s*(?:hr|hour))"),
            (16, r"compensation range[:\s]+(\$?\s*[\d,]+(?:\.\d+)?\s*(?:-|–|—|to)\s*\$?\s*[\d,]+(?:\.\d+)?\s*/\s*(?:hr|hour))"),
            (16, r"compensation range[:\s]+(\$?\s*[\d,]+(?:\.\d+)?\s*/\s*(?:hr|hour)\s*(?:-|–|—|to)\s*\$?\s*[\d,]+(?:\.\d+)?\s*/\s*(?:hr|hour))"),
            (14, r"(\$?\s*[\d,]+(?:\.\d+)?\s*(?:-|–|—|to)\s*\$?\s*[\d,]+(?:\.\d+)?\s*/\s*(?:hr|hour))"),
            (14, r"(\$?\s*[\d,]+(?:\.\d+)?\s*/\s*(?:hr|hour)\s*(?:-|–|—|to)\s*\$?\s*[\d,]+(?:\.\d+)?\s*/\s*(?:hr|hour))"),
        ]

        annual_generic_patterns = [
            (17, r"(\$\s*[\d,]+(?:\.\d+)?\s*/\s*(?:yr|year|annually|annual)\s*(?:-|–|—|to)\s*\$\s*[\d,]+(?:\.\d+)?\s*/\s*(?:yr|year|annually|annual))"),
        ]

        for content in search_spaces:
            flags = re.IGNORECASE | re.S if content is html else re.IGNORECASE
            for base_score, pattern in hourly_patterns:
                for match in re.finditer(pattern, content, flags=flags):
                    add_candidate(base_score, match.group(1), match.group(0), True)
            for base_score, pattern in annual_generic_patterns:
                for match in re.finditer(pattern, content, flags=flags):
                    add_candidate(base_score, match.group(1), match.group(0), False)
            for base_score, pattern in annual_patterns:
                for match in re.finditer(pattern, content, flags=flags):
                    add_candidate(base_score, match.group(1), match.group(0), False)

        for _, salary_text, context, hourly in sorted(candidates, key=lambda item: item[0], reverse=True):
            normalized = self._normalize_salary_value(salary_text, context, hourly=hourly)
            if not normalized:
                continue
            value = int(normalized.replace('$', '').replace(',', ''))
            if 25_000 <= value <= 1_000_000:
                return normalized

        return None

    def _estimate_posted_timestamp(self, posted_text: str, posted_date: str | None) -> str | None:
        if not posted_text:
            return None

        now = datetime.now(timezone.utc)
        text = self.normalize_text(posted_text)
        base_date = None
        if posted_date:
            try:
                base_date = datetime.strptime(posted_date, "%Y-%m-%d").replace(tzinfo=timezone.utc)
            except ValueError:
                base_date = None

        minute_match = re.search(r"(\d+)\s+minute", text)
        hour_match = re.search(r"(\d+)\s+hour", text)
        day_match = re.search(r"(\d+)\s+day", text)
        week_match = re.search(r"(\d+)\s+week", text)

        if minute_match:
            dt = now - timedelta(minutes=int(minute_match.group(1)))
            return dt.replace(second=0, microsecond=0).isoformat()
        if hour_match:
            dt = now - timedelta(hours=int(hour_match.group(1)))
            return dt.replace(minute=0, second=0, microsecond=0).isoformat()
        if day_match:
            days = int(day_match.group(1))
            if base_date:
                dt = base_date + timedelta(hours=12)
            else:
                dt = now - timedelta(days=days)
            return dt.replace(minute=0, second=0, microsecond=0).isoformat()
        if week_match:
            weeks = int(week_match.group(1))
            if base_date:
                dt = base_date + timedelta(hours=12)
            else:
                dt = now - timedelta(weeks=weeks)
            return dt.replace(minute=0, second=0, microsecond=0).isoformat()
        if "today" in text:
            return now.replace(minute=0, second=0, microsecond=0).isoformat()
        if "yesterday" in text:
            dt = now - timedelta(days=1)
            return dt.replace(hour=12, minute=0, second=0, microsecond=0).isoformat()
        if base_date:
            return (base_date + timedelta(hours=12)).replace(minute=0, second=0, microsecond=0).isoformat()
        return None

    def _extract_exact_applicant_count(self, page) -> int | None:
        selectors = [
            ".num-applicants__caption",
            ".num-applicants__caption.topcard__flavor--metadata",
            ".topcard__flavor--metadata",
        ]

        for selector in selectors:
            try:
                locators = page.locator(selector)
                count = locators.count()
                for idx in range(count):
                    locator = locators.nth(idx)
                    try:
                        text = locator.inner_text().strip()
                        if not text:
                            continue
                        if "over" in text.lower() or "first" in text.lower():
                            continue
                        match = re.search(r"\b(\d{1,3}(?:,\d{3})*)\s+applicants\b", text, flags=re.IGNORECASE)
                        if match:
                            return int(match.group(1).replace(",", ""))
                    except Exception:
                        continue
            except Exception:
                continue

        return None

    def export_public_jobs(self, matched_jobs: list[JobPosting]) -> None:
        self.public_data_dir.mkdir(parents=True, exist_ok=True)
        public_jobs: list[dict[str, Any]] = []
        for job in matched_jobs:
            public_jobs.append(
                {
                    "id": f"{job.source}:{job.job_id}" if job.job_id else job.linkedin_url,
                    "source": job.source,
                    "job_id": job.job_id,
                    "title": job.title,
                    "company": job.company,
                    "location": job.location,
                    "linkedin_url": job.linkedin_url,
                    "posted_text": job.posted_text,
                    "posted_date": job.posted_date,
                    "posted_timestamp_estimate": job.posted_timestamp_estimate,
                    "workplace_type": job.workplace_type,
                    "application_type": job.application_type,
                    "salary": job.salary,
                    "applicant_count": job.applicant_count,
                    "description": job.description,
                    "search_term": job.search_term,
                    "score": job.score,
                    "matched_positive_terms": job.matched_positive_terms or [],
                    "matched_negative_terms": job.matched_negative_terms or [],
                    "linkedin_saved": job.linkedin_saved,
                    "location_signal": job.location_signal,
                }
            )
        self.public_matched_jobs_json.write_text(json.dumps(public_jobs, indent=2))

    def save_jobs(self, raw_jobs: list[JobPosting], matched_jobs: list[JobPosting]) -> None:
        self.raw_jobs_json.parent.mkdir(parents=True, exist_ok=True)
        self.matched_jobs_json.parent.mkdir(parents=True, exist_ok=True)

        self.raw_jobs_json.write_text(json.dumps([asdict(job) for job in raw_jobs], indent=2))
        self.matched_jobs_json.write_text(json.dumps([asdict(job) for job in matched_jobs], indent=2))
        self.export_public_jobs(matched_jobs)

        with self.matched_jobs_csv.open("w", newline="") as f:
            fieldnames = [
                "source",
                "title",
                "company",
                "location",
                "linkedin_url",
                "posted_text",
                "posted_date",
                "posted_timestamp_estimate",
                "workplace_type",
                "application_type",
                "salary",
                "search_term",
                "score",
                "matched_positive_terms",
                "matched_negative_terms",
                "accepted",
                "rejection_reason",
            ]
            writer = csv.DictWriter(f, fieldnames=fieldnames)
            writer.writeheader()
            for job in matched_jobs:
                row = asdict(job)
                row["matched_positive_terms"] = ", ".join(job.matched_positive_terms or [])
                row["matched_negative_terms"] = ", ".join(job.matched_negative_terms or [])
                writer.writerow({key: row.get(key) for key in fieldnames})

    def save_top_jobs_on_linkedin(self, page, jobs: list[JobPosting]) -> None:
        if not self.config["linkedin"].get("auto_save_matched_jobs", False):
            return

        top_n = int(self.config["linkedin"].get("auto_save_top_n", 0))
        if top_n <= 0:
            return

        jobs_to_save = sorted(jobs, key=lambda job: job.score, reverse=True)[:top_n]

        for save_idx, job in enumerate(jobs_to_save):
            try:
                if not job.job_id:
                    job.linkedin_saved = False
                    continue

                search_term = quote(job.search_term)
                geo_id = self.config["linkedin"].get("geo_id")
                distance = self.config["linkedin"].get("distance", 50)
                time_range_seconds = self.config["linkedin"].get("time_range_seconds", 86400)
                jobs_url = (
                    "https://www.linkedin.com/jobs/search/"
                    f"?keywords={search_term}"
                    f"&geoId={geo_id}"
                    f"&distance={distance}"
                    f"&f_TPR=r{time_range_seconds}"
                )
                page.goto(jobs_url, wait_until="domcontentloaded")
                page.wait_for_timeout(3000)

                job_link_selectors = [
                    f"a[href*='/jobs/view/{job.job_id}']",
                    f"a[href*='currentJobId={job.job_id}']",
                ]

                opened = False
                for selector in job_link_selectors:
                    try:
                        locators = page.locator(selector)
                        count = locators.count()
                        for idx in range(count):
                            locator = locators.nth(idx)
                            try:
                                if not locator.is_visible(timeout=1000):
                                    continue
                                locator.click(timeout=5000)
                                page.wait_for_timeout(3000)
                                opened = True
                                break
                            except Exception:
                                continue
                        if opened:
                            break
                    except Exception:
                        continue

                member_save_scopes = [
                    ".jobs-search-results-list",
                    ".jobs-search-results",
                    ".job-card-container",
                    ".jobs-details",
                    "main"
                ]
                save_selectors = [
                    "button.jobs-save-button",
                    "button[aria-label*='Save']",
                    "button[data-control-name*='save']",
                    "[role='button'][aria-label*='Save']",
                    "button:has-text('Save')"
                ]

                saved = False
                for scope_selector in member_save_scopes:
                    try:
                        scopes = page.locator(scope_selector)
                        scope_count = scopes.count()
                        for scope_idx in range(scope_count):
                            scope = scopes.nth(scope_idx)
                            try:
                                if not scope.is_visible(timeout=1000):
                                    continue
                            except Exception:
                                continue

                            for selector in save_selectors:
                                try:
                                    locators = scope.locator(selector)
                                    count = locators.count()
                                    for idx in range(count):
                                        locator = locators.nth(idx)
                                        try:
                                            if not locator.is_visible(timeout=1000):
                                                continue
                                            outer = (locator.evaluate("el => el.outerHTML") or "").lower()
                                            if "data-test-redirect-save-to-login" in outer or "public_jobs_topcard-save-job" in outer:
                                                continue

                                            button_text = (locator.inner_text() or "").strip().lower()
                                            aria_label = (locator.get_attribute("aria-label") or "").lower()
                                            class_name = (locator.get_attribute("class") or "").lower()

                                            if "saved" in button_text or "unsave" in button_text or "saved" in aria_label or "unsave" in aria_label:
                                                job.linkedin_saved = True
                                                saved = True
                                                break

                                            locator.click(timeout=5000)
                                            page.wait_for_timeout(2000)

                                            post_click_text = (locator.inner_text() or "").strip().lower()
                                            post_click_aria = (locator.get_attribute("aria-label") or "").lower()
                                            post_click_class = (locator.get_attribute("class") or "").lower()
                                            if (
                                                "saved" in post_click_text or "unsave" in post_click_text
                                                or "saved" in post_click_aria or "unsave" in post_click_aria
                                                or "saved" in post_click_class
                                            ):
                                                job.linkedin_saved = True
                                                saved = True
                                                break
                                        except Exception:
                                            continue
                                    if saved:
                                        break
                                except Exception:
                                    continue
                            if saved:
                                break
                    except Exception:
                        continue
                    if saved:
                        break

                if self.debug.get("enabled", False):
                    self._save_screenshot(page, f"04_save_attempt_{save_idx}")
                    self._save_html(page, f"04_save_attempt_{save_idx}")
            except Exception:
                job.linkedin_saved = False

    def run(self) -> None:
        run_started_at = time.perf_counter()
        use_persistent_seen_jobs = bool(self.storage.get("use_persistent_seen_jobs", False))
        seen_jobs = self.load_seen_jobs() if use_persistent_seen_jobs else set()
        current_run_seen: set[str] = set()
        raw_jobs: list[JobPosting] = []
        matched_jobs: list[JobPosting] = []

        with sync_playwright() as p:
            use_persistent_profile = bool(self.config["linkedin"].get("use_persistent_profile", False))
            if use_persistent_profile:
                self.profile_dir.mkdir(parents=True, exist_ok=True)
                context = p.chromium.launch_persistent_context(
                    user_data_dir=str(self.profile_dir),
                    channel="chrome",
                    headless=bool(self.config["linkedin"].get("headless", True)),
                    slow_mo=int(self.config["linkedin"].get("slow_mo_ms", 0)),
                    args=[f"--profile-directory={self.profile_name}"],
                )
                page = context.pages[0] if context.pages else context.new_page()
            else:
                browser = p.chromium.launch(
                    headless=bool(self.config["linkedin"].get("headless", True)),
                    slow_mo=int(self.config["linkedin"].get("slow_mo_ms", 0)),
                )
                context = browser.new_context()
                page = context.new_page()
            self.login(page)

            combined_seen = set(seen_jobs)
            for search_term in self.config["search_terms"]:
                for posting in self.scrape_search_term(page, search_term, combined_seen):
                    dedupe_key = posting.job_id or posting.linkedin_url
                    if dedupe_key in seen_jobs or dedupe_key in current_run_seen:
                        continue
                    raw_jobs.append(posting)
                    scored = self.score_posting(posting)
                    current_run_seen.add(dedupe_key)
                    combined_seen.add(dedupe_key)
                    if scored.accepted:
                        matched_jobs.append(scored)

            seen_jobs.update(current_run_seen)

            self.save_top_jobs_on_linkedin(page, matched_jobs)
            context.close()

        if use_persistent_seen_jobs:
            self.save_seen_jobs(seen_jobs)
        self.save_jobs(raw_jobs, matched_jobs)
        total_duration = time.perf_counter() - run_started_at
        print(f"Collected {len(raw_jobs)} raw jobs")
        print(f"Saved {len(matched_jobs)} matched jobs")
        print(f"Total runtime: {total_duration:.2f}s")


if __name__ == "__main__":
    JobChecker().run()
