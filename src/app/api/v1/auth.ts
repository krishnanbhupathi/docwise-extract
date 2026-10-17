import { db } from "@/db";
import { authenticate, type ApiCaller } from "@/server/api-keys";
import { errorResponse } from "@/server/api";
import { hit, RATE_LIMITS } from "@/server/limits";

/** Runs `handler` for a valid API key within its rate limit; otherwise answers 401 or 429. */
export async function withApiKey(request: Request, handler: (caller: ApiCaller, origin: string) => Promise<Response>): Promise<Response> {
  const caller = await authenticate(db, request.headers.get("authorization"));
  if (!caller) {
    return errorResponse(
      { status: 401, code: "unauthorized", message: "Send an API key as `Authorization: Bearer dw_…`. Create one at /developers." },
      { "www-authenticate": "Bearer" },
    );
  }
  const limited = await hit(db, RATE_LIMITS.requestsPerKey, caller.keyId);
  if (!limited.ok) {
    const { max } = RATE_LIMITS.requestsPerKey;
    return errorResponse({ status: 429, code: "rate_limited", message: `This key is limited to ${max} requests a minute.` }, { "retry-after": String(limited.retryAfterSeconds) });
  }
  return handler(caller, new URL(request.url).origin);
}
