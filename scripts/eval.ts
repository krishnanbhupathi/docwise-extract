/**
 * Scores the extraction pipeline on the test set and writes a report to
 * docs/measurements/ (JSON + markdown), with the model's raw answers in
 * docs/measurements/responses/<run>/ so the run can be replayed for free.
 *
 *   npm run eval                                   # tuning split, current prompt and model
 *   npm run eval -- --model claude-sonnet-5-5 --prompt v2 --max-usd 3
 *   npm run eval -- --only inv-001,inv-046         # a few invoices (still a numbered run)
 *   npm run eval -- --replay eval-01-v1-opus-5-5-tuning   # re-score saved answers, no API calls
 *   npm run eval -- --split held_out --final       # the held-out split, once, for the final report
 *
 * Needs ANTHROPIC_API_KEY for live runs.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { anthropicModel } from "../src/extraction/model";
import { EFFORT, MODEL, PROMPTS, PROMPT_VERSION } from "../src/extraction/prompt";
import type { InvoiceData } from "../src/lib/invoice";
import { buildReport, reportMarkdown, type Report } from "../src/eval/report";
import { pool, replayModel, runDocument, type SavedAttempt } from "../src/eval/run";
import { scoreDocument } from "../src/eval/score";
import type { ManifestEntry } from "../src/testset/manifest";

const ROOT = path.join(process.cwd(), "test-set");
const OUT = path.join(process.cwd(), "docs", "measurements");

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(`--${name}`);
const option = (name: string, fallback?: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

const readReport = (run: string): Report => JSON.parse(readFileSync(path.join(OUT, `${run}.json`), "utf8"));
const truthOf = (entry: ManifestEntry): InvoiceData => JSON.parse(readFileSync(path.join(ROOT, entry.truth), "utf8"));

/** Live reports in this folder, by run number. */
function liveReports(): Report[] {
  if (!existsSync(OUT)) return [];
  return readdirSync(OUT)
    .filter((f) => /^eval-\d+-.*\.json$/.test(f))
    .map((f) => JSON.parse(readFileSync(path.join(OUT, f), "utf8")) as Report)
    .filter((r) => r.mode === "live")
    .sort((a, b) => a.run.localeCompare(b.run));
}

async function main() {
  const manifest: ManifestEntry[] = JSON.parse(readFileSync(path.join(ROOT, "manifest.json"), "utf8"));
  const replay = option("replay");

  if (replay) {
    const original = readReport(replay);
    const ids = new Set(original.documents.map((d) => d.id));
    const entries = manifest.filter((e) => ids.has(e.id));
    const scored = await pool(entries, 4, async (entry) => {
      const saved: SavedAttempt[] = JSON.parse(readFileSync(path.join(OUT, "responses", replay, `${entry.id}.json`), "utf8"));
      const { outcome } = await runDocument(entry, ROOT, replayModel(saved), { savedTimes: saved.map((s) => s.ms) });
      return { score: scoreDocument(outcome, truthOf(entry)), outcome };
    });
    const report = buildReport({ ...original, mode: "replay", replayOf: replay, ranAt: new Date().toISOString() }, scored);
    console.log(reportMarkdown(report, original));
    const same = JSON.stringify(report.metrics) === JSON.stringify(original.metrics);
    console.log(same ? "Replay reproduces the saved report's metrics exactly." : "Replay DIFFERS from the saved report (the code has changed how these answers score).");
    process.exit(same ? 0 : 2);
  }

  const split = option("split", "tuning")!;
  if (split !== "tuning" && split !== "held_out") fail(`Unknown split ${split}`);
  // The held-out invoices are scored once, for the final report; nothing is tuned on them.
  if (split === "held_out" && !flag("final")) fail("The held-out split is only scored for the final report: add --final if that's what this run is.");
  const model = option("model", MODEL)!;
  const promptVersion = option("prompt", PROMPT_VERSION)!;
  if (!PROMPTS[promptVersion]) fail(`Unknown prompt version ${promptVersion} (have ${Object.keys(PROMPTS).join(", ")})`);
  const maxUsd = Number(option("max-usd", "3"));
  const concurrency = Number(option("concurrency", "4"));
  const only = option("only")?.split(",");
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) fail("ANTHROPIC_API_KEY is not set.");

  const entries = manifest.filter((e) => e.split === split && (!only || only.includes(e.id)));
  if (!entries.length) fail("No invoices to run.");
  const number = Math.max(0, ...(existsSync(OUT) ? readdirSync(OUT) : []).map((f) => Number(/^eval-(\d+)-/.exec(f)?.[1] ?? 0))) + 1;
  const run = `eval-${String(number).padStart(2, "0")}-${promptVersion}-${model.replace(/^claude-/, "")}-${split}`;
  const responses = path.join(OUT, "responses", run);
  mkdirSync(responses, { recursive: true });
  console.log(`${run}: ${entries.length} invoices, up to ${concurrency} at a time, stops at $${maxUsd.toFixed(2)}`);

  const callModel = anthropicModel(key!, model, promptVersion);
  let spent = 0;
  const scored = await pool(
    entries,
    concurrency,
    async (entry) => {
      const { outcome, saved } = await runDocument(entry, ROOT, callModel);
      writeFileSync(path.join(responses, `${entry.id}.json`), JSON.stringify(saved, null, 2) + "\n");
      const score = scoreDocument(outcome, truthOf(entry));
      spent += score.costUsd;
      const mark = score.escaped ? "ESCAPED" : score.fullyCorrect ? "correct" : "wrong";
      console.log(`${entry.id}  ${entry.kind.padEnd(11)} ${outcome.route.padEnd(12)} ${mark.padEnd(8)} $${score.costUsd.toFixed(4)}  ${(score.ms / 1000).toFixed(1)} s  (spent $${spent.toFixed(2)})`);
      return { score, outcome };
    },
    () => spent >= maxUsd,
  );

  // Compared with the latest earlier run on the same split, preferring the same model.
  const earlier = liveReports().filter((r) => r.split === split);
  const previous = earlier.filter((r) => r.model === model).at(-1) ?? earlier.at(-1);
  const report = buildReport(
    { run, mode: "live", ranAt: new Date().toISOString(), promptVersion, model, effort: EFFORT, split, complete: scored.length === entries.length },
    scored.sort((a, b) => a.score.id.localeCompare(b.score.id)),
  );
  writeFileSync(path.join(OUT, `${run}.json`), JSON.stringify(report, null, 2) + "\n");
  const markdown = reportMarkdown(report, previous);
  writeFileSync(path.join(OUT, `${run}.md`), markdown);
  console.log(`\n${markdown}\nWrote docs/measurements/${run}.json and .md`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
