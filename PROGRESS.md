# Progress

Spec: "Docwise Build Plan" (Claude Doc). Timeline: Day 1 Mon 19 Oct → Day 5 Fri 23 Oct 2026 (Day 1 started Sat 17 Oct).

## Status: Day 1 (in progress)

Goal: one invoice goes from upload to validated fields on the live URL.

**Done (17 Oct):**
- **Live:** https://docwise-extract.vercel.app (deploys from `main`; migrations run in the build against Neon `docwise`).
- **Repo:** https://github.com/krishnanbhupathi/docwise-extract (public, MIT), CI on every push (lint, typecheck, tests, build).
- **Pipeline:** signed upload → server checks the stored file → extraction in `after()` → Zod → rules → `fields` / `line_items`. Locally verified end to end with the fake model and local storage.
- **Test set:** `inv-001`–`inv-020` (5 layouts; USD, EUR, GBP, INR, AUD, CAD, JPY, CHF; 1–15 line items; 14 tuning / 6 held out). True values in `test-set/truth/`, index in `test-set/manifest.json`.
- **Tests:** 41 Vitest (rules, money, extraction retry/validation, upload checks and daily cap, pipeline on PGlite, access scoping, generator determinism and arithmetic).
- **R2:** private bucket `docwise-uploads`, CORS limited to the production origin and `localhost:3000` (PUT/GET, `content-type` header only).

**Left for Day 1:** one real invoice through Claude on the live URL. Waiting on the two keys below.

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
| 17 Oct | Repo `docwise-extract`, public, MIT | Krishna |
| 17 Oct | Storage: private Cloudflare R2 bucket `docwise-uploads`, signed URLs only | Krishna. Invoices are never at a public URL; costs one R2 API token |
| 17 Oct | Model: Claude Opus 5.5 | Krishna. Cheaper models get compared later with eval numbers |
| 17 Oct | Upload straight from the browser to R2 (signed PUT), not through a function | Vercel functions accept at most 4.5 MB of request body, and phone photos and scans exceed that. Cost: a CORS rule on the bucket and a two-step upload |
| 17 Oct | Extraction runs in `after()` once the upload is confirmed; the page polls | No queue service to run. Trade-off: if the function dies mid-extraction, nothing retries automatically (a stale `extracting` document needs a retry, planned for Day 2) |
| 17 Oct | Extra status `uploading` (row created before the file arrives) | Lets the server tie the upload to the browser that asked for it, and finish only uploads it handed out |
| 17 Oct | Uploads are scoped to an anonymous browser cookie (`documents.workspace_id`) | The demo is public with no sign-up; without it, one visitor's invoices would be visible to everyone. Lose the cookie and you lose access (same as Formwise's edit links) |
| 17 Oct | Line items get one `fields` row (`line_items`) | Gives line-item rule failures, confidence and corrections the same home as the header fields |
| 17 Oct | Amounts are decimal strings, arithmetic in integer micro-units (BigInt) | No floating-point error in the sum and total checks; works for 0-decimal (JPY) and 3-decimal currencies |
| 17 Oct | Day 1 sends every extraction to `needs_review` | Confidence and auto-approval are Day 2; nothing is approved until confidence exists |
| 17 Oct | Daily cap and page limit from Day 1 (per-IP rate limit on Day 4) | The live URL is public as soon as it deploys, and it spends Krishna's API key |
| 17 Oct | `.npmrc` sets `legacy-peer-deps` | npm 10 crashes resolving vitest's optional jsdom → canvas peer chain |

### Blocked on Krishna
- `ANTHROPIC_API_KEY` (new key `docwise`) in Vercel Production.
- R2 API token for `docwise-uploads` (Object Read & Write): `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` in Vercel Production.

### Known issues
- R2 bucket created with location hint `enam` (near the functions in `cle1`), but `wrangler r2 bucket info` still reports APAC. Read latency gets measured rather than assumed.
