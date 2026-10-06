"""Quick native CLI Markdown fidelity probe while the Linux comparator builds."""
import json
from pathlib import Path
import subprocess
import sys
import threading
import time

HERE=Path(__file__).resolve().parent
sys.path.insert(0,str(HERE/"obscura-study"))
from fixtures import server

out=HERE.parents[1]/"output/playwright/obscura-study/native-cli"
out.mkdir(parents=True,exist_ok=True)
fixture=server()
threading.Thread(target=fixture.serve_forever,daemon=True).start()
report=[]
try:
    for path in ["/structured","/delayed","/shadow"]:
        began=time.perf_counter()
        result=subprocess.run(["docker","exec","snapflow-obscura-auth-benchmark","/obscura","fetch",f"http://host.docker.internal:18991{path}","--dump","markdown","--wait","1","--timeout","10","--quiet"],capture_output=True,text=True,encoding="utf-8",timeout=25)
        (out/f"{path.strip('/')}.md").write_text(result.stdout,encoding="utf-8")
        text=result.stdout
        row={"path":path,"exit_code":result.returncode,"wall_ms":round((time.perf_counter()-began)*1000,1),
             "bytes":len(text.encode()),"has_h1":"# STRUCTURE_READY" in text,
             "hydrated":"HYDRATED_READY" in text,"shadow":"SHADOW_READY" in text,
             "hidden_text":"HIDDEN_TEXT_SHOULD_NOT_BE_VISIBLE" in text,"script_text":"SCRIPT_TEXT_SHOULD_NOT_BE_CONTENT" in text,
             "stderr":result.stderr[-1200:]}
        report.append(row)
        print(json.dumps(row),flush=True)
finally:
    fixture.shutdown()
    (out/"probe.json").write_text(json.dumps(report,indent=2),encoding="utf-8")
