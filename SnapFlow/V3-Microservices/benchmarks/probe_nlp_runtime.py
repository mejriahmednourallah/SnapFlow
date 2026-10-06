"""Actual Python 3.11 image + Java/LanguageTool acceptance observations."""
import json
import argparse
from pathlib import Path
import subprocess
import sys
import time

import language_tool_python
import spacy

ROOT = Path('/workspace')
parser = argparse.ArgumentParser()
parser.add_argument('--output', default='production-runtime.json')
args = parser.parse_args()
sys.path.insert(0, '/app')
import main as nlp

cases = {
    'fr': [
        ('correct', 'Nous accompagnons les entreprises avec des solutions adaptées à leurs besoins. Notre équipe présente les offres disponibles et répond aux questions des clients.'),
        ('misspelling', 'Nous accompagnons les entreprises avec des serviices adaptés à leurs besoins. Notre équipe présente les offres disponibles et répond aux questions des clients.'),
        ('repeated_misspelling', 'Nous proposons des serviices utiles aux entreprises. Ces serviices répondent aux besoins des clients et nos serviices accompagnent leur activité au quotidien.'),
    ],
    'en-US': [
        ('correct', 'The museum displays ancient sculptures and paintings in spacious galleries. Visitors enjoy guided tours through the permanent collection.'),
        ('misspelling', 'The museum displays ancient sculptures and paintngs in spacious galleries. Visitors enjoy guided tours through the permanent collection.'),
    ],
    'ar': [
        ('correct', 'يمكن للعميل الاطلاع على معلومات حسابه وتحديث عنوانه عند الحاجة. يقدم فريق خدمة العملاء المساعدة ويجيب عن الأسئلة المتعلقة بالخدمات المتاحة.'),
    ],
}
observations = []
began = time.perf_counter()
tool = language_tool_python.LanguageTool('fr', language_tool_download_version='6.8')
initial_startup = time.perf_counter()-began
nlp._LT_FR = tool
nlp._LT_LOAD_FAILED = False
for language, items in cases.items():
    began = time.perf_counter()
    tool.language = language
    startup_seconds = time.perf_counter()-began
    for name, text in items:
        began = time.perf_counter()
        matches = tool.check(text)
        raw = []
        for match in matches:
            raw.append(dict(token=text[match.offset:match.offset+match.error_length],
                            issue=match.rule_issue_type, category=match.category,
                            replacements=match.replacements[:5], rule_id=match.rule_id))
        density, samples = nlp._detect_typo_density(text)
        observations.append(dict(language=language, case=name, text=text,
                                 raw_matches=raw, worker_density=density, worker_samples=samples,
                                 check_seconds=time.perf_counter()-began, startup_seconds=startup_seconds))
tool.close()
result = dict(python=sys.version, java=subprocess.run(['java','-version'],capture_output=True,text=True).stderr,
              french_spacy=spacy.load('fr_core_news_sm').meta,
              languagetool_version='6.8', initial_startup_seconds=initial_startup, observations=observations)
path = ROOT / 'output/nlp-accuracy-study' / args.output
path.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding='utf-8')
print(json.dumps({'path':str(path),'cases':len(observations)},ensure_ascii=False))
