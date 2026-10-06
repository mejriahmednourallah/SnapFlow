# NLP model pilot and KPI accuracy plan

Updated: 2026-10-04. Status: embedding host pilot complete for five configurations;
task-specific NLI and passage diagnostics complete for their controlled scope.
Offline CPU NLP language/passage and candidate NLI checks pass for their stated
scope; matched page replay, full scan timing and held-out site accuracy remain unfinished.
No model default is changed.

Follow-up: `NLP_ACCURACY_REVIEW.md` records extraction/calculation/report and real
spelling corrections, captured response ingestion, independently specified
regression cases, and agent review of embedding/NLI errors. The earlier 12/12
relevance result must not be interpreted as KPI accuracy.

## Task-specific follow-up

Token-aware MiniLM passage retrieval found the prescribed beginning/middle/end
evidence in 9/9 FR/EN/AR cases; legacy input contained it in only 3/9. The
implemented path is opt-in, preserves extracted-text spans and reports capped
token coverage. It does not automatically change any KPI verdict.

The smaller multilingual MiniLMv2-L6 NLI model selected support in 12/15 but
classified both sides correctly in only 6/15, including an Arabic false
affirmation of paid cancellation as free cancellation. Reject it for factual
verdicts. mDeBERTa-v3-base NLI selected support in 15/15 and classified both sides
correctly in 12/15. Its three retention-paraphrase misses remain material.
It classified 27/27 statements correctly in a separately authored controlled
topic set; this is not held-out website acceptance.

Measured host medians: small NLI 19.6 ms and mDeBERTa 240.5 ms for a two-premise
batch; mDeBERTa 372.5 ms for the three-premise held-out batches. Host process RSS
was 678 MiB and 1,646–1,651 MiB respectively. These use short clause pairs, a
different task/input from the body embeddings below. They do not prove a larger
equally fast replacement or unchanged full-scan duration.

Actual-image follow-up used Python 3.11.17, CPU PyTorch 2.13.0,
sentence-transformers 3.0.1 and transformers 4.57.6, with networking disabled.
The packaged worker recovered 9/9 prescribed passages (205–965 ms per controlled
document, excluding model load and grammar). The larger NLI candidate reproduced
15/15 selections, 12/15 fully correct pairs and 27/27 statements on the separate
set, including the same three retention errors. Its image batch medians were
284.6/383.6 ms and process RSS 1,721/1,744 MiB. These test the real dependency
runtime; they do not integrate the classifier into KPI verdicts or establish
whole-worker/scan throughput. Full details and source judgements are in
`NLP_ACCURACY_REVIEW.md`.

Decision: retain MiniLM as retrieval baseline; keep mDeBERTa for bounded
clause-level shadow evaluation with literal date/unit/condition checks. Neither
NLI model is integrated or promoted. The rejected small weight file was removed
after testing; its revision and results remain. See `NLP_ACCURACY_REVIEW.md` for
exact source judgements and `REPLAN.md` for KPI-specific evidence consumers.

## What was actually tested

The benchmark used separate CPU processes, two inference threads, 12 synthetic
relevance triplets (four each in French, English and Arabic), and 36 timed page
evaluations per configuration. Each page compared title, description and H1
with its body. The batched path encoded four inputs together; the old path
encoded three pairs, repeatedly encoding the body. Results and immutable model
revisions are recorded in `output/nlp-model-study/model-*.json` and
`models.lock.json`. The executable benchmark is
`V3-Microservices/benchmarks/benchmark_nlp_models.py`.

| Model / CPU mode | Parameters | Batched median per page | Batched p95 | Old median per page | Sampled peak process RSS | Correct relevance orderings |
|---|---:|---:|---:|---:|---:|---:|
| Multilingual MiniLM, float32 | 117.7M | 565 ms | 905 ms | 1,029 ms | 751 MiB | 12/12 |
| Multilingual MiniLM, dynamic INT8 | 117.7M | 483 ms | 892 ms | 934 ms | 1,583 MiB | 12/12 |
| Multilingual MPNet, float32 | 278.0M | 2,346 ms | 2,920 ms | 3,858 ms | 1,011 MiB | 12/12 |
| Multilingual MPNet, dynamic INT8 | 278.0M | 1,412 ms | 1,857 ms | 2,536 ms | 2,938 MiB | 12/12 |
| Multilingual E5-base, float32 | 278.0M | 4,857 ms | 5,962 ms | 7,702 ms | 1,085 MiB | 12/12 |

E5 INT8 was interrupted before producing a result. It is not a measured entry.
The larger model weights were subsequently removed to recover disk space;
results, configurations and revision locks remain available for reproduction.

