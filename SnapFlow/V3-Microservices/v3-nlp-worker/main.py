"""
v3-nlp-worker: NLP Content Analysis Service
Polls PostgreSQL for unprocessed pages, extracts text from HTML,
calculates readability scores, keyword density, and word counts.
"""
import os
import time
import json
import logging
import re
import unicodedata
import math
import hashlib
from collections import Counter
from functools import lru_cache
from datetime import date
from email.utils import parsedate_to_datetime
from urllib.parse import urlparse
from urllib.request import Request, urlopen

import psycopg2
import psycopg2.extras
import nltk
from nltk.corpus import stopwords
from nltk.stem.snowball import SnowballStemmer
from bs4 import BeautifulSoup
import textstat
from textstat.textstat import textstatistics
from page_queue import ClaimHeartbeat, claim_page, publish_page, release_page
from page_evidence import select_page_evidence
from content_passages import content_passages, rank_passages

try:
    import spacy
except Exception:  # pragma: no cover - optional dependency
    spacy = None

try:
    import language_tool_python
except Exception:  # pragma: no cover - optional dependency
    language_tool_python = None

try:
    from sentence_transformers import SentenceTransformer
except Exception:  # pragma: no cover - optional dependency
    SentenceTransformer = None

try:
    import json5
except Exception:  # pragma: no cover - optional dependency
    json5 = None

# Production images preload these resources. Avoid network probes on every
# worker import; local development only downloads genuinely missing data.
for resource, location in (("punkt", "tokenizers/punkt"), ("punkt_tab", "tokenizers/punkt_tab"), ("stopwords", "corpora/stopwords"), ("cmudict", "corpora/cmudict")):
    try:
        nltk.data.find(location)
    except LookupError:
        nltk.download(resource, quiet=True)

logging.basicConfig(level=logging.INFO, format="%(asctime)s [NLP] %(message)s")
logger = logging.getLogger(__name__)

# ─── Config ───────────────────────────────────────────────────────────────────
DB_HOST = os.getenv("DB_HOST", "localhost")
DB_PORT = os.getenv("DB_PORT", "5432")
DB_NAME = os.getenv("DB_NAME", "snapflow_v3")
DB_USER = os.getenv("DB_USER", "snapflow")
DB_PASS = os.getenv("DB_PASS", "snapflow")
POLL_INTERVAL = int(os.getenv("POLL_INTERVAL", "3"))  # seconds between DB polls
NLP_SEMANTIC_ENABLED = os.getenv("NLP_SEMANTIC_ENABLED", "false").lower() in {"1", "true", "yes", "on"}
NLP_SEMANTIC_MODEL = os.getenv(
    "NLP_SEMANTIC_MODEL",
    "sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2",
)
NLP_SEMANTIC_MAX_CHARS = int(os.getenv("NLP_SEMANTIC_MAX_CHARS", "6000"))
NLP_PASSAGE_RETRIEVAL_ENABLED = os.getenv("NLP_PASSAGE_RETRIEVAL_ENABLED", "false").lower() in {"1", "true", "yes", "on"}
NLP_PASSAGE_MAX_WINDOWS = max(1, int(os.getenv("NLP_PASSAGE_MAX_WINDOWS", "32")))

# French + English stopwords
STOP_WORDS = set()
try:
    STOP_WORDS = (
        set(stopwords.words("french"))
        | set(stopwords.words("english"))
        | set(stopwords.words("arabic"))
    )
except Exception:
    pass

try:
    STEM_FR = SnowballStemmer("french")
except Exception:
    STEM_FR = None

try:
    STEM_EN = SnowballStemmer("english")
except Exception:
    STEM_EN = None

SEMANTIC_NOISE_WORDS = {
    "plus", "tres", "très", "bien", "tout", "tous", "site", "accueil", "home",
    "nous", "vous", "page", "pages", "service", "services", "information",
    "actualite", "actualites", "news", "detail", "details", "projet", "projets",
}

MIN_DICT_FR_EN_AR = {
    "fr": {
        "banque", "credit", "compte", "service", "client", "contact", "produit", "offre", "tarif", "information",
        "actualite", "partenariat", "securite", "confidentialite", "donnees", "politique", "cookies", "mentions", "legales", "investisseur",
        "entreprise", "professionnel", "carriere", "emploi", "support", "agence", "simulateur", "assurance", "pret", "immobilier",
    },
    "en": {
        "bank", "credit", "account", "service", "customer", "contact", "product", "offer", "pricing", "information",
        "news", "partnership", "security", "privacy", "data", "policy", "cookies", "legal", "investor", "business",
        "career", "jobs", "support", "calculator", "insurance", "loan", "mortgage", "personal", "enterprise", "company",
    },
    "ar": {
        "بنك", "قرض", "حساب", "خدمة", "عميل", "اتصال", "منتج", "عرض", "معلومات", "أخبار",
        "شراكة", "أمان", "خصوصية", "بيانات", "سياسة", "ملفات", "تعريف", "مستثمر", "شركة", "مهني",
        "وظائف", "دعم", "تأمين", "تمويل", "عقار", "وكالة", "حاسبة", "اتفاقية", "حقوق", "حماية",
    },
}


# French month names → ISO month numbers (Phase L)
FRENCH_MONTHS = {
    "janvier": "01", "février": "02", "fevrier": "02",
    "mars": "03", "avril": "04", "mai": "05", "juin": "06",
    "juillet": "07", "août": "08", "aout": "08",
    "septembre": "09", "octobre": "10",
    "novembre": "11", "décembre": "12", "decembre": "12",
}

# Regexes (compiled once) for Phase L
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
_FRENCH_DATE_RE = re.compile(
    r'(\d{1,2})\s+(janvier|f[ée]vrier|mars|avril|mai|juin|juillet|ao[uû]t|septembre|octobre|novembre|d[eé]cembre)\s+(\d{4})',
    re.I,
)
_ISO_PREFIX_RE = re.compile(r'^(\d{4}-\d{2}-\d{2})')
_TITLE_RE = re.compile(r'<title[^>]*>(.*?)</title>', re.I | re.S)
_JSONLD_DATE_KEY_RE = re.compile(r"^(datePublished|dateModified)$", re.I)

# ─── Section 3.1: Page type classifier ───────────────────────────────────────
_FAQ_URL_RE = re.compile(r'/(faq|aide|help|questions|support)', re.I)
_ERROR_TEXT_RE = re.compile(r'(page introuvable|not found|404|403|500|erreur|error page)', re.I)
_PRODUCT_URL_RE = re.compile(r'/(produit|product|catalogue|shop|boutique|item)', re.I)
_PRICE_RE = re.compile(r'\d+[\.,]\d+\s*(TND|DT|DIN|\u20ac|\$|EUR)', re.I)

_TOKEN_RE = re.compile(r"[A-Za-zÀ-ÿ\u0600-\u06FF]{3,}")

_GENERIC_FNAME_RE = re.compile(r'^(img|image|photo|dsc|pic|untitled|screenshot|file)[-_]?\d*$', re.I)
_META_ROBOTS_RE = re.compile(r"robots", re.I)
_CONSENT_WIDGET_PATTERNS = re.compile(
    r'tarteaucitron|axeptio|cookiebot|onetrust|didomi|cookieconsent|cookie.{0,10}banner|cookie.{0,10}notice',
    re.I
)

FORMAL_MARKERS = [
    "conformement", "en vertu de", "ledit", "susmentionne", "alinea",
    "disposition", "aux termes de", "il est stipule", "nonobstant",
]

COMMERCIAL_MARKERS = [
    "profitez", "decouvrez", "offre exclusive", "maintenant", "gratuit",
    "cliquez ici", "ne manquez pas", "special", "promo", "offre limitee",
]

INTENT_SIGNALS = {
    "transactional": ["acheter", "souscrire", "ouvrir", "demander", "payer", "telecharger", "commander", "reserver"],
    "informational": ["qu'est-ce que", "comment", "pourquoi", "guide", "definition", "tutoriel", "explique", "savoir"],
    "navigational": ["accueil", "menu", "retour", "plan du site", "contactez-nous", "qui sommes-nous"],
}

CTA_PATTERNS_FR = [
    "contactez", "simulez", "telechargez", "demandez", "souscrire", "ouvrez",
    "decouvrez", "commandez", "reservez", "inscrivez", "profitez", "calculez",
]

CTA_PATTERNS_EN = [
    "contact us", "get started", "download", "subscribe", "open account",
    "apply now", "learn more", "sign up", "request a demo",
]

CTA_PATTERNS_AR = [
    "اتصل بنا", "اطلب عرض", "ابدأ الآن", "سجل الآن", "تواصل معنا", "احجز موعد",
    "اطلب الان", "تواصل", "قدم طلب", "اشترك",
]

CTA_B2B_SIGNALS = ["equipe entreprise", "solutions pro", "partenariat", "devis", "entreprise", "professionnel"]
CTA_B2C_SIGNALS = ["simulez", "ouvrez votre compte", "pour vous", "particulier", "famille", "personnel"]

DOMAIN_ENTITIES = {
    "attijaribank": ["APTBEF", "BCTM", "Bourse", "ATM", "Swift", "IBAN", "SEPA", "BCT"],
    "medianet": ["HAICA", "INTT", "Ministere", "Decret", "Convention"],
    "serept": ["STEG", "ETAP", "Ministere", "concession", "forage", "hydrocarbures"],
    "default": ["RGPD", "CNIL", "ISO", "IBAN", "TVA", "NIF"],
}

TOPIC_GLOSSARY = {
    "credit": ["taux", "emprunt", "remboursement", "garantie", "apport", "mensualite", "interet"],
    "assur": ["sinistre", "prime", "couverture", "police", "indemnisation", "franchise"],
    "invest": ["rendement", "dividende", "portefeuille", "action", "obligation", "bourse"],
    "epargn": ["placement", "livret", "depot", "terme", "capitalisation", "rendement"],
    "bank": ["virement", "prelevement", "solde", "releve", "iban", "swift", "agence"],
}

PAGE_TYPE_WORD_BENCHMARKS = {
    "landing": 150,
    "product": 300,
    "article": 600,
    "news": 500,
    "contact": 80,
    "faq": 400,
    "other": 200,
    "error": 0,
}

STUFFING_DENSITY_THRESHOLDS = {
    "product": 4.0,
    "news": 3.5,
    "article": 3.5,
    "faq": 5.0,
    "landing": 4.0,
    "contact": 6.0,
    "other": 4.0,
}

STUFFING_CONCENTRATION_THRESHOLDS = {
    "product": 0.60,
    "news": 0.65,
    "article": 0.65,
    "faq": 0.70,
    "landing": 0.60,
    "contact": 0.80,
    "other": 0.65,
}

COMPLETENESS_CHECKLIST = {
    "product": ["h1_present", "meta_present", "cta_count_gt_0", "word_count_gt_300", "schema_present", "price_mention"],
    "article": ["h1_present", "meta_present", "word_count_gt_600", "has_pub_date", "h2_count_gt_1"],
    "faq": ["h1_present", "meta_present", "question_density_gt_0", "schema_faq_present"],
    "landing": ["h1_present", "meta_present", "cta_count_gt_0", "og_image_present"],
    "other": ["h1_present", "meta_present"],
}

GDPR_RIGHTS_PATTERNS = {
    "access": r"droit.{0,15}acces|right.{0,10}access|حق الوصول",
    "rectification": r"rectification|correction des donn|right to correct",
    "erasure": r"effacement|oubli|droit.{0,10}suppr|erasure|right to be forgotten|حق المحو",
    "portability": r"portabilite|portability|transferer.{0,15}donn|حق النقل",
    "opposition": r"droit.{0,10}opposition|opt.out|s'oppos|right to object|حق الاعتراض",
    "restriction": r"restriction.{0,10}traitement|limitation|right to restrict|تقييد",
}

TRACKER_CATEGORIES = {
    "analytics": ["google-analytics.com", "googletagmanager.com", "hotjar.com", "matomo.org", "clarity.ms"],
    "advertising": ["facebook.net", "doubleclick.net", "googlesyndication.com", "adnxs.com"],
    "social": ["connect.facebook.net", "platform.twitter.com", "linkedin.com", "instagram.com"],
    "cdn": ["cdnjs.cloudflare.com", "fonts.googleapis.com", "ajax.googleapis.com"],
}

PRIVACY_SCORE_WEIGHTS = {
    "data_retention_mentioned": 15,
    "data_minimization_mentioned": 10,
    "rights_coverage_pct_normalized": 30,
    "dpo_completeness_normalized": 20,
    "purpose_of_processing": 15,
    "legal_basis_mentioned": 10,
}

_PURPOSE_RE = re.compile(
    r"(finalite.{0,30}traitement|purpose.{0,20}processing|objectif.{0,20}collecte|"
    r"a des fins de|utilisees? pour|traitement des donnees|purpose of processing)",
    re.I,
)
_LEGAL_BASIS_RE = re.compile(r"base.{0,15}legale|legal.{0,10}basis|consentement|obligation.{0,10}legale|interet.{0,10}legitime", re.I)

_llms_cache: dict[str, dict] = {}

_SPACY_NLP = None
_SPACY_LOAD_FAILED = False
_LT_FR = None
_LT_LOAD_FAILED = False
_LT_REMOTE_CLIENTS = {}
_SEMANTIC_MODEL = None
_SEMANTIC_LOAD_FAILED = False

ENTITY_PROTECTED_LABELS = {"PER", "PERSON", "ORG", "LOC", "GPE", "PRODUCT"}
TYPO_BRAND_WHITELIST = {
    "biat", "attijari", "attijaribank", "ooredoo", "tunisie", "orange", "tunisia",
}


def _is_valid_publication_date(date_str: str | None) -> bool:
    if not date_str:
        return False
    try:
        parsed = date.fromisoformat(str(date_str))
    except (TypeError, ValueError):
        return False
    return parsed <= date.today()


def _is_likely_french(text: str) -> bool:
    sample = (text or "")[:5000].lower()
    if not sample:
        return False
    french_markers = {
        " le ", " la ", " les ", " des ", " une ", " avec ", " pour ",
        " est ", " sur ", " dans ", " et ", " ou ", " que ",
    }
    marker_hits = sum(1 for m in french_markers if m in f" {sample} ")
    has_accents = bool(re.search(r"[àâäçéèêëîïôöùûüÿœæ]", sample))
    return has_accents or marker_hits >= 3


