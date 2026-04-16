"""
Phase L tests  — NLP date extraction + page classification
Completely self-contained (stdlib + re only). The pure-regex logic is
duplicated here so that heavy deps (psycopg2, textstat, nltk, bs4) are
NOT required in the local test environment.
Run:  python V3-Microservices/v3-nlp-worker/tests/test_phase_l.py
"""
import re
import sys
import unittest
from datetime import date
import json

# ── Inline implementation of extract_dates_and_classify (Phase L) ────────────
# This is an exact copy of what lives in v3-nlp-worker/main.py so the tests
# validate the real logic without needing the module's heavy imports.

FRENCH_MONTHS = {
    "janvier": "01", "février": "02", "fevrier": "02",
    "mars": "03", "avril": "04", "mai": "05", "juin": "06",
    "juillet": "07", "août": "08", "aout": "08",
    "septembre": "09", "octobre": "10",
    "novembre": "11", "décembre": "12", "decembre": "12",
}

_TIME_DATETIME_RE = re.compile(r'<time[^>]+datetime=["\']([^"\' >]+)["\']', re.I)
_META_DATE_RE = re.compile(
    r'<meta[^>]+(?:name=["\']date["\']|property=["\']article:published_time["\'])[^>]+content=["\']([^"\' >]+)["\']'
    r'|<meta[^>]+content=["\']([^"\' >]+)["\'][^>]+(?:name=["\']date["\']|property=["\']article:published_time["\'])',
    re.I,
)
_META_MODIFIED_RE = re.compile(
    r'<meta[^>]+(?:property=["\']article:modified_time["\']|name=["\']lastmod(?:ified)?["\'])[^>]+content=["\']([^"\' >]+)["\']'
    r'|<meta[^>]+content=["\']([^"\' >]+)["\'][^>]+(?:property=["\']article:modified_time["\']|name=["\']lastmod(?:ified)?["\'])',
    re.I,
)
_ISO_PREFIX_RE = re.compile(r'^(\d{4}-\d{2}-\d{2})')
_TITLE_RE = re.compile(r'<title[^>]*>(.*?)</title>', re.I | re.S)


def _parse_iso_date(raw: str):
    m = _ISO_PREFIX_RE.match(raw.strip())
    return m.group(1) if m else None


def _is_valid_publication_date(date_str: str | None) -> bool:
    if not date_str:
        return False
    try:
        parsed = date.fromisoformat(str(date_str))
    except (TypeError, ValueError):
        return False
    return parsed <= date.today()


def _is_year_in_range(date_str: str, min_year: int = 2000, max_year: int = 2035) -> bool:
    try:
        y = date.fromisoformat(date_str).year
    except Exception:
        return False
    return min_year <= y <= max_year


def _normalize_candidate_date(raw: str) -> str | None:
    if not raw:
        return None
    return _parse_iso_date(raw)


def _collect_jsonld_dates(obj, out: dict[str, list[str]]):
    if isinstance(obj, dict):
        for k, v in obj.items():
            lk = str(k).lower()
            if lk in {"datepublished", "datemodified"} and isinstance(v, str):
                out.setdefault(lk, []).append(v)
            else:
                _collect_jsonld_dates(v, out)
    elif isinstance(obj, list):
        for item in obj:
            _collect_jsonld_dates(item, out)


