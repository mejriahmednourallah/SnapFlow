# NLP accuracy investigation and independent review

## Current packaged-ingestion update (2026-10-04)

Independently inspected live captures exposed homepage/widget misclassification and a 0.5897 mixed-language spelling false alarm. Identity/schema classification and declared-language spelling blocks now correct these cases in the actual worker; unsupported blocks remain unmeasured and code is excluded only from spelling. Latest DOM, its own shadow observation and captured response/date publish atomically. Packaged worker with real SQL publishes six current revisions, repeats zero pages, and the actual database-backed report preserves 73 KPIs. Worker suite: 155 passed/one skipped; PostgreSQL: ten passed. See [IMPLEMENTATION_VALIDATION.md](IMPLEMENTATION_VALIDATION.md) for the latest shared-LanguageTool phase, source judgement, artifacts and remaining accuracy/duration limits.

Updated: 2026-10-04. Extraction, metric, spelling and captured-metadata defects
corrected. The CPU NLP image now passes offline Java/language checks. Full
scan duration, matched captured-page replay and broad model acceptance remain open.

## Evaluation rule

The user explicitly requires the agent to inspect and judge accuracy itself.
Expected outcomes must be specified from the source evidence before inference.
Model agreement, embedding similarity and a model's own confidence are not
ground truth. The agent reviews each mistaken result and states why the source
supports or contradicts the expected finding. This is agent review, not a claim
of independent human annotation or legal certification.

Keep development regression cases separate from a held-out acceptance corpus.
Split by website/template, not random paragraphs from the same site. Publish
false positives, missed findings, contradictory-evidence errors and results by
language and KPI. Do not collapse extraction quality, topic relevance and
factual support into one accuracy number. Ambiguous cases need explicit review.

## Confirmed defects and implemented corrections

The diagnostic executes the real worker functions and aggregator interpretation.
Expected text/values were fixed before changing the implementation.

| Root cause | Observed before | Correction |
|---|---|---|
| Boilerplate names remove substantive content | `main#cookie-policy` and `article.cookie-policy-content` lose all text; article headers are deleted | Recognize narrower widget selectors, protect content landmarks, keep article/main headers and prefer semantic content over larger generic wrappers |
| Non-visible text contaminates content | `hidden` attributes and inline `display: none` text remain in extracted main content | Remove explicitly non-visible nodes from the extraction copy; retain original HTML for other checks |
| Dominant keyword uses first-inserted frequency | Dominant density should be 0.1425, but the first introductory word produces 0.0028 | Take the count from the already computed most-frequent keyword |
| French formula uses English syllables | Controlled French text scores 29.6 instead of 40.9 | Use cached French/English textstat instances without mutating shared language state |
| Arabic title tokens are absent from alignment | Exact Arabic title/keyword match gives alignment zero | Use the shared multilingual tokenizer for title alignment |
| MTLD compared with TTR threshold | Very repetitive text has MTLD 3.0 and TTR 0.007; comparing 3.0 with 0.4 silently passes | Evaluate captured TTR in the existing report scale, preserve original MTLD/method as evidence; threshold remains 0.4 |

The targeted ten-case probe went from **1/10 to 10/10**. This is regression
evidence for these defects, not an estimate of general NLP accuracy. The new
tests also cover unrelated Arabic titles, visible classes whose names contain
`hidden`, nested consent widgets, semantic content amid larger unrelated blocks,
French-to-English state isolation, and the final lexical KPI verdict.

Host validation: **112 NLP tests passed, one live integration test skipped;
112 aggregator tests passed**. The report-level test checks that low TTR yields
a failing lexical KPI and that MTLD evidence remains available. Existing report
fields/statuses and pass thresholds remain in place. These fixes add no model
inference or browser visit; complete scan-duration equivalence is not measured.

Reproduce from the repository root:

```powershell
python V3-Microservices/benchmarks/probe_nlp_accuracy.py --output output/nlp-accuracy-study/after.json
```

Artifacts: `output/nlp-accuracy-study/before.json` and `after.json`.
The optional LanguageTool check is bypassed in this diagnostic to isolate the
calculations. Separate actual-image checks below validate Java and spelling.

## Actual CPU image: spelling and ingestion corrections

The first real Java replay exposed errors that the isolated calculation probe
could not see. Correctly spelled English museum text received typo density
**0.7647**, and correctly spelled Arabic text received **0.8**. Neither text had
a spelling match from its actual LanguageTool provider. The tiny business-word
list was treating ordinary vocabulary as errors. A French `serviices` repeated
three times also returned zero because repetition suppressed genuine errors.

