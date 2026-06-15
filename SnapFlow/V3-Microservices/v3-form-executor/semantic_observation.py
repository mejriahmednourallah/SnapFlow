from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass
from typing import Any
from urllib.parse import urlsplit


@dataclass(frozen=True)
class SemanticRule:
    id: str
    category: str
    languages: tuple[str, ...]
    patterns: tuple[str, ...]
    concepts: tuple[str, ...]
    base_score: float = 0.55
    exclusions: tuple[str, ...] = ()


ARABIC_DIACRITICS = re.compile(r"[\u0610-\u061a\u064b-\u065f\u0670\u06d6-\u06ed]")
ARABIC_TEXT = re.compile(r"[\u0600-\u06ff]")
ROLE_BONUS = {"alert", "status"}
SELECTOR_SIGNAL = re.compile(
    r"(?:^|[-_\s])(error|errors|invalid|success|confirmation|message|messages)(?:$|[-_\s])"
)


def _rule(
    rule_id: str,
    category: str,
    language: str,
    patterns: tuple[str, ...],
    concepts: tuple[str, ...],
    *,
    base_score: float = 0.55,
    exclusions: tuple[str, ...] = (),
) -> SemanticRule:
    return SemanticRule(
        id=rule_id,
        category=category,
        languages=(language,),
        patterns=patterns,
        concepts=concepts,
        base_score=base_score,
        exclusions=exclusions,
    )


