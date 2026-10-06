from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from page_evidence import select_page_evidence


def test_rendered_dom_does_not_become_original_source_or_duplicate_visible_text():
    hydrated = "<main><h1>Hydrated content</h1><p>Visible once</p></main>"
    html, raw, _ = select_page_evidence({"html": hydrated, "raw_html": "<div id='root'></div>", "rendered_html": hydrated, "metrics": {"rendered_discovery": {"visible_text": "Hydrated content Visible once"}}})
    assert raw == "<div id='root'></div>"
    assert html == hydrated


def test_rendered_only_page_has_unknown_source_and_safe_shadow_text():
    html, raw, _ = select_page_evidence({"html": "<main>Regular text</main>", "rendered_html": "<main>Regular text</main>", "metrics": {"rendered_discovery": {"shadow_dom": {"text": "Shadow <evidence> & details"}}}})
    assert raw == ""
    assert "Shadow &lt;evidence&gt; &amp; details" in html


def test_static_legacy_row_remains_readable():
    html, raw, _ = select_page_evidence({"html": "<main>Static</main>"})
    assert html == raw == "<main>Static</main>"


def test_captured_raw_response_and_headers_reach_nlp_without_becoming_dom():
    dom = '<main>Hydrated content</main>'
    source = '<div id="root"></div>'
    row = dict(html=dom, rendered_html=dom, raw_html=None,
               metrics={'rendered_discovery': {'raw_html': source, 'response_headers': {'Last-Modified':'Wed, 01 Oct 2025 10:00:00 GMT'}}})
    html, raw, metrics = select_page_evidence(row)
    assert html == dom
    assert raw == source
    assert metrics['response_headers']['last-modified'] == 'Wed, 01 Oct 2025 10:00:00 GMT'
    assert 'response_headers' not in row['metrics']


def test_stored_raw_response_keeps_precedence_and_unknown_stays_unknown():
    _html, raw, _metrics = select_page_evidence(dict(raw_html='<main>Original</main>', rendered_html='<main>DOM</main>',
        metrics={'rendered_discovery': {'raw_html':'<main>Navigation</main>'}}))
    assert raw == '<main>Original</main>'
    _html, raw, _metrics = select_page_evidence(dict(rendered_html='<main>DOM</main>', metrics={'rendered_discovery': {}}))
    assert raw == ''


def test_long_main_content_retains_additional_shadow_evidence_in_extraction_copy():
    import main as nlp
    source = '<div id="root"></div>'
    dom = '<main><h1>Guide</h1><p>' + 'Detailed customer information about our support options. ' * 100 + '</p></main>'
    row = dict(raw_html=source, rendered_html=dom,
               metrics={'rendered_discovery': {'shadow_dom': {'text':'SHADOW_READY Shadow tree evidence for NLP. SHADOW_LINK'}}})
    html, raw, _ = select_page_evidence(row)
    text, _source, _metadata = nlp.extract_text_main_content_first(html)
    assert 'SHADOW_READY Shadow tree evidence for NLP. SHADOW_LINK' in text
    assert text.count('SHADOW_READY') == 1
    assert row['rendered_html'] == dom
    assert row['raw_html'] == raw == source


def test_measurement_response_reaches_nlp_with_latest_headers_and_initial_source_intact():
    metrics = {'response_headers': {'last-modified': 'Initial'},
               'rendered_discovery': {'raw_html': '<main>Discovery response</main>', 'response_headers': {'last-modified': 'Discovery'}},
               'rendered_response': {'raw_html': '<main>Measured response</main>', 'response_headers': {'last-modified': 'Measured'}}}
    row = dict(raw_html='<main>Initial response</main>', rendered_html='<main>Latest DOM</main>', metrics=metrics)
    html, raw, selected = select_page_evidence(row)
    assert html == '<main>Latest DOM</main>'
    assert raw == '<main>Initial response</main>'
    assert selected['response_headers']['last-modified'] == 'Measured'
    row['raw_html'] = None
    _, raw, _ = select_page_evidence(row)
    assert raw == '<main>Measured response</main>'
    metrics['rendered_response']['raw_html'] = None
    _, raw, _ = select_page_evidence(row)
    assert raw == ''  # An older discovery body is not the latest navigation.


def test_latest_measurement_shadow_replaces_earlier_shadow_observation():
    row = dict(rendered_html='<main>Content</main>', metrics={
        'rendered_discovery': {'shadow_dom': {'text': 'OLD_SHADOW'}},
        'rendered_response': {'shadow_dom': {'text': 'NEW_SHADOW'}}})
    html, _, _ = select_page_evidence(row)
    assert 'NEW_SHADOW' in html and 'OLD_SHADOW' not in html
    row['metrics']['rendered_response']['shadow_dom'] = None
    html, _, _ = select_page_evidence(row)
    assert 'OLD_SHADOW' not in html  # Do not combine two browser visits silently.
