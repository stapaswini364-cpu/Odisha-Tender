import { pgTable, uuid, text, integer, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

// 1. Organisations table
export const organisations = pgTable("organisations", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull(),
  lastKnownCount: integer("last_known_count").default(0),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
}, (table) => ({
  nameUnique: uniqueIndex("organisations_name_unique").on(table.name),
}));

// 2. Tenders table
export const tenders = pgTable("tenders", {
  id: uuid("id").defaultRandom().primaryKey(),
  organisationId: uuid("organisation_id").references(() => organisations.id),
  externalKey: text("external_key").notNull(),
  title: text("title"),
  referenceNo: text("reference_no"),
  type: text("type"), // "tender" or "corrigendum"
  sourceUrl: text("source_url"),
  publishedAt: timestamp("published_at", { withTimezone: true }),
  detectedAt: timestamp("detected_at", { withTimezone: true }).defaultNow(),
  notifiedAt: timestamp("notified_at", { withTimezone: true }),
  notificationStatus: text("notification_status").default("pending"), // pending / sent / failed
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
}, (table) => ({
  externalKeyUnique: uniqueIndex("tenders_external_key_unique").on(table.externalKey),
}));

// 3. Snapshots table
export const snapshots = pgTable("snapshots", {
  id: uuid("id").defaultRandom().primaryKey(),
  organisationId: uuid("organisation_id").references(() => organisations.id),
  snapshotHash: text("snapshot_hash"),
  itemCount: integer("item_count"),
  capturedAt: timestamp("captured_at", { withTimezone: true }).defaultNow(),
});

// 4. Job runs table
export const jobRuns = pgTable("job_runs", {
  id: uuid("id").defaultRandom().primaryKey(),
  startedAt: timestamp("started_at", { withTimezone: true }).defaultNow(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  status: text("status").default("running"), // running / success / failed / captcha_failed
  newItemsFound: integer("new_items_found").default(0),
  notificationsSent: integer("notifications_sent").default(0),
  durationMs: integer("duration_ms"),
  errorMessage: text("error_message"),
});

// 5. Notification logs table
export const notificationLogs = pgTable("notification_logs", {
  id: uuid("id").defaultRandom().primaryKey(),
  tenderId: uuid("tender_id").references(() => tenders.id),
  chatId: text("chat_id"),
  messageId: text("message_id"),
  status: text("status"), // sent / failed
  attemptCount: integer("attempt_count").default(0),
  sentAt: timestamp("sent_at", { withTimezone: true }),
  errorMessage: text("error_message"),
});

// 6. Scraper state table (to track batch progress / cursor across cron runs)
export const scraperState = pgTable("scraper_state", {
  id: uuid("id").defaultRandom().primaryKey(),
  key: text("key").notNull(),
  cursor: integer("cursor").default(0),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
}, (table) => ({
  keyUnique: uniqueIndex("scraper_state_key_unique").on(table.key),
}));