SEMANTIC_RULES: tuple[SemanticRule, ...] = (
    # Legal and consent copy must be evaluated before positive wording.
    _rule(
        "consent_legal_fr",
        "consent_legal",
        "fr",
        (
            r"\b(?:vous\s+)?confirmez?\s+avoir\s+pris\s+connaissance\b",
            r"\ben\s+validant\s+(?:votre|la)\s+(?:demande|formulaire)\b",
            r"\bj\s+ai\s+lu\s+et\s+j\s+accepte\b",
            r"\b(?:j\s+)?accepte\s+(?:les?|des?)\s+(?:termes|conditions)\b",
            r"\bpolitique\s+(?:de\s+)?(?:confidentialite|protection\s+des\s+donnees)\b",
            r"\bconsentement\s+au\s+traitement\b",
            r"\bautorise\s+(?:le|la)\s+(?:traitement|collecte)\s+de\s+mes\s+donnees\b",
        ),
        ("consent", "legal_notice"),
        base_score=0.9,
        exclusions=(
            r"\b(?:veuillez|merci\s+de|vous\s+devez|il\s+faut)\s+(?:cocher|accepter|consentir)\b",
            r"\b(?:consentement|acceptation)\s+(?:est\s+)?(?:requis|requise|obligatoire|manquant|manquante)\b",
        ),
    ),
    _rule(
        "consent_legal_en",
        "consent_legal",
        "en",
        (
            r"\bby\s+submitting\b.*\b(?:confirm|agree|accept)\b",
            r"\bi\s+(?:have\s+read\s+and\s+)?(?:agree|accept)\b",
            r"\b(?:agree|accept)\s+(?:to\s+)?(?:the\s+)?(?:terms|conditions|privacy\s+policy)\b",
            r"\bprivacy\s+(?:policy|notice)\b",
            r"\bconsent\s+to\s+(?:the\s+)?processing\b",
        ),
        ("consent", "legal_notice"),
        base_score=0.9,
    ),
    _rule(
        "consent_legal_ar",
        "consent_legal",
        "ar",
        (
            r"(?:اوافق|أوافق)\s+على\s+(?:الشروط|سياسة\s+الخصوصية)",
            r"بالموافقة.*(?:تقر|أقر|اقر)",
            r"سياسة\s+الخصوصية",
            r"الموافقة\s+على\s+معالجة\s+البيانات",
        ),
        ("consent", "legal_notice"),
        base_score=0.9,
    ),
    # Validation messages.
    _rule(
        "validation_required_fr",
        "validation",
        "fr",
        (
            r"\b(?:champ|valeur|information|donnee)\w*\s+(?:est\s+)?(?:obligatoire|requise?|manquante?|vide)\b",
            r"\b(?:obligatoire|requis|required)\b",
            r"\bveuillez\s+(?:remplir|renseigner|saisir|selectionner|choisir|cocher|accepter)\b",
            r"\b(?:vous\s+)?devez\s+(?:remplir|renseigner|selectionner|cocher|accepter)\b",
            r"\b(?:ce|le|la)\s+(?:champ|zone|case)\s+ne\s+peut\s+pas\s+etre\s+vide\b",
            r"\b(?:merci\s+de|priere\s+de)\s+(?:renseigner|remplir|saisir|selectionner|cocher|accepter)\b",
            r"\b(?:information|valeur|selection|reponse)\s+(?:attendue|necessaire)\b",
            r"\b(?:au\s+moins|un\s+minimum\s+de)\s+un(?:e)?\s+(?:valeur|option|choix|reponse)\b",
            r"\b(?:consentement|acceptation)\s+(?:est\s+)?(?:requis|requise|obligatoire|manquant|manquante)\b",
        ),
        ("required_field",),
    ),
    _rule(
        "validation_invalid_fr",
        "validation",
        "fr",
        (
            r"\b(?:n|ne)\s+est\s+pas\s+valide\b",
            r"\b(?:non\s+valide|invalide|incorrecte?)\b",
            r"\bformat\s+(?:incorrect|invalide|non\s+conforme)\b",
            r"\b(?:adresse\s+(?:de\s+courriel|email)|courriel|e\s*mail|telephone|date|url)\b.*\b(?:invalide|incorrect|non\s+valide|n\s+est\s+pas\s+valide)\b",
            r"\bmessage\s+d\s+erreur\b",
            r"\bveuillez\s+(?:corriger|verifier)\b",
            r"\b(?:saisie|valeur|donnee|adresse)\s+(?:erronee|incorrecte|invalide|non\s+conforme)\b",
            r"\b(?:adresse\s+electronique|numero\s+de\s+telephone|code\s+postal)\b.*\b(?:incorrect|invalide|non\s+conforme)\b",
            r"\bformat\s+attendu\b",
            r"\b(?:caractere|caracteres)\s+(?:non\s+autorise|interdit|invalide)\w*\b",
            r"\bne\s+respecte\s+pas\s+(?:le\s+)?format\b",
        ),
        ("invalid_format",),
    ),
    _rule(
        "validation_constraints_fr",
        "validation",
        "fr",
        (
            r"\b(?:trop\s+court|trop\s+long|longueur\s+(?:minimale|maximale))\b",
            r"\b(?:minimum|maximum)\s+de\s+\d+\b",
            r"\b(?:hors\s+limites?|doit\s+etre\s+compris)\b",
            r"\b(?:valeurs?|mots?\s+de\s+passe)\b.*\b(?:ne\s+correspondent\s+pas|differentes?)\b",
            r"\b(?:fichier|piece\s+jointe)\b.*\b(?:requis|manquant|trop\s+volumineux|non\s+autorise|format\s+invalide)\b",
            r"\b(?:captcha|consentement)\b.*\b(?:requis|obligatoire|manquant)\b",
            r"\bdoit\s+(?:contenir|comporter|faire)\s+(?:au\s+moins|au\s+maximum|entre)\b",
            r"\b(?:au\s+moins|au\s+maximum|pas\s+plus\s+de)\s+\d+\s+(?:caracteres?|chiffres?|elements?|fichiers?)\b",
            r"\b(?:inferieur|superieur)\s+(?:a|ou\s+egal\s+a)\s+\d+\b",
            r"\b(?:extension|type\s+de\s+fichier)\s+(?:non\s+autorisee?|interdite?|non\s+prise\s+en\s+charge)\b",
            r"\b(?:extension|type\s+de\s+fichier)\b.*\b(?:n\s+est\s+pas\s+autorisee?|n\s+est\s+pas\s+prise\s+en\s+charge)\b",
            r"\b(?:date|heure|creneau)\s+(?:non\s+disponible|hors\s+plage|anterieure|posterieur)\w*\b",
        ),
        ("constraint_violation",),
    ),
    _rule(
        "validation_required_en",
        "validation",
        "en",
        (
            r"\b(?:this\s+)?(?:field|value|information)\s+is\s+required\b",
            r"\brequired\s+(?:field|value)\b",
            r"\bplease\s+(?:fill|enter|provide|select|choose|check|accept)\b",
            r"\bmust\s+(?:be\s+filled|be\s+selected|be\s+checked|accept)\b",
        ),
        ("required_field",),
    ),
    _rule(
        "validation_invalid_en",
        "validation",
        "en",
        (
            r"\b(?:is\s+not\s+valid|not\s+valid|invalid|incorrect)\b",
            r"\b(?:incorrect|invalid|unsupported)\s+format\b",
            r"\b(?:email|phone|date|url|value)\b.*\b(?:invalid|incorrect|not\s+valid)\b",
            r"\berror\s+message\b",
            r"\bplease\s+(?:correct|verify)\b",
        ),
        ("invalid_format",),
    ),
    _rule(
        "validation_constraints_en",
        "validation",
        "en",
        (
            r"\b(?:too\s+short|too\s+long|minimum\s+length|maximum\s+length)\b",
            r"\b(?:out\s+of\s+range|must\s+be\s+between)\b",
            r"\b(?:values?|passwords?)\s+(?:do\s+not|don\s+t)\s+match\b",
            r"\bfile\b.*\b(?:required|missing|too\s+large|unsupported|not\s+allowed)\b",
            r"\b(?:captcha|consent)\b.*\b(?:required|missing)\b",
        ),
        ("constraint_violation",),
    ),
    _rule(
        "validation_required_ar",
        "validation",
        "ar",
        (
            r"(?:ال)?(?:حقل|قيمة|معلومة)\s+(?:ال)?(?:مطلوب|اجباري)",
            r"(?:يرجي|الرجاء)\s+(?:ادخال|اختيار|تحديد|الموافقة|تصحيح)",
            r"يجب\s+(?:ادخال|اختيار|الموافقة)",
            r"البيانات\s+(?:غير\s+مكتملة|ناقصة)",
        ),
        ("required_field",),
    ),
    _rule(
        "validation_invalid_ar",
        "validation",
        "ar",
        (
            r"(?:قيمة|بيانات|بريد|البريد\s+الإلكتروني|البريد\s+الالكتروني|هاتف|تاريخ).*(?:غير\s+صالح|غير\s+صحيحة|غير\s+صحيح)",
            r"(?:صيغة|تنسيق)\s+(?:غير\s+صحيح|غير\s+مدعوم)",
            r"(?:خطأ|رسالة\s+خطأ)",
            r"تجاوز\s+(?:الحد|الحجم)\s+المسموح",
        ),
        ("invalid_format",),
    ),
    # Business rejections and negated submission outcomes.
    _rule(
        "business_rejection_fr",
        "business_rejection",
        "fr",
        (
            r"\b(?:demande|requete|paiement|commande|operation|envoi)\b.*\b(?:refuse|rejete|impossible|echoue|non\s+autorise)\b",
            r"\b(?:impossible|echec)\s+(?:de|du|d)\s*(?:envoyer|envoi|traiter|paiement)\b",
            r"\b(?:identifiants?|mot\s+de\s+passe)\s+(?:sont\s+|est\s+)?(?:incorrects?|invalides?)\b",
            r"\b(?:acces|connexion)\s+(?:refuse|non\s+autorise)\b",
            r"\bcompte\s+(?:est\s+)?(?:inexistant|desactive|verrouille)\b",
            r"\b(?:adresse|email)\s+(?:est\s+)?deja\s+(?:inscrite|enregistree|utilisee)\b",
            r"\b(?:creneau|stock|service)\b.{0,80}\b(?:est\s+)?indisponible\b",
            r"\b(?:n|ne)\s+a\s+pas\s+ete\s+(?:envoyee?|transmise?|recue?|enregistree?|traitee?)\b",
            r"\b(?:nous\s+ne\s+pouvons\s+pas|il\s+n\s+est\s+pas\s+possible)\s+(?:de\s+)?(?:accepter|traiter|enregistrer|valider)\b",
            r"\b(?:authentification|connexion)\s+(?:a\s+echoue|impossible)\b",
            r"\b(?:utilisateur|client|dossier|commande)\s+(?:est\s+)?(?:introuvable|inconnu|non\s+eligible)\b",
            r"\b(?:offre|produit|option|reservation)\s+(?:n\s+est\s+plus\s+disponible|indisponible)\b",
            r"\b(?:transaction|paiement)\s+(?:annule|refuse|non\s+abouti)\b",
        ),
        ("business_rejection",),
    ),
    _rule(
        "business_rejection_en",
        "business_rejection",
        "en",
        (
            r"\b(?:request|submission|payment|order|operation)\b.*\b(?:rejected|denied|declined|failed|not\s+authorized)\b",
            r"\b(?:could\s+not|unable\s+to|failed\s+to)\s+(?:send|submit|process|complete)\b",
            r"\bcould\s+not\s+(?:be\s+)?(?:successfully\s+)?(?:sent|submitted|received|recorded|processed)\b",
            r"\b(?:invalid|incorrect)\s+(?:credentials|username|password)\b",
            r"\baccount\s+(?:not\s+found|disabled|locked)\b",
            r"\b(?:email|address)\s+already\s+(?:registered|used|exists)\b",
            r"\b(?:slot|stock|service)\s+(?:unavailable|not\s+available)\b",
            r"\b(?:was|has)\s+not\s+been\s+(?:sent|submitted|received|recorded)\b",
        ),
        ("business_rejection",),
    ),
    _rule(
        "business_rejection_ar",
        "business_rejection",
        "ar",
        (
            r"(?:تم\s+)?رفض\s+(?:الطلب|الدفع|العملية)",
            r"(?:تعذر|فشل)\s+(?:إرسال|ارسال|معالجة|إتمام|اتمام)",
            r"(?:بيانات|كلمة\s+المرور|اسم\s+المستخدم)\s+(?:غير\s+صحيحة|غير\s+صحيح)",
            r"الحساب\s+(?:غير\s+موجود|معطل|مقفل)",
            r"(?:البريد|العنوان)\s+مسجل\s+مسبقا",
            r"(?:الموعد|المخزون|الخدمة)\s+غير\s+متاح",
            r"لم\s+يتم\s+(?:ارسال|الارسال|التسجيل|المعالجة)(?:\s+(?:الطلب|الرسالة))?",
        ),
        ("business_rejection",),
    ),
    # Explicit positive outcomes. Generic isolated words are intentionally absent.
    _rule(
        "success_submission_fr",
        "success",
        "fr",
        (
            r"\b(?:demande|message|formulaire|inscription|commande)\b.*\b(?:envoyee?|transmise?|recue?|enregistree?|confirmee?|prise?\s+en\s+compte)\b",
            r"\b(?:nous\s+)?avons\s+bien\s+recu[e]?\s+(?:votre|la)\s+(?:demande|message|inscription|commande)\b",
            r"\bmerci\s+(?:pour|de)\s+(?:votre|nous)\s+(?:demande|message|contact|inscription|commande|avoir\s+contacte)\b",
            r"\b(?:nous\s+allons\s+vous\s+contacter|nous\s+vous\s+contacterons)\b",
            r"\b(?:compte|inscription)\s+(?:cree|effectue|valide)\b",
            r"\b(?:paiement|operation)\s+(?:accepte|effectue)\b.*\b(?:succes|correctement)?\b",
            r"\b(?:votre|le)\s+(?:message|demande|formulaire)\s+(?:nous\s+)?(?:est\s+)?bien\s+parvenu[e]?\b",
            r"\b(?:nous\s+)?accusons\s+reception\s+de\s+(?:votre|la)\s+(?:demande|message|commande)\b",
            r"\b(?:soumission|inscription|reservation|commande)\s+(?:effectuee?|validee?|finalisee?)\s+(?:avec\s+succes|correctement)\b",
            r"\b(?:votre|le|la)?\s*(?:demande|dossier|ticket)\s+(?:a\s+ete|est)?\s*(?:enregistre|cree)\s+(?:sous|avec)\s+(?:le\s+)?(?:numero|reference)\b",
            r"\bun\s+(?:email|courriel|message)\s+de\s+confirmation\s+(?:vous\s+)?(?:a\s+ete|sera)\s+envoye\b",
            r"\bvotre\s+(?:compte|profil|mot\s+de\s+passe)\s+(?:a\s+ete|est)\s+(?:cree|active|modifie|reinitialise)\b",
        ),
        ("submission_accepted",),
        exclusions=(
            r"\bconfirmez?\s+avoir\s+pris\s+connaissance\b",
            r"\ben\s+validant\s+(?:votre|la)\s+demande\b",
        ),
    ),
    _rule(
        "success_submission_en",
        "success",
        "en",
        (
            r"\b(?:request|message|form|submission|registration|order)\b.*\b(?:successfully\s+)?(?:sent|submitted|received|recorded|confirmed)\b",
            r"\bwe\s+(?:have\s+)?received\s+your\s+(?:request|message|submission|order)\b",
            r"\bthank\s+you\s+for\s+(?:your\s+)?(?:request|message|contact|registration|order|contacting|registering)\b",
            r"\bwe\s+will\s+contact\s+you\b",
            r"\b(?:account|registration)\s+(?:created|completed|confirmed)\b",
            r"\b(?:payment|operation)\s+(?:accepted|completed|successful)\b",
        ),
        ("submission_accepted",),
        exclusions=(r"\bby\s+submitting\b.*\b(?:confirm|agree|accept)\b",),
    ),
    _rule(
        "success_submission_ar",
        "success",
        "ar",
        (
            r"تم\s+(?:إرسال|ارسال|استلام|تسجيل|تأكيد|تاكيد)\s+(?:الطلب|الرسالة|التسجيل|العملية)",
            r"شكرا\s+(?:لطلبكم|لرسالتكم|لتواصلكم|لتسجيلكم)",
            r"سنتصل\s+بكم",
            r"تم\s+إنشاء\s+الحساب",
            r"تمت\s+(?:العملية|عملية\s+الدفع)\s+بنجاح",
        ),
        ("submission_accepted",),
    ),
    _rule(
        "technical_error_multi",
        "technical_error",
        "fr",
        (
            r"\berreur\s+(?:serveur|technique|interne)\b",
            r"\bservice\s+(?:est\s+)?(?:temporairement\s+)?indisponible\b",
            r"\bune\s+erreur\s+est\s+survenue\b",
            r"\bincident\s+technique\b",
            r"\bprobleme\s+technique\b",
            r"\b(?:connexion|communication)\s+avec\s+le\s+serveur\s+(?:est\s+)?(?:impossible|interrompue)\b",
            r"\b(?:delai|temps)\s+d\s+attente\s+(?:est\s+)?depasse\b",
            r"\bveuillez\s+reessayer\s+(?:plus\s+tard|ulterieurement)\b",
            r"\btraitement\s+temporairement\s+impossible\b",
        ),
        ("technical_error",),
    ),
    _rule(
        "technical_error_en",
        "technical_error",
        "en",
        (
            r"\b(?:server|technical|internal)\s+error\b",
            r"\bservice\s+(?:temporarily\s+)?unavailable\b",
            r"\bsomething\s+went\s+wrong\b",
        ),
        ("technical_error",),
    ),
    _rule(
        "technical_error_ar",
        "technical_error",
        "ar",
        (
            r"خطأ\s+(?:تقني|في\s+الخادم|داخلي)",
            r"الخدمة\s+غير\s+متاحة",
            r"حدث\s+خطأ",
        ),
        ("technical_error",),
    ),
)


