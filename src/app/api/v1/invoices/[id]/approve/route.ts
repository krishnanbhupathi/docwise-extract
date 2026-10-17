import { db } from "@/db";
import { approveBody, approveInvoice, errorResponse, invoiceJson } from "@/server/api";
import { withApiKey } from "../../../auth";

/**
 * POST /api/v1/invoices/:id/approve — approves an invoice waiting for review.
 * Body (optional): { "invoice": { "total": "1500.00", … }, "accept_failing_checks": true }.
 * Fields left out keep their current value; changed ones are stored as corrections.
 */
export function POST(request: Request, { params }: RouteContext<"/api/v1/invoices/[id]/approve">) {
  return withApiKey(request, async ({ workspaceId }, origin) => {
    const text = await request.text();
    let json: unknown = {};
    try {
      json = text.trim() ? JSON.parse(text) : {};
    } catch {
      return errorResponse({ status: 400, code: "invalid_json", message: "The body isn't valid JSON." });
    }
    const body = approveBody.safeParse(json);
    if (!body.success) {
      return errorResponse({ status: 400, code: "invalid_body", message: "Expected { invoice?: { field: value, … }, accept_failing_checks?: boolean }.", details: body.error.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`) });
    }
    const result = await approveInvoice(db, { workspaceId, id: (await params).id, body: body.data });
    return result.ok ? Response.json(invoiceJson(result.view, origin)) : errorResponse(result.error);
  });
}
