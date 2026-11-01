# Continue the existing ZYRA deployment with Supabase Auth

This changes authentication only. The existing React UI, Cloudflare Worker `zyra`, Groq integration, D1 database `zyra-ai-db`, and conversation IDs remain. The migration is additive and never copies local password hashes into Supabase or links accounts by email alone.

## 1. Create or connect one Free Supabase project

Use https://supabase.com/dashboard and the **Free** organization plan. Do not add a payment method or upgrade. Name the project `zyra-auth`, choose a nearby available region, and generate the required database password with a password manager. The app does not need that database password. If ChatGPT's Supabase integration is connected, project setup can be continued through it where supported.

Supabase Free can pause inactive projects. Resume the project in its dashboard if auth becomes unavailable. Check https://supabase.com/pricing for current limits. Code does not enable billing and cannot prove a project's billing tier from an API key.

## 2. Add the three runtime values to the existing Cloudflare Worker

Supabase's project **Connect** dialog / API settings show the project URL and API keys. Use the newer publishable and secret keys where available. The legacy `anon` and `service_role` equivalents are also accepted.

Cloudflare → Workers & Pages → `zyra` → Settings → Runtime variables and secrets → Production.

| Name (type exactly) | Value | Type |
| --- | --- | --- |
| `SUPABASE_URL` | The project's `https://PROJECT-REF.supabase.co` URL | Secret or Text |
| `SUPABASE_PUBLISHABLE_KEY` | Its `sb_publishable_...` key (or legacy anon key) | Secret recommended |
| `SUPABASE_SECRET_KEY` | Its `sb_secret_...` key (or legacy service_role key) | **Secret** |

Click **Deploy**, not just Save version. These are runtime values, not Build variables. Do not paste keys in chat, source files, screenshots or `VITE_*` variables. The secret key is required only by the Worker for account deletion, never shipped to the browser. ZYRA makes no Supabase SQL/data/storage calls.

Keep the existing `GROQ_API_KEY`, `TURNSTILE_SECRET_KEY` and strong random `ABUSE_SECRET`. `ABUSE_SECRET` must be at least 32 random characters and stored as a Secret. It now also derives the provider-token encryption key. Rotating it forces users to sign in again, without deleting their history.

## 3. Configure email/password and actual email delivery

Supabase → Authentication → Sign In / Providers:

- Enable email/password.
- Keep **Confirm email ON**.
- Set minimum password length to 12; ZYRA also enforces the bcrypt maximum of 72 UTF-8 bytes.
- Keep JWT expiry at the standard 3600 seconds or lower. ZYRA checks the user online, and refreshes provider access before expiry.
- This integration uses its existing server-verified Cloudflare Turnstile. Do not enable a second Supabase CAPTCHA with the same already-consumed token. Add provider CAPTCHA support deliberately if desired later.

Configure **Custom SMTP** under Authentication email settings using an email provider's free allocation. Supabase's built-in SMTP sends only to authorized organization/team addresses, at a small hourly limit, and is not suitable for arbitrary public users. Do not disable confirmation to hide delivery errors. If a provider asks for paid billing, stop and choose a free option; do not subscribe. Sender/domain verification requirements vary and may need the owner's help.

Configure these two templates in Authentication → Email Templates. Complete files are in `supabase/email-templates/`:

- **Confirm signup:** `confirm-signup.html`, subject `Confirm your ZYRA email`.
- **Reset password:** `reset-password.html`, subject `Reset your ZYRA password`.

Both templates display `{{ .Token }}` as a code. This implementation verifies the code through same-origin JSON requests; it does not accept access tokens in URL fragments or use a magic-link session callback. Set the Site URL to `https://zyra.sanjaykrishna587cvra.workers.dev`. Do not use a wildcard redirect allowlist.

Only after both emails arrive and their codes work, set `SUPABASE_EMAIL_ENABLED=true` and `REGISTRATION_ENABLED=true`. For initial controlled testing, temporarily enable the email flag with Supabase's built-in mail service and use only a verified team email, then keep registrations closed until real SMTP is ready. Public readiness is an operator check, not automatically inferred from the flag.