def _repair_mojibake(value: str) -> str:
    raw = value or ""
    markers = ("Ãƒ", "Ã‚", "Ã¢â‚¬", "Ã©", "Ã¨", "Ã ")
    if not any(marker in raw for marker in markers):
        return raw
    candidates = [raw]
    for encoding in ("latin-1", "cp1252"):
        try:
            candidates.append(raw.encode(encoding).decode("utf-8"))
        except (UnicodeEncodeError, UnicodeDecodeError):
            continue
    return min(candidates, key=lambda item: sum(item.count(marker) for marker in markers))


def normalize_semantic_text(value: object) -> str:
    raw = _repair_mojibake(str(value or ""))
    raw = ARABIC_DIACRITICS.sub("", raw)
    raw = raw.translate(
        str.maketrans(
            {
                "أ": "ا",
                "إ": "ا",
                "آ": "ا",
                "ٱ": "ا",
                "ى": "ي",
                "ؤ": "و",
                "ئ": "ي",
                "ـ": "",
            }
        )
    )
    text = unicodedata.normalize("NFKD", raw).casefold()
    text = "".join(char for char in text if not unicodedata.combining(char))
    text = re.sub(r"[^a-z0-9\u0600-\u06ff]+", " ", text)
    return re.sub(r"\s+", " ", text).strip()


