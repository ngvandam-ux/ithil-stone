import { pgTable, text, integer, serial } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// ── Users table ──────────────────────────────────────────────────────
export const users = pgTable("users", {
  id: text("id").primaryKey(), // UUID
  email: text("email").notNull().unique(),
  createdAt: text("created_at").notNull(),
});

export const insertUserSchema = createInsertSchema(users);
export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;

// ── Magic links table ────────────────────────────────────────────────
export const magicLinks = pgTable("magic_links", {
  id: serial("id").primaryKey(),
  email: text("email").notNull(),
  token: text("token").notNull().unique(),
  expiresAt: text("expires_at").notNull(),
  used: integer("used").notNull().default(0), // 0 = unused, 1 = used
  createdAt: text("created_at").notNull(),
});

export type MagicLink = typeof magicLinks.$inferSelect;

// ── Analyses table ───────────────────────────────────────────────────
export const analyses = pgTable("analyses", {
  id: serial("id").primaryKey(),
  sessionId: text("session_id").notNull(),
  userId: text("user_id"), // null for anonymous, set when logged in
  deckName: text("deck_name").notNull(),
  format: text("format").notNull(),
  decklist: text("decklist").notNull(),
  cardCount: integer("card_count").notNull(),
  analysisResult: text("analysis_result"),
  manaCurve: text("mana_curve"),
  colorDistribution: text("color_distribution"),
  createdAt: text("created_at").notNull(),
});

export const insertAnalysisSchema = createInsertSchema(analyses).omit({
  id: true,
});

export type InsertAnalysis = z.infer<typeof insertAnalysisSchema>;
export type Analysis = typeof analyses.$inferSelect;

// ── Credits table ────────────────────────────────────────────────────
export const credits = pgTable("credits", {
  id: serial("id").primaryKey(),
  sessionId: text("session_id").notNull().unique(),
  userId: text("user_id"), // null for anonymous, set when logged in
  coins: integer("coins").notNull().default(3),
  ipAddress: text("ip_address"), // track IP for abuse prevention
  createdAt: text("created_at"), // when this credit row was created
});

export const insertCreditSchema = createInsertSchema(credits).omit({
  id: true,
});

export type InsertCredit = z.infer<typeof insertCreditSchema>;
export type Credit = typeof credits.$inferSelect;

// ── Transactions table ───────────────────────────────────────────────
export const transactions = pgTable("transactions", {
  id: serial("id").primaryKey(),
  sessionId: text("session_id").notNull(),
  userId: text("user_id"), // null for anonymous, set when logged in
  method: text("method").notNull(), // 'solana' | 'stripe'
  amount: integer("amount").notNull(),
  pricePaid: text("price_paid").notNull(),
  txSignature: text("tx_signature"),
  status: text("status").notNull().default("pending"),
  createdAt: text("created_at").notNull(),
});

export const insertTransactionSchema = createInsertSchema(transactions).omit({
  id: true,
});

export type InsertTransaction = z.infer<typeof insertTransactionSchema>;
export type Transaction = typeof transactions.$inferSelect;

// ── Auth sessions table (DB-persisted) ──────────────────────────────
export const authSessions = pgTable("auth_sessions", {
  token: text("token").primaryKey(),
  userId: text("user_id").notNull(),
  email: text("email").notNull(),
  expiresAt: text("expires_at").notNull(), // ISO string
  createdAt: text("created_at").notNull(),
});

export type AuthSession = typeof authSessions.$inferSelect;

// ── Promo codes table ────────────────────────────────────────────────
export const promoCodes = pgTable("promo_codes", {
  id: serial("id").primaryKey(),
  code: text("code").notNull().unique(),
  rings: integer("rings").notNull(),
  maxUses: integer("max_uses").notNull().default(1),
  currentUses: integer("current_uses").notNull().default(0),
  expiresAt: text("expires_at"), // null = never expires
  createdAt: text("created_at").notNull(),
});

export type PromoCode = typeof promoCodes.$inferSelect;

