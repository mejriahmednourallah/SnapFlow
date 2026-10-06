"""Consume saved real worker outputs through the actual report builders.

Database/crawl/browser enrichment are fixture adapters, not live services.
"""
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'V3-Microservices/v3-aggregator'))
sys.path.insert(0, str(ROOT / 'V3-Microservices/v3-aggregator/tests'))
import test_form_fuzzer_kpi as fixtures
import main
from kpi_builder import build_kpi_centric_report

source = ROOT / 'output/nlp-accuracy-study/production-content-pipeline.json'
captures = json.loads(source.read_text(encoding='utf-8'))
reports = []
for engine in ('chromium', 'obscura'):
    selected = [item for item in captures['observations'] if item['label'].get('engine') == engine]
    if not selected:
        raise RuntimeError(f'No captured worker observations for {engine}')
    harness = fixtures.TestFormFuzzerKPIInBuildReport()
    harness.setUp()
    try:
        rows = []
        for item in selected:
            row = harness._minimal_page_row()
            row.update(url=item['page_url'], nlp_results=item['nlp_results'])
            rows.append(row)
        main.get_db = lambda: fixtures._FakeConn(rows, harness._minimal_summary_row(None))
        main._load_form_fuzzer_table_stats = lambda *_args: {}
        report = main.build_report('scan_form_fuzzer')
        final = build_kpi_centric_report(report)
        content = report['site_metrics']['content']
        expected_thin = sum(item['nlp_results']['seo_kpis']['thin_content_by_type']['thin_vs_page_type'] for item in selected)
        assert content['pages_thin_content_nlp'] == expected_thin
        assert content['thin_content_evaluation']['page_type_evaluated_pages'] == len(selected)
        assert content['thin_content_evaluation']['unknown_pages'] == 0
        quality = final['axes']['Contenu']['Contenu Fin et Qualité']
        expected_urls = {item['page_url'] for item in selected if
            item['nlp_results']['seo_kpis']['thin_content_by_type']['thin_vs_page_type'] or
            item['nlp_results'].get('typo_density', 0) >= .08 or
            item['nlp_results'].get('content_type_hint') == 'stuffed'}
        assert quality['pages_affected'] == len(expected_urls)
        assert set(quality['pages_affected_urls']) == expected_urls
        assert len(content['thin_content_rows']) == len(expected_urls)
        reports.append(dict(engine=engine, page_count=len(selected), thin_content_count=expected_thin,
                            evaluation=content['thin_content_evaluation'], quality_kpi=quality))
    finally:
        harness.tearDown()

passage_reports = []
passage_source = ROOT / 'output/nlp-accuracy-study/production-content-passages-contract.json'
if passage_source.exists():
    retrieved = json.loads(passage_source.read_text(encoding='utf-8'))
    for item in retrieved['observations']:
        assert item['source_span_exact'] and item['retrieval_evidence_present']
        harness = fixtures.TestFormFuzzerKPIInBuildReport()
        harness.setUp()
        try:
            row = harness._minimal_page_row()
            row['url'] = f"https://fixture.test/{item['language']}/{item['position']}"
            row['nlp_results'] = dict(status='evaluated', content_revision=3, content_language=item['language'],
                word_count=item['body_word_count'], semantic_enrichment=item['semantic_enrichment'])
            main.get_db = lambda: fixtures._FakeConn([row], harness._minimal_summary_row(None))
            main._load_form_fuzzer_table_stats = lambda *_args: {}
            final = build_kpi_centric_report(main.build_report('scan_form_fuzzer'))
            projected = {}
            for name in ('Qualité H1 (NLP)', 'Méta Description (NLP)'):
                kpi = final['axes']['SEO'][name]
                evidence = kpi['data']['related_passages'][0]
                assert evidence['query'] == item['query']
                assert item['expected_evidence'] in evidence['text']
                assert evidence['complete'] is True
                assert kpi['status'] == 'passing'
                assert kpi['pages_affected'] == 0 and kpi['pages_affected_urls'] == []
                projected[name] = evidence
            passage_reports.append(dict(language=item['language'],position=item['position'],related_passages=projected))
        finally:
            harness.tearDown()

path = ROOT / 'output/nlp-accuracy-study/production-content-report.json'
path.write_text(json.dumps(dict(source=str(source),methodology='Real packaged worker outputs; host report builders with fixture DB/enrichment',
                               reports=reports, passage_source=str(passage_source) if passage_reports else None,
                               passage_reports=passage_reports),ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps([dict(engine=item['engine'],pages=item['page_count'],thin=item['thin_content_count'],
                       affected=item['quality_kpi']['pages_affected']) for item in reports]))
print(json.dumps({'passage_cases':len(passage_reports),'kpi_adapters_per_case':2}))
