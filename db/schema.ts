import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core";
export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  password_hash: text("password_hash").notNull(),
  auth_subject: text("auth_subject").unique(),
  settings: text("settings").notNull(),
  created_at: integer("created_at").notNull(),
  consent_at: integer("consent_at").notNull(),
});
export const sessions = sqliteTable(
  "sessions",
  {
    token_hash: text("token_hash").primaryKey(),
    user_id: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    csrf: text("csrf").notNull(),
    expires_at: integer("expires_at").notNull(),
    provider_tokens: text("provider_tokens"),
    provider_expires_at: integer("provider_expires_at"),
    refresh_lock_id: text("refresh_lock_id"),
    refresh_lock_until: integer("refresh_lock_until").notNull().default(0),
  },
  (t) => [
    index("sessions_user").on(t.user_id),
    index("sessions_expiry").on(t.expires_at),
  ],
);
export const authDeletions = sqliteTable("auth_deletions", {
  auth_subject: text("auth_subject").primaryKey(),
  user_id: text("user_id").notNull(),
  requested_at: integer("requested_at").notNull(),
  completed_at: integer("completed_at"),
});
export const conversations = sqliteTable(
  "conversations",
  {
    id: text("id").primaryKey(),
    user_id: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    created_at: integer("created_at").notNull(),
    updated_at: integer("updated_at").notNull(),
  },
  (t) => [index("conversations_owner_updated").on(t.user_id, t.updated_at)],
);
export const messages = sqliteTable(
  "messages",
  {
    id: text("id").primaryKey(),
    conversation_id: text("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    role: text("role").notNull(),
    content: text("content").notNull(),
    status: text("status").notNull(),
    created_at: integer("created_at").notNull(),
    seq: integer("seq").notNull(),
    attachment_name: text("attachment_name"),
  },
  (t) => [index("messages_conversation_seq").on(t.conversation_id, t.seq)],
);
// Usage is intentionally independent of user deletion: deleting an account cannot reset daily protection.
export const usageEvents = sqliteTable(
  "usage_events",
  {
    id: text("id").primaryKey(),
    user_id: text("user_id").notNull(),
    ip_hash: text("ip_hash").notNull(),
    day: text("day").notNull(),
    budget: integer("budget").notNull(),
    created_at: integer("created_at").notNull(),
  },
  (t) => [
    index("usage_user_day").on(t.user_id, t.day),
    index("usage_day").on(t.day),
    index("usage_ip_day").on(t.ip_hash, t.day),
  ],
);
export const throttle = sqliteTable(
  "throttle",
  {
    key: text("key").primaryKey(),
    hits: integer("hits").notNull(),
    expires_at: integer("expires_at").notNull(),
  },
  (t) => [index("throttle_expiry").on(t.expires_at)],
);
export const providerUsage = sqliteTable(
  "provider_usage",
  {
    id: text("id").primaryKey(),
    provider: text("provider").notNull(),
    day: text("day").notNull(),
    budget: integer("budget").notNull(),
    created_at: integer("created_at").notNull(),
  },
  (t) => [
    index("provider_usage_day").on(t.provider, t.day),
    index("provider_usage_time").on(t.provider, t.created_at),
  ],
);
export const generationLocks = sqliteTable("generation_locks", {
  user_id: text("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  request_id: text("request_id").notNull().unique(),
  conversation_id: text("conversation_id").notNull(),
  expires_at: integer("expires_at").notNull(),
  cancelled: integer("cancelled").notNull().default(0),
});
