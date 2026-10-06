from pathlib import Path
import hashlib
import json
from urllib.request import urlopen

url = "https://raw.githubusercontent.com/h4ckf0r0day/obscura/v0.2.3/crates/obscura-js/src/markdown.rs"
source = urlopen(url,timeout=15).read().decode()
script = source.split('r#"',1)[1].rsplit('"#',1)[0]
path = Path(__file__).with_name("obscura_markdown.js")
path.write_text(script,encoding="utf-8")
path.with_suffix(".provenance.json").write_text(json.dumps({"source_url":url,"version":"v0.2.3","license":"Apache-2.0","sha256":hashlib.sha256(script.encode()).hexdigest()},indent=2),encoding="utf-8")
print("Pinned converter saved:",len(script),"characters")
