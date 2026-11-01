# Verification and remaining launch checks

## Completed in the development environment

Final run on 31 October 2026: TypeScript check passed, production build passed, **44 automated tests passed**, zero failures.

The automated suite uses the actual Cloudflare workerd runtime with Miniflare D1 for integration tests. Provider network traffic is blocked and replaced with **test-only transport fixtures**. These fixtures never ship in production code.

Verified paths include registration, correct and incorrect password checks, opaque sessions, production cookie attributes, CSRF/origin rejection, per-account authorization, Unicode chat storage, edit/regenerate history replacement, persisted preferences across a second session, 20-request daily limits under concurrent admissions, primary-to-backup adapter fallback, no fallback on authentication errors or after partial output, safe Markdown, logout invalidation, credential-change race protection, conversation deletion and account cascade deletion.

Desktop UI was inspected in a browser. A 390 px iframe viewport was inspected for mobile layout and measured at 390 px body width with no horizontal overflow. Malayalam suggestion text rendered and populated the composer. The settings dialog and light/dark switching were exercised. This is a viewport check, not a physical Android/iPhone keyboard or microphone test.

## Supabase-specific tests

The added transport tests cover configuration fail-closed behavior, UTF-8 password limits, AES-GCM token encryption/AAD, email confirmation, wrong credentials/codes, opaque sessions, CSRF, cross-account isolation and cross-browser history, refresh serialization, provider outages, legacy-email collision refusal, password change, recovery, outage-safe logout, durable account deletion and scheduled retry. These use the real compiled Worker and D1, with a deterministic Supabase HTTP fixture. They do not verify Supabase availability or actual email delivery.

## Run automated verification

```sh
pnpm typecheck
pnpm build
pnpm test
```

Build before integration tests because Miniflare tests the compiled Worker entrypoint. No provider keys or production database are needed. Tests make no outbound AI requests.

## Not yet verified with real infrastructure

- Live Groq/Gemini inference and the configured account's model availability.
- Malayalam, English, and mixed-language answer quality; Unicode and prompting tests do not establish model quality.
- Real Supabase credentials, email delivery/OTP templates, and the complete deployed Supabase account flow.
- Deployed Cloudflare **Free** CPU time for the new Supabase flow. The prior scrypt diagnostic was measured at 383 ms and is disabled.
- The real Turnstile widget succeeded on the earlier diagnostic; new signup/verify/recovery actions still require live checks.
- Two physical devices syncing over the live deployment.
- Mobile software keyboards, microphone permission flows, browser STT, and Malayalam TTS voices.
- Provider outages and quotas under production load; dependency/penetration auditing.

Do not mark these as passed based on this source delivery or a successful UI deployment.

## Optional real-key provider smoke check

After checking billing and filling `.dev.vars`, explicitly add `CHECK_LIVE_AI=true` to that local file, then:

```sh
node --env-file=.dev.vars scripts/check-providers.mjs
```

This makes six small live requests (three languages per provider), consumes real free quotas, and prints their responses for human quality review. It never prints keys. A received answer is not proof of correctness. Remove the diagnostic opt-in afterwards.

## Manual end-to-end scenarios

| Scenario | Expected result |
| --- | --- |
| Sign up with a 12+ character password and privacy consent | Email code sent after security check; no D1 session until confirmation succeeds |
| Reload and reopen in another signed-in browser | Same profile, conversations, and settings |
| Sign in as a second account | No access to the first account's conversation IDs or actions |
| Send English, Malayalam, and mixed prompts | Genuine streaming answers; language matches message/preference |
| Stop during an initial provider stall | No backup inference after cancellation is observed; partial text marked interrupted |
| Edit a previous question | A confirmation notice explains replacement; that question and following turns are replaced |
| Regenerate | Latest question retained, latest answer replaced, usage counted |
| Reach the daily cap | HTTP 429 and the exact free-limit message; reloading does not reset it |
| Disable fallback in Privacy | Failed primary request cannot send the conversation to Gemini |
| Attach `.txt` or source code | Preview available; text included in persisted message; oversized/binary files rejected |
| Export chat | Markdown download contains real messages and interruption markers |
| Password change | Old password rejected; existing sessions revoked |
| Delete all chats/account | Explicit confirmation; no other account affected |
| Disconnect network while generating | Honest interrupted response; no invented answer or automatic duplicate request |
| Keyboard-only and reduced-motion use | Focus visible; dialogs contain focus; mobile drawer blocks background focus; animations disabled |

Each deployment must record results, model IDs, provider plan, date, browser, and any failure before a public launch.
