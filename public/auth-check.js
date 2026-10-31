/* No keys, credentials, passwords or tokens are persisted by this page. */
const button = document.querySelector("#run");
const result = document.querySelector("#result");
let token = "";
let widget;
async function start() {
  try {
    const [statusResponse, configResponse] = await Promise.all([
      fetch("/api/setup/auth-check", { cache: "no-store" }),
      fetch("/api/config", { cache: "no-store" }),
    ]);
    if (!statusResponse.ok || !configResponse.ok)
      throw new Error(
        "This version is not ready. Wait for the latest Cloudflare build, then reload.",
      );
    const status = await statusResponse.json();
    const config = await configResponse.json();
    if (!status.enabled)
      throw new Error(
        "The temporary test window is closed. Ask the site owner to reopen the diagnostic window.",
      );
    if (!status.ready)
      throw new Error(
        "Production secrets need attention: Turnstile site/secret keys and a random ABUSE_SECRET of at least 32 characters.",
      );
    result.textContent =
      "Security check പൂർത്തിയാക്കി Run password check അമർത്തുക.";
    const script = document.createElement("script");
    script.src =
      "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
    script.async = true;
    script.onload = () => {
      widget = window.turnstile.render(document.querySelector("#challenge"), {
        sitekey: config.turnstileSiteKey,
        action: "auth_check",
        theme: "dark",
        callback(value) {
          token = value;
          button.disabled = false;
        },
        "expired-callback"() {
          token = "";
          button.disabled = true;
        },
        "error-callback"() {
          token = "";
          button.disabled = true;
          result.textContent =
            "Turnstile failed. Check the widget hostname and reload this page.";
        },
      });
    };
    script.onerror = () => {
      result.textContent =
        "Turnstile could not load. Check your connection and reload.";
    };
    document.head.append(script);
  } catch (error) {
    result.textContent = error.message;
  }
}
button.addEventListener("click", async () => {
  if (!token) return;
  button.disabled = true;
  const challengeToken = token;
  token = "";
  result.textContent = "Server password check നടക്കുന്നു…";
  try {
    const response = await fetch("/api/setup/auth-check", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ turnstileToken: challengeToken }),
      signal: AbortSignal.timeout(30000),
    });
    const text = await response.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      throw new Error(
        "HTTP " +
          response.status +
          "\n" +
          text.replace(/<[^>]*>/g, " ").slice(0, 1200),
      );
    }
    if (!response.ok)
      throw new Error(
        "HTTP " + response.status + "\n" + (data.error || "Check failed."),
      );
    result.textContent =
      JSON.stringify(data, null, 2) +
      "\n\nഈ result-ന്റെ screenshot അയയ്ക്കുക. CPU time ഇതിൽ അളന്നിട്ടില്ല.";
  } catch (error) {
    result.textContent =
      "Check did not complete.\n" +
      error.message +
      "\n\nഈ result-ന്റെ screenshot അയയ്ക്കുക. Cloudflare error/CPU logs പരിശോധിക്കണം.";
  } finally {
    if (window.turnstile && widget !== undefined)
      window.turnstile.reset(widget);
  }
});
start();
