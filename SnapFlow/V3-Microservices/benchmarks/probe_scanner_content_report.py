"""Build real content KPIs from the isolated scanner/worker PostgreSQL rows."""
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'V3-Microservices/v3-aggregator'))
import main
from kpi_builder import build_kpi_centric_report

assert main.DB_NAME == 'snapflow_evidence'
main._ensure_scan_state_table()
# These browser/visual checks are outside this ingestion acceptance test.
unmeasured = {'status': 'not_evaluated', 'reason': 'outside_ingestion_fixture_scope'}
report = main.build_report('scanner_acquisition_fixture', enrichment_artifacts={
    'footer_rgpd_alignment': unmeasured, 'multi_browser_compatibility': unmeasured})
assert 'error' not in report, report.get('error')
assert report['site_metrics']['seo']['pages_missing_meta_desc'] == 0
content = report['site_metrics']['content']
final = build_kpi_centric_report(report)
quality = final['axes']['Contenu']['Contenu Fin et Qualité']
source = json.loads((ROOT / 'output/nlp-accuracy-study/scanner-worker-handoff.json').read_text(encoding='utf-8'))
urls = {row['url'] for row in source['observations']}
# All six known pages deliberately repeat one sentence 50 times. Quality rows
# must include that observed stuffing, including the sufficiently long homepage.
assert quality['pages_affected'] == 6 and set(quality['pages_affected_urls']) == urls
assert len(content['thin_content_rows']) == 6
required = {'kpi_id','name','axis','confidence','constat','score','impact','evidence',
            'evidence_digest','fix','pages_affected','pages_affected_urls','status','type','severity','data'}
count = 0
for axis_name, axis in final['axes'].items():
    for kpi_name, kpi in axis.items():
        if not isinstance(kpi, dict) or 'status' not in kpi:
            continue
        assert required <= kpi.keys(), (axis_name, kpi_name, sorted(kpi.keys()))
        if kpi['status'] == 'passing':
            assert kpi['severity'] is None
        count += 1
# Exercise actual cursor factories for all three reload paths. The fixture
# identity is isolated; no client scan state or stored report is modified.
main._persist_scan_state('scanner_acquisition_fixture', {'status': 'complete', 'proof': 'ingestion_fixture'})
assert main._load_scan_state_from_db('scanner_acquisition_fixture')['proof'] == 'ingestion_fixture'
final['quality_drift_artifact'] = {'proof': 'fixture_reload'}
main._persist_kpi_payload('scanner_acquisition_fixture', final, 'https://evidence.fixture.test')
reloaded = main._load_persisted_kpi_payload('scanner_acquisition_fixture')
assert reloaded['axes']['Contenu']['Contenu Fin et Qualité']['pages_affected'] == 6
previous_id, artifact = main._load_previous_quality_drift_artifact('https://evidence.fixture.test', 'another_fixture')
assert previous_id == 'scanner_acquisition_fixture' and artifact['proof'] == 'fixture_reload'
output = dict(assertions='passed', canonical_kpis_checked=count,
              methodology='Actual scanner and packaged worker rows in PostgreSQL; host aggregator and KPI builder; '
                          'visual and multi-browser enrichment explicitly unmeasured; not deployed full-stack acceptance',
              report=report, kpis=final)
(ROOT / 'output/nlp-accuracy-study/scanner-content-report.json').write_text(
    json.dumps(output, ensure_ascii=False, indent=2), encoding='utf-8')
print(json.dumps({'assertions':'passed', 'canonical_kpis_checked':count, 'content_affected_pages':6}))
