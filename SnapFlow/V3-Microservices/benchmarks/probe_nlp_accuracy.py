"""Reproduce narrow extraction/rule defects using the actual NLP worker.

This is a diagnostic corpus, not an estimate of general model/KPI accuracy.
No database, browser, Java server or semantic inference is used.
"""
import argparse
import importlib.util
import json
from pathlib import Path
import sys
import time

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'v3-nlp-worker'))
import main as nlp


def run():
    observations = []

    def record(name, expected, observed, correct):
        observations.append(dict(case=name, expected=expected, observed=observed, correct=bool(correct)))

    content = 'Our customers can request access to their personal data and correction of inaccurate records. ' * 12
    cases = [
        ('article_header', f'<main><article><header><h1>Annual protection guide</h1></header><p>{content}</p></article></main>', 'Annual protection guide'),
        ('cookie_policy_id', f'<main id="cookie-policy"><h1>Cookie policy</h1><p>{content}</p></main>', 'request access'),
        ('cookie_policy_class', f'<article class="cookie-policy-content"><h1>Cookie policy</h1><p>{content}</p></article>', 'request access'),
    ]
    for name, html, wanted in cases:
        started = time.perf_counter()
        text, source, _ = nlp.extract_text_main_content_first(html)
        record(name, f'contains {wanted}', dict(text=text[:200], source=source, elapsed_ms=(time.perf_counter()-started)*1000), wanted in text)

    for name, hidden in [
        ('hidden_attribute', '<p hidden>OBSOLETE_PROMOTION obsolete obsolete</p>'),
        ('inline_hidden', '<p style="display: none">OBSOLETE_PROMOTION obsolete obsolete</p>'),
        ('template_content', '<template><p>OBSOLETE_PROMOTION obsolete obsolete</p></template>'),
    ]:
        html = f'<main><p>{content}</p>{hidden}</main>'
        text, source, _ = nlp.extract_text_main_content_first(html)
        record(name, 'exclude non-visible obsolete text', dict(obsolete_present='OBSOLETE_PROMOTION' in text, source=source), 'OBSOLETE_PROMOTION' not in text and 'request access' in text)

    # Isolate content calculations from optional French grammar startup.
    nlp._detect_typo_density = lambda _text, **_kwargs: (0.0, [], 0, True)
    text = 'Introduction. ' + ('Insurance coverage protects policyholders against unexpected losses. ' * 50)
    result = nlp.analyze_content(text, 'https://fixture.test/guide', '<html lang="en"></html>')
    dominant = result['dominant_keyword']
    expected = result['keyword_density'][dominant] / 100
    record('dominant_density', round(expected, 4), result['keyword_density_score'], abs(result['keyword_density_score']-expected) <= .0001)

    title = 'حماية البيانات الشخصية'
    alignment = nlp.compute_title_content_alignment(title, {'حماية': 3, 'البيانات': 2, 'الشخصية': 2})
    record('arabic_title_alignment', 'matching title is aligned', alignment, not alignment['title_content_misaligned'] and alignment['title_content_alignment'] == 1)

    from textstat.textstat import textstatistics
    french = textstatistics()
    french.set_lang('fr')
    text = ('Notre assurance accompagne les entreprises avec une assistance professionnelle et une protection adaptée. ' * 20)
    result = nlp.analyze_content(text, 'https://fixture.test/fr', '<html lang="fr"></html>')
    expected = round(max(0, min(100, 207 - 1.015*result['avg_sentence_length'] - 73.6*french.avg_syllables_per_word(text))), 1)
    record('french_syllable_language', expected, result['readability_score'], abs(expected-result['readability_score']) <= .1)

    # Load the aggregator under a distinct module name; its runtime module is
    # also called main.py and must not accidentally resolve to the NLP module.
    sys.path.insert(0, str(ROOT / 'v3-aggregator'))
    spec = importlib.util.spec_from_file_location('accuracy_aggregator', ROOT / 'v3-aggregator/main.py')
    aggregator = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = aggregator
    spec.loader.exec_module(aggregator)
    lexical = nlp.compute_lexical_diversity(' '.join(['insurance', 'coverage'] * 150))
    payload = dict(lexical_diversity=lexical['mtld'], lexical_diversity_method=lexical['method'], lexical_diversity_ttr_debug=lexical['ttr_debug'])
    if hasattr(aggregator, '_lexical_diversity_for_report'):
        value = aggregator._lexical_diversity_for_report(payload)
    else:
        value = payload['lexical_diversity']
    record('lexical_metric_units', 'low diversity under existing TTR threshold 0.4', dict(mtld=lexical['mtld'], ttr=lexical['ttr_debug'], report_value=value), value is not None and value < .4)

    return dict(scope='Targeted synthetic regressions using real worker/aggregator functions; not general accuracy or production acceptance',
                correct=sum(row['correct'] for row in observations), total=len(observations), cases=observations)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--output', required=True)
    args = parser.parse_args()
    report = run()
    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps(dict(correct=report['correct'], total=report['total'], output=str(output))))
