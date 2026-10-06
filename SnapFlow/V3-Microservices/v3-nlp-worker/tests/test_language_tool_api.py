import sys
from pathlib import Path
from types import SimpleNamespace

sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import main as nlp


def test_remote_clients_keep_languages_isolated_and_do_not_start_local_java(monkeypatch):
    calls = []
    def client(language, remote_server):
        calls.append((language, remote_server))
        return SimpleNamespace(language=language, check=lambda _text: [])
    monkeypatch.setenv('LANGUAGETOOL_SERVER_URL', 'http://languagetool:8086')
    monkeypatch.setattr(nlp, '_LT_REMOTE_CLIENTS', {})
    monkeypatch.setattr(nlp, 'language_tool_python', SimpleNamespace(LanguageTool=client))
    monkeypatch.setattr(nlp, '_load_language_tool_fr', lambda: (_ for _ in ()).throw(AssertionError('local JVM started')))
    fr = nlp._load_language_tool('fr')
    en = nlp._load_language_tool('en')
    ar = nlp._load_language_tool('ar')
    assert nlp._load_language_tool('fr') is fr
    assert (fr.language, en.language, ar.language) == ('fr', 'en-US', 'ar')
    assert len(calls) == 3


def test_remote_provider_startup_failure_can_recover_next_page(monkeypatch):
    calls = []
    def client(language, remote_server):
        calls.append(language)
        if len(calls) == 1:
            raise RuntimeError('server restarting')
        return SimpleNamespace(language=language)
    monkeypatch.setenv('LANGUAGETOOL_SERVER_URL', 'http://languagetool:8086')
    monkeypatch.setattr(nlp, '_LT_REMOTE_CLIENTS', {})
    monkeypatch.setattr(nlp, 'language_tool_python', SimpleNamespace(LanguageTool=client))
    assert nlp._load_language_tool('fr') is None
    assert nlp._load_language_tool('fr').language == 'fr'


def test_current_language_tool_match_fields_reach_typo_detection(monkeypatch):
    text='Nous vous proposons plusieurs solutions pour améliorer votre site et accompagner vos projets avec une équipe compétente et des serviices adaptés.'
    offset=text.index('serviices')
    match=SimpleNamespace(rule_issue_type='misspelling',category='TYPOS',
                          replacements=['services'],offset=offset,error_length=9)
    tool=SimpleNamespace(check=lambda _text: [match])
    monkeypatch.setattr(nlp,'_is_likely_french',lambda _text: True)
    monkeypatch.setattr(nlp,'_extract_protected_entity_tokens',lambda _text:set())
    monkeypatch.setattr(nlp,'_load_language_tool_fr',lambda:tool)
    density, words=nlp._detect_typo_density(text)
    assert words == ['serviices']
    assert density > 0


def test_current_api_style_matches_stay_excluded():
    match=SimpleNamespace(rule_issue_type='style',category='STYLE',replacements=['alternative'])
    assert not nlp._is_grammar_or_spelling_issue(match)


def test_valid_english_uses_provider_instead_of_small_business_dictionary(monkeypatch):
    tool=SimpleNamespace(check=lambda _text: [])
    monkeypatch.setattr(nlp,'_load_language_tool_fr',lambda:tool)
    text='The museum displays ancient sculptures and paintings in spacious galleries. Visitors enjoy guided tours through the permanent collection.'
    density, samples=nlp._detect_typo_density(text, language='en')
    assert density == 0
    assert samples == []
    assert tool.language == 'en-US'


def test_repeated_real_misspelling_counts_occurrences_not_unique_words(monkeypatch):
    text='Nous proposons des serviices utiles aux entreprises. Ces serviices répondent aux besoins des clients et nos serviices accompagnent leur activité au quotidien.'
    matches=[SimpleNamespace(rule_issue_type='misspelling',category='TYPOS',replacements=['services'],
                             offset=offset,error_length=9)
             for offset in [m.start() for m in nlp.re.finditer('serviices',text)]]
    tool=SimpleNamespace(check=lambda _text: matches)
    monkeypatch.setattr(nlp,'_extract_protected_entity_tokens',lambda _text:set())
    monkeypatch.setattr(nlp,'_load_language_tool_fr',lambda:tool)
    density, samples=nlp._detect_typo_density(text, language='fr')
    assert density == round(3/len(nlp._TOKEN_RE.findall(text)),4)
    assert samples == ['serviices']