def detect_message_language(normalized: str) -> str:
    if ARABIC_TEXT.search(normalized):
        return "ar"
    english_markers = {
        "the",
        "your",
        "please",
        "required",
        "invalid",
        "request",
        "message",
        "account",
        "payment",
        "field",
        "successfully",
        "submitted",
        "received",
    }
    french_markers = {
        "votre",
        "vos",
        "veuillez",
        "merci",
        "demande",
        "champ",
        "nous",
        "vous",
        "obligatoire",
        "invalide",
        "erreur",
        "compte",
        "paiement",
        "formulaire",
        "courriel",
        "adresse",
        "selectionner",
        "renseigner",
    }
    tokens = set(normalized.split())
    english_score = len(tokens & english_markers)
    french_score = len(tokens & french_markers)
    return "en" if english_score >= 2 and english_score > french_score else "fr"


def _row_is_visible_evidence(row: dict[str, Any]) -> bool:
    if row.get("is_new") is False and row.get("is_changed") is False:
        return False
    return True


def _score_rule(row: dict[str, Any], rule: SemanticRule) -> float:
    score = rule.base_score
    if row.get("is_new", True) or row.get("is_changed", False):
        score += 0.2
    role = str(row.get("role") or "").casefold()
    if role in ROLE_BONUS or row.get("aria_live"):
        score += 0.15
    selector_context = " ".join(
        [
            str(row.get("selector") or ""),
            str(row.get("class_name") or ""),
        ]
    ).casefold()
    if SELECTOR_SIGNAL.search(selector_context.replace(".", " ").replace("#", " ")):
        score += 0.1
    if row.get("browser_validation"):
        score += 0.15
    if row.get("network_corroborated"):
        score += 0.1
    return round(min(1.0, score), 4)


