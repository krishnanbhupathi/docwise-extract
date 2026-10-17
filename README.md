# Docwise

AI extraction of supplier invoices that you can check. Upload a PDF or a photo; Docwise returns the supplier, dates, amounts and line items, checks every value with business rules, and sends anything it isn't sure of to a person instead of straight into the books.

The app is the demo; the evaluation is the proof. A generated, labelled test set and `npm run eval` will report per-field accuracy, line-item F1, review rate and **escaped errors** (wrong values marked high confidence), with every number linked to a report in [`docs/measurements`](docs/measurements).

> **Status: in progress (Day 1 of 5).** Upload, extraction, validation, rule checks and the first 20 test invoices work. Confidence, the review queue, the eval and the public demo come next. See [PROGRESS.md](PROGRESS.md).

## How one invoice is processed

1. **Upload:** the browser sends the file straight to a private Cloudflare R2 bucket through a signed URL. The server then checks the stored file (type, size, page count) and queues it.
2. **Extract:** Claude reads the PDF or image and answers in a strict JSON schema (structured outputs). The raw response, tokens and time of every call are logged.
3. **Validate:** the answer is parsed with Zod. A malformed answer goes back to the model once with the exact errors; a second failure is reported, never stored. **The model never writes to the database:** only validated values reach it.
4. **Check:** rules flag values that can't be right: impossible dates, a due date before the invoice date, a non-ISO currency, an amount the currency can't express, quantity × unit price ≠ amount, line items that don't add up to the subtotal, subtotal + tax ≠ total.

## Test set

`npm run generate:invoices` renders synthetic invoices from five layouts (US, EU, UK, Indian GST and an international studio layout across AUD, CAD, JPY, CHF and SGD), with the local number and date conventions (`1.234,56 €`, `₹1,23,456.00`, `CHF 1’234.50`, `04/21/2026` vs `21/04/2026`). Every company and address is invented. Each invoice's true values are saved as JSON next to the PDF, and the split is fixed: every third invoice is held out and only scored for the final report.

## Run it locally

Needs Node 20.9+ and Postgres.

```bash
npm install && cp .env.example .env.local   # then set DATABASE_URL, and DOCWISE_FAKE_MODEL=1 + STORAGE_DRIVER=local to run without keys
npm run db:migrate
npm run dev
```

```bash
npm test             # unit and database tests (PGlite, in-process Postgres; the model is faked)
npm run typecheck
npm run lint
```

## Stack

Next.js 16 (App Router, server actions) · TypeScript · Postgres (Neon) with Drizzle · Claude Opus 5.5 via the Anthropic API (structured outputs, PDF and image input) · Zod · Cloudflare R2 · Tailwind CSS · Vitest + PGlite · Playwright · Vercel.

## License

MIT
