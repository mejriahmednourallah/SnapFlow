"""Prepare locked model candidates locally; no page content leaves the machine."""
import json
import os
from pathlib import Path

os.environ['HF_HUB_DISABLE_XET'] = '1'
from huggingface_hub import model_info, snapshot_download

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT/'output/nlp-model-study'
OUT.mkdir(parents=True, exist_ok=True)
MODELS = ['sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2',
          'sentence-transformers/paraphrase-multilingual-mpnet-base-v2',
          'intfloat/multilingual-e5-base']
lock = []
for name in MODELS:
    info = model_info(name)
    path = snapshot_download(name, revision=info.sha, local_dir=OUT/'models'/name.split('/')[-1],
        allow_patterns=['*.json','*.txt','*.model','*.safetensors','1_Pooling/*','2_Normalize/*'],
        ignore_patterns=['onnx/*','openvino/*','tf*','rust*','pytorch_model.bin'])
    row = {'model':name,'revision':info.sha,'path':str(Path(path).resolve()),
           'license':getattr(info.card_data,'license',None)}
    lock.append(row)
    (OUT/'models.lock.json').write_text(json.dumps(lock, indent=2), encoding='utf-8')
    print(json.dumps({k:row[k] for k in ['model','revision','license']}), flush=True)
