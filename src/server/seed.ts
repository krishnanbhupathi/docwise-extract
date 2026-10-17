import { readFile } from "node:fs/promises";
import path from "node:path";
import { eq } from "drizzle-orm";
import { documents } from "@/db/schema";
import type { Database } from "@/db/types";
import { replayModel, type SavedAttempt } from "@/eval/run";
import { extractInvoice } from "@/extraction/extract";
import type { CallModel, MediaType } from "@/extraction/model";
import { pdfPageCount, pdfText, prepareForModel } from "@/extraction/prepare";
import { SAMPLE_RUN, SAMPLES, sampleId } from "@/lib/samples";
import type { ManifestEntry } from "@/testset/manifest";
import { saveExtraction } from "./documents";
import type { FileStorage } from "./storage";

/**
 * Loads the demo's samples: each test-set file goes to storage and through
 * the app's own extraction steps, answered by the model's saved answer from
 * SAMPLE_RUN instead of a live call. Existing samples are kept unless
 * `replace` is set; visitors' copies are separate documents and stay.
 */
export async function seedSamples(
  db: Database,
  storage: FileStorage,
  { testSet, responses, replace = false }: { testSet: string; responses: string; replace?: boolean },
): Promise<{ added: string[]; kept: string[] }> {
  const manifest: ManifestEntry[] = JSON.parse(await readFile(path.join(testSet, "manifest.json"), "utf8"));
  const added: string[] = [];
  const kept: string[] = [];

  for (const sample of SAMPLES) {
    const id = sampleId(sample);
    const entry = manifest.find((e) => e.id === sample.invoice);
    if (!entry) throw new Error(`${sample.invoice} isn't in the test set`);
    if (entry.split !== "tuning") throw new Error(`${sample.invoice} is held out; samples come from the tuning split only`);

    const [existing] = await db.select({ id: documents.id }).from(documents).where(eq(documents.id, id));
    if (existing && !replace) {
      kept.push(id);
      continue;
    }
    if (existing) await db.delete(documents).where(eq(documents.id, id));

    const data = new Uint8Array(await readFile(path.join(testSet, entry.file)));
    const mediaType = entry.mediaType as MediaType;
    const fileName = path.basename(entry.file);
    const fileKey = `samples/${entry.id}/${fileName}`;
    await storage.put(fileKey, data, mediaType);
    await db.insert(documents).values({
      id,
      workspaceId: null,
      source: "demo",
      fileKey,
      fileName,
      mediaType,
      sizeBytes: data.byteLength,
      pages: mediaType === "application/pdf" ? await pdfPageCount(data) : 1,
      status: "extracting",
      runs: 1,
    });

    const saved: SavedAttempt[] = JSON.parse(await readFile(path.join(responses, `${entry.id}.json`), "utf8"));
    const replay = replayModel(saved);
    // The log records where the answer came from in place of the raw API response.
    const callModel: CallModel = async (request) => ({ ...(await replay(request)), raw: { savedAnswerFrom: SAMPLE_RUN } });
    const [file, text] = await Promise.all([prepareForModel(data, mediaType), pdfText(data, mediaType)]);
    const result = await extractInvoice(file, callModel);
    result.attempts.forEach((attempt, i) => (attempt.ms = saved[i]?.ms ?? attempt.ms));
    await saveExtraction(db, id, result, { text });
    added.push(id);
  }
  return { added, kept };
}
