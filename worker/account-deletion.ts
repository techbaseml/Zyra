import type { Env } from "./env";
import { deleteAuthUser, supabaseReady, userIdFromSubject } from "./supabase";

export async function finishDeletion(
  env: Env,
  userId: string,
  subject: string,
) {
  await deleteAuthUser(env, userIdFromSubject(env, subject));
  await env.DB.batch([
    env.DB.prepare("DELETE FROM users WHERE id=? AND auth_subject=?").bind(
      userId,
      subject,
    ),
    env.DB.prepare(
      "UPDATE auth_deletions SET completed_at=? WHERE auth_subject=? AND user_id=?",
    ).bind(Date.now(), subject, userId),
  ]);
}
export async function retryDeletions(env: Env) {
  if (!supabaseReady(env)) return;
  const jobs = await env.DB.prepare(
    "SELECT user_id,auth_subject FROM auth_deletions WHERE completed_at IS NULL ORDER BY requested_at LIMIT 10",
  ).all<{ user_id: string; auth_subject: string }>();
  for (const job of jobs.results) {
    try {
      await finishDeletion(env, job.user_id, job.auth_subject);
    } catch {
      /* Leave the durable job for the next scheduled retry. Never log credentials. */
    }
  }
  await env.DB.prepare("DELETE FROM auth_deletions WHERE completed_at<?")
    .bind(Date.now() - 7 * 86400_000)
    .run();
}
