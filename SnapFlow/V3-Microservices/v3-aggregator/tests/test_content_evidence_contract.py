"""Test final content verdicts against pre-authored producer evidence."""
import json
import hashlib
from pathlib import Path

import pytest

import test_form_fuzzer_kpi as report_fixtures
import main
from kpi_builder import build_kpi_centric_report
from classifier import build_recommendations

CASES = json.loads((Path(__file__).parents[2] / 'benchmarks/thin_content_contract_cases.json').read_text(encoding='utf-8'))['cases']


@pytest.fixture
def report_builder():
    harness = report_fixtures.TestFormFuzzerKPIInBuildReport()
    harness.setUp()
    def build(payloads):
        rows = []
        for path, payload in payloads:
            row = harness._minimal_page_row()
            row['url'] = path if path.startswith('https://') else 'https://example.com/' + path
            row['nlp_results'] = payload
            rows.append(row)
        main.get_db = lambda: report_fixtures._FakeConn(rows, harness._minimal_summary_row(None))
        main._load_form_fuzzer_table_stats = lambda *_args: {}
        return main.build_report('scan_form_fuzzer')
    try:
        yield build
    finally:
        harness.tearDown()


def payload(case, **extra):
    return dict(status='evaluated', word_count=case['word_count'], page_type=case['page_type'],
                content_language=case['language'], content_type_hint='normal', typo_density=0,
                seo_kpis={'thin_content_by_type': {
                    'thin_vs_page_type': case['thin'], 'word_count_threshold': case['threshold'],
                    'word_count_gap': max(0, case['threshold']-case['word_count'])}}, **extra)


def content_kpi(report):
    return build_kpi_centric_report(report)['axes']['Contenu']['Contenu Fin et Qualité']


def test_nested_measurement_metadata_can_be_deduplicated():
    from kpi_builder import _unique_digest_rows
    first = {'page_url':'https://fixture.test', 'scope':{'checked':100,'languages':['fr','en']}}
    second = {'scope':{'languages':['fr','en'],'checked':100}, 'page_url':'https://fixture.test'}
    rows = _unique_digest_rows([first, second])
    assert len(rows) == 1 and rows[0]['page_url'] == first['page_url']


@pytest.mark.parametrize('case', CASES, ids=[case['id'] for case in CASES])
def test_producer_page_type_and_language_reach_the_final_verdict(report_builder, case):
    report = report_builder([(case['id'], payload(case))])
    content = report['site_metrics']['content']
    assert content['pages_thin_content_nlp'] == int(case['thin'])
    assert content['thin_content_evaluation']['page_type_evaluated_pages'] == 1
    kpi = content_kpi(report)
    assert kpi['status'] == ('failing' if case['thin'] else 'passing')
    assert (kpi['severity'] is None) == (not case['thin'])
    serialized = json.dumps(kpi, ensure_ascii=False)
    assert '<300' not in serialized and '< 300' not in serialized
    if case['thin']:
        assert kpi['data']['rows'][0]['word_count_threshold'] == case['threshold']
        assert kpi['data']['rows'][0]['word_count_gap'] == case['threshold']-case['word_count']
        assert kpi['pages_affected_urls'] == ['https://example.com/' + case['id']]


def test_failed_spelling_provider_is_not_a_clean_content_verdict(report_builder):
    case = next(case for case in CASES if not case['thin'])
    scope = dict(status='partial', checked_word_count=0, languages_checked=[], unmeasured_languages={'fr': case['word_count']})
    report = report_builder([('service', payload(case, spelling_scope=scope))])
    spelling = report['site_metrics']['content']['typo_detection']
    assert spelling['evaluation']['unknown_pages'] == 1
    assert spelling['avg_typo_density'] is None and spelling['passed'] is None
    kpi = content_kpi(report)
    assert kpi['status'] == 'not_evaluated'  # existing canonical normalization
    assert kpi['data']['spelling_evaluation']['unknown_pages'] == 1


def test_measured_content_defect_survives_unavailable_spelling(report_builder):
    case = next(case for case in CASES if case['thin'])
    scope = dict(status='partial', checked_word_count=0, unmeasured_languages={'fr': case['word_count']})
    report = report_builder([('service', payload(case, spelling_scope=scope))])
    kpi = content_kpi(report)
    assert kpi['status'] == 'failing'
    assert kpi['pages_affected'] == 1
    assert kpi['data']['rows'][0]['typo_density'] is None
    assert kpi['data']['rows'][0]['thin_content_signal'] is True


def test_quality_counts_and_urls_are_a_union_without_duplicate_rows(report_builder):
    thin = dict(CASES[2], word_count=120)
    adequate = dict(CASES[4], word_count=400)
    first = payload(thin)
    first.update(content_type_hint='stuffed', typo_density=.12)
    second = payload(adequate)
    second['content_type_hint'] = 'stuffed'
    third = payload(adequate)
    third['typo_density'] = .12
    report = report_builder([('mixed', first), ('stuffed', second), ('typos', third)])
    content = report['site_metrics']['content']
    assert content['pages_thin_content_nlp'] == 1
    assert content['pages_with_keyword_stuffing'] == 2
    assert content['typo_detection']['pages_with_typos'] == 2
    assert len(content['thin_content_rows']) == 3
    assert len({row['page_url'] for row in content['thin_content_rows']}) == 3
    kpi = content_kpi(report)
    assert kpi['pages_affected'] == 3
    assert '1 page(s) sous' in kpi['constat']
    assert '2 page(s) avec une densité' in kpi['constat']
    assert '2 page(s) avec du keyword' in kpi['constat']
    assert '3 page(s) distincte(s)' in kpi['constat']
    assert set(kpi['pages_affected_urls']) == {'https://example.com/' + path for path in ('mixed', 'stuffed', 'typos')}


