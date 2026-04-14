import {
  type Analysis,
  type InsertAnalysis,
  type Credit,
  type InsertCredit,
  type Transaction,
  type InsertTransaction,
  type User,
  type MagicLink,
  analyses,
  credits,
  transactions,
  users,
  magicLinks,
} from "@shared/schema";
import { drizzle } from "drizzle-orm/better-sqlite3";
import Database from "better-sqlite3";
import { eq, desc, and, or } from "drizzle-orm";

const sqlite = new Database("data.db");
sqlite.pragma("journal_mode = WAL");

// Auto-create tables if they don't exist (handles fresh deploys)
sqlite.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS magic_links (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL,
    token TEXT NOT NULL UNIQUE,
    expires_at TEXT NOT NULL,
    used INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS analyses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL,
    user_id TEXT,
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
    user_id TEXT,
    coins INTEGER NOT NULL DEFAULT 3
  );
  CREATE TABLE IF NOT EXISTS transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL,
    user_id TEXT,
    method TEXT NOT NULL,
    amount INTEGER NOT NULL,
    price_paid TEXT NOT NULL,
    tx_signature TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    created_at TEXT NOT NULL
  );
`);

// Migrate existing tables — add user_id columns if missing
try { sqlite.exec("ALTER TABLE analyses ADD COLUMN user_id TEXT"); } catch {}
try { sqlite.exec("ALTER TABLE credits ADD COLUMN user_id TEXT"); } catch {}
try { sqlite.exec("ALTER TABLE transactions ADD COLUMN user_id TEXT"); } catch {}

export const db = drizzle(sqlite);

export interface IStorage {
  // Users
  createUser(id: string, email: string): Promise<User>;
  getUserById(id: string): Promise<User | undefined>;
  getUserByEmail(email: string): Promise<User | undefined>;

  // Magic Links
  createMagicLink(email: string, token: string, expiresAt: string): Promise<MagicLink>;
  getMagicLinkByToken(token: string): Promise<MagicLink | undefined>;
  markMagicLinkUsed(token: string): Promise<void>;

  // Analysis
  createAnalysis(analysis: InsertAnalysis): Promise<Analysis>;
  getAnalysis(id: number): Promise<Analysis | undefined>;
  getAnalysesBySession(sessionId: string): Promise<Analysis[]>;
  getAnalysesByUser(userId: string): Promise<Analysis[]>;
  getAnalysesByFormat(format: string): Promise<Analysis[]>;

  // Credits
  getCredits(sessionId: string): Promise<Credit | undefined>;
  getCreditsByUser(userId: string): Promise<Credit | undefined>;
  initCredits(sessionId: string, userId?: string): Promise<Credit>;
  deductCoin(sessionId: string): Promise<Credit | undefined>;
  addCoins(sessionId: string, amount: number): Promise<Credit | undefined>;

  // Session → User migration
  migrateSessionToUser(sessionId: string, userId: string): Promise<void>;

  // Transactions
  createTransaction(tx: InsertTransaction): Promise<Transaction>;
  getTransactionsBySession(sessionId: string): Promise<Transaction[]>;
  getTransactionsByUser(userId: string): Promise<Transaction[]>;
  updateTransactionStatus(id: number, status: string, txSignature?: string): Promise<void>;
}

export class DatabaseStorage implements IStorage {
  // ── Users ──────────────────────────────────────────────────────────
  async createUser(id: string, email: string): Promise<User> {
    return db
      .insert(users)
      .values({ id, email, createdAt: new Date().toISOString() })
      .returning()
      .get();
  }

  async getUserById(id: string): Promise<User | undefined> {
    return db.select().from(users).where(eq(users.id, id)).get();
  }

  async getUserByEmail(email: string): Promise<User | undefined> {
    return db.select().from(users).where(eq(users.email, email)).get();
  }

  // ── Magic Links ────────────────────────────────────────────────────
  async createMagicLink(email: string, token: string, expiresAt: string): Promise<MagicLink> {
    return db
      .insert(magicLinks)
      .values({ email, token, expiresAt, used: 0, createdAt: new Date().toISOString() })
      .returning()
      .get();
  }

  async getMagicLinkByToken(token: string): Promise<MagicLink | undefined> {
    return db.select().from(magicLinks).where(eq(magicLinks.token, token)).get();
  }

  async markMagicLinkUsed(token: string): Promise<void> {
    db.update(magicLinks).set({ used: 1 }).where(eq(magicLinks.token, token)).run();
  }

  // ── Analysis ───────────────────────────────────────────────────────
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

  async getAnalysesByUser(userId: string): Promise<Analysis[]> {
    return db
      .select()
      .from(analyses)
      .where(eq(analyses.userId, userId))
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

  // ── Credits ────────────────────────────────────────────────────────
  async getCredits(sessionId: string): Promise<Credit | undefined> {
    return db
      .select()
      .from(credits)
      .where(eq(credits.sessionId, sessionId))
      .get();
  }

  async getCreditsByUser(userId: string): Promise<Credit | undefined> {
    return db
      .select()
      .from(credits)
      .where(eq(credits.userId, userId))
      .get();
  }

  async initCredits(sessionId: string, userId?: string): Promise<Credit> {
    // If userId provided, check for existing user credits first
    if (userId) {
      const userCredit = await this.getCreditsByUser(userId);
      if (userCredit) return userCredit;
    }
    const existing = await this.getCredits(sessionId);
    if (existing) {
      // If we have a userId and the existing record doesn't, link it
      if (userId && !existing.userId) {
        db.update(credits)
          .set({ userId })
          .where(eq(credits.sessionId, sessionId))
          .run();
        return { ...existing, userId };
      }
      return existing;
    }
    return db
      .insert(credits)
      .values({ sessionId, userId: userId ?? null, coins: 3 })
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

  // ── Session → User migration ──────────────────────────────────────
  async migrateSessionToUser(sessionId: string, userId: string): Promise<void> {
    // Link all anonymous session data to the user account
    db.update(analyses)
      .set({ userId })
      .where(and(eq(analyses.sessionId, sessionId), eq(analyses.userId, null as any)))
      .run();
    db.update(credits)
      .set({ userId })
      .where(and(eq(credits.sessionId, sessionId), eq(credits.userId, null as any)))
      .run();
    db.update(transactions)
      .set({ userId })
      .where(and(eq(transactions.sessionId, sessionId), eq(transactions.userId, null as any)))
      .run();
  }

  // ── Transactions ───────────────────────────────────────────────────
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

  async getTransactionsByUser(userId: string): Promise<Transaction[]> {
    return db
      .select()
      .from(transactions)
      .where(eq(transactions.userId, userId))
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