These results do **not** establish a larger model that is equally fast. They
also do not establish the best model for SnapFlow: all models reached the ceiling
of this small ranking fixture, with no measured accuracy advantage.

## Limits and additional findings

- The pilot used Windows Python 3.13.5, CPU PyTorch 2.9.0 and
  sentence-transformers 5.1.2. Production specifies Linux Python 3.11,
  CPU PyTorch 2.13.0 for optional semantics, and sentence-transformers 3.0.1.
  Container acceptance must use the production runtime.
- Docker build/download work overlapped the pilot. Repeat timing under idle,
  controlled load before drawing production latency conclusions. These numbers
  measure semantic inference, not the complete NLP worker or complete scan.
- The synthetic long bodies exceed the token limit. MiniLM and MPNet retained
  at most 128 tokens; E5 retained at most 512. E5 used query/passage prefixes.
  Its longer input budget explains some additional work and makes it an
  unsuitable drop-in score comparison. A 6,000-character setting does not mean
  the model analyzed the entire document.
- Float32 batching retained the compared cosine outputs within approximately
  0.00000018. Dynamic INT8 changed old-versus-batched scores by as much as
  0.0551 for MiniLM and 0.0348 for MPNet. Ranking parity on 12 easy cases is
  insufficient evidence that quantization preserves KPI decisions.
- Dynamic quantization increased observed peak and steady memory here.
  Do not describe this specific experiment as a memory saving. Its PyTorch
  API also differs from the intended production runtime; a supported optimized
  backend needs its own equivalence and resource measurements.

## Trace back from the KPI before changing a model

The worker's `build_semantic_enrichment()` emits optional alignment signals.
Current aggregator and frontend source searches found no consumer of these
signals in KPI verdicts. Installing a larger embedding model alone therefore
does not improve the reported content KPIs.

| Target KPI / observation | Existing path to inspect | Next accuracy evidence |
|---|---|---|
| Thin content and lexical diversity | Extracted main text, token counts and lexical calculations | Gold text spans; distinguish substantive content from navigation, hidden text and legitimate short pages |
| Freshness | Structured dates, metadata and captured response headers | Published/updated date truth; ambiguous footer years and mixed date sources |
| Key pages and CTAs | Page classification, route and visible action signals | Independently labelled page types and CTA availability across FR/EN/AR |
| Cannibalization | Keywords and cross-page analysis | Label overlapping topics separately from translation variants or intentionally related pages |
| H1 / description quality | Heading/metadata text and its relationship to the actual body | Relevant, unrelated, ambiguous and contradictory pairs, including relevant content late in the document |
| Grammar / named entities | LanguageTool and spaCy entity protection | Real production Java/LanguageTool output; valid names versus misspellings; evaluate a larger French spaCy model only if it reduces measured errors |
| Privacy and rights | Explicit textual evidence and current legal-text detectors | Required clauses, negation, incomplete promises and unrelated mentions; embeddings must not turn topical similarity into legal proof |

The accepted text-acquisition work comes first: preserve raw HTML, hydrated DOM,
shadow text and metadata, and publish NLP for the current content revision.
Missing or truncated evidence cannot be repaired by a larger model.

## Revised experiment order

1. Validate the new CPU NLP image, actual French spaCy loading, Java and
   LanguageTool 3.4 field handling. Replay matched Chromium/Obscura captures
   through this worker, retaining each engine's source and selected text.
2. Build a labelled task corpus with expected text, page types and individual
   KPI decisions. Separate extraction errors, rule errors and model errors;
   include late-document evidence and multilingual/shadow content.
3. Keep MiniLM float32 as the comparison baseline and measure the implemented
   duplicate-encoding removal in production. Compare any candidate on the same
   task/input budget; add a longer-context experiment separately.
4. Evaluate supported CPU optimization of MPNet only if its task accuracy
   improves on that corpus. Compare task-specific spaCy candidates when entity
   recognition is the actual error source. Neither experiment is accepted yet.
5. Keep candidate semantic interpretations in engineering shadow comparison
   until their errors are understood and the intended KPI integration is
   specified. Preserve the nine-field report contract and existing thresholds.
6. Run matched complete scans, including all NLP queue time, browser recovery,
   CPU and memory. Promote a model/engine only with better labelled results and
   acceptable measured scan duration. Do not infer this from per-page inference
   alone.

Current conclusion: retain the model default and measured batching improvement;
the token-aware path passes controlled actual-image inference and stays opt-in.
Complete matched captured/live page and KPI accuracy tests before model promotion.
Obscura promotion independently requires usable acquisition and recovery-inclusive
duration.
