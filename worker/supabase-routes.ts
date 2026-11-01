import type { Env } from "./env";
import { defaultSettings } from "../shared/types";
import { createSession, publicUser, sessionCookie, type UserRow } from "./auth";
import {
  HttpError,
  digest,
  ipHash,
  randomToken,
  rateLimit,
  readJson,
  stringField,
  verifyChallenge,
} from "./security";
import { usage } from "./quotas";
import * as auth from "./supabase";

export async function supabaseAuthRoute(
  request: Request,
  env: Env,
  config: {
    authReady: boolean;
    registrationEnabled: boolean;
    recoveryAvailable: boolean;
  },
): Promise<Response> {
  if (!config.authReady)
    throw new HttpError(
      503,
      "Sign-in is awaiting Supabase configuration.",
      "setup_required",
    );
  const action = new URL(request.url).pathname.split("/").pop()!;
  if (!["login", "register", "verify", "recover", "reset"].includes(action))
    throw new HttpError(404, "Endpoint not found.");
  if (
    (action === "register" || action === "verify") &&
    !config.registrationEnabled
  )
    throw new HttpError(
      503,
      "New registrations will open when email delivery is configured.",
      "setup_required",
    );
  if ((action === "recover" || action === "reset") && !config.recoveryAvailable)
    throw new HttpError(
      503,
      "Email recovery is not configured on this deployment.",
      "email_unavailable",
    );
  const body = await readJson(request, 8000),
    ip = await ipHash(request, env);
  await rateLimit(env, `auth-ip:${ip}`, 10, 900);
  const email = stringField(body.email, 254, "email address").toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    throw new HttpError(400, "Enter a valid email address.");
  await rateLimit(env, `auth-email:${await digest(email)}`, 10, 900);
  await verifyChallenge(request, env, body.turnstileToken, action);
  const before = await env.DB.prepare(
    "SELECT id,password_hash FROM users WHERE email=?",
  )
    .bind(email)
    .first<{ id: string; password_hash: string }>();
  if (action === "recover") {
    await rateLimit(env, "recovery-global", 50, 86400);
    try {
      await auth.sendRecovery(env, email);
    } catch (e) {
      if (!(e instanceof HttpError) || e.status !== 401) throw e;
    }
    return Response.json({
      next: "reset",
      message:
        "If this email has an account, a recovery code has been requested. Check your inbox and spam folder.",
    });
  }
  let result: auth.AuthResult;
  if (action === "register") {
    if (body.consent !== true)
      throw new HttpError(
        400,
        "Read and accept the privacy information to continue.",
      );
    await rateLimit(env, `signup:${ip}`, 3, 86400);
    await rateLimit(env, "global-signup", 50, 86400);
    result = await auth.signUp(
      env,
      email,
      auth.providerPassword(body.password),
      stringField(body.name, 60, "display name"),
    );
    // With email confirmation enabled, signup returns no session (including existing-email decoys).
    if (!result.access_token)
      return Response.json(
        {
          next: "verify",
          message:
            "Check your email for a confirmation code. If you already have an account, sign in or reset your password.",
        },
        { status: 202 },
      );
  } else if (action === "verify" || action === "reset") {
    const code = stringField(body.code, 10, "verification code");
    if (!/^\d{6,10}$/.test(code))
      throw new HttpError(400, "Enter the verification code from your email.");
    // Validate before consuming a single-use recovery code.
    if (action === "reset") auth.providerPassword(body.newPassword);
    result = await auth.verifyEmailCode(
      env,
      email,
      code,
      action === "verify" ? "signup" : "recovery",
    );
  } else {
    result = await auth.signIn(
      env,
      email,
      auth.providerPassword(body.password),
    );
  }
  const tokens = auth.tokensFrom(result);
  let keep = false;
  try {
    const identity = await auth.getAuthUser(env, tokens.access_token);
    if (identity.email.toLowerCase() !== email)
      throw new HttpError(401, "Account identity could not be verified.");
    const key = auth.subject(env, identity);
    if (
      await env.DB.prepare(
        "SELECT user_id FROM auth_deletions WHERE auth_subject=?",
      )
        .bind(key)
        .first()
    )
      throw new HttpError(
        401,
        "This account has been deleted or is awaiting deletion.",
        "unauthorized",
      );
    if (action === "reset") {
      await auth.updatePassword(
        env,
        tokens.access_token,
        auth.providerPassword(body.newPassword),
      );
      await env.DB.batch([
        env.DB.prepare(
          "UPDATE users SET password_hash=? WHERE auth_subject=?",
        ).bind(`external$${randomToken()}`, key),
        env.DB.prepare(
          "DELETE FROM sessions WHERE user_id IN(SELECT id FROM users WHERE auth_subject=?)",
        ).bind(key),
      ]);
      await auth
        .revokeProviderSession(env, tokens.access_token, "global")
        .catch(() => {});
      return Response.json(
        {
          next: "login",
          message:
            "Your password has been updated. Sign in with your new password.",
        },
        { headers: { "Set-Cookie": sessionCookie(request, env, "", true) } },
      );
    }
    let row = await env.DB.prepare("SELECT * FROM users WHERE auth_subject=?")
      .bind(key)
      .first<UserRow>();
    if (!row) {
      if (!config.registrationEnabled)
        throw new HttpError(403, "New registrations are currently closed.");
      if (body.consent !== true)
        throw new HttpError(
          400,
          "Accept the privacy information to finish creating your account.",
          "consent_required",
        );
      await rateLimit(env, `new-profile:${ip}`, 3, 86400);
      await rateLimit(env, "new-profile-global", 50, 86400);
      // Email is NOT an identity key. Existing local accounts require an explicit migration.
      const existing = await env.DB.prepare(
        "SELECT id FROM users WHERE email=?",
      )
        .bind(email)
        .first();
      if (existing)
        throw new HttpError(
          409,
          "This email belongs to an existing ZYRA account. Contact the owner to migrate it; existing chats have not been changed.",
          "identity_conflict",
        );
      const displayName =
        typeof identity.user_metadata?.name === "string"
          ? identity.user_metadata.name.trim().slice(0, 60)
          : "ZYRA user";
      row = {
        id: crypto.randomUUID(),
        email,
        name: displayName || "ZYRA user",
        password_hash: `external$${randomToken()}`,
        auth_subject: key,
        settings: JSON.stringify(defaultSettings),
        created_at: Date.now(),
        consent_at: Date.now(),
      };
      try {
        const inserted = await env.DB.prepare(
          "INSERT INTO users(id,email,name,password_hash,auth_subject,settings,created_at,consent_at) SELECT ?,?,?,?,?,?,?,? WHERE NOT EXISTS(SELECT 1 FROM auth_deletions WHERE auth_subject=?) RETURNING id",
        )
          .bind(
            row.id,
            row.email,
            row.name,
            row.password_hash,
            key,
            row.settings,
            row.created_at,
            row.consent_at,
            key,
          )
          .first();
        if (!inserted)
          throw new HttpError(401, "This account is awaiting deletion.");
      } catch {
        // Concurrent first logins may create the same immutable identity. Never resolve by email.
        row = await env.DB.prepare("SELECT * FROM users WHERE auth_subject=?")
          .bind(key)
          .first<UserRow>();
        if (!row)
          throw new HttpError(
            409,
            "Your account could not be linked. Please contact the site owner.",
            "identity_conflict",
          );
      }
    }
    if (row.email !== email)
      throw new HttpError(
        409,
        "Your email changed at the account provider. Contact the owner to update the account mapping.",
        "identity_conflict",
      );
    if (
      before &&
      before.id === row.id &&
      before.password_hash !== row.password_hash
    )
      throw new HttpError(
        409,
        "Your credentials changed during sign-in. Please sign in again.",
      );
    const session = await createSession(env, row.id, row.password_hash, tokens);
    keep = true;
    return Response.json(
      {
        user: publicUser(row),
        csrf: session.csrf,
        usage: await usage(env, row.id),
      },
      {
        status: action === "register" ? 201 : 200,
        headers: { "Set-Cookie": sessionCookie(request, env, session.token) },
      },
    );
  } finally {
    if (!keep)
      await auth
        .revokeProviderSession(env, tokens.access_token)
        .catch(() => {});
  }
}

export async function reauthenticate(
  env: Env,
  row: UserRow,
  password: unknown,
) {
  if (!row.auth_subject) throw new HttpError(401, "Please sign in again.");
  const result = await auth.signIn(
    env,
    row.email,
    auth.providerPassword(password),
  );
  const tokens = auth.tokensFrom(result);
  try {
    const user = await auth.getAuthUser(env, tokens.access_token);
    if (auth.subject(env, user) !== row.auth_subject)
      throw new HttpError(401, "Current password could not be verified.");
    return tokens;
  } catch (e) {
    await auth.revokeProviderSession(env, tokens.access_token).catch(() => {});
    throw e;
  }
}
