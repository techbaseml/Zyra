import test from "node:test";
import assert from "node:assert/strict";
import {
  generate,
  boundedContext,
  systemPrompt,
  type Turn,
} from "../worker/providers";
import { defaultSettings } from "../shared/types";
import { readSSE } from "../shared/sse";
import type { Env } from "../worker/env";
const env = { GROQ_API_KEY: "test-only", GEMINI_API_KEY: "test-only" } as Env;
const turns: Turn[] = [{ role: "user", content: "മലയാളത്തിൽ വിശദീകരിക്കുക." }];
const groq = (text: string) =>
  `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\ndata: [DONE]\n\n`;
const gemini = (text: string) =>
  `data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text, thought: false }] }, finishReason: "STOP" }] })}\n\n`;
async function collect(
  fetcher: typeof fetch,
  settings = defaultSettings,
  signal = new AbortController().signal,
) {
  let text = "";
  for await (const delta of generate(env, turns, settings, signal, fetcher))
    text += delta;
  return text;
}
test("SSE parser preserves split Malayalam UTF-8, CRLF and multi-line data", async () => {
  const bytes = new TextEncoder().encode(
    "event: delta\r\ndata: മലയാളം\r\n\r\ndata: first\ndata: second\n\n",
  );
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      for (const byte of bytes) c.enqueue(new Uint8Array([byte]));
      c.close();
    },
  });
  const events = [];
  for await (const e of readSSE(stream)) events.push(e);
  assert.deepEqual(events, [
    { event: "delta", data: "മലയാളം" },
    { event: "message", data: "first\nsecond" },
  ]);
});
test("Groq streams visible text, ignoring internal reasoning", async () => {
  const result = await collect((async (_url, options) => {
    const data = JSON.parse(options!.body as string);
    assert.equal(data.stream, true);
    assert.match(data.messages[0].content, /You are ZYRA/);
    return new Response(
      `data: ${JSON.stringify({ choices: [{ delta: { reasoning: "private test reasoning" } }] })}\n\n` +
        groq("മലയാളം fixture"),
    );
  }) as typeof fetch);
  assert.equal(result, "മലയാളം fixture");
});
test("429 before output falls back to Gemini with its key in a header", async () => {
  let count = 0;
  const result = await collect((async (url, options) => {
    count++;
    if (count === 1) return new Response("", { status: 429 });
    assert.match(String(url), /streamGenerateContent\?alt=sse/);
    assert.ok(!String(url).includes("key="));
    assert.equal(
      (options!.headers as Record<string, string>)["x-goog-api-key"],
      "test-only",
    );
    return new Response(gemini("backup fixture"));
  }) as typeof fetch);
  assert.equal(result, "backup fixture");
  assert.equal(count, 2);
});
test("credentials, invalid requests and content refusals never trigger fallback", async () => {
  for (const status of [400, 401, 403, 404, 422]) {
    let count = 0;
    await assert.rejects(
      collect((async () => {
        count++;
        return new Response("", { status });
      }) as typeof fetch),
    );
    assert.equal(count, 1);
  }
});
test("fallback can be disabled by the user", async () => {
  let count = 0;
  await assert.rejects(
    collect(
      (async () => {
        count++;
        return new Response("", { status: 503 });
      }) as typeof fetch,
      { ...defaultSettings, allowFallback: false },
    ),
  );
  assert.equal(count, 1);
});
test("truncated stream after visible text never switches providers", async () => {
  let count = 0;
  await assert.rejects(
    collect((async () => {
      count++;
      return new Response(
        'data: {"choices":[{"delta":{"content":"partial"}}]}\n\n',
      );
    }) as typeof fetch),
  );
  assert.equal(count, 1);
});
test("user abort never starts backup inference", async () => {
  const controller = new AbortController();
  let count = 0;
  await assert.rejects(
    collect(
      (async () => {
        count++;
        controller.abort();
        throw new DOMException("Aborted", "AbortError");
      }) as typeof fetch,
      defaultSettings,
      controller.signal,
    ),
  );
  assert.equal(count, 1);
});
test("Gemini internal thought parts are excluded", async () => {
  let count = 0;
  const result = await collect((async () =>
    ++count === 1
      ? new Response("", { status: 503 })
      : new Response(
          'data: {"candidates":[{"content":{"parts":[{"text":"hidden","thought":true},{"text":"shown"}]},"finishReason":"STOP"}]}\n\n',
        )) as typeof fetch);
  assert.equal(result, "shown");
});
test("context includes newest turns, accounts for framing and never begins with assistant", () => {
  const list: Turn[] = Array.from({ length: 100 }, (_, i) => ({
    role: i % 2 === 0 ? "user" : "assistant",
    content: `turn ${i}`,
  }));
  list.push({ role: "user", content: "latest" });
  const bounded = boundedContext(list, 400);
  assert.equal(bounded[0].role, "user");
  assert.equal(bounded.at(-1)?.content, "latest");
  assert.ok(bounded.length < 10);
  assert.match(
    systemPrompt({ ...defaultSettings, language: "ml" }),
    /natural Malayalam/,
  );
  assert.match(systemPrompt(defaultSettings), /same language/);
});
test("unreviewed models never trigger a network request", async () => {
  let calls = 0;
  await assert.rejects(async () => {
    for await (const _ of generate(
      { ...env, GROQ_MODEL: "unapproved-paid-model" },
      turns,
      defaultSettings,
      new AbortController().signal,
      (async () => {
        calls++;
        return new Response(groq("bad"));
      }) as typeof fetch,
    )) {
    }
  });
  assert.equal(calls, 0);
});
test("both unavailable providers produce an honest failure", async () => {
  let calls = 0;
  await assert.rejects(
    collect((async () => {
      calls++;
      return new Response("", { status: 503 });
    }) as typeof fetch),
  );
  assert.equal(calls, 2);
});
test("output-limit completion is explicitly marked incomplete", async () => {
  await assert.rejects(
    collect(
      (async () =>
        new Response(
          'data: {"choices":[{"delta":{"content":"partial answer"},"finish_reason":"length"}]}\n\ndata: [DONE]\n\n',
        )) as typeof fetch,
    ),
    /response length limit/,
  );
});
