import { useEffect, useRef, useState } from "react";
import { ArrowUp, FileText, Mic, Paperclip, Square, X } from "lucide-react";
import type { Settings } from "../../shared/types";
import { recognitionConstructor, type Recognition } from "../lib/speech";
import Modal from "./Modal";
export type Attachment = { name: string; text: string };
export default function Composer({
  value,
  onChange,
  onSend,
  busy,
  onStop,
  language,
  attachment,
  onAttachment,
  onError,
  editing,
  onCancelEdit,
}: {
  value: string;
  onChange: (s: string) => void;
  onSend: () => void;
  busy: boolean;
  onStop: () => void;
  language: Settings["language"];
  attachment: Attachment | null;
  onAttachment: (v: Attachment | null) => void;
  onError: (message: string) => void;
  editing: boolean;
  onCancelEdit: () => void;
}) {
  const input = useRef<HTMLTextAreaElement>(null),
    file = useRef<HTMLInputElement>(null),
    recognition = useRef<Recognition | null>(null);
  const [listening, setListening] = useState(false),
    [preview, setPreview] = useState(false),
    [voiceConsent, setVoiceConsent] = useState(false);
  const supportsVoice = !!recognitionConstructor() && window.isSecureContext;
  useEffect(() => {
    if (input.current) {
      input.current.style.height = "auto";
      input.current.style.height = `${Math.min(input.current.scrollHeight, 180)}px`;
    }
  }, [value]);
  useEffect(() => () => recognition.current?.abort(), []);
  useEffect(() => {
    if (editing) input.current?.focus();
  }, [editing]);
  function startVoice() {
    setVoiceConsent(false);
    const C = recognitionConstructor();
    if (!C) return;
    const r = new C();
    r.lang = language === "ml" ? "ml-IN" : "en-IN";
    r.interimResults = false;
    r.continuous = false;
    r.onresult = (e) => {
      const text = Array.from(e.results)
        .map((x) => x[0].transcript)
        .join(" ");
      onChange(value + (value ? " " : "") + text);
    };
    r.onerror = (e) => {
      onError(
        e.error === "not-allowed"
          ? "Microphone access was denied. Enable it in your browser settings."
          : `Voice input is unavailable (${e.error}). You can type instead.`,
      );
      setListening(false);
    };
    r.onend = () => setListening(false);
    recognition.current = r;
    try {
      r.start();
      setListening(true);
    } catch {
      onError("Voice input could not start in this browser.");
    }
  }
  async function attach(selected: File | undefined) {
    if (!selected) return;
    if (selected.size > 12_000) {
      onError("Choose a text file smaller than 12 KB.");
      return;
    }
    if (
      !/\.(txt|md|csv|json|py|js|ts|tsx|jsx|css|html|xml|log|yaml|yml)$/i.test(
        selected.name,
      )
    ) {
      onError(
        "Supported files: plain text, Markdown, CSV, JSON, and source code.",
      );
      return;
    }
    try {
      const text = await selected.text();
      if (!text.trim() || text.includes("\0") || text.includes("\ufffd"))
        throw new Error();
      onAttachment({ name: selected.name, text });
    } catch {
      onError("This file could not be read as UTF-8 text.");
    }
  }
  return (
    <>
      <div className={`composer ${busy ? "composer-busy" : ""}`}>
        {editing && (
          <div className="edit-notice">
            <span>
              Editing this question replaces the conversation from this point.
            </span>
            <button
              className="icon-button"
              aria-label="Cancel editing"
              onClick={onCancelEdit}
            >
              <X size={14} />
            </button>
          </div>
        )}
        {attachment && (
          <div className="attachment-chip">
            <button onClick={() => setPreview(true)}>
              <FileText size={15} />
              {attachment.name}
            </button>
            <button
              aria-label="Remove attachment"
              onClick={() => onAttachment(null)}
            >
              <X size={14} />
            </button>
          </div>
        )}
        <textarea
          ref={input}
          id="chat-input"
          aria-label="Message ZYRA"
          placeholder="Ask ZYRA anything..."
          value={value}
          onChange={(e) => onChange(e.target.value)}
          rows={1}
          maxLength={4000}
          disabled={busy}
          onKeyDown={(e) => {
            if (
              e.key === "Enter" &&
              !e.shiftKey &&
              !e.nativeEvent.isComposing &&
              window.matchMedia("(min-width: 768px)").matches
            ) {
              e.preventDefault();
              if (value.trim() || attachment) onSend();
            }
          }}
        />
        <div className="composer-toolbar">
          <div className="composer-tools">
            <button
              className="icon-button"
              title="Attach a text or code file (up to 12 KB)"
              aria-label="Attach a text file"
              onClick={() => file.current?.click()}
              disabled={busy}
            >
              <Paperclip size={19} />
            </button>
            <input
              ref={file}
              hidden
              type="file"
              accept=".txt,.md,.csv,.json,.py,.js,.ts,.tsx,.jsx,.css,.html,.xml,.log,.yaml,.yml"
              onChange={(e) => {
                void attach(e.target.files?.[0]);
                e.target.value = "";
              }}
            />
            {supportsVoice && (
              <button
                className={`icon-button ${listening ? "listening" : ""}`}
                title="Browser voice input"
                aria-label={listening ? "Stop listening" : "Start voice input"}
                disabled={busy}
                onClick={() => {
                  if (listening) {
                    recognition.current?.stop();
                    setListening(false);
                  } else setVoiceConsent(true);
                }}
              >
                {listening ? <Square size={17} /> : <Mic size={19} />}
              </button>
            )}
            <span className="composer-divider" />
            <span className="composer-language">
              {listening
                ? "Listening…"
                : language === "ml"
                  ? "മലയാളം"
                  : language === "en"
                    ? "English"
                    : "Any thought. Any language."}
            </span>
          </div>
          <div className="composer-submit">
            <span className="enter-hint">
              {editing ? "Save & resend" : "Shift + Enter for a new line"}
            </span>
            <button
              className="send-button"
              title={busy ? "Stop generation" : "Send message"}
              aria-label={busy ? "Stop generation" : "Send message"}
              disabled={!busy && !value.trim() && !attachment}
              onClick={busy ? onStop : onSend}
            >
              {busy ? (
                <Square size={15} fill="currentColor" />
              ) : (
                <ArrowUp size={20} />
              )}
            </button>
          </div>
        </div>
      </div>
      {preview && attachment && (
        <Modal title={attachment.name} onClose={() => setPreview(false)}>
          <p className="fine-print">
            This text will be sent with your message and saved in the
            conversation.
          </p>
          <pre className="attachment-preview">{attachment.text}</pre>
        </Modal>
      )}
      {voiceConsent && (
        <Modal title="Speak your mind" onClose={() => setVoiceConsent(false)}>
          <p className="modal-intro">
            Voice input uses your browser’s speech recognition, which may send
            audio to its speech service. Choose Malayalam in the language menu
            for Malayalam recognition. Availability varies by browser.
          </p>
          <button className="primary-button full" onClick={startVoice}>
            <Mic size={17} />
            Start listening
          </button>
        </Modal>
      )}
    </>
  );
}
