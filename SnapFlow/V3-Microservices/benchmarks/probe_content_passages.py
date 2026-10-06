"""Agent-authored location tests for the real MiniLM ingestion paths."""
import json
import argparse
import os
from pathlib import Path
import sys
import time

os.environ.update(HF_HUB_OFFLINE='1', TRANSFORMERS_OFFLINE='1', TOKENIZERS_PARALLELISM='false')
ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'V3-Microservices/v3-nlp-worker'))
import torch
from sentence_transformers import SentenceTransformer

torch.set_num_threads(2)
torch.set_num_interop_threads(1)
lock = json.loads((ROOT / 'output/nlp-model-study/models.lock.json').read_text(encoding='utf-8'))[0]
parser = argparse.ArgumentParser()
parser.add_argument('--model-path')
parser.add_argument('--worker-runtime', action='store_true')
parser.add_argument('--output', default='content-passages.json')
args = parser.parse_args()
model_path = args.model_path or lock['path']
worker = None
if args.worker_runtime:
    # The image's packaged code must win over the mounted checkout.
    sys.path.insert(0, '/app')
    import main as worker
    worker.NLP_SEMANTIC_ENABLED = True
    worker.NLP_PASSAGE_RETRIEVAL_ENABLED = True
    worker.NLP_SEMANTIC_MODEL = model_path
    model = worker._load_semantic_model()
    if model is None:
        raise RuntimeError('Production semantic model failed to load')
else:
    model = SentenceTransformer(model_path, local_files_only=True, device='cpu')
from content_passages import content_passages, rank_passages
if worker and (Path(worker.__file__).parent != Path('/app') or
               Path(sys.modules['content_passages'].__file__).parent != Path('/app')):
    raise RuntimeError('Runtime probe must use the packaged worker and passage code')
cases = [
    ('fr', 'Comment demander un prêt immobilier ?',
     'Pour financer votre logement, déposez une demande de crédit immobilier auprès de notre conseiller.',
     'Les jardins du musée accueillent des arbres et des fleurs. Les visiteurs découvrent les couleurs du paysage et les sculptures anciennes.'),
    ('en', 'Where can I apply for a home loan?',
     'To finance the purchase of your house, submit a mortgage application to our adviser.',
     'The museum gardens feature trees and flowers. Visitors explore the colours of the landscape and the ancient sculptures.'),
    ('ar', 'كيف يمكنني طلب قرض لشراء منزل؟',
     'لتمويل شراء مسكنك، قدم طلب قرض عقاري إلى مستشارنا في الفرع.',
     'تضم حديقة المتحف أشجاراً وأزهاراً جميلة. يكتشف الزوار ألوان الطبيعة والمنحوتات القديمة المعروضة في المكان.'),
]
observations = []
for language, query, evidence, filler in cases:
    for position in ['beginning','middle','end']:
        paragraphs = [filler] * 36
        paragraphs.insert({'beginning':0,'middle':18,'end':36}[position], evidence)
        body = '\n\n'.join(paragraphs)
        began = time.perf_counter()
        if worker:
            enrichment = worker.build_semantic_enrichment(query, query, query, body)
            retrieval = enrichment['passage_retrieval']
            match = retrieval['matches']['title_body_similarity']
            coverage = {key:retrieval[key] for key in ('total_tokens','processed_tokens','complete','windows','max_windows','max_seq_length')}
        else:
            passages, coverage = content_passages(body, model.tokenizer, model.max_seq_length)
            texts = list(dict.fromkeys([query] + [p['text'] for p in passages]))
            vectors = model.encode(texts, convert_to_numpy=True, normalize_embeddings=True, show_progress_bar=False)
            by_text = dict(zip(texts,vectors))
            def cosine(left,right): return float(left @ right)
            match = rank_passages(passages, [('query',query)], by_text, cosine)['query']
        legacy = model.tokenizer(body[:6000], truncation=True, max_length=model.max_seq_length,
                                  return_offsets_mapping=True)['offset_mapping']
        legacy_end = max(end for start,end in legacy)
        observations.append(dict(language=language, position=position, query=query, expected_evidence=evidence,
            body_word_count=len(body.split()),
            semantic_enrichment=enrichment if worker else None,
            legacy_evidence_present=evidence in body[:legacy_end],
            retrieval_evidence_present=evidence in match['text'], match=match, coverage=coverage,
            source_span_exact=body[match['char_start']:match['char_end']] == match['text'],
            elapsed_ms=(time.perf_counter()-began)*1000))
import sentence_transformers
result = dict(**lock, task='Exact supporting paragraph retrieval at independently specified locations; not factual verification',
              worker_runtime=args.worker_runtime, runtime_model_path=model_path,
              worker_source=worker.__file__ if worker else None,
              passage_module_source=sys.modules['content_passages'].__file__,
              python=sys.version, torch=torch.__version__, cuda=torch.version.cuda,
              sentence_transformers=sentence_transformers.__version__,
              legacy_present=sum(row['legacy_evidence_present'] for row in observations),
              retrieval_present=sum(row['retrieval_evidence_present'] for row in observations),
              total=len(observations), observations=observations)
(ROOT / 'output/nlp-accuracy-study' / args.output).write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps({key:result[key] for key in ['legacy_present','retrieval_present','total']}))
