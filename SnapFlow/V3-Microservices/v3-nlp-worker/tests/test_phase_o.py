"""
Phase O tests â€” NLP enhancements (Section 3)
Tests for:
  - 3.1  classify_page_type()
  - 3.2  analyze_rgpd_text()
  - 3.3  content enrichment (keyword_density_score, content_type_hint)

Completely self-contained (stdlib + re only). Pure functions are inlined
so that psycopg2, textstat, nltk, and bs4 are NOT required.
Run:  python V3-Microservices/v3-nlp-worker/tests/test_phase_o.py
"""
import re
import sys
import unittest
from collections import Counter

# â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”
# Inline: classify_page_type (Section 3.1)
# â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”

_FAQ_URL_RE     = re.compile(r'/(faq|aide|help|questions|support)', re.I)
_ERROR_TEXT_RE  = re.compile(r'(page introuvable|not found|404|403|500|erreur|error page)', re.I)
_PRODUCT_URL_RE = re.compile(r'/(produit|product|catalogue|shop|boutique|item)', re.I)
_PRICE_RE       = re.compile(r'\d+[\.,]\d+\s*(TND|DT|DIN|EUR|\$)', re.I)


def classify_page_type(url: str, title: str, text: str) -> str:
    url_lower   = url.lower()
    title_lower = (title or "").lower()

    if _FAQ_URL_RE.search(url_lower):
        return "faq"
    if "faq" in title_lower or re.search(r'fr\S*quentes?', title_lower):
        return "faq"
    if text.count("?") >= 5:
        return "faq"
    if _ERROR_TEXT_RE.search(title_lower):
        return "error"
    if _PRODUCT_URL_RE.search(url_lower):
        return "product"
    if _PRICE_RE.search(text[:500]):
        return "product"

    try:
        from urllib.parse import urlparse
        path = urlparse(url).path.rstrip("/")
    except Exception:
        path = ""
    if path in ("", "/home", "/accueil", "/index") and len(text.split()) < 400:
        return "landing"

    return "other"


# â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”
# Inline: analyze_rgpd_text (Section 3.2)
# â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”

_PRIVACY_URL_RE = re.compile(
    r'/(privacy|confidential|rgpd|gdpr|politique|donn(?:e|\u00e9)es|charte)', re.I
)
_RETENTION_RE = re.compile(
    r'(conserv\S+\s+pendant|dur\S+\s+de\s+conservation|retained\s+for|'
    r'kept\s+for|conserv\S+\s+\d+\s+(ans?|mois|jours?|years?|months?|days?))',
    re.I,
)
_MINIMIZATION_RE = re.compile(
    r'(donn\S+\s+strictement\s+n\S*cessaires?|minimisation\s+des\s+donn\S+|'
    r'data\s+minimization|strictly\s+necessary|collect\s+only\s+what)',
    re.I,
)


def analyze_rgpd_text(url: str, text: str) -> dict:
    if not _PRIVACY_URL_RE.search(url.lower()):
        return {"data_retention_mentioned": False, "data_minimization_mentioned": False, "retention_phrases": []}

    sentences = [s.strip() for s in re.split(r'[.!?\n]', text) if len(s.strip()) > 20]
    retention_sentences = [s for s in sentences if _RETENTION_RE.search(s)]
    return {
        "data_retention_mentioned": len(retention_sentences) > 0,
        "data_minimization_mentioned": bool(_MINIMIZATION_RE.search(text)),
        "retention_phrases": retention_sentences[:3],
    }


# â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”
# Inline: content enrichment (Section 3.3) â€” pure Counter/regex, no textstat
# â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”

_STOP_WORDS = {
    "le", "la", "les", "de", "du", "des", "un", "une", "et", "est", "en",
    "the", "of", "and", "to", "a", "in", "is", "it", "for",
}


