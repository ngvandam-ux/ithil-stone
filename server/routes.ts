import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage, db } from "./storage";
import { deckSubmitSchema, users as usersTable, analyses as analysesTable, transactions as transactionsTable, credits as creditsTable } from "@shared/schema";
import { desc } from "drizzle-orm";
import { randomUUID, randomBytes } from "crypto";
import Anthropic from "@anthropic-ai/sdk";
import { Resend } from "resend";
import { getMetaContext, getCrowdContext, recordDeckSubmission, getMetaCacheStats } from "./meta-fetcher";

// ── Auth config ──────────────────────────────────────────────────────
const resend = process.env.RESEND_API_KEY
  ? new Resend(process.env.RESEND_API_KEY)
  : null;

const APP_URL = process.env.APP_URL || "https://ithilstone.gg";
const MAGIC_LINK_EXPIRY_MINUTES = 15;

// Auth session duration: 30 days
const AUTH_SESSION_DURATION_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

function generateToken(): string {
  return randomBytes(32).toString("hex");
}

// ── Scryfall card lookup ──────────────────────────────────────────────
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

// ── Parse decklist text ───────────────────────────────────────────────
function parseDecklist(text: string): Array<{ quantity: number; name: string; section: string }> {
  const lines = text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("//") && !l.startsWith("#"));

  let currentSection = "mainboard";
  const entries: Array<{ quantity: number; name: string; section: string }> = [];

  for (const line of lines) {
    const lowerLine = line.toLowerCase();
    if (lowerLine === "sideboard" || lowerLine === "sideboard:") {
      currentSection = "sideboard";
      continue;
    }
    if (lowerLine === "mainboard" || lowerLine === "mainboard:" || lowerLine === "deck" || lowerLine === "deck:") {
      currentSection = "mainboard";
      continue;
    }
    if (lowerLine === "commander" || lowerLine === "commander:") {
      currentSection = "commander";
      continue;
    }

    const match = line.match(/^(\d+)\s*x?\s+(.+)$/i);
    if (match) {
      entries.push({ quantity: parseInt(match[1], 10), name: match[2].trim(), section: currentSection });
    } else if (line.length > 1) {
      entries.push({ quantity: 1, name: line, section: currentSection });
    }
  }

  return entries;
}

// ── Card role classification based on oracle text ─────────────────────
type CardRole = "removal" | "counterspell" | "draw" | "ramp" | "threat" | "combo" | "protection" | "utility" | "land" | "unknown";

function classifyCardRole(data: any): CardRole[] {
  if (!data) return ["unknown"];
  const typeLine = (data.type_line || "").toLowerCase();
  const text = (data.oracle_text || "").toLowerCase();
  const roles: CardRole[] = [];

  if (typeLine.includes("land")) return ["land"];

  // Removal
  if (
    text.includes("destroy target") ||
    text.includes("exile target") ||
    text.includes("deals") && (text.includes("damage to") || text.includes("damage to any target")) ||
    text.includes("destroy all") ||
    text.includes("-x/-x") ||
    text.match(/-\d+\/-\d+/)
  ) {
    roles.push("removal");
  }

  // Counterspell
  if (text.includes("counter target") || text.includes("counter that spell")) {
    roles.push("counterspell");
  }

  // Card draw / advantage
  if (
    text.includes("draw a card") ||
    text.includes("draw two") ||
    text.includes("draw cards") ||
    text.includes("look at the top") ||
    text.includes("scry") ||
    text.includes("surveil")
  ) {
    roles.push("draw");
  }

  // Ramp / mana acceleration
  if (
    text.includes("add {") || text.includes("add one mana") ||
    text.includes("search your library for a") && (text.includes("land") || text.includes("forest") || text.includes("plains") || text.includes("island") || text.includes("mountain") || text.includes("swamp")) ||
    (typeLine.includes("creature") && text.includes("add") && text.includes("mana"))
  ) {
    roles.push("ramp");
  }

  // Protection
  if (
    text.includes("hexproof") || text.includes("indestructible") ||
    text.includes("protection from") || text.includes("can't be countered") ||
    text.includes("regenerate") || text.includes("your life total can't change")
  ) {
    roles.push("protection");
  }

  // Threat (creatures with power, planeswalkers)
  if (typeLine.includes("planeswalker")) {
    roles.push("threat");
  } else if (typeLine.includes("creature") && roles.length === 0) {
    roles.push("threat");
  }

  // If nothing matched
  if (roles.length === 0) roles.push("utility");

  return roles;
}

// ── Count mana pips for color fixing analysis ─────────────────────────
function countPips(manaCost: string): Record<string, number> {
  const pips: Record<string, number> = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 };
  if (!manaCost) return pips;
  const matches = manaCost.match(/\{([^}]+)\}/g) || [];
  for (const m of matches) {
    const sym = m.replace(/[{}]/g, "");
    if (sym === "W") pips.W++;
    else if (sym === "U") pips.U++;
    else if (sym === "B") pips.B++;
    else if (sym === "R") pips.R++;
    else if (sym === "G") pips.G++;
    else if (/^\d+$/.test(sym)) pips.C += parseInt(sym, 10);
  }
  return pips;
}

// ── Format context is now fetched live from meta-fetcher.ts ──────────
// See server/meta-fetcher.ts for the live metagame intelligence engine.

