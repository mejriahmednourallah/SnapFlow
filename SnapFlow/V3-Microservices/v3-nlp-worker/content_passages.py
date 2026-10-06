"""Token-bounded passages with exact source spans for optional NLP retrieval."""


def content_passages(text, tokenizer, max_seq_length, max_windows=32, overlap=24):
    encoded = tokenizer(text, add_special_tokens=False, truncation=False, return_offsets_mapping=True)
    offsets = encoded['offset_mapping']
    width = max_seq_length - tokenizer.num_special_tokens_to_add(pair=False)
    if width < 2:
        raise ValueError('invalid_passage_token_budget')
    overlap = min(max(0, overlap), width // 2)
    passages = []
    start = 0
    while start < len(offsets) and len(passages) < max_windows:
        stop = min(start + width, len(offsets))
        char_start, char_stop = offsets[start][0], offsets[stop-1][1]
        passage = text[char_start:char_stop]
        # Cutting a word at a subword offset can change tokenization. Validate
        # the actual encoded span instead of trusting the old offset count.
        while stop > start and len(tokenizer(passage, add_special_tokens=True, truncation=False)['input_ids']) > max_seq_length:
            stop -= 1
            char_stop = offsets[stop-1][1]
            passage = text[char_start:char_stop]
        if stop <= start:
            raise ValueError('passage_cannot_fit_token_budget')
        passages.append(dict(text=passage, char_start=char_start, char_end=char_stop,
                             token_start=start, token_end=stop))
        if stop == len(offsets):
            break
        start = max(start+1, stop-overlap)
    processed = passages[-1]['token_end'] if passages else 0
    return passages, dict(total_tokens=len(offsets), processed_tokens=processed,
                          complete=processed == len(offsets), windows=len(passages),
                          max_windows=max_windows, max_seq_length=max_seq_length)


def rank_passages(passages, queries, vectors, cosine):
    matches = {}
    for name, query in queries:
        query = (query or '').strip()
        if not query:
            continue
        scored = [(cosine(vectors[query], vectors[p['text']]), p) for p in passages]
        scored = [(score, passage) for score, passage in scored if score is not None]
        if scored:
            score, passage = max(scored, key=lambda item: item[0])
            matches[name] = dict(**passage, query=query, similarity=score,
                                 interpretation='topic relevance only; not factual support')
    return matches
