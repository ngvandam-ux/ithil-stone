import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { deckSubmitSchema } from "@shared/schema";
import { randomUUID } from "crypto";

// Scryfall card lookup
async function lookupCard(cardName: string): Promise<any> {
  try {
    const res = await fetch(
      `https://api.scryfall.com/cards/named?fuzzy=${encodeURIComponent(cardName.trim())}`
    );
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

// Parse decklist text into structured entries
function parseDecklist(text: string): Array<{ quantity: number; name: string }> {
  const lines = text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("//") && !l.startsWith("#"));

  return lines.map((line) => {
    // Match patterns like "4 Lightning Bolt" or "4x Lightning Bolt" or "Lightning Bolt"
    const match = line.match(/^(\d+)\s*x?\s+(.+)$/i);
    if (match) {
      return { quantity: parseInt(match[1], 10), name: match[2].trim() };
    }
    return { quantity: 1, name: line };
  });
}

// Compute mana curve and color distribution from Scryfall data
function computeStats(cards: Array<{ quantity: number; data: any }>) {
  const manaCurve: Record<string, number> = {
    "0": 0, "1": 0, "2": 0, "3": 0, "4": 0, "5": 0, "6+": 0,
  };
  const colorDist: Record<string, number> = {
    W: 0, U: 0, B: 0, R: 0, G: 0, C: 0,
  };
  let landCount = 0;
  let creatureCount = 0;
  let instantSorceryCount = 0;
  let otherCount = 0;

  for (const { quantity, data } of cards) {
    if (!data) continue;

    // Mana curve (skip lands)
    const typeLine = (data.type_line || "").toLowerCase();
    if (typeLine.includes("land")) {
      landCount += quantity;
    } else {
      const cmc = Math.floor(data.cmc || 0);
      const key = cmc >= 6 ? "6+" : String(cmc);
      manaCurve[key] = (manaCurve[key] || 0) + quantity;

      if (typeLine.includes("creature")) creatureCount += quantity;
      else if (typeLine.includes("instant") || typeLine.includes("sorcery"))
        instantSorceryCount += quantity;
      else otherCount += quantity;
    }

    // Color distribution
    const colors = data.colors || data.color_identity || [];
    if (colors.length === 0) {
      colorDist["C"] += quantity;
    } else {
      for (const c of colors) {
        colorDist[c] = (colorDist[c] || 0) + quantity;
      }
    }
  }

  return {
    manaCurve,
    colorDistribution: colorDist,
    landCount,
    creatureCount,
    instantSorceryCount,
    otherCount,
    totalCards: cards.reduce((sum, c) => sum + c.quantity, 0),
  };
}

// AI analysis via Claude
async function aiAnalysis(
  deckName: string,
  format: string,
  entries: Array<{ quantity: number; name: string }>,
  stats: any,
  cardDetails: Array<{ quantity: number; data: any }>
): Promise<string> {
  const apiKey = process.env.LLM_API_KEY;
  const baseUrl = process.env.LLM_BASE_URL || "https://api.openai.com/v1";

  if (!apiKey) {
    return generateFallbackAnalysis(deckName, format, entries, stats);
  }

  const cardSummary = cardDetails
    .filter((c) => c.data)
    .slice(0, 40)
    .map(
      (c) =>
        `${c.quantity}x ${c.data.name} (${c.data.type_line}, CMC ${c.data.cmc}${c.data.oracle_text ? ": " + c.data.oracle_text.substring(0, 80) : ""})`
    )
    .join("\n");

  const prompt = `You are an expert Magic: The Gathering deck analyst. Analyze this ${format} deck named "${deckName}".

DECK (${stats.totalCards} cards, ${stats.landCount} lands, ${stats.creatureCount} creatures, ${stats.instantSorceryCount} instants/sorceries):
${cardSummary}

MANA CURVE: ${JSON.stringify(stats.manaCurve)}
COLOR DISTRIBUTION: ${JSON.stringify(stats.colorDistribution)}

Provide a concise, professional analysis with these sections:
1. **Deck Archetype** — Identify the strategy (aggro, midrange, control, combo, tempo, etc.)
2. **Strengths** — 2-3 key strengths of this build
3. **Weaknesses** — 2-3 vulnerabilities or gaps
4. **Mana Base Assessment** — Is the land count appropriate? Color fixing adequate?
5. **Key Synergies** — Notable card interactions
6. **Optimization Suggestions** — 3-5 specific card swaps or adjustments for the ${format} format, referencing real cards
7. **Meta Positioning** — How this deck likely performs against common ${format} archetypes
8. **Overall Rating** — Rate the deck out of 10 with a brief justification

Be specific about card names. Reference actual ${format}-legal cards in suggestions. Keep it actionable and expert-level.`;

  try {
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 1500,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error("AI API error:", errText);
      return generateFallbackAnalysis(deckName, format, entries, stats);
    }

    const data = await res.json();
    return data.choices?.[0]?.message?.content || generateFallbackAnalysis(deckName, format, entries, stats);
  } catch (err) {
    console.error("AI analysis failed:", err);
    return generateFallbackAnalysis(deckName, format, entries, stats);
  }
}

