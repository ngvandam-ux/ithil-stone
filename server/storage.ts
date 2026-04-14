import {
  type Analysis,
  type InsertAnalysis,
  type Credit,
  type InsertCredit,
  type Transaction,
  type InsertTransaction,
  analyses,
  credits,
  transactions,
} from "@shared/schema";
import { drizzle } from "drizzle-orm/better-sqlite3";
import Database from "better-sqlite3";
import { eq, desc } from "drizzle-orm";

const sqlite = new Database("data.db");
sqlite.pragma("journal_mode = WAL");

// Auto-create tables if they don't exist (handles fresh deploys)
sqlite.exec(`
  CREATE TABLE IF NOT EXISTS analyses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL,
    deck_name TEXT NOT NULL,
    format TEXT NOT NULL,
    decklist TEXT NOT NULL,
    card_count INTEGER NOT NULL,
    analysis_result TEXT,
    mana_curve TEXT,
    color_distribution TEXT,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS credits (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL UNIQUE,
    coins INTEGER NOT NULL DEFAULT 3
  );
  CREATE TABLE IF NOT EXISTS transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL,
    method TEXT NOT NULL,
    amount INTEGER NOT NULL,
    price_paid TEXT NOT NULL,
    tx_signature TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    created_at TEXT NOT NULL
  );
`);

export const db = drizzle(sqlite);

export interface IStorage {
  // Analysis
  createAnalysis(analysis: InsertAnalysis): Promise<Analysis>;
  getAnalysis(id: number): Promise<Analysis | undefined>;
  getAnalysesBySession(sessionId: string): Promise<Analysis[]>;
  getAnalysesByFormat(format: string): Promise<Analysis[]>;

  // Credits
  getCredits(sessionId: string): Promise<Credit | undefined>;
  initCredits(sessionId: string): Promise<Credit>;
  deductCoin(sessionId: string): Promise<Credit | undefined>;
  addCoins(sessionId: string, amount: number): Promise<Credit | undefined>;

  // Transactions
  createTransaction(tx: InsertTransaction): Promise<Transaction>;
  getTransactionsBySession(sessionId: string): Promise<Transaction[]>;
  updateTransactionStatus(id: number, status: string, txSignature?: string): Promise<void>;
}

export class DatabaseStorage implements IStorage {
  async createAnalysis(analysis: InsertAnalysis): Promise<Analysis> {
    return db.insert(analyses).values(analysis).returning().get();
  }

  async getAnalysis(id: number): Promise<Analysis | undefined> {
    return db.select().from(analyses).where(eq(analyses.id, id)).get();
  }

  async getAnalysesBySession(sessionId: string): Promise<Analysis[]> {
    return db
      .select()
      .from(analyses)
      .where(eq(analyses.sessionId, sessionId))
      .orderBy(desc(analyses.id))
      .all();
  }

  async getAnalysesByFormat(format: string): Promise<Analysis[]> {
    return db
      .select()
      .from(analyses)
      .where(eq(analyses.format, format))
      .orderBy(desc(analyses.id))
      .all();
  }

  async getCredits(sessionId: string): Promise<Credit | undefined> {
    return db
      .select()
      .from(credits)
      .where(eq(credits.sessionId, sessionId))
      .get();
  }

  async initCredits(sessionId: string): Promise<Credit> {
    const existing = await this.getCredits(sessionId);
    if (existing) return existing;
    return db
      .insert(credits)
      .values({ sessionId, coins: 3 })
      .returning()
      .get();
  }

  async deductCoin(sessionId: string): Promise<Credit | undefined> {
    const current = await this.getCredits(sessionId);
    if (!current || current.coins <= 0) return undefined;
    db.update(credits)
      .set({ coins: current.coins - 1 })
      .where(eq(credits.sessionId, sessionId))
      .run();
    return this.getCredits(sessionId);
  }

  async addCoins(sessionId: string, amount: number): Promise<Credit | undefined> {
    const current = await this.initCredits(sessionId);
    db.update(credits)
      .set({ coins: current.coins + amount })
      .where(eq(credits.sessionId, sessionId))
      .run();
    return this.getCredits(sessionId);
  }

  async createTransaction(tx: InsertTransaction): Promise<Transaction> {
    return db.insert(transactions).values(tx).returning().get();
  }

  async getTransactionsBySession(sessionId: string): Promise<Transaction[]> {
    return db
      .select()
      .from(transactions)
      .where(eq(transactions.sessionId, sessionId))
      .orderBy(desc(transactions.id))
      .all();
  }

  async updateTransactionStatus(id: number, status: string, txSignature?: string): Promise<void> {
    const updates: any = { status };
    if (txSignature) updates.txSignature = txSignature;
    db.update(transactions)
      .set(updates)
      .where(eq(transactions.id, id))
      .run();
  }
}

export const storage = new DatabaseStorage();
