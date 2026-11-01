# ZYRA AI

**Your Personal AI Assistant. Intelligence Made Personal.**

A React + Vite + TypeScript application with a Cloudflare Worker API, D1 accounts/history, genuine Groq streaming integration, and optional Gemini fallback. The interface includes an original animated orb, responsive glass surfaces, Malayalam/English preferences, light/dark themes, and accessible dialogs.

**Current deployment work:** Supabase Auth replaces password hashing on the public Worker. The existing UI and D1 chat storage are retained. The earlier custom-password diagnostic consumed 383 ms CPU and is disabled. Supabase project credentials and working email delivery are required before public registration opens. Automated transport tests do not prove live Supabase, email delivery, Groq inference, or deployed CPU performance. Follow [Supabase setup](docs/SUPABASE_SETUP.md).

## Start here

- [Complete local setup, API keys, Cloudflare deployment, and GitHub publishing](docs/DEPLOYMENT.md)
- [മലയാളത്തിൽ തുടങ്ങാനുള്ള നിർദ്ദേശങ്ങൾ](docs/START_HERE_MALAYALAM.md)
- [What was tested and what needs real infrastructure](docs/TESTING.md)
- [Troubleshooting](docs/TROUBLESHOOTING.md)
- [API and security architecture](docs/ARCHITECTURE.md)

```sh
npm install --global pnpm@11.25.0
pnpm install --frozen-lockfile
cp .dev.vars.example .dev.vars
pnpm db:local
pnpm dev
```

Use Node.js 22.13+. On PowerShell use `Copy-Item .dev.vars.example .dev.vars`. Open Vite's printed URL. Registration and D1 work locally; AI requests return an honest setup error until real keys and the free-tier confirmation are configured.

## Implemented behavior

| Area | Behavior |
| --- | --- |
| Chat | Genuine server streaming adapters; Markdown/code highlighting; copy; edit/resend; regenerate; cancellation; context; error and interrupted states |
| Accounts | Supabase email/password authentication; email confirmation and recovery codes when configured; encrypted server-side provider sessions; opaque seven-day cookies; profile editing; password change; logout; durable account deletion |
| History | D1 persistence, account isolation, recent chats, title search, first-question titles, rename/delete, Markdown export, confirmed clear-all |
| Sync | Reload/focus refresh and 30-second foreground polling; preferences load on sign-in and save to D1 |
| Languages | Malayalam Unicode, language-aware system prompt, automatic or explicit Malayalam/English preference |
| Input | Typed questions; supported browser voice recognition; text/code files with preview; device-dependent speech playback |
| Preferences | Dark/light/system, response length, reduced motion, fallback privacy control |
| Protection | Same-origin JSON + session CSRF, parameterized SQL, ownership checks, Turnstile, IP/email/user throttles, body/context/output limits, concurrent generation/mutation locks |
| Quotas | 20 user requests/day by default, global/IP protection, conservative token budgets, separately reserved provider attempts, no automatic billing changes |

Provider brands are disclosed in signup, About and Privacy. No mock answer path exists in production. Test fixtures are confined to `tests/`.

## Deliberate limitations

- No live web search, code execution, image understanding, PDF parsing, permanent personal memory, or image-generation claims.
- Public email signup, verification and recovery require real SMTP delivery configured in Supabase. These features remain closed until the operator confirms delivery. Supabase's built-in mail service is for testing with authorized team addresses, not general public delivery.
- Text attachments only, up to 12 KB and subject to the smaller model context budget. No fake image-upload control.
- At most 200 conversations/account and 100 turns/conversation. Only newest bounded context (up to 40 messages) reaches inference. History remains viewable until deleted.
- One active generation per account. Failed requests may consume capacity; editing/regenerating counts. Quotas reset at midnight UTC (05:30 in India), but shared limits may pause access earlier.
- Free models and quotas can change. The app cannot detect a key's billing tier. Use unbilled projects, check terms, and configure the explicit free-tier gate.
- Supabase handles public password hashing off the Worker. Local scrypt remains for offline development and legacy data only; it is not enabled on this Free production Worker. Deployed complete-flow CPU still needs measurement. Supabase Free projects may pause after inactivity.

## Project structure

```text
zyra-ai/
  src/                     React application
    App.tsx                 Navigation, chat lifecycle, session and sync
    components/             Auth, settings, composer, Markdown, orb, dialogs
    lib/                    API client and browser speech interfaces
    styles.css              Responsive themes, visual system, accessibility
  worker/                   Cloudflare REST API
    index.ts                Auth, profile, history and API routing
    security.ts             scrypt, validation, throttling, Turnstile, headers
    auth.ts                 Opaque sessions, encrypted tokens, refresh leases, CSRF
    supabase.ts             Server-only Auth REST client and token encryption
    supabase-routes.ts      Signup, login, email code confirmation and recovery
    account-deletion.ts     Durable deletion and scheduled retries
    chat.ts                 Locks, context, streaming and storage
    providers.ts            Groq/Gemini streaming and fallback rules
    models.ts               Reviewed free-model allowlists
    quotas.ts               Atomic usage and provider reservations
    env.ts                  Binding and configuration types
  shared/                   Types and chunk-safe SSE parser
  db/schema.ts              Drizzle D1 schema
  drizzle/                  Versioned SQL migrations and metadata
  tests/                    workerd/D1 integration, provider/security tests
  docs/                     Deployment, architecture, testing, troubleshooting
  scripts/check-providers.mjs  Explicit real-key smoke test
  scripts/auth-benchmark.ts    Token-protected CPU diagnostic Worker
  scripts/sanitize-build.mjs   Removes local secrets from build output
  public/                   ZYRA SVG and security headers
  .github/workflows/ci.yml   Checks only; no deployment or billing actions
  .dev.vars.example         Empty-key local Worker template
  .env.example              Frontend deliberately has no API secrets
  wrangler.jsonc            Main Worker, assets, D1, closed-default gates
  wrangler.benchmark.jsonc  Separate temporary auth benchmark
  vite.config.ts            React/Vite, Cloudflare and Sites integration
  package.json              Scripts and dependencies
  pnpm-lock.yaml            Reproducible dependency lock
```

## Validation

```sh
pnpm typecheck
pnpm build
pnpm test
```

Build before integration tests. Providers are mocked only in tests; no paid API calls are needed. `docs/TESTING.md` records the verification boundary and live-check procedure.

## Official references

Checked during implementation on 30–31 October 2026; recheck before deployment:

- [Groq free limits](https://console.groq.com/docs/rate-limits), [streaming](https://console.groq.com/docs/text-chat), [data handling](https://console.groq.com/docs/your-data)
- [Gemini free-tier pricing](https://ai.google.dev/gemini-api/docs/pricing), [streaming API](https://ai.google.dev/api/generate-content), [terms](https://ai.google.dev/gemini-api/terms)
- [Workers limits](https://developers.cloudflare.com/workers/platform/limits/), [static assets](https://developers.cloudflare.com/workers/static-assets/), [D1 configuration](https://developers.cloudflare.com/workers/wrangler/configuration/#d1-databases)
- [OWASP password storage](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html)

No API key, password, user conversation, or production database is included in the source.