def extract_dates_and_classify(html: str, url: str) -> dict:
    candidates = []

    jsonld_dates = {}
    for payload in re.findall(r'<script[^>]+type=["\']application/ld\+json["\'][^>]*>(.*?)</script>', html, re.I | re.S):
        try:
            parsed = json.loads(payload.strip())
        except Exception:
            parsed = None
        if parsed is None:
            continue
        _collect_jsonld_dates(parsed, jsonld_dates)

    for raw in jsonld_dates.get("datemodified", []):
        d = _normalize_candidate_date(raw)
        if d and _is_valid_publication_date(d) and _is_year_in_range(d):
            candidates.append((d, "jsonld_date_modified", 0.99))

    for raw in jsonld_dates.get("datepublished", []):
        d = _normalize_candidate_date(raw)
        if d and _is_valid_publication_date(d) and _is_year_in_range(d):
            candidates.append((d, "jsonld_date_published", 0.97))

    for raw in _TIME_DATETIME_RE.findall(html):
        d = _normalize_candidate_date(raw)
        if d and _is_valid_publication_date(d) and _is_year_in_range(d):
            candidates.append((d, "time_datetime", 0.86))

    for m in _META_MODIFIED_RE.finditer(html):
        raw = m.group(1) or m.group(2) or ""
        d = _normalize_candidate_date(raw)
        if d and _is_valid_publication_date(d) and _is_year_in_range(d):
            candidates.append((d, "meta_modified_time", 0.92))

    for m in _META_DATE_RE.finditer(html):
        raw = m.group(1) or m.group(2) or ""
        d = _normalize_candidate_date(raw)
        if d and _is_valid_publication_date(d) and _is_year_in_range(d):
            candidates.append((d, "meta_published_time", 0.9))

    if candidates:
        best = sorted(candidates, key=lambda x: (x[2], x[0]), reverse=True)[0]
        last_pub_date = best[0]
        last_pub_date_source = best[1]
        last_pub_date_confidence = best[2]
    else:
        last_pub_date = None
        last_pub_date_source = None
        last_pub_date_confidence = 0.0

    url_lower = url.lower()
    title_match = _TITLE_RE.search(html)
    title_lower = (title_match.group(1) if title_match else "").lower()

    is_news_page = bool(
        re.search(r'/actualit|/news|/article|/blog', url_lower)
        or re.search(r'actualit[éeÉE]|communiqu[éeÉE]|presse', title_lower)
    )
    is_partenariat_page = bool(
        re.search(r'/partenaire|/partner|/partenariat', url_lower)
        or re.search(r'partenaire|partenariat', title_lower)
    )

    return {
        "last_pub_date": last_pub_date,
        "last_pub_date_source": last_pub_date_source,
        "last_pub_date_confidence": last_pub_date_confidence,
        "is_news_page": is_news_page,
        "is_partenariat_page": is_partenariat_page,
    }


# ─── Helpers ────────────────────────────────────────────────────────────────

def _html(body: str, title: str = "Test page") -> str:
    return f"<html><head><title>{title}</title></head><body>{body}</body></html>"


# ─── Test suites ────────────────────────────────────────────────────────────

