# PFE Chapter 4 Enhancement - Microservices, Audit Engine, And KPI Pipeline

> Purpose: Add deeper technical content to Chapter 4, "Sprint 2: Website Audit Engine And KPI Pipeline".  
> Language: English.  
> Format: Markdown with report-ready LaTeX snippets.  
> Goal: Make the microservices section more complete, precise, and engineering-oriented.

---

## 1. What Your Current Chapter Already Covers Well

Your current chapter already explains the most important high-level ideas:

- why the audit engine could not be implemented as a single monolithic backend;
- why crawling, NLP, browser rendering, visual regression, and KPI consolidation have different runtime needs;
- why each service owns a specific data domain;
- how the frontend starts an audit through Supabase Edge Functions;
- how the aggregator orchestrates the scan lifecycle;
- how the scanner collects website evidence;
- how the NLP worker enriches pages asynchronously;
- how the browser pool and visual regression services support dynamic and visual evidence;
- why the KPI contract is necessary for stable reporting.

The chapter is already conceptually strong. What it needs now is more **concrete implementation detail**: service inventory, API endpoints, state machine, internal phases, failure handling, and data contracts.

---

## 2. Most Important Additions

Add these elements to make the chapter feel complete:

1. A complete microservice inventory table.
2. A scan lifecycle state machine.
3. A detailed aggregator API paragraph.
4. A more explicit scanner pipeline.
5. The NLP worker concurrency/polling model.
6. More detail about browser pool responsibilities.
7. More detail about visual regression responsibilities.
8. A paragraph on failure tolerance and partial evidence.
9. A table connecting each service to its owned data.
10. A short "limits and future improvements" subsection.

---

## 3. Suggested Chapter Structure

You can structure Chapter 4 like this:

```text
4. Sprint 2: Website Audit Engine And KPI Pipeline
  4.1 Sprint Goal
  4.2 Why Microservices Were Needed
    4.2.1 Different Workloads
    4.2.2 Clear Data Ownership
    4.2.3 Runtime Isolation And Failure Containment
  4.3 Audit Generation Flow
  4.4 Scan Lifecycle State Machine
  4.5 Microservice Inventory
  4.6 Microservice Responsibilities
    4.6.1 V3 Aggregator
    4.6.2 V3 Scanner Go
    4.6.3 Obscura And Cloudflare Fallback
    4.6.4 V3 NLP Worker
    4.6.5 V3 Visual Regression
    4.6.6 V3 Browser Pool
    4.6.7 V3 Form Executor
  4.7 V3 PostgreSQL: Scan Evidence Database
  4.8 KPI Contract
  4.9 Failure Handling And Partial Evidence
  4.10 Technical Limits And Future Improvements
```

If you do not want to make the chapter too long, merge sections 4.4 and 4.5 into the current `Audit Generation Flow` and `Microservice Responsibilities` sections.

---

## 4. Add This After "Why Microservices Were Needed"

### Markdown Explanation

Add a third subsection that explains runtime isolation. This makes the architecture decision more convincing.

### LaTeX Snippet

```latex
\subsubsection{Runtime Isolation and Failure Containment}

The microservice split also improves failure containment. Each component of the audit pipeline has a different failure profile. A crawler can be slowed down by network latency or anti-bot protection, a browser rendering task can fail because of a timeout, and an NLP task can require more CPU time depending on the amount of extracted text. If all these responsibilities were executed inside one backend process, a failure in one area could affect unrelated features.

By isolating the services, SnapFlow reduces this risk. The aggregator remains responsible for API semantics and lifecycle state, while the scanner, NLP worker, visual regression service and browser pool can fail or restart independently. This separation also simplifies troubleshooting: when a scan is blocked during acquisition, the scanner is inspected; when page enrichment is missing, the NLP worker is inspected; when screenshots are unavailable, the visual regression or browser pool services are inspected.
```

---

## 5. Add A Microservice Inventory Table

### Where To Insert

Place this after the audit generation flow, before describing each service one by one.

### LaTeX Snippet

