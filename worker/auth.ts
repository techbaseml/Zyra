import type { Env } from "./env";
import { localDevelopment } from "./env";
import { defaultSettings, type Settings, type User } from "../shared/types";
import { HttpError, constantEqual, digest, randomToken } from "./security";
export type UserRow = {
  id: string;
  email: string;
  name: string;
  password_hash: string;
  settings: string;
  created_at: number;
  consent_at: number;
};
export function publicUser(row: UserRow): User {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    created_at: row.created_at,
    settings: parseSettings(row.settings),
  };
}
export function parseSettings(value: string): Settings {
  try {
    return validateSettings(JSON.parse(value));
  } catch {
    return { ...defaultSettings };
  }
}
export function validateSettings(input: unknown): Settings {
  if (!input || typeof input !== "object")
    throw new HttpError(400, "Invalid settings.");
  const s = input as Record<string, unknown>;
  if (
    !["dark", "light", "system"].includes(String(s.theme)) ||
    !["auto", "en", "ml"].includes(String(s.language)) ||
    !["concise", "balanced", "detailed"].includes(String(s.responseLength)) ||
    typeof s.reducedMotion !== "boolean" ||
    typeof s.allowFallback !== "boolean"
  )
    throw new HttpError(400, "Invalid settings.");
  return {
    theme: s.theme,
    language: s.language,
    responseLength: s.responseLength,
    reducedMotion: s.reducedMotion,
    allowFallback: s.allowFallback,
  } as Settings;
}
function cookieName(request: Request, env: Env) {
  return localDevelopment(request, env)
    ? "zyra_local_session"
    : "__Host-zyra_session";
}
export function sessionCookie(
  request: Request,
  env: Env,
  value: string,
  clear = false,
) {
  return `${cookieName(request, env)}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${clear ? 0 : 604800}${localDevelopment(request, env) ? "" : "; Secure"}`;
}
export async function createSession(
  env: Env,
  userId: string,
  expectedPasswordHash: string,
) {
  const token = randomToken(),
    csrf = randomToken();
  const inserted = await env.DB.prepare(
    "INSERT INTO sessions(token_hash,user_id,csrf,expires_at) SELECT ?,?,?,? WHERE EXISTS(SELECT 1 FROM users WHERE id=? AND password_hash=?) RETURNING token_hash",
  )
    .bind(
      await digest(token),
      userId,
      csrf,
      Date.now() + 604800_000,
      userId,
      expectedPasswordHash,
    )
    .first();
  if (!inserted)
    throw new HttpError(401, "Your credentials changed. Please sign in again.");
  return { token, csrf };
}
export async function getSession(request: Request, env: Env, required = true) {
  const name = cookieName(request, env);
  const token = (request.headers.get("Cookie") || "")
    .split(";")
    .map((c) => c.trim())
    .find((c) => c.startsWith(name + "="))
    ?.slice(name.length + 1);
  if (!token || token.length !== 43) {
    if (required)
      throw new HttpError(401, "Sign in to continue.", "unauthorized");
    return null;
  }
  const tokenHash = await digest(token);
  const row = await env.DB.prepare(
    "SELECT users.*, sessions.csrf FROM sessions JOIN users ON users.id=sessions.user_id WHERE token_hash=? AND expires_at>?",
  )
    .bind(tokenHash, Date.now())
    .first<UserRow & { csrf: string }>();
  if (!row) {
    if (required)
      throw new HttpError(
        401,
        "Your session expired. Please sign in again.",
        "unauthorized",
      );
    return null;
  }
  return { row, tokenHash, csrf: row.csrf, user: publicUser(row) };
}
export function verifyCsrf(request: Request, csrf: string) {
  if (!constantEqual(request.headers.get("X-CSRF-Token") || "", csrf))
    throw new HttpError(
      403,
      "Your session changed. Reload the page and try again.",
      "csrf",
    );
}