def test_arabic_and_latin_segments_use_separate_dictionaries(monkeypatch):
    calls = []
    english = 'The museum displays ancient sculptures and paintings in spacious galleries. Visitors enjoy guided tours through the permanent collection.'
    arabic = 'يقدم المتحف مجموعة من اللوحات والمنحوتات القديمة للزوار ويمكن للعائلات الاستمتاع بالجولات التعليمية والتعرف على تاريخ الفنون والثقافة.'
    def tool(language):
        def check(text):
            calls.append((language, text))
            assert not (language == 'ar' and nlp.re.search('[A-Za-z]', text))
            assert not (language == 'en' and nlp.re.search('[\u0600-\u06ff]', text))
            return []
        return SimpleNamespace(check=check)
    monkeypatch.setattr(nlp, '_load_language_tool', tool)
    result = nlp.analyze_content(english+' '+arabic, html=f'<html lang="en"><main><p lang="en">{english}</p><p lang="ar">{arabic}</p></main></html>')
    assert result['typo_density'] == 0 and result['typo_samples'] == []
    assert result['content_language'] == 'en'
    assert result['spelling_scope']['status'] == 'evaluated'
    assert {language for language, _ in calls} == {'en', 'ar'}


def test_code_is_preserved_for_content_but_excluded_from_spelling(monkeypatch):
    prose = 'The museum displays ancient sculptures and paintings in spacious galleries. Visitors enjoy guided tours through the permanent collection.'
    code = 'const renderWidget = async function buildGrid() { return pixelBuffer; };'
    calls = []
    def check(block):
        calls.append(block)
        assert 'const' not in block and 'pixelBuffer' not in block
        return []
    monkeypatch.setattr(nlp, '_load_language_tool', lambda _: SimpleNamespace(check=check))
    text = prose+' '+code
    result = nlp.analyze_content(text, html=f'<html lang="en"><main><p>{prose}</p><pre><code>{code}</code></pre></main></html>')
    assert calls
    assert result['typo_density'] == 0
    assert result['spelling_scope']['excluded_code_words'] > 0
    assert result['word_count'] > len(prose.split())


def test_unsupported_declared_language_is_not_checked_with_english(monkeypatch):
    prose = 'The museum displays ancient sculptures and paintings in spacious galleries. Visitors enjoy guided tours through the permanent collection.'
    spanish = 'Este museo presenta pinturas antiguas y permite descubrir la historia de la cultura.'
    def tool(language):
        assert language == 'en'
        return SimpleNamespace(check=lambda text: [])
    monkeypatch.setattr(nlp, '_load_language_tool', tool)
    result = nlp.analyze_content(prose+' '+spanish, html=f'<html lang="en"><main><p>{prose}</p><p lang="es">{spanish}</p></main></html>')
    assert result['spelling_scope']['status'] == 'partial'
    assert result['spelling_scope']['unmeasured_languages']['es'] > 0


def test_provider_absence_is_not_a_measured_zero_for_language_blocks(monkeypatch):
    prose = 'The museum displays ancient sculptures and paintings in spacious galleries. Visitors enjoy guided tours through the permanent collection.'
    arabic = 'يقدم المتحف مجموعة من اللوحات والمنحوتات القديمة للزوار ويمكن للعائلات الاستمتاع بالجولات التعليمية والتعرف على تاريخ الفنون والثقافة.'
    monkeypatch.setattr(nlp, '_load_language_tool', lambda _: None)
    result = nlp.analyze_content(prose+' '+arabic, html=f'<html lang="en"><p>{prose}</p><p lang="ar">{arabic}</p></html>')
    assert result['spelling_scope']['status'] == 'partial'
    assert result['spelling_scope']['checked_word_count'] == 0
    assert result['spelling_scope']['languages_checked'] == []
    assert set(result['spelling_scope']['provider_failures']) == {'en','ar'}


