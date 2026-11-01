import { Buffer } from "node:buffer";
import type { Env } from "./env";
import { HttpError, validatePassword } from "./security";

export type AuthUser = {
  id: string;
  email: string;
  email_confirmed_at?: string;
  is_anonymous?: boolean;
  banned_until?: string;
  user_metadata?: Record<string, unknown>;
};
export type AuthTokens = {
  access_token: string;
  refresh_token: string;
  expires_in: number;
};
export type AuthResult = Partial<AuthTokens> & { user?: AuthUser; id?: string };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const usesSupabase = (env: Env) => env.AUTH_PROVIDER === "supabase";

export function supabaseUrl(env: Env) {
  try {
    const u = new URL(env.SUPABASE_URL || "");
    if (
      u.protocol !== "https:" ||
      !/^[a-z0-9-]+\.supabase\.co$/.test(u.hostname) ||
      u.port ||
      u.username ||
      u.password ||
      u.search ||
      u.hash ||
      u.pathname !== "/"
    )
      return "";
    return u.origin;
  } catch {
    return "";
  }
}
export function supabaseReady(env: Env) {
  return !!(
    supabaseUrl(env) &&
    env.SUPABASE_PUBLISHABLE_KEY &&
    env.SUPABASE_SECRET_KEY &&
    (env.ABUSE_SECRET?.length || 0) >= 32
  );
}
export function subject(env: Env, user: AuthUser) {
  const origin = supabaseUrl(env);
  if (!origin || !UUID.test(user.id))
    throw new HttpError(
      502,
      "The account service returned an invalid identity.",
    );
  return `${origin}|${user.id}`;
}
export function userIdFromSubject(env: Env, value: string) {
  const prefix = `${supabaseUrl(env)}|`;
  if (!value.startsWith(prefix) || !UUID.test(value.slice(prefix.length)))
    throw new HttpError(
      401,
      "Your account service changed. Please sign in again.",
      "unauthorized",
    );
  return value.slice(prefix.length);
}
export function verifiedUser(value: unknown): AuthUser {
  const u = value as AuthUser | undefined;
  if (
    !u ||
    !UUID.test(u.id) ||
    typeof u.email !== "string" ||
    !u.email_confirmed_at ||
    u.is_anonymous ||
    (u.banned_until && Date.parse(u.banned_until) > Date.now())
  )
    throw new HttpError(
      401,
      "Confirm your email address before signing in.",
      "email_not_confirmed",
    );
  return u;
}
export function tokensFrom(result: AuthResult): AuthTokens {
  if (
    typeof result.access_token !== "string" ||
    !result.access_token ||
    typeof result.refresh_token !== "string" ||
    !result.refresh_token ||
    !Number.isFinite(result.expires_in) ||
    result.expires_in! <= 0
  )
    throw new HttpError(
      502,
      "The account service returned an incomplete session.",
    );
  return {
    access_token: result.access_token,
    refresh_token: result.refresh_token,
    expires_in: Math.min(result.expires_in!, 86400),
  };
}
export function providerPassword(value: unknown) {
  const password = validatePassword(value);
  // Supabase bcrypt does not safely distinguish passwords beyond 72 UTF-8 bytes.
  if (new TextEncoder().encode(password).length > 72)
    throw new HttpError(
      400,
      "Use a password of at least 12 characters and at most 72 UTF-8 bytes. Malayalam characters use more than one byte.",
    );
  return password;
}

