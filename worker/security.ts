import { scrypt, timingSafeEqual } from "node:crypto";
import { Buffer } from "node:buffer";
import type { Env } from "./env";
import { localDevelopment } from "./env";
export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public code = "request_error",
  ) {
    super(message);
  }
}
export function randomToken() {
  return Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString(
    "base64url",
  );
}
export async function digest(value: string) {
  return Buffer.from(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
  ).toString("hex");
}
export function constantEqual(a: string, b: string) {
  const x = Buffer.from(a),
    y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
const SCRYPT = { N: 16384, r: 8, p: 5, maxmem: 32 * 1024 * 1024 };
function derive(password: string, salt: string): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    scrypt(password, salt, 64, SCRYPT, (e, key) =>
      e ? reject(e) : resolve(key),
    ),
  );
}
export async function hashPassword(password: string) {
  const salt = randomToken();
  const result = await derive(password, salt);
  return `scrypt$16384$8$5$${salt}$${result.toString("base64url")}`;
}
export async function verifyPassword(password: string, stored: string) {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts.slice(0, 4).join("$") !== "scrypt$16384$8$5")
    return false;
  return constantEqual(
    (await derive(password, parts[4])).toString("base64url"),
    parts[5],
  );
}
export function validatePassword(p: unknown): string {
  if (typeof p !== "string" || p.length < 12 || p.length > 128)
    throw new HttpError(400, "Use a password with 12–128 characters.");
  return p;
}
export function stringField(value: unknown, max: number, label: string) {
  if (typeof value !== "string" || !value.trim() || [...value].length > max)
    throw new HttpError(
      400,
      `Enter a valid ${label} (up to ${max} characters).`,
    );
  return value.trim();
}
export function validateOrigin(request: Request) {
  const origin = request.headers.get("Origin");
  if (
    origin !== new URL(request.url).origin ||
    request.headers.get("Sec-Fetch-Site") === "cross-site"
  )
    throw new HttpError(
      403,
      "This request could not be verified. Reload and try again.",
      "csrf",
    );
  if (!request.headers.get("Content-Type")?.startsWith("application/json"))
    throw new HttpError(415, "Expected a JSON request.");
}
export async function readJson(
  request: Request,
  maxBytes = 48_000,
): Promise<Record<string, unknown>> {
  if (Number(request.headers.get("Content-Length")) > maxBytes)
    throw new HttpError(413, "This request is too large.");
  const reader = request.body?.getReader();
  if (!reader) throw new HttpError(400, "A request body is required.");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > maxBytes) {
        await reader.cancel();
        throw new HttpError(413, "This request is too large.");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const data = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    data.set(chunk, offset);
    offset += chunk.length;
  }
  try {
    const parsed = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(data),
    );
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
      throw new Error();
    return parsed;
  } catch {
    throw new HttpError(400, "Invalid JSON request.");
  }
}
export async function ipHash(request: Request, env: Env) {
  const secret =
    env.ABUSE_SECRET ||
    (localDevelopment(request, env) ? "local-development-only-secret" : "");
  if (secret.length < 24)
    throw new HttpError(
      503,
      "Account services are awaiting secure server configuration.",
      "setup_required",
    );
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const value = `${new Date().toISOString().slice(0, 10)}:${request.headers.get("CF-Connecting-IP") || "unknown"}`;
  return Buffer.from(
    await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value)),
  ).toString("hex");
}
export async function rateLimit(
  env: Env,
  key: string,
  limit: number,
  seconds: number,
) {
  const now = Date.now();
  const row = await env.DB.prepare(
    `INSERT INTO throttle(key,hits,expires_at) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET hits=CASE WHEN throttle.expires_at<=? THEN 1 ELSE throttle.hits+1 END, expires_at=CASE WHEN throttle.expires_at<=? THEN excluded.expires_at ELSE throttle.expires_at END WHERE throttle.expires_at<=? OR throttle.hits<? RETURNING hits`,
  )
    .bind(key, now + seconds * 1000, now, now, now, limit)
    .first();
  if (!row)
    throw new HttpError(
      429,
      "Too many requests. Please wait a moment and try again.",
      "throttled",
    );
}
export async function verifyChallenge(
  request: Request,
  env: Env,
  token: unknown,
  action: string,
) {
  if (localDevelopment(request, env)) return;
  if (!env.TURNSTILE_SECRET_KEY || !env.TURNSTILE_SITE_KEY)
    throw new HttpError(
      503,
      "Account sign-in is awaiting anti-abuse configuration.",
      "setup_required",
    );
  if (typeof token !== "string" || token.length > 2048 || !token)
    throw new HttpError(400, "Complete the security check.");
  const response = await fetch(
    "https://challenges.cloudflare.com/turnstile/v0/siteverify",
    {
      method: "POST",
      body: JSON.stringify({
        secret: env.TURNSTILE_SECRET_KEY,
        response: token,
        remoteip: request.headers.get("CF-Connecting-IP") || undefined,
      }),
      headers: { "Content-Type": "application/json" },
      signal: AbortSignal.timeout(10_000),
    },
  );
  const result = (await response.json()) as {
    success: boolean;
    hostname?: string;
    action?: string;
  };
  if (
    !response.ok ||
    !result.success ||
    result.hostname !== new URL(request.url).hostname ||
    result.action !== action
  )
    throw new HttpError(400, "The security check expired. Please try again.");
}
export function responseHeaders(
  response: Response,
  request: Request,
  env: Env,
) {
  const headers = new Headers(response.headers);
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  headers.set(
    "Permissions-Policy",
    "camera=(), geolocation=(), microphone=(self)",
  );
  headers.set("X-Frame-Options", "SAMEORIGIN");
  if (new URL(request.url).protocol === "https:")
    headers.set("Strict-Transport-Security", "max-age=31536000");
  if (!localDevelopment(request, env))
    headers.set(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self' https://challenges.cloudflare.com; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; frame-src https://challenges.cloudflare.com; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'self'; upgrade-insecure-requests",
    );
  if (new URL(request.url).pathname.startsWith("/api/"))
    headers.set("Cache-Control", "no-store");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