def classify_message(row: dict[str, Any]) -> dict[str, Any]:
    text = str(row.get("text") or "").strip()
    normalized = normalize_semantic_text(text)
    language = detect_message_language(normalized)
    base = {
        "text": text[:500],
        "normalized_text": normalized[:500],
        "language": language,
        "selector": str(row.get("selector") or "")[:300],
        "role": str(row.get("role") or "")[:80],
        "source": str(row.get("source") or "scoped_dom")[:80],
        "is_new": bool(row.get("is_new", True)),
        "is_changed": bool(row.get("is_changed", False)),
        "category": "unknown",
        "concepts": [],
        "score": 0.0,
        "excluded": False,
        "exclusion_reason": None,
    }
    if not normalized or not _row_is_visible_evidence(row):
        return {
            **base,
            "category": "neutral",
            "excluded": True,
            "exclusion_reason": "pre_existing_message",
        }

    matches: list[tuple[float, SemanticRule]] = []
    for rule in SEMANTIC_RULES:
        if language not in rule.languages:
            continue
        if any(re.search(pattern, normalized) for pattern in rule.exclusions):
            continue
        if any(re.search(pattern, normalized) for pattern in rule.patterns):
            matches.append((_score_rule(row, rule), rule))

    if not matches:
        return base

    priority = {
        "consent_legal": 7,
        "technical_error": 6,
        "validation": 5,
        "business_rejection": 4,
        "success": 2,
        "neutral": 1,
        "unknown": 0,
    }
    score, selected = max(
        matches,
        key=lambda item: (priority.get(item[1].category, 0), item[0]),
    )
    return {
        **base,
        "category": selected.category,
        "concepts": list(selected.concepts),
        "score": score,
        "rule_id": selected.id,
        "excluded": selected.category == "consent_legal",
        "exclusion_reason": (
            "consent_or_legal_copy" if selected.category == "consent_legal" else None
        ),
    }


