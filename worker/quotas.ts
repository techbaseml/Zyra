import { FREE_LIMIT_MESSAGE } from "../shared/types";
import type { Env } from "./env";
import { integerSetting } from "./env";
import { HttpError } from "./security";
export const dayKey = () => new Date().toISOString().slice(0, 10);
export function limits(env: Env) {
  return {
    user: integerSetting(env.DAILY_USER_LIMIT, 20, 100),
    global: integerSetting(env.DAILY_GLOBAL_LIMIT, 200, 10000),
    ip: integerSetting(env.DAILY_IP_LIMIT, 40, 200),
    tokens: integerSetting(env.DAILY_TOKEN_BUDGET, 150000, 200000),
    minute: integerSetting(env.MINUTE_TOKEN_BUDGET, 8000, 8000),
  };
}
export async function reserveQuota(
  env: Env,
  userId: string,
  ip: string,
  requestId: string,
  budget: number,
) {
  const l = limits(env),
    day = dayKey(),
    now = Date.now();
  // A single SQLite statement serializes checks and insertion, including concurrent users.
  const result = await env.DB.prepare(
    `INSERT INTO usage_events(id,user_id,ip_hash,day,budget,created_at)
    SELECT ?,?,?,?,?,? WHERE
    (SELECT count(*) FROM usage_events WHERE user_id=? AND day=?)<? AND
    (SELECT count(*) FROM usage_events WHERE day=?)<? AND
    (SELECT count(*) FROM usage_events WHERE ip_hash=? AND day=?)<? AND
    (SELECT coalesce(sum(budget),0) FROM usage_events WHERE day=?)+?<=? AND
    (SELECT coalesce(sum(budget),0) FROM usage_events WHERE created_at>?)+?<=? RETURNING id`,
  )
    .bind(
      requestId,
      userId,
      ip,
      day,
      budget,
      now,
      userId,
      day,
      l.user,
      day,
      l.global,
      ip,
      day,
      l.ip,
      day,
      budget,
      l.tokens,
      now - 60000,
      budget,
      l.minute,
    )
    .first();
  if (!result) throw new HttpError(429, FREE_LIMIT_MESSAGE, "usage_limit");
}
export async function usage(env: Env, userId: string) {
  const row = await env.DB.prepare(
    "SELECT count(*) AS used FROM usage_events WHERE user_id=? AND day=?",
  )
    .bind(userId, dayKey())
    .first<{ used: number }>();
  const next = new Date();
  next.setUTCHours(24, 0, 0, 0);
  return {
    used: row?.used || 0,
    limit: limits(env).user,
    resetsAt: next.toISOString(),
  };
}
export async function reserveProviderBudget(
  env: Env,
  provider: string,
  budget: number,
) {
  const l = limits(env),
    now = Date.now(),
    day = dayKey();
  // Keep reservations through the 100s request deadline plus another 60s.
  const row = await env.DB.prepare(
    `INSERT INTO provider_usage(id,provider,day,budget,created_at) SELECT ?,?,?,?,? WHERE (SELECT coalesce(sum(budget),0) FROM provider_usage WHERE provider=? AND day=?)+?<=? AND (SELECT coalesce(sum(budget),0) FROM provider_usage WHERE provider=? AND created_at>?)+?<=? RETURNING id`,
  )
    .bind(
      crypto.randomUUID(),
      provider,
      day,
      budget,
      now,
      provider,
      day,
      budget,
      l.tokens,
      provider,
      now - 160000,
      budget,
      l.minute,
    )
    .first();
  if (!row) throw new HttpError(429, FREE_LIMIT_MESSAGE, "usage_limit");
}
