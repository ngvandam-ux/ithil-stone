import {
  type Analysis,
  type InsertAnalysis,
  type Credit,
  type InsertCredit,
  type Transaction,
  type InsertTransaction,
  type User,
  type MagicLink,
  type AuthSession,
  type PromoCode,
  type PromoRedemption,
  type Newsletter,
  type InsertNewsletter,
  type PageVisit,
  type InsertPageVisit,
  type Subscriber,
  analyses,
  credits,
  transactions,
  users,
  magicLinks,
  authSessions,
  promoCodes,
  promoRedemptions,
  newsletters,
  subscribers,
  pageVisits,
} from "@shared/schema";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { eq, desc, and, or, sql } from "drizzle-orm";

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
});

export const db = drizzle(pool);

export async function initializeDatabase() {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS magic_links (
      id SERIAL PRIMARY KEY,
      email TEXT NOT NULL,
      token TEXT NOT NULL UNIQUE,
      expires_at TEXT NOT NULL,
      used INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS analyses (
      id SERIAL PRIMARY KEY,
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
      id SERIAL PRIMARY KEY,
      session_id TEXT NOT NULL UNIQUE,
      user_id TEXT,
      coins INTEGER NOT NULL DEFAULT 3
    );
    CREATE TABLE IF NOT EXISTS transactions (
      id SERIAL PRIMARY KEY,
      session_id TEXT NOT NULL,
      user_id TEXT,
      method TEXT NOT NULL,
      amount INTEGER NOT NULL,
      price_paid TEXT NOT NULL,
      tx_signature TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS auth_sessions (
      token TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      email TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS newsletters (
      id SERIAL PRIMARY KEY,
      type TEXT NOT NULL,
      subject TEXT NOT NULL,
      html_content TEXT NOT NULL,
      social_versions TEXT,
      mtg_data_used TEXT,
      status TEXT NOT NULL DEFAULT 'draft',
      sent_at TEXT,
      recipient_count INTEGER,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS page_visits (
      id SERIAL PRIMARY KEY,
      session_id TEXT NOT NULL,
      page TEXT NOT NULL,
      source TEXT,
      medium TEXT,
      campaign TEXT,
      referrer TEXT,
      user_agent TEXT,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS promo_codes (
      id SERIAL PRIMARY KEY,
      code TEXT NOT NULL UNIQUE,
      rings INTEGER NOT NULL,
      max_uses INTEGER NOT NULL DEFAULT 1,
      current_uses INTEGER NOT NULL DEFAULT 0,
      expires_at TEXT,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS subscribers (
      id SERIAL PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL DEFAULT 'active',
      source TEXT,
      created_at TEXT NOT NULL,
      unsubscribed_at TEXT
    );
    CREATE TABLE IF NOT EXISTS promo_redemptions (
      id SERIAL PRIMARY KEY,
      promo_code_id INTEGER NOT NULL,
      user_id TEXT,
      session_id TEXT NOT NULL,
      redeemed_at TEXT NOT NULL
    );
  `);
}

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

  // Auth sessions (DB-persisted)
  createAuthSession(token: string, userId: string, email: string, expiresAt: string): Promise<AuthSession>;
  getAuthSession(token: string): Promise<AuthSession | undefined>;
  deleteAuthSession(token: string): Promise<void>;
  cleanExpiredSessions(): Promise<void>;

  // Transactions
  createTransaction(tx: InsertTransaction): Promise<Transaction>;
  getTransactionsBySession(sessionId: string): Promise<Transaction[]>;
  getTransactionsByUser(userId: string): Promise<Transaction[]>;
  updateTransactionStatus(id: number, status: string, txSignature?: string): Promise<void>;

  // Newsletters
  createNewsletter(data: InsertNewsletter): Promise<Newsletter>;
  getNewsletters(): Promise<Newsletter[]>;
  getNewsletter(id: number): Promise<Newsletter | undefined>;
  updateNewsletter(id: number, data: Partial<InsertNewsletter>): Promise<Newsletter | undefined>;
  deleteNewsletter(id: number): Promise<void>;

  // Subscribers
  addSubscriber(email: string, source?: string): Promise<Subscriber>;
  removeSubscriber(email: string): Promise<void>;
  getActiveSubscribers(): Promise<Subscriber[]>;
  getAllSubscribers(): Promise<Subscriber[]>;
  getSubscriberByEmail(email: string): Promise<Subscriber | undefined>;

  // Page visits
  recordPageVisit(data: InsertPageVisit): Promise<PageVisit>;
  getPageVisits(): Promise<PageVisit[]>;
}

export class DatabaseStorage implements IStorage {
  // ── Users ──────────────────────────────────────────────────────────
  async createUser(id: string, email: string): Promise<User> {
    const [user] = await db
      .insert(users)
      .values({ id, email, createdAt: new Date().toISOString() })
      .returning();
    return user;
  }

  async getUserById(id: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user;
  }

  async getUserByEmail(email: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.email, email));
    return user;
  }

  // ── Magic Links ────────────────────────────────────────────────────
  async createMagicLink(email: string, token: string, expiresAt: string): Promise<MagicLink> {
    const [link] = await db
      .insert(magicLinks)
      .values({ email, token, expiresAt, used: 0, createdAt: new Date().toISOString() })
      .returning();
    return link;
  }

  async getMagicLinkByToken(token: string): Promise<MagicLink | undefined> {
    const [link] = await db.select().from(magicLinks).where(eq(magicLinks.token, token));
    return link;
  }

  async markMagicLinkUsed(token: string): Promise<void> {
    await db.update(magicLinks).set({ used: 1 }).where(eq(magicLinks.token, token));
  }

  // ── Analysis ───────────────────────────────────────────────────────
  async createAnalysis(analysis: InsertAnalysis): Promise<Analysis> {
    const [result] = await db.insert(analyses).values(analysis).returning();
    return result;
  }

  async getAnalysis(id: number): Promise<Analysis | undefined> {
    const [result] = await db.select().from(analyses).where(eq(analyses.id, id));
    return result;
  }

  async getAnalysesBySession(sessionId: string): Promise<Analysis[]> {
    return await db
      .select()
      .from(analyses)
      .where(eq(analyses.sessionId, sessionId))
      .orderBy(desc(analyses.id));
  }

  async getAnalysesByUser(userId: string): Promise<Analysis[]> {
    return await db
      .select()
      .from(analyses)
      .where(eq(analyses.userId, userId))
      .orderBy(desc(analyses.id));
  }

  async getAnalysesByFormat(format: string): Promise<Analysis[]> {
    return await db
      .select()
      .from(analyses)
      .where(eq(analyses.format, format))
      .orderBy(desc(analyses.id));
  }

  // ── Credits ────────────────────────────────────────────────────────
  async getCredits(sessionId: string): Promise<Credit | undefined> {
    const [credit] = await db
      .select()
      .from(credits)
      .where(eq(credits.sessionId, sessionId));
    return credit;
  }

  async getCreditsByUser(userId: string): Promise<Credit | undefined> {
    const [credit] = await db
      .select()
      .from(credits)
      .where(eq(credits.userId, userId));
    return credit;
  }

  async initCredits(sessionId: string, userId?: string): Promise<Credit> {
    // If userId provided, check for existing user credits first
    if (userId) {
      const userCredit = await this.getCreditsByUser(userId);
      if (userCredit) {
        // If user has a credit record but on a different session, update sessionId
        // so deductCoin/addCoins work with the current session
        if (userCredit.sessionId !== sessionId) {
          await db.update(credits)
            .set({ sessionId })
            .where(eq(credits.id, userCredit.id));
          return { ...userCredit, sessionId };
        }
        return userCredit;
      }
    }
    const existing = await this.getCredits(sessionId);
    if (existing) {
      // If we have a userId and the existing record doesn't, link it
      if (userId && !existing.userId) {
        await db.update(credits)
          .set({ userId })
          .where(eq(credits.sessionId, sessionId));
        return { ...existing, userId };
      }
      return existing;
    }
    // New credit record — but if logged in and user already has ANY credit row
    // (even on an old session), DON'T give free rings again
    if (userId) {
      // Double-check: might have a row with a stale sessionId
      const [anyUserCredit] = await db
        .select()
        .from(credits)
        .where(eq(credits.userId, userId));
      if (anyUserCredit) {
        // Point existing record to the current session
        await db.update(credits)
          .set({ sessionId })
          .where(eq(credits.id, anyUserCredit.id));
        return { ...anyUserCredit, sessionId };
      }
    }
    const [newCredit] = await db
      .insert(credits)
      .values({ sessionId, userId: userId ?? null, coins: 3 })
      .returning();
    return newCredit;
  }

  async deductCoin(sessionId: string): Promise<Credit | undefined> {
    const current = await this.getCredits(sessionId);
    if (!current || current.coins <= 0) return undefined;
    await db.update(credits)
      .set({ coins: current.coins - 1 })
      .where(eq(credits.sessionId, sessionId));
    return this.getCredits(sessionId);
  }

  async addCoins(sessionId: string, amount: number): Promise<Credit | undefined> {
    const current = await this.initCredits(sessionId);
    await db.update(credits)
      .set({ coins: current.coins + amount })
      .where(eq(credits.sessionId, sessionId));
    return this.getCredits(sessionId);
  }

  // ── Session → User migration ──────────────────────────────────────
  async migrateSessionToUser(sessionId: string, userId: string): Promise<void> {
    // Link all anonymous session data to the user account
    await db.update(analyses)
      .set({ userId })
      .where(and(eq(analyses.sessionId, sessionId), eq(analyses.userId, null as any)));
    await db.update(transactions)
      .set({ userId })
      .where(and(eq(transactions.sessionId, sessionId), eq(transactions.userId, null as any)));

    // Credits: consolidate into a single row per user
    const [existingUserCredit] = await db
      .select()
      .from(credits)
      .where(eq(credits.userId, userId));
    const [sessionCredit] = await db
      .select()
      .from(credits)
      .where(and(eq(credits.sessionId, sessionId), eq(credits.userId, null as any)));

    if (existingUserCredit && sessionCredit) {
      // User already had a credit row — absorb purchased rings from anonymous session
      // but DON'T give them the free starter rings again.
      // Only carry over coins above the initial 3 (purchased rings)
      const purchasedRings = Math.max(0, sessionCredit.coins - 3);
      if (purchasedRings > 0) {
        await db.update(credits)
          .set({ coins: existingUserCredit.coins + purchasedRings, sessionId })
          .where(eq(credits.id, existingUserCredit.id));
      } else {
        // Just update the sessionId so current session uses the existing balance
        await db.update(credits)
          .set({ sessionId })
          .where(eq(credits.id, existingUserCredit.id));
      }
      // Delete the orphaned anonymous credit row
      await db.delete(credits).where(eq(credits.id, sessionCredit.id));
    } else if (sessionCredit && !existingUserCredit) {
      // First login — just link the anonymous session to the user
      await db.update(credits)
        .set({ userId })
        .where(eq(credits.id, sessionCredit.id));
    }
    // If existingUserCredit but no sessionCredit, nothing to do
  }

  // ── Auth Sessions (DB-persisted) ─────────────────────────────────────
  async createAuthSession(token: string, userId: string, email: string, expiresAt: string): Promise<AuthSession> {
    const [session] = await db.insert(authSessions).values({
      token,
      userId,
      email,
      expiresAt,
      createdAt: new Date().toISOString(),
    }).returning();
    return session;
  }

  async getAuthSession(token: string): Promise<AuthSession | undefined> {
    const [session] = await db.select().from(authSessions).where(eq(authSessions.token, token));
    return session;
  }

  async deleteAuthSession(token: string): Promise<void> {
    await db.delete(authSessions).where(eq(authSessions.token, token));
  }

  async cleanExpiredSessions(): Promise<void> {
    const now = new Date().toISOString();
    await db.execute(sql`DELETE FROM auth_sessions WHERE expires_at < ${now}`);
  }

  // ── Transactions ───────────────────────────────────────────────────
  async createTransaction(tx: InsertTransaction): Promise<Transaction> {
    const [result] = await db.insert(transactions).values(tx).returning();
    return result;
  }

  async getTransactionsBySession(sessionId: string): Promise<Transaction[]> {
    return await db
      .select()
      .from(transactions)
      .where(eq(transactions.sessionId, sessionId))
      .orderBy(desc(transactions.id));
  }

  async getTransactionsByUser(userId: string): Promise<Transaction[]> {
    return await db
      .select()
      .from(transactions)
      .where(eq(transactions.userId, userId))
      .orderBy(desc(transactions.id));
  }

  async updateTransactionStatus(id: number, status: string, txSignature?: string): Promise<void> {
    const updates: any = { status };
    if (txSignature) updates.txSignature = txSignature;
    await db.update(transactions)
      .set(updates)
      .where(eq(transactions.id, id));
  }

  // ── Promo Codes ─────────────────────────────────────────────────────
  async createPromoCode(code: string, rings: number, maxUses: number, expiresAt?: string): Promise<PromoCode> {
    const [promo] = await db
      .insert(promoCodes)
      .values({
        code: code.toUpperCase(),
        rings,
        maxUses,
        currentUses: 0,
        expiresAt: expiresAt ?? null,
        createdAt: new Date().toISOString(),
      })
      .returning();
    return promo;
  }

  async getPromoCode(code: string): Promise<PromoCode | undefined> {
    const [promo] = await db.select().from(promoCodes).where(eq(promoCodes.code, code.toUpperCase()));
    return promo;
  }

  async getAllPromoCodes(): Promise<PromoCode[]> {
    return await db.select().from(promoCodes).orderBy(desc(promoCodes.id));
  }

  async deletePromoCode(id: number): Promise<void> {
    await db.delete(promoCodes).where(eq(promoCodes.id, id));
  }

  async redeemPromoCode(code: string, sessionId: string, userId?: string): Promise<{ success: boolean; rings: number; error?: string }> {
    const promo = await this.getPromoCode(code);
    if (!promo) return { success: false, rings: 0, error: "Invalid promo code" };
    if (promo.currentUses >= promo.maxUses) return { success: false, rings: 0, error: "This code has been fully redeemed" };
    if (promo.expiresAt && new Date(promo.expiresAt) < new Date()) return { success: false, rings: 0, error: "This code has expired" };

    // Check if this session/user already redeemed this code
    const [existing] = await db.select().from(promoRedemptions)
      .where(and(
        eq(promoRedemptions.promoCodeId, promo.id),
        or(
          eq(promoRedemptions.sessionId, sessionId),
          userId ? eq(promoRedemptions.userId, userId) : undefined as any
        )
      ));
    if (existing) return { success: false, rings: 0, error: "You have already redeemed this code" };

    // Increment usage
    await db.update(promoCodes)
      .set({ currentUses: promo.currentUses + 1 })
      .where(eq(promoCodes.id, promo.id));

    // Record redemption
    await db.insert(promoRedemptions)
      .values({
        promoCodeId: promo.id,
        userId: userId ?? null,
        sessionId,
        redeemedAt: new Date().toISOString(),
      });

    // Credit the rings
    await this.addCoins(sessionId, promo.rings);

    return { success: true, rings: promo.rings };
  }

  // ── Admin: Grant rings directly to a user by email ──────────────────
  async grantRingsByEmail(email: string, amount: number): Promise<{ success: boolean; error?: string; newBalance?: number }> {
    const user = await this.getUserByEmail(email.toLowerCase().trim());
    if (!user) return { success: false, error: "User not found" };

    // Find the user's credit record
    const [credit] = await db.select().from(credits).where(eq(credits.userId, user.id));
    if (!credit) return { success: false, error: "User has no credit record (haven't visited the site yet)" };

    const newBalance = credit.coins + amount;
    await db.update(credits)
      .set({ coins: newBalance })
      .where(eq(credits.id, credit.id));

    return { success: true, newBalance };
  }

  // ── Newsletters ─────────────────────────────────────────────────────
  async createNewsletter(data: InsertNewsletter): Promise<Newsletter> {
    const [newsletter] = await db.insert(newsletters).values(data).returning();
    return newsletter;
  }

  async getNewsletters(): Promise<Newsletter[]> {
    return await db.select().from(newsletters).orderBy(desc(newsletters.createdAt));
  }

  async getNewsletter(id: number): Promise<Newsletter | undefined> {
    const [newsletter] = await db.select().from(newsletters).where(eq(newsletters.id, id));
    return newsletter;
  }

  async updateNewsletter(id: number, data: Partial<InsertNewsletter>): Promise<Newsletter | undefined> {
    await db.update(newsletters).set(data).where(eq(newsletters.id, id));
    return this.getNewsletter(id);
  }

  async deleteNewsletter(id: number): Promise<void> {
    await db.delete(newsletters).where(eq(newsletters.id, id));
  }

  // ── Page Visits ─────────────────────────────────────────
  async recordPageVisit(data: InsertPageVisit): Promise<PageVisit> {
    const [visit] = await db.insert(pageVisits).values(data).returning();
    return visit;
  }

  async getPageVisits(): Promise<PageVisit[]> {
    return await db.select().from(pageVisits);
  }

  // ── Subscribers ──────────────────────────────────────────
  async addSubscriber(email: string, source?: string): Promise<Subscriber> {
    // Upsert: if email exists but was unsubscribed, reactivate
    const existing = await db.select().from(subscribers).where(eq(subscribers.email, email));
    if (existing[0]) {
      if (existing[0].status === "unsubscribed") {
        await db.update(subscribers)
          .set({ status: "active", unsubscribedAt: null, source: source || existing[0].source })
          .where(eq(subscribers.email, email));
        const [updated] = await db.select().from(subscribers).where(eq(subscribers.email, email));
        return updated;
      }
      return existing[0]; // already active
    }
    const [sub] = await db.insert(subscribers).values({
      email,
      status: "active",
      source: source || "website",
      createdAt: new Date().toISOString(),
    }).returning();
    return sub;
  }

  async removeSubscriber(email: string): Promise<void> {
    await db.update(subscribers)
      .set({ status: "unsubscribed", unsubscribedAt: new Date().toISOString() })
      .where(eq(subscribers.email, email));
  }

  async getActiveSubscribers(): Promise<Subscriber[]> {
    return await db.select().from(subscribers).where(eq(subscribers.status, "active"));
  }

  async getAllSubscribers(): Promise<Subscriber[]> {
    return await db.select().from(subscribers).orderBy(desc(subscribers.createdAt));
  }

  async getSubscriberByEmail(email: string): Promise<Subscriber | undefined> {
    const [sub] = await db.select().from(subscribers).where(eq(subscribers.email, email));
    return sub;
  }
}

export const storage = new DatabaseStorage();
