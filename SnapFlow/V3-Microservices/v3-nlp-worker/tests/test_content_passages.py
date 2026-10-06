import re

from content_passages import content_passages, rank_passages


class WordTokenizer:
    def __call__(self, text, add_special_tokens=False, **kwargs):
        words = list(re.finditer(r'\S+', text))
        return dict(input_ids=list(range(len(words)+(2 if add_special_tokens else 0))),
                    offset_mapping=[word.span() for word in words])

    def num_special_tokens_to_add(self, pair=False):
        return 2


def test_windows_retain_middle_and_end_and_exact_source_offsets():
    text = ' '.join(f'word{i}' for i in range(80))
    windows, counts = content_passages(text, WordTokenizer(), 18, max_windows=20, overlap=4)
    assert counts['complete']
    assert counts['total_tokens'] == counts['processed_tokens'] == 80
    assert all(text[w['char_start']:w['char_end']] == w['text'] for w in windows)
    assert any('word40' in w['text'] for w in windows)
    assert 'word79' in windows[-1]['text']
    assert all(len(WordTokenizer()(w['text'], add_special_tokens=True)['input_ids']) <= 18 for w in windows)


def test_bounded_passages_do_not_claim_to_process_the_whole_document():
    windows, counts = content_passages(' '.join(f'word{i}' for i in range(80)), WordTokenizer(), 18, max_windows=2)
    assert len(windows) == 2
    assert not counts['complete']
    assert counts['processed_tokens'] < counts['total_tokens']


def test_match_keeps_evidence_span_and_avoids_fact_verification_claim():
    windows = [dict(text='Evidence text', char_start=4, char_end=17)]
    match = rank_passages(windows, [('title', 'Query')], {'Query':[1], 'Evidence text':[1]}, lambda a,b:1)['title']
    assert match['char_start'] == 4
    assert match['text'] == 'Evidence text'
    assert match['query'] == 'Query'
    assert 'not factual support' in match['interpretation']