// ── Enhanced stats computation ────────────────────────────────────────
function computeStats(cards: Array<{ quantity: number; data: any; section: string }>) {
  const manaCurve: Record<string, number> = { "0": 0, "1": 0, "2": 0, "3": 0, "4": 0, "5": 0, "6+": 0 };
  const colorDist: Record<string, number> = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 };
  const totalPips: Record<string, number> = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 };
  const roleCounts: Record<string, number> = {};
  const keywordCounts: Record<string, number> = {};

  let landCount = 0;
  let creatureCount = 0;
  let instantSorceryCount = 0;
  let planeswalkerCount = 0;
  let enchantmentCount = 0;
  let artifactCount = 0;
  let otherCount = 0;
  let totalPrice = 0;
  let priceableCards = 0;
  let illegalCards: string[] = [];

  for (const { quantity, data, section } of cards) {
    if (!data || section !== "mainboard") continue;

    const typeLine = (data.type_line || "").toLowerCase();

    // Type breakdown
    if (typeLine.includes("land")) {
      landCount += quantity;
    } else {
      const cmc = Math.floor(data.cmc || 0);
      const key = cmc >= 6 ? "6+" : String(cmc);
      manaCurve[key] = (manaCurve[key] || 0) + quantity;

      if (typeLine.includes("creature")) creatureCount += quantity;
      else if (typeLine.includes("instant") || typeLine.includes("sorcery")) instantSorceryCount += quantity;
      else if (typeLine.includes("planeswalker")) planeswalkerCount += quantity;
      else if (typeLine.includes("enchantment")) enchantmentCount += quantity;
      else if (typeLine.includes("artifact")) artifactCount += quantity;
      else otherCount += quantity;
    }

    // Color distribution
    const colors = data.colors || data.color_identity || [];
    if (colors.length === 0 && !typeLine.includes("land")) {
      colorDist["C"] += quantity;
    } else {
      for (const c of colors) {
        colorDist[c] = (colorDist[c] || 0) + quantity;
      }
    }

    // Pip counting for color fixing math
    const pips = countPips(data.mana_cost || "");
    for (const [color, count] of Object.entries(pips)) {
      totalPips[color] = (totalPips[color] || 0) + count * quantity;
    }

    // Card role classification
    const roles = classifyCardRole(data);
    for (const role of roles) {
      roleCounts[role] = (roleCounts[role] || 0) + quantity;
    }

    // Keywords
    if (data.keywords) {
      for (const kw of data.keywords) {
        keywordCounts[kw] = (keywordCounts[kw] || 0) + quantity;
      }
    }

    // Price tracking
    const usdPrice = parseFloat(data.prices?.usd || "0");
    if (usdPrice > 0) {
      totalPrice += usdPrice * quantity;
      priceableCards += quantity;
    }
  }

  const nonLandCount = cards
    .filter((c) => c.data && c.section === "mainboard" && !(c.data.type_line || "").toLowerCase().includes("land"))
    .reduce((sum, c) => sum + c.quantity, 0);

  const avgCmc = nonLandCount > 0
    ? Object.entries(manaCurve).reduce(
        (sum, [k, v]) => sum + (k === "6+" ? 6.5 : parseInt(k)) * (v as number), 0
      ) / nonLandCount
    : 0;

  return {
    manaCurve,
    colorDistribution: colorDist,
    totalPips,
    roleCounts,
    keywordCounts,
    landCount,
    creatureCount,
    instantSorceryCount,
    planeswalkerCount,
    enchantmentCount,
    artifactCount,
    otherCount,
    totalCards: cards.filter((c) => c.section === "mainboard").reduce((sum, c) => sum + c.quantity, 0),
    sideboardCards: cards.filter((c) => c.section === "sideboard").reduce((sum, c) => sum + c.quantity, 0),
    avgCmc: Math.round(avgCmc * 100) / 100,
    totalPrice: Math.round(totalPrice * 100) / 100,
    illegalCards,
  };
}

// ── Build rich card data for the AI prompt ────────────────────────────
function buildCardSummary(
  cardDetails: Array<{ quantity: number; data: any; section: string }>,
  format: string
): string {
  const mainboard = cardDetails.filter((c) => c.data && c.section === "mainboard");
  const sideboard = cardDetails.filter((c) => c.data && c.section === "sideboard");

  const formatCardLine = (c: { quantity: number; data: any }) => {
    const d = c.data;
    const roles = classifyCardRole(d);
    const legal = d.legalities?.[format];
    const legalTag = legal === "legal" ? "" : legal === "banned" ? " [BANNED]" : legal === "not_legal" ? " [NOT LEGAL]" : "";
    const price = d.prices?.usd ? `$${d.prices.usd}` : "";
    const keywords = d.keywords?.length > 0 ? ` [${d.keywords.join(", ")}]` : "";
    const pt = d.power && d.toughness ? ` ${d.power}/${d.toughness}` : "";
    const oracleSnippet = d.oracle_text ? d.oracle_text.replace(/\n/g, " ").substring(0, 120) : "";

    return `${c.quantity}x ${d.name} ${d.mana_cost || ""} — ${d.type_line}${pt} (CMC ${d.cmc})${legalTag}${keywords}
   Roles: [${roles.join(", ")}] | EDHREC: #${d.edhrec_rank || "N/A"} | ${price}
   ${oracleSnippet}`;
  };

  let summary = "=== MAINBOARD ===\n";
  summary += mainboard.map(formatCardLine).join("\n\n");

  if (sideboard.length > 0) {
    summary += "\n\n=== SIDEBOARD ===\n";
    summary += sideboard.map(formatCardLine).join("\n\n");
  }

  return summary;
}

