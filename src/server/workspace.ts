import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { cookies } from "next/headers";

/**
 * An anonymous workspace per browser: a random cookie, so a visitor sees
 * their own uploads without signing up. The database stores only a hash of
 * it, so a leaked table doesn't hand out access.
 */
const COOKIE = "docwise_ws";
const VALID = /^[A-Za-z0-9_-]{22}$/;

const hash = (token: string) => createHash("sha256").update(token).digest("base64url").slice(0, 32);

/** This browser's workspace id, or null if it has never uploaded. */
export async function readWorkspace(): Promise<string | null> {
  const token = (await cookies()).get(COOKIE)?.value;
  return token && VALID.test(token) ? hash(token) : null;
}

/** Creates the cookie on first use (server actions only: pages can't set cookies). */
export async function ensureWorkspace(): Promise<string> {
  const jar = await cookies();
  let token = jar.get(COOKIE)?.value;
  if (!token || !VALID.test(token)) {
    token = randomBytes(16).toString("base64url");
    jar.set(COOKIE, token, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 60 * 60 * 24 * 365,
    });
  }
  return hash(token);
}