def _compute_content_hints(text: str) -> dict:
    """Mirrors the keyword_density_score + content_type_hint logic in analyze_content()."""
    if not text or len(text) < 50:
        return {"keyword_density_score": 0.0, "content_type_hint": "insufficient_content"}

    words    = re.findall(r'\b[a-zA-Z]{3,}\b', text.lower())
    filtered = [w for w in words if w not in _STOP_WORDS]
    if not filtered:
        return {"keyword_density_score": 0.0, "content_type_hint": "insufficient_content"}

    word_freq = Counter(filtered)
    top_count = word_freq.most_common(1)[0][1]
    kd_score  = round(top_count / len(filtered), 4)
    word_count = len(words)

    # Simplified readability proxy: unique token ratio * 100
    unique_ratio   = len(set(filtered)) / max(len(filtered), 1)
    flesch_proxy   = unique_ratio * 100

    if flesch_proxy > 50 and word_count > 300:
        hint = "rich"
    elif word_count < 100:
        hint = "thin"
    elif kd_score > 0.05:
        hint = "stuffed"
    else:
        hint = "normal"

    return {"keyword_density_score": kd_score, "content_type_hint": hint}


# â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”
# Tests â€” 3.1 classify_page_type
# â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”

class TestClassifyPageTypeFAQ(unittest.TestCase):

    def test_faq_url_signal(self):
        self.assertEqual(classify_page_type("https://example.com/faq", "", ""), "faq")

    def test_faq_url_aide(self):
        self.assertEqual(classify_page_type("https://example.com/aide/index", "", ""), "faq")

    def test_faq_url_help(self):
        self.assertEqual(classify_page_type("https://example.com/help", "", ""), "faq")

    def test_faq_title_signal(self):
        self.assertEqual(classify_page_type("https://example.com/page", "FAQ - Vos questions", ""), "faq")

    def test_faq_questions_frequentes_title(self):
        self.assertEqual(classify_page_type("https://example.com/page", "Questions frÃ©quentes", ""), "faq")

    def test_faq_question_marks_in_text(self):
        text = "Que faire ? Comment contacter ? Quand livrer ? Pourquoi choisir ? OÃ¹ trouver ?"
        self.assertEqual(classify_page_type("https://example.com/page", "", text), "faq")

    def test_faq_takes_priority_over_other_signals(self):
        text = "199.90 TND spÃ©cial"
        self.assertEqual(classify_page_type("https://example.com/faq/produit", "FAQ", text), "faq")


class TestClassifyPageTypeError(unittest.TestCase):

    def test_404_title(self):
        self.assertEqual(
            classify_page_type("https://example.com/anything", "404 - Page introuvable", ""), "error")

    def test_not_found_title(self):
        self.assertEqual(
            classify_page_type("https://example.com/x", "Page Not Found", "long " * 100), "error")


class TestClassifyPageTypeProduct(unittest.TestCase):

    def test_produit_url(self):
        self.assertEqual(classify_page_type("https://example.com/produit/chaise", "", ""), "product")

    def test_shop_url(self):
        self.assertEqual(classify_page_type("https://example.com/shop/item-42", "", ""), "product")

    def test_price_in_text(self):
        text = "Prix spÃ©cial: 199.90 TND pour ce modÃ¨le exclusif"
        self.assertEqual(classify_page_type("https://example.com/offre", "", text), "product")

    def test_euro_price(self):
        text = "Prix de 29.99 EUR seulement en promotion"
        self.assertEqual(classify_page_type("https://example.com/offre", "", text), "product")


class TestClassifyPageTypeLanding(unittest.TestCase):

    def test_root_short_content(self):
        short_text = "Bienvenue sur notre site " * 10
        self.assertEqual(classify_page_type("https://example.com/", "", short_text), "landing")

    def test_accueil_path(self):
        short_text = "mot " * 20
        self.assertEqual(classify_page_type("https://example.com/accueil", "", short_text), "landing")

    def test_root_long_content_is_not_landing(self):
        long_text = "mot " * 500
        result = classify_page_type("https://example.com/", "", long_text)
        self.assertNotEqual(result, "landing")


class TestClassifyPageTypeOther(unittest.TestCase):

    def test_about_page(self):
        long_text = "mot " * 500
        self.assertEqual(classify_page_type("https://example.com/about", "Ã€ propos", long_text), "other")


# â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”
# Tests â€” 3.2 analyze_rgpd_text
# â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”