```latex
\subsection{Microservice Inventory}

Table~\ref{tab:v3-microservices-inventory} summarizes the main services involved in the V3 audit pipeline. This inventory is important because the architecture is not only divided by source code folders, but by runtime responsibility, data ownership and operational constraints.

\begin{table}[H]
\centering
\caption{V3 microservice inventory}
\label{tab:v3-microservices-inventory}
\begin{tabular}{|p{3.5cm}|p{2.5cm}|p{2cm}|p{5.8cm}|}
\hline
\textbf{Service} & \textbf{Runtime} & \textbf{Port} & \textbf{Main responsibility} \\
\hline
\texttt{v3-aggregator} & Python / FastAPI & 8080 & Public API gateway, scan orchestration, lifecycle state, KPI consolidation and recommendation endpoints. \\
\hline
\texttt{v3-scanner-go} & Go & 8081 & Website acquisition engine: crawling, static analysis, domain-level checks, form discovery, headless sampling and scan summaries. \\
\hline
\texttt{v3-nlp-worker} & Python & Internal worker & Asynchronous enrichment of crawled pages: content extraction, readability, SEO text analysis, RGPD signals and page classification. \\
\hline
\texttt{v3-visual-regression} & Python / FastAPI & 8083 & Screenshot capture, visual comparison, UX visual indicators and browser compatibility checks. \\
\hline
\texttt{v3-browser-pool} & Python / Playwright & 8084 & Shared Chromium rendering capacity used by scanner and visual services for dynamic pages and screenshots. \\
\hline
\texttt{v3-form-executor} & Python / Playwright & 8085 & Execution of approved form-testing scenarios stored in Supabase. This service is used by the form testing workflow rather than the core audit scan. \\
\hline
\end{tabular}
\end{table}
```

### Why This Helps

This table makes the reader immediately understand that the architecture is not arbitrary. Each service exists because it has a specific runtime, operational role, and responsibility.

---

## 6. Add A Scan Lifecycle State Machine

### Where To Insert

Place this after the current `Audit Generation Flow` section.

### LaTeX Snippet

```latex
\subsection{Scan Lifecycle State Machine}

The audit pipeline is asynchronous, so a scan cannot be represented as a simple request-response operation. I therefore modelled the scan as a lifecycle with explicit states. A scan starts in a pending state, moves to running when the scanner begins acquisition, then enters an NLP processing phase while page enrichment is completed. Finally, the scan is marked as complete or failed.

\begin{center}
\texttt{PENDING $\rightarrow$ RUNNING $\rightarrow$ NLP\_PROCESSING $\rightarrow$ COMPLETE}
\end{center}

\begin{center}
\texttt{RUNNING $\rightarrow$ FAILED}
\end{center}

This state machine allows the frontend to poll progress without blocking the user interface. It also makes failure handling clearer: if the scanner fails, the scan can be marked as failed; if NLP enrichment is incomplete after a timeout, the aggregator can still build a partial report while preserving the fact that some indicators were not fully evaluated.
```

### Optional Diagram Text

You can later replace the text state machine with a figure:

```text
PENDING -> RUNNING -> NLP_PROCESSING -> COMPLETE
                    \-> FAILED
```

---

## 7. Improve The Aggregator Subsection

### What To Add

You already explain the aggregator as orchestrator. Add API details and owned outputs.

### LaTeX Snippet

```latex
The aggregator exposes several API endpoints that correspond to the lifecycle of an audit. The most important endpoint is \texttt{POST /scan}, which starts an asynchronous scan and immediately returns a scan identifier. For testing and smoke validation, \texttt{POST /scan/sync} can run a blocking scan. The frontend follows progress through \texttt{GET /scan/\{scan\_id\}/status}, retrieves the full result through \texttt{GET /scan/\{scan\_id\}/result}, and consumes the canonical KPI payload through \texttt{GET /scan/\{scan\_id\}/kpis}.

The aggregator also exposes specialized reporting endpoints such as recommendations, top-level KPI summaries and quality or drift information. This API design hides the internal database structure from the frontend. The frontend does not need to read raw page rows or scanner summaries directly; it consumes a stable API contract produced by the aggregator.

In terms of data ownership, the aggregator owns \texttt{scan\_state} and \texttt{scan\_kpi\_outputs}. This makes it the lifecycle and reporting authority of the V3 backend. It is the only service responsible for turning distributed evidence into the canonical audit output.
```