def classify_message_evidence(rows: list[dict[str, Any]]) -> dict[str, list[dict[str, Any]]]:
    result: dict[str, list[dict[str, Any]]] = {
        "success_messages": [],
        "validation_messages": [],
        "rejection_messages": [],
        "technical_error_messages": [],
        "consent_legal_messages": [],
        "ambiguous_messages": [],
    }
    category_key = {
        "success": "success_messages",
        "validation": "validation_messages",
        "business_rejection": "rejection_messages",
        "technical_error": "technical_error_messages",
        "consent_legal": "consent_legal_messages",
    }
    seen: set[tuple[str, str]] = set()
    for row in rows:
        evidence = classify_message(row)
        normalized = str(evidence.get("normalized_text") or "")
        category = str(evidence.get("category") or "unknown")
        if not normalized:
            continue
        if 0.4 <= float(evidence.get("score") or 0.0) < 0.65:
            key = ("ambiguous", normalized)
            if key not in seen:
                seen.add(key)
                result["ambiguous_messages"].append(evidence)
            continue
        target = category_key.get(category)
        if not target or float(evidence.get("score") or 0.0) < 0.65:
            continue
        key = (target, normalized)
        if key in seen:
            continue
        seen.add(key)
        result[target].append(evidence)
    return result


def semantic_concepts(value: object, category: str) -> list[str]:
    evidence = classify_message(
        {"text": str(value or ""), "source": "legacy_text", "is_new": True}
    )
    return (
        [str(item) for item in evidence.get("concepts") or []]
        if evidence.get("category") == category
        and float(evidence.get("score") or 0.0) >= 0.65
        else []
    )


