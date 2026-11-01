import { before, after, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { Miniflare, Response as MFResponse } from "miniflare";
import {
  openTokens,
  sealTokens,
  supabaseUrl,
  providerPassword,
} from "../worker/supabase";
import { appConfig } from "../worker/index";
import { createSession } from "../worker/auth";
import type { Env } from "../worker/env";

// Deterministic provider transport fixtures. No live Supabase or AI calls are made.
const URL = "https://zyra-fixture.supabase.co",
  PASSWORD = "a secure fixture password!";
const bindings = {
  APP_ENV: "development",
  AUTH_PROVIDER: "supabase",
  SUPABASE_URL: URL,
  SUPABASE_PUBLISHABLE_KEY: "sb_publishable_fixture",
  SUPABASE_SECRET_KEY: "sb_secret_fixture",
  SUPABASE_EMAIL_ENABLED: "true",
  REGISTRATION_ENABLED: "true",
  ABUSE_SECRET: "fixture-only-random-secret-at-least-32-characters",
  FREE_TIER_CONFIRMED: "true",
  GROQ_API_KEY: "fixture",
};

const identities = new Map<string, any>(),
  access = new Map<string, string>(),
  refresh = new Map<string, string>();
let mf: Miniflare,
  db: D1Database,
  failUser = false,
  failDelete = false,
  refreshCalls = 0,
  tokenCount = 0;
const sessions = new Map<
  string,
  { cookie: string; csrf: string; id: string }
>();
function grant(user: any) {
  const a = `access-fixture-${++tokenCount}`,
    r = `refresh-fixture-${tokenCount}`;
  access.set(a, user.id);
  refresh.set(r, user.id);
  return { access_token: a, refresh_token: r, expires_in: 3600, user };
}
function provider(opts: any) {
  const path = new globalThis.URL(opts.path, URL),
    b = opts.body ? JSON.parse(String(opts.body)) : {};
  const h = new Headers(opts.headers),
    jwt = h.get("authorization")?.replace("Bearer ", "");
  const current = jwt ? identities.get(access.get(jwt)!) : undefined;
  const ok = (data: any = {}) => ({
    statusCode: 200,
    data: JSON.stringify(data),
    responseOptions: { headers: { "Content-Type": "application/json" } },
  });
  const error = (statusCode = 401, code = "invalid_credentials") => ({
    statusCode,
    data: JSON.stringify({ code }),
  });
  if (path.pathname === "/auth/v1/signup") {
    if ([...identities.values()].some((u) => u.email === b.email))
      return ok({ id: crypto.randomUUID() });
    const user = {
      id: crypto.randomUUID(),
      email: b.email,
      password: b.password,
      user_metadata: b.data,
      email_confirmed_at: null,
    };
    identities.set(user.id, user);
    return ok({ id: user.id });
  }
  if (path.pathname === "/auth/v1/token") {
    if (path.searchParams.get("grant_type") === "refresh_token") {
      refreshCalls++;
      const id = refresh.get(b.refresh_token);
      refresh.delete(b.refresh_token);
      return id && identities.has(id)
        ? ok(grant(identities.get(id)))
        : error(400, "refresh_token_not_found");
    }
    const u = [...identities.values()].find(
      (u) => u.email === b.email && u.password === b.password,
    );
    if (u && !u.email_confirmed_at) return error(400, "email_not_confirmed");
    return u ? ok(grant(u)) : error();
  }
  if (path.pathname === "/auth/v1/verify") {
    const u = [...identities.values()].find((u) => u.email === b.email);
    if (!u || b.token !== "123456") return error(403, "otp_expired");
    u.email_confirmed_at = new Date().toISOString();
    return ok(grant(u));
  }
  if (path.pathname === "/auth/v1/recover") return ok();
  if (path.pathname === "/auth/v1/user") {
    if (failUser) return error(503, "unavailable");
    if (!current) return error();
    if (opts.method === "PUT") {
      if (b.current_password && current.password !== b.current_password)
        return error();
      current.password = b.password;
    }
    return ok(current);
  }
  if (path.pathname === "/auth/v1/logout") {
    if (jwt) access.delete(jwt);
    return ok();
  }
  if (path.pathname.startsWith("/auth/v1/admin/users/")) {
    assert.equal(h.get("apikey"), "sb_secret_fixture");
    if (failDelete) return error(503, "unavailable");
    const id = path.pathname.split("/").pop()!;
    if (!identities.has(id)) return error(404, "user_not_found");
    identities.delete(id);
    return ok();
  }
  throw new Error(
    "Unexpected fixture endpoint " + opts.method + " " + opts.path,
  );
}
async function request(
  path: string,
  method = "GET",
  body?: any,
  name?: string,
  headers: Record<string, string> = {},
) {
  const s = name ? sessions.get(name) : undefined;
  return mf.dispatchFetch("http://localhost/api" + path, {
    method,
    headers: {
      ...(method !== "GET"
        ? { Origin: "http://localhost", "Content-Type": "application/json" }
        : {}),
      ...(s ? { Cookie: s.cookie, "X-CSRF-Token": s.csrf } : {}),
      ...headers,
    },
    body: method === "GET" ? undefined : JSON.stringify(body || {}),
  });
}
async function remember(name: string, r: Response) {
  assert.ok(r.status < 300, await r.clone().text());
  const data: any = await r.json();
  sessions.set(name, {
    id: data.user.id,
    cookie: r.headers.get("set-cookie")!.split(";")[0],
    csrf: data.csrf,
  });
  assert.equal(JSON.stringify(data).includes("access-fixture"), false);
  assert.equal(JSON.stringify(data).includes("sb_secret"), false);
  return data;
}
async function register(name: string) {
  const r = await request("/auth/register", "POST", {
    email: `${name}@example.test`,
    password: PASSWORD,
    name,
    consent: true,
  });
  assert.equal(r.status, 202, await r.clone().text());
  assert.equal(((await r.json()) as any).next, "verify");
  const verified = await request("/auth/verify", "POST", {
    email: `${name}@example.test`,
    code: "123456",
    consent: true,
  });
  return remember(name, verified as unknown as Response);
}
before(async () => {
  mf = new Miniflare({
    modules: true,
    scriptPath: "dist/server/index.js",
    compatibilityDate: "2026-05-15",
    compatibilityFlags: ["nodejs_compat"],
    d1Databases: { DB: "supabase-tests" },
    bindings,
    outboundService: async (request: Request) => {
      const u = new globalThis.URL(request.url);
      assert.equal(u.origin, URL);
      const result = provider({
        path: u.pathname + u.search,
        method: request.method,
        body: await request.text(),
        headers: Object.fromEntries(request.headers.entries()),
      });
      return new MFResponse(result.data, {
        status: result.statusCode,
        headers: { "Content-Type": "application/json" },
      });
    },
  });
  db = (await mf.getD1Database("DB")) as unknown as D1Database;
  for (const f of (await readdir("drizzle"))
    .filter((f) => f.endsWith(".sql"))
    .sort())
    for (const sql of (await readFile("drizzle/" + f, "utf8"))
      .split("--> statement-breakpoint")
      .filter((s) => s.trim()))
      await db.prepare(sql).run();
});
after(async () => {
  await mf.dispose();
});
beforeEach(async () => {
  await db.prepare("DELETE FROM throttle").run();
  failUser = false;
  failDelete = false;
});
test("Supabase configuration fails closed; URLs and UTF-8 password limits are validated", () => {
  const req = new Request("https://zyra.example");
  assert.equal(appConfig(req, { ...bindings } as Env).authReady, false); // production requires Turnstile
  assert.equal(
    appConfig(req, {
      ...bindings,
      TURNSTILE_SITE_KEY: "site",
      TURNSTILE_SECRET_KEY: "secret",
    } as Env).authReady,
    true,
  );
  assert.equal(
    appConfig(req, { ...bindings, SUPABASE_SECRET_KEY: "" } as Env).authReady,
    false,
  );
  for (const url of [
    "http://zyra-fixture.supabase.co",
    "https://evil.test",
    "https://zyra-fixture.supabase.co@evil.test",
    "https://zyra-fixture.supabase.co/path",
    "https://zyra-fixture.supabase.co?key=x",
  ])
    assert.equal(supabaseUrl({ ...bindings, SUPABASE_URL: url } as Env), "");
  assert.throws(() => providerPassword("മ".repeat(25)));
  assert.equal(providerPassword("a".repeat(72)).length, 72);
});
test("provider tokens are encrypted, randomized, and bound to the project and session", async () => {
  const e = bindings as Env,
    value = {
      access_token: "sensitive-access",
      refresh_token: "sensitive-refresh",
      expires_in: 3600,
    };
  const a = await sealTokens(e, value, "alice|token1"),
    b = await sealTokens(e, value, "alice|token1");
  assert.notEqual(a, b);
  assert.ok(!a.includes("sensitive"));
  assert.deepEqual(await openTokens(e, a, "alice|token1"), value);
  await assert.rejects(openTokens(e, a, "bob|token1"));
  await assert.rejects(
    openTokens(
      { ...e, SUPABASE_URL: "https://other.supabase.co" },
      a,
      "alice|token1",
    ),
  );
  await assert.rejects(
    openTokens(
      { ...e, ABUSE_SECRET: "other-32-character-or-longer-fixture-key" },
      a,
      "alice|token1",
    ),
  );
});
test("email confirmation creates no D1 account until verified and stores no passwords", async () => {
  await register("alice");
  await register("bob");
  const row: any = await db
    .prepare("SELECT * FROM users WHERE id=?")
    .bind(sessions.get("alice")!.id)
    .first();
  assert.match(row.auth_subject, /^https:\/\/zyra-fixture.supabase.co\|/);
  assert.match(row.password_hash, /^external\$/);
  assert.ok(!row.password_hash.includes(PASSWORD));
  const s: any = await db
    .prepare("SELECT * FROM sessions WHERE user_id=?")
    .bind(row.id)
    .first();
  assert.ok(!s.provider_tokens.includes("access-fixture"));
  assert.match(s.provider_tokens, /^v1\./);
  const me: any = await (
    await request("/me", "GET", undefined, "alice")
  ).json();
  assert.equal(me.user.id, row.id);
});
test("wrong password and wrong verification code do not create a session", async () => {
  const r = await request("/auth/login", "POST", {
    email: "alice@example.test",
    password: "incorrect password value",
  });
  assert.equal(r.status, 401);
  assert.equal(r.headers.get("set-cookie"), null);
  assert.equal(
    (
      await request("/auth/verify", "POST", {
        email: "bob@example.test",
        code: "999999",
        consent: true,
      })
    ).status,
    401,
  );
});
test("secure cookie, origin and CSRF authorization remain enforced", async () => {
  assert.equal(
    (
      await request("/profile", "PATCH", {}, "alice", {
        "X-CSRF-Token": "wrong",
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await request("/auth/login", "POST", {}, undefined, {
        Origin: "https://evil.test",
      })
    ).status,
    403,
  );
  assert.equal((await request("/conversations")).status, 401);
});
test("D1 conversations retain ownership and synchronize across Supabase logins", async () => {
  const id = crypto.randomUUID(),
    alice = sessions.get("alice")!;
  await db
    .prepare(
      "INSERT INTO conversations(id,user_id,title,created_at,updated_at) VALUES(?,?,?,?,?)",
    )
    .bind(id, alice.id, "മലയാളം English", Date.now(), Date.now())
    .run();
  assert.equal(
    (await request(`/conversations/${id}`, "GET", undefined, "bob")).status,
    404,
  );
  assert.equal(
    (await request(`/conversations/${id}`, "DELETE", {}, "bob")).status,
    404,
  );
  await remember(
    "alice-device2",
    (await request("/auth/login", "POST", {
      email: "alice@example.test",
      password: PASSWORD,
    })) as unknown as Response,
  );
  const list: any = await (
    await request("/conversations", "GET", undefined, "alice-device2")
  ).json();
  assert.equal(list[0].title, "മലയാളം English");
  assert.equal((await request("/me", "GET", undefined, "alice")).status, 200);
});
test("expired provider access refreshes once and keeps the same opaque browser session", async () => {
  const old = refreshCalls;
  await db
    .prepare("UPDATE sessions SET provider_expires_at=0 WHERE user_id=?")
    .bind(sessions.get("alice")!.id)
    .run();
  const r = await request("/me", "GET", undefined, "alice");
  assert.equal(r.status, 200, await r.clone().text());
  assert.equal(refreshCalls, old + 1);
  assert.equal((await request("/me", "GET", undefined, "alice")).status, 200);
  assert.equal(refreshCalls, old + 1);
});
test("a refresh lease prevents concurrent rotation of the same refresh token", async () => {
  const id = sessions.get("bob")!.id;
  await db
    .prepare(
      "UPDATE sessions SET provider_expires_at=0,refresh_lock_until=? WHERE user_id=?",
    )
    .bind(Date.now() + 30000, id)
    .run();
  const old = refreshCalls,
    r = await request("/me", "GET", undefined, "bob");
  assert.equal(r.status, 409);
  assert.equal(refreshCalls, old);
  await db
    .prepare("UPDATE sessions SET refresh_lock_until=0 WHERE user_id=?")
    .bind(id)
    .run();
  assert.equal((await request("/me", "GET", undefined, "bob")).status, 200);
});
test("provider outages fail closed without destroying the recoverable session", async () => {
  failUser = true;
  assert.equal(
    (await request("/conversations", "GET", undefined, "alice")).status,
    503,
  );
  failUser = false;
  assert.equal(
    (await request("/conversations", "GET", undefined, "alice")).status,
    200,
  );
});
test("legacy accounts are preserved and never auto-linked by matching email", async () => {
  await db
    .prepare(
      "INSERT INTO users(id,email,name,password_hash,settings,created_at,consent_at) VALUES(?,?,?,?,?,?,?)",
    )
    .bind(
      "legacy",
      "legacy@example.test",
      "Legacy",
      "legacy-password-hash",
      "{}",
      Date.now(),
      Date.now(),
    )
    .run();
  await request("/auth/register", "POST", {
    email: "legacy@example.test",
    password: PASSWORD,
    name: "New",
    consent: true,
  });
  const r = await request("/auth/verify", "POST", {
    email: "legacy@example.test",
    code: "123456",
    consent: true,
  });
  assert.equal(r.status, 409);
  assert.equal(((await r.json()) as any).code, "identity_conflict");
  assert.equal(
    (
      (await db
        .prepare("SELECT password_hash FROM users WHERE id='legacy'")
        .first()) as any
    ).password_hash,
    "legacy-password-hash",
  );
});
test("password change requires reauthentication and revokes every D1 session", async () => {
  assert.equal(
    (
      await request(
        "/account/password",
        "POST",
        {
          currentPassword: "incorrect password value",
          newPassword: "new fixture password value!",
        },
        "alice",
      )
    ).status,
    401,
  );
  const r = await request(
    "/account/password",
    "POST",
    { currentPassword: PASSWORD, newPassword: "new fixture password value!" },
    "alice",
  );
  assert.equal(r.status, 200, await r.clone().text());
  assert.equal(
    (await request("/conversations", "GET", undefined, "alice-device2")).status,
    401,
  );
  assert.equal(
    (await request("/conversations", "GET", undefined, "alice")).status,
    401,
  );
  assert.equal(
    (
      await request("/auth/login", "POST", {
        email: "alice@example.test",
        password: PASSWORD,
      })
    ).status,
    401,
  );
});
test("recovery uses a verified one-time-code response and invalidates existing sessions", async () => {
  const r = await request("/auth/recover", "POST", {
    email: "bob@example.test",
  });
  assert.equal(r.status, 200);
  assert.equal(((await r.json()) as any).next, "reset");
  assert.equal(
    (
      await request("/auth/reset", "POST", {
        email: "bob@example.test",
        code: "000000",
        newPassword: "reset fixture password value!",
      })
    ).status,
    401,
  );
  assert.equal(
    (
      await request("/auth/reset", "POST", {
        email: "bob@example.test",
        code: "123456",
        newPassword: "reset fixture password value!",
      })
    ).status,
    200,
  );
  assert.equal(
    (await request("/conversations", "GET", undefined, "bob")).status,
    401,
  );
  await remember(
    "bob",
    (await request("/auth/login", "POST", {
      email: "bob@example.test",
      password: "reset fixture password value!",
    })) as unknown as Response,
  );
});
test("logout revokes the local session even if Supabase is unavailable", async () => {
  failUser = true;
  assert.equal((await request("/auth/logout", "POST", {}, "bob")).status, 200);
  failUser = false;
  assert.equal(
    (await request("/conversations", "GET", undefined, "bob")).status,
    401,
  );
});
test("deletion is durable across a provider outage and completed by scheduled retry", async () => {
  await register("delete-me");
  const id = sessions.get("delete-me")!.id;
  const row: any = await db
    .prepare("SELECT * FROM users WHERE id=?")
    .bind(id)
    .first();
  failDelete = true;
  const r = await request(
    "/account",
    "DELETE",
    { password: PASSWORD, confirmation: "DELETE" },
    "delete-me",
  );
  assert.equal(r.status, 202, await r.clone().text());
  assert.equal(((await r.json()) as any).pending, true);
  assert.equal(
    (await request("/conversations", "GET", undefined, "delete-me")).status,
    401,
  );
  const login = await request("/auth/login", "POST", {
    email: "delete-me@example.test",
    password: PASSWORD,
  });
  assert.equal(login.status, 401);
  await assert.rejects(
    createSession({ ...bindings, DB: db } as Env, id, row.password_hash),
  );
  failDelete = false;
  await mf.getWorker().then((w) => w.scheduled());
  assert.equal(
    await db.prepare("SELECT id FROM users WHERE id=?").bind(id).first(),
    null,
  );
  const tombstone: any = await db
    .prepare("SELECT completed_at FROM auth_deletions WHERE user_id=?")
    .bind(id)
    .first();
  assert.ok(tombstone.completed_at);
});
