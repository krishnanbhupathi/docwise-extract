import { readFile } from "node:fs/promises";
import path from "node:path";
import { LOCAL_STORAGE_ROOT, LOCAL_STORAGE_SECRET, verifyLocal, writeLocalFile } from "@/server/storage";

/**
 * Stand-in for R2's signed URLs when STORAGE_DRIVER=local (development and
 * e2e). Answers 404 otherwise, so production never serves local files.
 */
const enabled = () => process.env.STORAGE_DRIVER === "local" && process.env.VERCEL_ENV !== "production";

type Context = { params: Promise<{ key: string[] }> };

export async function PUT(request: Request, { params }: Context) {
  if (!enabled()) return new Response(null, { status: 404 });
  const key = (await params).key.join("/");
  const search = new URL(request.url).searchParams;
  if (!verifyLocal(LOCAL_STORAGE_SECRET, "PUT", key, search)) return new Response("Invalid or expired signature", { status: 403 });
  if (request.headers.get("content-type") !== search.get("type")) return new Response("Content type doesn't match", { status: 403 });
  const data = new Uint8Array(await request.arrayBuffer());
  if (String(data.byteLength) !== search.get("length")) return new Response("Size doesn't match", { status: 403 });
  await writeLocalFile(LOCAL_STORAGE_ROOT, key, data);
  return new Response(null, { status: 200 });
}

export async function GET(request: Request, { params }: Context) {
  if (!enabled()) return new Response(null, { status: 404 });
  const key = (await params).key.join("/");
  if (!verifyLocal(LOCAL_STORAGE_SECRET, "GET", key, new URL(request.url).searchParams)) return new Response("Invalid or expired signature", { status: 403 });
  try {
    const data = await readFile(path.resolve(LOCAL_STORAGE_ROOT, key));
    const type = key.endsWith(".pdf") ? "application/pdf" : key.endsWith(".png") ? "image/png" : key.endsWith(".webp") ? "image/webp" : "image/jpeg";
    return new Response(data, { headers: { "content-type": type, "cache-control": "private, no-store" } });
  } catch {
    return new Response(null, { status: 404 });
  }
}
