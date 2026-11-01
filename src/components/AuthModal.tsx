import { useState } from "react";
import {
  ArrowRight,
  Eye,
  EyeOff,
  LockKeyhole,
  Mail,
  UserRound,
} from "lucide-react";
import type { AppConfig, SessionData } from "../../shared/types";
import { api, ApiError, errorMessage } from "../lib/api";
import Modal from "./Modal";
import Turnstile from "./Turnstile";
type Mode = "login" | "register" | "verify" | "recover" | "reset";
type NextStep = { next: Mode; message: string };
export default function AuthModal({
  config,
  onClose,
  onSuccess,
}: {
  config: AppConfig;
  onClose: () => void;
  onSuccess: (data: SessionData) => void;
}) {
  const [mode, setMode] = useState<Mode>("login"),
    [email, setEmail] = useState(""),
    [password, setPassword] = useState(""),
    [name, setName] = useState(""),
    [consent, setConsent] = useState(false),
    [needsConsent, setNeedsConsent] = useState(false),
    [visible, setVisible] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [token, setToken] = useState(""),
    [attempt, setAttempt] = useState(0),
    [code, setCode] = useState("");
  const register = mode === "register",
    confirming = mode === "verify" || mode === "reset";
  const ready =
    config.authReady &&
    (!(register || mode === "verify") || config.registrationEnabled) &&
    (!(mode === "recover" || mode === "reset") || config.recoveryAvailable);
  const resetChallenge = () => {
    setToken("");
    setAttempt((v) => v + 1);
  };
  function changeMode(next: Mode) {
    setMode(next);
    setError("");
    setNotice("");
    setPassword("");
    setCode("");
    resetChallenge();
  }
  const labels: Record<Mode, string> = {
    login: "Sign in to ZYRA",
    register: "Create your account",
    verify: "Confirm email",
    recover: "Send recovery code",
    reset: "Reset password",
  };
  return (
    <Modal
      title={
        register
          ? "Make yourself at home"
          : mode === "recover" || mode === "reset"
            ? "Reset your password"
            : mode === "verify"
              ? "Check your inbox"
              : "Welcome back"
      }
      onClose={onClose}
    >
      <p className="modal-intro">
        Your ideas, conversations, and a little more possibility. All in one
        place.
      </p>
      <div className="segmented">
        <button
          type="button"
          disabled={busy}
          className={mode === "login" ? "selected" : ""}
          onClick={() => changeMode("login")}
        >
          Sign in
        </button>
        <button
          type="button"
          disabled={busy}
          className={register ? "selected" : ""}
          onClick={() => changeMode("register")}
        >
          Create account
        </button>
      </div>
      {!ready && (
        <div className="notice">
          {config.authReady
            ? "New registrations are currently closed while email delivery is being configured."
            : "Accounts are awaiting secure server setup. Sign-in will be available once configuration is complete."}
        </div>
      )}
      {notice && (
        <p className="notice" role="status">
          {notice}
        </p>
      )}
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError("");
          try {
            const data = await api<SessionData | NextStep>(
              `/auth/${mode}`,
              "POST",
              {
                email,
                password,
                newPassword: password,
                name,
                consent,
                code,
                turnstileToken: token,
              },
            );
            if ("next" in data) {
              setMode(data.next);
              setNotice(data.message);
              setPassword("");
              setCode("");
            } else onSuccess(data);
          } catch (err) {
            if (err instanceof ApiError && err.code === "consent_required")
              setNeedsConsent(true);
            setError(errorMessage(err));
          } finally {
            setBusy(false);
            resetChallenge();
          }
        }}
      >
        {register && (
          <label className="field">
            Display name
            <div className="input-icon">
              <UserRound size={16} />
              <input
                autoComplete="nickname"
                maxLength={60}
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                placeholder="What should we call you?"
              />
            </div>
          </label>
        )}
        <label className="field">
          Email address
          <div className="input-icon">
            <Mail size={16} />
            <input
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              maxLength={254}
            />
          </div>
        </label>
        {confirming && (
          <label className="field">
            Code from your email
            <input
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]{6,10}"
              minLength={6}
              maxLength={10}
              required
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
              placeholder="Verification code"
            />
          </label>
        )}
        {(mode === "login" || register || mode === "reset") && (
          <label className="field">
            {mode === "reset" ? "New password" : "Password"}
            <div className="input-icon">
              <LockKeyhole size={16} />
              <input
                type={visible ? "text" : "password"}
                autoComplete={
                  mode === "login" ? "current-password" : "new-password"
                }
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                minLength={12}
                maxLength={128}
                required
                placeholder="At least 12 characters"
              />
              <button
                type="button"
                className="icon-button"
                aria-label={visible ? "Hide password" : "Show password"}
                onClick={() => setVisible(!visible)}
              >
                {visible ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </label>
        )}
        {(register || mode === "verify" || needsConsent) && (
          <label className="check-field">
            <input
              type="checkbox"
              checked={consent}
              onChange={(e) => setConsent(e.target.checked)}
              required
            />
            <span>
              My chats are stored with Cloudflare and sent to Groq, or Google
              Gemini when fallback is enabled.{" "}
              {config.authProvider === "supabase" &&
                "Supabase processes my email and password for authentication. "}
              Provider privacy and retention policies apply. I will not send
              sensitive information.
            </span>
          </label>
        )}
        {mode === "login" && (
          <button
            type="button"
            className="text-button"
            onClick={() =>
              config.recoveryAvailable
                ? changeMode("recover")
                : setNotice(
                    "Email recovery is not configured on this deployment. ZYRA cannot send a reset code. The site owner cannot retrieve your password.",
                  )
            }
          >
            Forgot password?
          </button>
        )}
        {mode === "recover" && (
          <button
            type="button"
            className="text-button"
            onClick={() => changeMode("reset")}
          >
            I already have a recovery code
          </button>
        )}
        {mode === "register" && config.authProvider === "supabase" && (
          <button
            type="button"
            className="text-button"
            onClick={() => changeMode("verify")}
          >
            I already have a confirmation code
          </button>
        )}
        {ready && (
          <Turnstile
            key={`${mode}-${attempt}`}
            siteKey={config.turnstileSiteKey}
            action={mode}
            onToken={setToken}
          />
        )}
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <button
          className="primary-button full"
          disabled={busy || !ready || (!!config.turnstileSiteKey && !token)}
        >
          {busy ? "One moment…" : labels[mode]}
          <ArrowRight size={16} />
        </button>
      </form>
      <p className="auth-note">
        <LockKeyhole size={12} /> Your conversations belong to your account.
      </p>
    </Modal>
  );
}
