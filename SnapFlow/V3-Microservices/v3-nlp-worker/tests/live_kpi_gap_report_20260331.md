# Live KPI Gap Report - 2026-03-31

## Browser-Grounded Validation (Requested)
- Browser snapshots captured on live sites before KPI evaluation:
  - ACM home: title confirms microfinance regulator context.
  - Al Baraka home: title and cards confirm retail banking context.
  - BIAT home: title and navigation confirm universal banking context.
  - Medianet home: title and hero confirm AI-first digital agency context.
  - SEREPT home: title and blocks confirm petroleum/offshore operations context.

- Then a full KPI extraction was run against discovered pages from these same domains.
- Browser-groundtruth result summary:
  - sites_tested: 5
  - pages_tested: 25
  - failures: 0
  - pages_with_issues: 4
  - issue_counts_by_kpi:
    - dominant_keyword: 4

- KPI coverage:
  - All major KPI families were checked in this pass:
    - core NLP (word_count/readability/keyword_density/page_type/audience_segment/rgpd_text_analysis)
    - SEO KPIs (h1/title/meta/images/links/schema/canonical-og/llms/thin-content)
    - content KPIs (lexical/reading_time/prominence/alignment/clusters/stuffing/lsi/cta/freshness/tone/intent/entity/completeness/broken-structure)
    - RGPD KPIs (rights, dpo, third-party, pre-consent, privacy-score)

## Scope
- Real-site validation on 5 domains and 15 pages.
- Domains: ACM, Al Baraka, BIAT, Medianet, SEREPT.
- Page types tested when available: home, about, contact, privacy.

## Baseline Gaps (pre-fix)
- pages_tested: 15
- failures: 1 (BIAT contact URL 404)
- pages_with_issues: 8
- issue_counts:
  - false_positive_hidden_text: 2
  - page_type_mismatch:faq: 1
  - topic_mismatch:agence: 1
  - privacy_signal_missed: 1
  - generic_dominant:plus: 1
  - generic_dominant:projet: 3

## Implemented Fixes
1. Dominant keyword quality hardening
- Added semantic noise token filtering so generic tokens (for example plus/projet/service/news) are down-ranked for dominant keyword selection.

2. Page type classifier ordering fix
- Added explicit contact URL/title detection before FAQ heuristics to avoid contact pages being misclassified as FAQ.

3. Stuffing false-positive mitigation
- Added richer brand token derivation from hostnames.
- Tightened hidden-text trigger logic when dominant keyword is a brand token.
- Added stronger hidden-text requirement on contact pages.

4. RGPD minimization signal widening
- Broadened minimization patterns to capture data-protection phrasing commonly used on privacy pages.

5. Dominant keyword noise hardening (contact-style artifacts)
- Added contact/agence terms to semantic noise filtering so navigation/contact boilerplate is less likely to become dominant keyword.

6. Typo density false-positive elimination (fallback mode)
- When LanguageTool is unavailable, typo-density now returns a neutral value instead of lexical-unknown overcounting.

## Retest Results (post-fix)
- pages_tested: 15
- failures: 1 (BIAT contact URL 404)
- pages_with_issues: 3
- issue_counts:
  - topic_mismatch:agence: 1
  - topic_mismatch:hsse: 2

## Browser-Grounded Retest (post-fix)
- pages_tested: 25
- failures: 0
- pages_with_issues: 4
- Remaining issue concentration:
  - dominant_keyword only

### Remaining flagged pages
1. ACM contact page: dominant keyword is brand token "acm" (acceptable semantically, validator strictness).
2. ACM AML page: dominant keyword "terrorisme" (topic-specific and contextually plausible).
3. Al Baraka particuliers (AR): dominant keyword "evasion" (most suspicious residual, needs deeper tokenization review on mixed-language page templates).
4. Medianet privacy page: dominant keyword "données" (contextually valid for privacy content).

## Remaining Gaps and Fix Plan
1. Dominant keyword on mixed-language banking pages
- Residual suspect case: Al Baraka AR particuliers page selecting "evasion".
- Plan: add language-aware keyword sanitization and de-prioritize legal/compliance-only tokens for commercial landing contexts.

2. Validation vocabulary strictness
- Some residual flags are semantically valid (acm, données, terrorisme in AML context).
- Plan: contextual allow-lists by page label (privacy/contact/compliance) in validator scoring.

3. Optional tokenizer enhancement
- Plan: add robust Arabic/French token normalization and stopword balancing for multilingual pages.

## Evidence Artifact
- Detailed page-by-page browser-groundtruth results are stored in tests/browser_kpi_groundtruth_results_20260331.json.
- Detailed 15-page calibration comparison is stored in tests/tmp_mass_live_kpi_audit.json.
