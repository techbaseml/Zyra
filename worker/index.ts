import type { Env } from "./env";
import { authCheckConfig, runAuthCheck } from "./diagnostics";
import { localDevelopment } from "./env";
import { defaultSettings } from "../shared/types";
import {
  HttpError,
  hashPassword,
  ipHash,
  rateLimit,
  readJson,
  responseHeaders,
  stringField,
  validateOrigin,
  validatePassword,
  verifyChallenge,
  verifyPassword,
  digest,
} from "./security";
import {
  createSession,
  getSession,
  publicUser,
  sessionCookie,
  validateSettings,
  verifyCsrf,
  type UserRow,
} from "./auth";
import { chat, ownedConversation, withMutationLock } from "./chat";
import { limits, usage } from "./quotas";
const json = (value: unknown, status = 200, headers?: HeadersInit) =>
  Response.json(value, { status, headers });
export function appConfig(request: Request, env: Env) {
  const authReady =
    localDevelopment(request, env) ||
    !!(
      env.ABUSE_SECRET &&
      env.ABUSE_SECRET.length >= 24 &&
      env.TURNSTILE_SITE_KEY &&
      env.TURNSTILE_SECRET_KEY &&
      env.AUTH_CPU_VERIFIED === "true"
    );
  return {
    aiReady: env.FREE_TIER_CONFIRMED === "true" && !!env.GROQ_API_KEY,
    authReady,
    registrationEnabled: authReady && env.REGISTRATION_ENABLED === "true",
    turnstileSiteKey: localDevelopment(request, env)
      ? ""
      : env.TURNSTILE_SITE_KEY || "",
    recoveryAvailable: false as const,
    dailyLimit: limits(env).user,
  };
}
async function route(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
): Promise<Response> {
  const url = new URL(request.url),
    path = url.pathname,
    method = request.method;
  if (!path.startsWith("/api/")) return env.ASSETS.fetch(request);
  if (!["GET", "POST", "PATCH", "DELETE"].includes(method))
    throw new HttpError(405, "Method not allowed.");
  if (method !== "GET") validateOrigin(request);
  if (path === "/api/setup/auth-check" && method === "GET")
    return json(authCheckConfig(env));
  if (path === "/api/setup/auth-check" && method === "POST")
    return runAuthCheck(request, env);
  if (path === "/api/config" && method === "GET")
    return json(appConfig(request, env));
  if (path === "/api/health" && method === "GET") {
    await env.DB.prepare("SELECT 1").first();
    return json({ ok: true, aiReady: appConfig(request, env).aiReady });
  }
  if (path === "/api/me" && method === "GET") {
    const s = await getSession(request, env, false);
    return json({
      user: s?.user || null,
      csrf: s?.csrf || null,
      usage: s
        ? await usage(env, s.user.id)
        : { used: 0, limit: limits(env).user, resetsAt: "" },
    });
  }
  if (
    (path === "/api/auth/register" || path === "/api/auth/login") &&
    method === "POST"
  ) {
    const config = appConfig(request, env),
      register = path.endsWith("register");
    if (!config.authReady || (register && !config.registrationEnabled))
      throw new HttpError(
        503,
        register
          ? "New accounts will open after the owner completes secure setup."
          : "Sign-in is awaiting secure server configuration.",
        "setup_required",
      );
    const body = await readJson(request, 8000),
      ip = await ipHash(request, env);
    await rateLimit(env, `auth-ip:${ip}`, 10, 900);
    const email = stringField(body.email, 254, "email address").toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
      throw new HttpError(400, "Enter a valid email address.");
    await rateLimit(env, `auth-email:${await digest(email)}`, 10, 900);
    const password = validatePassword(body.password);
    await verifyChallenge(
      request,
      env,
      body.turnstileToken,
      register ? "register" : "login",
    );
    let row = await env.DB.prepare("SELECT * FROM users WHERE email=?")
      .bind(email)
      .first<UserRow>();
    if (register) {
      if (body.consent !== true)
        throw new HttpError(
          400,
          "Read and accept the privacy information to continue.",
        );
      await rateLimit(env, `signup:${ip}`, 3, 86400);
      await rateLimit(env, "global-signup", 50, 86400);
      const name = stringField(body.name, 60, "display name");
      const passwordHash = await hashPassword(password);
      if (row)
        throw new HttpError(
          409,
          "This account could not be created. Try signing in instead.",
        );
      row = {
        id: crypto.randomUUID(),
        email,
        name,
        password_hash: passwordHash,
        settings: JSON.stringify(defaultSettings),
        created_at: Date.now(),
        consent_at: Date.now(),
      };
      try {
        await env.DB.prepare(
          "INSERT INTO users(id,email,name,password_hash,settings,created_at,consent_at) VALUES(?,?,?,?,?,?,?)",
        )
          .bind(
            row.id,
            row.email,
            row.name,
            row.password_hash,
            row.settings,
            row.created_at,
            row.consent_at,
          )
          .run();
      } catch {
        throw new HttpError(
          409,
          "This account could not be created. Try signing in instead.",
        );
      }
    } else {
      // A full dummy KDF prevents a fast nonexistent-email response.
      const valid = row
        ? await verifyPassword(password, row.password_hash)
        : (await hashPassword(password), false);
      if (!row || !valid)
        throw new HttpError(
          401,
          "Email or password is incorrect.",
          "invalid_credentials",
        );
    }
    const session = await createSession(env, row.id, row.password_hash);
    return json(
      {
        user: publicUser(row),
        csrf: session.csrf,
        usage: await usage(env, row.id),
      },
      register ? 201 : 200,
      { "Set-Cookie": sessionCookie(request, env, session.token) },
    );
  }
  const session = (await getSession(request, env))!;
  if (method !== "GET") verifyCsrf(request, session.csrf);
  await rateLimit(env, `api:${session.user.id}`, 120, 60);
  if (path === "/api/auth/logout" && method === "POST") {
    await env.DB.prepare("DELETE FROM sessions WHERE token_hash=?")
      .bind(session.tokenHash)
      .run();
    return json({ ok: true }, 200, {
      "Set-Cookie": sessionCookie(request, env, "", true),
    });
  }
  if (path === "/api/profile" && method === "PATCH") {
    const b = await readJson(request, 4000),
      name = stringField(b.name, 60, "display name"),
      settings = validateSettings(b.settings);
    await env.DB.prepare("UPDATE users SET name=?,settings=? WHERE id=?")
      .bind(name, JSON.stringify(settings), session.user.id)
      .run();
    return json({ user: { ...session.user, name, settings } });
  }
  if (path === "/api/account/password" && method === "POST") {
    if (!appConfig(request, env).authReady)
      throw new HttpError(
        503,
        "Account security services are temporarily unavailable. Please try again later.",
      );
    const b = await readJson(request, 4000);
    await rateLimit(env, `reauth:${session.user.id}`, 5, 900);
    if (
      !(await verifyPassword(
        validatePassword(b.currentPassword),
        session.row.password_hash,
      ))
    )
      throw new HttpError(401, "Current password is incorrect.");
    const hash = await hashPassword(validatePassword(b.newPassword));
    const result = await env.DB.batch([
      env.DB.prepare(
        "UPDATE users SET password_hash=? WHERE id=? AND password_hash=?",
      ).bind(hash, session.user.id, session.row.password_hash),
      env.DB.prepare(
        "DELETE FROM sessions WHERE user_id=? AND EXISTS(SELECT 1 FROM users WHERE id=? AND password_hash=?)",
      ).bind(session.user.id, session.user.id, hash),
    ]);
    if (!result[0].meta.changes)
      throw new HttpError(
        409,
        "Your password changed during this request. Please sign in again.",
      );
    return json({ ok: true }, 200, {
      "Set-Cookie": sessionCookie(request, env, "", true),
    });
  }
  if (path === "/api/account" && method === "DELETE") {
    if (!appConfig(request, env).authReady)
      throw new HttpError(
        503,
        "Account security services are temporarily unavailable. Please try again later.",
      );
    const b = await readJson(request, 2000);
    await rateLimit(env, `reauth:${session.user.id}`, 5, 900);
    if (
      b.confirmation !== "DELETE" ||
      !(await verifyPassword(
        validatePassword(b.password),
        session.row.password_hash,
      ))
    )
      throw new HttpError(
        400,
        "Enter your password and type DELETE to confirm.",
      );
    const deleted = await withMutationLock(env, session.user.id, () =>
      env.DB.prepare(
        "DELETE FROM users WHERE id=? AND password_hash=? RETURNING id",
      )
        .bind(session.user.id, session.row.password_hash)
        .first(),
    );
    if (!deleted)
      throw new HttpError(
        409,
        "Your credentials changed. Sign in again before deleting your account.",
      );
    return json({ ok: true }, 200, {
      "Set-Cookie": sessionCookie(request, env, "", true),
    });
  }
  if (path === "/api/conversations" && method === "GET") {
    const search = (url.searchParams.get("q") || "").slice(0, 100);
    const rows = await env.DB.prepare(
      "SELECT id,title,created_at,updated_at FROM conversations WHERE user_id=? AND instr(lower(title),lower(?))>0 ORDER BY updated_at DESC LIMIT 200",
    )
      .bind(session.user.id, search)
      .all();
    return json(rows.results);
  }
  if (path === "/api/conversations" && method === "DELETE") {
    const b = await readJson(request, 1000);
    if (b.confirmation !== "DELETE ALL")
      throw new HttpError(400, "Type DELETE ALL to confirm.");
    await withMutationLock(env, session.user.id, () =>
      env.DB.prepare("DELETE FROM conversations WHERE user_id=?")
        .bind(session.user.id)
        .run(),
    );
    return json({ ok: true });
  }
  const conversation = /^\/api\/conversations\/([0-9a-f-]{36})$/.exec(path);
  if (conversation) {
    const c = await ownedConversation(env, conversation[1], session.user.id);
    if (method === "GET")
      return json({
        conversation: c,
        messages: (
          await env.DB.prepare(
            "SELECT * FROM messages WHERE conversation_id=? ORDER BY seq",
          )
            .bind(conversation[1])
            .all()
        ).results,
      });
    if (method === "PATCH") {
      const b = await readJson(request, 1000);
      await withMutationLock(env, session.user.id, () =>
        env.DB.prepare(
          "UPDATE conversations SET title=?,updated_at=? WHERE id=? AND user_id=?",
        )
          .bind(
            stringField(b.title, 80, "title"),
            Date.now(),
            conversation[1],
            session.user.id,
          )
          .run(),
      );
      return json({ ok: true });
    }
    if (method === "DELETE") {
      await withMutationLock(env, session.user.id, () =>
        env.DB.prepare("DELETE FROM conversations WHERE id=? AND user_id=?")
          .bind(conversation[1], session.user.id)
          .run(),
      );
      return json({ ok: true });
    }
  }
  if (path === "/api/chat" && method === "POST")
    return chat(request, env, ctx, session, await readJson(request));
  if (path === "/api/chat/stop" && method === "POST") {
    const b = await readJson(request, 1000);
    await env.DB.prepare(
      "UPDATE generation_locks SET cancelled=1 WHERE request_id=? AND user_id=?",
    )
      .bind(String(b.requestId), session.user.id)
      .run();
    return json({ ok: true });
  }
  throw new HttpError(404, "Endpoint not found.");
}
export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext) {
    let response: Response;
    try {
      response = await route(request, env, ctx);
    } catch (e) {
      response =
        e instanceof HttpError
          ? json({ error: e.message, code: e.code }, e.status)
          : json(
              {
                error:
                  "ZYRA could not complete this request. Please try again. If this continues, contact the site owner.",
                code: "server_error",
              },
              500,
            );
    }
    // Bounded probabilistic maintenance; no user text, keys, or IP addresses are logged.
    if (new URL(request.url).pathname === "/api/me" && Math.random() < 0.02)
      ctx.waitUntil(
        env.DB.batch([
          env.DB.prepare(
            "DELETE FROM sessions WHERE token_hash IN(SELECT token_hash FROM sessions WHERE expires_at<? LIMIT 200)",
          ).bind(Date.now()),
          env.DB.prepare(
            "DELETE FROM throttle WHERE key IN(SELECT key FROM throttle WHERE expires_at<? LIMIT 200)",
          ).bind(Date.now()),
          env.DB.prepare(
            "DELETE FROM usage_events WHERE id IN(SELECT id FROM usage_events WHERE created_at<? LIMIT 200)",
          ).bind(Date.now() - 7 * 86400_000),
          env.DB.prepare(
            "DELETE FROM provider_usage WHERE id IN(SELECT id FROM provider_usage WHERE created_at<? LIMIT 200)",
          ).bind(Date.now() - 7 * 86400_000),
        ]).catch(() => {}),
      );
    return responseHeaders(response, request, env);
  },
} satisfies ExportedHandler<Env>;