def _load_spacy_model():
    global _SPACY_NLP, _SPACY_LOAD_FAILED
    if _SPACY_NLP is not None or _SPACY_LOAD_FAILED:
        return _SPACY_NLP
    if spacy is None:
        _SPACY_LOAD_FAILED = True
        return None
    model_name = os.getenv("SPACY_FR_MODEL", "fr_core_news_sm")
    try:
        _SPACY_NLP = spacy.load(model_name, disable=["parser", "lemmatizer", "textcat"])
    except Exception as e:
        _SPACY_LOAD_FAILED = True
        _SPACY_NLP = None
        # [#16] Log spaCy failure explicitly — previously swallowed silently,
        # causing NER/typo-protection to degrade without any observability.
        logger.warning(
            f"spaCy model '{model_name}' failed to load: {e}. "
            "NER-based typo protection and entity detection are disabled for this worker."
        )
    return _SPACY_NLP


def _load_language_tool_fr():
    global _LT_FR, _LT_LOAD_FAILED
    if _LT_FR is not None or _LT_LOAD_FAILED:
        return _LT_FR
    if language_tool_python is None:
        _LT_LOAD_FAILED = True
        return None
    try:
        _LT_FR = language_tool_python.LanguageTool("fr", language_tool_download_version="6.8")
    except Exception as exc:
        _LT_LOAD_FAILED = True
        _LT_FR = None
        logger.warning("French LanguageTool failed to start: %s", exc)
    return _LT_FR


def _load_language_tool(language: str):
    server = os.getenv("LANGUAGETOOL_SERVER_URL", "").strip()
    if server:
        # Each client keeps an immutable language. Concurrent workers share the
        # Java server, never a mutable language setting or a local JVM.
        code = {"fr": "fr", "en": "en-US", "ar": "ar"}.get(language, "en-US")
        key = (server, code)
        if key not in _LT_REMOTE_CLIENTS:
            if language_tool_python is None:
                return None
            try:
                _LT_REMOTE_CLIENTS[key] = language_tool_python.LanguageTool(code, remote_server=server)
            except Exception as exc:
                logger.warning("LanguageTool remote initialization failed language=%s: %s", code, exc)
                return None  # Retry next page; do not permanently disable the provider.
        return _LT_REMOTE_CLIENTS[key]
    # Pages are processed sequentially: reuse one local JVM and its dictionaries
    # instead of creating a Java server for every supported language.
    tool = _load_language_tool_fr()
    if tool is not None:
        tool.language = {"fr": "fr", "en": "en-US", "ar": "ar"}.get(language, "en-US")
    return tool


def _load_semantic_model():
    global _SEMANTIC_MODEL, _SEMANTIC_LOAD_FAILED
    if not NLP_SEMANTIC_ENABLED:
        return None
    if _SEMANTIC_MODEL is not None or _SEMANTIC_LOAD_FAILED:
        return _SEMANTIC_MODEL
    if SentenceTransformer is None:
        _SEMANTIC_LOAD_FAILED = True
        logger.warning("Semantic enrichment disabled: sentence-transformers is not installed.")
        return None
    try:
        _SEMANTIC_MODEL = SentenceTransformer(NLP_SEMANTIC_MODEL)
        logger.info("Semantic enrichment model loaded: %s", NLP_SEMANTIC_MODEL)
    except Exception as e:
        _SEMANTIC_LOAD_FAILED = True
        _SEMANTIC_MODEL = None
        logger.warning(
            "Semantic enrichment model '%s' failed to load: %s. "
            "NLP worker will continue without semantic enrichment.",
            NLP_SEMANTIC_MODEL,
            e,
        )
    return _SEMANTIC_MODEL


def _vector_to_list(vector) -> list[float]:
    if hasattr(vector, "tolist"):
        vector = vector.tolist()
    if vector and isinstance(vector[0], list):
        vector = vector[0]
    return [float(value) for value in (vector or [])]


def _cosine_similarity(vector_a, vector_b) -> float | None:
    a = _vector_to_list(vector_a)
    b = _vector_to_list(vector_b)
    if not a or not b or len(a) != len(b):
        return None
    dot = sum(x * y for x, y in zip(a, b))
    norm_a = math.sqrt(sum(x * x for x in a))
    norm_b = math.sqrt(sum(y * y for y in b))
    if norm_a == 0 or norm_b == 0:
        return None
    return round(max(0.0, min(1.0, dot / (norm_a * norm_b))), 4)


def _semantic_pair_similarity(model, left: str, right: str) -> float | None:
    left = (left or "").strip()
    right = (right or "").strip()
    if not left or not right:
        return None
    embeddings = model.encode([left, right], convert_to_numpy=True)
    return _cosine_similarity(embeddings[0], embeddings[1])


def build_semantic_enrichment(title_text: str, meta_desc: str, h1_text: str, body_text: str) -> dict | None:
    """Return optional MiniLM semantic alignment signals without changing KPI logic."""
    if not NLP_SEMANTIC_ENABLED:
        return None

    started = time.monotonic()
    body = (body_text or "").strip()[:max(NLP_SEMANTIC_MAX_CHARS, 0)]
    result = {
        "enabled": True,
        "available": False,
        "model": NLP_SEMANTIC_MODEL,
        "title_body_similarity": None,
        "meta_body_similarity": None,
        "h1_body_similarity": None,
        "semantic_alignment_score": None,
        "text_chars_used": len(body),
        "elapsed_ms": 0,
    }

    if not body:
        result["reason"] = "insufficient_body_text"
        return result

    model = _load_semantic_model()
    if model is None:
        result["reason"] = "model_unavailable"
        result["elapsed_ms"] = int((time.monotonic() - started) * 1000)
        return result

    try:
        # One batch per page; body and repeated heading text are encoded once.
        # Keep the existing model, cosine semantics and result fields unchanged.
        encoding_body = body.strip()
        pairs = [("title_body_similarity", title_text),
                 ("meta_body_similarity", meta_desc),
                 ("h1_body_similarity", h1_text)]
        passages = []
        if NLP_PASSAGE_RETRIEVAL_ENABLED and any((value or '').strip() for _key, value in pairs):
            try:
                passages, coverage = content_passages((body_text or '').strip(), model.tokenizer,
                    model.max_seq_length, max_windows=NLP_PASSAGE_MAX_WINDOWS)
                result['passage_retrieval'] = dict(coverage, available=True,
                    source='extracted_content_text', normalization='strip',
                    text_sha256=hashlib.sha256((body_text or '').strip().encode('utf-8')).hexdigest(),
                    interpretation='topic relevance only; not factual support')
            except Exception as exc:
                result['passage_retrieval'] = dict(available=False, reason=type(exc).__name__)
        texts = []
        for _key, value in pairs:
            value = (value or "").strip()
            if value:
                for text in (value, encoding_body):
                    if text not in texts:
                        texts.append(text)
        for passage in passages:
            if passage['text'] not in texts:
                texts.append(passage['text'])
        if texts:
            embeddings = model.encode(texts, convert_to_numpy=True)
            vectors = dict(zip(texts, embeddings))
            for key, value in pairs:
                value = (value or "").strip()
                if value:
                    result[key] = _cosine_similarity(vectors[value], vectors[encoding_body])
            if passages:
                result['passage_retrieval']['matches'] = rank_passages(passages, pairs, vectors, _cosine_similarity)
        scores = [
            value
            for value in (
                result["title_body_similarity"],
                result["meta_body_similarity"],
                result["h1_body_similarity"],
            )
            if isinstance(value, (int, float))
        ]
        if scores:
            result["semantic_alignment_score"] = round(sum(scores) / len(scores) * 100)
        result["available"] = True
    except Exception as e:
        result["reason"] = f"inference_failed:{type(e).__name__}"
        logger.warning("Semantic enrichment inference failed: %s", e)
    finally:
        result["elapsed_ms"] = int((time.monotonic() - started) * 1000)

    return result


def _extract_protected_entity_tokens(text: str) -> set[str]:
    nlp = _load_spacy_model()
    if nlp is None:
        return set()
    protected = set()
    try:
        doc = nlp(text[:50000])
    except Exception:
        return protected
    for ent in getattr(doc, "ents", []):
        if str(getattr(ent, "label_", "")).upper() not in ENTITY_PROTECTED_LABELS:
            continue
        for token in _TOKEN_RE.findall(ent.text or ""):
            protected.add(token.lower())
    return protected


def _match_confidence(match) -> float:
    # language_tool_python does not expose a strict probability score.
    # Build a conservative confidence proxy from rule type + replacement quality.
    issue_type = str(getattr(match, "rule_issue_type", getattr(match, "ruleIssueType", "")) or "").lower()
    replacements = list(getattr(match, "replacements", []) or [])

    confidence = 0.65
    if issue_type in {"misspelling", "typographical"}:
        confidence += 0.25
    if replacements:
        confidence += 0.1
    if len(replacements) > 3:
        confidence += 0.05
    return min(confidence, 0.99)


def _is_grammar_or_spelling_issue(match) -> bool:
    issue_type = str(getattr(match, "rule_issue_type", getattr(match, "ruleIssueType", "")) or "").lower()
    category = str(getattr(match, "category", "") or "").lower()
    rule = getattr(match, "rule", None)
    if rule is not None:
        category = str(getattr(rule, "category", "") or "").lower()
    # Avoid style/typography noise on web copy.
    if issue_type in {"style", "typographical"} and "grammar" not in category:
        return False
    return issue_type in {"misspelling", "grammar", "typographical"} or "grammar" in category or "spell" in category


def _lt_text_blocks(text: str) -> list[str]:
    blocks = [b.strip() for b in re.split(r"\n+", text or "") if b.strip()]
    if not blocks:
        blocks = [text or ""]
    # Skip short snippets/slogans; they are too noisy for grammar checks.
    filtered = [b for b in blocks if len(_TOKEN_RE.findall(b)) >= 15]
    # Check every eligible paragraph. One HTTP call per paragraph is expensive
    # and the old 30-paragraph cap silently dropped late content. Preserve
    # paragraph boundaries while grouping requests below the server text limit.
    limit = 20000
    chunks, current = [], ""
    for paragraph in filtered:
        parts = []
        while len(paragraph) > limit:
            separators = list(re.finditer(r"\s+", paragraph[:limit + 1]))
            if not separators:
                # An overlong unbroken token cannot be split without inventing
                # spelling inputs. Let the provider report its explicit limit.
                break
            cut = separators[-1].start()
            parts.append(paragraph[:cut])
            paragraph = paragraph[separators[-1].end():]
        parts.append(paragraph)
        for part in parts:
            if current and len(current) + len(part) + 2 > limit:
                chunks.append(current)
                current = ""
            current = current + "\n\n" + part if current else part
    if current:
        chunks.append(current)
    return chunks


def _parse_json_like(payload: str):
    try:
        return json.loads(payload)
    except Exception:
        if json5 is not None:
            try:
                return json5.loads(payload)
            except Exception:
                return None
    return None


def _collect_jsonld_dates(obj, out: dict[str, list[str]]):
    if isinstance(obj, dict):
        for k, v in obj.items():
            if _JSONLD_DATE_KEY_RE.match(str(k)) and isinstance(v, str):
                out.setdefault(str(k).lower(), []).append(v)
            else:
                _collect_jsonld_dates(v, out)
    elif isinstance(obj, list):
        for item in obj:
            _collect_jsonld_dates(item, out)


def _normalize_candidate_date(raw: str) -> str | None:
    if not raw:
        return None
    iso = _parse_iso_date(raw)
    if iso:
        return iso
    try:
        parsed = parsedate_to_datetime(raw)
        if parsed:
            return parsed.date().isoformat()
    except Exception:
        return None
    return None


def _is_year_in_range(date_str: str, min_year: int = 2000, max_year: int = 2035) -> bool:
    try:
        y = date.fromisoformat(date_str).year
    except Exception:
        return False
    return min_year <= y <= max_year


def _head_last_modified_date(url: str) -> str | None:
    if not url:
        return None
    try:
        req = Request(url, method="HEAD", headers={"User-Agent": "SnapFlowBot/3.0"})
        with urlopen(req, timeout=4) as resp:
            value = resp.headers.get("Last-Modified", "")
            d = _normalize_candidate_date(value)
            if d and _is_valid_publication_date(d) and _is_year_in_range(d):
                return d
    except Exception:
        return None
    return None


def _stem_token(token: str) -> str:
    token = token.lower()
    candidates = []
    if STEM_FR:
        candidates.append(STEM_FR.stem(token))
    if STEM_EN:
        candidates.append(STEM_EN.stem(token))
    if candidates:
        return min(candidates, key=len)
    return token


def _detect_typo_density(text: str, language: str | None = None, _return_count: bool = False):
    tokens = [t.lower() for t in _TOKEN_RE.findall(text)]
    if not tokens:
        return (0.0, [], 0, False) if _return_count else (0.0, [])

    if language is None:
        arabic_chars = sum(1 for char in (text or "")[:500] if '\u0600' <= char <= '\u06ff')
        language = "ar" if arabic_chars / max(len((text or "")[:500]), 1) > .15 else "fr" if _is_likely_french(text) else "en"

    if language in {"fr", "en", "ar"}:
        protected_tokens = _extract_protected_entity_tokens(text) if language == "fr" else set()
        protected_tokens |= TYPO_BRAND_WHITELIST
        tool = _load_language_tool(language)
        # A tiny business vocabulary is not a spelling dictionary. Supported
        # languages use the actual language provider and retain sample errors.
        if tool is None:
            return (0.0, [], 0, False) if _return_count else (0.0, [])

        typo_candidates = []
        measured = False
        try:
            blocks = _lt_text_blocks(text)
            total_words = max(sum(len(_TOKEN_RE.findall(block)) for block in blocks), 1)
            measured = bool(blocks)
            for block in blocks:
                for match in tool.check(block):
                    if not _is_grammar_or_spelling_issue(match):
                        continue
                    error_length = getattr(match, "error_length", getattr(match, "errorLength", 0))
                    raw = block[match.offset: match.offset + error_length]
                    words = _TOKEN_RE.findall(raw)
                    if not words:
                        continue
                    token = words[0].lower()
                    if token in STOP_WORDS or token in protected_tokens:
                        continue
                    if _match_confidence(match) <= 0.8:
                        continue
                    typo_candidates.append(token)
            # Minimum density guard to avoid noisy isolated LT matches on long pages.
            if typo_candidates and (len(typo_candidates) / total_words) < 0.001:
                typo_candidates = []
        except Exception as exc:
            logger.warning("%s LanguageTool analysis failed: %s", language, exc)
            typo_candidates = []
            measured = False

        if typo_candidates:
            deduped = list(dict.fromkeys(typo_candidates))
            # Density counts erroneous occurrences; sample words are deduped.
            density = round(len(typo_candidates) / total_words, 4)
            return (density, deduped[:10], len(typo_candidates), measured) if _return_count else (density, deduped[:10])

        return (0.0, [], 0, measured) if _return_count else (0.0, [])

    return (0.0, [], 0, False) if _return_count else (0.0, [])


