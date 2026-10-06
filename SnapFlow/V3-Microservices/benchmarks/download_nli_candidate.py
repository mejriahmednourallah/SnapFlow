"""Download one revision-locked task-specific NLI candidate for local testing."""
import json
import argparse
import os
from pathlib import Path

os.environ['HF_HUB_DISABLE_XET'] = '1'
from huggingface_hub import model_info, snapshot_download

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'output/nlp-accuracy-study'
parser = argparse.ArgumentParser()
parser.add_argument('--model', default='MoritzLaurer/multilingual-MiniLMv2-L6-mnli-xnli')
parser.add_argument('--lock', default='nli-model.lock.json')
args = parser.parse_args()
name = args.model
info = model_info(name)
path = snapshot_download(name, revision=info.sha,
    local_dir=OUT / 'models' / name.split('/')[-1],
    allow_patterns=['config.json','tokenizer*','special_tokens_map.json','sentencepiece*','*.model','model.safetensors'],
    ignore_patterns=['onnx/*','openvino/*','pytorch_model.bin'])
row = dict(model=name, revision=info.sha, path=str(Path(path).resolve()),
           license=getattr(info.card_data, 'license', None))
(OUT / args.lock).write_text(json.dumps(row, indent=2), encoding='utf-8')
print(json.dumps(row), flush=True)