## 4. Deploy the migration and Worker

The existing Cloudflare Git build command stays `pnpm run build`. The deploy command stays:

```sh
npx wrangler d1 migrations apply DB --remote --config wrangler.jsonc && npx wrangler deploy --config dist/server/wrangler.json
```

This applies `0002_supabase_auth.sql` exactly once. It adds an immutable auth subject, encrypted provider tokens, refresh leases, and the deletion outbox. It does not drop users or chats. Applied migrations must never be edited.

The Worker also deploys an hourly scheduled trigger (`17 * * * *`) to retry account deletion if either service was temporarily unavailable. Confirm the trigger is present under Settings/Triggers. No external queue or paid feature is used.

Do not set `AUTH_CPU_VERIFIED=true`; that gate belongs to the earlier local-password implementation. `AUTH_CHECK_EXPIRES_AT=0` disables the obsolete password diagnostic.

Dashboard Text variables can be overwritten by Git/Wrangler deployment. Keep changed nonsecret flags in `wrangler.jsonc`; Cloudflare Secret values persist across code deployments. Keep the three Supabase values as Secrets if managing them through the dashboard so subsequent Git builds do not remove them.

## 5. Verify the actual deployment

Open `/api/config`: `authReady` requires configured provider keys, a strong abuse secret and Turnstile. It is a configuration check, **not a live credential test**. `registrationEnabled` and `recoveryAvailable` additionally require the email flag. `aiReady` likewise only reports AI configuration.

Test with real free accounts:

1. Register with a deliverable email. Confirm no session exists until its code is verified.
2. Enter a wrong code and wrong password; both must fail.
3. Sign in on two browsers, send one English and one Malayalam prompt, and reload the same chat.
4. Verify another account cannot read/rename/delete that conversation.
5. Change the password; both old D1 sessions must be revoked. Test recovery using the reset code.
6. Log out and confirm the old cookie cannot call a private API.
7. Delete the test account. Check its Supabase identity, D1 profile, chats and sessions are removed. If the response reports `pending`, access is already revoked and the hourly job retries deletion; inspect `auth_deletions` until `completed_at` is set.
8. Inspect invocation **CPU time** for the real signup/login/refresh/chat flows on Workers Free. Local tests do not establish the deployed CPU budget.
9. Confirm Groq output is real and streaming, and review Malayalam quality. Gemini fallback requires its own unbilled key; it is not live-verified by this migration.

## Security and operational details

- Browser receives only a random HTTP-only, Secure, host-only session cookie and a CSRF token. Provider access/refresh tokens stay encrypted in D1 with AES-GCM and are bound to the exact project, user, and session.
- Sessions expire after seven days. Refresh is serialized with a bounded D1 lease. Temporary provider failures fail closed without deleting a recoverable session.
- User identity comes from the provider's authenticated `/user` response, never from client-supplied JWT claims or email matching. Deleted/unconfirmed identities cannot access chats.
- ZYRA password change/reset revokes all D1 sessions. External Supabase dashboard revocation/password changes follow Supabase's access-token expiry semantics; already-issued JWTs can remain valid until expiry. Keep expiry short and use ZYRA's own flows for immediate app-session revocation.
- Account deletion creates a durable outbox record and immediately revokes app sessions. The record blocks stale sign-ins; completed deletion identifiers are removed after seven days. Infrastructure backups/provider retention follow their own policies.
- Existing local-password accounts are preserved, but cannot silently become Supabase accounts with the same email. If legacy users exist, perform a separately reviewed ownership-verified migration or let them export their data. Never auto-link by email.
- No passwords, access tokens, refresh tokens, secret keys, or email codes are logged by application code.

## Official references

- https://supabase.com/docs/guides/auth/passwords
- https://supabase.com/docs/guides/auth/auth-smtp
- https://supabase.com/docs/guides/auth/auth-email-templates
- https://supabase.com/docs/guides/auth/sessions
- https://supabase.com/docs/guides/getting-started/api-keys