def classify_audience_segment(url: str, title: str, text: str, keyword_density: dict) -> dict:
    text_blob = f"{url} {title} {text[:1200]}".lower()
    signals = {
        "b2b": ["entreprise", "professionnel", "business", "corporate", "b2b"],
        "b2c": ["particulier", "personal", "consumer", "b2c", "famille"],
        "institutionnel": ["institution", "gouvernance", "rse", "compliance", "rapport annuel"],
        "carriere": ["carriere", "emploi", "recrutement", "job", "career"],
        "investisseur": ["investisseur", "investor", "actionnaire", "bourse", "financial results"],
    }

    scores = {k: 0 for k in signals}
    for seg, words in signals.items():
        for w in words:
            if w in text_blob:
                scores[seg] += 1

    for kw in (keyword_density or {}).keys():
        stem_kw = _stem_token(kw)
        if stem_kw in {"invest", "investisseur", "investor"}:
            scores["investisseur"] += 1
        if stem_kw in {"entrepris", "business", "corpor"}:
            scores["b2b"] += 1

    segment = max(scores, key=scores.get)
    score = scores[segment]
    if score >= 4:
        confidence = "high"
    elif score >= 2:
        confidence = "medium"
    elif score == 1:
        confidence = "low"
    else:
        return {"segment": "unknown", "confidence": "low", "signals": 0}

    return {"segment": segment, "confidence": confidence, "signals": score}


def _primary_schema_types(soup: BeautifulSoup, page_url: str) -> set[str]:
    """Use page entities, not types nested in cards, publishers or breadcrumbs."""
    from urllib.parse import urljoin, urldefrag
    page_identity = urldefrag(page_url)[0].rstrip("/")
    candidates = []
    for script in soup.find_all("script", attrs={"type": "application/ld+json"}):
        value = _parse_json_like(script.string or script.get_text())
        roots = value if isinstance(value, list) else [value]
        for root in roots:
            if isinstance(root, dict):
                graph = root.get("@graph")
                candidates.extend(graph if isinstance(graph, list) else [root])
    types = set()
    for candidate in candidates:
        if not isinstance(candidate, dict):
            continue
        identity = candidate.get("mainEntityOfPage") or candidate.get("url") or candidate.get("@id")
        if isinstance(identity, dict):
            identity = identity.get("@id") or identity.get("url")
        if isinstance(identity, str) and urldefrag(urljoin(page_url, identity))[0].rstrip("/") != page_identity:
            continue
        declared = candidate.get("@type", [])
        declared = declared if isinstance(declared, list) else [declared]
        types.update(str(item).rstrip("/").rsplit("/", 1)[-1].lower() for item in declared)
    return types


def classify_page_type(url: str, title: str, text: str, soup: BeautifulSoup | None = None, schema_types: list[str] | None = None) -> str:
    """Classify the current page's purpose before secondary widgets or copy."""
    path = (urlparse(url).path or "/").lower()
    title_lower = (title or "").lower()
    schema_norm = _primary_schema_types(soup, url) if soup is not None else {str(s).lower() for s in (schema_types or [])}
    if _ERROR_TEXT_RE.search(title_lower):
        return "error"
    declared = {category for category, names in {
        "product": {"product"}, "faq": {"faqpage"},
        "news": {"newsarticle", "article", "blogposting"}, "contact": {"contactpage"},
    }.items() if schema_norm & names}
    if len(declared) == 1:
        return declared.pop()

    # The host and query can mention a topic without defining this route.
    if re.search(r'/(faq|aide|help|questions|support)(?:/|$)', path) or re.search(r'\bfaq\b|questions fr[?e]quentes', title_lower):
        return "faq"
    if re.search(r'/(contact|nous-contacter|contactez)(?:/|$)', path) or re.search(r'\bcontact(?:ez)?\b', title_lower):
        return "contact"
    if re.search(r'/(produits?|products?|catalogue|shop|boutique|item)(?:/|$)', path):
        return "product"
    if re.search(r'/(actualit[?e]s?|news|articles?|blog)(?:/|$)', path) or re.search(r'actualit[?e]|communiqu[?e]|presse', title_lower):
        return "news"

    segments = [part for part in path.strip("/").split("/") if part]
    if segments and re.fullmatch(r'(?:fr|en|ar|es|de|it|pt|nl|tr)(?:[-_][a-z]{2})?', segments[0]):
        segments = segments[1:]
    if not segments or segments in (["home"], ["accueil"], ["index"], ["index.html"], ["index.php"]):
        # A long homepage remains a landing page. Contact/news/FAQ widgets
        # do not change its identity or select another word-count policy.
        return "landing"

    if soup is not None:
        primary = soup.find("main") or soup.select_one('[role="main"]') or soup.find("article") or soup.body or soup
        primary = BeautifulSoup(str(primary), "html.parser")
        for secondary in primary.select('nav, footer, header, script, style, noscript, template, [hidden], [aria-hidden="true"]'):
            secondary.decompose()
        headings = primary.find_all(["h2", "h3", "h4"])
        questions = sum("?" in heading.get_text(" ", strip=True) for heading in headings)
        h1 = primary.find("h1")
        h1_text = h1.get_text(" ", strip=True) if h1 else ""
        if re.search(r'\bfaq\b|questions fr[?e]quentes', h1_text, re.I) or (questions >= 3 and questions / max(len(headings), 1) >= .6):
            return "faq"
        if primary.find("form") and re.search(r'\b(contact(?:ez)?|devis|quote|support)\b', h1_text, re.I):
            return "contact"
        if primary.find("article") and primary.find("time", attrs={"datetime": True}):
            return "news"
        if re.search(r'\b(sku|r[?e]f[?e]rence produit|add to cart|ajouter au panier)\b', primary.get_text(" ", strip=True), re.I):
            return "product"
    if _PRICE_RE.search(text[:500]):
        return "product"
    return "other"


def extract_heading_text(soup: BeautifulSoup) -> str:
    return " ".join(h.get_text(" ", strip=True) for h in soup.find_all(["h1", "h2", "h3"]))


def detect_ai_heading_questions(soup: BeautifulSoup) -> dict:
    question_prefixes = re.compile(
        r"^(qui|que|quoi|qu['’]?est|comment|pourquoi|où|ou|quand|combien|quel|quelle|"
        r"what|how|why|where|when|which|who)\b",
        re.I,
    )
    rows = []
    total = 0
    for heading in soup.find_all(["h1", "h2", "h3"]):
        text = heading.get_text(" ", strip=True)
        if not text:
            continue
        total += 1
        is_question = "?" in text or bool(question_prefixes.search(text))
        if is_question and len(rows) < 20:
            rows.append({
                "tag": heading.name,
                "text": text[:220],
            })
    return {
        "heading_count": total,
        "question_heading_count": len(rows),
        "rows": rows,
    }


def check_h1_quality(soup: BeautifulSoup, title_text: str) -> dict:
    h1s = soup.find_all("h1")
    h1_text = h1s[0].get_text(" ", strip=True) if h1s else ""
    return {
        "h1_count": len(h1s),
        "h1_missing": len(h1s) == 0,
        "h1_multiple": len(h1s) > 1,
        "h1_text": h1_text[:200],
        "h1_matches_title": h1_text.lower() == (title_text or "").lower() if h1_text and title_text else False,
        "h1_length": len(h1_text),
    }


def check_heading_hierarchy(soup: BeautifulSoup) -> dict:
    headings = soup.find_all(["h1", "h2", "h3", "h4", "h5", "h6"])
    levels = [int(h.name[1]) for h in headings]
    violations = []
    for i in range(len(levels) - 1):
        if levels[i + 1] - levels[i] > 1:
            violations.append(f"H{levels[i]}->H{levels[i+1]}")
    return {
        "heading_levels": levels[:20],
        "heading_hierarchy_violations": violations,
        "heading_hierarchy_ok": len(violations) == 0,
        "h1_count": levels.count(1),
        "h2_count": levels.count(2),
        "h3_count": levels.count(3),
    }


def check_title_quality(title_text: str) -> dict:
    length = len(title_text or "")
    return {
        "title_text": (title_text or "")[:200],
        "title_length": length,
        "title_too_short": 0 < length < 30,
        "title_too_long": length > 70,
        "title_optimal": 50 <= length <= 60,
        "title_empty": length == 0,
    }


def check_meta_description(soup: BeautifulSoup) -> dict:
    tag = soup.find("meta", attrs={"name": "description"})
    content = (tag.get("content", "") if tag else "").strip()
    length = len(content)
    return {
        "meta_description_present": bool(content),
        "meta_description_length": length,
        "meta_description_too_short": 0 < length < 120,
        "meta_description_too_long": length > 160,
        "meta_description_optimal": 120 <= length <= 160,
        "meta_description_text": content[:200],
    }


def check_image_seo(soup: BeautifulSoup) -> dict:
    imgs = soup.find_all("img")
    total = len(imgs)
    missing_alt = sum(1 for img in imgs if not img.get("alt", "").strip())
    generic_names = []
    for img in imgs:
        src = img.get("src", "")
        fname = src.split("/")[-1].split(".")[0]
        if _GENERIC_FNAME_RE.match(fname):
            generic_names.append(src[:100])
    return {
        "img_count": total,
        "img_missing_alt_count": missing_alt,
        "img_alt_coverage_pct": round((total - missing_alt) / max(total, 1) * 100, 1),
        "img_generic_filename_count": len(generic_names),
        "img_generic_filename_samples": generic_names[:5],
    }


def analyze_links(soup: BeautifulSoup, page_url: str) -> dict:
    base_domain = urlparse(page_url).netloc
    links = soup.find_all("a", href=True)
    internal, external, nofollow = [], [], 0
    for a in links:
        href = a["href"].strip()
        if href.startswith("#") or href.lower().startswith("javascript"):
            continue
        domain = urlparse(href).netloc
        if not domain or domain == base_domain:
            internal.append(href)
        else:
            external.append(href)
        rel_values = a.get("rel") or []
        rel_text = " ".join(rel_values).lower() if isinstance(rel_values, list) else str(rel_values).lower()
        if "nofollow" in rel_text:
            nofollow += 1
    total = len(internal) + len(external)
    word_len = len(soup.get_text(" ", strip=True).split())
    return {
        "internal_link_count": len(internal),
        "external_link_count": len(external),
        "nofollow_count": nofollow,
        "link_density": round(total / max(word_len, 1) * 100, 3),
        "has_no_internal_links": len(internal) == 0,
        "internal_links": internal[:100],
    }


def detect_schema_org(soup: BeautifulSoup) -> dict:
    scripts = soup.find_all("script", type="application/ld+json")
    types_found = []
    parse_errors = 0

    def collect_types(node):
        if isinstance(node, list):
            for item in node:
                collect_types(item)
            return
        if not isinstance(node, dict):
            return
        t = node.get("@type", "")
        if isinstance(t, list):
            types_found.extend([str(x).strip() for x in t if str(x or "").strip()])
        elif t:
            types_found.append(str(t).strip())
        graph = node.get("@graph")
        if graph:
            collect_types(graph)

    for script in scripts:
        try:
            data = json.loads(script.string or script.get_text() or "")
            collect_types(data)
        except Exception:
            parse_errors += 1
            continue
    unique_types = list(dict.fromkeys(types_found))
    json_ld_valid = len(unique_types) > 0
    return {
        "schema_org_present": json_ld_valid,
        "schema_org_types": unique_types,
        "json_ld_present": len(scripts) > 0,
        "json_ld_valid": json_ld_valid,
        "json_ld_types": unique_types,
        "json_ld_count": len(scripts),
        "json_ld_parse_errors": parse_errors,
        "schema_faq_present": "FAQPage" in unique_types,
        "schema_article_present": "Article" in unique_types,
        "schema_news_present": "NewsArticle" in unique_types,
        "schema_product_present": "Product" in unique_types,
        "schema_breadcrumb_present": "BreadcrumbList" in unique_types,
    }


def check_canonical_robots(soup: BeautifulSoup) -> dict:
    canonical = soup.find("link", rel="canonical")
    robots_meta = soup.find("meta", attrs={"name": _META_ROBOTS_RE})
    robots_content = (robots_meta.get("content", "") if robots_meta else "").lower()
    return {
        "canonical_present": canonical is not None,
        "canonical_url": canonical.get("href", "") if canonical else None,
        "robots_noindex": "noindex" in robots_content,
        "robots_nofollow": "nofollow" in robots_content,
        "robots_content": robots_content or None,
    }


def check_og_hreflang(soup: BeautifulSoup) -> dict:
    og = {}
    for meta in soup.find_all("meta", property=re.compile(r"^og:", re.I)):
        og[meta.get("property", "").lower()] = (meta.get("content", "") or "")[:200]
    hreflang_tags = [
        {"lang": l.get("hreflang"), "href": l.get("href")}
        for l in soup.find_all("link", rel="alternate")
        if l.get("hreflang")
    ]
    return {
        "og_title_present": "og:title" in og,
        "og_description_present": "og:description" in og,
        "og_image_present": "og:image" in og,
        "og_score": sum([bool(og.get("og:title")), bool(og.get("og:description")), bool(og.get("og:image"))]),
        "hreflang_present": len(hreflang_tags) > 0,
        "hreflang_langs": [h["lang"] for h in hreflang_tags if h.get("lang")],
    }


