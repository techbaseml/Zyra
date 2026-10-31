// Explicit opt-in live diagnostic. Does not read or print private chat history.
// Environment variables are read by Node's --env-file, not bundled into the browser.
if (
  process.env.CHECK_LIVE_AI !== "true" ||
  process.env.FREE_TIER_CONFIRMED !== "true"
) {
  console.error(
    "Set CHECK_LIVE_AI=true and FREE_TIER_CONFIRMED=true only after confirming free, unbilled provider accounts.",
  );
  process.exit(1);
}
const prompts = [
  ["English", "In one short sentence, what is a variable in programming?"],
  [
    "Malayalam",
    "പ്രോഗ്രാമിംഗിൽ variable എന്താണ്? മലയാളത്തിൽ ഒറ്റ വാക്യത്തിൽ പറയൂ.",
  ],
  [
    "Mixed",
    "Python list എന്താണ്? Malayalam explanation with a tiny English code example.",
  ],
];
let failed = false;
for (const provider of ["groq", "gemini"]) {
  const key =
    provider === "groq" ? process.env.GROQ_API_KEY : process.env.GEMINI_API_KEY;
  if (!key) {
    console.error(`${provider}: key missing — live checks NOT RUN`);
    failed = true;
    continue;
  }
  const model =
    provider === "groq"
      ? process.env.GROQ_MODEL || "openai/gpt-oss-120b"
      : process.env.GEMINI_MODEL || "gemini-3.5-flash-lite";
  for (const [language, prompt] of prompts) {
    const url =
      provider === "groq"
        ? "https://api.groq.com/openai/v1/chat/completions"
        : `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
    const body =
      provider === "groq"
        ? {
            model,
            messages: [{ role: "user", content: prompt }],
            max_completion_tokens: 1024,
            ...(model.startsWith("openai/gpt-oss")
              ? { reasoning_effort: "low" }
              : {}),
          }
        : {
            contents: [{ role: "user", parts: [{ text: prompt }] }],
            generationConfig: { maxOutputTokens: 1024 },
          };
    try {
      const r = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(provider === "groq"
            ? { Authorization: `Bearer ${key}` }
            : { "x-goog-api-key": key }),
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(45000),
      });
      if (!r.ok) {
        console.error(`${provider}/${language}: HTTP ${r.status}; failed`);
        failed = true;
        continue;
      }
      const data = await r.json();
      const text =
        provider === "groq"
          ? data.choices?.[0]?.message?.content
          : data.candidates?.[0]?.content?.parts
              ?.filter((p) => !p.thought)
              .map((p) => p.text || "")
              .join("");
      if (!text) {
        console.error(`${provider}/${language}: no visible answer`);
        failed = true;
        continue;
      }
      console.log(
        `${provider}/${language}: real response received; manually assess quality\n${text}\n`,
      );
    } catch {
      console.error(`${provider}/${language}: connection failed or timed out`);
      failed = true;
    }
  }
}
process.exitCode = failed ? 1 : 0;
