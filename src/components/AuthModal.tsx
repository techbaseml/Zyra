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
import { api, errorMessage } from "../lib/api";
import Modal from "./Modal";
import Turnstile from "./Turnstile";
export default function AuthModal({
  config,
  onClose,
  onSuccess,
}: {
  config: AppConfig;
  onClose: () => void;
  onSuccess: (data: SessionData) => void;
}) {
  const [mode, setMode] = useState<"login" | "register">("login"),
    [email, setEmail] = useState(""),
    [password, setPassword] = useState(""),
    [name, setName] = useState(""),
    [consent, setConsent] = useState(false),
    [visible, setVisible] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [token, setToken] = useState(""),
    [attempt, setAttempt] = useState(0),
    [recovery, setRecovery] = useState(false);
  const register = mode === "register",
    ready = config.authReady && (!register || config.registrationEnabled);
  return (
    <Modal
      title={register ? "Make yourself at home" : "Welcome back"}
      onClose={onClose}
    >
      <p className="modal-intro">
        Your ideas, conversations, and a little more possibility. All in one
        place.
      </p>
      <div className="segmented">
        <button
          className={!register ? "selected" : ""}
          onClick={() => {
            setMode("login");
            setError("");
            setToken("");
          }}
        >
          Sign in
        </button>
        <button
          className={register ? "selected" : ""}
          onClick={() => {
            setMode("register");
            setError("");
            setToken("");
          }}
        >
          Create account
        </button>
      </div>
      {!ready && (
        <div className="notice">
          {config.authReady
            ? "New registrations are currently closed."
            : "Accounts are awaiting secure server setup. Sign-in will be available once configuration and security checks are complete."}
        </div>
      )}
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError("");
          try {
            const data = await api<SessionData>(`/auth/${mode}`, "POST", {
              email,
              password,
              name,
              consent,
              turnstileToken: token,
            });
            onSuccess(data);
          } catch (err) {
            setError(errorMessage(err));
            setToken("");
            setAttempt((v) => v + 1);
          } finally {
            setBusy(false);
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
        <label className="field">
          Password
          <div className="input-icon">
            <LockKeyhole size={16} />
            <input
              type={visible ? "text" : "password"}
              autoComplete={register ? "new-password" : "current-password"}
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
        {register ? (
          <label className="check-field">
            <input
              type="checkbox"
              checked={consent}
              onChange={(e) => setConsent(e.target.checked)}
              required
            />
            <span>
              I understand chats are saved to my account and sent to Groq, or
              Google Gemini if fallback is enabled. Free-tier providers may use
              data under their policies. I will not send sensitive information.
              Email verification and recovery are unavailable.
            </span>
          </label>
        ) : (
          <button
            type="button"
            className="text-button"
            onClick={() => setRecovery(!recovery)}
          >
            Forgot password?
          </button>
        )}
        {recovery && !register && (
          <p className="notice">
            Email recovery is not configured on this deployment. ZYRA cannot
            send a reset link. Keep your password in a password manager; the
            site owner cannot retrieve it.
          </p>
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
          {busy
            ? "One moment…"
            : register
              ? "Create your account"
              : "Sign in to ZYRA"}
          <ArrowRight size={16} />
        </button>
      </form>
      <p className="auth-note">
        <LockKeyhole size={12} /> Your conversations belong to your account.
      </p>
    </Modal>
  );
}