def check_llms_txt(base_url: str) -> dict:
    base = (base_url or "").rstrip("/")
    llms_url = base + "/llms.txt" if base else ""
    if not base:
        return {
            "llms_txt_present": False,
            "llms_url": "",
            "status_code": None,
            "content_type": None,
            "length": 0,
            "useful_lines": [],
            "parse_status": "missing_base_url",
        }
    if base in _llms_cache:
        return dict(_llms_cache[base])
    result = {
        "llms_txt_present": False,
        "llms_url": llms_url,
        "status_code": None,
        "content_type": None,
        "length": 0,
        "useful_lines": [],
        "parse_status": "not_found",
    }
    try:
        req = Request(llms_url, method="GET", headers={"User-Agent": "SnapFlowBot/3.0", "Accept": "text/plain,*/*;q=0.8"})
        with urlopen(req, timeout=4) as resp:
            status_code = int(getattr(resp, "status", 0) or 0)
            content_type = resp.headers.get("Content-Type", "")
            body = resp.read(65536) or b""
            text = body.decode("utf-8", errors="replace")
            useful_lines = []
            for raw_line in text.splitlines():
                line = raw_line.strip()
                if not line or line.startswith("#"):
                    continue
                useful_lines.append(line[:240])
                if len(useful_lines) >= 8:
                    break
            result.update({
                "llms_txt_present": status_code == 200,
                "status_code": status_code,
                "content_type": content_type,
                "length": len(body),
                "useful_lines": useful_lines,
                "parse_status": "parsed" if status_code == 200 and useful_lines else "empty" if status_code == 200 else "not_found",
            })
    except Exception as exc:
        result["parse_status"] = f"fetch_error:{exc.__class__.__name__}"
    _llms_cache[base] = dict(result)
    return result


def check_thin_content_by_type(word_count: int, page_type: str, lang: str = "en") -> dict:
    """Apply the existing count policy and preserve its inputs as evidence.

    These benchmarks/multipliers are heuristics, not proof of semantic quality
    or independently established calibration. Keep their current values while
    making the producer and final report use the same measured rule.
    """
    base_threshold = PAGE_TYPE_WORD_BENCHMARKS.get(page_type, 200)
    lang_lower = (lang or "en").lower().replace("_", "-").split("-")[0]
    if lang_lower in ("fr", "fra", "french"):
        threshold = int(base_threshold * 0.85)
    elif lang_lower in ("ar", "ara", "arabic"):
        threshold = int(base_threshold * 0.80)
    else:
        threshold = base_threshold
    return {
        "method": "page_type_word_benchmark",
        "page_type": page_type,
        "language": lang_lower,
        "word_count": word_count,
        "base_word_count_threshold": base_threshold,
        "thin_vs_page_type": word_count < threshold,
        "word_count_threshold": threshold,
        "word_count_gap": max(0, threshold - word_count),
    }


def compute_keyword_prominence(dominant_keyword: str, title_text: str, h1_text: str, meta_description: str, first_paragraph: str) -> dict:
    kw = (dominant_keyword or "").lower()
    if not kw:
        # [N-5] No dominant keyword — return None so consumers distinguish
        # "not computed" from a genuine 0% score on a real keyword.
        return {
            "keyword_prominence_score": None,
            "keyword_in_title": False,
            "keyword_in_h1": False,
            "keyword_in_meta": False,
            "keyword_in_first_paragraph": False,
        }
    # [#14] Use word-boundary regex instead of substring membership.
    # Substring check (kw in text) causes false positives:
    # e.g. keyword="credit" matches "discredit", "accredited", "accreditation".
    _kw_pattern = re.compile(r'(?<![\w\u0600-\u06FF])' + re.escape(kw) + r'(?![\w\u0600-\u06FF])')
    title_hit = int(bool(_kw_pattern.search((title_text or "").lower())))
    h1_hit = int(bool(_kw_pattern.search((h1_text or "").lower())))
    meta_hit = int(bool(_kw_pattern.search((meta_description or "").lower())))
    first_para_hit = int(bool(_kw_pattern.search((first_paragraph or "").lower())))
    score = title_hit * 3 + h1_hit * 3 + meta_hit * 2 + first_para_hit
    return {
        "keyword_prominence_score": round(score / 9, 3),
        "keyword_in_title": bool(title_hit),
        "keyword_in_h1": bool(h1_hit),
        "keyword_in_meta": bool(meta_hit),
        "keyword_in_first_paragraph": bool(first_para_hit),
    }


def compute_title_content_alignment(title_text: str, keyword_density: dict) -> dict:
    title_stems = {_stem_token(w) for w in _TOKEN_RE.findall(title_text or "")
                   if w.lower() not in STOP_WORDS and w.lower() not in SEMANTIC_NOISE_WORDS}
    top_kw_stems = {_stem_token(k) for k in list((keyword_density or {}).keys())[:5]}
    overlap = title_stems & top_kw_stems
    alignment_score = round(len(overlap) / max(len(title_stems), 1), 3)
    return {
        "title_content_alignment": alignment_score,
        "aligned_stems": list(overlap)[:5],
        "title_content_misaligned": alignment_score < 0.2,
    }


def cluster_keywords(keyword_density: dict, top_n: int = 3) -> list:
    """Cluster keywords by their full stem (not a 4-char prefix).

    Changes vs. original:
    - Use full stem to avoid false collisions between "formation", "form", "format".
    - Require minimum stem length of 5 characters; shorter stems are too ambiguous
      to represent a meaningful topic signal.
    """
    clusters: dict[str, list[str]] = {}
    for kw in (keyword_density or {}).keys():
        full_stem = _stem_token(kw)
        if len(full_stem) < 5:
            continue
        clusters.setdefault(full_stem, []).append(kw)
    sorted_clusters = sorted(clusters.items(), key=lambda x: -len(x[1]))
    return [{"topic_stem": stem, "keywords": kws, "size": len(kws)} for stem, kws in sorted_clusters[:top_n]]


def _top10_stems(keyword_density: dict) -> set[str]:
    """Return the set of full stems for the top-10 keywords by density."""
    top10 = list((keyword_density or {}).keys())[:10]
    stems = set()
    for kw in top10:
        s = _stem_token(kw)
        if len(s) >= 5:
            stems.add(s)
    return stems


def pages_share_topic(density_a: dict, density_b: dict, threshold: float = 0.40) -> bool:
    """Return True if two pages share more than *threshold* of their TOP-10 stems.

    Only considers stems of length >= 5 to avoid short-stem false positives.
    Cannibalization is flagged only when the Jaccard-style overlap exceeds 40%.
    """
    stems_a = _top10_stems(density_a)
    stems_b = _top10_stems(density_b)
    if not stems_a or not stems_b:
        return False
    shared = stems_a & stems_b
    # Use the smaller set as the denominator (conservative: how much of the
    # smaller topic is covered by the other page).
    overlap = len(shared) / min(len(stems_a), len(stems_b))
    return overlap > threshold


def compute_stuffing_index(keyword_density: dict, dominant_keyword: str) -> dict:
    top_pct = (keyword_density or {}).get(dominant_keyword, 0.0) if dominant_keyword else 0.0
    risk_score = min(100, round((top_pct / 3.0) * 100)) if top_pct > 0 else 0
    return {
        "stuffing_index": risk_score,
        "stuffing_risk": "high" if risk_score > 80 else "medium" if risk_score > 40 else "low",
        "dominant_kw_density_pct": round(top_pct, 2),
    }


def _find_hidden_text_fragments(soup: BeautifulSoup) -> list[str]:
    hidden_fragments = []
    if not soup:
        return hidden_fragments
    for tag in soup.find_all(True):
        style = str(tag.attrs.get("style", "") or "").lower()
        classes = " ".join(tag.get("class", [])).lower() if isinstance(tag.get("class"), list) else str(tag.get("class", "")).lower()
        hidden = (
            "display:none" in style
            or "visibility:hidden" in style
            or "opacity:0" in style
            or "font-size:0" in style
            or ("color:#fff" in style and "background:#fff" in style)
            or "hidden" in classes
        )
        if hidden:
            txt = tag.get_text(" ", strip=True)
            if txt:
                hidden_fragments.append(txt[:500])
    return hidden_fragments[:50]


