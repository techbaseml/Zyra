# Troubleshooting

| Symptom | Check / fix |
| --- | --- |
| “AI connection awaiting setup” | Set the Worker secret `GROQ_API_KEY` and confirm your free provider accounts before setting `FREE_TIER_CONFIRMED=true`. Rebuild/redeploy after non-secret variable changes. |
| Signup/sign-in disabled | Production Supabase auth requires `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`, a valid Turnstile pair and random `ABUSE_SECRET` of at least 32 characters. Signup additionally requires `REGISTRATION_ENABLED=true` and `SUPABASE_EMAIL_ENABLED=true`. See SUPABASE_SETUP.md. |
| Worker error 1102 / `exceededCpu` on auth | Do not lower scrypt strength or buy a plan automatically. The public Worker now uses Supabase Auth. Check `AUTH_PROVIDER=supabase`; keep `AUTH_CPU_VERIFIED=false`. Measure full Supabase-backed request CPU after deployment. |
| `no such table` | Apply all migrations to the correct local or remote D1 database. `pnpm db:local` and `pnpm db:remote` are intentionally different. |
| Local UI works but accounts fail | Open the exact local URL. Only approved local hostnames plus `APP_ENV=development` bypass Turnstile. `.dev.vars` is for local Worker variables; `.env` frontend variables do not configure this backend. |
| Security check expires | Refresh the dialog. Verify the widget hostname matches the current domain and tokens use the matching login/register action. Tokens are single-use. |
| Login succeeds but session disappears | Use HTTPS in production. Check browser cookie restrictions and serve UI/API on the same origin. Never weaken cookie flags as a workaround. |
| “Your session changed” | Reload the page. CSRF tokens come from the active session; a login/logout in another tab can invalidate them. |
| Free usage limit before 20 requests | Global, IP, token, or short-term provider guards can trigger earlier. Global free capacity is shared; the per-user allowance is a maximum, not guaranteed capacity. |
| New chat temporarily blocked after stop | The server aborts the stream and releases its lock; independent stop checks run at 5-second intervals. After an isolate failure the lock expires within two minutes. |
| Message/file rejected as too large | Text files are limited to 12 KB and the combined model context is further constrained by conservative token reservations. Shorten text or use concise responses. |
| Empty/truncated answer from a reasoning model | Reasoning also consumes completion capacity. Ask a more focused question or request a continuation; no fallback is attempted once visible output begins. |
| Gemini fallback did not activate | Only pre-output network failures, timeouts, 429, 500/502/503/504 permit fallback. A Gemini key and enabled user preference are required. Bad credentials, invalid inputs, safety refusals, cancellation, and partial streams do not switch providers. |
| Model unavailable | Check official current free models and your account permissions. Update server configuration and `worker/models.ts`; never substitute a paid-only model. |
| API returns a generic database error | Check D1 availability/bindings/quotas and deployment logs without logging passwords, prompts, cookies, or API keys. The client deliberately receives no internal details. |
| Microphone button absent | This browser lacks the SpeechRecognition API or a secure context. Use text input. Voice support is not simulated. |
| Malayalam speech unavailable | The device/browser may lack a Malayalam voice or recognition service. Text chat remains available; select Malayalam explicitly for voice input. |
| PDF or image cannot be attached | Only plain UTF-8 text/code is enabled. PDF parsing, OCR, and image understanding are not implemented for this text-only pipeline. |
| Forgot password | Recovery is available only after Supabase SMTP delivery and the reset-code template are configured. Keep `SUPABASE_EMAIL_ENABLED=false` until tested. The owner cannot retrieve plaintext passwords. |
| GitHub Pages UI has no backend | Deploy the Worker and D1 on Cloudflare. Static Pages hosting cannot execute this backend. |

Never paste secrets into a bug report. Include only the route, time, HTTP status, safe error code, and whether the issue happens locally or on the deployed site.

## Supabase migration troubleshooting

- **No email/code:** configure real SMTP; the built-in sender accepts only authorized project-team addresses. Use the supplied `{{ .Token }}` email templates. Keep Confirm email on.
- **Supabase project paused:** resume it on the Free plan. Do not upgrade automatically.
- **Session expired after secret rotation:** expected; sign in again. Chat data remains in D1.
- **Identity conflict:** an existing local account shares that email. No data is moved automatically; do not delete the old account or link by email to bypass this protection.
- **Deletion queued:** access is already revoked. Confirm the hourly scheduled trigger is deployed; review pending rows in `auth_deletions` and the server-only Supabase secret. The job retries without the user's password.
- **Runtime configuration disappears after Git deploy:** use Cloudflare Secret type for all three Supabase values, and keep nonsecret flags in `wrangler.jsonc`. Do not commit keys.
