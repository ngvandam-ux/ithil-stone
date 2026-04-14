/**
 * Live Meta Intelligence Engine
 *
 * Fetches current metagame data from MTGGoldfish (primary) and mtgdecks.net (fallback),
 * caches in memory (6-hour TTL), and produces rich meta context for the AI prompt.
 *
 * Also aggregates crowdsourced deck data from user submissions.
 */

// ── Types ────────────────────────────────────────────────────────────
interface MetaDeck {
  name: string;
  metaShare: number;
  tier: number;
  keyCards: string[]; // top cards in this archetype
}

interface MetaSnapshot {
  format: string;
  fetchedAt: number;
  source: string;
  topDecks: MetaDeck[];
  rawText: string;
}

// ── Cache ────────────────────────────────────────────────────────────
const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours
const metaCache = new Map<string, MetaSnapshot>();

// ── Format mapping ───────────────────────────────────────────────────
const GOLDFISH_FORMAT_MAP: Record<string, string> = {
  standard: "standard",
  modern: "modern",
  legacy: "legacy",
  vintage: "vintage",
  pioneer: "pioneer",
  pauper: "pauper",
  commander: "commander_1v1",
  historic: "historic",
  explorer: "explorer",
};

// ── Static fallback (used if all live fetches fail) ──────────────────
const STATIC_FORMAT_CONTEXT: Record<string, string> = {
  standard: `Standard (rotating, last 2-3 years of sets). Speed: Midrange-oriented, turns 5-8. Ideal land count: 24-26 midrange, 20-22 aggro, 26-28 control.`,
  modern: `Modern (non-rotating, 8th Edition forward). Speed: Fast, turns 3-5. Fetchland + shockland mana bases standard. Sideboard matters enormously.`,
  legacy: `Legacy (non-rotating, almost all cards legal). Speed: Extremely fast, turn 1-2 kills possible. Force of Will is the format police.`,
  vintage: `Vintage (all cards legal, restricted list). Speed: Fastest format, turn 1 kills common. Moxen and Black Lotus define the format.`,
  pioneer: `Pioneer (non-rotating, Return to Ravnica forward). Speed: Medium-fast, turns 4-6. No fetchlands.`,
  pauper: `Pauper (commons only). Speed: Moderate, turns 5-8. Efficiency is king.`,
  commander: `Commander / EDH (100-card singleton, multiplayer). Speed varies. Casual: turns 8-12. cEDH: turns 3-5. Singleton.`,
  historic: `Historic (Arena-only, non-rotating). Speed: Medium-fast, turns 4-6. Digital-only format.`,
  explorer: `Explorer (Arena-only, aiming toward Pioneer parity). Speed similar to Pioneer.`,
};

// ── Parse MTGGoldfish metagame HTML ──────────────────────────────────
function parseGoldfishMeta(html: string): MetaDeck[] {
  const decks: MetaDeck[] = [];
  const seen = new Set<string>();

  // Pattern: archetype-tile-title block → name link → percentage nearby
  // Structure found: archetype-tile-title > a[href="/archetype/..."]>Name</a> ... X.X%
  // Also <li> items list key cards before the percentage block
  const tileRegex = /archetype-tile-title[\s\S]*?<a[^>]*href="\/archetype\/[^"]*"[^>]*>([^<]+)<\/a>[\s\S]*?(?:<ul>([\s\S]*?)<\/ul>)?[\s\S]*?(\d{1,2}\.\d{1,2})\s*%/gi;

  let match;
  while ((match = tileRegex.exec(html)) !== null) {
    const rawName = match[1].trim().replace(/&#39;/g, "'").replace(/&amp;/g, "&");
    const share = parseFloat(match[3]);

    // Deduplicate (goldfish shows online + paper links for same deck)
    if (seen.has(rawName) || share <= 0) continue;
    seen.add(rawName);

    // Extract key cards from <li> items
    const keyCards: string[] = [];
    if (match[2]) {
      const liRegex = /<li>([^<]+)<\/li>/gi;
      let liMatch;
      while ((liMatch = liRegex.exec(match[2])) !== null) {
        keyCards.push(liMatch[1].replace(/&#39;/g, "'").replace(/&amp;/g, "&").trim());
      }
    }

    decks.push({ name: rawName, metaShare: share, tier: 0, keyCards });
  }

  // Assign tiers based on position
  decks.sort((a, b) => b.metaShare - a.metaShare);
  for (let i = 0; i < decks.length; i++) {
    if (i < 5) decks[i].tier = 1;
    else if (i < 15) decks[i].tier = 2;
    else decks[i].tier = 3;
  }

  return decks.slice(0, 25);
}

// ── Fetch from MTGGoldfish ───────────────────────────────────────────
async function fetchGoldfishMeta(format: string): Promise<MetaDeck[]> {
  const slug = GOLDFISH_FORMAT_MAP[format];
  if (!slug) return [];

  try {
    const url = `https://www.mtggoldfish.com/metagame/${slug}/full#paper`;
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0",
        Accept: "text/html,application/xhtml+xml",
      },
      signal: AbortSignal.timeout(15000),
    });

    if (!res.ok) {
      console.warn(`[meta] MTGGoldfish returned ${res.status} for ${format}`);
      return [];
    }

    const html = await res.text();
    const decks = parseGoldfishMeta(html);
    console.log(`[meta] MTGGoldfish: ${decks.length} archetypes for ${format}`);
    return decks;
  } catch (err: any) {
    console.warn(`[meta] MTGGoldfish fetch failed for ${format}: ${err.message}`);
    return [];
  }
}