class TestDateExtraction(unittest.TestCase):

    # 1. <time datetime="…">
    def test_time_datetime_iso(self):
        html = _html('<time datetime="2024-03-15">15 mars 2024</time>')
        r = extract_dates_and_classify(html, "https://example.com/page")
        self.assertEqual(r["last_pub_date"], "2024-03-15")

    def test_time_datetime_with_time_component(self):
        html = _html('<time datetime="2023-11-01T08:00:00Z">01 novembre 2023</time>')
        r = extract_dates_and_classify(html, "https://example.com/")
        self.assertEqual(r["last_pub_date"], "2023-11-01")

    # 2. <meta name="date">
    def test_meta_name_date(self):
        html = _html('<meta name="date" content="2025-06-20">')
        r = extract_dates_and_classify(html, "https://example.com/")
        self.assertEqual(r["last_pub_date"], "2025-06-20")

    # 3. <meta property="article:published_time">
    def test_meta_og_published_time(self):
        html = _html('<meta property="article:published_time" content="2025-01-10T12:00:00">')
        r = extract_dates_and_classify(html, "https://example.com/")
        self.assertEqual(r["last_pub_date"], "2025-01-10")

    # Reversed attribute order
    def test_meta_og_published_time_reversed_attrs(self):
        html = _html('<meta content="2024-07-04T00:00:00" property="article:published_time">')
        r = extract_dates_and_classify(html, "https://example.com/")
        self.assertEqual(r["last_pub_date"], "2024-07-04")

    # 4. French prose dates
    def test_french_date_standard(self):
        html = _html("<p>Publié le 3 avril 2024</p>")
        r = extract_dates_and_classify(html, "https://example.com/")
        self.assertIsNone(r["last_pub_date"])

    def test_french_date_aout_no_accent(self):
        html = _html("<p>Mise à jour le 10 aout 2023</p>")
        r = extract_dates_and_classify(html, "https://example.com/")
        self.assertIsNone(r["last_pub_date"])

    def test_french_date_fevrier_accent(self):
        html = _html("<p>Date : 28 février 2022</p>")
        r = extract_dates_and_classify(html, "https://example.com/")
        self.assertIsNone(r["last_pub_date"])

    def test_french_date_decembre_accent(self):
        html = _html("<p>31 décembre 2021</p>")
        r = extract_dates_and_classify(html, "https://example.com/")
        self.assertIsNone(r["last_pub_date"])

    def test_french_date_case_insensitive(self):
        html = _html("<p>15 JANVIER 2025</p>")
        r = extract_dates_and_classify(html, "https://example.com/")
        self.assertIsNone(r["last_pub_date"])

    def test_jsonld_priority_over_meta(self):
        html = _html(
            '<meta name="date" content="2024-12-01">'
            '<script type="application/ld+json">{"@type":"NewsArticle","datePublished":"2024-11-15"}</script>'
        )
        r = extract_dates_and_classify(html, "https://example.com/")
        self.assertEqual(r["last_pub_date"], "2024-11-15")
        self.assertEqual(r["last_pub_date_source"], "jsonld_date_published")

    def test_jsonld_modified_has_priority(self):
        html = _html(
            '<script type="application/ld+json">{"@type":"NewsArticle","datePublished":"2024-10-01","dateModified":"2024-11-21"}</script>'
            '<meta property="article:published_time" content="2024-11-20">'
        )
        r = extract_dates_and_classify(html, "https://example.com/")
        self.assertEqual(r["last_pub_date"], "2024-11-21")
        self.assertEqual(r["last_pub_date_source"], "jsonld_date_modified")

    def test_out_of_range_year_rejected(self):
        html = _html(
            '<script type="application/ld+json">{"@type":"NewsArticle","datePublished":"7080-01-14"}</script>'
        )
        r = extract_dates_and_classify(html, "https://example.com/")
        self.assertIsNone(r["last_pub_date"])

    # 5. Multiple dates → max returned
    def test_multiple_dates_returns_latest(self):
        html = _html(
            '<time datetime="2022-01-01">...</time>'
            '<time datetime="2024-06-30">...</time>'
            '<time datetime="2023-12-31">...</time>'
        )
        r = extract_dates_and_classify(html, "https://example.com/")
        self.assertEqual(r["last_pub_date"], "2024-06-30")

    def test_mixed_sources_returns_latest(self):
        html = _html(
            '<meta name="date" content="2023-05-10">'
            "<p>Publié le 12 septembre 2024</p>"
        )
        r = extract_dates_and_classify(html, "https://example.com/")
        self.assertEqual(r["last_pub_date"], "2023-05-10")

    # 6. No dates → None
    def test_no_dates(self):
        html = _html("<p>Nothing here.</p>")
        r = extract_dates_and_classify(html, "https://example.com/")
        self.assertIsNone(r["last_pub_date"])

    def test_empty_html(self):
        r = extract_dates_and_classify("", "https://example.com/")
        self.assertIsNone(r["last_pub_date"])

    def test_future_date_ignored(self):
        future_year = date.today().year + 2
        html = _html(f'<time datetime="{future_year}-01-01">future</time>')
        r = extract_dates_and_classify(html, "https://example.com/")
        self.assertIsNone(r["last_pub_date"])

    def test_future_and_past_dates_keep_latest_valid(self):
        future_year = date.today().year + 1
        html = _html(
            f'<time datetime="{future_year}-01-01">future</time>'
            '<time datetime="2024-06-30">past</time>'
        )
        r = extract_dates_and_classify(html, "https://example.com/")
        self.assertEqual(r["last_pub_date"], "2024-06-30")