### Endpoint Table

Add this if you want more technical detail:

```latex
\begin{table}[H]
\centering
\caption{Main V3 aggregator endpoints}
\label{tab:aggregator-endpoints}
\begin{tabular}{|p{4cm}|p{9cm}|}
\hline
\textbf{Endpoint} & \textbf{Purpose} \\
\hline
\texttt{GET /health} & Checks whether the aggregator service is healthy. \\
\hline
\texttt{POST /scan} & Starts an asynchronous scan and returns a scan identifier. \\
\hline
\texttt{POST /scan/sync} & Runs a blocking scan, mainly useful for tests and smoke validation. \\
\hline
\texttt{GET /scan/\{id\}/status} & Returns scan progress, state and partial counters. \\
\hline
\texttt{GET /scan/\{id\}/result} & Returns the full aggregated report when the scan is complete. \\
\hline
\texttt{GET /scan/\{id\}/kpis} & Returns the canonical KPI payload consumed by the frontend and reports. \\
\hline
\texttt{GET /scan/\{id\}/recommendations} & Returns classified recommendations and roadmap items. \\
\hline
\texttt{GET /scan/\{id\}/kpis/top} & Returns a compact top-level KPI summary. \\
\hline
\end{tabular}
\end{table}
```

---

## 8. Improve The Scanner Subsection

### What To Add

Your scanner paragraph is good, but add the internal phases as a clear pipeline.

### LaTeX Snippet

```latex
The scanner is implemented as a multi-phase pipeline rather than a single crawl loop. This design makes the acquisition process easier to debug because each phase has a clear purpose. The pipeline starts with pre-fetch checks such as SSL, sitemap, robots.txt and homepage retrieval. It then runs domain analyzers for technology, security, privacy and functional signals. After that, the Colly-based crawl discovers pages and persists page-level evidence.

Once raw evidence is stored, the scanner can run additional acquisition steps: form discovery, form fuzzing, headless sampling and mobile testing. If the crawl returns insufficient data because of anti-bot protection or Cloudflare-like behavior, fallback and backfill phases can use rendered discovery. The scanner therefore does not only crawl pages; it coordinates several acquisition strategies to maximize the amount of usable evidence.
```

### Scanner Phase Table

```latex
\begin{table}[H]
\centering
\caption{Scanner acquisition phases}
\label{tab:scanner-phases}
\begin{tabular}{|p{4cm}|p{9cm}|}
\hline
\textbf{Phase} & \textbf{Purpose} \\
\hline
Pre-fetch & Checks SSL/TLS, sitemap, robots.txt and homepage HTML before deeper crawling. \\
\hline
Domain analyzers & Extracts domain-level technical, security, privacy and functional signals. \\
\hline
Colly crawl & Discovers pages and collects raw HTML and page-level metrics. \\
\hline
Database synchronization & Persists evidence into PostgreSQL so that downstream services can process it. \\
\hline
Fallback handling & Recovers partial evidence when crawling is blocked or incomplete. \\
\hline
Form discovery and fuzzing & Detects forms and runs controlled security-oriented form tests when enabled. \\
\hline
Headless sampling & Uses browser rendering for pages where static HTML is not enough. \\
\hline
Mobile tests & Runs limited mobile-oriented performance checks. \\
\hline
Final summary & Produces domain-level summaries used by the KPI builder. \\
\hline
\end{tabular}
\end{table}
```

---

## 9. Improve Obscura And Cloudflare Fallback

### Important Tone

Do not claim that every protected site is solved. Say it is an architectural mitigation.

### LaTeX Snippet

```latex
This fallback mechanism should be understood as an architectural mitigation rather than a guarantee that every protected site can be fully crawled. Real websites may still block automated traffic or expose only limited content. However, by combining static crawling, rendered discovery, browser execution and backfill logic, SnapFlow reduces the risk of producing an empty or misleading audit when the initial crawl path is incomplete.
```

---

## 10. Improve The NLP Worker Subsection