// ── Build the rich meta context string for the AI prompt ─────────────
function buildMetaContext(format: string, decks: MetaDeck[], source: string): string {
  const staticBase = STATIC_FORMAT_CONTEXT[format] || `FORMAT: ${format}`;

  if (decks.length === 0) {
    return `FORMAT: ${staticBase}\n\nNote: Live metagame data was unavailable. Use your most current knowledge of the ${format} meta.`;
  }

  const tier1 = decks.filter((d) => d.tier === 1);
  const tier2 = decks.filter((d) => d.tier === 2);

  let context = `FORMAT: ${staticBase}\n\n`;
  context += `═══ LIVE TOURNAMENT METAGAME (${source}, last 14 days) ═══\n\n`;

  if (tier1.length > 0) {
    context += `TIER 1 — Dominant archetypes (must be prepared for):\n`;
    for (const d of tier1) {
      context += `  • ${d.name} — ${d.metaShare}% meta share`;
      if (d.keyCards.length > 0) context += ` [Key: ${d.keyCards.join(", ")}]`;
      context += `\n`;
    }
    context += `\n`;
  }

  if (tier2.length > 0) {
    context += `TIER 2 — Significant presence:\n`;
    for (const d of tier2) {
      context += `  • ${d.name} — ${d.metaShare}%`;
      if (d.keyCards.length > 0) context += ` [Key: ${d.keyCards.join(", ")}]`;
      context += `\n`;
    }
    context += `\n`;
  }

  const totalT1 = tier1.reduce((sum, d) => sum + d.metaShare, 0);
  context += `Tier 1 combined: ${totalT1.toFixed(1)}% of the field\n`;
  context += `Top threat: ${decks[0]?.name} at ${decks[0]?.metaShare}%\n\n`;
  context += `CRITICAL: Use this live data for Meta Positioning, sideboard recommendations, and card suggestions. Advice MUST reflect what the player will actually face at tournaments right now.\n`;

  return context;
}

// ── Main public function: get live meta ──────────────────────────────
export async function getMetaContext(format: string): Promise<string> {
  const f = format.toLowerCase();

  // Check cache
  const cached = metaCache.get(f);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    console.log(`[meta] Cache hit for ${f} (age: ${Math.round((Date.now() - cached.fetchedAt) / 60000)}m)`);
    return cached.rawText;
  }

  console.log(`[meta] Fetching live meta for ${f}...`);
  const decks = await fetchGoldfishMeta(f);
  const source = "MTGGoldfish";
  const rawText = buildMetaContext(f, decks, source);

  metaCache.set(f, { format: f, fetchedAt: Date.now(), source, topDecks: decks, rawText });
  return rawText;
}

// ── Crowdsourced deck intelligence ───────────────────────────────────
// Aggregates data from all decks submitted by Ithil-stone users.

interface CrowdCardEntry {
  name: string;
  count: number; // how many decks include this card
  totalQty: number; // total copies across all decks
}

interface CrowdFormatSnapshot {
  format: string;
  totalDecks: number;
  popularCards: CrowdCardEntry[];
  recentArchetypes: string[];
  lastUpdated: number;
}

const crowdCache = new Map<string, CrowdFormatSnapshot>();
const CROWD_TTL_MS = 30 * 60 * 1000; // 30 min — recompute from DB

/**
 * Record a submitted deck into the crowd intelligence pool.
 * Called after every successful analysis.
 */
export function recordDeckSubmission(
  format: string,
  deckName: string,
  cards: Array<{ name: string; quantity: number; section: string }>,
  archetype: string | null
): void {
  // Invalidate crowd cache for this format so it recomputes
  crowdCache.delete(format.toLowerCase());
}

