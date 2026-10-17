import "server-only";
import { fakeModel } from "@/extraction/fake";
import { anthropicModel, type CallModel } from "@/extraction/model";

/** The model the app uses: Claude, or the fake one when DOCWISE_FAKE_MODEL=1 (never in production). */
export function getModel(): CallModel {
  if (process.env.DOCWISE_FAKE_MODEL === "1") {
    if (process.env.VERCEL_ENV === "production") throw new Error("DOCWISE_FAKE_MODEL is not allowed in production");
    return fakeModel;
  }
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error("ANTHROPIC_API_KEY is not set (or set DOCWISE_FAKE_MODEL=1 for local development)");
  return anthropicModel(key);
}
