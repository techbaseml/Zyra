// Temporary, authenticated diagnostic Worker. Never enable a paid plan for this benchmark.
// This worker has no user database and never receives a real user's password.
import {
  constantEqual,
  hashPassword,
  randomToken,
  verifyPassword,
} from "../worker/security";
export default {
  async fetch(request: Request, env: { BENCHMARK_TOKEN?: string }) {
    if (
      request.method !== "POST" ||
      !env.BENCHMARK_TOKEN ||
      env.BENCHMARK_TOKEN.length < 32 ||
      !constantEqual(
        request.headers.get("Authorization") || "",
        `Bearer ${env.BENCHMARK_TOKEN}`,
      )
    )
      return new Response("Not found", { status: 404 });
    const password = randomToken(),
      start = performance.now();
    const hash = await hashPassword(password);
    const valid = await verifyPassword(password, hash);
    return Response.json(
      {
        valid,
        wallTimeMs: Math.round(performance.now() - start),
        note: "Wall time is not CPU time. Inspect Cloudflare CPU metrics and exceededCpu errors. This does not automatically approve the authentication gate.",
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  },
};