// ── AI analysis via Claude (Anthropic SDK) ────────────────────────────
async function aiAnalysis(
  deckName: string,
  format: string,
  entries: Array<{ quantity: number; name: string; section: string }>,
  stats: any,
  cardDetails: Array<{ quantity: number; data: any; section: string }>
): Promise<string> {
  const cardSummary = buildCardSummary(cardDetails, format);

  // Fetch live metagame data (cached, 6hr TTL)
  const formatContext = await getMetaContext(format);

  // Fetch crowdsourced intelligence from user-submitted decks
  const crowdContext = await getCrowdContext(format, storage);

  // Color fixing analysis
  const colorPips = Object.entries(stats.totalPips)
    .filter(([k, v]) => k !== "C" && (v as number) > 0)
    .map(([k, v]) => `${k}: ${v} pips`)
    .join(", ");

  const roleBreakdown = Object.entries(stats.roleCounts)
    .filter(([, v]) => (v as number) > 0)
    .map(([k, v]) => `${k}: ${v}`)
    .join(", ");

  const keywordBreakdown = Object.entries(stats.keywordCounts)
    .filter(([, v]) => (v as number) > 0)
    .sort((a, b) => (b[1] as number) - (a[1] as number))
    .slice(0, 10)
    .map(([k, v]) => `${k}: ${v}`)
    .join(", ");

  const prompt = `You are the Ithil-stone — an ancient, all-seeing palantír that has witnessed every battle strategy across the ages of Middle-earth, now turned to the art of Magic: The Gathering. You speak as a wise war counselor: measured, authoritative, occasionally poetic, but always precise and actionable. Think of yourself as Gandalf advising at a war council — you don't waste words, but when you speak, it carries weight.

You have encyclopedic knowledge of every card legal in ${format} and the competitive tournament meta. You have access to LIVE metagame data from recent tournaments (provided below). Analyze this ${format} deck named "${deckName}" with the strategic depth of one who has counseled kings and generals. Your advice must reflect the CURRENT meta, not outdated assumptions.

${formatContext}
${crowdContext}
═══════════════════════════════════════════════
DECK DATA (${stats.totalCards} mainboard${stats.sideboardCards > 0 ? ` + ${stats.sideboardCards} sideboard` : ""})
═══════════════════════════════════════════════

${cardSummary}

═══════════════════════════════════════════════
COMPUTED STATISTICS
═══════════════════════════════════════════════
• Average CMC: ${stats.avgCmc}
• Mana Curve: ${JSON.stringify(stats.manaCurve)}
• Color Pips Required: ${colorPips || "Colorless"}
• Color Identity: ${Object.entries(stats.colorDistribution).filter(([,v]) => (v as number) > 0).map(([k,v]) => `${k}:${v}`).join(", ")}
• Type Breakdown: ${stats.creatureCount} creatures, ${stats.instantSorceryCount} instants/sorceries, ${stats.planeswalkerCount} planeswalkers, ${stats.enchantmentCount} enchantments, ${stats.artifactCount} artifacts, ${stats.otherCount} other, ${stats.landCount} lands
• Card Roles: ${roleBreakdown}
• Keywords Present: ${keywordBreakdown || "None"}
• Estimated Deck Price: $${stats.totalPrice} USD
${stats.illegalCards.length > 0 ? `• ⚠️ FORMAT LEGALITY ISSUES: ${stats.illegalCards.join(", ")}` : ""}

═══════════════════════════════════════════════
ANALYSIS INSTRUCTIONS
═══════════════════════════════════════════════

Provide thorough, expert analysis in your war-counselor voice. Use markdown formatting with ## headers. Weave in subtle war/strategy metaphors naturally — do not overdo it. Structure your response EXACTLY with these sections:

## Deck Archetype
Identify the precise archetype and sub-archetype. Explain the game plan in 2-3 sentences. State the primary win condition and backup plan.

## Power Assessment
Rate the deck 1-10. Break down:
- **Speed:** How fast can this deck win? What turn does it threaten lethal?
- **Consistency:** How reliably does it execute its game plan? (redundancy, curve, card quality)
- **Resilience:** How well does it recover from disruption? (board wipes, counterspells, discard)
- **Disruption:** How much can it disrupt opponent's plans?

Format: **X/10** — [one-line justification]

## Strengths
3-4 specific strengths. Reference actual cards and interactions.

## Weaknesses
3-4 specific vulnerabilities. Be brutally honest about gaps.

## Mana Base Deep Dive
- Is the land count correct for this curve and strategy?
- Color pip analysis: Are there enough sources of each color? Consider turn-by-turn color requirements.
- Specific land suggestions if the mana base needs work (name actual lands legal in ${format}).

## Key Synergies & Interactions
Identify 3-5 notable card synergies or play patterns already in the deck. Explain the sequencing that makes them powerful.

## Combo Discovery
This is critical. Look at every card in the deck through a combo lens:
- Identify 2-3 hidden or non-obvious multi-card combos within the existing cards that the player may not realize. Explain the exact sequence of plays.
- For each combo, rate it: **Competitive** (tournament-viable), **Strong** (consistent in casual/FNM), or **Situational** (requires specific setup).
- If there are infinite combos or near-infinite loops possible with cards already in the deck, highlight them.
- Mention any well-known combo lines in ${format} that are only 1-2 cards away from being enabled by this deck's existing shell.

## Cards You're Missing
This is the most valuable section. Based on the strategy and archetype you identified, suggest 8-12 specific cards that are:
1. **Legal in ${format}** (this is mandatory — never suggest banned or not-legal cards)
2. Cards the player likely hasn't considered that would significantly improve the deck's strategy
3. Organized into tiers:
   - **Must-Add (3-4 cards):** These cards are so good for this strategy that not running them is a mistake. Explain exactly what they do for the game plan and what to cut for them.
   - **Strong Upgrades (3-4 cards):** Meaningful improvements that raise the deck's power level. Explain the upgrade path.
   - **Spicy Tech (2-4 cards):** Unexpected or underplayed cards that synergize with the deck's specific card pool in ways opponents won't expect. These are the "I didn't think of that" suggestions.

For EACH suggestion, specify: the card name, its mana cost, what it does for this specific deck (not generic value), and what card(s) to cut to make room.

## Weakest Cards to Cut
Identify the 3-4 weakest cards in the deck. For each, explain specifically why it underperforms in this shell and what role a replacement should fill.

## Sideboard Guide
${stats.sideboardCards > 0 ? "Evaluate the current sideboard. What matchups does it address? What gaps remain? Suggest specific swaps for the top 4 matchups in the current " + format + " meta." : "Build a complete 15-card sideboard for the most common matchups in the current " + format + " meta. For each card, specify which matchup it's for and what to board out."}

## Meta Positioning
How does this deck match up against the top 4-5 archetypes in ${format}? For each:
- Rate: **Favorable** / **Even** / **Unfavorable**
- Key cards that matter in the matchup
- One-line sideboard tip

## Upgrade Path
Total deck price is ~$${stats.totalPrice}. Provide a clear upgrade roadmap:
- **Budget swaps ($):** Cheap improvements under $5 each that meaningfully upgrade the deck.
- **Mid-range upgrades ($$):** $5-20 cards that take the deck to the next level.
- **Premium staples ($$$):** The aspirational cards that make this a fully optimized list.

CRITICAL FORMAT RULES:
- You MUST complete ALL sections above. Do NOT stop early or skip sections.
- **EVERY card name MUST be wrapped in bold markdown** using **Card Name** syntax. This includes cards already in the deck, suggested cards, sideboard cards, cards mentioned in matchups — ALL of them, every single time. For example: write **Fatal Push**, not Fatal Push. Write **Lightning Bolt**, not Lightning Bolt. This is essential for the UI to render card images.
- Keep Strengths, Weaknesses, and Mana Base sections concise (2-3 sentences each bullet, no multi-paragraph explanations).
- Key Synergies: 1-2 sentences per synergy. Don't over-explain obvious interactions.
- Pour your depth into Combo Discovery, Cards You're Missing, and Meta Positioning — these are the signature value.
- Every card you suggest MUST be legal in ${format}. Double-check legality before recommending.
- Name real, specific cards — never say "a removal spell" when you can say **Fatal Push** or **Lightning Bolt**.
- Reference actual ${format} tournament results and meta positions where relevant.
- Write for an experienced player who wants actionable insights they haven't thought of, not generic advice they already know.
- Target approximately 4000 words total. Complete every section.`;

  try {
    const client = new Anthropic();
    const message = await client.messages.create({
      model: "claude-opus-4-6",
      max_tokens: 16384,
      messages: [{ role: "user", content: prompt }],
    });

    const textBlock = message.content.find((b: any) => b.type === "text");
    return (textBlock as any)?.text || generateFallbackAnalysis(deckName, format, entries, stats);
  } catch (err) {
    console.error("AI analysis failed:", err);
    return generateFallbackAnalysis(deckName, format, entries, stats);
  }
}

