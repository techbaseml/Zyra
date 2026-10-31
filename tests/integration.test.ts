import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { Miniflare, createFetchMock } from "miniflare";
import { reserveQuota } from "../worker/quotas";
import { createSession } from "../worker/auth";
import type { Env } from "../worker/env";
let mf: Miniflare, db: D1Database, env: Env;
const mock = createFetchMock();
mock.disableNetConnect();
const accounts = new Map<
  string,
  { cookie: string; csrf: string; id: string }
>();
const PASSWORD = "Zyra integration password 2026!";
async function request(
  path: string,
  method = "GET",
  body?: unknown,
  account?: string,
  headers: Record<string, string> = {},
) {
  const a = account ? accounts.get(account) : null;
  return mf.dispatchFetch("http://localhost/api" + path, {
    method,
    headers: {
      ...(method === "GET"
        ? {}
        : { Origin: "http://localhost", "Content-Type": "application/json" }),
      ...(a ? { Cookie: a.cookie, "X-CSRF-Token": a.csrf } : {}),
      ...headers,
    },
    body: method === "GET" ? undefined : JSON.stringify(body || {}),
  });
}
async function register(name: string) {
  const response = await request(
    "/auth/register",
    "POST",
    { email: `${name}@example.test`, name, password: PASSWORD, consent: true },
    undefined,
    { "CF-Connecting-IP": name },
  );
  assert.equal(response.status, 201, await response.clone().text());
  const data = (await response.json()) as any;
  accounts.set(name, {
    cookie: response.headers.get("set-cookie")!.split(";")[0],
    csrf: data.csrf,
    id: data.user.id,
  });
  return data;
}
async function resetBudgets() {
  await db.prepare("DELETE FROM provider_usage").run();
  await db.prepare("DELETE FROM usage_events").run();
  await db.prepare("DELETE FROM throttle WHERE key LIKE 'chat:%'").run();
}
function provider(text: string, status = 200) {
  mock
    .get("https://api.groq.com")
    .intercept({ path: "/openai/v1/chat/completions", method: "POST" })
    .reply(
      status,
      status === 200
        ? `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\ndata: [DONE]\n\n`
        : "",
      { headers: { "Content-Type": "text/event-stream" } },
    );
}
async function send(body: Record<string, unknown>, name = "alice") {
  provider("test fixture: മലയാളം and English");
  const response = await request(
    "/chat",
    "POST",
    {
      requestId: crypto.randomUUID(),
      content: "Explain Python code മലയാളത്തിൽ.",
      ...body,
    },
    name,
  );
  assert.equal(response.status, 200, await response.clone().text());
  const text = await response.text();
  assert.match(text, /event: done/);
  assert.ok(!text.includes("event: error"), text);
  const meta = JSON.parse(
    text
      .split("\n")
      .find((l) => l.startsWith("data:"))!
      .slice(6),
  );
  return meta.conversationId as string;
}
before(async () => {
  mf = new Miniflare({
    modules: true,
    scriptPath: "dist/server/index.js",
    compatibilityDate: "2026-05-15",
    compatibilityFlags: ["nodejs_compat"],
    d1Databases: { DB: "zyra-tests" },
    bindings: {
      APP_ENV: "development",
      AUTH_CHECK_EXPIRES_AT: String(Date.now() + 3600_000),
      ABUSE_SECRET: "diagnostic-fixture-32-character-secret",
      TURNSTILE_SITE_KEY: "test-public-key",
      TURNSTILE_SECRET_KEY: "test-secret-never-live",
      REGISTRATION_ENABLED: "true",
      FREE_TIER_CONFIRMED: "true",
      GROQ_API_KEY: "test-key-never-live",
      GEMINI_API_KEY: "test-key-never-live",
    },
    fetchMock: mock,
  });
  db = (await mf.getD1Database("DB")) as unknown as D1Database;
  env = {
    DB: db,
    DAILY_USER_LIMIT: "20",
    DAILY_GLOBAL_LIMIT: "200",
    DAILY_IP_LIMIT: "40",
    DAILY_TOKEN_BUDGET: "150000",
  } as Env;
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
  await mock.close();
});
test("D1 schema, registration, sessions, authentication and private account identity", async () => {
  const alice = await register("alice");
  await register("bob");
  assert.equal(alice.user.email, "alice@example.test");
  assert.ok(!("password_hash" in alice.user));
  const stored = await db
    .prepare("SELECT password_hash FROM users WHERE id=?")
    .bind(alice.user.id)
    .first<{ password_hash: string }>();
  assert.match(stored!.password_hash, /scrypt\$/);
  assert.ok(!stored!.password_hash.includes(PASSWORD));
  assert.equal((await request("/me", "GET", undefined, "alice")).status, 200);
  assert.equal((await request("/conversations")).status, 401);
  const bad = await request(
    "/auth/login",
    "POST",
    { email: "alice@example.test", password: "incorrect password value" },
    undefined,
    { "CF-Connecting-IP": "new-login" },
  );
  assert.equal(bad.status, 401);
  const login = await request(
    "/auth/login",
    "POST",
    { email: "alice@example.test", password: PASSWORD },
    undefined,
    { "CF-Connecting-IP": "new-login" },
  );
  assert.equal(login.status, 200);
  assert.match(login.headers.get("set-cookie")!, /HttpOnly/);
});
test("authenticated mutation rejects missing CSRF and foreign origins", async () => {
  assert.equal(
    (
      await request(
        "/profile",
        "PATCH",
        { name: "hacker", settings: {} },
        "alice",
        { "X-CSRF-Token": "" },
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await request("/profile", "PATCH", {}, "alice", {
        Origin: "https://evil.example",
      })
    ).status,
    403,
  );
});
test("chat streams, persists Unicode, and enforces cross-account isolation", async () => {
  await resetBudgets();
  const id = await send({});
  const data = (await (
    await request("/conversations/" + id, "GET", undefined, "alice")
  ).json()) as any;
  assert.equal(data.messages.length, 2);
  assert.match(data.messages[1].content, /മലയാളം/);
  for (const method of ["GET", "PATCH", "DELETE"])
    assert.equal(
      (
        await request(
          "/conversations/" + id,
          method,
          { title: "stolen" },
          "bob",
        )
      ).status,
      404,
    );
  assert.equal(
    (await request("/conversations", "GET", undefined, "bob")).status,
    200,
  );
  assert.deepEqual(
    await (await request("/conversations", "GET", undefined, "bob")).json(),
    [],
  );
  await resetBudgets();
  await send({ conversationId: id, content: "second question" });
  const continued = (await (
    await request("/conversations/" + id, "GET", undefined, "alice")
  ).json()) as any;
  assert.equal(continued.messages.length, 4);
});
test("editing replaces downstream turns and regenerate replaces only the final answer", async () => {
  await resetBudgets();
  const id = await send({ content: "first question" });
  await resetBudgets();
  await send({ conversationId: id, content: "later question" });
  const first = (await (
    await request("/conversations/" + id, "GET", undefined, "alice")
  ).json()) as any;
  await resetBudgets();
  await send({
    conversationId: id,
    mode: "edit",
    messageId: first.messages[0].id,
    content: "edited question",
  });
  let data = (await (
    await request("/conversations/" + id, "GET", undefined, "alice")
  ).json()) as any;
  assert.equal(data.messages.length, 2);
  assert.equal(data.messages[0].content, "edited question");
  const old = data.messages[1].id;
  await resetBudgets();
  await send({ conversationId: id, mode: "regenerate" });
  data = (await (
    await request("/conversations/" + id, "GET", undefined, "alice")
  ).json()) as any;
  assert.equal(data.messages.length, 2);
  assert.notEqual(data.messages[1].id, old);
});
test("primary quota failure performs real adapter fallback with mocked transports only", async () => {
  await resetBudgets();
  provider("", 429);
  mock
    .get("https://generativelanguage.googleapis.com")
    .intercept({
      path: "/v1beta/models/gemini-3.5-flash-lite:streamGenerateContent?alt=sse",
      method: "POST",
    })
    .reply(
      200,
      'data: {"candidates":[{"content":{"parts":[{"text":"fallback transport fixture"}]},"finishReason":"STOP"}]}\n\n',
      { headers: { "Content-Type": "text/event-stream" } },
    );
  const response = await request(
    "/chat",
    "POST",
    { requestId: crypto.randomUUID(), content: "fallback test" },
    "alice",
  );
  const text = await response.text();
  assert.match(text, /fallback transport fixture/);
  assert.match(text, /event: done/);
  assert.ok(!text.includes("event: error"), text);
  const attempts = await db
    .prepare("SELECT provider FROM provider_usage ORDER BY provider")
    .all();
  assert.deepEqual(
    attempts.results.map((x: any) => x.provider),
    ["gemini", "groq"],
  );
});
test("atomic reservations enforce the 20-per-user daily cap under concurrency", async () => {
  await resetBudgets();
  const results = await Promise.allSettled(
    Array.from({ length: 30 }, () =>
      reserveQuota(
        env,
        "isolated-test-user",
        "isolated-ip",
        crypto.randomUUID(),
        1,
      ),
    ),
  );
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 20);
  assert.equal(results.filter((r) => r.status === "rejected").length, 10);
});
test("shared mutation locks block deletion while a response is active", async () => {
  const alice = accounts.get("alice")!;
  await db
    .prepare(
      "INSERT INTO generation_locks(user_id,request_id,conversation_id,expires_at,cancelled) VALUES(?,?,?,?,0)",
    )
    .bind(alice.id, crypto.randomUUID(), "test", Date.now() + 30000)
    .run();
  assert.equal(
    (
      await request(
        "/conversations",
        "DELETE",
        { confirmation: "DELETE ALL" },
        "alice",
      )
    ).status,
    409,
  );
  await db
    .prepare("DELETE FROM generation_locks WHERE user_id=?")
    .bind(alice.id)
    .run();
});
test("global and IP daily caps remain atomic across different users", async () => {
  await resetBudgets();
  let results = await Promise.allSettled(
    Array.from({ length: 12 }, (_, i) =>
      reserveQuota(
        { ...env, DAILY_GLOBAL_LIMIT: "3" },
        `global-${i}`,
        `ip-${i}`,
        crypto.randomUUID(),
        1,
      ),
    ),
  );
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 3);
  await resetBudgets();
  results = await Promise.allSettled(
    Array.from({ length: 8 }, (_, i) =>
      reserveQuota(
        { ...env, DAILY_IP_LIMIT: "2" },
        `user-${i}`,
        "shared-ip",
        crypto.randomUUID(),
        1,
      ),
    ),
  );
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 2);
});
test("cancellation during provider silence does not start fallback", async () => {
  await resetBudgets();
  mock
    .get("https://api.groq.com")
    .intercept({ path: "/openai/v1/chat/completions", method: "POST" })
    .reply(503, "")
    .delay(9000);
  const requestId = crypto.randomUUID(),
    response = await request(
      "/chat",
      "POST",
      { requestId, content: "test cancellation during provider wait" },
      "alice",
    );
  assert.equal(response.status, 200);
  const body = response.text();
  assert.equal(
    (await request("/chat/stop", "POST", { requestId }, "alice")).status,
    200,
  );
  const stream = await body;
  assert.match(stream, /Response stopped/);
  const calls = await db.prepare("SELECT provider FROM provider_usage").all();
  assert.ok(calls.results.every((r: any) => r.provider === "groq"));
});
test("profile and preferences sync through a new authenticated session", async () => {
  const s = {
    theme: "light",
    language: "ml",
    responseLength: "concise",
    reducedMotion: true,
    allowFallback: false,
  };
  assert.equal(
    (
      await request(
        "/profile",
        "PATCH",
        { name: "Alice Malayalam", settings: s },
        "alice",
      )
    ).status,
    200,
  );
  const login = await request(
    "/auth/login",
    "POST",
    { email: "alice@example.test", password: PASSWORD },
    undefined,
    { "CF-Connecting-IP": "another-device" },
  );
  const data = (await login.json()) as any;
  assert.deepEqual(data.user.settings, s);
  assert.equal(data.user.name, "Alice Malayalam");
});
test("stale password verification cannot create a session after credentials change", async () => {
  const a = accounts.get("bob")!,
    row = await db
      .prepare("SELECT password_hash FROM users WHERE id=?")
      .bind(a.id)
      .first<{ password_hash: string }>();
  await db
    .prepare("UPDATE users SET password_hash=? WHERE id=?")
    .bind("changed-value", a.id)
    .run();
  await assert.rejects(createSession(env, a.id, row!.password_hash));
  await db
    .prepare("UPDATE users SET password_hash=? WHERE id=?")
    .bind(row!.password_hash, a.id)
    .run();
});
test("rename, delete, logout revocation and account deletion remove account data", async () => {
  const list = (await (
    await request("/conversations", "GET", undefined, "alice")
  ).json()) as any[];
  const id = list[0].id;
  assert.equal(
    (
      await request(
        "/conversations/" + id,
        "PATCH",
        { title: "Renamed chat" },
        "alice",
      )
    ).status,
    200,
  );
  assert.equal(
    (await request("/conversations/" + id, "DELETE", {}, "alice")).status,
    200,
  );
  assert.equal(
    (await request("/conversations/" + id, "GET", undefined, "alice")).status,
    404,
  );
  assert.equal((await request("/auth/logout", "POST", {}, "bob")).status, 200);
  assert.equal(
    (await request("/conversations", "GET", undefined, "bob")).status,
    401,
  );
  const deleted = await request(
    "/account",
    "DELETE",
    { password: PASSWORD, confirmation: "DELETE" },
    "alice",
  );
  assert.equal(deleted.status, 200, await deleted.clone().text());
  assert.equal(
    (await request("/conversations", "GET", undefined, "alice")).status,
    401,
  );
  const user = await db
    .prepare("SELECT id FROM users WHERE id=?")
    .bind(accounts.get("alice")!.id)
    .first();
  assert.equal(user, null);
  const count = await db
    .prepare("SELECT count(*) AS n FROM conversations WHERE user_id=?")
    .bind(accounts.get("alice")!.id)
    .first<{ n: number }>();
  assert.equal(count?.n, 0);
});