def _keyword_segment_distribution(text: str, keyword: str, segments: int = 5) -> dict:
    if not text or not keyword:
        return {"segment_counts": [0] * segments, "max_segment_ratio": 0.0, "total_occurrences": 0}
    kw = re.escape(keyword.lower())
    span = max(len(text) // segments, 1)
    counts = []
    for i in range(segments):
        start = i * span
        end = len(text) if i == segments - 1 else (i + 1) * span
        seg = text[start:end].lower()
        counts.append(len(re.findall(rf"\b{kw}\b", seg)))
    total = sum(counts)
    ratio = (max(counts) / total) if total > 0 else 0.0
    return {"segment_counts": counts, "max_segment_ratio": round(ratio, 3), "total_occurrences": total}


def compute_stuffing_index_v2(text: str, keyword_density: dict, dominant_keyword: str, page_type: str, hidden_fragments: list[str]) -> dict:
    top_pct = float((keyword_density or {}).get(dominant_keyword, 0.0) or 0.0) if dominant_keyword else 0.0
    distribution = _keyword_segment_distribution(text, dominant_keyword or "")
    density_threshold = STUFFING_DENSITY_THRESHOLDS.get(page_type, STUFFING_DENSITY_THRESHOLDS["other"])
    concentration_threshold = STUFFING_CONCENTRATION_THRESHOLDS.get(page_type, STUFFING_CONCENTRATION_THRESHOLDS["other"])

    hidden_keyword_hits = 0
    if dominant_keyword:
        kw = re.escape(dominant_keyword.lower())
        for frag in hidden_fragments:
            hidden_keyword_hits += len(re.findall(rf"\b{kw}\b", frag.lower()))

    density_trigger = top_pct > density_threshold
    concentration_trigger = distribution["max_segment_ratio"] >= concentration_threshold
    hidden_trigger = hidden_keyword_hits > 0
    short_page = len((text or "").split()) < 300
    # [N-9] short_page guard must NOT suppress detection when hidden keyword
    # stuffing is already confirmed — hidden text is equally dangerous on thin pages.
    stuffing_flag = hidden_trigger or (density_trigger and concentration_trigger and not (short_page and not hidden_trigger))
    risk_score = 0
    if stuffing_flag:
        risk_score = min(100, int(45 + top_pct * 6 + distribution["max_segment_ratio"] * 35 + min(hidden_keyword_hits, 5) * 5))

    return {
        "stuffing_index": risk_score,
        "stuffing_risk": "high" if risk_score >= 80 else "medium" if risk_score >= 50 else "low",
        "dominant_kw_density_pct": round(top_pct, 2),
        "density_threshold": density_threshold,
        "concentration_threshold": concentration_threshold,
        "segment_counts": distribution["segment_counts"],
        "max_segment_ratio": distribution["max_segment_ratio"],
        "total_occurrences": distribution["total_occurrences"],
        "hidden_keyword_hits": hidden_keyword_hits,
        "stuffing_flag": stuffing_flag,
        "decision_reason": "hidden_text" if hidden_trigger else ("density_and_concentration" if stuffing_flag else "no_strong_signal"),
    }


def compute_lsi_score(text: str, dominant_keyword_stem: str) -> dict:
    related_terms = TOPIC_GLOSSARY.get((dominant_keyword_stem or "")[:5], [])
    if not related_terms:
        # BL-14: If keyword has no static ontology dictionary, explicitly label non_evalue
        # so aggregator doesn't punish the metric implicitly.
        return {"lsi_score": "non_evalue", "lsi_terms_found": [], "lsi_coverage": "non_evalue"}
    text_lower = (text or "").lower()
    found = [t for t in related_terms if t in text_lower]
    coverage = round(len(found) / len(related_terms), 3)
    return {
        "lsi_score": coverage,
        "lsi_terms_found": found,
        "lsi_coverage": "rich" if coverage >= 0.6 else "average" if coverage >= 0.3 else "thin",
    }


def _compute_ttr(words: list[str]) -> float:
    if not words:
        return 0.0
    return round(len(set(words)) / len(words), 3)


def _compute_mtld(words: list[str], ttr_threshold: float = 0.72) -> float | None:
    if len(words) < 100:
        return None
    factors = 0.0
    types = set()
    token_count = 0
    for token in words:
        token_count += 1
        types.add(token)
        ttr = len(types) / token_count
        if ttr <= ttr_threshold:
            factors += 1.0
            types.clear()
            token_count = 0
    if token_count > 0:
        ttr = len(types) / token_count
        if (1 - ttr_threshold) > 0:
            factors += (1 - ttr) / (1 - ttr_threshold)
    if factors <= 0:
        return None
    return round(len(words) / factors, 2)


def compute_lexical_diversity(text: str) -> dict:
    words = re.findall(r"[A-Za-zÀ-ÿ\u0600-\u06FF]{3,}", (text or "").lower())
    mtld = _compute_mtld(words)
    return {
        "method": "mtld" if mtld is not None else "not_available",
        "mtld": mtld,
        "ttr_debug": _compute_ttr(words),
        "token_count": len(words),
    }


def compute_reading_time(word_count: int) -> dict:
    seconds = round((word_count or 0) / 200 * 60)
    minutes = round(seconds / 60, 1)
    return {"reading_time_seconds": seconds, "reading_time_minutes": minutes}


def detect_ctas(text: str) -> dict:
    text_norm = _normalize_for_rgpd_match(text)
    found_fr = [p for p in CTA_PATTERNS_FR if _normalize_for_rgpd_match(p) in text_norm]
    found_en = [p for p in CTA_PATTERNS_EN if _normalize_for_rgpd_match(p) in text_norm]
    found_ar = [p for p in CTA_PATTERNS_AR if _normalize_for_rgpd_match(p) in text_norm]
    all_ctas = found_fr + found_en + found_ar
    return {
        "cta_count": len(all_ctas),
        "cta_phrases": all_ctas[:10],
        "cta_fr_count": len(found_fr),
        "cta_en_count": len(found_en),
        "cta_ar_count": len(found_ar),
    }


def compute_freshness(last_pub_date_str: str | None, page_type: str, is_news_page: bool) -> dict:
    if not last_pub_date_str:
        return {"freshness_days": None, "freshness_status": "unknown", "freshness_critical": False}
    try:
        pub = date.fromisoformat(last_pub_date_str)
        if pub > date.today():
            return {"freshness_days": None, "freshness_status": "unknown", "freshness_critical": False}
        days = (date.today() - pub).days
    except ValueError:
        return {"freshness_days": None, "freshness_status": "unknown", "freshness_critical": False}
    if is_news_page:
        critical = days > 90
        status = "critical" if days > 90 else "warning" if days > 30 else "fresh"
    elif page_type == "product":
        critical = days > 730
        status = "critical" if days > 730 else "warning" if days > 365 else "fresh"
    else:
        critical = False
        status = "stale" if days > 365 else "fresh"
    return {"freshness_days": days, "freshness_status": status, "freshness_critical": critical}


def compute_completeness(page_type: str, signals: dict) -> dict:
    checklist = COMPLETENESS_CHECKLIST.get(page_type, COMPLETENESS_CHECKLIST["other"])
    results = {item: bool(signals.get(item, False)) for item in checklist}
    passed = sum(1 for v in results.values() if v)
    return {
        "completeness_pct": round(passed / max(len(checklist), 1) * 100),
        "completeness_checks": results,
        "completeness_missing": [k for k, v in results.items() if not v],
    }


def compute_broken_structure_index(h1_missing: bool, thin_vs_type: bool, meta_present: bool, stuffing_risk: str, readability_grade: str, cta_count: int, page_type: str) -> int:
    issues = [
        h1_missing,
        thin_vs_type,
        not meta_present,
        stuffing_risk == "high",
        readability_grade in ("D", "F"),
        (page_type in ("product", "landing") and cta_count == 0),
    ]
    return round(sum(1 for x in issues if x) / len(issues) * 100)


def compute_above_fold_snapshot(text: str) -> dict:
    snippet = (text or "")[:500].strip()
    fingerprint = hashlib.md5(snippet.encode("utf-8")).hexdigest()
    return {"above_fold_snippet": snippet, "above_fold_hash": fingerprint}


def compute_main_content_fingerprint(text: str) -> dict:
    cleaned = re.sub(r"\s+", " ", (text or "")).strip()
    return {
        "main_content_hash": hashlib.md5(cleaned.encode("utf-8")).hexdigest(),
        "main_content_word_count": len(cleaned.split()),
    }


def compute_html_fingerprint(soup: BeautifulSoup) -> dict:
    tag_counts = Counter(tag.name for tag in soup.find_all())
    important = {t: tag_counts.get(t, 0) for t in ["div", "section", "article", "nav", "header", "footer", "form", "table", "ul", "ol"]}
    fingerprint = hashlib.md5(str(sorted(important.items())).encode()).hexdigest()
    return {"html_tag_distribution": important, "html_structure_hash": fingerprint}


def classify_tone(text: str, sentence_count: int) -> dict:
    text_norm = _normalize_for_rgpd_match(text)
    formal_hits = sum(1 for m in FORMAL_MARKERS if _normalize_for_rgpd_match(m) in text_norm)
    commercial_hits = sum(1 for m in COMMERCIAL_MARKERS if _normalize_for_rgpd_match(m) in text_norm)
    score = round((formal_hits - commercial_hits) / max(sentence_count, 1), 4)
    if score > 0.05:
        tone = "formal"
    elif score < -0.02:
        tone = "commercial"
    else:
        tone = "neutral"
    return {"tone": tone, "tone_score": score, "formal_hits": formal_hits, "commercial_hits": commercial_hits}


def classify_page_intent(text: str, url: str) -> dict:
    text_norm = _normalize_for_rgpd_match(text)
    scores = {
        intent: sum(1 for s in signals if _normalize_for_rgpd_match(s) in text_norm)
        for intent, signals in INTENT_SIGNALS.items()
    }
    dominant = max(scores, key=scores.get)
    total = sum(scores.values())
    confidence = "high" if scores[dominant] >= 3 else "medium" if scores[dominant] >= 1 else "low"
    return {"intent": dominant if total > 0 else "unknown", "confidence": confidence, "intent_scores": scores, "url": url}


def score_cta_alignment(cta_phrases: list, audience_segment: str) -> dict:
    text_blob = _normalize_for_rgpd_match(" ".join(cta_phrases or []))
    b2b_hits = sum(1 for w in CTA_B2B_SIGNALS if _normalize_for_rgpd_match(w) in text_blob)
    b2c_hits = sum(1 for w in CTA_B2C_SIGNALS if _normalize_for_rgpd_match(w) in text_blob)
    cta_implied = "b2b" if b2b_hits > b2c_hits else "b2c" if b2c_hits > b2b_hits else "neutral"
    aligned = (cta_implied == audience_segment) or cta_implied == "neutral"
    return {
        "cta_implied_segment": cta_implied,
        "alignment": aligned,
        "b2b_cta_hits": b2b_hits,
        "b2c_cta_hits": b2c_hits,
    }


def compute_entity_density(text: str, domain: str) -> dict:
    entities = DOMAIN_ENTITIES.get(domain, DOMAIN_ENTITIES["default"])
    text_lower = (text or "").lower()
    hits = [e for e in entities if e.lower() in text_lower]
    return {
        "entity_hits": len(hits),
        "entities_found": hits[:10],
        "entity_density_score": round(len(hits) / max(len(entities), 1), 3),
    }


def compute_rights_coverage(text: str) -> dict:
    norm = _normalize_for_rgpd_match(text)
    coverage = {}
    for right, pattern in GDPR_RIGHTS_PATTERNS.items():
        coverage[right] = bool(re.search(pattern, norm, re.I))
    score = sum(1 for v in coverage.values() if v)
    return {
        "rights_coverage_score": score,
        "rights_coverage_max": 6,
        "rights_coverage_pct": round(score / 6 * 100),
        "rights_found": [r for r, v in coverage.items() if v],
        "rights_missing": [r for r, v in coverage.items() if not v],
    }


def check_dpo_contact(text: str) -> dict:
    text_lower = (text or "").lower()
    dpo_mentioned = bool(re.search(r'dpo|d\.p\.o|delegue.{0,25}protection|data protection officer|مسؤول حماية', text_lower))
    dpo_email = bool(re.search(r'dpo\s*@|delegue.{0,15}@|data.protection.{0,15}@|\S+@\S+\.(tn|com|fr)', text_lower))
    dpo_phone = bool(re.search(r'\+216\s?[\d\s\-]{8,}|\b\d{2}\s?\d{3}\s?\d{3}\b', text or ""))
    dpo_address = bool(re.search(r'\d{4}.{0,40}(tunis|sfax|sousse|rue|avenue|bp\s?\d)', text_lower))
    return {
        "dpo_mentioned": dpo_mentioned,
        "dpo_email_present": dpo_email,
        "dpo_phone_present": dpo_phone,
        "dpo_address_present": dpo_address,
        "dpo_completeness_score": sum([dpo_mentioned, dpo_email, dpo_phone, dpo_address]),
    }


def audit_third_party_scripts(soup: BeautifulSoup, page_domain: str) -> dict:
    page_netloc = urlparse(f"https://{page_domain}").netloc
    results = {cat: [] for cat in TRACKER_CATEGORIES}
    results["unknown"] = []
    for script in soup.find_all("script", src=True):
        src = script["src"]
        netloc = urlparse(src).netloc if src.startswith("http") else ""
        if not netloc or netloc == page_netloc:
            continue
        categorized = False
        for cat, domains in TRACKER_CATEGORIES.items():
            if any(d in netloc for d in domains):
                results[cat].append(netloc)
                categorized = True
                break
        if not categorized:
            results["unknown"].append(netloc)
    return {
        "third_party_script_count": sum(len(v) for v in results.values()),
        "third_party_by_category": {k: sorted(list(set(v))) for k, v in results.items()},
        "advertising_tracker_count": len(set(results["advertising"])),
        "analytics_tracker_count": len(set(results["analytics"])),
    }


def check_pre_consent_tracking(html: str, advertising_trackers: list) -> dict:
    if not advertising_trackers:
        return {"pre_consent_trackers": [], "pre_consent_violation": False}

    # Detect minified HTML (fewer than 5 newlines = essentially a single line).
    # Rather than skipping, pretty-print the HTML first so line-based ordering
    # of consent banner vs. tracker script tags is recoverable.
    raw_html = html or ""
    html_was_minified = raw_html.count("\n") < 5
    if html_was_minified:
        # Lightweight pretty-print: split on tag boundaries to restore newlines.
        raw_html = raw_html.replace("><", ">\n<")

    lines = raw_html.split("\n")
    banner_line = None
    for i, line in enumerate(lines):
        if _CONSENT_WIDGET_PATTERNS.search(line):
            banner_line = i
            break
    if banner_line is None:
        result = {
            "pre_consent_trackers": advertising_trackers,
            "pre_consent_violation": bool(advertising_trackers),
        }
        if html_was_minified:
            result["html_was_minified"] = True
        return result
    pre_consent = []
    for line in lines[:banner_line]:
        for tracker in advertising_trackers:
            if tracker in line:
                pre_consent.append(tracker)
    result = {
        "pre_consent_trackers": sorted(list(set(pre_consent))),
        "pre_consent_violation": len(pre_consent) > 0,
        "consent_banner_line": banner_line,
    }
    if html_was_minified:
        result["html_was_minified"] = True
    return result


def compute_privacy_score(text: str, rgpd_analysis: dict, rights: dict, dpo: dict) -> dict:
    norm = _normalize_for_rgpd_match(text)
    purpose = bool(_PURPOSE_RE.search(norm)) or bool(rgpd_analysis.get("purpose_mentioned"))
    legal_basis = bool(_LEGAL_BASIS_RE.search(norm))
    score = 0.0
    score += PRIVACY_SCORE_WEIGHTS["data_retention_mentioned"] * int(rgpd_analysis.get("data_retention_mentioned", False))
    score += PRIVACY_SCORE_WEIGHTS["data_minimization_mentioned"] * int(rgpd_analysis.get("data_minimization_mentioned", False))
    score += PRIVACY_SCORE_WEIGHTS["rights_coverage_pct_normalized"] * (rights.get("rights_coverage_pct", 0) / 100)
    score += PRIVACY_SCORE_WEIGHTS["dpo_completeness_normalized"] * (dpo.get("dpo_completeness_score", 0) / 4)
    score += PRIVACY_SCORE_WEIGHTS["purpose_of_processing"] * int(purpose)
    score += PRIVACY_SCORE_WEIGHTS["legal_basis_mentioned"] * int(legal_basis)
    return {
        "privacy_policy_score": round(score),
        "purpose_mentioned": purpose,
        "legal_basis_mentioned": legal_basis,
        "privacy_score_breakdown": {
            "retention": int(rgpd_analysis.get("data_retention_mentioned", False)) * 15,
            "minimization": int(rgpd_analysis.get("data_minimization_mentioned", False)) * 10,
            "rights": round((rights.get("rights_coverage_pct", 0) / 100) * 30),
            "dpo": round((dpo.get("dpo_completeness_score", 0) / 4) * 20),
            "purpose": int(purpose) * 15,
            "legal_basis": int(legal_basis) * 10,
        },
    }


# ─── Section 3.2: RGPD text analysis (Gaps #41, #42) ─────────────────────────
_PRIVACY_URL_RE = re.compile(
    r'/(privacy|confidential|rgpd|gdpr|politique|donn[e\u00e9]es|charte)', re.I
)
_RETENTION_RE = re.compile(
    r'(conserv[e\u00e9]es?\s+pendant|dur[e\u00e9]e\s+de\s+conservation|retained\s+for|'
    r'kept\s+for|conserv[e\u00e9]es?\s+\d+\s+(ans?|mois|jours?|years?|months?|days?))',
    re.I,
)
_MINIMIZATION_RE = re.compile(
    r'(donn[e\u00e9]es\s+strictement\s+n[e\u00e9]cessaires?|minimisation\s+des\s+donn[e\u00e9]es|'
    r'data\s+minimization|strictly\s+necessary|collect\s+only\s+what)',
    re.I,
)

# Normalized (accent-insensitive) patterns to avoid missing FR variants.
_RETENTION_RE_NORM = re.compile(
    r'(conservees?\s+pendant|duree\s+de\s+conservation|retained\s+for|kept\s+for|'
    r'conservees?\s+\d+\s+(ans?|mois|jours?|years?|months?|days?))',
    re.I,
)
_MINIMIZATION_RE_NORM = re.compile(
    r'(donnees\s+strictement\s+necessaires?|minimisation\s+des\s+donnees|'
    r'data\s+minimization|strictly\s+necessary|collect\s+only\s+what)',
    re.I,
)

_RGPD_SIGNAL_KEYWORDS = [
    # French
    "rgpd", "droit d'accès", "droit de rectification", "droit d'opposition",
    "droit a l'effacement", "droit a la portabilite", "donnees personnelles",
    "traitement des donnees", "duree de conservation", "finalite du traitement",
    "consentement", "cnil", "delegue a la protection",
    # English
    "gdpr", "right of access", "right to rectification", "right to erasure",
    "right to data portability", "personal data", "data processing",
    "data retention", "purpose of processing", "consent", "data protection officer",
    # Arabic (conditional signal support)
    # [N3] Expanded from 8 to 16 terms — original list missed core GDPR-equivalent rights.
    "البيانات الشخصية", "حماية البيانات", "سياسة الخصوصية", "الموافقة",
    "مدة الاحتفاظ", "حق الوصول", "حق التصحيح", "حق المحو",
    # Newly added
    "حق الاعتراض", "الأساس القانوني", "مسؤول البيانات", "حق نقل البيانات",
    "الحق في الحصول", "معالجة البيانات", "إلغاء الاشتراك", "الرقابة على البيانات",
]


def _normalize_for_rgpd_match(text: str) -> str:
    """Normalize FR/EN/AR text to reduce Unicode-related detection misses."""
    if not text:
        return ""
    n = text.lower()
    n = n.replace("’", "'").replace("`", "'").replace("´", "'")

    # Arabic normalization: alef variants + diacritics removal.
    n = (n.replace("أ", "ا")
           .replace("إ", "ا")
           .replace("آ", "ا")
           .replace("ٱ", "ا")
           .replace("ى", "ي")
           .replace("ؤ", "و")
           .replace("ئ", "ي")
           .replace("ة", "ه"))
    n = re.sub(r"[\u064B-\u0652\u0670]", "", n)

    # French/Latin accent normalization.
    n = unicodedata.normalize("NFKD", n)
    n = "".join(ch for ch in n if not unicodedata.combining(ch))
    return n


def _has_strong_rgpd_signal(text: str, window_words: int = 200, min_hits: int = 2) -> tuple[bool, int]:
    """Return strong signal flag using >=2 RGPD keywords within a 200-word window."""
    norm = _normalize_for_rgpd_match(text)
    words = norm.split()
    if not words:
        return False, 0

    max_hits = 0
    step = max(window_words // 2, 1)
    for start in range(0, len(words), step):
        window = " ".join(words[start:start + window_words])
        if not window:
            continue
        hits = 0
        for kw in _RGPD_SIGNAL_KEYWORDS:
            kw_norm = _normalize_for_rgpd_match(kw)
            if not kw_norm:
                continue
            if re.search(rf"(^|[^\w]){re.escape(kw_norm)}([^\w]|$)", window):
                hits += 1
        if hits > max_hits:
            max_hits = hits
        if hits >= min_hits:
            return True, max_hits
    return False, max_hits


def analyze_rgpd_text(url: str, text: str) -> dict:
    """Extract data-retention and data-minimization signals from privacy-related pages."""
    strong_signal, max_window_hits = _has_strong_rgpd_signal(text)
    is_privacy_url = bool(_PRIVACY_URL_RE.search(url.lower()))
    text_norm = _normalize_for_rgpd_match(text)

    rgpd_keyword_hits = 0
    for kw in _RGPD_SIGNAL_KEYWORDS:
        kw_norm = _normalize_for_rgpd_match(kw)
        if not kw_norm:
            continue
        if re.search(rf"(^|[^\w]){re.escape(kw_norm)}([^\w]|$)", text_norm):
            rgpd_keyword_hits += 1

    has_rgpd_content_signal = strong_signal or rgpd_keyword_hits >= 2
    if not is_privacy_url and not has_rgpd_content_signal:
        return {
            "data_retention_mentioned": False,
            "data_minimization_mentioned": False,
            "retention_phrases": [],
            "used_strong_signal": False,
            "has_rgpd_content_signal": False,
            "rgpd_keyword_hits": rgpd_keyword_hits,
            "strong_signal_keyword_hits_max": max_window_hits,
        }

    sentences = [s.strip() for s in re.split(r'[.!?\n]', text) if len(s.strip()) > 20]
    retention_sentences = [s for s in sentences if _RETENTION_RE.search(s)]

    if not retention_sentences:
        retention_sentences = [s for s in sentences if _RETENTION_RE_NORM.search(_normalize_for_rgpd_match(s))]

    minimization_found = bool(_MINIMIZATION_RE.search(text) or _MINIMIZATION_RE_NORM.search(text_norm))
    minimization_sentences = [s for s in sentences if _MINIMIZATION_RE.search(s) or _MINIMIZATION_RE_NORM.search(_normalize_for_rgpd_match(s))]
    purpose_sentences = [s for s in sentences if _PURPOSE_RE.search(_normalize_for_rgpd_match(s))]
    has_rgpd_content_signal = has_rgpd_content_signal or bool(retention_sentences) or minimization_found

    return {
        "data_retention_mentioned": len(retention_sentences) > 0,
        "data_minimization_mentioned": minimization_found,
        "purpose_mentioned": len(purpose_sentences) > 0,
        "purpose_phrases": purpose_sentences[:3],
        "retention_phrases": retention_sentences[:3],
        "minimization_phrases": minimization_sentences[:3],
        "used_strong_signal": (not is_privacy_url) and strong_signal,
        "has_rgpd_content_signal": has_rgpd_content_signal,
        "rgpd_keyword_hits": rgpd_keyword_hits,
        "strong_signal_keyword_hits_max": max_window_hits,
    }


def _parse_iso_date(raw: str) -> str | None:
    """Extract the YYYY-MM-DD prefix from an ISO-8601-ish string, or None."""
    m = _ISO_PREFIX_RE.match(raw.strip())
    return m.group(1) if m else None


def extract_dates_and_classify(html: str, url: str, http_last_modified: str | None = None, fetch_http_date: bool = True) -> dict:
    """
    Phase L: Extract publication dates and classify page type.

    Returns a dict with:
      - last_pub_date (str | None): most recent YYYY-MM-DD date found
      - is_news_page (bool)
      - is_partenariat_page (bool)
    """
    candidates: list[tuple[str, str, float]] = []
    soup = BeautifulSoup(html or "", "html.parser")

    # 1) JSON-LD first: dateModified then datePublished.
    jsonld_dates: dict[str, list[str]] = {}
    for script in soup.find_all("script", type="application/ld+json"):
        payload = (script.string or script.get_text() or "").strip()
        if not payload:
            continue
        parsed = _parse_json_like(payload)
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

    # 2) Meta modified then meta published.
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

    # 3) <time datetime>
    for raw in _TIME_DATETIME_RE.findall(html):
        d = _normalize_candidate_date(raw)
        if d and _is_valid_publication_date(d) and _is_year_in_range(d):
            candidates.append((d, "time_datetime", 0.86))

    # 4) HTTP Last-Modified as final fallback source.
    if http_last_modified is None and fetch_http_date:
        http_last_modified = _head_last_modified_date(url)
    if http_last_modified:
        candidates.append((http_last_modified, "http_last_modified", 0.75))

    # Pick best source by confidence first, then newest date inside that source class.
    if candidates:
        best = sorted(candidates, key=lambda x: (x[2], x[0]), reverse=True)[0]
        last_pub_date = best[0]
        last_pub_date_source = best[1]
        last_pub_date_confidence = best[2]
    else:
        last_pub_date = None
        last_pub_date_source = None
        last_pub_date_confidence = 0.0

    date_conflict_flag = False
    if len(candidates) >= 2:
        unique_dates = {d for d, _, _ in candidates}
        date_conflict_flag = len(unique_dates) > 1
        if date_conflict_flag:
            last_pub_date_confidence = round(max(0.0, last_pub_date_confidence - 0.1), 2)
    if http_last_modified and last_pub_date and http_last_modified != last_pub_date:
        date_conflict_flag = True
        last_pub_date_confidence = round(max(0.0, last_pub_date_confidence - 0.1), 2)

    # Page classification — URL + title signals
    url_lower = url.lower()
    title_match = _TITLE_RE.search(html)
    title_lower = (title_match.group(1) if title_match else "").lower()

    is_news_page = bool(
        re.search(r'/actualit|/news|/article|/blog', url_lower)
        or re.search(r'actualit[ée]|communiqu[ée]|presse', title_lower)
    )
    is_partenariat_page = bool(
        re.search(r'/partenaire|/partner|/partenariat', url_lower)
        or re.search(r'partenaire|partenariat', title_lower)
    )

    return {
        "last_pub_date": last_pub_date,
        "last_pub_date_source": last_pub_date_source,
        "last_pub_date_confidence": last_pub_date_confidence,
        "date_conflict_flag": date_conflict_flag,
        "is_news_page": is_news_page,
        "is_partenariat_page": is_partenariat_page,
    }


def get_db_connection():
    """Create a new database connection."""
    return psycopg2.connect(
        host=DB_HOST, port=DB_PORT, dbname=DB_NAME,
        user=DB_USER, password=DB_PASS, connect_timeout=5,
    )


BOILERPLATE_SELECTORS = [
    "nav", "footer", "aside",
    "[role='navigation']", "[role='banner']",
    "[id*='cookie-banner']", "[class*='cookie-banner']",
    "[id*='cookie-consent']", "[class*='cookie-consent']",
    "[id*='consent-banner']", "[class*='consent-banner']",
    "[id*='cookie-modal']", "[class*='cookie-modal']",
    ".menu", "#menu", ".main-menu", "#main-menu",
]

MAIN_CONTENT_SELECTORS = [
    "main",
    "article",
    "[role='main']",
    "#content",
    "#main",
    ".main-content",
    ".content",
    ".post-content",
    ".entry-content",
]


def _clean_text_fragment(text: str) -> str:
    return re.sub(r"\s+", " ", (text or "")).strip()


def _prune_non_content_nodes(soup: BeautifulSoup) -> None:
    # Work only on the extraction copy; raw HTML remains available to checks
    # for metadata, consent, hidden stuffing and original-response evidence.
    for tag in list(soup.find_all(True)):
        if tag.attrs is None:
            continue  # parent has already been removed
        style = re.sub(r"\s+", "", str(tag.get("style", ""))).lower()
        hidden_style = re.search(r"(?:^|;)(?:display:none|visibility:hidden|content-visibility:hidden)(?:!important)?(?:;|$)", style)
        if (tag.name in {"head", "script", "style", "noscript", "template"}
                or tag.has_attr("hidden") or hidden_style):
            tag.decompose()
    # An article header is substantive text; a site header is boilerplate.
    for tag in soup.find_all("header"):
        if tag.attrs is None:
            continue
        if not tag.find_parent(["main", "article"]) and not tag.find_parent(attrs={"role": "main"}):
            tag.decompose()
    for sel in BOILERPLATE_SELECTORS:
        for tag in soup.select(sel):
            if tag.attrs is None:
                continue
            # A content landmark or wrapper containing one is not a banner,
            # even when its CMS identifier happens to contain a cookie word.
            if tag.name in {"main", "article"} or tag.get("role") == "main" or tag.select_one("main, article, [role='main']"):
                continue
            tag.decompose()


def _pick_main_content_node(soup: BeautifulSoup):
    candidates = []

    for selector in MAIN_CONTENT_SELECTORS:
        for node in soup.select(selector):
            text = _clean_text_fragment(node.get_text(separator=" ", strip=True))
            wc = len(text.split())
            if wc >= 40:
                candidates.append((wc, text, selector))

    # Do not let a generic page wrapper with related widgets outrank explicit
    # main/article content solely because the wrapper contains more words.
    if candidates:
        semantic = [item for item in candidates if item[2] in {"main", "article", "[role='main']"}]
        best_wc, best_text, best_source = max(semantic or candidates, key=lambda x: x[0])
        if best_wc >= 80:
            return best_text, f"main_candidate:{best_source}"
        if semantic:
            return None, "fallback_full_page"

    for node in soup.find_all(["section", "div"], limit=250):
        if len(node.find_all("p")) < 2:
            continue
        text = _clean_text_fragment(node.get_text(separator=" ", strip=True))
        wc = len(text.split())
        if wc >= 80:
            candidates.append((wc, text, node.name))

    if not candidates:
        return None, "fallback_full_page"

    best_wc, best_text, best_source = max(candidates, key=lambda x: x[0])
    if best_wc < 80:
        return None, "fallback_full_page"
    return best_text, f"main_candidate:{best_source}"


def _try_graceful_content_extraction(soup: BeautifulSoup) -> tuple[str, str]:
    """Progressive fallback extraction to avoid boilerplate contamination.

    Attempts the following strategies in order and returns the first result
    that yields at least 100 characters:
      1. Semantic landmarks: <main>, <article>, [role="main"]
      2. Common content CSS selectors
      3. Largest <div>/<section> block by text length
      4. Concatenated <p> tag text

    Returns (text, source_label).  Returns ("", "exhausted") if all
    strategies yield fewer than 100 characters so the caller can decide
    whether to fall back to full-page text.
    """
    MIN_CHARS = 100

    # Strategy 1: semantic landmarks
    for selector in ("main", "article", "[role='main']"):
        for node in soup.select(selector):
            t = _clean_text_fragment(node.get_text(separator=" ", strip=True))
            if len(t) >= MIN_CHARS:
                return t, f"semantic:{selector}"

    # Strategy 2: common content CSS classes / IDs
    for selector in (".content", "#content", "#main", ".post-content", ".entry-content", ".page-content"):
        for node in soup.select(selector):
            t = _clean_text_fragment(node.get_text(separator=" ", strip=True))
            if len(t) >= MIN_CHARS:
                return t, f"css:{selector}"

    # Strategy 3: largest <div> or <section> by text length
    best_text, best_len = "", 0
    for node in soup.find_all(["div", "section"], limit=300):
        t = _clean_text_fragment(node.get_text(separator=" ", strip=True))
        if len(t) > best_len:
            best_len = len(t)
            best_text = t
    if best_len >= MIN_CHARS:
        return best_text, "largest_block"

    # Strategy 4: concatenate all <p> tags
    paragraphs = " ".join(
        p.get_text(separator=" ", strip=True)
        for p in soup.find_all("p")
    )
    p_text = _clean_text_fragment(paragraphs)
    if len(p_text) >= MIN_CHARS:
        return p_text, "paragraphs"

    return "", "exhausted"


def extract_text(html: str) -> str:
    """Legacy extraction: strip HTML tags and return cleaned text."""
    soup = BeautifulSoup(html, "html.parser")
    _prune_non_content_nodes(soup)
    return _clean_text_fragment(soup.get_text(separator=" ", strip=True))


def extract_text_main_content_first(html: str) -> tuple[str, str, dict]:
    """Prefer main content blocks first, with graceful progressive fallback.

    Returns (text, source_label, page_metadata) where page_metadata may
    contain ``content_extraction_quality: "low"`` when forced to use the
    full-page text as last resort.
    """
    soup = BeautifulSoup(html, "html.parser")
    _prune_non_content_nodes(soup)

    # Serialized HTML has no shadow roots. Their independently captured text
    # must survive main-content selection, including when a rich <main> wins.
    shadow_fragments = [node.get_text(" ", strip=True)
                        for node in soup.select("[data-snapflow-shadow-text='true']")]

    def with_shadow(text):
        for fragment in shadow_fragments:
            fragment = _clean_text_fragment(fragment)
            if fragment and fragment not in text:
                text = _clean_text_fragment(f"{text} {fragment}")
        return text

    main_text, source = _pick_main_content_node(soup)
    if main_text:
        return with_shadow(main_text), source, {}

    # Primary extraction failed; try progressive graceful strategies.
    graceful_text, graceful_source = _try_graceful_content_extraction(soup)
    if graceful_text:
        return with_shadow(graceful_text), f"graceful:{graceful_source}", {}

    # Last resort: full page text — mark as low quality for downstream KPIs.
    full_text = _clean_text_fragment(soup.get_text(separator=" ", strip=True))
    return with_shadow(full_text), "fallback_full_page", {"content_extraction_quality": "low"}


# CMP vendor keywords — used only inside trusted tag/script contexts.
_CMP_KEYWORDS = re.compile(
    r'axeptio|cookiebot|onetrust|didomi|tarteaucitron|quantcast|cookieconsent',
    re.I,
)
# Matches a keyword inside a URL string or a function-call expression.
_CMP_URL_OR_CALL_RE = re.compile(
    r'(https?://[^\s"\']*(?:axeptio|cookiebot|onetrust|didomi|tarteaucitron|quantcast|cookieconsent)[^\s"\']*'
    r'|(?:axeptio|cookiebot|onetrust|didomi|tarteaucitron|quantcast|cookieconsent)\s*[.(])',
    re.I,
)


def _detect_cmp_from_html(html: str) -> tuple[bool, str]:
    """Return (cmp_detected, cmp_detection_source) using structured HTML parsing.

    Detection hierarchy (highest confidence first):
      1. ``script_src`` — CMP keyword in a <script src="..."> attribute.
      2. ``link_href``  — CMP keyword in a <link href="..."> attribute.
      3. ``inline_script`` — CMP keyword inside a <script> block, but only when
         it appears in a URL string or function-call context (not a plain mention).
      4. ``text_mention`` — bare keyword found elsewhere; treated as
         low-confidence and does NOT set cmp_detected=True.

    Returns (False, "none") when no CMP evidence is found.
    """
    try:
        soup = BeautifulSoup(html, "html.parser")
    except Exception:
        return False, "none"

    # 1. External script src
    for tag in soup.find_all("script", src=True):
        src = tag.get("src", "") or ""
        if _CMP_KEYWORDS.search(src):
            return True, "script_src"

    # 2. Link href (e.g. preload / stylesheet for CMP)
    for tag in soup.find_all("link", href=True):
        href = tag.get("href", "") or ""
        if _CMP_KEYWORDS.search(href):
            return True, "link_href"

    # 3. Inline script content — require URL or function-call context
    for tag in soup.find_all("script"):
        content = tag.string or tag.get_text() or ""
        if not content:
            continue
        if _CMP_URL_OR_CALL_RE.search(content):
            return True, "inline_script"

    # 4. Bare text mention — low confidence, do not assert cmp_detected
    if _CMP_KEYWORDS.search(html):
        return False, "text_mention"

    return False, "none"


@lru_cache(maxsize=2)
def _readability_statistics(language: str):
    # textstat's module singleton defaults to English. Separate cached
    # instances avoid both French syllable errors and cross-page state leaks.
    statistics = textstatistics()
    statistics.set_lang("fr" if language == "fr" else "en")
    return statistics


def _declared_spelling_inputs(text: str, html: str, page_language: str):
    """Project exact selected-text nodes by declared language; omit code only
    for spelling. Counts/content/passages continue using the original text.
    """
    if not html:
        return None
    soup = BeautifulSoup(html, "html.parser")
    declarations = {str(node.get("lang", "")).lower().split("-")[0] for node in soup.find_all(attrs={"lang": True})}
    if not (declarations - {page_language}) and not soup.find(["pre", "code", "kbd", "samp"]):
        return None
    _prune_non_content_nodes(soup)
    groups, excluded_code_words = {}, 0
    cursor = 0
    for node in soup.find_all(string=True):
        # BeautifulSoup's selected get_text excludes comments.
        from bs4 import Comment
        if isinstance(node, Comment):
            continue
        fragment = _clean_text_fragment(str(node))
        if not fragment:
            continue
        offset = text.find(fragment, cursor)
        if offset < 0:
            continue  # Outside the worker's selected content.
        cursor = offset + len(fragment)
        if node.find_parent(["pre", "code", "kbd", "samp"]):
            excluded_code_words += len(_TOKEN_RE.findall(fragment))
            continue
        parent = node.find_parent(attrs={"lang": True})
        language = str(parent.get("lang")).lower().split("-")[0] if parent else page_language
        groups.setdefault(language, []).append(fragment)
    return {"blocks": {lang: " ".join(parts) for lang, parts in groups.items()},
            "excluded_code_words": excluded_code_words,
            "source": "declared_HTML_language_on_selected_text_nodes"}


def analyze_content(text: str, url: str = None, html: str = None) -> dict:
    """Run NLP analysis on extracted text."""
    # Preserve language for page-type policy even when content is too short
    # for readability/keyword analysis. Prefer declared HTML language.
    is_arabic, is_french = False, False
    html_lang = ""
    if html:
        match = re.search(r'(?i)<html[^>]*lang=["\']([^"\']+)["\']', html)
        if match:
            html_lang = match.group(1).lower()

    if html_lang.startswith("ar"):
        is_arabic = True
    elif html_lang.startswith("fr"):
        is_french = True
    elif html_lang.startswith("en"):
        pass  # Declared English must not be replaced by one Arabic paragraph.
    else:
        # Fallback to 500-char heuristic
        words_sample = (text or "")[:500].lower()
        arabic_chars = sum(1 for c in words_sample if '\u0600' <= c <= '\u06FF')
        french_markers = sum(words_sample.count(w) for w in (" le ", " la ", " les ", " de ", " du ", " des ", " est ", " une ", " que "))
        is_arabic = arabic_chars / max(len(words_sample), 1) > 0.15
        is_french = french_markers >= 2 and not is_arabic

    content_language = "ar" if is_arabic else "fr" if is_french else "en"
    if not text or len(text) < 50:
        return {
            "content_language": content_language,
            "word_count": len(text.split()) if text else 0,
            "readability_score": 0,
            "readability_grade": "N/A",
            "keyword_density": {},
            "keyword_density_score": 0.0,
            "content_type_hint": "insufficient_content",
            "avg_sentence_length": 0,
            "content_quality": "insufficient_content",
            "dominant_keyword": None,
            "dominant_keyword_stem": None,
            "typo_density": 0.0,
            "typo_samples": [],
        }

    # [5.8] Language-aware readability.
    statistics = _readability_statistics("fr" if is_french else "en")
    word_count = statistics.lexicon_count(text, removepunct=True)
    sentence_count = statistics.sentence_count(text)
    avg_sentence_length = round(word_count / max(sentence_count, 1), 1)

    if is_arabic:
        flesch_score = None
        grade = "N/A"  # No reliable readability formula for Arabic
    elif is_french:
        # Kandel-Moles formula (calibrated for French)
        avg_syllables = statistics.avg_syllables_per_word(text)
        flesch_score = round(207 - (1.015 * avg_sentence_length) - (73.6 * avg_syllables), 1)
        flesch_score = max(0, min(100, flesch_score))
        if flesch_score >= 80:
            grade = "A"
        elif flesch_score >= 60:
            grade = "B"
        elif flesch_score >= 40:
            grade = "C"
        elif flesch_score >= 20:
            grade = "D"
        else:
            grade = "F"
    else:
        # English / other — Flesch Reading Ease
        flesch_score = statistics.flesch_reading_ease(text)
        flesch_score = max(0, min(100, round(flesch_score, 1)))
        if flesch_score >= 80:
            grade = "A"
        elif flesch_score >= 60:
            grade = "B"
        elif flesch_score >= 40:
            grade = "C"
        elif flesch_score >= 20:
            grade = "D"
        else:
            grade = "F"

    # Keyword density (top 15 words, excluding stopwords)
    # Use shared multilingual tokenizer to keep Arabic/French handling consistent.
    words = [w.lower() for w in _TOKEN_RE.findall(text or "")]
    
    # BL-04: Prevent brand names from being flagged as keyword stuffing.
    domain_brand = ""
    if url:
        try:
            parsed_domain = urlparse(url).netloc.replace("www.", "")
            domain_brand = parsed_domain.split(".")[0].lower()
        except:
            pass
            
    filtered = [w for w in words if w not in STOP_WORDS and w not in SEMANTIC_NOISE_WORDS and w != domain_brand]
    word_freq = Counter(filtered)
    top_keywords = word_freq.most_common(15)
    # [5.1] Denominator must be raw word_count, not len(filtered).
    # Using filtered word count inflates density by ~2x (stopwords excluded).
    keyword_density = {
        word: round(count / max(word_count, 1) * 100, 2)
        for word, count in top_keywords
    }

    # Content quality bucket
    # BL-12: Pagination constraint penalty reduction. Paginated pages inherently have less text.
    is_paginated = bool(url and re.search(r'(?i)(page=|/page/\d|\?p=)', url))
    quality_thresholds = [120, 60, 20] if is_paginated else [300, 150, 50]
    
    flesch_for_quality = flesch_score if isinstance(flesch_score, (int, float)) else 0
    if word_count >= quality_thresholds[0] and flesch_for_quality >= 50:
        quality = "good"
    elif word_count >= quality_thresholds[1]:
        quality = "average"
    elif word_count >= quality_thresholds[2]:
        quality = "thin"
    else:
        quality = "insufficient_content"

    # Section 3.3: keyword stuffing signal + enriched content type hint
    top_keyword_count = top_keywords[0][1] if top_keywords else 0
    # [5.1] Same fix: raw word_count denominator
    keyword_density_score = round(top_keyword_count / max(word_count, 1), 4)
    dominant_keyword = top_keywords[0][0] if top_keywords else None
    dominant_keyword_stem = _stem_token(dominant_keyword) if dominant_keyword else None

    spelling_inputs = _declared_spelling_inputs(text, html, content_language)
    spelling_scope = None
    if spelling_inputs is None:
        eligible_words = sum(len(_TOKEN_RE.findall(block)) for block in _lt_text_blocks(text))
        typo_density, typo_samples, error_count, measured = _detect_typo_density(text, language=content_language, _return_count=True)
        spelling_scope = dict(source="selected_text", checked_word_count=eligible_words if measured else 0,
            error_occurrences=error_count, languages_checked=[content_language] if measured else [],
            unmeasured_languages={} if measured else {content_language: eligible_words},
            excluded_policy_words=max(0, len(_TOKEN_RE.findall(text)) - eligible_words),
            excluded_code_words=0, status="evaluated" if measured else "partial")
        # An intentionally excluded short snippet is not a provider outage.
        if not measured and content_language in {"fr", "en", "ar"} and eligible_words:
            spelling_scope["provider_failures"] = {content_language: eligible_words}
    else:
        errors, samples, checked_words, excluded_policy_words = 0, [], 0, 0
        unmeasured = {}
        provider_failures = {}
        for language, block in spelling_inputs["blocks"].items():
            words_in_block = len(_TOKEN_RE.findall(block))
            if language not in {"fr", "en", "ar"}:
                unmeasured[language] = words_in_block
                continue
            eligible_words = sum(len(_TOKEN_RE.findall(chunk)) for chunk in _lt_text_blocks(block))
            excluded_policy_words += max(0, words_in_block - eligible_words)
            _density, found, count, measured = _detect_typo_density(block, language=language, _return_count=True)
            if not measured:
                unmeasured[language] = words_in_block
                if eligible_words:
                    provider_failures[language] = eligible_words
                continue
            errors += count
            samples.extend(found)
            checked_words += eligible_words
        typo_density = round(errors / max(checked_words, 1), 4)
        typo_samples = list(dict.fromkeys(samples))[:10]
        spelling_scope = dict(source=spelling_inputs["source"], checked_word_count=checked_words,
            error_occurrences=errors, languages_checked=[lang for lang in spelling_inputs["blocks"] if lang not in unmeasured],
            unmeasured_languages=unmeasured, excluded_code_words=spelling_inputs["excluded_code_words"],
            excluded_policy_words=excluded_policy_words,
            status="partial" if unmeasured else "evaluated")
        if provider_failures:
            spelling_scope["provider_failures"] = provider_failures

    if flesch_for_quality > 50 and word_count > 300:
        content_type_hint = "rich"
    elif word_count < 100:
        content_type_hint = "thin"
    elif keyword_density_score > 0.05:
        content_type_hint = "stuffed"
    else:
        content_type_hint = "normal"

    nlp_dict = {
        "spelling_scope": spelling_scope,
        "content_language": content_language,
        "word_count": word_count,
        "sentence_count": sentence_count,
        "readability_score": flesch_score,
        "readability_grade": grade,
        "keyword_density": keyword_density,
        "keyword_density_score": keyword_density_score,
        "content_type_hint": content_type_hint,
        "avg_sentence_length": avg_sentence_length,
        "content_quality": quality,
        "dominant_keyword": dominant_keyword,
        "dominant_keyword_stem": dominant_keyword_stem,
        "typo_density": typo_density,
        "typo_samples": typo_samples,
    }
    
    # BL-01: CMP Detection in Native JS Scripts.
    # Because Colly scanner doesn't execute DOM, aggregator flags missing banner.
    # We detect CMP presence by inspecting actual script/link tags and inline
    # script content — NOT by raw-regex over the full HTML — to avoid false
    # positives from blog posts that merely mention GDPR tool names.
    if html:
        cmp_detected, cmp_source = _detect_cmp_from_html(html)
        nlp_dict["cmp_detected"] = cmp_detected
        nlp_dict["cmp_detection_source"] = cmp_source

    return nlp_dict


def process_pending_pages():
    """Analyze at most 20 current page revisions using one-page durable claims."""
    conn = get_db_connection()
    conn.autocommit = False
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    processed = 0
    for _ in range(20):
        try:
            row = claim_page(conn, cur)
        except Exception as exc:
            conn.rollback()
            logger.error("Error claiming pending page: %s", exc)
            break
        if not row:
            break
        page_id = row["id"]
        heartbeat = ClaimHeartbeat(get_db_connection, row)
        heartbeat.start()
        page_started = time.monotonic()
        url = row["url"]
        rendered_html = row.get("rendered_html")
        raw_html = row.get("raw_html")
        html, raw_base_html, metrics = select_page_evidence(row)
        html_for_legacy = raw_base_html or html
        # [N-1] Per-row try/except + commit so one bad page cannot roll back
        # the entire batch and trap other pages in a retry loop.
        # [N-7] HTTP HEAD call is done BEFORE opening the DB transaction to
        # avoid holding the row lock during a blocking network call.
        response_headers = metrics.get("response_headers") or {}
        captured_last_modified = response_headers.get("last-modified") if isinstance(response_headers, dict) else None
        http_last_modified_prefetch = (_normalize_candidate_date(captured_last_modified) if captured_last_modified else None)
        if http_last_modified_prefetch is None and not response_headers:
            http_last_modified_prefetch = _head_last_modified_date(url)
        try:

            legacy_text = extract_text(html_for_legacy)
            text, extraction_source, extraction_meta = extract_text_main_content_first(html)
            raw_content_text, raw_content_source, _raw_content_meta = (
                extract_text_main_content_first(raw_base_html)
                if raw_base_html
                else ("", "missing_raw_html", {})
            )
            raw_content_word_count = len(raw_content_text.split())
            
            # Check if this is a non-hydrated SPA shell
            spa_shell = len(text.split()) < 50 and not rendered_html and any(
                sig in (html or "") for sig in ["__NEXT_DATA__", "data-reactroot", "window.__nuxt__", "id=\"__next\"", "id='__next'"]
            )
            if spa_shell:
                logger.warning(f"Page {url} appears to be a non-hydrated SPA shell. Skipping NLP.")
                published = publish_page(conn, cur, row,
                        json.dumps({
                            "status": "not_evaluated",
                            "skipped": True,
                            "reason": "spa_shell_not_hydrated",
                            "content_type_hint": "not_evaluated",
                            "runtime_html_available": False,
                            "extraction": {
                                "mode": "main_content_first",
                                "selected_source": "spa_shell_not_hydrated",
                                "legacy_word_count": len(legacy_text.split()),
                                "main_word_count": len(text.split()),
                                "raw_content_visible": raw_content_word_count >= 50,
                                "raw_content_word_count": raw_content_word_count,
                                "raw_content_source": raw_content_source,
                            },
                        }),
                )
                processed += int(published)
                continue

            nlp_result = analyze_content(text, url=url, html=html)
            nlp_result["status"] = "evaluated"
            # Propagate extraction quality metadata (e.g. content_extraction_quality: "low")
            # so downstream KPIs can express lower confidence on boilerplate-contaminated text.
            nlp_result.update(extraction_meta)
            nlp_result["extraction"] = {
                "mode": "main_content_first",
                "selected_source": extraction_source,
                "legacy_word_count": len(legacy_text.split()),
                "main_word_count": len(text.split()),
                "runtime_html_available": bool(rendered_html),
                "raw_content_visible": raw_content_word_count >= 50,
                "raw_content_word_count": raw_content_word_count,
                "raw_content_source": raw_content_source,
                "rendered_content_used": bool(rendered_html) and len(text.split()) > raw_content_word_count + 30,
            }
            soup = BeautifulSoup(html, "html.parser")
            schema_kpis = detect_schema_org(soup)
            ai_heading_questions = detect_ai_heading_questions(soup)

            # Phase L: date extraction + page classification
            # [N-7] Pass the pre-fetched HTTP date so extract_dates_and_classify
            # doesn't fire another synchronous HEAD inside the DB lock.
            date_classify = extract_dates_and_classify(html, url, http_last_modified_prefetch, fetch_http_date=False)
            if http_last_modified_prefetch and not date_classify.get("last_pub_date"):
                date_classify["last_pub_date"] = http_last_modified_prefetch
                date_classify["last_pub_date_source"] = "http_last_modified"
                date_classify["last_pub_date_confidence"] = 0.75
            nlp_result.update(date_classify)

            # Section 3.1: page type classification
            title_match = _TITLE_RE.search(html)
            title_text = title_match.group(1).strip() if title_match else ""
            nlp_result["page_type"] = classify_page_type(
                url,
                title_text,
                text,
                soup=soup,
                schema_types=schema_kpis.get("schema_org_types", []),
            )
            body_audience_segment = classify_audience_segment(
                url,
                title_text,
                text,
                nlp_result.get("keyword_density", {}),
            )
            heading_text = extract_heading_text(soup)
            heading_audience_segment = classify_audience_segment(
                url,
                title_text,
                heading_text,
                nlp_result.get("keyword_density", {}),
            )
            if heading_audience_segment.get("confidence") == "high":
                nlp_result["audience_segment"] = dict(heading_audience_segment)
                nlp_result["audience_segment"]["source"] = "heading"
            else:
                nlp_result["audience_segment"] = dict(body_audience_segment)
                nlp_result["audience_segment"]["source"] = "body"

            # Section 3.2: RGPD text analysis (data retention + minimization signals)
            nlp_result["rgpd_text_analysis"] = analyze_rgpd_text(url, text)

            # Build nested SEO KPIs
            h1_text = soup.find("h1").get_text(" ", strip=True) if soup.find("h1") else ""
            meta_tag = soup.find("meta", attrs={"name": "description"})
            meta_desc = meta_tag.get("content", "") if meta_tag else ""
            first_para_tag = soup.find("p")
            first_para = first_para_tag.get_text(" ", strip=True)[:300] if first_para_tag else ""
            base_domain = urlparse(url).netloc
            semantic_enrichment = build_semantic_enrichment(title_text, meta_desc, h1_text, text)
            if semantic_enrichment is not None:
                nlp_result["semantic_enrichment"] = semantic_enrichment

            nlp_result["seo_kpis"] = {
                "h1_quality": check_h1_quality(soup, title_text),
                "heading_hierarchy": check_heading_hierarchy(soup),
                "title_quality": check_title_quality(title_text),
                "meta_description": check_meta_description(soup),
                "image_seo": check_image_seo(soup),
                "links": analyze_links(soup, url),
                "schema_org": schema_kpis,
                "canonical_robots": check_canonical_robots(soup),
                "og_hreflang": check_og_hreflang(soup),
                "llms_txt": check_llms_txt(f"https://{base_domain}"),
                "ai_heading_questions": ai_heading_questions,
                "ai_raw_content": {
                    "raw_content_visible": raw_content_word_count >= 50,
                    "raw_content_word_count": raw_content_word_count,
                    "raw_content_source": raw_content_source,
                    "rendered_content_used": bool(rendered_html) and len(text.split()) > raw_content_word_count + 30,
                    "main_word_count": len(text.split()),
                },
                "thin_content_by_type": check_thin_content_by_type(
                    nlp_result.get("word_count", 0), nlp_result.get("page_type", "other"),
                    nlp_result.get("content_language", "en")),
            }

            # Build nested Content KPIs
            kw_density = nlp_result.get("keyword_density", {})
            dominant_kw = nlp_result.get("dominant_keyword", "")
            dominant_stem = nlp_result.get("dominant_keyword_stem", "")
            cta_data = detect_ctas(text)
            tone = classify_tone(text, nlp_result.get("sentence_count", 1))
            intent = classify_page_intent(text, url)
            entity_density = compute_entity_density(text, base_domain.split(".")[0].lower() if base_domain else "default")
            freshness = compute_freshness(
                nlp_result.get("last_pub_date"),
                nlp_result.get("page_type", "other"),
                nlp_result.get("is_news_page", False),
            )

            completeness_signals = {
                "h1_present": not nlp_result["seo_kpis"]["h1_quality"]["h1_missing"],
                "meta_present": nlp_result["seo_kpis"]["meta_description"]["meta_description_present"],
                "cta_count_gt_0": cta_data["cta_count"] > 0,
                "word_count_gt_300": nlp_result.get("word_count", 0) > 300,
                "word_count_gt_600": nlp_result.get("word_count", 0) > 600,
                "schema_present": nlp_result["seo_kpis"]["schema_org"]["schema_org_present"],
                "schema_faq_present": nlp_result["seo_kpis"]["schema_org"]["schema_faq_present"],
                "has_pub_date": nlp_result.get("last_pub_date") is not None,
                "h2_count_gt_1": nlp_result["seo_kpis"]["heading_hierarchy"]["h2_count"] > 1,
                "og_image_present": nlp_result["seo_kpis"]["og_hreflang"]["og_image_present"],
                "question_density_gt_0": text.count("?") > 0,
                "price_mention": bool(_PRICE_RE.search(text[:500])),
            }

            hidden_fragments = _find_hidden_text_fragments(soup)
            stuffing_index = compute_stuffing_index_v2(
                text,
                kw_density,
                dominant_kw,
                nlp_result.get("page_type", "other"),
                hidden_fragments,
            )
            lexical = compute_lexical_diversity(text)

            nlp_result["content_kpis"] = {
                "lexical_diversity": lexical.get("mtld"),
                "lexical_diversity_method": lexical.get("method"),
                "lexical_diversity_ttr_debug": lexical.get("ttr_debug"),
                "lexical_diversity_token_count": lexical.get("token_count"),
                "reading_time": compute_reading_time(nlp_result.get("word_count", 0)),
                "keyword_prominence": compute_keyword_prominence(dominant_kw, title_text, h1_text, meta_desc, first_para),
                "title_content_alignment": compute_title_content_alignment(title_text, kw_density),
                "topic_clusters": cluster_keywords(kw_density),
                "stuffing_index": stuffing_index,
                "lsi_score": compute_lsi_score(text, dominant_stem),
                "cta": cta_data,
                "freshness": freshness,
                "above_fold": compute_above_fold_snapshot(text),
                "html_fingerprint": compute_html_fingerprint(soup),
                "main_content_fingerprint": compute_main_content_fingerprint(text),
                "tone": tone,
                "intent": intent,
                "entity_density": entity_density,
                "cta_alignment": score_cta_alignment(cta_data.get("cta_phrases", []), nlp_result["audience_segment"].get("segment", "unknown")),
                "completeness": compute_completeness(nlp_result.get("page_type", "other"), completeness_signals),
                "broken_structure_index": compute_broken_structure_index(
                    nlp_result["seo_kpis"]["h1_quality"]["h1_missing"],
                    nlp_result["seo_kpis"]["thin_content_by_type"]["thin_vs_page_type"],
                    nlp_result["seo_kpis"]["meta_description"]["meta_description_present"],
                    stuffing_index.get("stuffing_risk", "low"),
                    nlp_result.get("readability_grade", "N/A"),
                    cta_data.get("cta_count", 0),
                    nlp_result.get("page_type", "other"),
                ),
                "audience_segment_heading": heading_audience_segment,
            }

            # Build nested RGPD KPIs
            is_privacy = bool(_PRIVACY_URL_RE.search(url.lower()))
            rgpd_text_analysis = nlp_result["rgpd_text_analysis"]
            if is_privacy or rgpd_text_analysis.get("used_strong_signal") or rgpd_text_analysis.get("has_rgpd_content_signal"):
                rights = compute_rights_coverage(text)
                dpo = check_dpo_contact(text)
                third_party = audit_third_party_scripts(soup, base_domain)
                pre_consent = check_pre_consent_tracking(html, third_party.get("third_party_by_category", {}).get("advertising", []))
                privacy_score = compute_privacy_score(text, rgpd_text_analysis, rights, dpo)
            else:
                rights = {"rights_coverage_score": None, "rights_coverage_pct": None, "rights_found": [], "rights_missing": []}
                dpo = {"dpo_mentioned": None, "dpo_completeness_score": None}
                third_party = audit_third_party_scripts(soup, base_domain)
                pre_consent = {"pre_consent_violation": None, "pre_consent_trackers": []}
                privacy_score = {"privacy_policy_score": None, "purpose_mentioned": None, "legal_basis_mentioned": None}

            nlp_result["rgpd_kpis"] = {
                "rights_coverage": rights,
                "dpo_contact": dpo,
                "third_party_scripts": third_party,
                "pre_consent": pre_consent,
                "privacy_score": privacy_score,
            }

            nlp_result["content_revision"] = row["content_revision"]
            published = publish_page(conn, cur, row, json.dumps(nlp_result))
            processed += int(published)
            logger.info("phase=nlp_publish page_id=%s revision=%s published=%s elapsed_ms=%.1f",
                        page_id, row["content_revision"], published, (time.monotonic()-page_started)*1000)
            logger.info(
                f"\u2705 Analyzed {url} \u2192 {nlp_result['word_count']} words, "
                f"readability: {nlp_result['readability_grade']}"
            )
        except Exception as e:
            conn.rollback()
            release_page(cur, row, retry_seconds=10)
            conn.commit()
            logger.error(f"\u274c Error processing page id={page_id} url={url}: {e}")
            # Continue to next page; do not block the whole batch.
        finally:
            heartbeat.stop()

    cur.close()
    conn.close()
    return processed


def wait_for_db():
    """Wait until the database is reachable."""
    logger.info(f"Waiting for database at {DB_HOST}:{DB_PORT}...")
    while True:
        try:
            conn = get_db_connection()
            conn.close()
            logger.info("✅ Database is ready!")
            return
        except Exception:
            time.sleep(2)


def main():
    """Main polling loop."""
    logger.info("🧠 v3-nlp-worker starting...")
    logger.info("KPI mode: new (legacy path removed)")
    wait_for_db()

    logger.info(f"Polling every {POLL_INTERVAL}s for unanalyzed pages...")
    idle_count = 0

    while True:
        processed = process_pending_pages()
        if processed > 0:
            idle_count = 0
            logger.info(f"Processed {processed} pages this cycle.")
        else:
            idle_count += 1
            if idle_count % 10 == 1:
                logger.info("No pending pages. Waiting...")

        time.sleep(POLL_INTERVAL)


if __name__ == "__main__":
    main()
