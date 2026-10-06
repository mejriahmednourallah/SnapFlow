"""Existing policy consistency, including the actual worker publishing path.

These fixtures are not independent labels of semantic content quality.
"""
import json
from pathlib import Path
import sys

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import main as nlp

CASES = json.loads((Path(__file__).parents[2] / 'benchmarks/thin_content_contract_cases.json').read_text(encoding='utf-8'))['cases']


@pytest.mark.parametrize('case', CASES, ids=[case['id'] for case in CASES])
def test_existing_policy_preserves_measured_inputs(case):
    result = nlp.check_thin_content_by_type(case['word_count'], case['page_type'], case['language'])
    assert result['thin_vs_page_type'] is case['thin']
    assert result['word_count_threshold'] == case['threshold']
    assert result['word_count_gap'] == max(0, case['threshold'] - case['word_count'])
    assert result['word_count'] == case['word_count']
    assert result['page_type'] == case['page_type']
    assert result['language'] == case['language']
    assert result['method'] == 'page_type_word_benchmark'


@pytest.mark.parametrize('regional,language', [('fr-FR', 'fr'), ('FR_ca', 'fr'), ('ar-TN', 'ar')])
def test_regional_language_uses_the_same_existing_policy(regional, language):
    result = nlp.check_thin_content_by_type(70, 'contact', regional)
    expected = nlp.check_thin_content_by_type(70, 'contact', language)
    assert result == expected


@pytest.mark.parametrize('text,language', [('Contactez notre équipe.', 'fr'), ('تواصل مع فريقنا.', 'ar')])
def test_short_content_keeps_declared_language_for_downstream_policy(text, language):
    result = nlp.analyze_content(text, html=f'<html lang="{language}"></html>')
    assert result['content_type_hint'] == 'insufficient_content'
    assert result['content_language'] == language


def test_actual_worker_publishes_policy_for_the_detected_language(monkeypatch):
    class Cursor:
        def close(self):
            pass

    class Connection:
        def cursor(self, **_kwargs):
            return Cursor()
        def close(self):
            pass
        def rollback(self):
            pytest.fail('Production worker rolled back unexpectedly')

    texts = {
        'fr': 'Notre équipe vous accompagne avec des services professionnels adaptés à vos besoins. ' * 12,
        'ar': 'فريقنا يقدم خدمات مهنية لمساعدتك في اختيار حلول مناسبة لاحتياجاتك. ' * 12,
    }
    rows = iter([
        dict(id=index, url=f'https://fixture.test/{language}/contact', content_revision=2,
             raw_html=f'<html lang="{language}"><title>Contact</title><main><h1>Contact</h1><p>{text}</p></main></html>',
             metrics={'response_headers': {'last-modified': 'Wed, 01 Oct 2025 10:00:00 GMT'}})
        for index, (language, text) in enumerate(texts.items(), start=1)
    ])
    published = []
    monkeypatch.setattr(nlp, 'get_db_connection', Connection)
    monkeypatch.setattr(nlp, 'claim_page', lambda *_args: next(rows, None))
    def publish(_conn, _cur, row, result):
        published.append((row['url'], json.loads(result)))
        return True
    monkeypatch.setattr(nlp, 'publish_page', publish)
    monkeypatch.setattr(nlp, '_head_last_modified_date', lambda *_args: pytest.fail('Captured headers must prevent a HEAD request'))
    monkeypatch.setattr(nlp, '_detect_typo_density', lambda *_args, **_kwargs: (0.0, [], 0, True))
    monkeypatch.setattr(nlp, '_load_spacy_model', lambda: None)
    monkeypatch.setattr(nlp, 'check_llms_txt', lambda *_args: {'llms_txt_present': False, 'status_code': 404})
    monkeypatch.setattr(nlp, 'NLP_SEMANTIC_ENABLED', False)

    assert nlp.process_pending_pages() == 2
    for url, result in published:
        language = url.split('/')[-2]
        assert result['status'] == 'evaluated'
        assert result['content_revision'] == 2
        assert result['content_language'] == language
        assert result['page_type'] == 'contact'
        evidence = result['seo_kpis']['thin_content_by_type']
        assert evidence['language'] == language
        assert evidence['word_count'] == result['word_count']
        assert evidence['word_count_threshold'] == {'fr': 68, 'ar': 64}[language]
        assert evidence['thin_vs_page_type'] is False
