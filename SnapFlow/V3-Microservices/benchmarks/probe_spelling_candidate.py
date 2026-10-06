"""Authored spelling expectations through the actual final packaged worker.

Includes production HTML extraction, late input, fixed-language remote clients
and a long suffix. This is controlled acceptance, not general site accuracy.
"""
import json
from pathlib import Path
import sys
import time
from types import SimpleNamespace

sys.path.insert(0, '/app')
import main as nlp

BASES = {
    'fr': 'Notre entreprise propose des solutions utiles pour les clients. Nous accompagnons les projets avec une assistance professionnelle et des services adaptés.',
    'en': 'The museum displays ancient sculptures and paintings in spacious galleries. Visitors enjoy guided tours through the permanent collection.',
    'ar': 'يمكن للعميل الاطلاع على معلومات حسابه وتحديث عنوانه عند الحاجة. يقدم فريق خدمة العملاء المساعدة ويجيب عن الأسئلة المتعلقة بالخدمات المتاحة.',
}


def run():
    if Path(nlp.__file__).parent != Path('/app'):
        raise RuntimeError('Requires packaged production source')
    loader = nlp._load_language_tool
    calls = []
    tools = {language: loader(language) for language in BASES}
    if any(tool is None for tool in tools.values()):
        raise RuntimeError('Shared LanguageTool is required')
    for language, tool in tools.items():
        tool.check(BASES[language])

    def recorded_tool(language):
        def check(text):
            calls.append(dict(language=language, characters=len(text),
                              words=len(nlp._TOKEN_RE.findall(text))))
            return tools[language].check(text)
        return SimpleNamespace(check=check)

    nlp._load_language_tool = recorded_tool
    observations = []
    try:
        for language, prose in BASES.items():
            for case in ('clean', 'late_typo') if language != 'ar' else ('clean',):
                paragraphs = [prose] * 40
                expected = []
                if case == 'late_typo':
                    correct, typo = ('services', 'serviices') if language == 'fr' else ('paintings', 'paintngs')
                    for index in (34, 35):
                        paragraphs[index] = paragraphs[index].replace(correct, typo)
                    expected = [typo]
                html = '<html lang="' + language + '"><main>' + ''.join('<p>' + p + '</p>' for p in paragraphs) + '</main></html>'
                selected, source, _ = nlp.extract_text_main_content_first(html)
                before = len(calls)
                started = time.perf_counter()
                result = nlp.analyze_content(selected, html=html)
                scope = result['spelling_scope']
                assert result['typo_samples'] == expected, (language, case, result['typo_samples'])
                assert scope['error_occurrences'] == (2 if expected else 0), (language, case, scope)
                assert scope['checked_word_count'] == len(nlp._TOKEN_RE.findall(selected))
                assert scope['status'] == 'evaluated' and not scope.get('provider_failures')
                observations.append(dict(language=language, case=case, extraction=source,
                    expected_samples=expected, observed_samples=result['typo_samples'],
                    scope=scope, seconds=time.perf_counter()-started, requests=calls[before:]))

        # Unlike the paragraph cap, the old prefix cutoff also affected actual
        # flattened HTML extraction. Author 60 late English occurrences first.
        prose = BASES['en']
        html = '<html lang="en"><main><p>' + (prose + ' ') * 1000 + (prose.replace('paintings', 'paintngs') + ' ') * 60 + '</p></main></html>'
        selected, source, _ = nlp.extract_text_main_content_first(html)
        assert selected.index('paintngs') > 100000
        before = len(calls)
        started = time.perf_counter()
        density, samples, errors, measured = nlp._detect_typo_density(selected, language='en', _return_count=True)
        submitted = calls[before:]
        assert measured and samples == ['paintngs'] and errors == 60, (samples, errors)
        assert sum(row['words'] for row in submitted) == len(nlp._TOKEN_RE.findall(selected))
        assert max(row['characters'] for row in submitted) <= 20000
        observations.append(dict(language='en', case='flattened_long_suffix', extraction=source,
            expected_error_occurrences=60, observed_error_occurrences=errors, typo_samples=samples,
            density=density, seconds=time.perf_counter()-started, requests=submitted))
    finally:
        nlp._load_language_tool = loader
    assert nlp._LT_FR is None, 'Shared provider unexpectedly started local Java'
    artifact = dict(methodology='Actual final packaged Python 3.11 NLP + shared LT 6.8; pre-authored FR/EN/AR clean/typo labels and production HTML extraction. Controlled input only; no general site or full-scan acceptance.',
        observations=observations, assertions='passed')
    Path('/workspace/output/nlp-accuracy-study/spelling-candidate.json').write_text(json.dumps(artifact, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps(artifact, ensure_ascii=False))


if __name__ == '__main__':
    run()