async function call(
  env: Env,
  path: string,
  method: string,
  body?: unknown,
  access?: string,
  admin = false,
): Promise<any> {
  if (!supabaseReady(env))
    throw new HttpError(
      503,
      "Account services are awaiting Supabase configuration.",
      "setup_required",
    );
  const key = admin ? env.SUPABASE_SECRET_KEY! : env.SUPABASE_PUBLISHABLE_KEY!;
  const headers: Record<string, string> = {
    apikey: key,
    "Content-Type": "application/json",
  };
  if (access) headers.Authorization = `Bearer ${access}`;
  else if (admin && !key.startsWith("sb_secret_"))
    headers.Authorization = `Bearer ${key}`;
  let response: Response;
  try {
    response = await fetch(`${supabaseUrl(env)}/auth/v1${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(12_000),
      redirect: "manual",
    });
  } catch {
    throw new HttpError(
      503,
      "The account service is temporarily unavailable. Please try again.",
      "auth_unavailable",
    );
  }
  if (response.status >= 300 && response.status < 400)
    throw new HttpError(
      503,
      "The account service returned an unexpected redirect.",
      "auth_unavailable",
    );
  const data: any = await response.json().catch(() => ({}));
  if (response.ok) return data;
  if (admin && method === "DELETE" && response.status === 404) return {};
  const code = String(data.code || data.error_code || data.error || "");
  if (response.status === 429)
    throw new HttpError(
      429,
      "Too many account requests. Please try again later.",
      "throttled",
    );
  if (code === "email_not_confirmed")
    throw new HttpError(
      401,
      "Confirm your email address before signing in.",
      code,
    );
  if (
    code === "email_address_not_authorized" ||
    (code === "unexpected_failure" &&
      (path === "/signup" || path === "/recover"))
  )
    throw new HttpError(
      503,
      "Email delivery is not ready. Please contact the site owner.",
      "email_unavailable",
    );
  if (response.status >= 500)
    throw new HttpError(
      503,
      "The account service is temporarily unavailable. Please try again.",
      "auth_unavailable",
    );
  if (code === "weak_password" || code === "same_password")
    throw new HttpError(
      400,
      "Choose a different, stronger password.",
      "weak_password",
    );
  if (admin && response.status === 404)
    throw new HttpError(401, "Your account no longer exists.", "unauthorized");
  if (admin)
    throw new HttpError(
      503,
      "Account administration is unavailable. Please contact the site owner.",
      "auth_unavailable",
    );
  // Never forward arbitrary provider messages, token data or request contents.
  throw new HttpError(
    401,
    "The credentials or verification code are invalid or expired.",
    "invalid_credentials",
  );
}
export const signIn = (env: Env, email: string, password: string) =>
  call(env, "/token?grant_type=password", "POST", {
    email,
    password,
  }) as Promise<AuthResult>;
export const signUp = (
  env: Env,
  email: string,
  password: string,
  name: string,
) =>
  call(env, "/signup", "POST", {
    email,
    password,
    data: { name },
  }) as Promise<AuthResult>;
export const refreshTokens = (env: Env, refresh_token: string) =>
  call(env, "/token?grant_type=refresh_token", "POST", {
    refresh_token,
  }) as Promise<AuthResult>;
export const getAuthUser = async (env: Env, access: string) =>
  verifiedUser(await call(env, "/user", "GET", undefined, access));
export const updatePassword = (
  env: Env,
  access: string,
  password: string,
  current_password?: string,
) =>
  call(
    env,
    "/user",
    "PUT",
    { password, ...(current_password ? { current_password } : {}) },
    access,
  );
export const deleteAuthUser = (env: Env, id: string) => {
  if (!UUID.test(id)) throw new HttpError(400, "Invalid account.");
  return call(
    env,
    `/admin/users/${id}`,
    "DELETE",
    { should_soft_delete: false },
    undefined,
    true,
  );
};
export const sendRecovery = (env: Env, email: string) =>
  call(env, "/recover", "POST", { email });
export const verifyEmailCode = (
  env: Env,
  email: string,
  token: string,
  type: "signup" | "recovery",
) =>
  call(env, "/verify", "POST", { email, token, type }) as Promise<AuthResult>;
export async function revokeProviderSession(
  env: Env,
  access: string,
  scope: "local" | "global" = "local",
) {
  await call(env, `/logout?scope=${scope}`, "POST", undefined, access);
}

// Tokens stay server-side, encrypted with a purpose-separated AES-GCM key.
// AAD binds each ciphertext to its project, D1 user and opaque session hash.
async function encryptionKey(env: Env) {
  if ((env.ABUSE_SECRET?.length || 0) < 32)
    throw new HttpError(503, "Secure session configuration is incomplete.");
  const raw = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(
      JSON.stringify(["ZYRA/provider-session/v1", env.ABUSE_SECRET]),
    ),
  );
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, [
    "encrypt",
    "decrypt",
  ]);
}
export async function sealTokens(env: Env, value: AuthTokens, binding: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv,
      additionalData: new TextEncoder().encode(
        `${supabaseUrl(env)}|${binding}`,
      ),
    },
    await encryptionKey(env),
    new TextEncoder().encode(JSON.stringify(value)),
  );
  return `v1.${Buffer.from(iv).toString("base64url")}.${Buffer.from(encrypted).toString("base64url")}`;
}
export async function openTokens(
  env: Env,
  value: string,
  binding: string,
): Promise<AuthTokens> {
  try {
    const [version, iv, payload, extra] = value.split(".");
    if (version !== "v1" || !iv || !payload || extra) throw new Error();
    const plain = await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: Buffer.from(iv, "base64url"),
        additionalData: new TextEncoder().encode(
          `${supabaseUrl(env)}|${binding}`,
        ),
      },
      await encryptionKey(env),
      Buffer.from(payload, "base64url"),
    );
    return tokensFrom(JSON.parse(new TextDecoder().decode(plain)));
  } catch {
    throw new HttpError(
      401,
      "Your session expired. Please sign in again.",
      "unauthorized",
    );
  }
}