def test_short_spelling_policy_exclusion_does_not_request_provider_retries(monkeypatch):
    monkeypatch.setattr(nlp, '_load_language_tool', lambda _: SimpleNamespace(check=lambda _: []))
    # Main content is substantial, but this declared-language block is short
    # enough to be excluded by the existing spelling policy.
    french = 'Nous proposons des services adaptés pour accompagner les clients dans leurs projets et répondre aux besoins de chaque entreprise. ' * 3
    text = 'Contact our team today. ' + french
    html = '<html lang="fr"><main><p lang="en">Contact our team today.</p><p>' + french + '</p></main></html>'
    result = nlp.analyze_content(text, html=html)
    assert result['spelling_scope']['checked_word_count'] > 0
    assert result['spelling_scope']['unmeasured_languages']['en'] == 4
    assert not result['spelling_scope'].get('provider_failures')


def _recorded_spelling_provider(monkeypatch):
    submitted = []
    def check(block):
        submitted.append(block)
        return [SimpleNamespace(rule_issue_type='misspelling', category='TYPOS',
                    replacements=['services'], offset=match.start(), error_length=9)
                for match in nlp.re.finditer('serviices', block)]
    monkeypatch.setattr(nlp, '_load_language_tool', lambda _: SimpleNamespace(check=check))
    monkeypatch.setattr(nlp, '_extract_protected_entity_tokens', lambda _: set())
    return submitted


def test_late_paragraph_typos_are_checked_without_thirty_separate_requests(monkeypatch):
    submitted = _recorded_spelling_provider(monkeypatch)
    prose = ('Notre entreprise propose des solutions utiles pour les clients. '
             'Nous accompagnons les projets avec une assistance professionnelle et des services adaptés.')
    paragraphs = [prose for _ in range(40)]
    paragraphs[34] = paragraphs[34].replace('services', 'serviices')
    paragraphs[35] = paragraphs[35].replace('services', 'serviices')
    text = '\n\n'.join(paragraphs)
    density, samples, errors, measured = nlp._detect_typo_density(text, language='fr', _return_count=True)
    assert len(submitted) == 1
    assert submitted[0] == text
    assert measured and errors == 2 and samples == ['serviices']
    assert density == round(2 / len(nlp._TOKEN_RE.findall(text)), 4)


def test_long_page_spelling_preserves_suffix_and_bounds_each_request(monkeypatch):
    submitted = _recorded_spelling_provider(monkeypatch)
    prose = 'We provide clear information for our visitors and help every customer find useful services for their projects. '
    html = '<main><p>' + prose * 1500 + prose.replace('services', 'serviices') * 30 + '</p></main>'
    text, source, _metadata = nlp.extract_text_main_content_first(html)
    assert source == 'main_candidate:main'
    assert text.index('serviices') > 100000
    density, samples, errors, measured = nlp._detect_typo_density(text, language='en', _return_count=True)
    assert len(submitted) > 1 and max(map(len, submitted)) <= 20000
    assert sum(len(nlp._TOKEN_RE.findall(block)) for block in submitted) == len(nlp._TOKEN_RE.findall(text))
    assert sum(block.count('serviices') for block in submitted) == 30
    assert measured and errors == 30 and samples == ['serviices']
    assert density == round(30 / len(nlp._TOKEN_RE.findall(text)), 4)


def test_excluded_short_copy_does_not_dilute_spelling_density_or_checked_count(monkeypatch):
    submitted = _recorded_spelling_provider(monkeypatch)
    short = 'Contact our team today.'
    prose = 'We provide clear information for our visitors and help every customer find useful serviices for their projects.'
    text = short + '\n' + prose
    result = nlp.analyze_content(text, html='<html lang="en"></html>')
    assert submitted == [prose]
    expected_checked = len(nlp._TOKEN_RE.findall(prose))
    assert result['spelling_scope']['checked_word_count'] == expected_checked
    assert result['spelling_scope']['excluded_policy_words'] == 4
    assert result['typo_density'] == round(1 / expected_checked, 4)


def test_failed_later_batch_does_not_claim_complete_spelling_measurement(monkeypatch):
    calls = []
    def check(block):
        calls.append(block)
        if len(calls) == 2:
            raise RuntimeError('provider restarted between batches')
        return []
    monkeypatch.setattr(nlp, '_load_language_tool', lambda _: SimpleNamespace(check=check))
    prose = 'We provide clear information for our visitors and help every customer find useful services for their projects. '
    result = nlp.analyze_content(prose * 300, html='<html lang="en"></html>')
    assert len(calls) == 2
    assert result['spelling_scope']['status'] == 'partial'
    assert result['spelling_scope']['checked_word_count'] == 0
    assert result['spelling_scope']['provider_failures']['en'] > 0
