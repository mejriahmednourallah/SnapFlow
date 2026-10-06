"""Pass an actual production discovery observation through packaged NLP."""
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, '/app')
import main as nlp
if Path(nlp.__file__).parent != Path('/app'):
    raise RuntimeError('Probe must use packaged NLP')

capture = json.loads((ROOT / 'output/playwright/production-discovery.json').read_text(encoding='utf-8'))['result']
row = dict(id=1, content_revision=4, url=capture['url'], rendered_html=capture['rendered_html'],
           metrics={'rendered_discovery':capture})
queue = iter([row])
published = []

class Cursor:
    def close(self):
        pass

class Connection:
    def cursor(self, **_kwargs):
        return Cursor()
    def close(self):
        pass
    def rollback(self):
        raise RuntimeError('Unexpected NLP rollback')

def publish(_conn, _cur, current, payload):
    result = json.loads(payload)
    html, raw, _metrics = nlp.select_page_evidence(current)
    text, selected, _meta = nlp.extract_text_main_content_first(html)
    assert result['status'] == 'evaluated'
    assert result['content_revision'] == 4
    for marker in ('SHADOW_READY','NESTED_READY','OUTER_READY','SLOTTED_READY'):
        assert text.count(marker) == 1, (marker, text)
    assert 'SHADOW_READY Shadow tree evidence for NLP. SHADOW_LINK' in text
    assert 'international service' in text
    assert all(marker not in text for marker in ('SHADOW_HIDDEN_NOISE','CSS_SHADOW_NOISE','TRANSPARENT_NOISE','HIDDEN_HOST_NOISE'))
    assert current['rendered_html'] == capture['rendered_html']
    assert raw == capture['raw_html']
    assert 'SHADOW_HIDDEN_NOISE' in raw
    assert result['last_pub_date'] == '2026-09-20'
    published.append(dict(text=text, extraction_source=selected, result=result, source_html_preserved=True))
    return True

nlp.get_db_connection = Connection
nlp.claim_page = lambda *_args: next(queue, None)
nlp.publish_page = publish
nlp._head_last_modified_date = lambda *_args: (_ for _ in ()).throw(RuntimeError('Unexpected HEAD request'))
nlp.check_llms_txt = lambda *_args: {'llms_txt_present':False, 'status_code':404}
nlp.NLP_SEMANTIC_ENABLED = False
try:
    assert nlp.process_pending_pages() == 1
    path = ROOT / 'output/nlp-accuracy-study/production-shadow-nlp.json'
    path.write_text(json.dumps(dict(worker_module=nlp.__file__, observations=published, assertions='passed',
        methodology='Actual production Chromium capture and packaged worker; fixture DB and llms.txt adapters'),
        ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps({'source':nlp.__file__,'word_count':published[0]['result']['word_count'],'assertions':'passed'}))
finally:
    if nlp._LT_FR is not None:
        nlp._LT_FR.close()
