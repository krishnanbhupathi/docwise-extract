import { after } from "next/server";
import { db } from "@/db";
import { errorResponse, invoiceJson, listInvoices, listQuery } from "@/server/api";
import { getDocument, processDocument, receiveUpload } from "@/server/documents";
import { clientIp, hit, ipSubject, RATE_LIMITS } from "@/server/limits";
import { getModel } from "@/server/model";
import { getStorage } from "@/server/storage";
import { withApiKey } from "../auth";

// Extraction runs in after(), within this function's time limit.
export const maxDuration = 300;

/** GET /api/v1/invoices?status=needs_review&limit=20 — this key's invoices, newest first. */
export function GET(request: Request) {
  return withApiKey(request, async ({ workspaceId }, origin) => {
    const query = listQuery.safeParse(Object.fromEntries(new URL(request.url).searchParams));
    if (!query.success) return errorResponse({ status: 400, code: "invalid_query", message: "status is one of queued, extracting, needs_review, approved, failed; limit is 1 to 100." });
    return Response.json({ invoices: await listInvoices(db, workspaceId, query.data, origin) });
  });
}

/** POST /api/v1/invoices (multipart, field `file`) — queues an invoice for extraction and answers 202. */
export function POST(request: Request) {
  return withApiKey(request, async ({ workspaceId }, origin) => {
    const form = await request.formData().catch(() => null);
    const file = form?.get("file");
    if (!(file instanceof File)) return errorResponse({ status: 400, code: "missing_file", message: "Send the invoice as multipart/form-data in a field named `file`." });

    const limited = await hit(db, RATE_LIMITS.uploadsPerIp, ipSubject(clientIp(request.headers)));
    if (!limited.ok) {
      return errorResponse(
        { status: 429, code: "rate_limited", message: `Uploads are limited to ${RATE_LIMITS.uploadsPerIp.max} an hour per network.` },
        { "retry-after": String(limited.retryAfterSeconds) },
      );
    }

    const storage = getStorage();
    const received = await receiveUpload(db, storage, { workspaceId, fileName: file.name, data: new Uint8Array(await file.arrayBuffer()) });
    if (!received.ok) return errorResponse({ status: received.status, code: received.code, message: received.error });
    after(() => processDocument(db, storage, getModel(), received.id));
    const view = (await getDocument(db, received.id, workspaceId))!;
    return Response.json(invoiceJson(view, origin), { status: 202, headers: { location: `${origin}/api/v1/invoices/${received.id}` } });
  });
}
