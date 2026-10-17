# Progress

Spec: "Docwise Build Plan" (Claude Doc). Timeline: Day 1 → Day 5.

## Status: Day 5 done

Goal met: the held-out score is in and every number in the README links to its report. The case study is on a bhupathi.dev preview, waiting for Krishna's review.

**Done:**
- **Held-out eval, run once** with `--final`, prompt v1 on Sonnet 5.5: [eval-04](docs/measurements/eval-04-v1-sonnet-5-5-held_out.md). 20 of 20 fully correct, header fields and line-item F1 100%, review rate 5% (`inv-060`, whose line items don't add up to its printed subtotal), 0 escaped errors, cost per invoice median $0.0115 (p95 $0.0170), time median 3.1 s (p95 5.6 s). The run cost $0.2568. Nothing was tuned on the held-out invoices, before or after.
- **README:** architecture diagram, data model, the held-out table with its limits, and the tuning table with the before/after (bare prompt against v1).
- **Video:** an 86 s narrated walkthrough in the same style as Slotwise and Formwise, built in `case-study-videos`: Playwright records a local production build with the real model, Remotion adds the cards, captions and voice. The figures on its cards come from eval-02, eval-03 and eval-04.
- **Bench:** PDFs open without the viewer's thumbnail pane (`#navpanes=0&view=FitH`), so the invoice fills the bench.
- **Case study:** `/work/docwise` and a third card on the home page of bhupathi.dev, on a Vercel preview (branch `docwise`). Every number there links to a report in `docs/measurements` or to this file.
- **Tests:** 155 Vitest (the held-out report added a replay), 8 Playwright.

### Plan
1. Held-out eval, once, with `--final`.
2. README: architecture diagram, data model, final score.
3. ~90 s video in the style of the first two.
4. Case-study page and a home-page card on bhupathi.dev, preview first.
5. Docs, deploy, CI green.

## Day 4 done

Goal met: the public demo works with no sign-up (checked on the live URL, see below).

**Done:**
- **Samples:** nine tuning invoices (clean US, German format, Indian GST, scan, phone photo, two pages, handwritten notes, two that don't add up) on the home page. `npm run seed:samples` runs each one through the app's own extraction steps with the model's saved answer from [eval-02](docs/measurements/eval-02-v1-sonnet-5-5-tuning.md), so opening a sample makes no model call. Stable ids (`sample-001` …). Each sample page says where its values came from.
- **Try the review:** a sample waiting for review can be copied into the visitor's browser workspace (`documents.copied_from`; no model call) and corrected and approved there, without changing it for anyone else.
- **API v1:** `POST /api/v1/invoices` (multipart, ≤ 4 MB, type from the bytes), `GET /api/v1/invoices[/:id]`, `POST /api/v1/invoices/:id/approve` (partial corrections, `accept_failing_checks`). JSON errors with stable codes. `/developers` documents it with curl examples built from the real limits.
- **API keys:** self-serve on `/developers`, shown once, SHA-256 hash stored, up to 3 per browser, revocable. A key acts for the browser that created it, so API invoices appear in its inbox.
- **Cost caps** (`server/limits.ts`): $2 of estimated model use and 50 uploads per rolling 24 hours across the demo (browser and API); retries stop at the budget. 10 uploads an hour per network, 60 API requests a minute per key, 10 new keys a day per network, 30 sample copies an hour per network. Counters are a Postgres table (one upsert per hit). Samples and copies count toward nothing.
- **Playwright** (`e2e/`): a production build with the fake model, local storage and its own database, port and build folder (so it runs beside `next dev`). Covers opening a sample, reviewing a copy through to the CSV, an upload reaching the review queue, the API round trip (key, send, poll, refused and accepted approval, sample read-only, revoke), and phone width on four pages.
- **CI:** a second job runs the Playwright tests against a Postgres service.
- **Tests:** 154 Vitest, 8 Playwright.

**Live check (not a measurement):** on https://docwise-extract.vercel.app with no cookie: the home page lists the nine samples; the scan sample shows "Approved automatically" and its provenance line, and its original PDF comes back from R2 through a signed URL; the phone-photo sample's image loads. "Review your own copy" on `sample-056` made a private copy; approving it as printed worked, and it came out of `/export.csv`. `/developers` renders, and the API answers 401 without a key. No page errors, and no sideways scroll at 390 px on three pages. The copy was then deleted from production (only its row: it shares the sample's file); the database holds the nine samples.

**Next (Day 5):** the final held-out eval (`--final`, once), architecture diagram and data model in the README, ~90 s video, case-study page on bhupathi.dev.

### Plan
1. Demo samples: tuning invoices seeded with eval-02's saved answers; a private copy to try the review.
2. Cost caps: daily spend cap on top of the upload cap, page and run limits; per-IP and per-key rate limits in Postgres.
3. API v1 with self-serve keys, and a `/developers` page.
4. Playwright tests and a CI job with Postgres.
5. Docs, deploy, seed the samples in production, check the live URL.

## Day 3 done

Goal met: a report with every metric is in `docs/measurements/` (three runs on the tuning split).

**Done:**
- **`npm run eval`** (`scripts/eval.ts`, `src/eval/`). Each invoice goes through the app's own steps (`prepareForModel`, `pdfText`, `extractInvoice` with its retry, `scoreConfidence`, routing) and is scored against its truth file. Metrics: per-field accuracy after normalising, line-item precision / recall / F1 (lines matched in any order), documents fully correct, review rate, escaped errors (fields and documents), a routing 2×2 table, cost and time per document (median, p95), all broken down by kind.
- **Reports:** numbered runs `eval-NN-<prompt>-<model>-<split>`, as JSON (the record, with every wrong value and the run time) and markdown, comparing each run with the previous one on the same split and model. The model's raw answers are in `docs/measurements/responses/<run>/`.
- **Replay:** `npm run eval -- --replay <run>` re-scores saved answers for free. The tests replay every saved live report and expect identical metrics, so CI checks the scoring with saved answers and no key.
- **Guards:** the held-out split only runs with `--final`; a `--max-usd` cap (default $3) stops starting new invoices once reached.
- **Prompts are versioned** (`PROMPTS` in `src/extraction/prompt.ts`); the app uses `v1`. `bare` is an ablation the app never uses.
- **Model:** the app now uses Sonnet 5.5 (`DOCWISE_MODEL` still overrides it).
- **Tests:** 134 Vitest, including the replay of all three saved runs.

**Results (tuning split, 40 invoices):**

| Run | Fully correct | Escaped (fields / docs) | Review rate | Cost median / p95 | Time median / p95 |
|---|---|---|---|---|---|
| [eval-01](docs/measurements/eval-01-v1-opus-5-5-tuning.md): v1, Opus 5.5 | 40/40 | 0 / 0 | 5.0% | $0.0254 / $0.0390 | 5.0 s / 9.0 s |
| [eval-02](docs/measurements/eval-02-v1-sonnet-5-5-tuning.md): v1, Sonnet 5.5 | 40/40 | 0 / 0 | 5.0% | $0.0111 / $0.0173 | 3.1 s / 5.0 s |
| [eval-03](docs/measurements/eval-03-bare-sonnet-5-5-tuning.md): bare, Sonnet 5.5 | 40/40 | 0 / 0 | 12.5% | $0.0251 / $0.0417 | 6.3 s / 14.0 s |

- v1 sent only the two invoices that don't add up on purpose (`inv-056`, `inv-058`) to review, on both models.
- **Tuning found nothing to fix:** v1 read every tuning invoice correctly, so there was no v2. The prompt stays v1.
- **The before/after for the case study is the ablation.** Without v1's rules for values, all 40 first answers had amounts as printed (`$4,040.05`) and 38 had dates as printed (`04/21/2026`). All 40 failed validation, and the retry fixed every one. Same accuracy, but two calls per invoice and three more reviews: the model listed ambiguous dates and payment-terms-only due dates as uncertain.
- **Spend:** $2.70 across the three reports, plus about $0.05 for a two-invoice smoke run whose output was deleted.

**Next (Day 4):** API with keys, demo mode with sample invoices, per-IP rate limit and daily cost cap, Playwright tests, CI.

### Plan
1. Eval runner that reuses the app's own steps (no second pipeline to drift).
2. Scoring: field normalisation, line matching, escaped errors, routing, cost and time percentiles.
3. Reports (JSON + markdown) and saved answers; replay in the tests for CI.
4. Guards: held-out needs `--final`, spend cap per run.
5. First full score on the 40 tuning invoices with prompt v1.
6. Tune (tuning split only): compare Sonnet 5.5 within the $10 budget.
7. Update PROGRESS and the README, then deploy.

## Day 2 done

Goal met: a low-confidence invoice lands in review and can be fixed and approved (checked on the live URL, see below).

**Done:**
- **Confidence per field** (`lib/confidence.ts`, pure, shared with the eval). A field is high only if no rule implicates it, the model didn't list it as uncertain, and, for PDFs with a text layer, its value is printed in the document (`lib/text-check.ts`: numbers and dates match by value across formats; a null tax, due date or subtotal is low when the text shows one). Reasons are stored per field (`fields.confidence_reasons`).
- **Routing:** every field high → `approved` with `approval = auto`; anything low → `needs_review`.
- **Review:** an editable form on the document page with the original alongside. Flagged fields say why. Line items can be edited, added and removed, and the rules re-run as you type. Corrections go in `fields.corrected_value` / `corrected_at`, with line items as the corrected list on the `line_items` row; extracted values are never overwritten. Approving with failing checks needs a tick; unusable values (`1,500.00`, `01/10/2026`, a missing supplier) block approval.
- **Review queue** (`/review`): this browser's invoices waiting for review, oldest first, with the fields to check and why.
- **CSV export** (`/export.csv`): approved invoices (this browser's and the demo's), one row per line item, corrections applied, formula-safe text cells, UTF-8 BOM, CRLF.
- **Day 1 leftovers:** plain error messages for visitors (details stay in the extraction log); retry for failed or dropped runs (stale after 6 minutes), up to 3 runs per document.
- **Test set:** all 60 invoices. `inv-021`–`inv-045` clean; `inv-046`–`inv-060` hard: 4 scans, 3 phone photos, 3 multi-page, 2 handwritten, 3 deliberate mismatches. 40 tuning / 20 held out; one of each hard kind is held out.
- **Tests:** 110 Vitest. Added: text check, confidence (including the true values of every tuning invoice with a text layer, scored against its own PDF: no false alarms), routing, retry, approval and corrections, queue, export, CSV escaping, generator (hard slice, mismatches, committed truth files unchanged), manifest.

- **UI: the audit workbench.** A new identity, distinct from Slotwise (school timetable) and Formwise (green-bar form paper): the original on a graphite bench, beside an audit sheet where each value carries auditor's tick marks (✓ vouched, × extended, Σ footed, ⊕ cross-footed, ? unsure; `lib/marks.ts`, tested). Failed marks highlight the value. Instrument Sans + Martian Mono, cobalt / highlighter / vermilion, light and dark themes, checked at phone width with no sideways scroll.

**Live check (two tuning invoices, not a measurement):** on https://docwise-extract.vercel.app, `inv-001` was approved automatically (every field high). `inv-056`, whose printed total is wrong on purpose, went to review with subtotal, tax and total flagged ("Subtotal 6265.70 + tax 516.92 = 6782.62, but the total is 6728.62"); all 8 header fields matched `test-set/truth/inv-056.json` (line items weren't compared on this run). Approve stayed disabled until "approve as printed" was ticked, then the invoice was approved and both invoices came out of `/export.csv` (11 line-item rows). My Day 1 and Day 2 test uploads (4 documents and their R2 files) were then deleted from production.

**Krishna's own test (six tuning invoices, not a measurement):** inv-001, 052, 055, 059 were approved automatically and inv-056, 058 went to review. Compared afterwards with `test-set/truth/`: every header field and line item matched on all six. The six uploads were then deleted from production.

**Next (Day 3):** `npm run eval` (per-field accuracy, line-item F1, docs fully correct, review rate, escaped errors, cost and time per document) with reports in `docs/measurements/`; tune the prompt on the tuning split only.

### Plan
1. **Confidence per field** (`lib/confidence.ts`, pure, shared with the eval). A field is **high** only if no rule implicates it, the model didn't list it as uncertain, and (for PDFs with a text layer) its value appears in the document's own text. Otherwise **low**, with the reasons stored.
2. **Routing:** every field high → `approved` (automatic); any low → `needs_review`.
3. **Review:** an editable form on the document page (header fields + line items: edit, add, remove), rules re-run live, approve. Corrections go in `fields.corrected_value` (line items as the corrected list on the `line_items` row); the original values stay. Approving with failing rules (an invoice that is itself wrong) needs an explicit tick.
4. **Review queue** page and **CSV export** of approved invoices (one row per line item, corrected values, formula-safe).
5. **Test set:** `inv-021`–`inv-045` clean; `inv-046`–`inv-060` hard: 4 scanned-look (image-only PDFs: rotated, blurred, low contrast), 3 phone photos (JPEG: skew, shadow, background), 3 multi-page, 2 with handwritten notes, 3 whose totals don't add up on purpose. Split unchanged: every third invoice is held out (one of each hard kind lands there).
6. **Day 1 leftovers:** plain error messages for visitors, retry for failed or stuck documents, remove my two production test uploads.

## Day 1 done

Goal met: one invoice went from upload to validated fields on the live URL.

**Done:**
- **Live:** https://docwise-extract.vercel.app (deploys from `main`; migrations run in the build against Neon `docwise`).
- **Repo:** https://github.com/krishnanbhupathi/docwise-extract (public, MIT), CI on every push (lint, typecheck, tests, build).
- **Pipeline:** signed upload → server checks the stored file → extraction in `after()` → Zod → rules → `fields` / `line_items`. Locally verified end to end with the fake model and local storage.
- **Test set:** `inv-001`–`inv-020` (5 layouts; USD, EUR, GBP, INR, AUD, CAD, JPY, CHF; 1–15 line items; 14 tuning / 6 held out). True values in `test-set/truth/`, index in `test-set/manifest.json`.
- **Tests:** 41 Vitest (rules, money, extraction retry/validation, upload checks and daily cap, pipeline on PGlite, access scoping, generator determinism and arithmetic).
- **R2:** private bucket `docwise-uploads`, CORS limited to the production origin and `localhost:3000` (PUT/GET, `content-type` header only).

**Live smoke run (one invoice, not a measurement):** `inv-001` uploaded on https://docwise-extract.vercel.app went to R2, was queued, and Claude Opus 5.5 extracted it in one call (accepted on the first attempt). All 8 header fields and 7 line items match `test-set/truth/inv-001.json`; every rule passed. The extraction log on the page shows the call's tokens, time and estimated cost. Real figures come from `npm run eval` (Day 3).

**Next (Day 2):** confidence per field and routing (approved vs needs_review), review queue with corrections, CSV export, the rest of the 60-invoice test set including the hard slice.

### Plan
1. **Scaffold:** Next.js 16.4.1 (App Router), TypeScript, Drizzle on Neon (`docwise` database), Vitest with PGlite, Tailwind. Same foundations as Slotwise and Formwise.
2. **Schema:** `documents`, `extractions`, `fields`, `line_items`, `api_keys`, `eval_runs` (the plan's data model, plus the additions listed under Decisions).
3. **Upload:** the browser asks for a signed upload URL, sends the file straight to R2, then confirms. The server checks the stored object (type, size, page count) before it creates a `queued` document.
4. **Extraction:** Claude Opus 5.5 with structured outputs (a JSON schema), PDF or image input. Every attempt is logged: raw response, model, prompt version, tokens, milliseconds.
5. **Validation:** the model's JSON is parsed with Zod. One retry sends the exact errors back to the model. Only parsed output is written to `fields` / `line_items`; the model never writes to the database.
6. **Rule checks:** required fields, real calendar dates, due date not before invoice date, ISO 4217 currency, amounts valid for the currency's minor unit, quantity × unit price = amount, line items sum to the subtotal, subtotal + tax = total.
7. **Invoice generator:** HTML templates rendered to PDF by Playwright, from a seeded random generator. Each invoice has its true values as JSON. First 20 invoices: clean layouts across templates, currencies and number formats.
8. **Deploy** and run one invoice end to end on the live URL.

### Decisions
| When | Decision | Why / trade-off |
|---|---|---|
| Day 1 | Repo `docwise-extract`, public, MIT | Krishna |
| Day 1 | Storage: private Cloudflare R2 bucket `docwise-uploads`, signed URLs only | Krishna. Invoices are never at a public URL; costs one R2 API token |
| Day 1 | Model: Claude Opus 5.5 | Krishna. Cheaper models get compared later with eval numbers |
| Day 1 | Upload straight from the browser to R2 (signed PUT), not through a function | Vercel functions accept at most 4.5 MB of request body, and phone photos and scans exceed that. Cost: a CORS rule on the bucket and a two-step upload |
| Day 1 | Extraction runs in `after()` once the upload is confirmed; the page polls | No queue service to run. Trade-off: if the function dies mid-extraction, nothing retries automatically (a stale `extracting` document needs a retry, planned for Day 2) |
| Day 1 | Extra status `uploading` (row created before the file arrives) | Lets the server tie the upload to the browser that asked for it, and finish only uploads it handed out |
| Day 1 | Uploads are scoped to an anonymous browser cookie (`documents.workspace_id`) | The demo is public with no sign-up; without it, one visitor's invoices would be visible to everyone. Lose the cookie and you lose access (same as Formwise's edit links) |
| Day 1 | Line items get one `fields` row (`line_items`) | Gives line-item rule failures, confidence and corrections the same home as the header fields |
| Day 1 | Amounts are decimal strings, arithmetic in integer micro-units (BigInt) | No floating-point error in the sum and total checks; works for 0-decimal (JPY) and 3-decimal currencies |
| Day 1 | Day 1 sends every extraction to `needs_review` | Confidence and auto-approval are Day 2; nothing is approved until confidence exists |
| Day 1 | Daily cap and page limit from Day 1 (per-IP rate limit on Day 4) | The live URL is public as soon as it deploys, and it spends Krishna's API key |
| Day 2 | Confidence = rules + the model's own uncertainty + "value appears in the PDF's text layer" | Krishna. The text check is free and deterministic and catches made-up or swapped values; scans and photos have no text layer and rely on the other two signals |
| Day 2 | Reviewers can edit, add and remove line items | Krishna. Needed to fix a sum mismatch caused by a misread line |
| Day 2 | Hard slice: 4 scans, 3 photos, 3 multi-page, 2 handwritten, 3 deliberate mismatches | Krishna. Photos are first to cut if the day slips |
| Day 2 | CSV: one row per line item, invoice fields repeated | Krishna. Imports into spreadsheets and bill-line importers |
| Day 1 | `.npmrc` sets `legacy-peer-deps` | npm 10 crashes resolving vitest's optional jsdom → canvas peer chain |
| Day 2 | A split tax (CGST + SGST) passes the text check when it equals the printed total minus the printed subtotal | The sum is never printed as one number on GST invoices; without this, every Indian invoice would go to review |
| Day 2 | Handwritten-note invoices are colour scans (image-only), not PDFs with the notes as text | Real annotations are ink on paper, so they can't appear in a text layer |
| Day 2 | Corrections are kept beside the extracted values, never over them | The eval and the log must always tell what the model said from what a person fixed |
| Day 2 | Unusable values block approval even with the tick; arithmetic failures can be approved as printed | An invoice that doesn't add up is a fact about the invoice; `1,500.00` in an amount field is a typo nothing downstream can import |
| Day 2 | Retry limit: 3 runs per document; a run is "dropped" after 6 minutes | Each run can cost up to two model calls on the public key; the function's own limit is 300 s |
| Day 2 | UI identity: the audit workbench (tick marks per value, document on a bench) | Krishna chose it over "lightbox inspection" and "Swiss data sheet". The marks are the confidence reasons in an auditor's vocabulary, so the UI explains itself |
| Day 2 | Demo documents are read-only for visitors (no shared approvals) | One visitor's approval would change the demo for everyone; Day 4 decides how visitors try review on samples |
| Day 3 | Eval budget: up to $10 for Day 3 | Krishna. Spent $2.70 on the three reports |
| Day 3 | Reports are numbered runs (`eval-01-v1-opus-5-5-tuning.json` + `.md`); the run time is inside the JSON | Krishna. Sorts by run, and the name says what was run |
| Day 3 | Reports in the repo are the record of eval runs; the `eval_runs` table stays unused | Every cited number must link to a file in git; a database row would duplicate it |
| Day 3 | The eval calls the app's own functions, not a copy of the pipeline | A separate pipeline would drift, and the scores would stop describing the app |
| Day 3 | Model: Sonnet 5.5 instead of Opus 5.5 | Krishna, after eval-01 vs eval-02: same accuracy on tuning at under half the cost. Caveat: tuning has only 10 hard invoices |
| Day 3 | No v2 prompt; the before/after is an ablation (`bare` vs `v1`) | Krishna. v1 was already right on every tuning invoice, so a v2 had nothing to fix. The ablation measures what v1's rules do |
| Day 3 | The tests replay every saved live report, not only the newest | The README and case study cite all of them, so each must still reproduce |
| Day 4 | Samples show eval-02's saved answers; a sample waiting for review can be copied into the visitor's browser to review | Krishna. Free per visit and identical for everyone; the copy lets visitors try the review without changing the shared sample |
| Day 4 | API keys are self-serve, one browser's workspace each | Krishna. The demo stays sign-up free, and API invoices show up in the UI |
| Day 4 | Daily cap: $2 of estimated model use per rolling 24 hours | Krishna. Roughly 180 invoices at Sonnet's median cost |
| Day 4 | Rate-limit counters in Postgres, fixed windows | No extra service. Trade-off: a burst at a window boundary can reach twice the limit |
| Day 4 | The spend cap is checked before a run starts | Runs already started finish, so the cap can be overshot by the runs in flight (a few cents) |
| Day 4 | API uploads come in the request body (≤ 4 MB), not through a signed URL | One call for developers. Vercel caps request bodies at 4.5 MB; bigger files go through the browser |
| Day 4 | `copied_from` has no foreign key | Re-seeding a sample must not turn visitors' copies into uploads that count toward the caps |
| Day 4 | The e2e tests run on a production build with their own database, port and build folder | Closer to production than `next dev`, and they don't disturb a running dev server |
| Day 5 | The held-out run used the production API key, pulled into a temporary file and deleted after | Krishna. The key never went into the repo |
| Day 5 | The video is recorded in branded Chrome, not Playwright's bundled Chromium | Headless Chromium can't display PDFs, and the bench shows the original invoice |
| Day 5 | The case study is built in bhupathi-dev and goes to a Vercel preview first | Krishna. Production when he says so |

### Blocked on Krishna
- Review the bhupathi.dev preview, then release it to production.
- Approve uploading the video to videos.bhupathi.dev, so this README can link it like the other two.

### Set up (Day 1)
- Vercel Production env: `DATABASE_URL` (Neon pooled), `R2_ACCOUNT_ID`, `R2_BUCKET`, `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` (Account API token `docwise-extract`, Object Read & Write on `docwise-uploads` only), `ANTHROPIC_API_KEY` (key `docwise`). Values were piped from the clipboard; none are in the repo.

### Known issues
- The spend cap can be overshot by runs already in flight when it's reached (see Decisions).
- A dropped run is only retried when someone opens the document and clicks "Try again"; nothing sweeps stale documents on its own.
- R2 bucket created with location hint `enam` (near the functions in `cle1`), but `wrangler r2 bucket info` still reports APAC. Read latency gets measured rather than assumed.
