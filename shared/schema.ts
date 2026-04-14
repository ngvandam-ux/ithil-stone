import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// ── Users table ──────────────────────────────────────────────────────
export const users = sqliteTable("users", {
  id: text("id").primaryKey(), // UUID
  email: text("email").notNull().unique(),
  createdAt: text("created_at").notNull(),
});

export const insertUserSchema = createInsertSchema(users);
export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;

// ── Magic links table ────────────────────────────────────────────────
export const magicLinks = sqliteTable("magic_links", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  email: text("email").notNull(),
  token: text("token").notNull().unique(),
  expiresAt: text("expires_at").notNull(),
  used: integer("used").notNull().default(0), // 0 = unused, 1 = used
  createdAt: text("created_at").notNull(),
});

export type MagicLink = typeof magicLinks.$inferSelect;

// ── Analyses table ───────────────────────────────────────────────────
export const analyses = sqliteTable("analyses", {
  id: integer("id").primaryKey({ autoIncrement: true }),
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
export const credits = sqliteTable("credits", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  sessionId: text("session_id").notNull().unique(),
  userId: text("user_id"), // null for anonymous, set when logged in
  coins: integer("coins").notNull().default(3),
});

export const insertCreditSchema = createInsertSchema(credits).omit({
  id: true,
});

export type InsertCredit = z.infer<typeof insertCreditSchema>;
export type Credit = typeof credits.$inferSelect;

// ── Transactions table ───────────────────────────────────────────────
export const transactions = sqliteTable("transactions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
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
export const authSessions = sqliteTable("auth_sessions", {
  token: text("token").primaryKey(),
  userId: text("user_id").notNull(),
  email: text("email").notNull(),
  expiresAt: text("expires_at").notNull(), // ISO string
  createdAt: text("created_at").notNull(),
});

export type AuthSession = typeof authSessions.$inferSelect;

// ── Promo codes table ────────────────────────────────────────────────
export const promoCodes = sqliteTable("promo_codes", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  code: text("code").notNull().unique(),
  rings: integer("rings").notNull(),
  maxUses: integer("max_uses").notNull().default(1),
  currentUses: integer("current_uses").notNull().default(0),
  expiresAt: text("expires_at"), // null = never expires
  createdAt: text("created_at").notNull(),
});

export type PromoCode = typeof promoCodes.$inferSelect;

// ── Promo redemptions table ─────────────────────────────────────────
export const promoRedemptions = sqliteTable("promo_redemptions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
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
