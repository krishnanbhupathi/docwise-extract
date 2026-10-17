import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { InvoiceData } from "@/lib/invoice";
import type { ManifestEntry } from "@/testset/manifest";
import type { Report } from "./report";
import { buildReport } from "./report";
import { pool, replayModel, runDocument, type SavedAttempt } from "./run";
import { scoreDocument } from "./score";

const ROOT = path.join(process.cwd(), "test-set");
const OUT = path.join(process.cwd(), "docs", "measurements");
const manifest: ManifestEntry[] = JSON.parse(readFileSync(path.join(ROOT, "manifest.json"), "utf8"));
const entry = (id: string) => manifest.find((e) => e.id === id)!;
const truth = (id: string): InvoiceData => JSON.parse(readFileSync(path.join(ROOT, "truth", `${id}.json`), "utf8"));

const answer = (data: object): SavedAttempt => ({ text: JSON.stringify(data), model: "claude-opus-5-5", stopReason: "end_turn", inputTokens: 3000, outputTokens: 500, fallbackUsed: false, ms: 8000 });

describe("runDocument", () => {
  it("approves a correct reading of a clean invoice, as the app would", async () => {
    const { outcome, saved } = await runDocument(entry("inv-001"), ROOT, replayModel([answer({ ...truth("inv-001"), uncertain: [] })]), { savedTimes: [8000] });
    expect(outcome.route).toBe("approved");
    expect(saved).toHaveLength(1);
    expect(scoreDocument(outcome, truth("inv-001"))).toMatchObject({ fullyCorrect: true, escaped: false, ms: 8000 });
  });

  it("sends a misread value to review when the PDF's text doesn't contain it", async () => {
    const misread = { ...truth("inv-001"), invoice_number: "INV-0000", uncertain: [] };
    const { outcome } = await runDocument(entry("inv-001"), ROOT, replayModel([answer(misread)]));
    expect(outcome.route).toBe("needs_review");
    expect(outcome.confidence?.invoice_number.reasons).toEqual(["not_in_text"]);
    expect(scoreDocument(outcome, truth("inv-001"))).toMatchObject({ escapedFields: [], escaped: false });
  });

  it("can't vouch on a scan: the same misreading there is an escaped error", async () => {
    const misread = { ...truth("inv-046"), invoice_number: "2026-0000", uncertain: [] };
    const { outcome } = await runDocument(entry("inv-046"), ROOT, replayModel([answer(misread)]));
    expect(outcome.route).toBe("approved");
    expect(scoreDocument(outcome, truth("inv-046"))).toMatchObject({ escapedFields: ["invoice_number"], escaped: true });
  });

  it("records an API error as a failed extraction", async () => {
    const { outcome, saved } = await runDocument(entry("inv-001"), ROOT, replayModel([{ error: "overloaded", ms: 100 }]));
    expect(outcome).toMatchObject({ route: "failed", error: "api_error" });
    expect(saved).toEqual([{ error: "overloaded", ms: expect.any(Number) }]);
  });
});

describe("pool", () => {
  it("keeps every result and stops starting new work when asked", async () => {
    expect(await pool([1, 2, 3, 4, 5], 2, async (n) => n * 2)).toEqual([2, 4, 6, 8, 10]);
    let started = 0;
    const done = await pool([1, 2, 3, 4, 5], 1, async (n) => ++started && n, () => started >= 2);
    expect(done).toEqual([1, 2]);
  });
});

// CI's check against saved model answers: every live report must re-score to exactly
// its recorded metrics, since the README and case study cite them. A change that
// moves them needs new reports.
const reports: Report[] = existsSync(OUT)
  ? readdirSync(OUT)
      .filter((f) => /^eval-\d+-.*\.json$/.test(f))
      .map((f) => JSON.parse(readFileSync(path.join(OUT, f), "utf8")) as Report)
      .filter((r) => r.mode === "live" && r.complete)
  : [];

describe.skipIf(reports.length === 0)("saved runs replay to their reported metrics", () => {
  it.each(reports.map((r) => [r.run, r] as const))("%s", async (run, report) => {
    const scored = await pool(
      report.documents.map((d) => entry(d.id)),
      4,
      async (e) => {
        const saved: SavedAttempt[] = JSON.parse(readFileSync(path.join(OUT, "responses", run, `${e.id}.json`), "utf8"));
        const { outcome } = await runDocument(e, ROOT, replayModel(saved), { savedTimes: saved.map((s) => s.ms) });
        return { score: scoreDocument(outcome, truth(e.id)), outcome };
      },
    );
    expect(buildReport(report, scored.sort((a, b) => a.score.id.localeCompare(b.score.id))).metrics).toEqual(report.metrics);
  });
});