def test_word_count_is_not_fabricated_when_missing(report_builder):
    report = report_builder([('unknown', {'status':'evaluated', 'page_type':'news'})])
    content = report['site_metrics']['content']
    assert content['pages_thin_content_nlp'] == 0
    assert content['thin_content_evaluation']['unknown_pages'] == 1


@pytest.mark.parametrize('measured', [None, {}, {'word_count_threshold': 500, 'thin_vs_page_type': False}])
def test_invalid_producer_measurement_is_not_replaced_with_a_global_rule(report_builder, measured):
    analysis = payload(CASES[2])  # 350 words is thin for this existing news policy.
    analysis['seo_kpis']['thin_content_by_type'] = measured
    content = report_builder([('news', analysis)])['site_metrics']['content']
    assert content['thin_content_evaluation']['unknown_pages'] == 1
    assert content['thin_content_evaluation']['legacy_evaluated_pages'] == 0


def test_older_count_only_analysis_keeps_its_explicit_compatibility_source(report_builder):
    content = report_builder([('legacy', {'status': 'evaluated', 'word_count': 200})])['site_metrics']['content']
    assert content['pages_thin_content_nlp'] == 1
    assert content['thin_content_evaluation']['legacy_evaluated_pages'] == 1
    assert content['thin_content_rows'][0]['rule_source'] == 'legacy_word_count'


def test_utility_exclusion_uses_route_not_a_substring_in_the_domain(report_builder):
    report = report_builder([('https://research.example/news/cartography', payload(CASES[2])),
                             ('https://example.com/cart', payload(CASES[2]))])
    content = report['site_metrics']['content']
    assert content['pages_thin_content_nlp'] == 1
    assert content['thin_content_evaluation']['excluded_utility_pages'] == 1


def test_recommendation_no_longer_claims_every_flagged_page_has_under_300_words(report_builder):
    report = report_builder([('news', payload(CASES[2]))])
    recommendations = build_recommendations('scan_form_fuzzer', report_builder=lambda _: report, scan_meta={})
    # Recommendations may be organized into category buckets; inspect the
    # serialized finding independent of their presentation grouping.
    serialized = json.dumps(recommendations, ensure_ascii=False)
    assert 'thin_content_pages' in serialized
    assert 'moins de 300' not in serialized


def passage_analysis(similarity=.99, complete=True):
    analysis = payload(CASES[4])
    text = 'Cancellation requires a fee of 30 euros.'
    analysis['content_revision'] = 7
    analysis['semantic_enrichment'] = {
        'available': True, 'model': 'pinned-study-model',
        'passage_retrieval': {
            'available': True, 'source': 'extracted_content_text', 'normalization': 'strip',
            'text_sha256': hashlib.sha256(text.encode('utf-8')).hexdigest(),
            'complete': complete, 'total_tokens': 40, 'processed_tokens': 40 if complete else 20,
            'matches': {name: dict(text=text, query='Free cancellation', char_start=0, char_end=len(text),
                                  token_start=0, token_end=10, similarity=similarity)
                        for name in ('h1_body_similarity', 'meta_body_similarity')},
        },
    }
    return analysis


@pytest.mark.parametrize('similarity,complete', [(.99, True), (-.6, False)])
def test_passage_observation_reaches_final_data_without_deciding_the_verdict(report_builder, similarity, complete):
    report = report_builder([('terms', passage_analysis(similarity, complete))])
    final = build_kpi_centric_report(report)
    for name in ('Qualité H1 (NLP)', 'Méta Description (NLP)'):
        kpi = final['axes']['SEO'][name]
        evidence = kpi['data']['related_passages'][0]
        assert evidence['page_url'] == 'https://example.com/terms'
        assert evidence['content_revision'] == 7
        assert evidence['query'] == 'Free cancellation'
        assert 'fee of 30 euros' in evidence['text']
        assert evidence['char_end'] - evidence['char_start'] == len(evidence['text'])
        assert evidence['complete'] is complete
        assert 'not factual support' in evidence['interpretation']
        assert kpi['status'] == 'passing'  # existing structural rule, regardless of topic score
        assert kpi['pages_affected'] == 0
        assert kpi['pages_affected_urls'] == []


def test_malformed_passage_is_not_projected_as_source_evidence(report_builder):
    analysis = passage_analysis()
    analysis['semantic_enrichment']['passage_retrieval']['matches']['h1_body_similarity']['char_end'] = 10000
    report = report_builder([('terms', analysis)])
    assert report['site_metrics']['seo']['nlp_seo_h1_kpi']['related_passages'] == []
    assert len(report['site_metrics']['seo']['nlp_seo_meta_kpi']['related_passages']) == 1