Corrections now use FR/EN/AR LanguageTool providers through **one shared JVM**;
French entity protection remains French-specific. Density counts erroneous
occurrences, while the displayed sample words remain deduplicated. The existing
rule filters and KPI thresholds are retained.

| Independently specified text | Corrected worker density | Reviewed sample |
|---|---:|---|
| Correct French business paragraph | 0 | None |
| French `serviices`, once | 0.0476 | `serviices` |
| French `serviices`, three times | 0.15 | `serviices`, once in the sample list |
| Correct English museum paragraph | 0 | None |
| English `paintngs`, once | 0.0588 | `paintngs` |
| Correct Arabic customer-service paragraph | 0 | None |

The agent reviewed all six source paragraphs and raw provider matches. These
are narrow spelling checks, not an estimate of general grammar or named-entity
accuracy. The original baseline JSON was overwritten during the corrected
replay; baseline values above were observed in the original run. Do not claim
that a separate before-JSON artifact remains for these six cases.

The built `snapflow/v3-nlp-worker:accuracy-study` passed the same checks with
`--network none`, no LanguageTool cache volume, and its own packaged `/app`
code. Runtime: Python 3.11.17, Java 21.0.12.1, language-tool-python 3.4,
LanguageTool 6.8, French spaCy model 3.7.0. NLTK resources and the pinned 6.8
server are packaged at build time; cached NLTK resources no longer cause an
import-time download probe. Torch/CUDA and Playwright are absent in this default
CPU NLP image. See `IMAGE_SPLIT.md` for image/storage measurements.

The offline probe's JVM startup was 2.46 seconds. The first French case took
17.46 seconds, including dictionary/entity initialization and **both** a raw
provider check and a worker check. These timings are not production per-page
latency. Warm-up, language changes, full worker throughput and scan duration
still need measurement. Do not promote a model from this startup test alone.

Captured navigation response HTML and case-normalized headers now reach NLP
from `metrics.rendered_discovery` when the dedicated source field is absent.
Explicit stored source takes precedence; an unknown source remains unknown.
Hydrated DOM stays separate. Captured headers reach the existing freshness path
and avoid its otherwise redundant HEAD request. Tests cover precedence and
ensure the input metrics object is not mutated.

Real isolated PostgreSQL acceptance was rerun: **5/5 passed**, covering
concurrent claims, revision changes, stale publication rejection, expired
claims, readiness and schema reapplication. This does not establish the complete
scanner-to-report scan lifecycle or deployment acceptance.

Artifacts: `output/nlp-accuracy-study/production-runtime-offline-final.json`,
its `.log`, `production-runtime.json`, and
`output/production-nlp-worker-final-build.log`. Reproduce the offline probe from
the repository root:

```powershell
$nlpStudyWorkspace = (Get-Location).Path
docker run --rm --network none --mount "type=bind,source=$nlpStudyWorkspace,target=/workspace" snapflow/v3-nlp-worker:accuracy-study python /workspace/V3-Microservices/benchmarks/probe_nlp_runtime.py --output production-runtime-offline-final.json
```

## Agent judgement of a real model

The earlier 12/12 ranking result was too easy to establish KPI accuracy. The
0.56/2.35/4.86-second figures are median semantic-inference times from the host
pilot, not average whole-worker times.

Before inference, the agent authored 15 explicit support-versus-contradiction
cases, five each in FR/EN/AR, with a judgement rationale for each. The corpus is
`V3-Microservices/benchmarks/nlp_judgement_cases.json`; its SHA-256 is recorded
with the inference output to identify the labels used. The probe runs the
locally pinned MiniLM weights; no model generates labels or grades the answers.

The agent inspected all 15 outputs. MiniLM's similarity-based selection chose
support in **9/15** and chose the contradictory text in **6/15**. Each language
had the same two failure types:

| Required evidence | Wrong selection | Agent judgement |
|---|---|---|
| Retention of 30 days | A near-identical sentence saying 300 days | The numerical duration contradicts the claim; reject as support |
| Cancellation without fees | Cancellation with fees | The condition changes the meaning; reject as support |