function generateFallbackAnalysis(
  deckName: string,
  format: string,
  entries: Array<{ quantity: number; name: string; section: string }>,
  stats: any
): string {
  const colorStr = Object.entries(stats.colorDistribution)
    .filter(([, v]) => (v as number) > 0)
    .map(([k, v]) => `${k}: ${v}`)
    .join(", ");

  const landRatio = ((stats.landCount / stats.totalCards) * 100).toFixed(1);

  return `## ${deckName} — ${format.charAt(0).toUpperCase() + format.slice(1)} Analysis

**Deck Overview:** ${stats.totalCards} cards across ${entries.length} unique cards. Average CMC: ${stats.avgCmc}. Color distribution: ${colorStr}.

**Mana Base:** ${stats.landCount} lands (${landRatio}% of deck). ${parseFloat(landRatio) < 35 ? "Consider adding more lands to avoid mana screw." : parseFloat(landRatio) > 42 ? "Land count is high — consider trimming." : "Land count looks appropriate."}

**Card Type Breakdown:** ${stats.creatureCount} creatures, ${stats.instantSorceryCount} instants/sorceries, ${stats.planeswalkerCount} planeswalkers, ${stats.enchantmentCount} enchantments, ${stats.artifactCount} artifacts, ${stats.landCount} lands.

**Card Roles:** ${Object.entries(stats.roleCounts).filter(([,v]) => (v as number) > 0).map(([k,v]) => `${k}: ${v}`).join(", ")}

**Estimated Deck Price:** $${stats.totalPrice} USD

*Full AI-powered analysis including synergy detection, meta positioning, and card swap recommendations requires the AI service to be configured.*`;
}

// ── URL deck import from popular sites ────────────────────────────────
async function importDeckFromUrl(url: string): Promise<{ deckName: string; format: string; decklist: string } | null> {
  try {
    const u = new URL(url);

    // Moxfield: https://www.moxfield.com/decks/{deckId}
    if (u.hostname.includes("moxfield.com") && u.pathname.startsWith("/decks/")) {
      const deckId = u.pathname.split("/decks/")[1]?.split("/")[0]?.split("?")[0];
      if (!deckId) return null;

      // Use Moxfield v3 API
      const apiRes = await fetch(`https://api2.moxfield.com/v3/decks/all/${deckId}`, {
        headers: { "User-Agent": "ArcaneStudy/1.0" },
      });
      if (!apiRes.ok) {
        // Try v2 fallback
        const v2Res = await fetch(`https://api.moxfield.com/v2/decks/all/${deckId}`, {
          headers: { "User-Agent": "ArcaneStudy/1.0" },
        });
        if (!v2Res.ok) return null;
        const v2Data = await v2Res.json() as any;
        return parseMoxfieldResponse(v2Data);
      }
      const data = await apiRes.json() as any;
      return parseMoxfieldResponse(data);
    }

    // Archidekt: https://archidekt.com/decks/{deckId}/{optional-name}
    if (u.hostname.includes("archidekt.com") && u.pathname.includes("/decks/")) {
      const pathParts = u.pathname.split("/");
      const deckIdx = pathParts.indexOf("decks");
      const deckId = pathParts[deckIdx + 1];
      if (!deckId) return null;

      const apiRes = await fetch(`https://archidekt.com/api/decks/${deckId}/`, {
        headers: { "User-Agent": "ArcaneStudy/1.0" },
      });
      if (!apiRes.ok) return null;
      const data = await apiRes.json() as any;
      return parseArchidektResponse(data);
    }

    // MTGGoldfish: https://www.mtggoldfish.com/deck/{deckId}
    if (u.hostname.includes("mtggoldfish.com") && u.pathname.includes("/deck/")) {
      // Fetch the download text version
      const downloadUrl = url.replace("/deck/", "/deck/download/");
      const res = await fetch(downloadUrl, {
        headers: { "User-Agent": "ArcaneStudy/1.0" },
        redirect: "follow",
      });
      if (!res.ok) return null;
      const text = await res.text();
      // Try to extract deck name from the URL or page
      const deckName = u.pathname.split("/").pop()?.replace(/-/g, " ") || "Imported Deck";
      return { deckName, format: "", decklist: text };
    }

    return null;
  } catch (err) {
    console.error("URL import error:", err);
    return null;
  }
}

