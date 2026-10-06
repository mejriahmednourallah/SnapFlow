"""Replay captured content through actual worker functions, without DB/network.

This isolates base content analysis. Optional spaCy, LanguageTool and semantic
models are explicitly disabled; this is not full production NLP acceptance.
"""
import importlib.util
import json
from pathlib import Path
import sys
import time
from urllib.parse import urlparse

import nltk
from bs4 import BeautifulSoup
from markdown_it import MarkdownIt

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT/'output/playwright/obscura-study/stealth-clean'
WORKER = ROOT/'V3-Microservices/v3-nlp-worker'
sys.path.insert(0, str(WORKER))
for optional in ['spacy', 'language_tool_python', 'sentence_transformers']:
    sys.modules[optional] = None
# Required NLTK data are checked beforehand, rather than downloading on import.
for resource in ['corpora/stopwords', 'tokenizers/punkt', 'tokenizers/punkt_tab']:
    nltk.data.find(resource)
nltk.download = lambda *args, **kwargs: True
spec = importlib.util.spec_from_file_location('snapflow_nlp_replay', WORKER/'main.py')
worker = importlib.util.module_from_spec(spec)
spec.loader.exec_module(worker)
parser = MarkdownIt()


def analyze(html, url, shadow=''):
    began = time.perf_counter()
    text, source, metadata = worker.extract_text_main_content_first(html)
    if shadow.strip():
        text += ' ' + shadow.strip()
    result = worker.analyze_content(text, url=url, html=html)
    soup = BeautifulSoup(html, 'html.parser')
    title = soup.title.get_text(' ', strip=True) if soup.title else ''
    selected = {key:result.get(key) for key in ['word_count', 'readability_score', 'readability_grade',
        'content_quality', 'dominant_keyword', 'keyword_density', 'content_type_hint']}
    selected.update({'page_type':worker.classify_page_type(url, title, text, soup=soup),
        'h1_quality':worker.check_h1_quality(soup, title), 'meta_quality':worker.check_meta_description(soup),
        'text':text, 'source':source, 'metadata':metadata, 'elapsed_ms':round((time.perf_counter()-began)*1000, 2)})
    return selected


records = []
for folder in sorted(OUT.glob('round-*')):
    data = json.loads((folder/'study.json').read_text(encoding='utf-8'))
    for row in data['rows']:
        record = {'variant':folder.name.split('-', 2)[2], 'round':int(folder.name.split('-')[1]),
                  'url':row['url'], 'path':urlparse(row['url']).path, 'phase':row['phase'],
                  'status':row['status']}
        if row['status'] == 'success':
            stem = f"{row['phase']}-{row['index']}"
            html = (folder/f'{stem}.html').read_text(encoding='utf-8')
            markdown = (folder/f'{stem}.md').read_text(encoding='utf-8')
            record['html_nlp'] = analyze(html, row['url'], row.get('shadow', {}).get('text', ''))
            # Markdown rendered back to text: no metadata synthesized from HTML.
            record['markdown_nlp'] = analyze(parser.render(markdown), row['url'])
            record['markdown_word_delta'] = record['markdown_nlp']['word_count'] - record['html_nlp']['word_count']
        records.append(record)

comparisons = []
fields = ['word_count', 'readability_score', 'readability_grade', 'content_quality',
          'dominant_keyword', 'keyword_density', 'content_type_hint', 'page_type', 'h1_quality', 'meta_quality']
for record in records:
    if record['variant'] == 'chromium':
        continue
    baseline = next(r for r in records if r['variant'] == 'chromium' and r['round'] == record['round']
                    and r['url'] == record['url'] and r['phase'] == record['phase'])
    comparison = {k:record[k] for k in ['variant', 'round', 'url', 'phase', 'status']}
    comparison['chromium_status'] = baseline['status']
    if record['status'] == baseline['status'] == 'success':
        comparison['differing_fields'] = [f for f in fields if record['html_nlp'][f] != baseline['html_nlp'][f]]
        comparison['same_extracted_text'] = record['html_nlp']['text'] == baseline['html_nlp']['text']
    comparisons.append(comparison)

report = {'scope':'Actual base extraction/content/SEO functions only; optional models disabled; no DB writes',
          'records':records, 'comparisons':comparisons}
(OUT/'nlp-replay.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
print(json.dumps({'rows':len(records), 'paired_successes':sum('differing_fields' in c for c in comparisons),
    'identical_selected_fields':sum(c.get('differing_fields') == [] for c in comparisons),
    'missing_candidates':sum(c['status'] != 'success' for c in comparisons)}), flush=True)
