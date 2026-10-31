import type { Env } from "./env";
import {
  HttpError,
  hashPassword,
  verifyPassword,
  randomToken,
  ipHash,
  rateLimit,
  readJson,
  verifyChallenge,
} from "./security";

// Temporary, bounded deployment diagnostic. It never opens registration,
// changes an account, receives a password, or calls an AI provider.
export function authCheckOpen(env: Env, now = Date.now()) {
  const until = Number(env.AUTH_CHECK_EXPIRES_AT);
  return (
    Number.isSafeInteger(until) && until > now && until <= now + 24 * 3600_000
  );
}
export function authCheckConfig(env: Env) {
  return {
    enabled: authCheckOpen(env),
    ready: !!(
      env.TURNSTILE_SITE_KEY &&
      env.TURNSTILE_SECRET_KEY &&
      env.ABUSE_SECRET &&
      env.ABUSE_SECRET.length >= 32
    ),
    expiresAt: Number(env.AUTH_CHECK_EXPIRES_AT) || null,
  };
}
export async function runAuthCheck(request: Request, env: Env) {
  if (!authCheckOpen(env))
    throw new HttpError(404, "This temporary check is closed.");
  if (!authCheckConfig(env).ready)
    throw new HttpError(
      503,
      "Check TURNSTILE_SITE_KEY, TURNSTILE_SECRET_KEY and ABUSE_SECRET (at least 32 characters) in this Worker's production settings.",
    );
  const body = await readJson(request, 4000);
  if (Object.keys(body).some((key) => key !== "turnstileToken"))
    throw new HttpError(
      400,
      "Only the security-check token is accepted. Do not submit a password or API key.",
    );
  const ip = await ipHash(request, env);
  await rateLimit(env, `auth-check-ip:${ip}`, 5, 900);
  await verifyChallenge(request, env, body.turnstileToken, "auth_check");
  // One atomic D1 counter bounds all KDF work, including simultaneous requests.
  await rateLimit(env, "auth-check-global", 3, 86400);
  const sample = randomToken();
  const hash = await hashPassword(sample);
  const valid = await verifyPassword(sample, hash);
  if (!valid)
    throw new HttpError(
      500,
      "Password hash verification did not complete correctly.",
    );
  console.info(
    "ZYRA_AUTH_CHECK: hash and verification completed; review invocation CPU time before enabling accounts.",
  );
  return Response.json({
    hashAndVerifyCompleted: true,
    cpuVerified: false,
    note: "This tests the deployed password functions using generated data. It does not measure CPU time or approve account setup. Review this invocation's Cloudflare CPU time and then test full account flows.",
  });
}
