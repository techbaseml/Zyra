import test from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import Markdown from "../src/components/Markdown";
import {
  hashPassword,
  verifyPassword,
  validatePassword,
  validateOrigin,
  readJson,
} from "../worker/security";
import { sessionCookie } from "../worker/auth";
import { appConfig } from "../worker/index";
import type { Env } from "../worker/env";
test("strong scrypt password hashes are salted, verifiable and never plaintext", async () => {
  const a = await hashPassword("correct horse battery staple"),
    b = await hashPassword("correct horse battery staple");
  assert.notEqual(a, b);
  assert.match(a, /^scrypt\$16384\$8\$5\$/);
  assert.ok(!a.includes("correct horse"));
  assert.equal(await verifyPassword("correct horse battery staple", a), true);
  assert.equal(await verifyPassword("wrong password!", a), false);
});
test("password length, origin, content-type and streamed size guards reject bad requests", async () => {
  assert.throws(() => validatePassword("short"));
  assert.throws(() => validatePassword("x".repeat(129)));
  assert.throws(() =>
    validateOrigin(
      new Request("https://zyra.example/api/chat", {
        method: "POST",
        headers: {
          Origin: "https://evil.example",
          "Content-Type": "application/json",
        },
      }),
    ),
  );
  assert.throws(() =>
    validateOrigin(
      new Request("https://zyra.example/api/chat", {
        method: "POST",
        headers: {
          Origin: "https://zyra.example",
          "Content-Type": "text/plain",
        },
      }),
    ),
  );
  await assert.rejects(
    readJson(
      new Request("https://zyra.example", {
        method: "POST",
        body: "x".repeat(500),
      }),
      100,
    ),
  );
});
test("production sessions require secure host-only cookies and auth fails closed", () => {
  const request = new Request("https://zyra.example");
  const env = {} as Env;
  const cookie = sessionCookie(request, env, "opaque-token");
  assert.match(cookie, /__Host-zyra_session/);
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /; Secure/);
  assert.ok(!cookie.includes("Domain="));
  assert.equal(appConfig(request, env).authReady, false);
  assert.equal(
    appConfig(request, { ...env, APP_ENV: "development" }).authReady,
    false,
  );
});
test("Markdown blocks HTML, executable URL schemes and remote image tracking", () => {
  const html = renderToStaticMarkup(
    React.createElement(Markdown, {
      text: "<script>alert(1)</script>\n\n[click](javascript:alert(1))\n\n![pixel](https://tracker.invalid/image.png)\n\n```html\n<script>alert(2)</script>\n```",
    }),
  );
  assert.ok(!html.includes("<script>"));
  assert.ok(!html.includes('href="javascript:'));
  assert.ok(!html.includes("<img"));
  assert.ok(html.includes("remote images are not loaded"));
  assert.ok(html.includes("&lt;"));
});
