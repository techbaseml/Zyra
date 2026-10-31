import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  ArrowDown,
  ArrowUpRight,
  BookOpen,
  Check,
  ChevronDown,
  Code2,
  Copy,
  Download,
  Globe2,
  HelpCircle,
  Lightbulb,
  LogOut,
  Menu,
  MessageCircle,
  MessageSquare,
  MoreHorizontal,
  PanelLeftClose,
  Paperclip,
  PenLine,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  ShieldCheck,
  Sparkles,
  Square,
  Trash2,
  Volume2,
  X,
  Zap,
} from "lucide-react";
import {
  defaultSettings,
  type AppConfig,
  type Conversation,
  type Message,
  type SessionData,
  type Settings,
  type User,
} from "../shared/types";
import { readSSE } from "../shared/sse";
import {
  api,
  ApiError,
  copyText,
  download,
  errorMessage,
  setCsrf,
  streamChat,
} from "./lib/api";
import { Brand, Orb } from "./components/Orb";
import Composer, { type Attachment } from "./components/Composer";
import Modal from "./components/Modal";
const Markdown = lazy(() => import("./components/Markdown"));
const AuthModal = lazy(() => import("./components/AuthModal"));
const SettingsModal = lazy(() => import("./components/SettingsModal"));
const initialConfig: AppConfig = {
  aiReady: false,
  authReady: false,
  registrationEnabled: false,
  turnstileSiteKey: "",
  recoveryAvailable: false,
  dailyLimit: 20,
};
const suggestions = [
  {
    title: "Ask Anything",
    subtitle: "Follow your curiosity",
    icon: Sparkles,
    color: "cyan",
    prompt: "Explain something fascinating about the universe.",
  },
  {
    title: "Help Me Code",
    subtitle: "Build something great",
    icon: Code2,
    color: "violet",
    prompt:
      "Help me build a project. First, ask me what I want to create and my coding experience.",
  },
  {
    title: "Creative Writing",
    subtitle: "Find your next words",
    icon: PenLine,
    color: "rose",
    prompt:
      "Help me write a compelling story. Ask me about the genre, characters, and tone.",
  },
  {
    title: "Learn Something",
    subtitle: "Make the complex simple",
    icon: BookOpen,
    color: "blue",
    prompt: "മെഷീൻ ലേണിംഗ് എന്താണ്? ഒരു ലളിതമായ ഉദാഹരണത്തോടെ വിശദീകരിക്കാമോ?",
  },
  {
    title: "Explore Ideas",
    subtitle: "Think a little bigger",
    icon: Lightbulb,
    color: "amber",
    prompt:
      "Help me brainstorm a useful, creative project I can build for free.",
  },
];
function localSettings(): Settings {
  try {
    return {
      ...defaultSettings,
      ...JSON.parse(localStorage.getItem("zyra-preferences") || "{}"),
    };
  } catch {
    return { ...defaultSettings };
  }
}
function initials(name: string) {
  return [...name.trim()][0]?.toLocaleUpperCase() || "Z";
}
function dateLabel(timestamp: number) {
  const date = new Date(timestamp);
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
function separateAttachment(message: Message): {
  text: string;
  attachment: Attachment | null;
} {
  if (!message.attachment_name)
    return { text: message.content, attachment: null };
  const marker = `\n\n[Attached text: ${message.attachment_name}]\n`,
    i = message.content.lastIndexOf(marker);
  return i < 0
    ? { text: message.content, attachment: null }
    : {
        text: message.content.slice(0, i),
        attachment: {
          name: message.attachment_name,
          text: message.content
            .slice(i + marker.length)
            .replace(/\n\[End attached text\]$/, ""),
        },
      };
}
export default function App() {
  const [user, setUser] = useState<User | null>(null),
    [config, setConfig] = useState(initialConfig),
    [settings, setSettings] = useState<Settings>(localSettings),
    [usage, setUsage] = useState({ used: 0, limit: 20, resetsAt: "" }),
    [initializing, setInitializing] = useState(true);
  const [conversations, setConversations] = useState<Conversation[]>([]),
    [activeId, setActiveId] = useState<string | null>(null),
    [messages, setMessages] = useState<Message[]>([]),
    [loadingChat, setLoadingChat] = useState(false),
    [busy, setBusy] = useState(false),
    [value, setValue] = useState(""),
    [attachment, setAttachment] = useState<Attachment | null>(null),
    [editing, setEditing] = useState<Message | null>(null);
  const [sidebar, setSidebar] = useState(false),
    [collapsed, setCollapsed] = useState(false),
    [search, setSearch] = useState(""),
    [searchOpen, setSearchOpen] = useState(false),
    [authOpen, setAuthOpen] = useState(false),
    [settingsTab, setSettingsTab] = useState<string | null>(null),
    [error, setError] = useState(""),
    [toast, setToast] = useState(""),
    [online, setOnline] = useState(navigator.onLine),
    [showJump, setShowJump] = useState(false),
    [speaking, setSpeaking] = useState<string | null>(null);
  const [manage, setManage] = useState<Conversation | null>(null),
    [manageTitle, setManageTitle] = useState(""),
    [deleteConfirm, setDeleteConfirm] = useState(false),
    [manageBusy, setManageBusy] = useState(false),
    [viewAttachment, setViewAttachment] = useState<Attachment | null>(null);
  const [mobile, setMobile] = useState(
    () => matchMedia("(max-width: 768px)").matches,
  );
  const drawer = useRef<HTMLElement>(null);
  const streamRef = useRef<AbortController | null>(null),
    requestIdRef = useRef<string | null>(null),
    scroll = useRef<HTMLDivElement>(null),
    bottom = useRef<HTMLDivElement>(null),
    stick = useRef(true),
    navRequest = useRef<AbortController | null>(null),
    activeRef = useRef(activeId);
  activeRef.current = activeId;
  function notify(message: string) {
    setToast(message);
  }
  const clearSession = useCallback(() => {
    setUser(null);
    setCsrf(null);
    setConversations([]);
    setMessages([]);
    setActiveId(null);
    setSettings(localSettings());
    setSettingsTab(null);
    setUsage({ used: 0, limit: config.dailyLimit, resetsAt: "" });
  }, [config.dailyLimit]);
  function acceptSession(data: SessionData) {
    setUser(data.user);
    setCsrf(data.csrf);
    setUsage(data.usage);
    if (data.user) setSettings(data.user.settings);
    setAuthOpen(false);
  }
  const refreshList = useCallback(async () => {
    setConversations(await api<Conversation[]>("/conversations"));
  }, []);
  useEffect(() => {
    let active = true;
    Promise.all([api<AppConfig>("/config"), api<SessionData>("/me")])
      .then(([c, s]) => {
        if (!active) return;
        setConfig(c);
        setUser(s.user);
        setCsrf(s.csrf);
        setUsage(s.usage);
        if (s.user) setSettings(s.user.settings);
      })
      .catch(() => {
        if (active)
          setError(
            "ZYRA could not connect. Check your network and reload this page.",
          );
      })
      .finally(() => {
        if (active) setInitializing(false);
      });
    return () => {
      active = false;
    };
  }, []);
  useEffect(() => {
    if (user) void refreshList().catch((e) => setError(errorMessage(e)));
  }, [user?.id, refreshList]);
  useEffect(() => {
    const media = matchMedia("(prefers-color-scheme: light)");
    const apply = () => {
      document.documentElement.dataset.theme =
        settings.theme === "system"
          ? media.matches
            ? "light"
            : "dark"
          : settings.theme;
      document.documentElement.dataset.motion = settings.reducedMotion
        ? "reduced"
        : "full";
    };
    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [settings.theme, settings.reducedMotion]);
  useEffect(() => {
    const f = () => setOnline(navigator.onLine);
    window.addEventListener("online", f);
    window.addEventListener("offline", f);
    return () => {
      window.removeEventListener("online", f);
      window.removeEventListener("offline", f);
    };
  }, []);
  useEffect(() => {
    const media = matchMedia("(max-width: 768px)");
    const sync = () => setMobile(media.matches);
    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, []);
  useEffect(() => {
    if (!sidebar || !mobile) return;
    const root = drawer.current;
    const focusable = () =>
      Array.from(
        root?.querySelectorAll<HTMLElement>(
          "button:not(:disabled),input,a[href]",
        ) || [],
      ).filter((el) => el.getClientRects().length > 0);
    focusable()[0]?.focus();
    const trap = (event: KeyboardEvent) => {
      if (event.key !== "Tab") return;
      const elements = focusable(),
        first = elements[0],
        last = elements.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    document.addEventListener("keydown", trap);
    return () => document.removeEventListener("keydown", trap);
  }, [sidebar, mobile]);
  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(""), 3500);
    return () => clearTimeout(id);
  }, [toast]);
  useEffect(() => {
    if (stick.current) bottom.current?.scrollIntoView({ behavior: "instant" });
  }, [messages, busy]);
  useEffect(
    () => () => {
      streamRef.current?.abort();
      navRequest.current?.abort();
      window.speechSynthesis?.cancel();
    },
    [],
  );
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setSearchOpen(true);
        setSidebar(true);
      }
      if (e.key === "Escape") setSidebar(false);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);
  useEffect(() => {
    if (!user || busy) return;
    let alive = true;
    const refresh = async () => {
      if (document.hidden || !navigator.onLine) return;
      try {
        const s = await api<SessionData>("/me");
        if (!alive) return;
        if (!s.user) {
          clearSession();
          return;
        }
        setUser(s.user);
        setCsrf(s.csrf);
        setUsage(s.usage);
        await refreshList();
        const id = activeRef.current;
        if (id) {
          const data = await api<{ messages: Message[] }>(
            `/conversations/${id}`,
          );
          if (alive && id === activeRef.current) setMessages(data.messages);
        }
      } catch (e) {
        if (e instanceof ApiError && e.status === 404 && alive) {
          setActiveId(null);
          setMessages([]);
        }
      }
    };
    const timer = setInterval(() => void refresh(), 30000);
    const focus = () => void refresh();
    window.addEventListener("focus", focus);
    return () => {
      alive = false;
      clearInterval(timer);
      window.removeEventListener("focus", focus);
    };
  }, [user?.id, busy, clearSession, refreshList]);
  async function saveSettings(name: string, next: Settings) {
    if (user) {
      const result = await api<{ user: User }>("/profile", "PATCH", {
        name,
        settings: next,
      });
      setUser(result.user);
    }
    setSettings(next);
    localStorage.setItem("zyra-preferences", JSON.stringify(next));
  }
  function newChat() {
    if (busy) return;
    navRequest.current?.abort();
    setActiveId(null);
    setMessages([]);
    setValue("");
    setAttachment(null);
    setEditing(null);
    setError("");
    setSidebar(false);
    setLoadingChat(false);
    stick.current = true;
    window.speechSynthesis?.cancel();
    setSpeaking(null);
    document.getElementById("chat-input")?.focus();
  }
  async function loadChat(id: string) {
    if (busy) return;
    navRequest.current?.abort();
    const controller = new AbortController();
    navRequest.current = controller;
    setLoadingChat(true);
    setSidebar(false);
    setError("");
    setEditing(null);
    setAttachment(null);
    setValue("");
    try {
      const data = await api<{
        conversation: Conversation;
        messages: Message[];
      }>(`/conversations/${id}`, "GET", undefined, controller.signal);
      setActiveId(id);
      setMessages(data.messages);
      stick.current = true;
    } catch (e) {
      if (!controller.signal.aborted) setError(errorMessage(e));
    } finally {
      if (!controller.signal.aborted) setLoadingChat(false);
    }
  }
  async function refreshAfterStream(id: string | null) {
    try {
      const data = await api<SessionData>("/me");
      setUsage(data.usage);
      await refreshList();
      if (id && activeRef.current === id) {
        const c = await api<{ messages: Message[] }>(`/conversations/${id}`);
        setMessages(c.messages);
      }
    } catch {
      /* Existing response remains readable during a network outage. */
    }
  }
  async function send(
    mode: "send" | "regenerate" | "edit" = editing ? "edit" : "send",
  ) {
    if (busy || loadingChat) return;
    if (!user) {
      setAuthOpen(true);
      return;
    }
    if (!online) {
      setError("You are offline. Reconnect to send your message.");
      return;
    }
    const content =
      value.trim() ||
      (attachment ? "Please summarize this attached text." : "");
    if (mode !== "regenerate" && !content) return;
    const controller = new AbortController(),
      requestId = crypto.randomUUID();
    streamRef.current = controller;
    requestIdRef.current = requestId;
    setBusy(true);
    setError("");
    stick.current = true;
    setSidebar(false);
    let currentId = activeId,
      assistantId = crypto.randomUUID(),
      accepted = false,
      done = false;
    const previous = messages;
    try {
      const stream = await streamChat(
        {
          requestId,
          conversationId: activeId,
          mode,
          content,
          messageId: editing?.id,
          attachment: mode === "regenerate" ? undefined : attachment,
        },
        controller.signal,
      );
      accepted = true;
      let base = previous;
      if (mode === "edit" && editing)
        base = previous.filter((m) => m.seq < editing.seq);
      if (mode === "regenerate") {
        const last = [...previous].reverse().find((m) => m.role === "user");
        base = last ? previous.filter((m) => m.seq <= last.seq) : previous;
      }
      const seq = (base.at(-1)?.seq ?? -1) + 1;
      if (mode !== "regenerate")
        base = [
          ...base,
          {
            id: crypto.randomUUID(),
            conversation_id: activeId || "",
            role: "user",
            content:
              content +
              (attachment
                ? `\n\n[Attached text: ${attachment.name}]\n${attachment.text}\n[End attached text]`
                : ""),
            attachment_name: attachment?.name,
            status: "complete",
            created_at: Date.now(),
            seq,
          },
        ];
      setMessages([
        ...base,
        {
          id: assistantId,
          conversation_id: activeId || "",
          role: "assistant",
          content: "",
          status: "complete",
          created_at: Date.now(),
          seq: seq + 1,
        },
      ]);
      setValue("");
      setAttachment(null);
      setEditing(null);
      for await (const event of readSSE(stream)) {
        const data = JSON.parse(event.data);
        if (event.event === "meta") {
          currentId = data.conversationId;
          setActiveId(currentId);
          activeRef.current = currentId;
          const old = assistantId;
          assistantId = data.assistantId;
          setMessages((m) =>
            m.map((x) =>
              x.id === old
                ? { ...x, id: assistantId, conversation_id: currentId! }
                : x,
            ),
          );
        }
        if (event.event === "delta")
          setMessages((m) =>
            m.map((x) =>
              x.id === assistantId
                ? { ...x, content: x.content + data.text }
                : x,
            ),
          );
        if (event.event === "error") {
          setError(data.message);
          setMessages((m) =>
            m.map((x) =>
              x.id === assistantId
                ? { ...x, status: x.content ? "interrupted" : "error" }
                : x,
            ),
          );
        }
        if (event.event === "done") done = true;
      }
      if (!done)
        throw new Error(
          "The connection ended before the response completed. Reload the conversation before retrying.",
        );
    } catch (e) {
      if (controller.signal.aborted) {
        setMessages((m) =>
          m.map((x) =>
            x.id === assistantId ? { ...x, status: "interrupted" } : x,
          ),
        );
        notify("Response stopped.");
      } else {
        setError(errorMessage(e));
        if (e instanceof ApiError && e.status === 401) setAuthOpen(true);
        if (accepted)
          setMessages((m) =>
            m.map((x) =>
              x.id === assistantId ? { ...x, status: "interrupted" } : x,
            ),
          );
      }
    } finally {
      setBusy(false);
      streamRef.current = null;
      requestIdRef.current = null;
      if (accepted) setTimeout(() => void refreshAfterStream(currentId), 400);
      else void refreshAfterStream(activeId);
    }
  }
  async function stop() {
    const id = requestIdRef.current;
    if (id) void api("/chat/stop", "POST", { requestId: id }).catch(() => {});
    streamRef.current?.abort();
  }
  async function logout() {
    if (busy) return;
    try {
      await api("/auth/logout", "POST", {});
      clearSession();
      notify("You’re signed out.");
    } catch (e) {
      setError(errorMessage(e));
    }
  }
  function editMessage(message: Message) {
    if (busy) return;
    const p = separateAttachment(message);
    setEditing(message);
    setValue(p.text);
    setAttachment(p.attachment);
  }
  function speak(message: Message) {
    if (speaking === message.id) {
      speechSynthesis.cancel();
      setSpeaking(null);
      return;
    }
    speechSynthesis.cancel();
    const speech = new SpeechSynthesisUtterance(
      message.content
        .replace(/```[\s\S]*?```/g, " Code block omitted. ")
        .replace(/[*#`]/g, ""),
    );
    speech.lang = /[\u0D00-\u0D7F]/.test(message.content) ? "ml-IN" : "en-IN";
    const voice = speechSynthesis
      .getVoices()
      .find((v) => v.lang.startsWith(speech.lang.slice(0, 2)));
    if (voice) speech.voice = voice;
    speech.onend = () => setSpeaking(null);
    speech.onerror = () => {
      setSpeaking(null);
      notify("Read aloud is unavailable for this language on this device.");
    };
    setSpeaking(message.id);
    speechSynthesis.speak(speech);
  }
  const activeConversation = conversations.find((c) => c.id === activeId),
    filtered = conversations.filter((c) =>
      c.title.toLocaleLowerCase().includes(search.toLocaleLowerCase()),
    ),
    welcome = !messages.length && !busy && !loadingChat;
  return (
    <div className={`app-shell ${collapsed ? "sidebar-collapsed" : ""}`}>
      <a className="skip-link" href="#chat-input">
        Skip to message composer
      </a>
      {sidebar && (
        <button
          className="drawer-backdrop"
          aria-label="Close navigation"
          onClick={() => setSidebar(false)}
        />
      )}
      <aside
        ref={drawer}
        inert={mobile && !sidebar}
        className={`sidebar ${sidebar ? "sidebar-open" : ""}`}
        aria-label="Main navigation"
      >
        <div className="sidebar-brand">
          <Brand />
          <button
            className="icon-button desktop-collapse"
            title="Collapse sidebar"
            aria-label="Collapse sidebar"
            onClick={() => setCollapsed(!collapsed)}
          >
            <PanelLeftClose size={18} />
          </button>
          <button
            className="icon-button mobile-close"
            aria-label="Close sidebar"
            onClick={() => setSidebar(false)}
          >
            <X size={20} />
          </button>
        </div>
        <button className="new-chat" onClick={newChat} disabled={busy}>
          <Plus size={18} />
          <span>New conversation</span>
          <span className="new-shortcut">↗</span>
        </button>
        <button
          className={`search-button ${searchOpen ? "active" : ""}`}
          onClick={() => {
            setSearchOpen(!searchOpen);
            setCollapsed(false);
          }}
        >
          <Search size={17} />
          <span>Search conversations</span>
          <kbd>⌘ K</kbd>
        </button>
        {searchOpen && (
          <div className="sidebar-search">
            <input
              autoFocus
              aria-label="Search conversations"
              placeholder="Search your chats…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <button
              className="icon-button"
              aria-label="Clear search"
              onClick={() => setSearch("")}
            >
              <X size={14} />
            </button>
          </div>
        )}
        <div className="history-label">
          <span>{search ? "SEARCH RESULTS" : "YOUR CONVERSATIONS"}</span>
          <span>{conversations.length || ""}</span>
        </div>
        <nav className="history-list" aria-label="Chat history">
          {initializing ? (
            <div className="sidebar-skeleton">
              <span />
              <span />
              <span />
            </div>
          ) : filtered.length ? (
            filtered.map((c) => (
              <div
                className={`history-row ${activeId === c.id ? "active" : ""}`}
                key={c.id}
              >
                <button
                  disabled={busy}
                  onClick={() => void loadChat(c.id)}
                  title={c.title}
                >
                  <MessageSquare size={15} />
                  <span>{c.title}</span>
                </button>
                <button
                  className="history-menu"
                  disabled={busy}
                  aria-label={`Manage ${c.title}`}
                  onClick={() => {
                    setManage(c);
                    setManageTitle(c.title);
                    setDeleteConfirm(false);
                  }}
                >
                  <MoreHorizontal size={16} />
                </button>
              </div>
            ))
          ) : (
            <div className="history-empty">
              <MessageCircle size={25} strokeWidth={1.2} />
              <strong>
                {search
                  ? "No matching conversations"
                  : "A fresh space for your thoughts"}
              </strong>
              <p>
                {search
                  ? "Try another word."
                  : user
                    ? "Your conversations will find a home here."
                    : "Sign in to keep your ideas close, wherever you go."}
              </p>
              {!user && (
                <button onClick={() => setAuthOpen(true)}>
                  Create your space <ArrowUpRight size={13} />
                </button>
              )}
            </div>
          )}
        </nav>
        <div className="sidebar-bottom">
          <div className="free-card">
            <div>
              <span className="free-icon">
                <Zap size={15} />
              </span>
              <strong>A little more possibility</strong>
            </div>
            <p>Space to learn. Freedom to create.</p>
            <div className="usage-line">
              <span>
                {user
                  ? `${Math.max(0, usage.limit - usage.used)} of ${usage.limit} requests left`
                  : "Free to use. Made for you."}
              </span>
              <span className="free-badge">FREE</span>
            </div>
            {user && (
              <div className="usage-track">
                <span
                  style={{
                    width: `${Math.min(100, (usage.used / usage.limit) * 100)}%`,
                  }}
                />
              </div>
            )}
          </div>
          <button
            className="sidebar-setting"
            onClick={() => setSettingsTab("general")}
          >
            <Settings2 size={17} />
            <span>Settings & preferences</span>
          </button>
          <div className="profile-row">
            <button
              className="profile-button"
              onClick={() =>
                user ? setSettingsTab("profile") : setAuthOpen(true)
              }
            >
              <span className="avatar">
                {user ? initials(user.name) : <UserIcon />}
              </span>
              <span>
                <strong>{user?.name || "Your personal space"}</strong>
                <small>
                  {user ? "Personal account" : "Sign in to get started"}
                </small>
              </span>
            </button>
            {user && (
              <button
                className="icon-button"
                title="Sign out"
                aria-label="Sign out"
                disabled={busy}
                onClick={() => void logout()}
              >
                <LogOut size={16} />
              </button>
            )}
          </div>
        </div>
      </aside>
      <main inert={mobile && sidebar} className="main-panel">
        <header className="topbar">
          <div className="topbar-left">
            <button
              className="icon-button menu-button"
              aria-label="Open navigation"
              onClick={() => {
                setSidebar(true);
                setCollapsed(false);
              }}
            >
              <Menu size={20} />
            </button>
            {collapsed && (
              <button
                className="icon-button expand-button"
                aria-label="Expand sidebar"
                onClick={() => setCollapsed(false)}
              >
                <Menu size={18} />
              </button>
            )}
            <span className="workspace-label">Personal workspace</span>
            <span className="breadcrumb-separator">/</span>
            <span className="page-label">
              {activeConversation?.title || "New conversation"}
            </span>
          </div>
          <div className="topbar-right">
            <label className="language-control">
              <Globe2 size={14} />
              <select
                aria-label="Preferred language"
                value={settings.language}
                onChange={(e) =>
                  void saveSettings(user?.name || "", {
                    ...settings,
                    language: e.target.value as Settings["language"],
                  }).catch((err) => setError(errorMessage(err)))
                }
              >
                <option value="auto">Auto language</option>
                <option value="en">English</option>
                <option value="ml">മലയാളം</option>
              </select>
              <ChevronDown size={12} />
            </label>
            <button
              className="icon-button"
              title="About ZYRA"
              aria-label="About ZYRA"
              onClick={() => setSettingsTab("about")}
            >
              <HelpCircle size={18} />
            </button>
            {!user && (
              <button
                className="signin-button"
                onClick={() => setAuthOpen(true)}
              >
                Sign in
                <ArrowUpRight size={13} />
              </button>
            )}
          </div>
        </header>
        <div
          className="conversation-scroll"
          ref={scroll}
          onScroll={() => {
            const el = scroll.current;
            if (el) {
              stick.current =
                el.scrollHeight - el.scrollTop - el.clientHeight < 160;
              setShowJump(!stick.current);
            }
          }}
        >
          {welcome ? (
            <section className="welcome">
              <div className="welcome-orbit">
                <span className="orbit-dot dot-a" />
                <span className="orbit-dot dot-b" />
                <Orb />
              </div>
              <div className="welcome-eyebrow">
                <span />
                YOUR PERSONAL AI ASSISTANT
              </div>
              <h1>
                Hello{user ? `, ${user.name.split(" ")[0]}` : ""}.{" "}
                <span>I'm ZYRA.</span>
              </h1>
              <h2>How can I help you today?</h2>
              <p className="welcome-copy">
                A place for your questions, your next big idea,
                <br className="desktop-break" /> and everything in between.
              </p>
              <div className="suggestions">
                {suggestions.map((s) => (
                  <button
                    key={s.title}
                    className={`suggestion ${s.color}`}
                    onClick={() => {
                      setValue(s.prompt);
                      document.getElementById("chat-input")?.focus();
                    }}
                  >
                    <div className="suggestion-top">
                      <span>
                        <s.icon size={19} strokeWidth={1.7} />
                      </span>
                      <ArrowUpRight size={14} />
                    </div>
                    <strong>{s.title}</strong>
                    <small>{s.subtitle}</small>
                  </button>
                ))}
              </div>
              <div className="welcome-caption">
                <span className="caption-rule" />
                <span>START WITH A LITTLE CURIOSITY</span>
                <span className="caption-rule" />
              </div>
            </section>
          ) : (
            <div className="messages">
              {loadingChat ? (
                <div className="chat-skeleton">
                  <div />
                  <div />
                  <div />
                </div>
              ) : (
                messages.map((message, i) => {
                  const userMessage = message.role === "user",
                    parts = userMessage ? separateAttachment(message) : null;
                  return (
                    <article
                      key={message.id}
                      className={`message ${userMessage ? "user-message" : "assistant-message"}`}
                    >
                      <div className="message-avatar">
                        {userMessage ? (
                          <span className="avatar">
                            {initials(user?.name || "You")}
                          </span>
                        ) : (
                          <Brand compact />
                        )}
                      </div>
                      <div className="message-body">
                        <div className="message-heading">
                          <strong>
                            {userMessage ? user?.name || "You" : "ZYRA"}
                          </strong>
                          {!userMessage && (
                            <span className="assistant-label">AI</span>
                          )}
                          <time
                            dateTime={new Date(
                              message.created_at,
                            ).toISOString()}
                          >
                            {new Date(message.created_at).toLocaleTimeString(
                              undefined,
                              { hour: "2-digit", minute: "2-digit" },
                            )}
                          </time>
                        </div>
                        {userMessage ? (
                          <>
                            <p className="user-text" dir="auto">
                              {parts!.text}
                            </p>
                            {parts!.attachment && (
                              <button
                                className="message-attachment"
                                onClick={() =>
                                  setViewAttachment(parts!.attachment)
                                }
                              >
                                <Paperclip size={14} />
                                {parts!.attachment.name}
                              </button>
                            )}
                          </>
                        ) : message.content ? (
                          <Suspense
                            fallback={
                              <p className="user-text">{message.content}</p>
                            }
                          >
                            <Markdown text={message.content} />
                          </Suspense>
                        ) : busy && i === messages.length - 1 ? (
                          <div className="thinking" role="status">
                            <span />
                            <span />
                            <span />
                            <small>Thinking with you</small>
                          </div>
                        ) : (
                          <p className="muted">
                            No answer was generated. You can try again.
                          </p>
                        )}
                        {message.status === "interrupted" && (
                          <span className="interrupted-label">
                            Response interrupted
                          </span>
                        )}
                        {!busy && (
                          <div className="message-actions">
                            <button
                              aria-label="Copy message"
                              title="Copy message"
                              onClick={() =>
                                void copyText(message.content)
                                  .then(() => notify("Copied to clipboard."))
                                  .catch((e) => notify(errorMessage(e)))
                              }
                            >
                              <Copy size={14} />
                            </button>
                            {userMessage ? (
                              <button
                                aria-label="Edit question"
                                title="Edit question"
                                onClick={() => editMessage(message)}
                              >
                                <PenLine size={14} />
                              </button>
                            ) : (
                              <>
                                {i === messages.length - 1 && (
                                  <button
                                    aria-label="Regenerate response"
                                    title="Regenerate response"
                                    onClick={() => void send("regenerate")}
                                  >
                                    <RefreshCw size={14} />
                                  </button>
                                )}
                                {message.content &&
                                  "speechSynthesis" in window && (
                                    <button
                                      aria-label={
                                        speaking === message.id
                                          ? "Stop reading"
                                          : "Read aloud"
                                      }
                                      title={
                                        speaking === message.id
                                          ? "Stop reading"
                                          : "Read aloud"
                                      }
                                      onClick={() => speak(message)}
                                    >
                                      {speaking === message.id ? (
                                        <Square size={14} />
                                      ) : (
                                        <Volume2 size={14} />
                                      )}
                                    </button>
                                  )}
                              </>
                            )}
                          </div>
                        )}
                      </div>
                    </article>
                  );
                })
              )}
              {busy && messages.length === 0 && (
                <div className="thinking standalone">
                  <span />
                  <span />
                  <span />
                  <small>Connecting to ZYRA…</small>
                </div>
              )}
              {!busy && messages.length > 0 && (
                <button
                  className="export-chat"
                  onClick={() => {
                    download(
                      `ZYRA-${dateLabel(Date.now()).replace(/\s/g, "-")}.md`,
                      `# ${activeConversation?.title || "ZYRA conversation"}\n\n${messages.map((m) => `## ${m.role === "user" ? "You" : "ZYRA"}\n\n${m.content}${m.status !== "complete" ? `\n\n[${m.status}]` : ""}`).join("\n\n---\n\n")}`,
                    );
                    notify("Conversation exported.");
                  }}
                >
                  <Download size={13} />
                  Export conversation
                </button>
              )}
            </div>
          )}
          <div ref={bottom} />
        </div>
        {showJump && !welcome && (
          <button
            className="jump-button"
            aria-label="Jump to latest message"
            onClick={() => {
              stick.current = true;
              bottom.current?.scrollIntoView({
                behavior: settings.reducedMotion ? "instant" : "smooth",
              });
            }}
          >
            <ArrowDown size={16} />
          </button>
        )}
        <div className={`composer-area ${welcome ? "welcome-composer" : ""}`}>
          {(!online || error) && (
            <div className="chat-error" role="alert">
              <span>
                {!online
                  ? "You are offline. Your draft stays here until you reconnect."
                  : error}
              </span>
              <button
                className="icon-button"
                aria-label="Dismiss error"
                onClick={() => setError("")}
              >
                <X size={15} />
              </button>
            </div>
          )}
          <Composer
            value={value}
            onChange={setValue}
            onSend={() => void send()}
            busy={busy}
            onStop={() => void stop()}
            language={settings.language}
            attachment={attachment}
            onAttachment={setAttachment}
            onError={setError}
            editing={!!editing}
            onCancelEdit={() => {
              setEditing(null);
              setValue("");
              setAttachment(null);
            }}
          />
          <div className="composer-footnote">
            <span>
              <ShieldCheck size={12} />
              {config.aiReady
                ? "ZYRA can make mistakes. Check important information."
                : "AI connection awaiting setup"}
              <button
                onClick={() =>
                  setSettingsTab(config.aiReady ? "privacy" : "about")
                }
              >
                {config.aiReady ? "Privacy" : "Learn more"}
              </button>
            </span>
            <span className="powered-label">INTELLIGENCE MADE PERSONAL</span>
          </div>
        </div>
      </main>
      {toast && (
        <div className="toast" role="status">
          <Check size={15} />
          {toast}
        </div>
      )}
      <Suspense
        fallback={
          <div className="modal-loading" role="status">
            Opening…
          </div>
        }
      >
        {authOpen && (
          <AuthModal
            config={config}
            onClose={() => setAuthOpen(false)}
            onSuccess={acceptSession}
          />
        )}
        {settingsTab && (
          <SettingsModal
            initial={settingsTab}
            user={user}
            settings={settings}
            onClose={() => setSettingsTab(null)}
            onSave={saveSettings}
            onClear={() => {
              setConversations([]);
              newChat();
              notify("Conversations cleared.");
            }}
            onLogout={() => {
              clearSession();
              notify("Account updated. You are signed out.");
            }}
          />
        )}
      </Suspense>
      {manage && (
        <Modal title="Your conversation" onClose={() => setManage(null)}>
          <p className="fine-print">
            Created {dateLabel(manage.created_at)} · Updated{" "}
            {dateLabel(manage.updated_at)}
          </p>
          <label className="field">
            Conversation name
            <input
              maxLength={80}
              value={manageTitle}
              onChange={(e) => setManageTitle(e.target.value)}
            />
          </label>
          <button
            className="primary-button full"
            disabled={manageBusy || !manageTitle.trim()}
            onClick={async () => {
              setManageBusy(true);
              try {
                await api(`/conversations/${manage.id}`, "PATCH", {
                  title: manageTitle,
                });
                await refreshList();
                setManage(null);
              } catch (e) {
                notify(errorMessage(e));
              } finally {
                setManageBusy(false);
              }
            }}
          >
            Save name
          </button>
          <div className="danger-zone">
            <button onClick={() => setDeleteConfirm(true)}>
              <Trash2 size={15} />
              Delete conversation
            </button>
          </div>
          {deleteConfirm && (
            <div className="delete-confirm">
              <p>This permanently deletes this conversation.</p>
              <button
                className="danger-button"
                disabled={manageBusy}
                onClick={async () => {
                  setManageBusy(true);
                  try {
                    await api(`/conversations/${manage.id}`, "DELETE", {});
                    if (activeId === manage.id) newChat();
                    await refreshList();
                    setManage(null);
                    notify("Conversation deleted.");
                  } catch (e) {
                    notify(errorMessage(e));
                  } finally {
                    setManageBusy(false);
                  }
                }}
              >
                Delete permanently
              </button>
            </div>
          )}
        </Modal>
      )}
      {viewAttachment && (
        <Modal
          title={viewAttachment.name}
          onClose={() => setViewAttachment(null)}
        >
          <pre className="attachment-preview">{viewAttachment.text}</pre>
        </Modal>
      )}
    </div>
  );
}
function UserIcon() {
  return <span className="guest-avatar">Z</span>;
}