def normalized_url_pattern(value: object) -> str:
    try:
        parsed = urlsplit(str(value or ""))
    except ValueError:
        return ""
    path = re.sub(r"/\d+(?=/|$)", "/:id", parsed.path or "/")
    return f"{parsed.scheme.lower()}://{parsed.netloc.lower()}{path.rstrip('/') or '/'}"


def build_semantic_signature(submission: dict[str, Any] | None) -> dict[str, Any]:
    observation = submission or {}
    semantic = (
        observation.get("semantic_dom")
        if isinstance(observation.get("semantic_dom"), dict)
        else {}
    )
    response = (
        observation.get("submission_response")
        if isinstance(observation.get("submission_response"), dict)
        else {}
    )
    fallback_rows = [
        {"text": str(item), "source": "legacy_added_text", "is_new": True}
        for item in observation.get("added_text_snippets") or []
    ]
    fallback_rows.extend(
        {"text": str(item), "source": "legacy_validation", "is_new": True}
        for item in observation.get("validation_messages") or []
    )
    fallback = classify_message_evidence(fallback_rows)
    return {
        "response_status": int(response.get("status") or observation.get("response_status") or 0),
        "response_method": str(response.get("method") or "").upper(),
        "response_url_pattern": normalized_url_pattern(response.get("url")),
        "final_url_pattern": normalized_url_pattern(observation.get("final_url")),
        "form_lifecycle": str(semantic.get("form_lifecycle") or "retained"),
        "success_concepts": sorted(
            {
                str(concept)
                for item in [
                    *(semantic.get("success_messages") or []),
                    *(fallback.get("success_messages") or []),
                ]
                if isinstance(item, dict)
                for concept in item.get("concepts") or []
            }
        ),
        "validation_concepts": sorted(
            {
                str(concept)
                for item in [
                    *(semantic.get("validation_messages") or []),
                    *(fallback.get("validation_messages") or []),
                ]
                if isinstance(item, dict)
                for concept in item.get("concepts") or []
            }
        ),
        "rejection_concepts": sorted(
            {
                str(concept)
                for item in [
                    *(semantic.get("rejection_messages") or []),
                    *(fallback.get("rejection_messages") or []),
                ]
                if isinstance(item, dict)
                for concept in item.get("concepts") or []
            }
        ),
        "invalid_control_count": int(observation.get("invalid_control_count") or 0),
        "dom_changed": bool(observation.get("dom_changed")),
        "url_changed": bool(observation.get("url_changed")),
    }