For the English retention example, support similarity was 0.680 and the
contradiction scored 0.843. For the French free-cancellation example, support
scored 0.686 and the paid cancellation scored 0.875. Higher similarity did not
make either statement supporting evidence. Other simple explicit-denial cases
were correctly ordered; do not generalize that MiniLM always fails negation.

This adversarial task checks suitability for **evidence verification**, which
is different from the model's topic-similarity task. It does not mean MiniLM is
60% accurate on websites, nor that MPNet/E5 would resolve the failures. Those
models have not run this corpus because their local weights were removed during
disk recovery. No model is accepted as a compliance or factual verifier.

Reproduce:

```powershell
python V3-Microservices/benchmarks/probe_nlp_judgement.py --output output/nlp-accuracy-study/minilm-judgement.json
```

## Token-aware ingestion: tested, opt-in

Whole-body character truncation does not resolve the encoder's 128-token
limit. An optional passage path now splits the complete extracted text using
the actual tokenizer, reserves special tokens, validates each encoded span,
and stores exact character/token offsets. Query and passage embeddings share
one deduplicated batch. A configurable window cap records whether analysis is
complete; it never claims whole-document processing when capped.

`NLP_PASSAGE_RETRIEVAL_ENABLED=false` remains the default and requires semantic
enrichment to be enabled. The old cosine fields retain their meaning. The new
`semantic_enrichment.passage_retrieval` object is engineering evidence and is
not yet consumed by aggregator KPI verdicts. Its scores mean topic relevance,
not factual support.

The agent specified mortgage evidence among museum paragraphs at the beginning,
middle and end, separately for FR/EN/AR, before inference. With the real pinned
MiniLM, legacy input contained the evidence in **3/9** cases; the winning
retrieved passage contained it in **9/9**. All nine exact source spans and token
coverage records were checked. These are simple topic-retrieval cases, not
rights/compliance verification. Host retrieval timings ranged from 284 to
1,273 ms per document, including tokenization and inference. Production
full worker and complete-scan cost remain unmeasured.

The separate optional CPU image subsequently built successfully. An offline
repeat used its packaged `/app/main.py` and `/app/content_passages.py` (asserted
by the probe), Python 3.11.17, PyTorch **2.13.0+cpu**, sentence-transformers
**3.0.1**, and the existing pinned MiniLM weights. It again recovered **9/9**
prescribed passages with exact source spans and complete token coverage.
Recorded document times ranged from **205 to 965 ms** for this controlled
worker semantic path, excluding model load and Java/grammar work. This is
actual-image inference acceptance for these cases, not complete-worker or
browser-to-report acceptance. CUDA is absent. See
`output/nlp-accuracy-study/production-content-passages.json` and its `.log`.

Artifacts: `output/nlp-accuracy-study/content-passages.json`;
`V3-Microservices/benchmarks/probe_content_passages.py`. Worker tests also prove
that late text enters inference and legacy outputs remain unchanged with the
new flag off. Markdown still remains an additional cleaned projection: do not
discard HTML, headers, headings or shadow text, or send Markdown through an HTML
extractor and assume word-count equivalence.

## Task-specific NLI comparison and agent judgement

Both candidates ran the same pre-labelled 15 support/contradiction pairs on
the host CPU with two inference threads. Selection and factual classification
are reported separately: choosing the slightly higher score is insufficient
when both passages are classified as contradictions.

| Candidate | Parameters | Correct support selection | Both pair classes correct | Two-premise batch median | Process RSS |
|---|---:|---:|---:|---:|---:|
| Multilingual MiniLMv2-L6 MNLI/XNLI | 107.0M | 12/15 | 6/15 | 19.6 ms | 678 MiB |
| mDeBERTa-v3-base MNLI/XNLI | 278.8M | 15/15 | 12/15 | 240.5 ms | 1,646 MiB |

The agent reviewed every mistaken pair against its source text:

- The small model accepted Arabic **paid** cancellation as support for **free**
  cancellation (entailment score 0.977). It correctly recognized only 7/15
  supporting statements. Reject it for automatic factual/compliance verdicts.
- The larger model correctly rejected all 15 contradictions, but labelled the
  valid 30-day deletion/retention paraphrase as a contradiction in **each of the
  three languages**. Deletion after thirty days supplies the intended retention
  duration in these controlled cases; choosing that text over 300 days still
  does not make the model's classification correct. Treat duration wording and
  retention/deletion context as an explicit review/calibration requirement.