function generateFallbackAnalysis(
  deckName: string,
  format: string,
  entries: Array<{ quantity: number; name: string }>,
  stats: any
): string {
  const avgCmc =
    Object.entries(stats.manaCurve).reduce(
      (sum, [k, v]) => sum + (k === "6+" ? 6 : parseInt(k)) * (v as number),
      0
    ) / Math.max(stats.totalCards - stats.landCount, 1);

  const colorStr = Object.entries(stats.colorDistribution)
    .filter(([, v]) => (v as number) > 0)
    .map(([k, v]) => `${k}: ${v}`)
    .join(", ");

  const landRatio = ((stats.landCount / stats.totalCards) * 100).toFixed(1);

  return `## ${deckName} — ${format.charAt(0).toUpperCase() + format.slice(1)} Analysis

**Deck Overview:** ${stats.totalCards} cards across ${entries.length} unique cards. Color distribution: ${colorStr}.

**Mana Curve:** Average CMC ${avgCmc.toFixed(2)}. ${avgCmc < 2.5 ? "This is an aggressive, low-to-the-ground curve suggesting an aggro or tempo strategy." : avgCmc < 3.5 ? "A balanced midrange curve with good flexibility." : "A higher curve suggesting a control or ramp strategy."}

**Mana Base:** ${stats.landCount} lands (${landRatio}% of deck). ${parseFloat(landRatio) < 35 ? "Consider adding more lands to avoid mana screw." : parseFloat(landRatio) > 42 ? "Land count is high — you may flood. Consider trimming 1-2 lands." : "Land count looks appropriate for this curve."}

**Card Type Breakdown:** ${stats.creatureCount} creatures, ${stats.instantSorceryCount} instants/sorceries, ${stats.otherCount} other spells, ${stats.landCount} lands.

*For deeper AI-powered insights including synergy detection, meta positioning, and specific card swap recommendations, ensure the AI service is configured.*`;
}

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  // Session middleware — generate a session ID for tracking
  app.use((req, _res, next) => {
    if (!req.headers["x-session-id"]) {
      req.headers["x-session-id"] = randomUUID();
    }
    next();
  });

  // Get or initialize credits for session
  app.get("/api/credits", async (req, res) => {
    const sessionId = req.headers["x-session-id"] as string;
    const credit = await storage.initCredits(sessionId);
    res.json(credit);
  });

  // Get analysis history
  app.get("/api/analyses", async (req, res) => {
    const sessionId = req.headers["x-session-id"] as string;
    const list = await storage.getAnalysesBySession(sessionId);
    res.json(list);
  });

  // Get single analysis
  app.get("/api/analyses/:id", async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid ID" });
    const analysis = await storage.getAnalysis(id);
    if (!analysis) return res.status(404).json({ error: "Not found" });
    res.json(analysis);
  });

  // Submit deck for analysis
  app.post("/api/analyze", async (req, res) => {
    try {
      const parsed = deckSubmitSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: parsed.error.flatten() });
      }

      const { deckName, format, decklist } = parsed.data;
      const sessionId = req.headers["x-session-id"] as string;

      // Check credits
      const credit = await storage.initCredits(sessionId);
      if (credit.coins <= 0) {
        return res.status(402).json({
          error: "No coins remaining. Each session starts with 3 free analyses.",
        });
      }

      // Parse decklist
      const entries = parseDecklist(decklist);
      if (entries.length === 0) {
        return res.status(400).json({ error: "Could not parse any cards from decklist" });
      }

      // Lookup cards via Scryfall (batch with rate limit respect)
      const uniqueNames = [...new Set(entries.map((e) => e.name))];
      const cardDataMap = new Map<string, any>();

      // Scryfall rate limit: 10 requests per second
      for (let i = 0; i < uniqueNames.length; i++) {
        const data = await lookupCard(uniqueNames[i]);
        if (data) cardDataMap.set(uniqueNames[i], data);
        if (i > 0 && i % 8 === 0) {
          await new Promise((r) => setTimeout(r, 150));
        }
      }

      const cardDetails = entries.map((e) => ({
        quantity: e.quantity,
        data: cardDataMap.get(e.name) || null,
      }));

      const stats = computeStats(cardDetails);

      // AI analysis
      const analysisText = await aiAnalysis(
        deckName,
        format,
        entries,
        stats,
        cardDetails
      );

      // Deduct coin
      await storage.deductCoin(sessionId);

      // Store analysis
      const analysis = await storage.createAnalysis({
        sessionId,
        deckName,
        format,
        decklist,
        cardCount: stats.totalCards,
        analysisResult: analysisText,
        manaCurve: JSON.stringify(stats.manaCurve),
        colorDistribution: JSON.stringify(stats.colorDistribution),
        createdAt: new Date().toISOString(),
      });

      res.json({
        analysis,
        stats,
        coinsRemaining: (await storage.getCredits(sessionId))?.coins ?? 0,
      });
    } catch (err: any) {
      console.error("Analysis error:", err);
      res.status(500).json({ error: "Analysis failed. Please try again." });
    }
  });

  // Validate cards (quick check without full analysis)
  app.post("/api/validate-card", async (req, res) => {
    const { name } = req.body;
    if (!name) return res.status(400).json({ error: "Card name required" });
    const data = await lookupCard(name);
    if (!data) return res.json({ valid: false });
    res.json({
      valid: true,
      name: data.name,
      manaCost: data.mana_cost,
      typeLine: data.type_line,
      imageUri: data.image_uris?.small || data.image_uris?.normal || null,
    });
  });

  return httpServer;
}
