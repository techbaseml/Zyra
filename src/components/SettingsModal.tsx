import { useState } from "react";
import {
  Check,
  ChevronRight,
  Globe2,
  Info,
  Monitor,
  Moon,
  ShieldCheck,
  SlidersHorizontal,
  Sun,
  Trash2,
  UserRound,
} from "lucide-react";
import type { Settings, User } from "../../shared/types";
import { api, errorMessage } from "../lib/api";
import Modal from "./Modal";
export default function SettingsModal({
  user,
  settings,
  onClose,
  onSave,
  onClear,
  onLogout,
  initial = "general",
}: {
  user: User | null;
  settings: Settings;
  onClose: () => void;
  onSave: (name: string, settings: Settings) => Promise<void>;
  onClear: () => void;
  onLogout: (message?: string) => void;
  initial?: string;
}) {
  const [tab, setTab] = useState(initial),
    [draft, setDraft] = useState(settings),
    [name, setName] = useState(user?.name || ""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [saved, setSaved] = useState(false),
    [confirm, setConfirm] = useState(""),
    [deleting, setDeleting] = useState<"chats" | "account" | null>(null),
    [password, setPassword] = useState(""),
    [currentPassword, setCurrentPassword] = useState(""),
    [newPassword, setNewPassword] = useState("");
  function change<K extends keyof Settings>(key: K, value: Settings[K]) {
    setDraft((s) => ({ ...s, [key]: value }));
    setSaved(false);
  }
  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  const sections = [
    { id: "general", icon: SlidersHorizontal, label: "Preferences" },
    { id: "profile", icon: UserRound, label: "Your profile" },
    { id: "privacy", icon: ShieldCheck, label: "Privacy & data" },
    { id: "about", icon: Info, label: "About ZYRA" },
  ];
  return (
    <Modal title="Your space, your way" onClose={onClose} wide>
      <div className="settings-layout">
        <nav className="settings-nav" aria-label="Settings sections">
          {sections.map((s) => (
            <button
              key={s.id}
              className={tab === s.id ? "active" : ""}
              onClick={() => {
                setTab(s.id);
                setError("");
                setDeleting(null);
              }}
            >
              <s.icon size={17} />
              {s.label}
              <ChevronRight size={13} />
            </button>
          ))}
        </nav>
        <div className="settings-content">
          {tab === "general" && (
            <>
              <h3>A little more you.</h3>
              <p className="muted">Make ZYRA feel right at home.</p>
              <label className="field">Appearance</label>
              <div className="theme-options">
                {(
                  [
                    { id: "dark", icon: Moon, label: "Dark" },
                    { id: "light", icon: Sun, label: "Light" },
                    { id: "system", icon: Monitor, label: "System" },
                  ] as const
                ).map((t) => (
                  <button
                    key={t.id}
                    className={draft.theme === t.id ? "selected" : ""}
                    onClick={() => change("theme", t.id)}
                  >
                    <t.icon size={20} />
                    {t.label}
                  </button>
                ))}
              </div>
              <label className="field">
                Preferred language
                <select
                  value={draft.language}
                  onChange={(e) =>
                    change("language", e.target.value as Settings["language"])
                  }
                >
                  <option value="auto">Auto — follow my message</option>
                  <option value="en">English</option>
                  <option value="ml">മലയാളം (Malayalam)</option>
                </select>
              </label>
              <label className="field">
                Response length
                <select
                  value={draft.responseLength}
                  onChange={(e) =>
                    change(
                      "responseLength",
                      e.target.value as Settings["responseLength"],
                    )
                  }
                >
                  <option value="concise">
                    Concise — straight to the point
                  </option>
                  <option value="balanced">
                    Balanced — a little of everything
                  </option>
                  <option value="detailed">Detailed — room to explore</option>
                </select>
              </label>
              <label className="toggle-row">
                <span>
                  <strong>Reduced motion</strong>
                  <small>
                    Keep things calm. System preferences are also respected.
                  </small>
                </span>
                <input
                  type="checkbox"
                  role="switch"
                  checked={draft.reducedMotion}
                  onChange={(e) => change("reducedMotion", e.target.checked)}
                />
              </label>
            </>
          )}
          {tab === "profile" && (
            <>
              <h3>Your profile</h3>
              {user ? (
                <>
                  <div className="profile-preview">
                    <span className="avatar large">
                      {[...name.trim()][0]?.toLocaleUpperCase() || "Z"}
                    </span>
                    <div>
                      <strong>{name}</strong>
                      <p className="muted">{user.email}</p>
                    </div>
                  </div>
                  <label className="field">
                    Display name
                    <input
                      maxLength={60}
                      value={name}
                      onChange={(e) => {
                        setName(e.target.value);
                        setSaved(false);
                      }}
                    />
                  </label>
                  <p className="fine-print">
                    Your email identifies your account. Email changes are not
                    available here. Recovery is available only when email
                    delivery is configured.
                  </p>
                  <details className="password-details">
                    <summary>Change password</summary>
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        void run(async () => {
                          await api("/account/password", "POST", {
                            currentPassword,
                            newPassword,
                          });
                          onLogout();
                        });
                      }}
                    >
                      <label className="field">
                        Current password
                        <input
                          type="password"
                          autoComplete="current-password"
                          value={currentPassword}
                          onChange={(e) => setCurrentPassword(e.target.value)}
                          required
                          minLength={12}
                        />
                      </label>
                      <label className="field">
                        New password
                        <input
                          type="password"
                          autoComplete="new-password"
                          value={newPassword}
                          onChange={(e) => setNewPassword(e.target.value)}
                          required
                          minLength={12}
                          maxLength={128}
                        />
                      </label>
                      <button className="secondary-button" disabled={busy}>
                        Update & sign out everywhere
                      </button>
                    </form>
                  </details>
                </>
              ) : (
                <div className="notice">
                  Sign in to create your profile and sync conversations across
                  devices.
                </div>
              )}
            </>
          )}
          {tab === "privacy" && (
            <>
              <h3>A clear view of your data.</h3>
              <label className="toggle-row">
                <span>
                  <strong>Use backup AI when needed</strong>
                  <small>
                    If the primary service is temporarily unavailable, send this
                    conversation to Google Gemini.
                  </small>
                </span>
                <input
                  type="checkbox"
                  role="switch"
                  checked={draft.allowFallback}
                  onChange={(e) => change("allowFallback", e.target.checked)}
                />
              </label>
              <div className="privacy-copy">
                <p>
                  ZYRA uses Supabase for email/password authentication. Supabase
                  processes your credentials and stores password hashes.
                  Cloudflare D1 stores your email, display name, preferences,
                  encrypted provider session tokens, and chat history.
                  Conversations are restricted to your account; they are not
                  end-to-end encrypted.
                </p>
                <p>
                  Your messages and a bounded portion of the current
                  conversation are sent to Groq for AI processing. When fallback
                  is enabled, they may be sent to Google Gemini. Google’s free
                  API may use content to improve its products. ZYRA cannot
                  override provider retention or training policies.
                </p>
                <p>
                  Text attachments are included in your saved messages and sent
                  as text to the AI. Voice input is handled by your browser and
                  may use its speech service. External images in AI responses
                  are not loaded.
                </p>
                <p>
                  There is no permanent personal memory or live web search. ZYRA
                  uses context from the current conversation; older turns may be
                  left out. No advertising or analytics tracking is included.
                </p>
                <p>
                  Deleting a conversation removes it from the active database.
                  Account deletion revokes sessions immediately and removes the
                  Supabase identity, profile and chat data. If a service is
                  unavailable, deletion is queued and retried hourly. Deletion
                  identifiers are retained for seven days to prevent stale
                  requests from restoring an account. Infrastructure backups and
                  provider retention may persist under their policies.
                  Pseudonymous abuse counters expire after seven days, subject
                  to periodic cleanup.
                </p>
              </div>
              <div className="privacy-links">
                <a
                  href="https://supabase.com/privacy"
                  target="_blank"
                  rel="noreferrer"
                >
                  Supabase privacy ↗
                </a>
                <a
                  href="https://console.groq.com/docs/your-data"
                  target="_blank"
                  rel="noreferrer"
                >
                  Groq data policy ↗
                </a>
                <a
                  href="https://ai.google.dev/gemini-api/terms"
                  target="_blank"
                  rel="noreferrer"
                >
                  Gemini terms ↗
                </a>
              </div>
              {user && (
                <div className="danger-zone">
                  <button
                    onClick={() => {
                      setDeleting("chats");
                      setConfirm("");
                    }}
                  >
                    <Trash2 size={16} />
                    Clear all conversations
                  </button>
                  <button
                    onClick={() => {
                      setDeleting("account");
                      setConfirm("");
                    }}
                  >
                    Delete my account
                  </button>
                </div>
              )}
              {deleting && (
                <form
                  className="delete-confirm"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void run(async () => {
                      if (deleting === "chats") {
                        await api("/conversations", "DELETE", {
                          confirmation: confirm,
                        });
                        onClear();
                        setDeleting(null);
                      } else {
                        const result = await api<{ pending?: boolean }>(
                          "/account",
                          "DELETE",
                          {
                            confirmation: confirm,
                            password,
                          },
                        );
                        onLogout(
                          result.pending
                            ? "Account access revoked. Deletion is queued and will retry automatically."
                            : "Your account and chat history have been deleted.",
                        );
                      }
                    });
                  }}
                >
                  <strong>
                    {deleting === "chats"
                      ? "Permanently clear all your chats?"
                      : "Permanently delete your account?"}
                  </strong>
                  <p>
                    This cannot be undone. Export any conversation you want to
                    keep first.
                  </p>
                  <label className="field">
                    Type {deleting === "chats" ? "DELETE ALL" : "DELETE"}
                    <input
                      value={confirm}
                      onChange={(e) => setConfirm(e.target.value)}
                      required
                    />
                  </label>
                  {deleting === "account" && (
                    <label className="field">
                      Your password
                      <input
                        type="password"
                        autoComplete="current-password"
                        required
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                      />
                    </label>
                  )}
                  <div className="button-row">
                    <button
                      className="danger-button"
                      disabled={
                        busy ||
                        confirm !==
                          (deleting === "chats" ? "DELETE ALL" : "DELETE")
                      }
                    >
                      Delete permanently
                    </button>
                    <button
                      type="button"
                      className="secondary-button"
                      onClick={() => setDeleting(null)}
                    >
                      Cancel
                    </button>
                  </div>
                </form>
              )}
            </>
          )}
          {tab === "about" && (
            <>
              <div className="about-brand">
                <img src="/zyra.svg" width="64" height="64" alt="ZYRA logo" />
                <div>
                  <h3>ZYRA AI</h3>
                  <span>Your Personal AI Assistant</span>
                </div>
              </div>
              <p className="about-tagline">Intelligence made personal.</p>
              <p className="privacy-copy">
                A thoughtful space to learn something new, find the right words,
                solve a problem, or follow an idea. Built for Malayalam,
                English, and the way you naturally talk.
              </p>
              <div className="about-facts">
                <span>
                  <Globe2 size={16} />
                  Malayalam & English
                </span>
                <span>
                  <ShieldCheck size={16} />
                  Account-specific history
                </span>
              </div>
              <div className="notice">
                ZYRA can make mistakes. Check important answers. Live
                information, web browsing, image understanding, and code
                execution are not available.
              </div>
              <p className="privacy-copy">
                AI is provided by Groq, with optional Google Gemini fallback.
                Availability depends on free provider quotas. Each account
                starts with 20 AI requests a day, resetting at midnight UTC.
                Global and short-term limits may pause access sooner.
                Regenerations and failed provider attempts also use capacity.
              </p>
              <p className="fine-print">
                Voice features depend on your browser and installed languages.
                Malayalam voice quality varies by device. Password recovery
                requires configured email delivery. Supabase Free projects may
                pause after inactivity; account services can be unavailable
                until the owner resumes the project.
              </p>
            </>
          )}
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          {tab !== "about" && (
            <div className="settings-footer">
              <span>
                {saved ? (
                  <>
                    <Check size={14} />
                    Saved
                  </>
                ) : user ? (
                  "Syncs with your account"
                ) : (
                  "Saved on this device"
                )}
              </span>
              <button
                className="primary-button"
                disabled={busy || (!!user && !name.trim())}
                onClick={() =>
                  void run(async () => {
                    await onSave(name, draft);
                    setSaved(true);
                  })
                }
              >
                {busy ? "Saving…" : "Save changes"}
              </button>
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}
