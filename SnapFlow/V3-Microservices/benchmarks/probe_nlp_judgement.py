"""Test support-vs-contradiction selection against labels fixed before inference.

Sentence embeddings measure relevance; this checks whether they would be safe
as an evidence verifier, not whether they fulfill their original similarity task.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import sys
import time

os.environ.update(HF_HUB_OFFLINE='1', TRANSFORMERS_OFFLINE='1', TOKENIZERS_PARALLELISM='false')
ROOT = Path(__file__).resolve().parents[2]


def run(index):
    import torch
    from sentence_transformers import SentenceTransformer
    torch.set_num_threads(2)
    torch.set_num_interop_threads(1)
    source = Path(__file__).with_name('nlp_judgement_cases.json')
    raw = source.read_bytes()
    cases = json.loads(raw)['cases']
    lock = json.loads((ROOT / 'output/nlp-model-study/models.lock.json').read_text(encoding='utf-8'))[index]
    model = SentenceTransformer(lock['path'], device='cpu', local_files_only=True)
    outputs = []
    started = time.perf_counter()
    for case in cases:
        inputs = [case['claim'], case['support'], case['contradiction']]
        if 'multilingual-e5' in lock['model']:
            inputs = ['query: '+inputs[0], 'passage: '+inputs[1], 'passage: '+inputs[2]]
        vectors = model.encode(inputs, normalize_embeddings=True, convert_to_numpy=True, show_progress_bar=False)
        support = float(vectors[0] @ vectors[1])
        contradiction = float(vectors[0] @ vectors[2])
        outputs.append(dict(**case, support_similarity=support, contradiction_similarity=contradiction,
                            selected='support' if support > contradiction else 'contradiction',
                            correct_support_selection=support > contradiction))
    return dict(model=lock['model'], revision=lock['revision'],
                task='Adversarial supporting-evidence selection, not generic relevance or live-site accuracy',
                labels_sha256=hashlib.sha256(raw).hexdigest(),
                correct=sum(row['correct_support_selection'] for row in outputs), total=len(outputs),
                inference_seconds=time.perf_counter()-started,
                runtime=dict(python=sys.version, torch=torch.__version__, sentence_transformers=__import__('sentence_transformers').__version__),
                outputs=outputs)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--index', type=int, default=0)
    parser.add_argument('--output', required=True)
    args = parser.parse_args()
    result = run(args.index)
    path = Path(args.output)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps({key: result[key] for key in ['model', 'correct', 'total', 'inference_seconds']}))
