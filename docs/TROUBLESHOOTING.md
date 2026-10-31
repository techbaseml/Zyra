# Troubleshooting

| Symptom | Check / fix |
| --- | --- |
| “AI connection awaiting setup” | Set the Worker secret `GROQ_API_KEY` and confirm your free provider accounts before setting `FREE_TIER_CONFIRMED=true`. Rebuild/redeploy after non-secret variable changes. |
| Signup/sign-in disabled | Production requires a valid Turnstile site/secret pair, `ABUSE_SECRET` with at least 24 characters, and the measured `AUTH_CPU_VERIFIED=true` gate. Signup additionally requires `REGISTRATION_ENABLED=true`. |
| Worker error 1102 / `exceededCpu` on auth | Do not lower scrypt strength or buy a plan automatically. Keep signup closed; the required Free Worker architecture needs a reviewed alternative auth design if full auth cannot fit. |
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
| Forgot password | No email delivery/recovery integration exists. There is no fake reset action. Keep credentials in a password manager; the site owner cannot recover plaintext passwords. |
| GitHub Pages UI has no backend | Deploy the Worker and D1 on Cloudflare. Static Pages hosting cannot execute this backend. |

Never paste secrets into a bug report. Include only the route, time, HTTP status, safe error code, and whether the issue happens locally or on the deployed site.