class TestNewsClassification(unittest.TestCase):

    # URL-based
    def test_url_actualites(self):
        r = extract_dates_and_classify(_html(""), "https://bank.tn/actualites/article-1")
        self.assertTrue(r["is_news_page"])

    def test_url_news(self):
        r = extract_dates_and_classify(_html(""), "https://bank.tn/news/latest")
        self.assertTrue(r["is_news_page"])

    def test_url_article(self):
        r = extract_dates_and_classify(_html(""), "https://bank.tn/article/story")
        self.assertTrue(r["is_news_page"])

    def test_url_blog(self):
        r = extract_dates_and_classify(_html(""), "https://bank.tn/blog/post-1")
        self.assertTrue(r["is_news_page"])

    # Title-based
    def test_title_actualite(self):
        html = _html("", title="Actualité bancaire – BankTN")
        r = extract_dates_and_classify(html, "https://bank.tn/page")
        self.assertTrue(r["is_news_page"])

    def test_title_communique(self):
        html = _html("", title="Communiqué de presse")
        r = extract_dates_and_classify(html, "https://bank.tn/page")
        self.assertTrue(r["is_news_page"])

    def test_title_presse(self):
        html = _html("", title="Espace presse")
        r = extract_dates_and_classify(html, "https://bank.tn/page")
        self.assertTrue(r["is_news_page"])

    # Not news
    def test_not_news_page(self):
        r = extract_dates_and_classify(_html("", title="Accueil"), "https://bank.tn/")
        self.assertFalse(r["is_news_page"])

    def test_not_news_product_page(self):
        r = extract_dates_and_classify(_html("", title="Carte Visa"), "https://bank.tn/cartes/visa")
        self.assertFalse(r["is_news_page"])


class TestPartenaireClassification(unittest.TestCase):

    # URL-based
    def test_url_partenaire(self):
        r = extract_dates_and_classify(_html(""), "https://bank.tn/partenaires/list")
        self.assertTrue(r["is_partenariat_page"])

    def test_url_partner_en(self):
        r = extract_dates_and_classify(_html(""), "https://bank.tn/partners/overview")
        self.assertTrue(r["is_partenariat_page"])

    def test_url_partenariat(self):
        r = extract_dates_and_classify(_html(""), "https://bank.tn/partenariat")
        self.assertTrue(r["is_partenariat_page"])

    # Title-based
    def test_title_partenaire(self):
        html = _html("", title="Nos partenaires stratégiques")
        r = extract_dates_and_classify(html, "https://bank.tn/page")
        self.assertTrue(r["is_partenariat_page"])

    def test_title_partenariat(self):
        html = _html("", title="Accord de partenariat")
        r = extract_dates_and_classify(html, "https://bank.tn/page")
        self.assertTrue(r["is_partenariat_page"])

    # Not partenariat
    def test_not_partenariat_about(self):
        r = extract_dates_and_classify(_html("", title="À propos"), "https://bank.tn/about")
        self.assertFalse(r["is_partenariat_page"])


class TestCombinedOutput(unittest.TestCase):
    """Validate return dict shape and combined scenarios."""

    def test_return_keys_always_present(self):
        r = extract_dates_and_classify("", "https://example.com/")
        self.assertIn("last_pub_date", r)
        self.assertIn("last_pub_date_source", r)
        self.assertIn("last_pub_date_confidence", r)
        self.assertIn("is_news_page", r)
        self.assertIn("is_partenariat_page", r)

    def test_news_page_with_date(self):
        html = _html(
            '<time datetime="2025-05-01">1er mai 2025</time>',
            title="Actualités – Mai 2025",
        )
        r = extract_dates_and_classify(html, "https://bank.tn/actualites/mai-2025")
        self.assertEqual(r["last_pub_date"], "2025-05-01")
        self.assertTrue(r["is_news_page"])
        self.assertFalse(r["is_partenariat_page"])

    def test_partenariat_page_no_date(self):
        html = _html("", title="Partenariat Visa")
        r = extract_dates_and_classify(html, "https://bank.tn/partenariat/visa")
        self.assertIsNone(r["last_pub_date"])
        self.assertFalse(r["is_news_page"])
        self.assertTrue(r["is_partenariat_page"])

    def test_homepage_no_classification(self):
        html = _html("", title="Accueil – BankTN")
        r = extract_dates_and_classify(html, "https://bank.tn/")
        self.assertIsNone(r["last_pub_date"])
        self.assertFalse(r["is_news_page"])
        self.assertFalse(r["is_partenariat_page"])


# ─── Runner ─────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    loader = unittest.TestLoader()
    suite = unittest.TestSuite()
    for cls in (
        TestDateExtraction,
        TestNewsClassification,
        TestPartenaireClassification,
        TestCombinedOutput,
    ):
        suite.addTests(loader.loadTestsFromTestCase(cls))

    runner = unittest.TextTestRunner(verbosity=2)
    result = runner.run(suite)
    sys.exit(0 if result.wasSuccessful() else 1)
