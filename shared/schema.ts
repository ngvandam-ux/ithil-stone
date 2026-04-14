import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// Analyses table - stores deck analysis results
export const analyses = sqliteTable("analyses", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  sessionId: text("session_id").notNull(),
  deckName: text("deck_name").notNull(),
  format: text("format").notNull(),
  decklist: text("decklist").notNull(),
  cardCount: integer("card_count").notNull(),
  analysisResult: text("analysis_result"), // JSON string with AI analysis
  manaCurve: text("mana_curve"), // JSON string
  colorDistribution: text("color_distribution"), // JSON string
  createdAt: text("created_at").notNull(),
});

export const insertAnalysisSchema = createInsertSchema(analyses).omit({
  id: true,
});

export type InsertAnalysis = z.infer<typeof insertAnalysisSchema>;
export type Analysis = typeof analyses.$inferSelect;

// Credits table - tracks session-based coin balance
export const credits = sqliteTable("credits", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  sessionId: text("session_id").notNull().unique(),
  coins: integer("coins").notNull().default(3),
});

export const insertCreditSchema = createInsertSchema(credits).omit({
  id: true,
});

export type InsertCredit = z.infer<typeof insertCreditSchema>;
export type Credit = typeof credits.$inferSelect;

// Transactions table - tracks coin purchases
export const transactions = sqliteTable("transactions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  sessionId: text("session_id").notNull(),
  method: text("method").notNull(), // 'solana' | 'paypal'
  amount: integer("amount").notNull(), // coins purchased
  pricePaid: text("price_paid").notNull(), // e.g. "4.99" or "0.02 SOL"
  txSignature: text("tx_signature"), // Solana tx sig or PayPal order ID
  status: text("status").notNull().default("pending"), // pending | confirmed | failed
  createdAt: text("created_at").notNull(),
});

export const insertTransactionSchema = createInsertSchema(transactions).omit({
  id: true,
});

export type InsertTransaction = z.infer<typeof insertTransactionSchema>;
export type Transaction = typeof transactions.$inferSelect;

// Validation schema for deck submission
export const deckSubmitSchema = z.object({
  deckName: z.string().min(1, "Deck name is required").max(100),
  format: z.enum(["standard", "modern", "legacy", "vintage", "pioneer", "pauper", "commander", "historic", "explorer"]),
  decklist: z.string().min(10, "Decklist must contain at least one card"),
});

export type DeckSubmit = z.infer<typeof deckSubmitSchema>;
