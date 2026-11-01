# നിലവിലുള്ള ZYRA തുടരാം — Supabase login

Website വീണ്ടും build-from-scratch ചെയ്യുന്നില്ല. Cloudflare Workerയും D1 chat historyയും അതേപടി തുടരും; password authentication Supabase Free കൈകാര്യം ചെയ്യും.

1. Supabase integration ബന്ധിപ്പിക്കുക, അല്ലെങ്കിൽ Supabase Dashboard-ൽ `zyra-auth` എന്ന Free project സൃഷ്ടിക്കുക. Payment method/paid plan ചേർക്കേണ്ടതില്ല.
2. Project URL, publishable key, secret key എന്നിവ Cloudflare → `zyra` → Settings → Runtime variables and secrets → Production-ൽ ചേർക്കുക. പേരുകൾ: `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`. എല്ലാം Secret type ഉപയോഗിക്കാം. യഥാർത്ഥ key Value-ൽ മാത്രം; chat/GitHub-ൽ നൽകേണ്ടതില്ല.
3. Supabase-ൽ Confirm email ON നിലനിർത്തുക. യഥാർത്ഥ email delivery (SMTP) configure ചെയ്യുക. Repo-യിലെ `supabase/email-templates/` confirmation/recovery templates ഉപയോഗിക്കുക.
4. Email codes പ്രവർത്തിക്കുന്നുവെന്ന് പരിശോധിച്ചശേഷം മാത്രം `SUPABASE_EMAIL_ENABLED=true` ചെയ്യുക. Default mail service പൊതുവായ users-ക്ക് മതിയാകില്ല.
5. Cloudflare Git build പുതിയ D1 migration apply ചെയ്ത് existing Worker deploy ചെയ്യും. പുതിയ D1 database ഉണ്ടാക്കരുത്.
6. Live signup, email confirmation, login, Malayalam/English AI response, history, logout, password reset എന്നിവ പരിശോധിക്കുക.

പഴയ password diagnostic-ൽ CPU 383 ms ആയിരുന്നു. `AUTH_CPU_VERIFIED=false`, `AUTH_CHECK_EXPIRES_AT=0` നിലനിർത്തുക; ആ diagnostic വീണ്ടും ചെയ്യേണ്ടതില്ല.

Supabase project/keys/email delivery പൂർത്തിയായിട്ടില്ലെങ്കിൽ login തുറന്നതായി കരുതരുത്. Automated tests യഥാർത്ഥ API/email പരിശോധനയ്ക്ക് പകരമല്ല.

കൃത്യമായ setup, table, test steps: [SUPABASE_SETUP.md](SUPABASE_SETUP.md).