### What To Add

Mention row-level polling and asynchronous enrichment.

### LaTeX Snippet

```latex
A key implementation detail of the NLP worker is that it processes database rows asynchronously instead of receiving direct HTTP requests. It searches for pages where \texttt{nlp\_results IS NULL}, locks a batch of pending rows, processes them and writes the result back to PostgreSQL. This design allows multiple worker replicas to process different rows without duplicating work.

This also decouples crawl speed from NLP processing speed. The scanner can finish acquisition while the NLP worker continues enrichment in the background. If the enrichment is not fully complete when the aggregator builds the report, the system can still represent the missing information as unavailable rather than silently treating it as successful.
```

### NLP Pipeline Table

```latex
\begin{table}[H]
\centering
\caption{NLP worker enrichment tasks}
\label{tab:nlp-enrichment-tasks}
\begin{tabular}{|p{4cm}|p{9cm}|}
\hline
\textbf{Task} & \textbf{Purpose} \\
\hline
Text extraction & Extracts meaningful page content from raw or rendered HTML. \\
\hline
Readability analysis & Evaluates whether content is understandable for the target audience. \\
\hline
Keyword analysis & Detects keyword prominence, density and possible stuffing. \\
\hline
Page classification & Identifies page type such as homepage, article, product page or contact page. \\
\hline
Freshness analysis & Extracts dates and evaluates content freshness. \\
\hline
SEO text checks & Evaluates H1 quality, heading hierarchy and meta description quality. \\
\hline
RGPD analysis & Detects privacy, consent, legal notice and user rights signals. \\
\hline
\end{tabular}
\end{table}
```

---

## 11. Improve Visual Regression

### LaTeX Snippet

```latex
The visual regression service complements textual and technical analysis by producing visual evidence. It can capture screenshots, compare a current scan with a previous baseline and compute UX-oriented indicators. This service is isolated because screenshot capture and image comparison are resource-intensive operations. They require browser rendering, viewport control, timeout management and image processing.

Keeping visual analysis separate prevents screenshot work from slowing down the scanner. It also allows visual thresholds, comparison algorithms and UX indicators to evolve independently from crawling logic. This separation is especially useful when the platform needs to distinguish between a technical issue and a visual regression visible to the final user.
```

### Visual Regression Responsibilities Table

```latex
\begin{table}[H]
\centering
\caption{Visual regression service responsibilities}
\label{tab:visual-regression-responsibilities}
\begin{tabular}{|p{4cm}|p{9cm}|}
\hline
\textbf{Responsibility} & \textbf{Description} \\
\hline
Screenshot capture & Captures page screenshots for visual evidence and comparison. \\
\hline
Visual comparison & Compares screenshots between baseline and current scans. \\
\hline
UX visual KPIs & Produces indicators related to visual complexity, CTA visibility or first impression. \\
\hline
Browser compatibility & Supports comparison between browser rendering outputs. \\
\hline
\end{tabular}
\end{table}
```

---

## 12. Improve Browser Pool

### LaTeX Snippet

```latex
The browser pool is a shared rendering service. Its role is not to decide audit conclusions, but to provide browser execution as a reusable infrastructure capability. Services can request rendered HTML, screenshots or rendered discovery without each service launching and managing its own Chromium process.

This is especially useful for JavaScript-heavy websites, where the static HTML response does not contain the final visible content. Centralizing browser execution also makes timeouts, concurrency limits and browser recycling easier to control. Instead of duplicating browser management in the scanner, visual regression service and form executor, SnapFlow exposes rendering through a single internal service.
```

### Browser Pool Capabilities Table

```latex
\begin{table}[H]
\centering
\caption{Browser pool capabilities}
\label{tab:browser-pool-capabilities}
\begin{tabular}{|p{4cm}|p{9cm}|}
\hline
\textbf{Capability} & \textbf{Use in SnapFlow} \\
\hline
Rendered HTML & Allows services to analyze JavaScript-rendered pages. \\
\hline
Screenshot capture & Supports visual regression and PDF/report evidence. \\
\hline
Batch screenshots & Reduces overhead when several pages must be captured. \\
\hline
Rendered discovery & Helps recover links, forms and content not visible in static HTML. \\
\hline
Shared Chromium pool & Reduces duplicated browser startup cost and memory usage. \\
\hline
\end{tabular}
\end{table}
```