test("temporary auth diagnostic rejects passwords and cross-origin requests, bounds KDF work, and leaves accounts closed", async () => {
  const before = await db
    .prepare("SELECT COUNT(*) AS count FROM users")
    .first<{ count: number }>();
  assert.equal(
    (await request("/setup/auth-check", "POST", { password: PASSWORD })).status,
    400,
  );
  assert.equal(
    (
      await request("/setup/auth-check", "POST", {}, undefined, {
        Origin: "https://evil.test",
      })
    ).status,
    403,
  );
  const productionRequest = await mf.dispatchFetch(
    "https://example.test/api/setup/auth-check",
    {
      method: "POST",
      headers: {
        Origin: "https://example.test",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({}),
    },
  );
  assert.equal(productionRequest.status, 400);
  assert.match(await productionRequest.text(), /Complete the security check/);
  for (let i = 0; i < 3; i++) {
    const response = await request("/setup/auth-check", "POST", {});
    assert.equal(response.status, 200, await response.clone().text());
    const result = (await response.json()) as any;
    assert.equal(result.hashAndVerifyCompleted, true);
    assert.equal(result.cpuVerified, false);
    assert.ok(!("hash" in result));
    assert.equal(response.headers.get("cache-control"), "no-store");
  }
  assert.equal((await request("/setup/auth-check", "POST", {})).status, 429);
  const after = await db
    .prepare("SELECT COUNT(*) AS count FROM users")
    .first<{ count: number }>();
  assert.equal(before!.count, after!.count);
  const config = await mf.dispatchFetch("https://example.test/api/config");
  const data = (await config.json()) as any;
  assert.equal(data.authReady, false);
  assert.equal(data.registrationEnabled, false);
});
