// Explicit, reviewed model allowlist. Recheck free-plan availability before changing it.
// Model IDs cannot establish an account's billing tier: FREE_TIER_CONFIRMED is also required.
export const FREE_GROQ_MODELS = new Set([
  "openai/gpt-oss-120b",
  "openai/gpt-oss-20b",
  "qwen/qwen3.8-27b",
]);
export const FREE_GEMINI_MODELS = new Set(["gemini-3.5-flash-lite"]);
