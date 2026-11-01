> Superseded: the deployed custom KDF used 383 ms CPU. The diagnostic is now disabled. Use [Supabase setup](SUPABASE_SETUP.md); do not repeat this procedure or enable the legacy CPU flag.

# Temporary authentication diagnostic from a phone

Open `/auth-check.html` on the deployed ZYRA origin after the matching Cloudflare build completes. Complete Turnstile and press **Run password check**. This page never asks for a password, API key, or operator secret.

The operator opens a temporary window through `AUTH_CHECK_EXPIRES_AT`, an epoch-millisecond timestamp at most 24 hours in the future. No timestamp or an expired/invalid timestamp fails closed. The window configured for initial setup lasts two hours; remove the setting after diagnosis. The global atomic D1 counter permits at most three hashing requests in a rolling 24-hour window. IP throttling and exact-origin JSON validation also apply. Production calls require a real Turnstile token for the deployed hostname and `auth_check` action. Do not use public dummy Turnstile keys.

The check generates fresh random sample text, executes the same strong scrypt hashing and verification functions used by accounts, and discards both sample and hash. It does not write user/session/conversation records or call AI providers. The only database writes are throttle counters. Requests that include passwords, API keys or extra fields are rejected.

## Interpreting the result

- HTTP 200 with `hashAndVerifyCompleted: true` proves that this isolated deployed operation completed. It is **not** a CPU measurement or full account-flow verification. `cpuVerified` remains false.
- In Cloudflare, open the Worker's **Observability** view. Find the **POST `/api/setup/auth-check`** invocation at the test time. Inspect its **CPU time**, outcome and errors. Use invocation CPU time rather than response duration, wall time or an average mixed with unrelated GET requests.
- Error 1102 / `exceededCpu` indicates a Workers resource-limit problem. The diagnostic runs both a hash and a verification in one request, a conservative workload relevant to password changes. Determine which production operations fit the free CPU budget before opening them. Never lower password protection or enable paid billing just to make this check pass.
- An HTTP 400 security error calls for checking the Turnstile hostname/site-secret pair. HTTP 503 explains missing production configuration. HTTP 429 means the bounded diagnostic quota has been used; do not remove counters to evade protection.

Invocation logs are temporarily enabled to make CPU timing inspectable. The diagnostic logs one fixed completion message; it does not log the generated sample, hash, challenge token, keys or real user text. After the review, disable unnecessary invocation logging and remove `AUTH_CHECK_EXPIRES_AT`.

`AUTH_CPU_VERIFIED` and `REGISTRATION_ENABLED` remain false throughout this check. Only after measured Free-plan CPU checks and complete registration, login, password-change and deletion tests should the operator consider opening accounts. If strong hashing does not fit, a different reviewed free authentication architecture is required; no plan upgrade is automatic.

## Local validation

Typecheck, production build and 30 automated tests passed with this diagnostic addition. New tests cover expiry/default denial, password-field rejection, production challenge requirements, origin rejection, global KDF throttling, no user creation and unchanged production account gates. Local Worker tests and mocked provider transports do not verify the live Free CPU budget, live Turnstile or real AI inference.
