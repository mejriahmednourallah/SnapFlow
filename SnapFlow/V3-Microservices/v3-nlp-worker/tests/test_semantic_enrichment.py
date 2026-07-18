import sys
from pathlib import Path
from types import ModuleType


psycopg2_stub = ModuleType("psycopg2")
psycopg2_extras_stub = ModuleType("psycopg2.extras")
psycopg2_extras_stub.RealDictCursor = object
psycopg2_stub.extras = psycopg2_extras_stub
sys.modules.setdefault("psycopg2", psycopg2_stub)
sys.modules.setdefault("psycopg2.extras", psycopg2_extras_stub)

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import main as nlp


class FakeSemanticModel:
    def __init__(self):
        self.encoded_texts = []

    def encode(self, texts, **_kwargs):
        self.encoded_texts.extend(texts)
        vectors = []
        for text in texts:
            if "different" in text:
                vectors.append([0.0, 1.0, 0.0])
            else:
                vectors.append([1.0, 0.0, 0.0])
        return vectors


def test_semantic_enrichment_disabled_returns_none(monkeypatch):
    monkeypatch.setattr(nlp, "NLP_SEMANTIC_ENABLED", False)

    result = nlp.build_semantic_enrichment(
        "Relevant title",
        "Relevant meta",
        "Relevant heading",
        "Relevant body content",
    )

    assert result is None


def test_semantic_enrichment_uses_fake_model_without_storing_vectors(monkeypatch):
    fake_model = FakeSemanticModel()
    monkeypatch.setattr(nlp, "NLP_SEMANTIC_ENABLED", True)
    monkeypatch.setattr(nlp, "NLP_SEMANTIC_MAX_CHARS", 6000)
    monkeypatch.setattr(nlp, "_load_semantic_model", lambda: fake_model)

    result = nlp.build_semantic_enrichment(
        "same title",
        "different meta",
        "same h1",
        "same body content with enough words",
    )

    assert result["enabled"] is True
    assert result["available"] is True
    assert result["title_body_similarity"] == 1.0
    assert result["meta_body_similarity"] == 0.0
    assert result["h1_body_similarity"] == 1.0
    assert result["semantic_alignment_score"] == 67
    assert all(not isinstance(value, list) for value in result.values())


def test_semantic_enrichment_model_unavailable_is_non_fatal(monkeypatch):
    monkeypatch.setattr(nlp, "NLP_SEMANTIC_ENABLED", True)
    monkeypatch.setattr(nlp, "_SEMANTIC_MODEL", None)
    monkeypatch.setattr(nlp, "_SEMANTIC_LOAD_FAILED", False)
    monkeypatch.setattr(nlp, "SentenceTransformer", None)

    result = nlp.build_semantic_enrichment(
        "Relevant title",
        "Relevant meta",
        "Relevant heading",
        "Relevant body content",
    )

    assert result["enabled"] is True
    assert result["available"] is False
    assert result["reason"] == "model_unavailable"


def test_semantic_enrichment_truncates_body_text(monkeypatch):
    fake_model = FakeSemanticModel()
    monkeypatch.setattr(nlp, "NLP_SEMANTIC_ENABLED", True)
    monkeypatch.setattr(nlp, "NLP_SEMANTIC_MAX_CHARS", 10)
    monkeypatch.setattr(nlp, "_load_semantic_model", lambda: fake_model)

    result = nlp.build_semantic_enrichment(
        "same title",
        "",
        "",
        "same body content should be truncated",
    )

    assert result["text_chars_used"] == 10
    assert fake_model.encoded_texts[1] == "same body"