---

## 13. Mention V3 Form Executor

### Why Mention It

Even if Chapter 4 is about the audit engine, the form executor is part of your microservice ecosystem. You can mention it briefly and say it belongs mainly to the form testing workflow.

### LaTeX Snippet

```latex
The V3 form executor is not part of the core website audit scan in the same way as the scanner or NLP worker. It belongs to the form testing workflow, where approved scenarios are stored in Supabase and later executed through a Playwright-based worker. I mention it here because it follows the same architectural principle: browser-heavy, long-running execution is isolated from the frontend and from the aggregator. This keeps form scenario execution independent from audit report generation.
```

---

## 14. Add Failure Handling And Partial Evidence

### Where To Insert

Place this near the end, after the KPI contract.

### LaTeX Snippet

```latex
\subsection{Failure Handling and Partial Evidence}

The V3 pipeline was designed to tolerate imperfect acquisition. Real websites can block crawlers, delay JavaScript rendering, expose only partial content to static HTTP requests or respond differently depending on headers and browser behavior. A reliable audit system must therefore avoid two opposite mistakes: failing the entire report too early, or treating missing evidence as a successful check.

SnapFlow handles this by distinguishing between measured results and unavailable results. The scanner includes fallback and backfill paths, the browser pool supports rendered discovery, and the aggregator can mark KPIs as passing, failing, warning or not available. This distinction is important for report credibility. If evidence is missing, the KPI should be represented as unavailable rather than converted into a false positive or a false success.

The same principle applies to NLP enrichment. Since the NLP worker runs asynchronously, some pages may still be pending when the aggregator reaches the report-building stage. In that case, the system can still build a partial report while preserving traceability of unavailable or partially evaluated indicators. This makes the user experience smoother without hiding the limits of the collected evidence.
```

---

## 15. Add A Better Data Ownership Table

### LaTeX Snippet

```latex
\begin{table}[H]
\centering
\caption{Data ownership in the V3 audit backend}
\label{tab:v3-data-ownership}
\begin{tabular}{|p{4cm}|p{4cm}|p{5cm}|}
\hline
\textbf{Data} & \textbf{Owner} & \textbf{Reason} \\
\hline
Crawled pages and metrics & Scanner & The scanner is responsible for acquisition and first-level page analysis. \\
\hline
Domain summaries & Scanner & Domain-level technical, security, privacy and functional summaries are produced during acquisition. \\
\hline
NLP results & NLP worker & Text enrichment is asynchronous and belongs to the content analysis stage. \\
\hline
Visual screenshots & Visual regression service & Screenshots and visual artifacts are produced by the visual analysis service. \\
\hline
KPI outputs & Aggregator & The aggregator consolidates distributed evidence into the canonical KPI contract. \\
\hline
Scan lifecycle state & Aggregator & The aggregator is the public lifecycle authority for the frontend. \\
\hline
Product metadata and reports & Supabase application layer & Users, projects, audit records, schedules and report snapshots belong to the product workflow. \\
\hline
\end{tabular}
\end{table}
```

---

## 16. Add Technical Limits And Future Improvements

### Where To Insert

Place this at the end of the chapter. It makes your report sound more mature and honest.

### LaTeX Snippet

```latex
\subsection{Technical Limits and Future Improvements}

Although the V3 audit pipeline provides a clear separation of responsibilities, some limits remain. First, protected websites may still restrict automated crawling even with fallback and rendered discovery mechanisms. Second, browser-based analysis is resource-intensive and requires careful timeout and concurrency management. Third, NLP enrichment depends on the quality of extracted text; JavaScript-heavy pages that fail to hydrate correctly may produce limited content evidence.

Future improvements could include queue-based orchestration for scan jobs, more precise progress reporting, better browser pool saturation metrics and deeper observability for each service. The NLP worker could also benefit from backlog-based autoscaling, where the number of pending \texttt{scan\_pages} rows directly influences the number of worker replicas. Finally, visual regression could be expanded with richer baseline management and more detailed user-facing visual explanations.
```