def reference_quality(
    *,
    execution_status: str,
    submission: dict[str, Any] | None,
    oracle: dict[str, Any] | None,
) -> dict[str, Any]:
    signature = build_semantic_signature(submission)
    score = 0.0
    reasons: list[str] = []
    conflicts: list[str] = []
    if execution_status in {"passed", "pass"}:
        score += 0.15
        reasons.append("execution_complete")
    if signature["success_concepts"]:
        score += 0.45
        reasons.append("explicit_confirmation")
    if 200 <= int(signature["response_status"] or 0) <= 399:
        score += 0.15
        reasons.append("submission_response_ok")
    if signature["form_lifecycle"] in {"removed", "replaced", "reset"}:
        score += 0.1
        reasons.append(f"form_{signature['form_lifecycle']}")
    if signature["url_changed"] or signature["dom_changed"]:
        score += 0.05
        reasons.append("observable_transition")
    oracle_score = float((oracle or {}).get("score") or 0.0)
    score += min(0.1, max(0.0, oracle_score) * 0.1)
    if signature["invalid_control_count"] or signature["validation_concepts"]:
        score -= 0.35
        conflicts.append("validation_present")
    if signature["rejection_concepts"]:
        score -= 0.35
        conflicts.append("rejection_present")
    score = round(max(0.0, min(1.0, score)), 4)
    return {
        "score": score,
        "conclusive": score >= 0.65 and bool(signature["success_concepts"]),
        "reasons": reasons,
        "conflicts": conflicts,
        "signature": signature,
    }


def compare_semantic_signatures(
    current: dict[str, Any] | None,
    reference: dict[str, Any] | None,
) -> dict[str, Any]:
    current_signature = build_semantic_signature(current)
    reference_signature = (
        reference
        if isinstance(reference, dict) and "form_lifecycle" in reference
        else build_semantic_signature(reference)
    )
    if not reference_signature or not any(reference_signature.values()):
        return {
            "available": False,
            "conclusive": False,
            "similarity_score": 0.0,
            "matched_signals": [],
            "conflicting_signals": [],
        }

    matched: list[str] = []
    conflicts: list[str] = []
    weighted_matches = 0.0
    total_weight = 0.0

    def compare(label: str, actual: object, expected: object, weight: float) -> None:
        nonlocal weighted_matches, total_weight
        total_weight += weight
        if actual == expected:
            weighted_matches += weight
            matched.append(label)
        else:
            conflicts.append(label)

    current_status = int(current_signature.get("response_status") or 0)
    reference_status = int(reference_signature.get("response_status") or 0)
    compare(
        "response_status_family",
        current_status // 100 if current_status else 0,
        reference_status // 100 if reference_status else 0,
        0.2,
    )
    compare(
        "response_method",
        current_signature.get("response_method"),
        reference_signature.get("response_method"),
        0.05,
    )
    compare(
        "response_path",
        current_signature.get("response_url_pattern"),
        reference_signature.get("response_url_pattern"),
        0.15,
    )
    compare(
        "final_url",
        current_signature.get("final_url_pattern"),
        reference_signature.get("final_url_pattern"),
        0.1,
    )
    compare(
        "form_lifecycle",
        current_signature.get("form_lifecycle"),
        reference_signature.get("form_lifecycle"),
        0.15,
    )
    current_success = set(current_signature.get("success_concepts") or [])
    reference_success = set(reference_signature.get("success_concepts") or [])
    total_weight += 0.3
    if reference_success and current_success & reference_success:
        weighted_matches += 0.3
        matched.append("success_concepts")
    else:
        conflicts.append("success_concepts")
    compare(
        "no_validation",
        not bool(
            current_signature.get("invalid_control_count")
            or current_signature.get("validation_concepts")
        ),
        not bool(
            reference_signature.get("invalid_control_count")
            or reference_signature.get("validation_concepts")
        ),
        0.05,
    )
    score = round(weighted_matches / total_weight if total_weight else 0.0, 4)
    return {
        "available": True,
        "conclusive": score >= 0.7,
        "similarity_score": score,
        "matched_signals": matched,
        "conflicting_signals": conflicts,
        "current_signature": current_signature,
    }
