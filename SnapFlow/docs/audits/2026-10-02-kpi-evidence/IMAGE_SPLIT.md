# CPU service image split — updated 2026-10-04

## Current browser-runtime update (2026-10-04)

The CPU browser base and pool now build, and actual packaged Playwright 1.44 Chromium launches and preserves original response, Last-Modified and shadow evidence. The baseline worker also publishes current revisions using real PostgreSQL. Form-executor build and full live-stack scan/queue throughput remain pending. Current test/storage figures are in [ACQUISITION_CHECKPOINT.md](ACQUISITION_CHECKPOINT.md); earlier browser-unbuilt and six-tag/zero-cache statements below describe earlier checkpoints.

The user approved separating NLP and browser services from the shared heavy
image, superseding the earlier decision to keep them together. This changes
packaging, not the model, browser-selection defaults or KPI report contract.

## Resulting dependency graph

- `v3-python-fastapi-base`: shared API/database packages.
- `v3-python-nlp-base` inherits FastAPI: text analysis, French spaCy model,
  NumPy 1.26.4 and headless Java for LanguageTool; no browser or PyTorch/CUDA.
- `v3-python-browser-base` inherits FastAPI: existing browser runtime
  libraries/fonts, Playwright 1.44 Chromium and Pillow.
- `v3-python-heavy-base` inherits the browser base: visual-comparison and
  PyTorch/CUDA/LPIPS packages; consumed only by visual regression.

NLP now inherits its text base. The browser pool and optional form executor
inherit the browser base. Browser installation runs once in that base and
must succeed. The heavy base no longer installs NLP packages.

Optional semantic installation stays disabled by default. When explicitly
enabled, the NLP service installs pinned CPU PyTorch before sentence-transformers
and asserts that CUDA support is absent. A failed CPU install stops the build
instead of proceeding to a generic PyTorch dependency download.

Both base build scripts support CPU-only development (`-CpuOnly` / `--cpu-only`)
and retain full-stack builds. The full order is FastAPI, NLP, browser, visual/GPU.
Only the public FastAPI parent accepts `--pull`; child parents are local images.
See `V3-Microservices/RUNBOOK.md` for commands.

## Validation and remaining acceptance

- Common FastAPI base rebuilt successfully; log:
  `output/production-fastapi-split-build.log`.
- CPU NLP base and worker built successfully. Logs:
  `output/production-nlp-assets-build.log` and
  `output/production-nlp-worker-final-build.log`.
- Optional CPU semantic worker also built; log:
  `output/production-nlp-semantic-build.log`. Its packaged worker/passage code
  passed 9/9 controlled FR/EN/AR retrieval cases offline using existing MiniLM
  weights. PyTorch 2.13.0+cpu and sentence-transformers 3.0.1 load; CUDA is absent.
  The candidate NLI classifier also ran offline in this dependency image with
  the same independently reviewed results/misses. These are controlled runtime
  checks, not full worker or scan acceptance.
- The worker's packaged `/app` code passed six FR/EN/AR spelling checks with
  `--network none` and no language cache volume. Python 3.11.17, Java 21.0.12.1,
  LanguageTool 6.8 and French spaCy 3.7.0 are present. NLTK resources are packaged;
  Torch and Playwright imports are absent in this default CPU image. Result:
  `output/nlp-accuracy-study/production-runtime-offline-final.json`.
- Host NLP suite: 112 passed, one skipped live integration test. Aggregator:
  112 passed. Isolated real PostgreSQL handoff: 5 passed.
- Host browser-pool suite: 14 passed.
- PowerShell and Bash syntax passed.
- Mocked PowerShell Docker calls verified CPU-only selection (three bases, no
  heavy image), reuse without rebuilds, no child-parent pull, and full build
  dependency ordering. Logs: `output/cpu-base-script-check.log`,
  `output/cpu-base-reuse-check.log`, `output/full-base-script-check.log`.
- Compose service configuration and `git diff --check` passed.

