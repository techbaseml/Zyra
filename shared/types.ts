export type Language = "auto" | "en" | "ml";
export type Settings = {
  theme: "dark" | "light" | "system";
  language: Language;
  responseLength: "concise" | "balanced" | "detailed";
  reducedMotion: boolean;
  allowFallback: boolean;
};
export const defaultSettings: Settings = {
  theme: "dark",
  language: "auto",
  responseLength: "balanced",
  reducedMotion: false,
  allowFallback: true,
};
export type User = {
  id: string;
  email: string;
  name: string;
  settings: Settings;
  created_at: number;
};
export type Conversation = {
  id: string;
  title: string;
  created_at: number;
  updated_at: number;
};
export type Message = {
  id: string;
  conversation_id: string;
  role: "user" | "assistant";
  content: string;
  status: "complete" | "interrupted" | "error";
  created_at: number;
  seq: number;
  attachment_name?: string | null;
};
export type AppConfig = {
  aiReady: boolean;
  authReady: boolean;
  registrationEnabled: boolean;
  turnstileSiteKey: string;
  recoveryAvailable: boolean;
  authProvider?: "supabase" | "local";
  dailyLimit: number;
};
export type SessionData = {
  user: User | null;
  csrf: string | null;
  usage: { used: number; limit: number; resetsAt: string };
};
export const FREE_LIMIT_MESSAGE =
  "ZYRA has reached its free usage limit. Please try again later.";
