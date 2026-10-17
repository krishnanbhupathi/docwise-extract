import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

/**
 * Where invoice files live. Production: a private Cloudflare R2 bucket, reached
 * only through short-lived signed URLs. Development and e2e: local disk behind
 * the same signed-URL flow (STORAGE_DRIVER=local), so no cloud credentials are
 * needed to run the app.
 */
export interface FileStorage {
  /** A URL the browser PUTs the file to; only that type and size are accepted. */
  createUploadUrl(key: string, file: { contentType: string; contentLength: number }): Promise<string>;
  createDownloadUrl(key: string): Promise<string>;
  /** Stores a file the server already holds (an API upload, a seeded sample). */
  put(key: string, data: Uint8Array, contentType: string): Promise<void>;
  head(key: string): Promise<{ size: number } | null>;
  get(key: string): Promise<Uint8Array>;
  delete(key: string): Promise<void>;
}

const URL_TTL_SECONDS = 600;

export function r2Storage(env: { accountId: string; accessKeyId: string; secretAccessKey: string; bucket: string }): FileStorage {
  const client = new S3Client({
    region: "auto",
    endpoint: `https://${env.accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: env.accessKeyId, secretAccessKey: env.secretAccessKey },
  });
  const Bucket = env.bucket;
  return {
    createUploadUrl: (key, file) =>
      getSignedUrl(client, new PutObjectCommand({ Bucket, Key: key, ContentType: file.contentType, ContentLength: file.contentLength }), {
        expiresIn: URL_TTL_SECONDS,
        // Signed, so a different type or size is rejected by R2 itself.
        signableHeaders: new Set(["content-type", "content-length"]),
      }),
    createDownloadUrl: (key) => getSignedUrl(client, new GetObjectCommand({ Bucket, Key: key }), { expiresIn: URL_TTL_SECONDS }),
    async put(key, data, contentType) {
      await client.send(new PutObjectCommand({ Bucket, Key: key, Body: data, ContentType: contentType }));
    },
    async head(key) {
      try {
        const object = await client.send(new HeadObjectCommand({ Bucket, Key: key }));
        return { size: object.ContentLength ?? 0 };
      } catch (error) {
        if ((error as { name?: string }).name === "NotFound") return null;
        throw error;
      }
    },
    async get(key) {
      const object = await client.send(new GetObjectCommand({ Bucket, Key: key }));
      return object.Body!.transformToByteArray();
    },
    async delete(key) {
      await client.send(new DeleteObjectCommand({ Bucket, Key: key }));
    },
  };
}

/** Local disk under `root`, with HMAC-signed URLs served by /api/local-storage. */
export function diskStorage(root: string, secret: string): FileStorage {
  const file = (key: string) => {
    const full = path.resolve(root, key);
    if (!full.startsWith(path.resolve(root) + path.sep)) throw new Error("Invalid storage key");
    return full;
  };
  const signed = (method: string, key: string, extra: Record<string, string> = {}) => {
    const params = new URLSearchParams({ ...extra, expires: String(Math.floor(Date.now() / 1000) + URL_TTL_SECONDS) });
    params.set("sig", signLocal(secret, method, key, params));
    return `/api/local-storage/${key}?${params}`;
  };
  return {
    createUploadUrl: async (key, f) => signed("PUT", key, { type: f.contentType, length: String(f.contentLength) }),
    createDownloadUrl: async (key) => signed("GET", key),
    put: (key, data) => writeLocalFile(root, key, data),
    async head(key) {
      try {
        return { size: (await stat(file(key))).size };
      } catch {
        return null;
      }
    },
    get: async (key) => new Uint8Array(await readFile(file(key))),
    async delete(key) {
      await rm(file(key), { force: true });
    },
  };
}

/** Writes a file for the local PUT route (after its signature was checked). */
export async function writeLocalFile(root: string, key: string, data: Uint8Array) {
  const full = path.resolve(root, key);
  if (!full.startsWith(path.resolve(root) + path.sep)) throw new Error("Invalid storage key");
  await mkdir(path.dirname(full), { recursive: true });
  await writeFile(full, data);
}

export function signLocal(secret: string, method: string, key: string, params: URLSearchParams): string {
  const canonical = [method, key, params.get("type") ?? "", params.get("length") ?? "", params.get("expires") ?? ""].join("\n");
  return createHmac("sha256", secret).update(canonical).digest("base64url");
}

export function verifyLocal(secret: string, method: string, key: string, params: URLSearchParams): boolean {
  const sig = params.get("sig") ?? "";
  const expected = signLocal(secret, method, key, params);
  if (Number(params.get("expires")) < Date.now() / 1000) return false;
  return sig.length === expected.length && timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
}

export const LOCAL_STORAGE_ROOT = path.join(process.cwd(), ".data", "storage");
/** Local-only secret; the local driver refuses to run in production. */
export const LOCAL_STORAGE_SECRET = process.env.LOCAL_STORAGE_SECRET || "docwise-local-dev";

let storage: FileStorage | undefined;

export function getStorage(): FileStorage {
  if (storage) return storage;
  if (process.env.STORAGE_DRIVER === "local") {
    if (process.env.VERCEL_ENV === "production") throw new Error("STORAGE_DRIVER=local is not allowed in production");
    return (storage = diskStorage(LOCAL_STORAGE_ROOT, LOCAL_STORAGE_SECRET));
  }
  const { R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET } = process.env;
  if (!R2_ACCOUNT_ID || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY || !R2_BUCKET) {
    throw new Error("R2 storage is not configured (R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET), and STORAGE_DRIVER=local is not set");
  }
  return (storage = r2Storage({ accountId: R2_ACCOUNT_ID, accessKeyId: R2_ACCESS_KEY_ID, secretAccessKey: R2_SECRET_ACCESS_KEY, bucket: R2_BUCKET }));
}
