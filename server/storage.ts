import {
  type Analysis,
  type InsertAnalysis,
  type Credit,
  type InsertCredit,
  analyses,
  credits,
} from "@shared/schema";
import { drizzle } from "drizzle-orm/better-sqlite3";
import Database from "better-sqlite3";
import { eq, desc } from "drizzle-orm";

const sqlite = new Database("data.db");
sqlite.pragma("journal_mode = WAL");

export const db = drizzle(sqlite);

export interface IStorage {
  // Analysis
  createAnalysis(analysis: InsertAnalysis): Promise<Analysis>;
  getAnalysis(id: number): Promise<Analysis | undefined>;
  getAnalysesBySession(sessionId: string): Promise<Analysis[]>;

  // Credits
  getCredits(sessionId: string): Promise<Credit | undefined>;
  initCredits(sessionId: string): Promise<Credit>;
  deductCoin(sessionId: string): Promise<Credit | undefined>;
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
}

export const storage = new DatabaseStorage();