A second corpus was authored before its inference: nine FR/EN/AR claim sets
about solar generation, online booking and free delivery, each with supporting,
contradictory and neutral text. The larger model classified **27/27 statements**
correctly, with median three-premise batch time 372.5 ms and RSS 1,651 MiB. The
agent checked all outputs against the fixed rationales. This is held-out from
the first diagnostic topics, **not** a held-out website/template acceptance set;
simple translated examples do not establish general KPI accuracy.

Both larger-model corpora were then replayed offline in the optional CPU NLP
dependency image: Python 3.11.17, PyTorch 2.13.0+cpu and transformers 4.57.6.
The 15-pair result remains 15/15 selections and 12/15 fully correct pairs, with
**the same three retention misses**; the separate set remains 27/27 statements
correct. The agent checked the three wrong source statements again, not just
host/image agreement. Image medians were **284.6 ms** (two premises) and
**383.6 ms** (three), with resident process memory **1,721/1,744 MiB**. These
run the benchmark's NLI classifier in the actual dependency image, not a new
production worker/verdict integration. Full scan duration remains open.

Artifacts: `production-nli-large-judgement.json` and
`production-nli-large-heldout.json`, plus their logs, under the same output
directory. Weights were reused from the immutable lock through the workspace
mount; no download was permitted by the container.

Decision: retain MiniLM as the retrieval baseline. Keep mDeBERTa as the candidate
for bounded clause-level shadow verification; it is not installed in the worker
or promoted to a verdict model. It adds about 1.6 GiB host process RSS here and
does not prove an equally fast replacement. Use literal dates, quantities,
units and qualifiers alongside model evidence; benchmark actual image and scan
cost before any default change.

Immutable revisions and results:

- Small: `0a71e92a985b6e1ad1828cf67ce9c459639c1dca`,
  `nli-model.lock.json` and `nli-judgement.json`.
- Large: `8adb042d524ecd5c26d3e3ba0e3fbcf7e2d0864c`,
  `nli-large-model.lock.json`, `nli-large-judgement.json`,
  `nli-large-heldout.json`.

Files above are under `output/nlp-accuracy-study`. Labelled cases and the runner
are under `V3-Microservices/benchmarks`: `nlp_judgement_cases.json`,
`nlp_heldout_judgement.json`, `probe_nli_judgement.py`. The rejected small model's
427,997,022-byte weight file was removed after testing; its lock, tokenizer and
results remain. The larger candidate and retrieval baseline are retained.

## Additional root causes to address next

- Thin-content producer/report policy consistency is now implemented, with
  detected language (including very short text), exact route utility exclusions,
  one quality row per page and distinct affected-page counts. Existing heuristic
  values remain unchanged. Nine pre-authored policy cases establish consistency,
  not independent semantic quality or calibration. Representative site labels
  are still needed before changing those values.
- The real spelling providers now replace the faulty English/Arabic dictionary
  path. Broader name/domain-vocabulary, mixed-language and grammar tests remain;
  provider failure still has legacy neutral handling and is not proof of a
  clean spelling measurement. Verify initialization and measured execution in
  the scan acceptance phase rather than assuming absence of samples is success.
- Rights coverage is keyword presence, not affirmation: the explicit sentence
  denying access and erasure still records both rights as found. Preserve the
  distinction between mention, grant, denial and qualified exception in clause
  evidence. Do not equate any of these with a legal compliance conclusion.
- Cannibalization groups at least five URLs sharing a dominant stem, without
  proving that those pages compete for the same intent. Review distinct topics,
  translations, navigation repetition and deliberate related articles.
- The opt-in passage path addresses measured token truncation; production
  replay, revision/query caching, sentence boundaries and cross-page evidence
  adapters remain. A capped document is explicitly partial. Do not silently
  treat its unprocessed tail as analyzed.
- The current extractor does not evaluate stylesheet rules. Inline/attribute
  fixes are useful but cannot substitute for captured browser visibility and
  the cleaned Markdown/shadow projection. Current capture/model paths still
  require matched production replay.

## Model direction and next acceptance experiment

