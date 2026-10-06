"""Measure a real NLI candidate against independently authored source labels."""
import json
import argparse
import os
from pathlib import Path
import statistics
import sys
import time

os.environ.update(HF_HUB_OFFLINE='1', TRANSFORMERS_OFFLINE='1', TOKENIZERS_PARALLELISM='false')
try:
    import psutil
except ImportError:
    psutil = None
import torch
import transformers
from transformers import AutoModelForSequenceClassification, AutoTokenizer

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'output/nlp-accuracy-study'
torch.set_num_threads(2)
torch.set_num_interop_threads(1)
parser = argparse.ArgumentParser()
parser.add_argument('--lock', default='nli-model.lock.json')
parser.add_argument('--output', default='nli-judgement.json')
parser.add_argument('--cases', default='nlp_judgement_cases.json')
parser.add_argument('--model-path')
parser.add_argument('--runtime-label', default='host')
args = parser.parse_args()
lock = json.loads((OUT / args.lock).read_text(encoding='utf-8'))
model_path = args.model_path or lock['path']
tokenizer = AutoTokenizer.from_pretrained(model_path, local_files_only=True)
model = AutoModelForSequenceClassification.from_pretrained(model_path, local_files_only=True).eval()
labels = {int(key): str(value).lower() for key, value in model.config.id2label.items()}
assert set(labels.values()) == {'entailment','neutral','contradiction'}, labels
cases = json.loads(Path(__file__).with_name(args.cases).read_text(encoding='utf-8'))['cases']
outputs, timings = [], []
for case in cases:
    began = time.perf_counter()
    premises = [case['support'], case['contradiction']] + ([case['neutral']] if 'neutral' in case else [])
    tokens = tokenizer(premises, [case['claim']]*len(premises),
                       padding=True, truncation=True, max_length=256, return_tensors='pt')
    with torch.inference_mode():
        probabilities = model(**tokens).logits.softmax(-1).tolist()
    timings.append((time.perf_counter()-began)*1000)
    predictions = [{labels[i]: float(p) for i,p in enumerate(row)} for row in probabilities]
    entailment = [p['entailment'] for p in predictions]
    predicted_classes = [max(p, key=p.get) for p in predictions]
    outputs.append(dict(**case, support_probabilities=predictions[0], contradiction_probabilities=predictions[1],
                        support_class=predicted_classes[0], contradiction_class=predicted_classes[1],
                        selected='support' if entailment[0] > entailment[1] else 'contradiction',
                        correct_support_selection=entailment[0] > entailment[1],
                        correct_pair_classes=predicted_classes[:2] == ['entailment','contradiction'],
                        predictions=predicted_classes,
                        correct_all_classes=predicted_classes == ['entailment','contradiction']+(['neutral'] if 'neutral' in case else [])))
rss_bytes = (psutil.Process().memory_info().rss if psutil else
             int(Path('/proc/self/statm').read_text().split()[1]) * os.sysconf('SC_PAGE_SIZE'))
result = dict(**lock, runtime_label=args.runtime_label, runtime_model_path=model_path,
              python=sys.version, torch=torch.__version__, cuda=torch.version.cuda,
              transformers=transformers.__version__,
              labels=labels, correct_selection=sum(row['correct_support_selection'] for row in outputs),
              correct_pair_classes=sum(row['correct_pair_classes'] for row in outputs), total=len(outputs),
              cases_file=args.cases, correct_all_classes=sum(row['correct_all_classes'] for row in outputs),
              pair_batch_median_ms=statistics.median(timings), pair_batch_timings_ms=timings,
              rss_mib=rss_bytes/1024**2,
              parameters=sum(p.numel() for p in model.parameters()), outputs=outputs,
              limitation='Controlled diagnostic, not full worker/scan or website accuracy. Selection and per-pair classification are distinct tasks.')
(OUT / args.output).write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding='utf-8')
print(json.dumps({key:result[key] for key in ['correct_selection','correct_pair_classes','total','pair_batch_median_ms','rss_mib','parameters']}))
