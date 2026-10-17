# Progress

Spec: "Docwise Build Plan" (Claude Doc). Timeline: Day 1 → Day 5.

## Status: Day 2 done

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

### Blocked on Krishna
- Nothing.

### Set up (Day 1)
- Vercel Production env: `DATABASE_URL` (Neon pooled), `R2_ACCOUNT_ID`, `R2_BUCKET`, `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` (Account API token `docwise-extract`, Object Read & Write on `docwise-uploads` only), `ANTHROPIC_API_KEY` (key `docwise`). Values were piped from the clipboard; none are in the repo.

### Known issues
- A dropped run is only retried when someone opens the document and clicks "Try again"; nothing sweeps stale documents on its own.
- R2 bucket created with location hint `enam` (near the functions in `cle1`), but `wrangler r2 bucket info` still reports APAC. Read latency gets measured rather than assumed.