/**
 * Build crowdsourced context string for the AI prompt.
 * Reads from the analyses table to aggregate popular cards and archetypes.
 */
export async function getCrowdContext(
  format: string,
  storage: any
): Promise<string> {
  const f = format.toLowerCase();

  const cached = crowdCache.get(f);
  if (cached && Date.now() - cached.lastUpdated < CROWD_TTL_MS) {
    return formatCrowdContext(cached);
  }

  try {
    // Query all past analyses for this format
    const allAnalyses = await storage.getAnalysesByFormat(f);

    if (!allAnalyses || allAnalyses.length < 3) {
      return ""; // Not enough data to be useful
    }

    // Aggregate card popularity across submitted decks
    const cardCounts = new Map<string, { count: number; totalQty: number }>();
    const archetypeNames: string[] = [];

    for (const analysis of allAnalyses) {
      // Track deck names as rough archetype signal
      if (analysis.deckName) archetypeNames.push(analysis.deckName);

      // Parse the decklist to count cards
      const lines = (analysis.decklist || "").split("\n");
      for (const line of lines) {
        const match = line.trim().match(/^(\d+)\s*x?\s+(.+)$/i);
        if (match) {
          const qty = parseInt(match[1], 10);
          const name = match[2].trim();
          const existing = cardCounts.get(name) || { count: 0, totalQty: 0 };
          existing.count++;
          existing.totalQty += qty;
          cardCounts.set(name, existing);
        }
      }
    }

    // Sort by deck inclusion count (how many different decks use this card)
    const popularCards = Array.from(cardCounts.entries())
      .map(([name, data]) => ({ name, count: data.count, totalQty: data.totalQty }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 30);

    // Get unique recent archetype names
    const uniqueArchetypes = [...new Set(archetypeNames)].slice(-15);

    const snapshot: CrowdFormatSnapshot = {
      format: f,
      totalDecks: allAnalyses.length,
      popularCards,
      recentArchetypes: uniqueArchetypes,
      lastUpdated: Date.now(),
    };

    crowdCache.set(f, snapshot);
    return formatCrowdContext(snapshot);
  } catch (err: any) {
    console.warn(`[crowd] Failed to aggregate crowd data for ${f}: ${err.message}`);
    return "";
  }
}

function formatCrowdContext(snapshot: CrowdFormatSnapshot): string {
  if (snapshot.totalDecks < 3) return "";

  let context = `\n═══ ITHIL-STONE COMMUNITY INTELLIGENCE (${snapshot.totalDecks} decks analyzed) ═══\n\n`;

  // Most popular cards across submitted decks
  const nonLands = snapshot.popularCards.filter(
    (c) => !["Mountain", "Island", "Plains", "Swamp", "Forest", "Wastes"].includes(c.name)
  );

  if (nonLands.length > 0) {
    context += `Most popular cards among ${snapshot.format} decks submitted to Ithil-stone:\n`;
    for (const card of nonLands.slice(0, 15)) {
      const pct = Math.round((card.count / snapshot.totalDecks) * 100);
      context += `  • ${card.name} — in ${pct}% of submitted decks (avg ${(card.totalQty / card.count).toFixed(1)} copies)\n`;
    }
    context += `\n`;
  }

  if (snapshot.recentArchetypes.length > 0) {
    context += `Recent deck archetypes submitted: ${snapshot.recentArchetypes.join(", ")}\n`;
  }

  context += `\nUse this community data to understand what strategies Ithil-stone users are exploring. If the submitted deck includes popular community cards, note their prevalence. If it's missing widely-played cards, mention them as potential additions.\n`;

  return context;
}

// ── Cache stats for debugging ────────────────────────────────────────
export function getMetaCacheStats(): Record<string, any> {
  const stats: Record<string, any> = {};
  for (const [format, snapshot] of metaCache.entries()) {
    const ageMin = Math.round((Date.now() - snapshot.fetchedAt) / 60000);
    stats[format] = {
      age: ageMin < 60 ? `${ageMin}m` : `${Math.round(ageMin / 60)}h`,
      deckCount: snapshot.topDecks.length,
      source: snapshot.source,
      topDeck: snapshot.topDecks[0]?.name || "none",
    };
  }

  // Include crowd stats
  for (const [format, crowd] of crowdCache.entries()) {
    if (!stats[format]) stats[format] = {};
    stats[format].crowdDecks = crowd.totalDecks;
    stats[format].crowdTopCard = crowd.popularCards[0]?.name || "none";
  }

  return stats;
}