Docker image-list size is **1.71 GB** for the NLP base and worker, including
packaged LanguageTool/NLTK assets; these images share layers, so their listed
sizes must not be summed as independent disk consumption. The optional semantic
worker reports **3.35 GB** and shares the same base. All six retained images
occupy **4.117 GB** according to `docker system df` after the second cache cleanup.
Docker Desktop's image-inspect `Size` field reports a different content
representation (~522 MB here); use the reported measurement/source explicitly.
Neither number measures process RAM or worker throughput.

**Not yet accepted:** browser/form-executor image builds or Chromium launch,
full production NLP queue throughput, matched engine replay with all intended
models, and end-to-end scan
timing. The first French offline case includes substantial dictionary/entity
warm-up; it is not a per-page production latency benchmark.

## Historical capacity obstruction and current cleanup

Docker cleanup removed 7.416 GB of build cache and 520.1 MB of unused images,
preserving containers and database volumes. Windows did not return that space
to C:; Docker's WSL `docker_data.vhdx` still occupies 21,572,354,048 bytes.
Subsequent disk checks fell below 1 GB free, so further builds were stopped.

A guarded helper is available at
`V3-Microservices/benchmarks/Compact_Docker_Disk.ps1`. It requires Windows
administrator privileges, stops Docker, checks that the existing data disk is
detached, and uses DiskPart compaction without deleting images/containers/volumes.
Windows reported that the administrator prompt was cancelled; the helper did
not run and no successful compaction is claimed.

On 2026-10-04, a fresh capacity check found enough space to build the CPU NLP
images. This does not establish why capacity became available. After validation,
the requested cleanup removed **1.708 GB** of Docker build cache, then **2.166 GB**
after the optional CPU semantic build (**3.874 GB total**); dangling-image
pruning found **0 B** more. The known scratch Alpine image had also been removed.
Six needed image tags remain (FastAPI/NLP bases, baseline/semantic NLP workers, original
Obscura and PostgreSQL), with all containers and volumes preserved. The rejected
small NLI model's **427,997,022-byte** weight was deleted from the workspace;
its revision lock, tokenizer and measured results remain. Larger candidate and
retrieval baseline weights are retained for upcoming comparisons.

After the optional image checks, C: still has about **4.6 GB free** (latest
measurement recorded in `output/nlp-accuracy-study/final-storage.json`). Build
cache is **0 B**.
The Docker VHD was not compacted; Docker's internal reclamation must not be
reported as the same quantity of host free space returned. Cleanup log:
`output/nlp-accuracy-study/docker-cleanup-2026-10-04.log`.

## Content implementation checkpoint (2026-10-04)

The NLP CPU base and both worker images rebuilt after full offline page replay
found missing NLTK `cmudict`. The base now installs and verifies this English
readability dependency. Actual packaged worker extraction, classification,
LanguageTool/spaCy and KPI production process 14/14 saved-capture/language pages
with networking disabled. This uses fixture database adapters, not the real
production queue. The optional semantic worker's nine exact-span cases also
reach both H1/meta report adapters; verdicts remain unchanged by retrieval.

The isolated 14-page replay took 28.73 seconds, including 15.58 seconds on
the first page/provider initialization. Worker peak RSS was 375.4 MiB and
whole-container peak memory 1,238.9 MiB (including Java and charged file cache).
These are local replay observations; browser launch, real queue throughput,
recovery-inclusive scan duration and full production acceptance remain pending.

After testing, Docker reported removal of 2.087 GB plus 1.470 GB of unused
build cache; final cache is 0 B. Six needed tags remain, including the 1.71 GB
baseline and 3.36 GB optional worker (reported image sizes include shared layers).
Docker's total image storage is 4.124 GB. Three stopped containers and four
volumes were preserved; C: has about 8.0 GB free. No VHD compaction is claimed.
Evidence: `output/nlp-accuracy-study/content-storage.json`,
`docker-content-cleanup.log`, `production-content-pipeline.json`,
`production-content-passages-contract.json` and `production-content-report.json`.
