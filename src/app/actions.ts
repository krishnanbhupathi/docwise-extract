"use server";

import { after } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { confirmUpload, processDocument, startUpload } from "@/server/documents";
import { getModel } from "@/server/model";
import { getStorage } from "@/server/storage";
import { ensureWorkspace, readWorkspace } from "@/server/workspace";

// Server actions are public endpoints: validate their input like any request body.
const uploadInput = z.object({
  fileName: z.string().max(500),
  mediaType: z.string().max(100),
  sizeBytes: z.number().int(),
});

export async function requestUpload(input: z.input<typeof uploadInput>) {
  const parsed = uploadInput.safeParse(input);
  if (!parsed.success) return { ok: false as const, error: "Invalid upload request." };
  const workspaceId = await ensureWorkspace();
  return startUpload(db, getStorage(), { workspaceId, ...parsed.data });
}

export async function finishUpload(id: string) {
  const workspaceId = await readWorkspace();
  if (!workspaceId || typeof id !== "string") return { ok: false as const, error: "That upload wasn't found." };
  const storage = getStorage();
  const result = await confirmUpload(db, storage, { workspaceId, id });
  // Extraction runs after the response, so the browser can move to the document page and watch it.
  if (result.ok && result.queued) after(() => processDocument(db, storage, getModel(), id));
  return result;
}