// ── Promo redemptions table ─────────────────────────────────────────
export const promoRedemptions = pgTable("promo_redemptions", {
  id: serial("id").primaryKey(),
  promoCodeId: integer("promo_code_id").notNull(),
  userId: text("user_id"),
  sessionId: text("session_id").notNull(),
  redeemedAt: text("redeemed_at").notNull(),
});

export type PromoRedemption = typeof promoRedemptions.$inferSelect;

// ── Validation schemas ───────────────────────────────────────────────
export const deckSubmitSchema = z.object({
  deckName: z.string().min(1, "Deck name is required").max(100),
  format: z.enum(["standard", "modern", "legacy", "vintage", "pioneer", "pauper", "commander", "historic", "explorer"]),
  decklist: z.string().min(10, "Decklist must contain at least one card"),
});

export type DeckSubmit = z.infer<typeof deckSubmitSchema>;

// ── Newsletters table ─────────────────────────────────────────────────
export const newsletters = pgTable("newsletters", {
  id: serial("id").primaryKey(),
  type: text("type").notNull(), // "daily" or "weekly"
  subject: text("subject").notNull(),
  htmlContent: text("html_content").notNull(),
  socialVersions: text("social_versions"), // JSON string with discord, bluesky, x, reddit versions
  mtgDataUsed: text("mtg_data_used"), // JSON string of sources/data gathered
  status: text("status").notNull().default("draft"), // draft, sent
  sentAt: text("sent_at"),
  recipientCount: integer("recipient_count"),
  createdAt: text("created_at").notNull(),
});

export const insertNewsletterSchema = createInsertSchema(newsletters).omit({
  id: true,
});

export type InsertNewsletter = z.infer<typeof insertNewsletterSchema>;
export type Newsletter = typeof newsletters.$inferSelect;

// ── Newsletter subscribers table ─────────────────────────────────────
export const subscribers = pgTable("subscribers", {
  id: serial("id").primaryKey(),
  email: text("email").notNull().unique(),
  status: text("status").notNull().default("active"), // active, unsubscribed
  source: text("source"), // "website", "dispatches", "footer", "admin"
  createdAt: text("created_at").notNull(),
  unsubscribedAt: text("unsubscribed_at"),
});

export type Subscriber = typeof subscribers.$inferSelect;

// ── Page visits table (traffic tracking) ─────────────────────────────
export const pageVisits = pgTable("page_visits", {
  id: serial("id").primaryKey(),
  sessionId: text("session_id").notNull(),
  page: text("page").notNull(), // e.g. "/", "/analyze", "/mint"
  source: text("source"), // utm_source or inferred from referrer
  medium: text("medium"), // utm_medium
  campaign: text("campaign"), // utm_campaign
  referrer: text("referrer"), // raw document.referrer
  userAgent: text("user_agent"),
  createdAt: text("created_at").notNull(),
});

export const insertPageVisitSchema = createInsertSchema(pageVisits).omit({ id: true });
export type InsertPageVisit = z.infer<typeof insertPageVisitSchema>;
export type PageVisit = typeof pageVisits.$inferSelect;

// ── Settings table (key-value store for editable prompts, etc.) ──────
export const settings = pgTable("settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export type Setting = typeof settings.$inferSelect;

// ── Newsletter tasks (queued from Perplexity or anywhere) ────────────
export const newsletterTasks = pgTable("newsletter_tasks", {
  id: serial("id").primaryKey(),
  type: text("type").notNull(), // "daily" | "weekly"
  customTopic: text("custom_topic"),
  newsLinks: text("news_links"),
  spotlightCard: text("spotlight_card"),
  spotlightNotes: text("spotlight_notes"),
  notes: text("notes"), // freeform notes/instructions
  status: text("status").notNull(), // "pending" | "used" | "cancelled"
  source: text("source"), // "perplexity" | "manual" | etc.
  createdAt: text("created_at").notNull(),
  usedAt: text("used_at"),
});

export type NewsletterTask = typeof newsletterTasks.$inferSelect;
