# Deploy ZYRA on your own Cloudflare account

These steps deploy the existing React/Vite frontend and API Worker together. They do not rebuild the project from a starter. No paid plan is required by a deployment command, and the Supabase configuration described below is required before public signup.

## 1. Install the project

Use Node.js 22.13 or newer and pnpm 11.25.0. In the project directory:

```sh
npm install --global pnpm@11.25.0
pnpm install --frozen-lockfile
cp .dev.vars.example .dev.vars
pnpm db:local
pnpm dev
```

On Windows PowerShell, replace `cp` with `Copy-Item .dev.vars.example .dev.vars`. Open the URL printed by Vite. Local registration works without CAPTCHA only on localhost/127.0.0.1 (and the managed development hostname); this exception cannot be enabled on a public hostname merely by setting `APP_ENV`.

Without AI keys, the interface and account storage work locally, and sending a chat returns an explicit setup error. No answer is simulated.

## 2. Create free provider projects

- [Groq Console](https://console.groq.com/): create a key in a Free-plan project. Confirm the current account quotas. Do not enable billing or upgrade the plan.
- [Google AI Studio](https://aistudio.google.com/): create a key for a Gemini project that has **no billing account attached**. Confirm free-tier availability in your region and project.
- Read the provider terms and age/region restrictions before offering your service publicly. Free API processing is disclosed in ZYRA's signup and Privacy screen.

Reviewed defaults: `openai/gpt-oss-120b` and `gemini-3.5-flash-lite`. Models can change after release. Recheck the official model and free-limit pages linked in README; update the reviewed allowlists in `worker/models.ts` before using a new model. A model name alone never proves that your key is unbilled.

For local live tests, put the keys in `.dev.vars` and set `FREE_TIER_CONFIRMED=true` there only after checking both accounts. Never place a key in `VITE_*`, a frontend file, `.env.example`, GitHub, chat messages, or screenshots.

## 3. Authenticate and create D1

```sh
pnpm exec wrangler login
pnpm exec wrangler whoami
pnpm exec wrangler d1 create zyra-ai-db
```

Copy the exact returned `database_id` into `wrangler.jsonc`, replacing the development identifier. Keep `binding` equal to `DB`. Then:

```sh
pnpm db:remote
```

This applies the numbered SQL migrations in `drizzle/`. Local and remote data are separate. Do not change applied migrations; generate a new migration after a schema change with `pnpm db:generate`.

## 4. Configure Supabase Auth Free

Follow [SUPABASE_SETUP.md](SUPABASE_SETUP.md). Keep `AUTH_PROVIDER=supabase` in production. The live custom scrypt diagnostic consumed 383 ms CPU; `AUTH_CPU_VERIFIED` stays false and the diagnostic expiry is zero. Do not weaken the password hash or enable billing. Supabase performs password hashing on its own service.

Configure the project URL, publishable key and secret key as Cloudflare runtime secrets, then configure real SMTP and OTP email templates in Supabase. Public registration and recovery stay closed until `SUPABASE_EMAIL_ENABLED=true`. The existing D1 database and conversation ownership are retained; never create a second database to perform this migration.

## 5. Configure Turnstile and secrets

In Cloudflare, create a free Turnstile widget for your exact `workers.dev` or custom hostname. Put its public site key in the `TURNSTILE_SITE_KEY` variable. The server verifies token success, action (`login`, `register`, `verify`, `recover`, `reset`), and exact hostname.

Set secrets using interactive Wrangler prompts:

```sh
pnpm exec wrangler secret put GROQ_API_KEY
pnpm exec wrangler secret put GEMINI_API_KEY
pnpm exec wrangler secret put TURNSTILE_SECRET_KEY
pnpm exec wrangler secret put ABUSE_SECRET
```

`ABUSE_SECRET` must be a cryptographically random value of at least 32 characters. It hashes IP identifiers and derives a purpose-separated AES-GCM key for encrypted Supabase tokens. Rotating it invalidates existing provider sessions; users must sign in again. Opaque sessions are stored as SHA-256 token hashes in D1.

In `wrangler.jsonc` configure:

| Variable | Production value |
| --- | --- |
| `APP_ENV` | `production` |
| `FREE_TIER_CONFIRMED` | `true` only after verifying unbilled accounts |
| `AUTH_PROVIDER` | `supabase` |
| `SUPABASE_EMAIL_ENABLED` | `true` only after SMTP and OTP delivery tests |
| `AUTH_CPU_VERIFIED` | Keep `false`; not used for Supabase |
| `REGISTRATION_ENABLED` | `true` only when ready to accept users |
| `TURNSTILE_SITE_KEY` | Your widget's public site key |
| `GROQ_MODEL` | `openai/gpt-oss-120b` |
| `GEMINI_MODEL` | `gemini-3.5-flash-lite` |
| `DAILY_USER_LIMIT` | `20` |
| `DAILY_GLOBAL_LIMIT` | `200`, reduce for smaller provider quotas |
| `DAILY_IP_LIMIT` | `40` |
| `DAILY_TOKEN_BUDGET` | `150000` conservative budget per provider |
| `MINUTE_TOKEN_BUDGET` | `8000`, reduce to the smaller account limit |

Upper bounds are enforced in the Worker. Application token estimates use UTF-8 bytes plus framing and output reservations; they are conservative protection, not exact provider tokenization. Per-provider reservations stay active through the maximum generation duration plus 60 seconds. This can pause requests for up to roughly 160 seconds even before daily limits are reached. Provider 429s remain possible.

## 6. Validate and deploy

```sh
pnpm typecheck
pnpm build
pnpm test
pnpm exec wrangler d1 migrations apply DB --remote --config wrangler.jsonc
pnpm exec wrangler deploy --config dist/server/wrangler.json
```

The build emits `dist/client` and `dist/server`. Its final sanitizer removes copied `.dev.vars`/`.env` files from build output. The Worker uses same-origin `/api/*` requests, so no CORS wildcard or separate frontend URL is needed.

Cloudflare supplies the public HTTPS URL. Static assets are deployed with the Worker. HTTPS is mandatory for production `__Host-` session cookies. Configure a custom domain only if you already own one; buying a domain is optional.

Run the checks in `docs/TESTING.md` before calling the deployment production-ready. Keep `REGISTRATION_ENABLED=false` while doing closed operational checks. Do not activate paid plans to bypass any failure.

## 7. Publish source on GitHub

Create a new **public** repository named `zyra-ai` in your GitHub account, without adding generated files. If starting with the downloaded source folder:

```sh
git init
git add .
git status --short
git diff --cached --stat
git commit -m "Build ZYRA AI assistant"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/zyra-ai.git
git push -u origin main
```

If the folder already has Git history, reuse it and add a `github` remote instead of replacing an existing remote. Replace `YOUR_USERNAME` with your own username. Before pushing, verify `.dev.vars`, `.env`, `node_modules`, `.wrangler`, private test data, and `dist` are not staged. The examples contain empty secrets and are safe to track. GitHub Pages alone cannot run this Worker/D1 backend.

The included GitHub Actions workflow runs checks and tests on pushes and PRs. It does not deploy, upgrade billing, create cloud resources, or use production keys.

## Updating an existing deployment

Change the existing source, run relevant checks, apply only new migrations, build, then deploy the same Worker name. Keep D1 bindings and secrets. Export important chats and take an operator-managed D1 backup before schema changes. A code rollback does not automatically reverse database migrations. Use `REGISTRATION_ENABLED=false` to pause signups and `FREE_TIER_CONFIRMED=false` to stop new AI requests without deleting user data.