class TestAnalyzeRgpdText(unittest.TestCase):

    def test_non_privacy_url_all_false(self):
        result = analyze_rgpd_text("https://example.com/about", "some text")
        self.assertFalse(result["data_retention_mentioned"])
        self.assertFalse(result["data_minimization_mentioned"])
        self.assertEqual(result["retention_phrases"], [])

    def test_retention_conservees_pendant(self):
        url  = "https://example.com/politique-confidentialite"
        text = "Vos donnÃ©es sont conservÃ©es pendant 3 ans Ã  compter de votre derniÃ¨re connexion."
        result = analyze_rgpd_text(url, text)
        self.assertTrue(result["data_retention_mentioned"])
        self.assertGreater(len(result["retention_phrases"]), 0)

    def test_retention_duree_de_conservation(self):
        url  = "https://example.com/rgpd"
        text = "La durÃ©e de conservation de vos donnÃ©es est de 5 ans maximum."
        self.assertTrue(analyze_rgpd_text(url, text)["data_retention_mentioned"])

    def test_english_retained_for(self):
        url  = "https://example.com/gdpr"
        text = "Personal data is retained for 2 years after account closure."
        self.assertTrue(analyze_rgpd_text(url, text)["data_retention_mentioned"])

    def test_minimization_french(self):
        url  = "https://example.com/confidentialite"
        text = "Nous collectons uniquement les donnÃ©es strictement nÃ©cessaires au service."
        self.assertTrue(analyze_rgpd_text(url, text)["data_minimization_mentioned"])

    def test_minimization_english(self):
        url  = "https://example.com/privacy"
        text = "We apply data minimization principles to all collected information."
        self.assertTrue(analyze_rgpd_text(url, text)["data_minimization_mentioned"])

    def test_no_relevant_content(self):
        url  = "https://example.com/privacy"
        text = "Cette page dÃ©crit notre politique gÃ©nÃ©rale."
        result = analyze_rgpd_text(url, text)
        self.assertFalse(result["data_retention_mentioned"])
        self.assertFalse(result["data_minimization_mentioned"])

    def test_retention_phrases_capped_at_3(self):
        url  = "https://example.com/confidentialite"
        text = ". ".join([f"Les donnÃ©es sont conservÃ©es pendant {i} ans" for i in range(1, 6)])
        result = analyze_rgpd_text(url, text)
        self.assertTrue(result["data_retention_mentioned"])
        self.assertLessEqual(len(result["retention_phrases"]), 3)

    def test_result_has_required_keys(self):
        result = analyze_rgpd_text("https://example.com/rgpd", "text")
        for key in ("data_retention_mentioned", "data_minimization_mentioned", "retention_phrases"):
            self.assertIn(key, result)

    def test_charte_url_is_privacy(self):
        url  = "https://example.com/charte-donnees"
        text = "Les donnÃ©es sont conservÃ©es pendant 12 mois."
        self.assertTrue(analyze_rgpd_text(url, text)["data_retention_mentioned"])


# â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”
# Tests â€” 3.3 content enrichment (keyword_density_score, content_type_hint)
# â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”

class TestContentEnrichment(unittest.TestCase):

    def test_returns_keyword_density_score(self):
        result = _compute_content_hints("chat " * 200 + "chien " * 50)
        self.assertIn("keyword_density_score", result)
        self.assertIsInstance(result["keyword_density_score"], float)

    def test_returns_content_type_hint(self):
        result = _compute_content_hints("bonjour " * 400)
        self.assertIn("content_type_hint", result)
        self.assertIn(result["content_type_hint"],
                      ("rich", "thin", "stuffed", "normal", "insufficient_content"))

    def test_stuffed_content_detected(self):
        result = _compute_content_hints("optimisation " * 300)
        self.assertEqual(result["content_type_hint"], "stuffed")
        self.assertGreater(result["keyword_density_score"], 0.05)

    def test_thin_short_text(self):
        result = _compute_content_hints("hi")
        self.assertEqual(result["content_type_hint"], "insufficient_content")
        self.assertEqual(result["keyword_density_score"], 0.0)

    def test_empty_text_insufficient(self):
        result = _compute_content_hints("")
        self.assertEqual(result["content_type_hint"], "insufficient_content")

    def test_diverse_text_not_stuffed(self):
        text = " ".join([f"uniqueword{i}" for i in range(400)])
        result = _compute_content_hints(text)
        self.assertNotEqual(result["content_type_hint"], "stuffed")
        self.assertLessEqual(result["keyword_density_score"], 0.05)

    def test_density_score_between_0_and_1(self):
        result = _compute_content_hints("word " * 100 + "other " * 50)
        self.assertGreaterEqual(result["keyword_density_score"], 0.0)
        self.assertLessEqual(result["keyword_density_score"], 1.0)


# â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

if __name__ == "__main__":
    unittest.main(verbosity=2)
