# Architecture and security decisions

The browser sends same-origin requests to `/api/*`. The Worker authenticates the opaque session, verifies authorization and CSRF, reserves quota in D1, loads a bounded part of that user's conversation, then streams Groq output. Recoverable pre-output failures may use Gemini when the user has enabled fallback. The browser never contacts AI providers or receives API keys.

## REST contract

| Method / route | Purpose |
| --- | --- |
| `GET /api/config` | Public readiness, public CAPTCHA key, daily limit |
| `GET /api/health` | Database availability and AI configuration readiness, not provider health |
| `GET /api/me` | Public profile, session CSRF token, usage |
| `POST /api/auth/register` | Name/email/password, consent, valid Turnstile |
| `POST /api/auth/login` | Email/password and Turnstile |
| `POST /api/auth/verify` | Email confirmation code + consent + Turnstile |
| `POST /api/auth/recover` | Request recovery email code, when delivery is configured |
| `POST /api/auth/reset` | Verify recovery code, update password, revoke sessions |
| `POST /api/auth/logout` | Revoke current session |
| `PATCH /api/profile` | Validated name and preferences |
| `POST /api/account/password` | Reauthenticate, change password, revoke all sessions |
| `DELETE /api/account` | Password-confirmed cascade deletion |
| `GET /api/conversations?q=` | Owned title-search results |
| `DELETE /api/conversations` | Confirmed clear-all |
| `GET /api/conversations/:id` | Owned conversation and messages |
| `PATCH /api/conversations/:id` | Rename owned chat |
| `DELETE /api/conversations/:id` | Delete owned chat |
| `POST /api/chat` | Send/edit/regenerate with unique request ID |
| `POST /api/chat/stop` | Cancel only this account's matching request |

Authenticated mutations require `X-CSRF-Token`. All mutations require exact-origin `Origin`, JSON content type, and no cross-site Fetch Metadata, including login. No wildcard CORS is granted.

## Sessions and passwords

Production uses Supabase Auth through server-side REST calls. User passwords are processed and hashed by Supabase. The Worker never stores a Supabase password hash. Local scrypt (`N=16384,r=8,p=5`) remains available for offline development/legacy code only; the production configuration does not enable it.

Supabase project origin plus immutable user ID forms `auth_subject`. The Worker verifies `/user` using the issued access token. It never trusts client-supplied identity claims, and never links by matching email. D1 `password_hash` for external users is a random credential epoch, not a password-derived value. Session creation compares the captured epoch to prevent a concurrent password change from issuing a stale session.

Sessions use 32 random bytes; only their SHA-256 digest is stored in D1. Production cookies are `__Host-zyra_session; Secure; HttpOnly; SameSite=Lax; Path=/` with seven-day absolute expiry. CSRF tokens are independently random. Supabase access/refresh tokens remain server-side, encrypted with AES-GCM using a purpose-separated key derived from the random `ABUSE_SECRET`. Ciphertext AAD binds the project origin, D1 user and session hash. The same secret separately HMACs pseudonymous IP identifiers. Secret rotation requires fresh sign-in.

Before each authenticated request, the Worker checks the provider user online. Expiring access tokens refresh under an atomic 30-second D1 lease; other requests receive a specific retryable response before any application mutation. Session existence and credential epoch are rechecked after remote validation. Temporary provider failures fail closed but do not erase valid sessions. Local logout revokes D1 immediately even if Supabase is unavailable. ZYRA password changes and recovery revoke every D1 session. External Supabase revocation retains its standard JWT expiry window; see setup documentation.

Email signup and recovery stay closed until real SMTP and OTP templates are configured. Supabase confirmation remains enabled. Recovery codes are verified on the server and never logged. A new authenticated identity must accept the privacy notice before a D1 account is created.

Deletion uses a durable outbox: revoke D1 sessions, delete the Supabase identity, then cascade D1 user/chat deletion. Partial failures retry hourly. The outbox also blocks stale sign-ins from resurrecting deleted identities. Completed identifiers expire after seven days. No paid queue is involved.

## Ownership and concurrency

Every conversation is resolved under the authenticated `user_id` before reading messages. SQL is parameterized. Foreign keys cascade account/conversation deletion. No app route lists other users' data.

Generation and destructive mutations share a per-user D1 lock with atomic SQLite conflict/update predicates, including across isolates. Generations expire after two minutes and short mutations after 30 seconds. Cleanup deletes only its own request ID. Account deletion also checks the verified password hash remains current.

Editing replaces the selected question and later messages. Regeneration retains the latest question and replaces later output. Successful/partial output is stored with an explicit status. Errors are never fabricated as assistant answers. A persistence failure warns the user to copy the still-visible response.

## Free usage and fallback

Daily user/global/IP admission is one atomic `INSERT … SELECT … WHERE`. Request IDs reject replay; usage does not cascade with account deletion. Each provider attempt separately reserves a conservative token budget. No paid gateway, upgrade, search, grounding, or code-execution service is invoked.

`worker/models.ts` contains reviewed model IDs. The operator must still check current eligibility and account billing. `FREE_TIER_CONFIRMED` is a manual assertion, not API-based billing detection.

Only network/timeouts and HTTP 429/500/502/503/504 before visible text permit fallback. Credentials, bad inputs, refusals, cancellations, and partial output do not. Provider reasoning fields are hidden. Incomplete/output-limited responses are marked interrupted.

Cancellation aborts the client stream and upstream controller. Independent server polling every five seconds also covers initial silence. A 100-second deadline and bounded polling avoid unbounded D1 subrequests.

## Browser privacy

Markdown HTML is skipped, dangerous URL schemes are filtered, and remote Markdown images are omitted. Code is never executed. Static assets and API responses set security headers. No ads, analytics SDK, or service worker caches private chats.

Only preferences use localStorage. Tokens remain HttpOnly; drafts stay in React state and do not survive reload. History lives in D1. Focus and 30-second foreground polling provide eventual cross-device synchronization, not live collaborative editing.

Text files are clearly marked untrusted user content for the model. This does not promise complete prompt-injection prevention. Browser speech may use its vendor's service; the UI discloses this before microphone use. TTS quality depends on installed voices.