---

## 17. Optional Diagram Suggestions

You can add these diagrams to make the chapter look more professional.

### 17.1 Sequence Diagram - Full Audit Lifecycle

Recommended lifelines:

```text
React Frontend
Supabase Edge Function
V3 Aggregator
V3 Scanner Go
V3 PostgreSQL
NLP Worker
Browser Pool
Visual Regression
KPI Output
Frontend Dashboard
```

Flow:

```text
Frontend -> fetch-audit-api -> Aggregator POST /scan
Aggregator -> scan_state pending
Aggregator -> Scanner POST /scan
Scanner -> PostgreSQL scan_pages / scan_summaries
NLP Worker -> PostgreSQL nlp_results
Scanner -> Browser Pool for rendered pages
Aggregator -> Visual Regression when needed
Aggregator -> scan_kpi_outputs
Frontend -> poll status / fetch KPI result
```

### 17.2 Component Diagram - V3 Backend

Include:

```text
Aggregator
Scanner
NLP Worker
Visual Regression
Browser Pool
PostgreSQL snapflow_v3
Supabase Application DB
```

### 17.3 State Machine Diagram

```text
PENDING
  -> RUNNING
  -> NLP_PROCESSING
  -> COMPLETE

RUNNING
  -> FAILED

NLP_PROCESSING
  -> FAILED
```

### 17.4 Scanner Pipeline Diagram

```text
Pre-fetch
  -> Domain analyzers
  -> Colly crawl
  -> DB sync
  -> Cloudflare fallback
  -> Form discovery/fuzzing
  -> Headless sampling
  -> Cloudflare backfill
  -> Mobile tests
  -> Final summary
```

---

## 18. What To Fix In The Current Text

Your pasted chapter has some encoding issues. Fix these before final export.

| Current text | Replace with |
|---|---|
| `SnapFlowâ€“` | `SnapFlow -` or `SnapFlow --` |
| `Í¾` | `;` |
| `becomingadumpingground` | `becoming a dumping ground` |
| `Supabaseownstheproductworkflow` | `Supabase owns the product workflow` |
| `TheV3databaseownsscanevidence` | `The V3 database owns scan evidence` |
| `Thisgives` | `This gives` |
| `Theworker design` | `The worker design` |

Also check line breaks around words split by PDF extraction, such as:

```text
Post greSQL
re port
au tomation
```

These should become:

```text
PostgreSQL
report
automation
```

---

## 19. Short Version If The Chapter Is Getting Too Long

If you only want the highest-impact additions, add:

1. Microservice inventory table.
2. Scan lifecycle state machine.
3. Aggregator endpoint paragraph.
4. Scanner phase table.
5. Failure handling and partial evidence subsection.

That gives you the best improvement without expanding the chapter too much.

---

## 20. Final Report-Ready Summary Paragraph

You can use this at the end of Chapter 4:

```latex
At the end of Sprint 2, SnapFlow had moved from a simple application backend to a distributed audit engine. The scanner acquired technical evidence from real websites, the NLP worker enriched page content asynchronously, the browser pool provided shared rendering capacity, the visual regression service produced visual evidence, and the aggregator consolidated all these signals into a stable KPI contract. This architecture made the audit pipeline easier to scale, debug and evolve because each service owned a clear responsibility and wrote only the data it was designed to produce.
```

---

## 21. Checklist Before Finalizing Chapter 4

- [ ] Add the microservice inventory table.
- [ ] Add the scan lifecycle state machine.
- [ ] Add the aggregator endpoint explanation.
- [ ] Add the scanner phase table.
- [ ] Add NLP worker polling/concurrency explanation.
- [ ] Add browser pool capabilities table.
- [ ] Add visual regression responsibilities table.
- [ ] Add failure handling and partial evidence subsection.
- [ ] Mention form executor briefly as a related microservice.
- [ ] Fix mojibake and spacing errors.
- [ ] Insert or generate the sequence diagram.
- [ ] Insert or generate the scanner pipeline diagram.

