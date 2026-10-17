import { db } from "@/db";
import { errorResponse, invoiceJson } from "@/server/api";
import { getDocument } from "@/server/documents";
import { withApiKey } from "../../auth";

/** GET /api/v1/invoices/:id — one of this key's invoices, or a sample. */
export function GET(request: Request, { params }: RouteContext<"/api/v1/invoices/[id]">) {
  return withApiKey(request, async ({ workspaceId }, origin) => {
    const view = await getDocument(db, (await params).id, workspaceId);
    if (!view || view.doc.status === "uploading") return errorResponse({ status: 404, code: "not_found", message: "No invoice with that id for this key." });
    return Response.json(invoiceJson(view, origin));
  });
}