Keep MiniLM for retrieving potentially relevant passages. Test models on the
task that matters after retrieval: selecting related content is not the same as
verifying numbers, negation, units or conditions. The two-stage retrieval and
reranking pattern is documented by
[Sentence Transformers](https://www.sbert.net/examples/sentence_transformer/applications/retrieve_rerank/README.html).

Evidence-support comparison has now tested multilingual NLI models that
distinguish entailment, contradiction and neutral text, including
[mDeBERTa MNLI/XNLI](https://huggingface.co/MoritzLaurer/mDeBERTa-v3-base-mnli-xnli)
and the smaller MiniLMv2 NLI candidate referenced by its author. The larger
candidate remains restricted to further shadow evaluation. Apply it only to
selected sentence pairs, and independently judge its mistakes on held-out
sites. Dates, amounts and units still need literal source evidence.
Measure complete NLP/scan cost; no equal-speed claim is established.

Continue correcting acquisition and rule defects, validate passage ingestion
on matched captured/live pages, then integrate evidence per KPI. The controlled
actual-image passage and NLI replays above pass for their stated scope; matched
site evidence and full worker timing are the next acceptance stage.
Preserve exact evidence spans, HTML/metadata and the nine-field KPI contract.
Calibration/optimization sets must remain separate from final acceptance;
report per-KPI false alarms and misses on both controlled and representative
live pages before changing model or verdict defaults.

Technical checks consulted:
[textstat language configuration](https://github.com/textstat/textstat/blob/main/README.md),
[Sentence Transformers token limits](https://www.sbert.net/examples/sentence_transformer/applications/computing-embeddings/README.html).
Local runtime observations, not upstream documentation, establish the fixes and
scores reported above.

## Implementation acceptance: content policy and report evidence (2026-10-04)

The active goal is resumed. This slice implemented the thin-content ownership
correction and opt-in H1/meta passage adapters described in `REPLAN.md`.
The worker supplies its measured page-type rule; aggregation consumes that
result instead of independently substituting 300 words. French/Arabic inputs
now reach the actual worker publishing call, including its short-text branch.
Utility exclusion uses exact URL path segments; `research.example` and
`/news/cartography` no longer accidentally bypass measurement. Thin, spelling
and stuffing evidence is deduplicated per page, and the final KPI counts their
URL union. Its final French finding and exported rows reflect those observations.
No policy benchmark or language multiplier was recalibrated.

Full offline page processing discovered a root defect missed by the earlier
spelling-only probes: English `textstat` readability requires NLTK `cmudict`.
The previous image tried downloading it during inference and failed offline.
The CPU base now packages and verifies it at build; both worker images rebuilt
successfully. A valid partial SEO payload also crashed aggregation because its
llms.txt fallback referenced an undefined `base_domain`; it now uses the page host.

Validation:

- Host suites: **127 worker tests pass, one live test skipped; 132 aggregator
  tests pass**. The existing five real PostgreSQL revision/claim tests were
  verified in the preceding phase; they were not rerun in this slice.
- The actual packaged Python 3.11 worker processes **14/14 pages offline**:
  two FR/AR language fixtures and six saved Chromium plus six saved unfiltered
  stealth Obscura observations. Real LanguageTool, spaCy, readability and page
  classification execute. Claims/publication and llms.txt are local fixture
  adapters. Captured dates, hydration/shadow markers and hidden/script exclusions
  survive. There are no new browser visits or live database writes in this replay.
- Actual worker outputs reach the real host report builders. Each engine's
  six fixture pages produce five thin-content signals and a separate stuffing
  signal on the repetitive heavy page: **six distinct affected pages**, with
  matching URLs and six evidence rows. This is source/data propagation proof,
  not a semantic quality accuracy score or an engine speed comparison.
- Opt-in packaged MiniLM retains the independently specified paragraph in
  **9/9** FR/EN/AR beginning/middle/end cases versus legacy input's **3/9**.
  Both final H1/meta adapters retain the selected text and query in all nine
  cases. They add `data.related_passages`, separate from failing rows, with
  source hash, content revision, processing completeness and Unicode code-point
  offsets into stripped extracted text. They do not alter KPI verdicts.

The isolated 14-page worker replay takes **28.73 seconds**, including **15.58
seconds for its first French page/JVM/entity initialization**. The two 4,801-word
heavy-page executions take 3.67/2.93 seconds, in that order within one process;
the second benefits from warmed providers. Tiny fixture medians are not
representative of production pages. Worker peak RSS is **375.4 MiB**, while the
whole container peaks at **1,238.9 MiB**, including Java and charged file cache.
The optional nine-case passage inference ranges from **213 to 1,431 ms** per
document with two CPU inference threads, excluding model loading. These are
local replay costs, not complete scan-duration acceptance or a speed gain.

Agent source review identifies unfinished input issues: the saved shadow
capture concatenates `SHADOW_READYShadow` and `NLP.SHADOW_LINK`, retaining
evidence but losing word boundaries. Browser discovery still falls back to
shadow-root `textContent`; fix separators and visibility at acquisition before
trying to guess them from flattened text. The mixed-language/code fixture
reports English-provider spelling samples `confidentialité` and `const`; these
are not typos in that source. Its density remains below the report's existing
failing threshold, but broader mixed-language/code ingestion must be reviewed.
No claim that spelling or content quality is universally accurate follows.

Artifacts in `output/nlp-accuracy-study`: `production-content-pipeline.json`,
`production-content-report.json`, `production-content-passages-contract.json`
and their logs; image builds are `base-content-build.log`,
`worker-content-build.log`, `semantic-content-build.log`. Runners and the
pre-authored policy cases are in `V3-Microservices/benchmarks`.
Next: capture text boundaries/visibility, reviewed site labels and matched
whole-worker/scan acceptance; keep browser/model promotion conditional.
## Shared LanguageTool and ingestion validation — 2026-10-04

See [IMPLEMENTATION_VALIDATION.md](IMPLEMENTATION_VALIDATION.md) for actual
packaged worker/PostgreSQL publication and report reload evidence. Six known
pages retain independently expected selected text, 251/252 words and captured
dates, with current revisions and zero work on the second NLP cycle.

The warmed one/two-worker pilot measured 24.15/22.90 s means for 12 controlled
FR/EN/AR pages. Worker-container memory increased from about 433 to 741 MiB,
excluding LanguageTool. Identical outputs establish concurrency consistency;
they do not replace independently authored source/KPI labels or establish
general model accuracy. Keep one worker initially; retain current models and
thresholds until held-out final-KPI benefit and server cost are demonstrated.

The actual packaged provider-outage test now passes against isolated PostgreSQL:
stopped LT produces a partial/unmeasured spelling observation, then restarting
LT and a new worker process recovers the unchanged 337-word French page at
revision 1. Immediate second cycles do no work. The fixture advances its retry
clock; SQL tests separately verify the real delay and three-total-attempt cap.
Artifacts: `provider-fail.json` and `provider-recover.json`. This closes a
permanent-missing-measurement defect; it is not a model-accuracy benchmark.

## Late-paragraph spelling coverage correction

The agent authored two known `serviices` typos in paragraphs 35 and 36 before
running the real provider. The old 30-paragraph cap submitted 600/800 words and
missed both. A batching experiment submitted all 800 words, found exactly both
occurrences and reduced 30 HTTP checks to one. Warmed alternating trials took
75.42/61.85 s for the old path and 5.35/4.64 s for batching. The labels come from
the source, not agreement between models. This is one French controlled case.
This experiment provides line-separated input directly. The current HTML
extractor usually flattens paragraphs, so the 30-paragraph limit and measured
speed benefit do not describe every multi-paragraph production page. The
prefix truncation does affect flattened long input; its regression uses
actual HTML main-content extraction before checking the late suffix.

Production source now preserves all eligible paragraphs and text beyond the
old 100,000-character prefix in 20,000-character requests. It preserves
paragraph separators and short-snippet exclusion, and computes density and
checked-word count from actual eligible input. Four new regressions cover
late typos, long suffixes, short-copy denominator dilution and a provider
failure between batches. The full worker suite passes **155 tests, one
skipped**. Models and verdict thresholds are unchanged.

Artifact: `output/nlp-accuracy-study/spelling-coverage.json`. Docker approval
review temporarily hit its usage limit after the experiment, then became
available. The source-only final image rebuild and actual-provider replay now
pass five authored FR/EN/AR clean/late-typo cases through HTML extraction plus
a long English suffix with all 60 expected occurrences. The long spelling-only
case submits all 18,020 words in eight bounded requests and takes 5.87 seconds.
Artifact: `spelling-candidate.json`. This is not a whole-worker before/after
benchmark or general site accuracy result; full-scan cost remains unverified.

The final image also republishes the six owned scanner SQL observations at
their current revisions, preserving captured dates and 251/252 words. The
first cycle takes 1.61 seconds with the shared provider already warm; immediate
repeat does zero work. Actual database-backed report construction/reload still
passes the 73-KPI contract and retains all six expected affected pages. The
scanner browser adapter and scope limits remain explicit. No VPS deployment
or 500-page default promotion is claimed.
