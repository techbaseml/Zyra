export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  APP_ENV?: string;
  GROQ_API_KEY?: string;
  GEMINI_API_KEY?: string;
  GROQ_MODEL?: string;
  GEMINI_MODEL?: string;
  FREE_TIER_CONFIRMED?: string;
  DAILY_USER_LIMIT?: string;
  DAILY_GLOBAL_LIMIT?: string;
  DAILY_IP_LIMIT?: string;
  DAILY_TOKEN_BUDGET?: string;
  MINUTE_TOKEN_BUDGET?: string;
  REGISTRATION_ENABLED?: string;
  AUTH_CPU_VERIFIED?: string;
  AUTH_CHECK_EXPIRES_AT?: string;
  TURNSTILE_SITE_KEY?: string;
  TURNSTILE_SECRET_KEY?: string;
  ABUSE_SECRET?: string;
}
export function localDevelopment(request: Request, env: Env) {
  return (
    env.APP_ENV === "development" &&
    ["localhost", "127.0.0.1", "terminal.local"].includes(
      new URL(request.url).hostname,
    )
  );
}
export function integerSetting(
  value: string | undefined,
  fallback: number,
  max: number,
) {
  const n = Number(value);
  return Number.isSafeInteger(n) && n > 0 ? Math.min(n, max) : fallback;
}
