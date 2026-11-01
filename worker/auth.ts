import type { Env } from "./env";
import { localDevelopment } from "./env";
import { defaultSettings, type Settings, type User } from "../shared/types";
import { HttpError, constantEqual, digest, randomToken } from "./security";
import {
  usesSupabase,
  tokensFrom,
  refreshTokens,
  sealTokens,
  openTokens,
  getAuthUser,
  subject,
  type AuthTokens,
} from "./supabase";
export type UserRow = {
  id: string;
  email: string;
  name: string;
  password_hash: string;
  settings: string;
  created_at: number;
  consent_at: number;
  auth_subject?: string | null;
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
  provider?: AuthTokens,
) {
  const token = randomToken(),
    csrf = randomToken();
  const tokenHash = await digest(token);
  const inserted = await env.DB.prepare(
    "INSERT INTO sessions(token_hash,user_id,csrf,expires_at,provider_tokens,provider_expires_at) SELECT ?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM users WHERE id=? AND password_hash=? AND NOT EXISTS(SELECT 1 FROM auth_deletions WHERE auth_deletions.user_id=users.id)) RETURNING token_hash",
  )
    .bind(
      tokenHash,
      userId,
      csrf,
      Date.now() + 604800_000,
      provider
        ? await sealTokens(env, provider, `${userId}|${tokenHash}`)
        : null,
      provider ? Date.now() + provider.expires_in * 1000 : null,
      userId,
      expectedPasswordHash,
    )
    .first();
  if (!inserted)
    throw new HttpError(401, "Your credentials changed. Please sign in again.");
  return { token, csrf };
}
export async function getSession(
  request: Request,
  env: Env,
  required = true,
  checkProvider = true,
) {
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
    "SELECT users.*, sessions.csrf, sessions.provider_tokens, sessions.provider_expires_at FROM sessions JOIN users ON users.id=sessions.user_id WHERE token_hash=? AND expires_at>? AND NOT EXISTS(SELECT 1 FROM auth_deletions WHERE auth_deletions.user_id=users.id)",
  )
    .bind(tokenHash, Date.now())
    .first<
      UserRow & {
        csrf: string;
        provider_tokens: string | null;
        provider_expires_at: number | null;
      }
    >();
  if (!row) {
    if (required)
      throw new HttpError(
        401,
        "Your session expired. Please sign in again.",
        "unauthorized",
      );
    return null;
  }
  let provider: AuthTokens | undefined;
  // Legacy cookies never cross the authentication-provider boundary.
  if (usesSupabase(env) !== !!row.auth_subject) {
    if (!required) return null;
    throw new HttpError(401, "Please sign in again.", "unauthorized");
  }
  if (row.auth_subject && checkProvider) {
    try {
      if (!row.provider_tokens)
        throw new HttpError(401, "Please sign in again.", "unauthorized");
      provider = await openTokens(
        env,
        row.provider_tokens,
        `${row.id}|${tokenHash}`,
      );
      if (
        !row.provider_expires_at ||
        row.provider_expires_at < Date.now() + 60_000
      ) {
        const lockId = randomToken();
        const lock = await env.DB.prepare(
          "UPDATE sessions SET refresh_lock_id=?,refresh_lock_until=? WHERE token_hash=? AND expires_at>? AND refresh_lock_until<? RETURNING token_hash",
        )
          .bind(lockId, Date.now() + 30_000, tokenHash, Date.now(), Date.now())
          .first();
        if (!lock)
          throw new HttpError(
            409,
            "Your session is being refreshed. Please try again.",
            "auth_refresh_busy",
          );
        try {
          // Re-read after taking the lease: a concurrent request may have refreshed already.
          const current = await env.DB.prepare(
            "SELECT provider_tokens,provider_expires_at FROM sessions WHERE token_hash=? AND refresh_lock_id=?",
          )
            .bind(tokenHash, lockId)
            .first<{ provider_tokens: string; provider_expires_at: number }>();
          if (!current)
            throw new HttpError(401, "Please sign in again.", "unauthorized");
          provider = await openTokens(
            env,
            current.provider_tokens,
            `${row.id}|${tokenHash}`,
          );
          if (current.provider_expires_at < Date.now() + 60_000) {
            provider = tokensFrom(
              await refreshTokens(env, provider.refresh_token),
            );
            const encrypted = await sealTokens(
              env,
              provider,
              `${row.id}|${tokenHash}`,
            );
            const saved = await env.DB.prepare(
              "UPDATE sessions SET provider_tokens=?,provider_expires_at=? WHERE token_hash=? AND refresh_lock_id=? AND EXISTS(SELECT 1 FROM users WHERE id=? AND password_hash=?) RETURNING token_hash",
            )
              .bind(
                encrypted,
                Date.now() + provider.expires_in * 1000,
                tokenHash,
                lockId,
                row.id,
                row.password_hash,
              )
              .first();
            if (!saved)
              throw new HttpError(401, "Please sign in again.", "unauthorized");
          }
        } finally {
          await env.DB.prepare(
            "UPDATE sessions SET refresh_lock_id=NULL,refresh_lock_until=0 WHERE token_hash=? AND refresh_lock_id=?",
          )
            .bind(tokenHash, lockId)
            .run();
        }
      }
      const identity = await getAuthUser(env, provider.access_token);
      if (
        subject(env, identity) !== row.auth_subject ||
        identity.email.toLowerCase() !== row.email
      )
        throw new HttpError(
          401,
          "Your account identity changed. Please sign in again.",
          "unauthorized",
        );
      // Password changes/logout may have invalidated the session while the provider was responding.
      const stillValid = await env.DB.prepare(
        "SELECT token_hash FROM sessions WHERE token_hash=? AND EXISTS(SELECT 1 FROM users WHERE id=? AND password_hash=?)",
      )
        .bind(tokenHash, row.id, row.password_hash)
        .first();
      if (!stillValid)
        throw new HttpError(401, "Please sign in again.", "unauthorized");
    } catch (e) {
      if (e instanceof HttpError && e.status === 401) {
        await env.DB.prepare("DELETE FROM sessions WHERE token_hash=?")
          .bind(tokenHash)
          .run();
        if (!required) return null;
        throw new HttpError(
          401,
          "Your session expired. Please sign in again.",
          "unauthorized",
        );
      }
      throw e;
    }
  }
  return { row, tokenHash, csrf: row.csrf, user: publicUser(row), provider };
}
export function verifyCsrf(request: Request, csrf: string) {
  if (!constantEqual(request.headers.get("X-CSRF-Token") || "", csrf))
    throw new HttpError(
      403,
      "Your session changed. Reload the page and try again.",
      "csrf",
    );
}
