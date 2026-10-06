"""Behavioural regressions against the production extraction/calculation paths."""
from pathlib import Path
import sys

from bs4 import BeautifulSoup
import pytest
from textstat.textstat import textstatistics

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import main as nlp


CONTENT = 'Customers can request access to their personal data and correction of inaccurate records. ' * 12


@pytest.mark.parametrize('wrapper', [
    '<main id="cookie-policy">{}</main>',
    '<article class="cookie-policy-content">{}</article>',
    '<main id="cookie-banner-content">{}</main>',
])
def test_policy_landmarks_are_not_removed_as_consent_widgets(wrapper):
    text, _source, _meta = nlp.extract_text_main_content_first(wrapper.format(f'<p>{CONTENT}</p>'))
    assert 'request access' in text


def test_article_header_is_content_and_site_chrome_is_excluded():
    html = (f'<header>GLOBAL_NAVIGATION</header><main><article><header><h1>Protection guide</h1></header>'
            f'<p>{CONTENT}</p></article></main><footer>GLOBAL_FOOTER</footer>')
    text, _source, _meta = nlp.extract_text_main_content_first(html)
    assert 'Protection guide' in text
    assert 'GLOBAL_NAVIGATION' not in text
    assert 'GLOBAL_FOOTER' not in text


@pytest.mark.parametrize('hidden', [
    '<p hidden>OBSOLETE_PROMOTION</p>',
    '<p style="display: none">OBSOLETE_PROMOTION</p>',
    '<p style="color: red; display: none !important;">OBSOLETE_PROMOTION</p>',
    '<p style="visibility: hidden">OBSOLETE_PROMOTION</p>',
    '<template><p>OBSOLETE_PROMOTION</p></template>',
])
def test_non_visible_text_does_not_inflate_content_metrics(hidden):
    html = f'<main><p>{CONTENT}</p>{hidden}</main>'
    text, _source, _meta = nlp.extract_text_main_content_first(html)
    assert 'OBSOLETE_PROMOTION' not in text
    assert 'request access' in text
    assert 'OBSOLETE_PROMOTION' in html  # source evidence remains intact


def test_named_css_class_is_not_assumed_visually_hidden():
    text, _source, _meta = nlp.extract_text_main_content_first(
        f'<main><p class="hidden-gem">{CONTENT}</p></main>')
    assert 'request access' in text


def test_nested_consent_widgets_do_not_break_extraction():
    text, _source, _meta = nlp.extract_text_main_content_first(
        f'<div class="cookie-banner"><div class="cookie-banner">BANNER_TEXT</div></div><main><p>{CONTENT}</p></main>')
    assert 'BANNER_TEXT' not in text
    assert 'request access' in text


def test_explicit_main_outranks_long_generic_wrapper():
    related = 'UNRELATED_WIDGET ' * 300
    text, _source, _meta = nlp.extract_text_main_content_first(
        f'<div class="content"><main><p>{CONTENT}</p></main><div><p>{related}</p><p>{related}</p></div></div>')
    assert 'UNRELATED_WIDGET' not in text
    assert 'request access' in text


def test_density_uses_most_frequent_keyword_not_first_seen_word(monkeypatch):
    monkeypatch.setattr(nlp, '_detect_typo_density', lambda _text, **_kwargs: (0.0, [], 0, True))
    text = 'Introduction. ' + 'Insurance coverage protects policyholders against unexpected losses. ' * 50
    result = nlp.analyze_content(text, 'https://fixture.test/guide', '<html lang="en"></html>')
    density = result['keyword_density'][result['dominant_keyword']] / 100
    assert result['keyword_density_score'] == pytest.approx(density, abs=.0001)
    assert result['keyword_density_score'] > .05


def test_french_readability_uses_french_statistics_without_leaking_into_english(monkeypatch):
    monkeypatch.setattr(nlp, '_detect_typo_density', lambda _text, **_kwargs: (0.0, [], 0, True))
    french = textstatistics()
    french.set_lang('fr')
    text = 'Notre assurance accompagne les entreprises avec une assistance professionnelle et une protection adaptée. ' * 20
    result = nlp.analyze_content(text, html='<html lang="fr"></html>')
    expected = round(max(0, min(100, 207 - 1.015*result['avg_sentence_length'] - 73.6*french.avg_syllables_per_word(text))), 1)
    assert result['readability_score'] == pytest.approx(expected, abs=.1)
    assert result['content_language'] == 'fr'
    english = textstatistics()
    english.set_lang('en')
    text = 'Insurance coverage protects customers against unexpected losses. ' * 20
    after = nlp.analyze_content(text, html='<html lang="en"></html>')
    assert after['readability_score'] == round(max(0, min(100, english.flesch_reading_ease(text))), 1)
    assert after['content_language'] == 'en'


def test_arabic_title_alignment_uses_actual_arabic_tokens():
    aligned = nlp.compute_title_content_alignment('حماية البيانات الشخصية', {'حماية': 3, 'البيانات': 2, 'الشخصية': 2})
    unrelated = nlp.compute_title_content_alignment('حماية البيانات الشخصية', {'تأمين': 3, 'سيارات': 2})
    assert aligned['title_content_alignment'] == 1
    assert not aligned['title_content_misaligned']
    assert unrelated['title_content_misaligned']
