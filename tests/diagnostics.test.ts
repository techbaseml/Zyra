import { test } from "node:test";
import assert from "node:assert/strict";
import { authCheckOpen, runAuthCheck } from "../worker/diagnostics";
import type { Env } from "../worker/env";

test("diagnostic fails closed without a valid, bounded future expiry", async () => {
  const now = 1_000_000;
  for (const expiry of [
    undefined,
    "",
    "true",
    "NaN",
    "Infinity",
    String(now),
    String(now - 1),
    String(now + 86400_001),
  ]) {
    assert.equal(
      authCheckOpen({ AUTH_CHECK_EXPIRES_AT: expiry } as Env, now),
      false,
    );
  }
  assert.equal(
    authCheckOpen(
      { AUTH_CHECK_EXPIRES_AT: String(now + 3600_000) } as Env,
      now,
    ),
    true,
  );
  await assert.rejects(
    runAuthCheck(
      new Request("https://example.test/api/setup/auth-check", {
        method: "POST",
      }),
      {} as Env,
    ),
    (error: any) => error.status === 404,
  );
});
