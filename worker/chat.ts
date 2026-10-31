import type { Env } from "./env";
import type { Message } from "../shared/types";
import { HttpError, ipHash, rateLimit, stringField } from "./security";
import {
  boundedContext,
  generate,
  ProviderError,
  systemPrompt,
} from "./providers";
import { reserveProviderBudget, reserveQuota } from "./quotas";
import type { getSession } from "./auth";
type Session = NonNullable<Awaited<ReturnType<typeof getSession>>>;
export async function ownedConversation(env: Env, id: string, userId: string) {
  const row = await env.DB.prepare(
    "SELECT id,title,created_at,updated_at FROM conversations WHERE id=? AND user_id=?",
  )
    .bind(id, userId)
    .first();
  if (!row) throw new HttpError(404, "Conversation not found.");
  return row;
}
export async function assertNotGenerating(env: Env, userId: string) {
  const lock = await env.DB.prepare(
    "SELECT request_id FROM generation_locks WHERE user_id=? AND expires_at>?",
  )
    .bind(userId, Date.now())
    .first();
  if (lock)
    throw new HttpError(
      409,
      "Wait for the current response to finish, or stop it first.",
      "generation_active",
    );
}
export async function withMutationLock<T>(
  env: Env,
  userId: string,
  operation: () => Promise<T>,
): Promise<T> {
  const id = crypto.randomUUID(),
    now = Date.now();
  const row = await env.DB.prepare(
    `INSERT INTO generation_locks(user_id,request_id,conversation_id,expires_at,cancelled) VALUES(?,?,'mutation',?,0) ON CONFLICT(user_id) DO UPDATE SET request_id=excluded.request_id,conversation_id='mutation',expires_at=excluded.expires_at,cancelled=0 WHERE generation_locks.expires_at<=? RETURNING request_id`,
  )
    .bind(userId, id, now + 30000, now)
    .first();
  if (!row)
    throw new HttpError(
      409,
      "Wait for the current request to finish, or stop it first.",
      "generation_active",
    );
  try {
    return await operation();
  } finally {
    await env.DB.prepare("DELETE FROM generation_locks WHERE request_id=?")
      .bind(id)
      .run();
  }
}
export async function chat(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  session: Session,
  body: Record<string, unknown>,
) {
  if (env.FREE_TIER_CONFIRMED !== "true" || !env.GROQ_API_KEY)
    throw new HttpError(
      503,
      "ZYRA is awaiting its secure AI connection. Please try again after the owner completes setup.",
      "setup_required",
    );
  const requestId = stringField(body.requestId, 36, "request identifier");
  if (!/^[0-9a-f-]{36}$/i.test(requestId))
    throw new HttpError(400, "Invalid request identifier.");
  const mode = body.mode || "send";
  if (!["send", "edit", "regenerate"].includes(String(mode)))
    throw new HttpError(400, "Invalid action.");
  let convId =
    typeof body.conversationId === "string" ? body.conversationId : null;
  const content =
    mode === "regenerate" ? "" : stringField(body.content, 4000, "message");
  const attachment = body.attachment as
    | { name?: unknown; text?: unknown }
    | undefined;
  let attachmentName: string | null = null,
    attachmentText = "";
  if (attachment) {
    attachmentName = stringField(attachment.name, 100, "filename");
    attachmentText = stringField(attachment.text, 6000, "text attachment");
    if (
      !/\.(txt|md|csv|json|py|js|ts|tsx|jsx|css|html|xml|log|yaml|yml)$/i.test(
        attachmentName,
      )
    )
      throw new HttpError(
        400,
        "Only plain-text and source-code attachments are supported.",
      );
  }
  const prompt =
    content +
    (attachmentText
      ? `\n\n[Attached text: ${attachmentName}]\n${attachmentText}\n[End attached text]`
      : "");
  if (new TextEncoder().encode(prompt).length > 12_000)
    throw new HttpError(
      413,
      "Shorten this message or attachment to under 12 KB.",
    );
  if (convId) await ownedConversation(env, convId, session.user.id);
  if (!convId && mode !== "send")
    throw new HttpError(400, "Choose a conversation first.");
  if (
    await env.DB.prepare("SELECT id FROM usage_events WHERE id=?")
      .bind(requestId)
      .first()
  )
    throw new HttpError(
      409,
      "This request was already submitted. Reload the conversation.",
      "duplicate_request",
    );
  await rateLimit(env, `chat:${session.user.id}`, 6, 60);
  const now = Date.now(),
    id = convId || crypto.randomUUID();
  const acquired = await env.DB.prepare(
    `INSERT INTO generation_locks(user_id,request_id,conversation_id,expires_at,cancelled) VALUES(?,?,?,?,0) ON CONFLICT(user_id) DO UPDATE SET request_id=excluded.request_id,conversation_id=excluded.conversation_id,expires_at=excluded.expires_at,cancelled=0 WHERE generation_locks.expires_at<=? RETURNING request_id`,
  )
    .bind(session.user.id, requestId, id, now + 120_000, now)
    .first();
  if (!acquired)
    throw new HttpError(
      409,
      "A response is already being generated.",
      "generation_active",
    );
  let history: Message[] = [],
    assistantId = crypto.randomUUID(),
    userId = crypto.randomUUID(),
    seq = 0;
  let turns: { role: "user" | "assistant"; content: string }[] = [],
    tokenBudget = 0;
  try {
    if (convId)
      history = (
        await env.DB.prepare(
          "SELECT * FROM messages WHERE conversation_id=? ORDER BY seq",
        )
          .bind(convId)
          .all<Message>()
      ).results;
    if (history.length >= 200 && mode === "send")
      throw new HttpError(
        400,
        "This conversation has reached 100 turns. Start a new chat.",
      );
    let cutSeq: number | null = null;
    if (mode === "edit") {
      const edited = history.find(
        (m) => m.id === body.messageId && m.role === "user",
      );
      if (!edited) throw new HttpError(404, "Message not found.");
      cutSeq = edited.seq;
      history = history.filter((m) => m.seq < edited.seq);
    } else if (mode === "regenerate") {
      const lastUser = [...history].reverse().find((m) => m.role === "user");
      if (!lastUser)
        throw new HttpError(400, "There is no question to regenerate.");
      cutSeq = lastUser.seq + 1;
      history = history.filter((m) => m.seq <= lastUser.seq);
    }
    seq = history.length ? history[history.length - 1].seq + 1 : 0;
    turns = history
      .filter((m) => m.status === "complete")
      .map((m) => ({ role: m.role, content: m.content }));
    if (mode !== "regenerate") turns.push({ role: "user", content: prompt });
    // UTF-8 byte count is a conservative tokenizer-independent bound. Oldest pairs are removed.
    const output =
      session.user.settings.responseLength === "detailed"
        ? 4096
        : session.user.settings.responseLength === "concise"
          ? 1536
          : 3072;
    const systemBytes = new TextEncoder().encode(
      systemPrompt(session.user.settings),
    ).length;
    const contextBudget = Math.max(1000, 7800 - output - systemBytes - 256);
    const last = turns.at(-1)!;
    if (new TextEncoder().encode(last.content).length + 64 > contextBudget)
      throw new HttpError(
        413,
        "This question and attachment are too long for the free AI budget. Shorten them, or select a shorter response length.",
      );
    turns = boundedContext(turns, contextBudget);
    const budget =
      new TextEncoder().encode(turns.map((t) => t.content).join("")).length +
      systemBytes +
      output +
      256 +
      turns.length * 64;
    tokenBudget = budget;
    await reserveQuota(
      env,
      session.user.id,
      await ipHash(request, env),
      requestId,
      budget,
    );
    const statements: D1PreparedStatement[] = [];
    if (!convId) {
      const count = await env.DB.prepare(
        "SELECT count(*) AS n FROM conversations WHERE user_id=?",
      )
        .bind(session.user.id)
        .first<{ n: number }>();
      if ((count?.n || 0) >= 200)
        throw new HttpError(
          400,
          "You have 200 conversations. Export or delete an older chat to make room.",
        );
      statements.push(
        env.DB.prepare(
          "INSERT INTO conversations(id,user_id,title,created_at,updated_at) VALUES(?,?,?,?,?)",
        ).bind(
          id,
          session.user.id,
          [...content.replace(/\s+/g, " ")].slice(0, 64).join(""),
          now,
          now,
        ),
      );
    }
    if (cutSeq !== null)
      statements.push(
        env.DB.prepare(
          "DELETE FROM messages WHERE conversation_id=? AND seq>=?",
        ).bind(id, cutSeq),
      );
    if (mode !== "regenerate") {
      statements.push(
        env.DB.prepare(
          "INSERT INTO messages(id,conversation_id,role,content,status,created_at,seq,attachment_name) VALUES(?,?,?,?,?,?,?,?)",
        ).bind(
          userId,
          id,
          "user",
          prompt,
          "complete",
          now,
          seq++,
          attachmentName,
        ),
      );
    }
    statements.push(
      env.DB.prepare(
        "UPDATE conversations SET updated_at=? WHERE id=? AND user_id=?",
      ).bind(now, id, session.user.id),
    );
    await env.DB.batch(statements);
  } catch (e) {
    await env.DB.prepare("DELETE FROM generation_locks WHERE request_id=?")
      .bind(requestId)
      .run();
    throw e;
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort("timeout"), 100_000);
  const abortRequest = () => controller.abort("client_disconnect");
  request.signal.addEventListener("abort", abortRequest, { once: true });
  if (request.signal.aborted) abortRequest();
  let polling = false;
  const cancelPoll = setInterval(async () => {
    if (polling || controller.signal.aborted) return;
    polling = true;
    try {
      const lock = await env.DB.prepare(
        "SELECT cancelled FROM generation_locks WHERE request_id=?",
      )
        .bind(requestId)
        .first<{ cancelled: number }>();
      if (!lock || lock.cancelled) controller.abort("cancelled");
    } catch {
      controller.abort("storage_unavailable");
    } finally {
      polling = false;
    }
  }, 5000);
  let closed = false,
    answer = "",
    status: Message["status"] = "complete";
  let resolveTask: () => void = () => {};
  const task = new Promise<void>((resolve) => {
    resolveTask = resolve;
  });
  const stream = new ReadableStream<Uint8Array>({
    start(out) {
      const emit = (event: string, data: unknown) => {
        if (!closed)
          try {
            out.enqueue(
              new TextEncoder().encode(
                `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`,
              ),
            );
          } catch {
            closed = true;
            controller.abort("client_disconnect");
          }
      };
      emit("meta", { conversationId: id, requestId, assistantId });
      (async () => {
        try {
          for await (const delta of generate(
            env,
            turns,
            session.user.settings,
            controller.signal,
            fetch,
            (name) => reserveProviderBudget(env, name, tokenBudget),
          )) {
            if (controller.signal.aborted) throw new Error("cancelled");
            answer += delta;
            if (answer.length > 60_000) {
              controller.abort("output_limit");
              throw new Error("output_limit");
            }
            emit("delta", { text: delta });
          }
        } catch (e) {
          status = answer ? "interrupted" : "error";
          if (!closed)
            emit("error", {
              message: controller.signal.aborted
                ? controller.signal.reason === "timeout"
                  ? "The response timed out. You can try again."
                  : "Response stopped."
                : e instanceof ProviderError || e instanceof HttpError
                  ? e.message
                  : "The response could not be completed. Please try again.",
              partial: !!answer,
            });
        } finally {
          clearTimeout(timeout);
          clearInterval(cancelPoll);
          request.signal.removeEventListener("abort", abortRequest);
          try {
            await env.DB.prepare(
              "INSERT INTO messages(id,conversation_id,role,content,status,created_at,seq) SELECT ?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM conversations WHERE id=? AND user_id=?)",
            )
              .bind(
                assistantId,
                id,
                "assistant",
                answer,
                status,
                Date.now(),
                seq,
                id,
                session.user.id,
              )
              .run();
            await env.DB.prepare(
              "UPDATE conversations SET updated_at=? WHERE id=? AND user_id=?",
            )
              .bind(Date.now(), id, session.user.id)
              .run();
            emit("done", { conversationId: id, status });
          } catch {
            emit("error", {
              message:
                "This response could not be saved. Copy it before leaving this page.",
              partial: !!answer,
            });
          }
          try {
            await env.DB.prepare(
              "DELETE FROM generation_locks WHERE request_id=?",
            )
              .bind(requestId)
              .run();
          } catch {
            /* Lock also expires automatically. */
          }
          if (!closed) {
            closed = true;
            out.close();
          }
          resolveTask();
        }
      })();
    },
    cancel() {
      closed = true;
      controller.abort("client_disconnect");
    },
  });
  ctx.waitUntil(task);
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Accel-Buffering": "no",
    },
  });
}
