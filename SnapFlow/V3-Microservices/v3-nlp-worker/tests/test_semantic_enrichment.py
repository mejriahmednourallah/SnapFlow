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
        self.calls = 0

    def encode(self, texts, **_kwargs):
        self.calls += 1
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
    assert fake_model.calls == 1
    assert fake_model.encoded_texts.count("same body content with enough words") == 1
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


def test_repeated_title_and_heading_are_encoded_once(monkeypatch):
    model = FakeSemanticModel()
    monkeypatch.setattr(nlp, "NLP_SEMANTIC_ENABLED", True)
    monkeypatch.setattr(nlp, "_load_semantic_model", lambda: model)
    result = nlp.build_semantic_enrichment("same heading", "", "same heading", "same body")
    assert model.encoded_texts == ["same heading", "same body"]
    assert result["meta_body_similarity"] is None
    assert result["h1_body_similarity"] == result["title_body_similarity"] == 1.0


def test_missing_headings_need_no_inference(monkeypatch):
    model = FakeSemanticModel()
    monkeypatch.setattr(nlp, "NLP_SEMANTIC_ENABLED", True)
    monkeypatch.setattr(nlp, "_load_semantic_model", lambda: model)
    result = nlp.build_semantic_enrichment("", "", "", "same body")
    assert model.calls == 0
    assert result["semantic_alignment_score"] is None


def test_passage_ingestion_reaches_late_text_without_changing_legacy_scores(monkeypatch):
    from test_content_passages import WordTokenizer

    model = FakeSemanticModel()
    model.tokenizer = WordTokenizer()
    model.max_seq_length = 18
    monkeypatch.setattr(nlp, "NLP_SEMANTIC_ENABLED", True)
    monkeypatch.setattr(nlp, "NLP_PASSAGE_RETRIEVAL_ENABLED", True)
    monkeypatch.setattr(nlp, "NLP_SEMANTIC_MAX_CHARS", 30)
    monkeypatch.setattr(nlp, "NLP_PASSAGE_MAX_WINDOWS", 20)
    monkeypatch.setattr(nlp, "_load_semantic_model", lambda: model)
    body = " ".join(["different"] * 80 + ["same final evidence"])

    result = nlp.build_semantic_enrichment("same query", "", "same query", body)

    assert model.calls == 1
    assert model.encoded_texts.count("same query") == 1
    assert any("final evidence" in text for text in model.encoded_texts)
    assert result["title_body_similarity"] == 0.0
    assert result["h1_body_similarity"] == 0.0
    retrieval = result["passage_retrieval"]
    assert retrieval["complete"]
    assert retrieval["source"] == "extracted_content_text"
    match = retrieval["matches"]["title_body_similarity"]
    assert body[match["char_start"]:match["char_end"]] == match["text"]
    import hashlib
    assert retrieval['text_sha256'] == hashlib.sha256(body.encode('utf-8')).hexdigest()
    assert retrieval['normalization'] == 'strip'
    assert match['query'] == 'same query'
    assert "not factual support" in match["interpretation"]


def test_passage_flag_off_preserves_semantic_output(monkeypatch):
    model = FakeSemanticModel()
    monkeypatch.setattr(nlp, "NLP_SEMANTIC_ENABLED", True)
    monkeypatch.setattr(nlp, "NLP_PASSAGE_RETRIEVAL_ENABLED", False)
    monkeypatch.setattr(nlp, "_load_semantic_model", lambda: model)
    result = nlp.build_semantic_enrichment("same title", "", "", "same body")
    assert "passage_retrieval" not in result
    assert model.encoded_texts == ["same title", "same body"]