function parseMoxfieldResponse(data: any): { deckName: string; format: string; decklist: string } | null {
  try {
    const deckName = data.name || "Imported Deck";
    const formatMap: Record<string, string> = {
      standard: "standard", modern: "modern", legacy: "legacy", vintage: "vintage",
      pioneer: "pioneer", pauper: "pauper", commander: "commander", edh: "commander",
      historic: "historic", explorer: "explorer", brawl: "commander",
    };
    const rawFormat = (data.format || "").toLowerCase();
    const format = formatMap[rawFormat] || "";

    const lines: string[] = [];

    // Process each board
    const boards = ["mainboard", "sideboard", "commanders", "companions"];
    for (const board of boards) {
      const boardData = data[board];
      if (!boardData || typeof boardData !== "object") continue;

      if (board === "sideboard" && Object.keys(boardData).length > 0) {
        lines.push("");
        lines.push("Sideboard");
      }
      if (board === "commanders" && Object.keys(boardData).length > 0) {
        lines.push("");
        lines.push("Commander");
      }

      for (const [, entry] of Object.entries(boardData)) {
        const e = entry as any;
        const qty = e.quantity || 1;
        const name = e.card?.name || e.name || "";
        if (name) lines.push(`${qty} ${name}`);
      }
    }

    return { deckName, format, decklist: lines.join("\n") };
  } catch {
    return null;
  }
}

function parseArchidektResponse(data: any): { deckName: string; format: string; decklist: string } | null {
  try {
    const deckName = data.name || "Imported Deck";
    const formatId = data.deckFormat;
    const formatMap: Record<number, string> = {
      1: "standard", 2: "modern", 3: "commander", 4: "legacy", 5: "vintage",
      6: "pauper", 7: "pioneer", 11: "historic", 12: "explorer",
    };
    const format = formatMap[formatId] || "";

    const lines: string[] = [];
    const sideboardLines: string[] = [];
    const commanderLines: string[] = [];

    const cards = data.cards || [];
    for (const entry of cards) {
      const qty = entry.quantity || 1;
      const name = entry.card?.oracleCard?.name || entry.card?.name || "";
      if (!name) continue;

      const categories = entry.categories || [];
      if (categories.includes("Commander")) {
        commanderLines.push(`${qty} ${name}`);
      } else if (categories.includes("Sideboard")) {
        sideboardLines.push(`${qty} ${name}`);
      } else {
        lines.push(`${qty} ${name}`);
      }
    }

    const result: string[] = [];
    if (commanderLines.length > 0) {
      result.push("Commander", ...commanderLines, "");
    }
    result.push(...lines);
    if (sideboardLines.length > 0) {
      result.push("", "Sideboard", ...sideboardLines);
    }

    return { deckName, format, decklist: result.join("\n") };
  } catch {
    return null;
  }
}

// ── Parse MTGO .dek XML format ────────────────────────────────────────
function parseDekFile(content: string): string {
  // MTGO .dek format is XML: <Deck><Cards CatID="..." Quantity="..." Sideboard="false" Name="..."/></Deck>
  const lines: string[] = [];
  const sideboardLines: string[] = [];

  const cardRegex = /<Cards[^>]*?Quantity="(\d+)"[^>]*?Sideboard="(true|false)"[^>]*?Name="([^"]+)"[^>]*?\/>/gi;
  // Also handle attribute order variations
  const cardRegex2 = /<Cards[^>]*?Name="([^"]+)"[^>]*?Quantity="(\d+)"[^>]*?Sideboard="(true|false)"[^>]*?\/>/gi;

  let match;
  while ((match = cardRegex.exec(content)) !== null) {
    const qty = match[1];
    const sideboard = match[2] === "true";
    const name = match[3];
    if (sideboard) sideboardLines.push(`${qty} ${name}`);
    else lines.push(`${qty} ${name}`);
  }

  // Try alternate attribute order if nothing found
  if (lines.length === 0 && sideboardLines.length === 0) {
    while ((match = cardRegex2.exec(content)) !== null) {
      const name = match[1];
      const qty = match[2];
      const sideboard = match[3] === "true";
      if (sideboard) sideboardLines.push(`${qty} ${name}`);
      else lines.push(`${qty} ${name}`);
    }
  }

  const result: string[] = [...lines];
  if (sideboardLines.length > 0) {
    result.push("", "Sideboard", ...sideboardLines);
  }
  return result.join("\n");
}

// ── Clean Arena-style card entries ────────────────────────────────────
function cleanArenaFormat(text: string): string {
  // Arena format: "4 Lightning Bolt (2XM) 117" or "4x Lightning Bolt (2XM) 117"
  // Also handles: "1 Aether Vial (DST) 91" with special chars
  return text
    .split("\n")
    .map((line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("//") || trimmed.startsWith("#")) return trimmed;

      // Section headers pass through
      const lower = trimmed.toLowerCase();
      if (
        lower === "deck" || lower === "deck:" ||
        lower === "sideboard" || lower === "sideboard:" ||
        lower === "commander" || lower === "commander:" ||
        lower === "companion" || lower === "companion:"
      ) {
        return trimmed;
      }

      // Strip Arena set code + collector number: "4 Lightning Bolt (2XM) 117" → "4 Lightning Bolt"
      const arenaMatch = trimmed.match(/^(\d+)\s*x?\s+(.+?)\s+\([A-Z0-9]+\)\s*\d*\s*$/i);
      if (arenaMatch) {
        return `${arenaMatch[1]} ${arenaMatch[2].trim()}`;
      }

      return trimmed;
    })
    .join("\n");
}

