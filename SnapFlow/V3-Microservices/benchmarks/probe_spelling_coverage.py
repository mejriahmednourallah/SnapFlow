"""Reproduce late-paragraph spelling loss using the actual packaged provider.

The expected two occurrences are authored before execution. The batch path is
an experiment only; it does not change production defaults or verdict policy.
"""
import json
from pathlib import Path
import sys
import time

sys.path.insert(0, '/app')
import main as nlp


def run():
    if Path(nlp.__file__).parent != Path('/app'):
        raise RuntimeError('Requires the packaged worker')
    prose = ('Notre entreprise propose des solutions utiles pour les clients. '
             'Nous accompagnons les projets avec une assistance professionnelle '
             'et des services adaptés.')
    paragraphs = [prose for _ in range(40)]
    for index in (34, 35):
        paragraphs[index] = paragraphs[index].replace('services', 'serviices')
    text = '\n\n'.join(paragraphs)
    tool = nlp._load_language_tool('fr')
    if tool is None:
        raise RuntimeError('Shared LanguageTool must be running')
    tool.check(prose)  # Warm the same dictionary before both layouts.
    original_blocks = nlp._lt_text_blocks
    original_loader = nlp._load_language_tool
    results = []
    try:
        for layout in ('current', 'batch', 'batch', 'current'):
            calls = []

            class RecordedTool:
                def check(self, block):
                    calls.append(block)
                    return tool.check(block)

            nlp._load_language_tool = lambda _language: RecordedTool()
            nlp._lt_text_blocks = (original_blocks if layout == 'current'
                                   else lambda _text: ['\n\n'.join(paragraphs)])
            started = time.perf_counter()
            density, samples, errors, measured = nlp._detect_typo_density(
                text, language='fr', _return_count=True)
            results.append(dict(layout=layout, seconds=time.perf_counter()-started,
                provider_requests=len(calls),
                submitted_words=sum(len(nlp._TOKEN_RE.findall(block)) for block in calls),
                selected_words=len(nlp._TOKEN_RE.findall(text)),
                injected_occurrences_submitted=sum(block.count('serviices') for block in calls),
                error_occurrences=errors, typo_samples=samples, density=density, measured=measured))
    finally:
        nlp._lt_text_blocks = original_blocks
        nlp._load_language_tool = original_loader
    for row in results:
        if row['layout'] == 'current':
            assert row['injected_occurrences_submitted'] == 0
        else:
            assert row['injected_occurrences_submitted'] == 2
            assert row['error_occurrences'] == 2 and row['typo_samples'] == ['serviices'], row
    artifact = dict(expected=dict(paragraphs=40, typo='serviices', occurrences=2,
                        one_based_paragraphs=[35, 36]),
                    methodology='Authored French typo locations; actual packaged NLP and shared LT 6.8. Alternating warmed layouts. Batching experiment only; no full scan or multilingual acceptance.',
                    observations=results)
    Path('/workspace/output/nlp-accuracy-study/spelling-coverage.json').write_text(
        json.dumps(artifact, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps(artifact, ensure_ascii=False))


if __name__ == '__main__':
    run()