// ── Express routes ────────────────────────────────────────────────────
export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  // ── Middleware: session ID + auth resolution ────────────────────
  app.use((req, _res, next) => {
    if (!req.headers["x-session-id"]) {
      req.headers["x-session-id"] = randomUUID();
    }
    // Resolve auth token → user (DB-persisted sessions survive redeploys)
    const authToken = req.headers["x-auth-token"] as string | undefined;
    if (authToken) {
      storage.getAuthSession(authToken).then((session) => {
        if (session && new Date(session.expiresAt) > new Date()) {
          (req as any).userId = session.userId;
          (req as any).userEmail = session.email;
        } else if (session) {
          storage.deleteAuthSession(authToken); // expired
        }
        next();
      }).catch(() => next());
      return; // don't call next() synchronously
    }
    next();
  });

  // ── Auth: Send magic link ──────────────────────────────────────
  app.post("/api/auth/send-link", async (req, res) => {
    try {
      const { email } = req.body;
      if (!email || typeof email !== "string" || !email.includes("@")) {
        return res.status(400).json({ error: "Valid email required" });
      }

      const normalizedEmail = email.toLowerCase().trim();
      const token = generateToken();
      const expiresAt = new Date(Date.now() + MAGIC_LINK_EXPIRY_MINUTES * 60 * 1000).toISOString();

      await storage.createMagicLink(normalizedEmail, token, expiresAt);

      const magicUrl = `${APP_URL}/#/auth/verify/${token}`;

      if (resend) {
        await resend.emails.send({
          from: "Ithil-stone <noreply@ithilstone.gg>",
          to: normalizedEmail,
          subject: "Your key to the seeing-stone",
          html: `
            <div style="font-family: Georgia, 'Times New Roman', serif; max-width: 480px; margin: 0 auto; padding: 32px; background: #0a0f0a; color: #c8cfc8; border-radius: 12px;">
              <h1 style="color: #4ade80; font-size: 20px; margin-bottom: 8px; font-variant: small-caps; letter-spacing: 1px;">Ithil-stone</h1>
              <p style="color: #8a9a8a; font-size: 13px; margin-bottom: 24px;">AI-Powered MTG Deck Analysis</p>
              <p style="font-size: 15px; line-height: 1.6;">A request has been made to access the seeing-stone. Click below to enter:</p>
              <a href="${magicUrl}" style="display: inline-block; margin: 24px 0; padding: 14px 32px; background: #166534; color: #fff; text-decoration: none; border-radius: 8px; font-size: 15px; font-weight: 600; letter-spacing: 0.5px;">Enter the Stone</a>
              <p style="font-size: 13px; color: #5a6a5a; margin-top: 24px;">This link expires in ${MAGIC_LINK_EXPIRY_MINUTES} minutes. If you did not request this, you may safely ignore it.</p>
              <p style="font-size: 12px; color: #3a4a3a; margin-top: 32px; font-style: italic;">"The palant\u00EDri are not all accounted for. We do not know who else may be watching."</p>
            </div>
          `,
        });
        console.log(`Magic link sent to ${normalizedEmail}`);
      } else {
        // Dev mode: log the link to console
        console.log(`[DEV] Magic link for ${normalizedEmail}: ${magicUrl}`);
      }

      res.json({ success: true, message: "If that email is valid, a magic link has been sent." });
    } catch (err: any) {
      console.error("Send magic link error:", err);
      res.status(500).json({ error: "Failed to send magic link" });
    }
  });

  // ── Auth: Verify magic link ────────────────────────────────────
  app.get("/api/auth/verify", async (req, res) => {
    try {
      const { token } = req.query;
      if (!token || typeof token !== "string") {
        return res.status(400).json({ error: "Token required" });
      }

      const link = await storage.getMagicLinkByToken(token);
      if (!link) {
        return res.status(400).json({ error: "Invalid or expired link" });
      }
      if (link.used) {
        return res.status(400).json({ error: "This link has already been used" });
      }
      if (new Date(link.expiresAt) < new Date()) {
        return res.status(400).json({ error: "This link has expired" });
      }

      // Mark link as used
      await storage.markMagicLinkUsed(token);

      // Find or create user
      let user = await storage.getUserByEmail(link.email);
      if (!user) {
        user = await storage.createUser(randomUUID(), link.email);
      }

      // Create auth session (DB-persisted — survives redeploys)
      const authToken = generateToken();
      const expiresAtSession = new Date(Date.now() + AUTH_SESSION_DURATION_MS).toISOString();
      await storage.createAuthSession(authToken, user.id, user.email, expiresAtSession);

      // Migrate anonymous session data to user account
      const sessionId = req.headers["x-session-id"] as string;
      if (sessionId) {
        await storage.migrateSessionToUser(sessionId, user.id);
      }

      res.json({
        success: true,
        authToken,
        user: { id: user.id, email: user.email },
      });
    } catch (err: any) {
      console.error("Verify magic link error:", err);
      res.status(500).json({ error: "Failed to verify link" });
    }
  });

  // ── Auth: Get current user ─────────────────────────────────────
  app.get("/api/auth/me", async (req, res) => {
    const userId = (req as any).userId;
    if (!userId) {
      return res.json({ user: null });
    }
    const user = await storage.getUserById(userId);
    if (!user) {
      return res.json({ user: null });
    }
    res.json({ user: { id: user.id, email: user.email } });
  });

  // ── Auth: Logout ───────────────────────────────────────────────
  app.post("/api/auth/logout", async (req, res) => {
    const authToken = req.headers["x-auth-token"] as string | undefined;
    if (authToken) {
      await storage.deleteAuthSession(authToken);
    }
    res.json({ success: true });
  });

  // Clean expired sessions periodically (every hour)
  setInterval(() => storage.cleanExpiredSessions(), 60 * 60 * 1000);

  // ── Credits (user-aware) ───────────────────────────────────────
  app.get("/api/credits", async (req, res) => {
    const sessionId = req.headers["x-session-id"] as string;
    const userId = (req as any).userId as string | undefined;
    const credit = await storage.initCredits(sessionId, userId);
    res.json(credit);
  });

  // ── Analyses (user-aware) ──────────────────────────────────────
  app.get("/api/analyses", async (req, res) => {
    const sessionId = req.headers["x-session-id"] as string;
    const userId = (req as any).userId as string | undefined;
    // If logged in, return user's analyses; otherwise session-based
    const list = userId
      ? await storage.getAnalysesByUser(userId)
      : await storage.getAnalysesBySession(sessionId);
    res.json(list);
  });

  app.get("/api/analyses/:id", async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid ID" });
    const analysis = await storage.getAnalysis(id);
    if (!analysis) return res.status(404).json({ error: "Not found" });
    res.json(analysis);
  });

  // URL import endpoint
  app.post("/api/import-url", async (req, res) => {
    try {
      const { url } = req.body;
      if (!url || typeof url !== "string") {
        return res.status(400).json({ error: "URL is required" });
      }

      const result = await importDeckFromUrl(url);
      if (!result) {
        return res.status(400).json({
          error: "Could not import deck from this URL. Supported sites: Moxfield, Archidekt, MTGGoldfish.",
        });
      }

      res.json(result);
    } catch (err: any) {
      console.error("Import URL error:", err);
      res.status(500).json({ error: "Failed to import deck from URL." });
    }
  });

  // File import endpoint (parse .dek XML or plain text)
  app.post("/api/import-file", async (req, res) => {
    try {
      const { content, filename } = req.body;
      if (!content || typeof content !== "string") {
        return res.status(400).json({ error: "File content is required" });
      }

      const ext = (filename || "").toLowerCase().split(".").pop() || "txt";
      let decklist: string;

      if (ext === "dek") {
        // MTGO .dek XML format
        decklist = parseDekFile(content);
      } else {
        // Plain text — auto-detect and clean Arena format
        decklist = cleanArenaFormat(content);
      }

      if (!decklist.trim()) {
        return res.status(400).json({ error: "No cards found in file." });
      }

      // Try to get deck name from filename
      const deckName = (filename || "Imported Deck")
        .replace(/\.(txt|dek|dec|mwDeck)$/i, "")
        .replace(/[_-]/g, " ");

      res.json({ deckName, format: "", decklist });
    } catch (err: any) {
      console.error("Import file error:", err);
      res.status(500).json({ error: "Failed to parse file." });
    }
  });

  app.post("/api/analyze", async (req, res) => {
    try {
      const parsed = deckSubmitSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: parsed.error.flatten() });
      }

      const { deckName, format } = parsed.data;
      // Auto-clean Arena format (strip set codes + collector numbers)
      const decklist = cleanArenaFormat(parsed.data.decklist);
      const sessionId = req.headers["x-session-id"] as string;
      const userId = (req as any).userId as string | undefined;

      // Check credits
      const credit = await storage.initCredits(sessionId, userId);
      if (credit.coins <= 0) {
        return res.status(402).json({
          error: "No Mithril Rings remaining. Sign in to preserve your balance, or visit the Mint to acquire more.",
        });
      }

      // Parse decklist
      const entries = parseDecklist(decklist);
      if (entries.length === 0) {
        return res.status(400).json({ error: "Could not parse any cards from decklist" });
      }

      // Lookup cards via Scryfall
      const uniqueNames = [...new Set(entries.map((e) => e.name))];
      const cardDataMap = new Map<string, any>();

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
        section: e.section,
      }));

      // Check format legality
      const stats = computeStats(cardDetails);
      const illegalCards: string[] = [];
      for (const { data } of cardDetails) {
        if (!data) continue;
        const legality = data.legalities?.[format];
        if (legality === "banned" || legality === "not_legal") {
          if (!illegalCards.includes(data.name)) {
            illegalCards.push(data.name);
          }
        }
      }
      stats.illegalCards = illegalCards;

      // AI analysis
      const analysisText = await aiAnalysis(deckName, format, entries, stats, cardDetails);

      // Deduct coin
      await storage.deductCoin(sessionId);

      // Store analysis
      const analysis = await storage.createAnalysis({
        sessionId,
        userId: userId ?? null,
        deckName,
        format,
        decklist,
        cardCount: stats.totalCards,
        analysisResult: analysisText,
        manaCurve: JSON.stringify(stats.manaCurve),
        colorDistribution: JSON.stringify(stats.colorDistribution),
        createdAt: new Date().toISOString(),
      });

      // Feed into crowdsourced intelligence pool
      recordDeckSubmission(format, deckName, entries, deckName);

      res.json({
        analysis,
        stats: {
          ...stats,
          roleCounts: stats.roleCounts,
          keywordCounts: stats.keywordCounts,
          avgCmc: stats.avgCmc,
          totalPrice: stats.totalPrice,
          sideboardCards: stats.sideboardCards,
        },
        coinsRemaining: (await storage.getCredits(sessionId))?.coins ?? 0,
      });
    } catch (err: any) {
      console.error("Analysis error:", err);
      res.status(500).json({ error: "Analysis failed. Please try again." });
    }
  });

  // Meta cache stats (for debugging / transparency)
  app.get("/api/meta-status", async (_req, res) => {
    res.json(getMetaCacheStats());
  });

  // ── Ring Packs (pricing) ─────────────────────────────────────────
  const RING_PACKS = [
    { id: "pack-3", rings: 3, priceUsd: 1.99, priceSol: 0.014, label: "Scout's Pouch" },
    { id: "pack-10", rings: 10, priceUsd: 4.99, priceSol: 0.035, label: "Ranger's Satchel" },
    { id: "pack-30", rings: 30, priceUsd: 12.99, priceSol: 0.09, label: "War Chest" },
  ];

  app.get("/api/ring-packs", (_req, res) => {
    res.json(RING_PACKS);
  });

  // ── Solana payment confirmation ─────────────────────────────────
  app.post("/api/payments/solana/confirm", async (req, res) => {
    try {
      const { packId, txSignature } = req.body;
      const sessionId = req.headers["x-session-id"] as string;
      const userId = (req as any).userId as string | undefined;

      if (!packId || !txSignature) {
        return res.status(400).json({ error: "Pack ID and transaction signature required" });
      }

      const pack = RING_PACKS.find((p) => p.id === packId);
      if (!pack) return res.status(400).json({ error: "Invalid pack" });

      // Record the transaction
      const tx = await storage.createTransaction({
        sessionId,
        userId: userId ?? null,
        method: "solana",
        amount: pack.rings,
        pricePaid: `${pack.priceSol} SOL`,
        txSignature,
        status: "confirmed",
        createdAt: new Date().toISOString(),
      });

      // Credit the rings
      const credit = await storage.addCoins(sessionId, pack.rings);

      res.json({ success: true, transaction: tx, coins: credit?.coins ?? 0 });
    } catch (err: any) {
      console.error("Solana confirm error:", err);
      res.status(500).json({ error: "Failed to confirm payment" });
    }
  });

  // ── Stripe payment confirmation ─────────────────────────────────
  app.post("/api/payments/stripe/confirm", async (req, res) => {
    try {
      const { packId, sessionIdOrRef } = req.body;
      const sessionId = req.headers["x-session-id"] as string;
      const userId = (req as any).userId as string | undefined;

      if (!packId || !sessionIdOrRef) {
        return res.status(400).json({ error: "Pack ID and payment reference required" });
      }

      const pack = RING_PACKS.find((p) => p.id === packId);
      if (!pack) return res.status(400).json({ error: "Invalid pack" });

      // Record the transaction
      const tx = await storage.createTransaction({
        sessionId,
        userId: userId ?? null,
        method: "stripe",
        amount: pack.rings,
        pricePaid: `$${pack.priceUsd}`,
        txSignature: sessionIdOrRef,
        status: "confirmed",
        createdAt: new Date().toISOString(),
      });

      // Credit the rings
      const credit = await storage.addCoins(sessionId, pack.rings);

      res.json({ success: true, transaction: tx, coins: credit?.coins ?? 0 });
    } catch (err: any) {
      console.error("Stripe confirm error:", err);
      res.status(500).json({ error: "Failed to confirm payment" });
    }
  });

  // ── Transaction history ─────────────────────────────────────────
  app.get("/api/transactions", async (req, res) => {
    const sessionId = req.headers["x-session-id"] as string;
    const txs = await storage.getTransactionsBySession(sessionId);
    res.json(txs);
  });

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

  // ── Admin API endpoints (for Command Station) ──────────────────
  const ADMIN_SECRET = process.env.ADMIN_SECRET || "mellon";

  // CORS for admin endpoints (command station is on a different domain)
  app.use("/api/admin", (req, res, next) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-admin-secret");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
    if (req.method === "OPTIONS") return res.sendStatus(200);
    next();
  });

  function requireAdmin(req: any, res: any, next: any) {
    const secret = req.headers["x-admin-secret"];
    if (secret !== ADMIN_SECRET) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    next();
  }

  // Admin: Get all users
  app.get("/api/admin/users", requireAdmin, async (_req, res) => {
    const allUsers = db.select().from(usersTable).all();
    res.json(allUsers);
  });

  // Admin: Get all analyses
  app.get("/api/admin/analyses", requireAdmin, async (_req, res) => {
    const allAnalyses = db.select().from(analysesTable).orderBy(desc(analysesTable.id)).all();
    res.json(allAnalyses);
  });

  // Admin: Get all transactions
  app.get("/api/admin/transactions", requireAdmin, async (_req, res) => {
    const allTx = db.select().from(transactionsTable).orderBy(desc(transactionsTable.id)).all();
    res.json(allTx);
  });

  // Admin: Get all credits
  app.get("/api/admin/credits", requireAdmin, async (_req, res) => {
    const allCredits = db.select().from(creditsTable).all();
    res.json(allCredits);
  });

  // Admin: Grant rings to a user by email
  app.post("/api/admin/grant-rings", requireAdmin, async (req, res) => {
    try {
      const { email, amount } = req.body;
      if (!email || typeof email !== "string" || !email.includes("@")) {
        return res.status(400).json({ error: "Valid email required" });
      }
      if (!amount || typeof amount !== "number" || amount <= 0 || amount > 1000) {
        return res.status(400).json({ error: "Amount must be between 1 and 1000" });
      }
      const result = await storage.grantRingsByEmail(email, amount);
      if (!result.success) {
        return res.status(400).json({ error: result.error });
      }
      res.json({ success: true, email, amount, newBalance: result.newBalance });
    } catch (err: any) {
      console.error("Grant rings error:", err);
      res.status(500).json({ error: "Failed to grant rings" });
    }
  });

  // Admin: Create promo code
  app.post("/api/admin/promo-codes", requireAdmin, async (req, res) => {
    try {
      const { code, rings, maxUses, expiresAt } = req.body;
      if (!code || typeof code !== "string" || code.length < 3) {
        return res.status(400).json({ error: "Code must be at least 3 characters" });
      }
      if (!rings || typeof rings !== "number" || rings <= 0 || rings > 1000) {
        return res.status(400).json({ error: "Rings must be between 1 and 1000" });
      }
      const max = maxUses && typeof maxUses === "number" ? maxUses : 1;
      const promo = await storage.createPromoCode(code, rings, max, expiresAt);
      res.json(promo);
    } catch (err: any) {
      if (err.message?.includes("UNIQUE")) {
        return res.status(400).json({ error: "A code with this name already exists" });
      }
      console.error("Create promo code error:", err);
      res.status(500).json({ error: "Failed to create promo code" });
    }
  });

  // Admin: List all promo codes
  app.get("/api/admin/promo-codes", requireAdmin, async (_req, res) => {
    const codes = await storage.getAllPromoCodes();
    res.json(codes);
  });

  // Admin: Delete promo code
  app.delete("/api/admin/promo-codes/:id", requireAdmin, async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid ID" });
    await storage.deletePromoCode(id);
    res.json({ success: true });
  });

  // ── Public: Redeem promo code (used from the main site) ───────────
  app.post("/api/promo/redeem", async (req, res) => {
    try {
      const { code } = req.body;
      if (!code || typeof code !== "string") {
        return res.status(400).json({ error: "Promo code required" });
      }
      const sessionId = req.headers["x-session-id"] as string;
      const userId = (req as any).userId as string | undefined;
      const result = await storage.redeemPromoCode(code, sessionId, userId);
      if (!result.success) {
        return res.status(400).json({ error: result.error });
      }
      const credit = await storage.getCredits(sessionId);
      res.json({ success: true, ringsGranted: result.rings, newBalance: credit?.coins ?? 0 });
    } catch (err: any) {
      console.error("Redeem promo error:", err);
      res.status(500).json({ error: "Failed to redeem code" });
    }
  });

  // Admin: Dashboard stats
  app.get("/api/admin/stats", requireAdmin, async (_req, res) => {
    const totalUsers = db.select().from(usersTable).all().length;
    const totalAnalyses = db.select().from(analysesTable).all().length;
    const totalTransactions = db.select().from(transactionsTable).all().length;
    const allCredits = db.select().from(creditsTable).all();
    const totalRingsInCirculation = allCredits.reduce((sum, c) => sum + c.coins, 0);

    // Revenue calculation
    const confirmedTx = db.select().from(transactionsTable).all()
      .filter(t => t.status === "confirmed");
    const totalRevenue = confirmedTx.reduce((sum, t) => {
      const price = parseFloat(t.pricePaid.replace(/[^0-9.]/g, "")) || 0;
      return sum + price;
    }, 0);

    res.json({
      totalUsers,
      totalAnalyses,
      totalTransactions,
      totalRingsInCirculation,
      totalRevenue: totalRevenue.toFixed(2),
      confirmedTransactions: confirmedTx.length,
    });
  });

  return httpServer;
}
