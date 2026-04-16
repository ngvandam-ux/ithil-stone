import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage, db } from "./storage";
import { deckSubmitSchema, users as usersTable, analyses as analysesTable, transactions as transactionsTable, credits as creditsTable, newsletters as newslettersTable, pageVisits as pageVisitsTable, subscribers as subscribersTable } from "@shared/schema";
import { desc, eq } from "drizzle-orm";
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
// ── IP-based rate limiting for abuse prevention ─────────────────────
const ipAnalysisTracker = new Map<string, { count: number; firstSeen: number; flagged: boolean }>();
const IP_WINDOW_MS = 60 * 60 * 1000; // 1 hour window
const IP_MAX_ANALYSES = 10; // max analyses per IP per hour (generous for legit use)
const IP_FLAG_THRESHOLD = 15; // flag IP as suspicious at this count

function getClientIp(req: any): string {
  const forwarded = req.headers["x-forwarded-for"];
  if (forwarded) {
    const first = (typeof forwarded === "string" ? forwarded : forwarded[0]).split(",")[0].trim();
    return first;
  }
  return req.headers["x-real-ip"] as string || req.ip || req.connection?.remoteAddress || "unknown";
}

function checkIpRateLimit(ip: string): { allowed: boolean; flagged: boolean; count: number } {
  if (ip === "unknown" || ip === "127.0.0.1" || ip === "::1") {
    return { allowed: true, flagged: false, count: 0 };
  }
  const now = Date.now();
  let tracker = ipAnalysisTracker.get(ip);
  if (!tracker || (now - tracker.firstSeen) > IP_WINDOW_MS) {
    tracker = { count: 0, firstSeen: now, flagged: false };
    ipAnalysisTracker.set(ip, tracker);
  }
  tracker.count++;
  if (tracker.count >= IP_FLAG_THRESHOLD) {
    tracker.flagged = true;
    console.warn(`[abuse-prevention] ⚠️ IP ${ip} FLAGGED: ${tracker.count} analyses in current window`);
  }
  return {
    allowed: tracker.count <= IP_MAX_ANALYSES,
    flagged: tracker.flagged,
    count: tracker.count,
  };
}

// Clean up old IP tracker entries every 30 minutes
setInterval(() => {
  const now = Date.now();
  for (const [ip, data] of ipAnalysisTracker.entries()) {
    if (now - data.firstSeen > IP_WINDOW_MS * 2) {
      ipAnalysisTracker.delete(ip);
    }
  }
}, 30 * 60 * 1000);

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  // Trust proxy (Railway runs behind a reverse proxy)
  app.set("trust proxy", true);
  // ── Version check endpoint ──────────────────────────────────────
  app.get("/api/version", (_req, res) => {
    res.json({ version: "abuse-prevention-v1", deployed: new Date().toISOString() });
  });

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
        // Pick a random artwork for the email
        const emailArt = [
          { img: "tolkien-palantir.jpg", quote: "The palant\u00EDri are not all accounted for. We do not know who else may be watching.", attr: "Gandalf" },
          { img: "tolkien-gandalf-counsel.jpg", quote: "He that breaks a thing to find out what it is has left the path of wisdom.", attr: "Gandalf" },
          { img: "tolkien-star-hope.jpg", quote: "There, peeping among the cloud-wrack, Sam saw a white star twinkle for a while.", attr: "The Return of the King" },
          { img: "tolkien-sword-reforged.jpg", quote: "Renewed shall be blade that was broken, the crownless again shall be king.", attr: "The Riddle of Strider" },
          { img: "tolkien-fellowship-road.jpg", quote: "Faithless is he that says farewell when the road darkens.", attr: "Gimli" },
        ];
        const chosen = emailArt[Math.floor(Math.random() * emailArt.length)];
        const artUrl = `${APP_URL}/art/${chosen.img}`;

        await resend.emails.send({
          from: "Ithil-stone <noreply@ithilstone.gg>",
          to: normalizedEmail,
          subject: "Your key to the seeing-stone",
          html: `
            <div style="font-family: Georgia, 'Times New Roman', serif; max-width: 480px; margin: 0 auto; background: #0a0f0a; color: #c8cfc8; border-radius: 12px; overflow: hidden;">
              <div style="position: relative; height: 120px; overflow: hidden;">
                <img src="${artUrl}" alt="" style="width: 100%; height: 120px; object-fit: cover; opacity: 0.15; filter: brightness(1.2);" />
                <div style="position: absolute; inset: 0; background: linear-gradient(to bottom, rgba(10,15,10,0.3), rgba(10,15,10,0.95));"></div>
                <div style="position: absolute; bottom: 16px; left: 32px; right: 32px;">
                  <h1 style="color: #4ade80; font-size: 20px; margin: 0; font-variant: small-caps; letter-spacing: 1px;">Ithil-stone</h1>
                  <p style="color: #8a9a8a; font-size: 13px; margin: 4px 0 0 0;">AI-Powered MTG Deck Analysis</p>
                </div>
              </div>
              <div style="padding: 24px 32px 32px;">
                <p style="font-size: 15px; line-height: 1.6; margin-top: 0;">A request has been made to access the seeing-stone. Click below to enter:</p>
                <a href="${magicUrl}" style="display: inline-block; margin: 24px 0; padding: 14px 32px; background: #166534; color: #fff; text-decoration: none; border-radius: 8px; font-size: 15px; font-weight: 600; letter-spacing: 0.5px;">Enter the Stone</a>
                <p style="font-size: 13px; color: #5a6a5a; margin-top: 24px;">This link expires in ${MAGIC_LINK_EXPIRY_MINUTES} minutes. If you did not request this, you may safely ignore it.</p>
                <div style="margin-top: 28px; padding-top: 16px; border-top: 1px solid rgba(74,222,128,0.1);">
                  <p style="font-size: 12px; color: #3a4a3a; font-style: italic; margin: 0;">"${chosen.quote}"</p>
                  <p style="font-size: 11px; color: #2a3a2a; margin: 4px 0 0 0;">\u2014 ${chosen.attr}</p>
                </div>
              </div>
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
      const isNewUser = !user;
      if (!user) {
        user = await storage.createUser(randomUUID(), link.email);
      }

      // Auto-subscribe new users to the newsletter
      if (isNewUser) {
        try {
          const existing = await storage.getSubscriberByEmail(link.email);
          if (!existing) {
            await storage.addSubscriber(link.email, "signup");
          }
        } catch (e) {
          // Non-critical — don't block auth if subscribe fails
          console.error("Auto-subscribe failed:", e);
        }
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
    const ip = getClientIp(req);
    const credit = await storage.initCredits(sessionId, userId, ip);
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
      const ip = getClientIp(req);

      // IP rate limiting — flag/block suspicious compute abuse
      const rateCheck = checkIpRateLimit(ip);
      if (!rateCheck.allowed) {
        console.warn(`[ABUSE] IP ${ip} blocked — ${rateCheck.count} analyses in window`);
        return res.status(429).json({
          error: "The Palantír grows dark… too many visions sought. Try again later.",
        });
      }
      if (rateCheck.flagged) {
        console.warn(`[FLAGGED] IP ${ip} suspicious activity — ${rateCheck.count} analyses in window`);
      }

      // Check credits
      const credit = await storage.initCredits(sessionId, userId, ip);
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
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
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
    const allUsers = await db.select().from(usersTable);
    res.json(allUsers);
  });

  // Admin: Get all analyses
  app.get("/api/admin/analyses", requireAdmin, async (_req, res) => {
    const allAnalyses = await db.select().from(analysesTable).orderBy(desc(analysesTable.id));
    res.json(allAnalyses);
  });

  // Admin: Get all transactions
  app.get("/api/admin/transactions", requireAdmin, async (_req, res) => {
    const allTx = await db.select().from(transactionsTable).orderBy(desc(transactionsTable.id));
    res.json(allTx);
  });

  // Admin: Get all credits
  app.get("/api/admin/credits", requireAdmin, async (_req, res) => {
    const allCredits = await db.select().from(creditsTable);
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

  // ── Public: Newsletter subscribe / unsubscribe ──────────────────
  app.post("/api/subscribe", async (req, res) => {
    try {
      const { email, source } = req.body;
      if (!email || typeof email !== "string" || !email.includes("@")) {
        return res.status(400).json({ error: "Valid email is required" });
      }
      const subscriber = await storage.addSubscriber(email.toLowerCase().trim(), source || "website");
      res.json({ success: true, status: subscriber.status });
    } catch (err: any) {
      console.error("Subscribe error:", err);
      res.status(500).json({ error: "Failed to subscribe" });
    }
  });

  app.post("/api/unsubscribe", async (req, res) => {
    try {
      const { email } = req.body;
      if (!email || typeof email !== "string") {
        return res.status(400).json({ error: "Email is required" });
      }
      await storage.removeSubscriber(email.toLowerCase().trim());
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: "Failed to unsubscribe" });
    }
  });

  // GET /api/unsubscribe?email=... (for one-click unsubscribe from email links)
  app.get("/api/unsubscribe", async (req, res) => {
    try {
      const email = req.query.email as string;
      if (email) {
        await storage.removeSubscriber(email.toLowerCase().trim());
      }
      res.send(`<html><body style="font-family:Georgia,serif;text-align:center;padding:60px;background:#0a0f0a;color:#c8cfc8;">
        <h2 style="color:#4ade80;">Unsubscribed</h2>
        <p>You have been removed from the Ithil-stone dispatches.</p>
        <p style="color:#4a5a4a;font-size:14px;margin-top:20px;"><em>"The road goes ever on and on..."</em></p>
        <a href="https://ithilstone.gg" style="color:#4ade80;">Return to Ithil-stone</a>
      </body></html>`);
    } catch {
      res.status(500).send("Error processing unsubscribe");
    }
  });

  // ── Public: Newsletter archive (sent newsletters only) ────────────
  app.get("/api/newsletters", async (_req, res) => {
    try {
      const all = await storage.getNewsletters();
      // Only return sent newsletters, strip heavy HTML for list view
      const sent = all
        .filter((n) => n.status === "sent")
        .map((n) => ({
          id: n.id,
          type: n.type,
          subject: n.subject,
          sentAt: n.sentAt,
          createdAt: n.createdAt,
        }));
      res.json(sent);
    } catch (err: any) {
      res.status(500).json({ error: "Failed to fetch newsletters" });
    }
  });

  app.get("/api/newsletters/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) return res.status(400).json({ error: "Invalid ID" });
      const newsletter = await storage.getNewsletter(id);
      if (!newsletter || newsletter.status !== "sent") {
        return res.status(404).json({ error: "Newsletter not found" });
      }
      res.json({
        id: newsletter.id,
        type: newsletter.type,
        subject: newsletter.subject,
        htmlContent: newsletter.htmlContent,
        sentAt: newsletter.sentAt,
        createdAt: newsletter.createdAt,
      });
    } catch (err: any) {
      res.status(500).json({ error: "Failed to fetch newsletter" });
    }
  });

  // Admin: Dashboard stats
  app.get("/api/admin/stats", requireAdmin, async (_req, res) => {
    const allUsersArr = await db.select().from(usersTable);
    const totalUsers = allUsersArr.length;
    const allAnalysesArr = await db.select().from(analysesTable);
    const totalAnalyses = allAnalysesArr.length;
    const allTxArr = await db.select().from(transactionsTable);
    const totalTransactions = allTxArr.length;
    const allCredits = await db.select().from(creditsTable);
    const totalRingsInCirculation = allCredits.reduce((sum, c) => sum + c.coins, 0);

    // Revenue calculation
    const confirmedTx = allTxArr
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

  // ── Stripe Webhook (auto-verify payments) ────────────────────────
  // Stripe sends checkout.session.completed when payment succeeds
  // For Payment Links, we match by amount to determine which pack was purchased
  const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || "";

  app.post("/api/webhooks/stripe", async (req, res) => {
    try {
      // For now, log the event. Full signature verification requires the stripe SDK.
      // This endpoint is called by Stripe with the checkout session data.
      const event = req.body;
      console.log("[stripe-webhook] Received event:", event.type);

      if (event.type === "checkout.session.completed") {
        const session = event.data?.object;
        const amountTotal = session?.amount_total; // in cents
        const customerEmail = session?.customer_details?.email?.toLowerCase()?.trim();
        const paymentIntent = session?.payment_intent;

        if (!customerEmail || !amountTotal) {
          console.log("[stripe-webhook] Missing email or amount, skipping");
          return res.json({ received: true });
        }

        // Match amount to pack
        let pack = null;
        if (amountTotal === 199) pack = RING_PACKS.find(p => p.id === "pack-3");
        else if (amountTotal === 499) pack = RING_PACKS.find(p => p.id === "pack-10");
        else if (amountTotal === 1299) pack = RING_PACKS.find(p => p.id === "pack-30");

        if (!pack) {
          console.log(`[stripe-webhook] Unknown amount: ${amountTotal} cents`);
          return res.json({ received: true });
        }

        // Check for duplicate processing
        const [existingTx] = await db.select().from(transactionsTable)
          .where(eq(transactionsTable.txSignature, paymentIntent || `stripe_wh_${session.id}`));
        if (existingTx) {
          console.log(`[stripe-webhook] Already processed: ${paymentIntent}`);
          return res.json({ received: true });
        }

        // Find user by email
        const user = await storage.getUserByEmail(customerEmail);
        if (user) {
          // Get user's credit record
          const credit = await storage.getCreditsByUser(user.id);
          if (credit) {
            // Credit rings directly
            await storage.addCoins(credit.sessionId, pack.rings);
            // Record transaction
            await storage.createTransaction({
              sessionId: credit.sessionId,
              userId: user.id,
              method: "stripe",
              amount: pack.rings,
              pricePaid: `$${pack.priceUsd}`,
              txSignature: paymentIntent || `stripe_wh_${session.id}`,
              status: "confirmed",
              createdAt: new Date().toISOString(),
            });
            console.log(`[stripe-webhook] Credited ${pack.rings} rings to ${customerEmail}`);

            // Send purchase receipt email
            if (resend) {
              try {
                await resend.emails.send({
                  from: "Ithil-stone <noreply@ithilstone.gg>",
                  to: customerEmail,
                  subject: `Your ${pack.label} has been forged`,
                  html: `
                    <div style="font-family: Georgia, 'Times New Roman', serif; max-width: 480px; margin: 0 auto; background: #0a0f0a; color: #c8cfc8; border-radius: 12px; overflow: hidden;">
                      <div style="padding: 32px;">
                        <h1 style="color: #4ade80; font-size: 20px; margin: 0 0 8px; font-variant: small-caps; letter-spacing: 1px;">The Forge Rings True</h1>
                        <p style="color: #8a9a8a; font-size: 13px; margin: 0 0 24px;">Your Mithril Rings have been delivered.</p>
                        <div style="background: rgba(74,222,128,0.08); border-radius: 8px; padding: 16px; margin-bottom: 24px;">
                          <div style="text-align: center;">
                            <div style="font-size: 28px; font-weight: bold; color: #4ade80; margin-bottom: 4px;">${pack.rings}</div>
                            <div style="font-size: 13px; color: #8a9a8a;">Mithril Rings</div>
                            <div style="font-size: 12px; color: #5a6a5a; margin-top: 8px;">${pack.label} · $${pack.priceUsd} USD</div>
                          </div>
                        </div>
                        <p style="font-size: 14px; line-height: 1.6;">Each ring grants one audience with the seeing-stone. Use them wisely, for not all counsel is freely given.</p>
                        <a href="${APP_URL}" style="display: inline-block; margin: 20px 0; padding: 12px 28px; background: #166534; color: #fff; text-decoration: none; border-radius: 8px; font-size: 14px; font-weight: 600;">Consult the Stone</a>
                        <div style="margin-top: 24px; padding-top: 16px; border-top: 1px solid rgba(74,222,128,0.1);">
                          <p style="font-size: 11px; color: #3a4a3a; font-style: italic; margin: 0;">"Deep in the halls of Khazad-dûm, Mithril Rings are forged."</p>
                        </div>
                      </div>
                    </div>
                  `,
                });
              } catch (emailErr: any) {
                console.warn("[stripe-webhook] Failed to send receipt email:", emailErr.message);
              }
            }
          } else {
            console.log(`[stripe-webhook] User ${customerEmail} has no credit record yet`);
          }
        } else {
          console.log(`[stripe-webhook] No user found for ${customerEmail}, storing pending`);
          // Store as pending transaction — will be credited when user signs up
          await storage.createTransaction({
            sessionId: `pending_${customerEmail}`,
            userId: null,
            method: "stripe",
            amount: pack.rings,
            pricePaid: `$${pack.priceUsd}`,
            txSignature: paymentIntent || `stripe_wh_${session.id}`,
            status: "pending_signup",
            createdAt: new Date().toISOString(),
          });
        }
      }

      res.json({ received: true });
    } catch (err: any) {
      console.error("[stripe-webhook] Error:", err);
      res.status(500).json({ error: "Webhook processing failed" });
    }
  });

  // ── Analytics endpoint ───────────────────────────────────────────
  app.get("/api/admin/analytics", requireAdmin, async (_req, res) => {
    try {
      const allAnalyses = await db.select().from(analysesTable);
      const allTx = await db.select().from(transactionsTable);
      const allUsers = await db.select().from(usersTable);
      const allCredits = await db.select().from(creditsTable);

      // Format distribution
      const formatCounts: Record<string, number> = {};
      for (const a of allAnalyses) {
        formatCounts[a.format] = (formatCounts[a.format] || 0) + 1;
      }

      // Daily analysis counts (last 30 days)
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
      const recentAnalyses = allAnalyses.filter(a => a.createdAt > thirtyDaysAgo);
      const dailyAnalyses: Record<string, number> = {};
      for (const a of recentAnalyses) {
        const day = a.createdAt.split("T")[0];
        dailyAnalyses[day] = (dailyAnalyses[day] || 0) + 1;
      }

      // Revenue by day (last 30 days)
      const recentTx = allTx.filter(t => t.createdAt > thirtyDaysAgo && t.status === "confirmed");
      const dailyRevenue: Record<string, number> = {};
      for (const t of recentTx) {
        const day = t.createdAt.split("T")[0];
        const price = parseFloat(t.pricePaid.replace(/[^0-9.]/g, "")) || 0;
        dailyRevenue[day] = (dailyRevenue[day] || 0) + price;
      }

      // Conversion funnel
      const totalVisitors = allCredits.length; // everyone who got credits initialized
      const totalAnalyzed = new Set(allAnalyses.map(a => a.userId || a.sessionId)).size;
      const totalPaid = new Set(allTx.filter(t => t.status === "confirmed").map(t => t.userId || t.sessionId)).size;
      const totalSignedUp = allUsers.length;

      // Pack popularity
      const packCounts: Record<string, { count: number; revenue: number }> = {};
      for (const t of allTx.filter(tx => tx.status === "confirmed")) {
        const price = parseFloat(t.pricePaid.replace(/[^0-9.]/g, "")) || 0;
        const packKey = `${t.amount} rings`;
        if (!packCounts[packKey]) packCounts[packKey] = { count: 0, revenue: 0 };
        packCounts[packKey].count++;
        packCounts[packKey].revenue += price;
      }

      // Average analyses per user
      const userAnalysisCounts = new Map<string, number>();
      for (const a of allAnalyses) {
        const key = a.userId || a.sessionId;
        userAnalysisCounts.set(key, (userAnalysisCounts.get(key) || 0) + 1);
      }
      const avgAnalysesPerUser = userAnalysisCounts.size > 0
        ? (allAnalyses.length / userAnalysisCounts.size).toFixed(1)
        : "0";

      res.json({
        funnel: {
          visitors: totalVisitors,
          analyzed: totalAnalyzed,
          signedUp: totalSignedUp,
          paid: totalPaid,
          conversionRate: totalVisitors > 0 ? `${((totalPaid / totalVisitors) * 100).toFixed(1)}%` : "0%",
        },
        formatDistribution: formatCounts,
        dailyAnalyses,
        dailyRevenue,
        packPopularity: packCounts,
        avgAnalysesPerUser,
        totalAnalyses: allAnalyses.length,
        totalRevenue: allTx
          .filter(t => t.status === "confirmed")
          .reduce((s, t) => s + (parseFloat(t.pricePaid.replace(/[^0-9.]/g, "")) || 0), 0)
          .toFixed(2),
      });
    } catch (err: any) {
      console.error("Analytics error:", err);
      res.status(500).json({ error: "Failed to generate analytics" });
    }
  });

  // ── Newsletter Engine ────────────────────────────────────────────────

  const BASIC_LANDS = new Set([
    "plains", "island", "swamp", "mountain", "forest", "wastes",
    "snow-covered plains", "snow-covered island", "snow-covered swamp",
    "snow-covered mountain", "snow-covered forest",
  ]);

  const TOLKIEN_ART = [
    "fingolfin-morgoth", "rohirrim-charge", "gandalf-counsel", "palantir",
    "mordor-fortress", "fellowship-road", "duel-of-songs", "star-hope",
    "feanor-oath", "sword-reforged",
  ];

  async function fetchScryfallCard(cardName: string): Promise<{ name: string; artCrop: string } | null> {
    if (BASIC_LANDS.has(cardName.toLowerCase())) return null;
    try {
      const res = await fetch(
        `https://api.scryfall.com/cards/named?exact=${encodeURIComponent(cardName.trim())}`
      );
      if (!res.ok) return null;
      const data = await res.json();
      // Use full card image (normal) so readers see mana cost, description, etc.
      const cardImg = data.image_uris?.normal || data.card_faces?.[0]?.image_uris?.normal
        || data.image_uris?.art_crop || data.card_faces?.[0]?.image_uris?.art_crop;
      if (!cardImg) return null;
      return { name: data.name, artCrop: cardImg };
    } catch {
      return null;
    }
  }

  function buildNewsletterHtml(
    markdownContent: string,
    cardImageMap: Record<string, string>,
    type: "daily" | "weekly"
  ): string {
    const title = type === "daily" ? "The Seeing-Stone" : "The Palantír Report";
    const heroArt = TOLKIEN_ART[Math.floor(Math.random() * TOLKIEN_ART.length)];
    const heroUrl = `${APP_URL}/art/tolkien-${heroArt}.jpg`;

    // Convert markdown-style formatting to HTML
    let html = markdownContent
      // Headers
      .replace(/^## (.+)$/gm, '<h2 style="color:#4ade80; font-variant:small-caps; letter-spacing:1px; font-size:18px; margin:28px 0 12px; border-bottom:1px solid rgba(74,222,128,0.15); padding-bottom:6px;">$1</h2>')
      .replace(/^### (.+)$/gm, '<h3 style="color:#e2e8e2; font-size:15px; margin:20px 0 8px;">$1</h3>')
      // Bold text — preserve all **text** as <strong>, check card image map with cleaned name
      .replace(/\*\*(.+?)\*\*/g, (_, text) => {
        // Strip trailing punctuation for card image lookup, but preserve original text
        const cleanName = text.replace(/[:\.,;!?]+$/, '').trim();
        const imgUrl = cardImageMap[cleanName] || cardImageMap[text];
        if (imgUrl) {
          return `<strong style="color:#e2e8e2;">${text}</strong><br/><img src="${imgUrl}" alt="${cleanName}" width="200" style="border-radius:8px; border:1px solid rgba(74,222,128,0.3); margin:8px 0; display:block;" />`;
        }
        return `<strong style="color:#e2e8e2;">${text}</strong>`;
      })
      // Bullet points
      .replace(/^- (.+)$/gm, '<div style="padding-left:16px; margin:4px 0;"><span style="color:#4ade80; margin-right:6px;">•</span>$1</div>')
      // Line breaks
      .replace(/\n\n/g, '</p><p style="margin:12px 0; line-height:1.65;">')
      .replace(/\n/g, '<br/>');

    html = `<p style="margin:12px 0; line-height:1.65;">${html}</p>`;

    return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0; padding:0; background:#0a0f0a; font-family:Georgia,'Times New Roman',serif; color:#c8cfc8;">
<div style="max-width:600px; margin:0 auto; background:#0a0f0a;">
  <!-- Hero -->
  <div style="position:relative; text-align:center;">
    <img src="${heroUrl}" alt="${title}" width="600" style="width:100%; display:block; opacity:0.7;" />
    <div style="position:absolute; bottom:20px; left:0; right:0; text-align:center;">
      <h1 style="color:#4ade80; font-size:28px; font-variant:small-caps; letter-spacing:3px; margin:0; text-shadow:0 2px 12px rgba(0,0,0,0.8);">${title}</h1>
      <p style="color:#8a9a8a; font-size:12px; margin:4px 0 0; text-shadow:0 1px 6px rgba(0,0,0,0.8);">${type === "daily" ? "Daily MTG Intelligence" : "Weekly Strategic Briefing"} · ithilstone.gg</p>
    </div>
  </div>

  <!-- Body -->
  <div style="padding:24px 28px; font-size:15px; line-height:1.65;">
    ${html}
  </div>

  <!-- CTA -->
  <div style="text-align:center; padding:20px 28px 32px;">
    <a href="${APP_URL}" style="display:inline-block; padding:14px 32px; background:#166534; color:#fff; text-decoration:none; border-radius:8px; font-size:15px; font-weight:600; letter-spacing:0.5px;">Consult the Stone →</a>
  </div>

  <!-- Footer -->
  <div style="padding:20px 28px; border-top:1px solid rgba(74,222,128,0.1); text-align:center;">
    <p style="font-size:12px; color:#3a4a3a; margin:0;">The Seeing-Stone — <a href="${APP_URL}" style="color:#4ade80; text-decoration:none;">ithilstone.gg</a></p>
    <p style="font-size:11px; color:#2a3a2a; margin:8px 0 0;"><a href="{{unsubscribe_url}}" style="color:#2a3a2a; text-decoration:underline;">Unsubscribe</a></p>
  </div>
</div>
</body>
</html>`;
  }

  // POST /api/admin/newsletter/generate
  app.post("/api/admin/newsletter/generate", requireAdmin, async (req, res) => {
    try {
      const { type = "daily", customTopic, newsLinks, spotlightCard, spotlightNotes } = req.body as {
        type?: "daily" | "weekly";
        customTopic?: string;
        newsLinks?: string;
        spotlightCard?: string;
        spotlightNotes?: string;
      };
      console.log(`[newsletter/generate] type=${type}, customTopic=${!!customTopic}, newsLinks=${newsLinks ? newsLinks.length + ' chars' : 'none'}, spotlightCard=${!!spotlightCard}`);
      if (type !== "daily" && type !== "weekly") {
        return res.status(400).json({ error: 'Type must be "daily" or "weekly"' });
      }

      // ── 1. Gather MTG data from the web ────────────────────────────
      const mtgDataSources: any[] = [];
      const cardNames: string[] = [];

      // Fetch a few random recent notable cards from Scryfall
      for (let i = 0; i < 3; i++) {
        try {
          // Exclude Universes Beyond crossovers (TMNT, Marvel, etc.) — keep real Magic + LOTR
          const r = await fetch("https://api.scryfall.com/cards/random?q=is:firstprinting+date%3E2026-01-01+-is:universesbeyond+game:paper");
          if (r.ok) {
            const card = await r.json();
            mtgDataSources.push({ source: "scryfall_random", card: { name: card.name, type_line: card.type_line, mana_cost: card.mana_cost, oracle_text: card.oracle_text, set_name: card.set_name, rarity: card.rarity } });
            if (card.name && !BASIC_LANDS.has(card.name.toLowerCase())) {
              cardNames.push(card.name);
            }
          }
          // Rate limit: ~100ms between Scryfall calls
          await new Promise(r => setTimeout(r, 120));
        } catch { /* graceful degradation */ }
      }

      // Try recent cards search
      try {
        // Exclude Universes Beyond crossovers and digital-only Alchemy cards
        const r = await fetch("https://api.scryfall.com/cards/search?q=date%3E2026-03-01+is:firstprinting+-is:universesbeyond+-is:digital+game:paper&order=review&dir=desc");
        if (r.ok) {
          const data = await r.json();
          const topCards = (data.data || []).slice(0, 5);
          for (const card of topCards) {
            mtgDataSources.push({ source: "scryfall_recent", card: { name: card.name, type_line: card.type_line, mana_cost: card.mana_cost, oracle_text: card.oracle_text, set_name: card.set_name, rarity: card.rarity } });
            if (card.name && !BASIC_LANDS.has(card.name.toLowerCase())) {
              cardNames.push(card.name);
            }
          }
        }
      } catch { /* graceful degradation */ }

      // Try mtgtop8 for competitive data
      let mtgtop8Standard = "";
      let mtgtop8Modern = "";
      try {
        const r = await fetch("https://www.mtgtop8.com/topcards?f=ST&meession=15");
        if (r.ok) mtgtop8Standard = (await r.text()).slice(0, 3000);
      } catch { /* graceful degradation */ }
      try {
        const r = await fetch("https://www.mtgtop8.com/topcards?f=MO&meession=15");
        if (r.ok) mtgtop8Modern = (await r.text()).slice(0, 3000);
      } catch { /* graceful degradation */ }

      if (mtgtop8Standard) mtgDataSources.push({ source: "mtgtop8_standard", raw: mtgtop8Standard.slice(0, 1500) });
      if (mtgtop8Modern) mtgDataSources.push({ source: "mtgtop8_modern", raw: mtgtop8Modern.slice(0, 1500) });

      // Note StandardAtomicCards as a data source (too large to fetch)
      mtgDataSources.push({ source: "mtgjson_standard_atomic", note: "Referenced but not fetched (too large). Available at https://mtgjson.com/api/v5/StandardAtomicCards.json" });

      // ── 2. Gather platform analytics ───────────────────────────────
      const allAnalyses = await db.select().from(analysesTable);
      const allUsers = await db.select().from(usersTable);
      const allTransactions = await db.select().from(transactionsTable);

      const formatCounts: Record<string, number> = {};
      for (const a of allAnalyses) {
        formatCounts[a.format] = (formatCounts[a.format] || 0) + 1;
      }
      const topFormats = Object.entries(formatCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([f, c]) => `${f}: ${c}`);

      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
      const recentAnalyses = allAnalyses.filter(a => a.createdAt > sevenDaysAgo);
      const recentTx = allTransactions.filter(t => t.createdAt > sevenDaysAgo);

      const platformStats = {
        totalAnalyses: allAnalyses.length,
        totalUsers: allUsers.length,
        analysesThisWeek: recentAnalyses.length,
        transactionsThisWeek: recentTx.length,
        topFormats,
        mostPopularFormat: topFormats[0] || "unknown",
      };

      // ── 3. Fetch card images ───────────────────────────────────────
      const uniqueCardNames = [...new Set(cardNames)];
      const cardImageMap: Record<string, string> = {};
      for (let i = 0; i < Math.min(uniqueCardNames.length, 8); i++) {
        const result = await fetchScryfallCard(uniqueCardNames[i]);
        if (result) {
          cardImageMap[result.name] = result.artCrop;
        }
        // Rate limit Scryfall
        await new Promise(r => setTimeout(r, 120));
      }

      // ── 3b. Fetch spotlight card image if provided ───────────────
      let spotlightCardData: any = null;
      if (spotlightCard) {
        try {
          const result = await fetchScryfallCard(spotlightCard);
          if (result) {
            cardImageMap[result.name] = result.artCrop;
            spotlightCardData = result;
          }
        } catch { /* graceful */ }
      }

      // ── 3c. Fetch news link content if provided ───────────────────
      let fetchedNewsContent: string[] = [];
      if (newsLinks) {
        const urls = newsLinks.match(/https?:\/\/[^\s]+/g) || [];
        for (const url of urls.slice(0, 5)) {
          try {
            const r = await fetch(url, { headers: { "User-Agent": "Ithil-stone/1.0" } });
            if (r.ok) {
              const text = await r.text();
              // Extract text content, strip HTML
              const cleaned = text.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "").replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
              fetchedNewsContent.push(`[FROM: ${url}]\n${cleaned.slice(0, 2000)}`);
            }
          } catch { /* graceful */ }
        }
      }

      // ── 4. Call Claude to write the newsletter ─────────────────────
      const anthropicClient = new Anthropic();

      // Load editable prompts from DB (fall back to defaults)
      const voiceKey = "prompt_voice";
      const dailyStructKey = "prompt_daily_structure";
      const weeklyStructKey = "prompt_weekly_structure";

      const defaultVoice = `You are the voice of Ithil-stone, an AI-powered Magic: The Gathering deck analyzer at ithilstone.gg.

Your writing style is a crossover between Dave Barry and Terry Pratchett.

From Dave Barry, you take:
- Short, punchy paragraphs — rarely more than 3 sentences
- Absurd comparisons and hyperbole played completely straight ("This is roughly equivalent to invading Russia in winter, except stupider")
- Parenthetical asides that are funnier than the main sentence
- A conversational, columnist tone — like you're telling a story at a bar
- The phrase "I am not making this up" energy, even if you don't say it
- Mock-serious authority over things that do not matter

From Terry Pratchett, you take:
- Dry, understated wit — the joke lands three words after the reader expects it
- Footnotes* or bracketed asides that contain their own mini-jokes
- Affectionate mockery of fantasy tropes, archetypes, and the people who love them
- Players described like fantasy novel NPCs with absurd motivations
- The understanding that humans (and goblins) are fundamentally ridiculous and lovable

VOICE RULES:
- Never talk down to the reader. They're in on the joke.
- Explain MTG mechanics or meta only when it's funny to do so, and keep it brief.
- Treat each game recap like a dramatic historical event being retold by an unreliable narrator.
- Sprinkle in fake "wisdom" like it's flavor text on a card.
- Keep paragraphs short. White space is your friend.
- Aim for a reading level that a clever 8th grader would enjoy but a 40-year-old would laugh harder at.

YOUR PERSONALITY:
- You're a grizzled old-school tournament player who's been slinging cards since Revised in 1994. You LOVE classic Magic — Urza's block, Invasion, Onslaught, original Ravnica. The game was at its best when flavor and mechanics came from Magic's own world.
- Modern card design is pushed and overpowered. Too much value stapled onto cards for free. But you grudgingly respect the ones that earn it.
- Universes Beyond / crossover sets (TMNT, Marvel, Doctor Who, etc.) are NOT real Magic to you. They cheapen the game. If crossover cards come up, acknowledge them with mild disdain or a dry joke, then move on. Never make a crossover card the centerpiece unless specifically told to.
- The ONE crossover exception: Lord of the Rings. You respect the Tolkien connection because the Ithil-stone itself is LOTR-themed. That's different. That's culture.
- Layer in subtle LOTR references — you're the wise counselor at the seeing-stone. Don't overdo it, just flavor.

*Footnotes are encouraged but not required. When used, they should contain observations that the main text was too dignified to include.`;

      const defaultDailyStructure = `Write a daily newsletter. Under 1,000 words.

STRUCTURE:
## [A ridiculous headline]
- A brief "state of the gathering" intro (2–3 sentences, sets the scene like a nature documentary narrator discovering Magic players in their natural habitat)

## The Dispatches
- Game recaps and meta news written like war correspondence or nature documentaries
- Treat each result like a dramatic historical event retold by an unreliable narrator
- Bold card names. Explain mechanics only when it's funny to do so.
- Parenthetical asides are your secret weapon

## Card of the Day
- Spotlight one interesting card with an absurd hot take
- Bold the card name
- This should read like a Terry Pratchett footnote expanded into a paragraph

## From the Stone
- One-liner platform stat teaser linking back to ithilstone.gg
- A closing line that's either a fake proverb or a cliffhanger
- e.g. "As the old planeswalkers say: never keep a one-land hand and never trust a blue mage who smiles."`;

      const defaultWeeklyStructure = `Write a weekly newsletter called "The Palantír Report". 1,500-2,000 words.

STRUCTURE:
## [A ridiculous headline that sounds like a fantasy novel chapter title]
- A brief "state of the gathering" intro (2–3 sentences). Set the scene. You are an unreliable narrator chronicling the week in competitive cardboard.

## The Week's Campaigns
- Tournament recaps written like war correspondence from the front lines
- Bold deck names and key cards. Each result is a dramatic historical event.
- Parenthetical asides. Absurd comparisons played straight.
- "Dimir Excruciator won the Challenge, which is roughly equivalent to a librarian winning a bar fight — quiet, methodical, and deeply unsettling to witness."

## The Price of Power
- Cards moving in price or relevance. 3-4 max.
- Each gets an absurd hot take, not a market analysis.
- "Formidable Speaker went from bulk to $8, which in MTG finance terms is the equivalent of finding out your weird cousin is actually a duke."

## Card of the Week
- One card spotlight with a Terry Pratchett–style mini-essay
- Bold the card name. This is the section where you really let the prose breathe.
- Should read like flavor text that gained sentience and started a blog.

## Dispatches from the Stone
- Platform stats from ithilstone.gg woven into the narrative
- A closing fake proverb or cliffhanger
- "As the old planeswalkers say: the best sideboard card is the one your opponent forgot existed."

*Footnotes encouraged throughout. They should contain observations the main text was too dignified to include.`;

      const voice = (await storage.getSetting(voiceKey)) || defaultVoice;
      const structure = type === "daily"
        ? (await storage.getSetting(dailyStructKey)) || defaultDailyStructure
        : (await storage.getSetting(weeklyStructKey)) || defaultWeeklyStructure;

      const formatRules = `FORMAT RULES:
- Bold card names like **Lightning Bolt** (but never land cards like Plains, Island, etc.)
- Keep it conversational and opinionated
${type === "daily" ? "- Every section should make the reader think \"I should check my deck\"" : "- Deep analysis, not surface-level recaps"}
- End with a subtle CTA to ithilstone.gg`;

      // Build optional sections
      const extraSections: string[] = [];

      if (customTopic) {
        extraSections.push(`CUSTOM TOPIC FOCUS: ${customTopic}`);
      }

      if (spotlightCard) {
        let spotlightSection = `\nCARD SPOTLIGHT — FEATURED SECTION:\nThe admin wants you to write a dedicated spotlight section on the card "${spotlightCard}".`;
        if (spotlightNotes) {
          spotlightSection += ` Their take/angle: "${spotlightNotes}"`;
        }
        if (spotlightCardData) {
          spotlightSection += `\nCard data: ${JSON.stringify(spotlightCardData)}`;
        }
        spotlightSection += `\nWrite this as a ## Card Spotlight section with genuine opinionated analysis. Include the card name bolded.`;
        extraSections.push(spotlightSection);
      }

      if (newsLinks) {
        console.log(`[newsletter] newsLinks provided (${newsLinks.length} chars), injecting as PRIMARY source`);
        let newsSection = `\n⚠️ CRITICAL — PRIMARY NEWS SOURCE (MUST USE):\nThe admin has provided the following curated news/analysis as the PRIMARY content source for this newsletter. This content MUST be the foundation of what you write — reference specific tournaments, cards, prices, and meta shifts mentioned below. Do NOT ignore this in favor of the auto-fetched data. The auto-fetched Scryfall/mtgtop8 data below is supplementary; this admin-curated content is the real intelligence.\n\nADMIN-PROVIDED CONTENT:\n${newsLinks}`;
        if (fetchedNewsContent.length > 0) {
          newsSection += `\n\nFETCHED ARTICLE CONTENT (from URLs in the above):\n${fetchedNewsContent.join("\n\n")}`;
        }
        newsSection += `\n\nREMINDER: You MUST incorporate the above admin-provided content prominently. Mention specific decks, cards, results, and prices from it. If it conflicts with auto-fetched data, prefer the admin content.`;
        extraSections.push(newsSection);
      }

      // If admin provided news content, restructure prompt to prioritize it
      const hasAdminNews = !!newsLinks;
      let newsletterPrompt = `${voice}

${structure}

${extraSections.length > 0 ? extraSections.join("\n\n") + "\n\n" : ""}${formatRules}

Here is supplementary MTG data gathered automatically${hasAdminNews ? " (use as SECONDARY source — the admin-provided content above is PRIMARY)" : ""}:
${JSON.stringify(mtgDataSources, null, 2)}

Here are the platform stats:
${JSON.stringify(platformStats, null, 2)}

OUTPUT: Return ONLY the newsletter body content as clean text with markdown-style formatting (**bold** for cards, ## for section headers, - for bullets). Do NOT include HTML tags. I will convert to HTML later.${hasAdminNews ? " IMPORTANT: The newsletter MUST prominently feature the admin-provided news content — specific tournament results, card prices, meta shifts, and set news from it." : ""}`;

      const contentResponse = await anthropicClient.messages.create({
        model: "claude-opus-4-6",
        max_tokens: 4000,
        messages: [{ role: "user", content: newsletterPrompt }],
      });

      const contentBlock = contentResponse.content.find((b: any) => b.type === "text");
      const markdownContent = (contentBlock as any)?.text || "Newsletter generation failed — no content returned.";

      // ── 5. Convert to HTML ─────────────────────────────────────────
      const htmlContent = buildNewsletterHtml(markdownContent, cardImageMap, type);

      // ── 6. Generate social media versions ──────────────────────────
      let socialVersions: any = null;
      try {
        const socialPrompt = `Based on this newsletter content, generate condensed social media versions for each platform. Return a JSON object with keys: discord, bluesky, x, reddit.

VOICE (use this across ALL platforms):
You write like a crossover between Dave Barry and Terry Pratchett. Short punchy paragraphs. Absurd comparisons played completely straight. Parenthetical asides that are funnier than the main sentence. Dry wit that lands three words late. Mock-serious authority over competitive cardboard. You're an old-school tournament player since 1994 who loves classic Magic and finds modern card design pushed and overpowered. Universes Beyond crossovers (TMNT, Marvel, etc.) get mild disdain — LOTR is the one exception. Subtle LOTR references are welcome. Never talk down to the reader — they're in on the joke.

Platform rules:
- discord: embed-style message with the lead story + 2 bullet takes. Use markdown formatting. Voice should feel like a grizzled veteran posting in #mtg-general.
- bluesky: array of 3-4 posts, each under 300 characters. Lead with the spiciest hot take. Each post should make someone want to hit repost.
- x: array of 3-4 tweets, each under 280 characters. Thread format with 1/ 2/ 3/ numbering. Punchy, funny, opinionated. The kind of tweets that get quote-tweeted.
- reddit: long-form post for r/magicTCG. Genuine community voice (NOT marketing-speak). Include a title field. Should read like the funniest person in the comments section wrote a self-post. Footnotes welcome.

All posts should promote ithilstone.gg naturally — mention the palant\u00edr, the Stone, or the deck analyzer in a way that feels organic, not like an ad.

Newsletter content:
${markdownContent}

OUTPUT: Return ONLY valid JSON. No markdown wrapping, no explanation. Just the JSON object.`;

        const socialResponse = await anthropicClient.messages.create({
          model: "claude-opus-4-6",
          max_tokens: 3000,
          messages: [{ role: "user", content: socialPrompt }],
        });

        const socialBlock = socialResponse.content.find((b: any) => b.type === "text");
        const socialText = (socialBlock as any)?.text || "";
        // Try to parse JSON, stripping potential markdown fences
        const cleaned = socialText.replace(/^```json\n?/, "").replace(/\n?```$/, "").trim();
        socialVersions = JSON.parse(cleaned);
      } catch (err) {
        console.warn("Social media version generation failed:", err);
        socialVersions = { error: "Generation failed — edit manually" };
      }

      // ── 7. Derive subject line ─────────────────────────────────────
      const firstLine = markdownContent.split("\n").find((l: string) => l.trim().length > 10) || "";
      const subject = type === "daily"
        ? `The Seeing-Stone — ${firstLine.replace(/^#+\s*/, "").replace(/\*\*/g, "").slice(0, 80)}`
        : `The Palantír Report — ${firstLine.replace(/^#+\s*/, "").replace(/\*\*/g, "").slice(0, 80)}`;

      // ── 8. Save to database ────────────────────────────────────────
      const newsletter = await storage.createNewsletter({
        type,
        subject,
        htmlContent,
        socialVersions: JSON.stringify(socialVersions),
        mtgDataUsed: JSON.stringify(mtgDataSources),
        status: "draft",
        sentAt: null,
        recipientCount: null,
        createdAt: new Date().toISOString(),
      });

      res.json(newsletter);
    } catch (err: any) {
      console.error("Newsletter generation error:", err);
      res.status(500).json({ error: "Failed to generate newsletter: " + (err.message || "Unknown error") });
    }
  });

  // POST /api/admin/newsletter/send
  app.post("/api/admin/newsletter/send", requireAdmin, async (req, res) => {
    try {
      const { id } = req.body as { id: number };
      if (!id || typeof id !== "number") {
        return res.status(400).json({ error: "Newsletter id is required" });
      }

      const newsletter = await storage.getNewsletter(id);
      if (!newsletter) {
        return res.status(404).json({ error: "Newsletter not found" });
      }
      const isResend = newsletter.status === "sent";

      if (!resend) {
        return res.status(500).json({ error: "Resend email client not configured (missing RESEND_API_KEY)" });
      }

      // Get all active subscribers
      const activeSubs = await storage.getActiveSubscribers();
      const emails = activeSubs.map(s => s.email).filter(Boolean);

      if (emails.length === 0) {
        return res.status(400).json({ error: "No active subscribers found. Add subscribers first." });
      }

      // Send via Resend batch API (max 100 per batch)
      const batchSize = 100;
      let sentCount = 0;
      for (let i = 0; i < emails.length; i += batchSize) {
        const batch = emails.slice(i, i + batchSize);
        const emailPayloads = batch.map(recipientEmail => ({
          from: "Ithil-stone <noreply@ithilstone.gg>",
          to: [recipientEmail],
          subject: newsletter.subject,
          html: newsletter.htmlContent.replace(
            /{{unsubscribe_url}}/g,
            `https://ithilstone.gg/api/unsubscribe?email=${encodeURIComponent(recipientEmail)}`
          ),
        }));

        try {
          const { data, error } = await resend.batch.send(emailPayloads);
          if (error) {
            console.error(`Resend batch error (batch starting at ${i}):`, JSON.stringify(error));
          } else {
            sentCount += batch.length;
            console.log(`Batch sent successfully (${batch.length} emails):`, JSON.stringify(data));
          }
        } catch (batchErr: any) {
          console.error(`Batch send exception (batch starting at ${i}):`, batchErr?.message || batchErr);
          // Continue with remaining batches
        }
      }

      // Update newsletter status
      await storage.updateNewsletter(id, {
        status: "sent",
        sentAt: new Date().toISOString(),
        recipientCount: sentCount,
      } as any);

      res.json({ success: true, recipientCount: sentCount, totalUsers: emails.length, resent: isResend });
    } catch (err: any) {
      console.error("Newsletter send error:", err);
      res.status(500).json({ error: "Failed to send newsletter: " + (err.message || "Unknown error") });
    }
  });

  // GET /api/admin/newsletter/history
  app.get("/api/admin/newsletter/history", requireAdmin, async (_req, res) => {
    try {
      const newsletters = await storage.getNewsletters();
      res.json(newsletters);
    } catch (err: any) {
      console.error("Newsletter history error:", err);
      res.status(500).json({ error: "Failed to fetch newsletter history" });
    }
  });

  // DELETE /api/admin/newsletter/:id
  app.delete("/api/admin/newsletter/:id", requireAdmin, async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (isNaN(id)) return res.status(400).json({ error: "Invalid ID" });

      const newsletter = await storage.getNewsletter(id);
      if (!newsletter) {
        return res.status(404).json({ error: "Newsletter not found" });
      }

      await storage.deleteNewsletter(id);
      res.json({ success: true });
    } catch (err: any) {
      console.error("Newsletter delete error:", err);
      res.status(500).json({ error: "Failed to delete newsletter" });
    }
  });

  // PUT /api/admin/newsletter/:id
  app.put("/api/admin/newsletter/:id", requireAdmin, async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (isNaN(id)) return res.status(400).json({ error: "Invalid ID" });

      const newsletter = await storage.getNewsletter(id);
      if (!newsletter) {
        return res.status(404).json({ error: "Newsletter not found" });
      }
      if (newsletter.status === "sent") {
        return res.status(400).json({ error: "Cannot edit a sent newsletter" });
      }

      const { htmlContent, socialVersions, subject } = req.body;
      const updates: any = {};
      if (htmlContent !== undefined) updates.htmlContent = htmlContent;
      if (socialVersions !== undefined) {
        updates.socialVersions = typeof socialVersions === "string" ? socialVersions : JSON.stringify(socialVersions);
      }
      if (subject !== undefined) updates.subject = subject;

      if (Object.keys(updates).length === 0) {
        return res.status(400).json({ error: "No valid fields to update" });
      }

      const updated = await storage.updateNewsletter(id, updates);
      res.json(updated);
    } catch (err: any) {
      console.error("Newsletter update error:", err);
      res.status(500).json({ error: "Failed to update newsletter" });
    }
  });

  // ── Admin: Subscriber management ───────────────────────────
  app.get("/api/admin/subscribers", requireAdmin, async (_req, res) => {
    try {
      const subs = await storage.getAllSubscribers();
      res.json(subs);
    } catch (err: any) {
      res.status(500).json({ error: "Failed to fetch subscribers" });
    }
  });

  app.post("/api/admin/subscribers", requireAdmin, async (req, res) => {
    try {
      const { email, source } = req.body;
      if (!email || !email.includes("@")) return res.status(400).json({ error: "Valid email required" });
      const sub = await storage.addSubscriber(email.toLowerCase().trim(), source || "admin");
      res.json(sub);
    } catch (err: any) {
      res.status(500).json({ error: "Failed to add subscriber" });
    }
  });

  app.delete("/api/admin/subscribers/:email", requireAdmin, async (req, res) => {
    try {
      await storage.removeSubscriber(decodeURIComponent(req.params.email));
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: "Failed to remove subscriber" });
    }
  });

  // ── Newsletter Tasks (queue from Perplexity or anywhere) ─────────

  app.get("/api/admin/newsletter/tasks", requireAdmin, async (req, res) => {
    try {
      const status = req.query.status as string | undefined;
      const tasks = await storage.getNewsletterTasks(status);
      res.json(tasks);
    } catch (err: any) {
      res.status(500).json({ error: "Failed to fetch tasks" });
    }
  });

  app.post("/api/admin/newsletter/tasks", requireAdmin, async (req, res) => {
    try {
      const { type = "daily", customTopic, newsLinks, spotlightCard, spotlightNotes, notes, source = "manual" } = req.body;
      const task = await storage.createNewsletterTask({
        type,
        customTopic: customTopic || null,
        newsLinks: newsLinks || null,
        spotlightCard: spotlightCard || null,
        spotlightNotes: spotlightNotes || null,
        notes: notes || null,
        status: "pending",
        source,
        createdAt: new Date().toISOString(),
        usedAt: null,
      });
      res.json(task);
    } catch (err: any) {
      res.status(500).json({ error: "Failed to create task" });
    }
  });

  app.put("/api/admin/newsletter/tasks/:id/status", requireAdmin, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const { status } = req.body as { status: string };
      await storage.updateNewsletterTaskStatus(id, status);
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: "Failed to update task" });
    }
  });

  app.delete("/api/admin/newsletter/tasks/:id", requireAdmin, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      await storage.deleteNewsletterTask(id);
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: "Failed to delete task" });
    }
  });

  // ── Settings (editable prompts) ───────────────────────────

  app.get("/api/admin/settings", requireAdmin, async (_req, res) => {
    try {
      const all = await storage.getAllSettings();
      const map: Record<string, string> = {};
      for (const s of all) map[s.key] = s.value;
      res.json(map);
    } catch (err: any) {
      res.status(500).json({ error: "Failed to fetch settings" });
    }
  });

  app.put("/api/admin/settings/:key", requireAdmin, async (req, res) => {
    try {
      const { key } = req.params;
      const { value } = req.body as { value: string };
      if (!value || typeof value !== "string") {
        return res.status(400).json({ error: "Value is required" });
      }
      await storage.setSetting(key, value);
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: "Failed to save setting" });
    }
  });

  // ── Traffic tracking ──────────────────────────────────────

  app.post("/api/track", async (req, res) => {
    try {
      const { page, source, medium, campaign, referrer } = req.body;
      const sessionId = req.headers["x-session-id"] as string || "unknown";
      const userAgent = req.headers["user-agent"] || "";

      await storage.recordPageVisit({
        sessionId,
        page: page || "/",
        source: source || null,
        medium: medium || null,
        campaign: campaign || null,
        referrer: referrer || null,
        userAgent: userAgent.substring(0, 500),
        createdAt: new Date().toISOString(),
      });

      res.json({ ok: true });
    } catch (err) {
      // Don't fail silently — tracking shouldn't break the site
      res.json({ ok: true });
    }
  });

  app.get("/api/admin/traffic", requireAdmin, async (_req, res) => {
    try {
      const allVisits = await db.select().from(pageVisitsTable);

      // Group by source
      const bySource: Record<string, { visitors: number; pages: Record<string, number> }> = {};
      for (const v of allVisits) {
        // Determine source label
        let src = v.source || "direct";
        if (!v.source && v.referrer) {
          try {
            const hostname = new URL(v.referrer).hostname.replace("www.", "");
            if (hostname.includes("google")) src = "google";
            else if (hostname.includes("reddit")) src = "reddit";
            else if (hostname.includes("twitter") || hostname.includes("x.com")) src = "twitter";
            else if (hostname.includes("discord")) src = "discord";
            else if (hostname.includes("facebook") || hostname.includes("fb.com")) src = "facebook";
            else if (hostname.includes("bluesky") || hostname.includes("bsky")) src = "bluesky";
            else if (hostname.includes("youtube")) src = "youtube";
            else src = hostname;
          } catch { src = "unknown"; }
        }

        if (!bySource[src]) bySource[src] = { visitors: 0, pages: {} };
        bySource[src].visitors++;
        bySource[src].pages[v.page] = (bySource[src].pages[v.page] || 0) + 1;
      }

      // Sort by visitors desc
      const sources = Object.entries(bySource)
        .map(([source, data]) => ({ source, ...data }))
        .sort((a, b) => b.visitors - a.visitors);

      // Daily visits (last 30 days)
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
      const recentVisits = allVisits.filter(v => v.createdAt > thirtyDaysAgo);
      const dailyVisits: Record<string, number> = {};
      for (const v of recentVisits) {
        const day = v.createdAt.split("T")[0];
        dailyVisits[day] = (dailyVisits[day] || 0) + 1;
      }

      // By campaign
      const byCampaign: Record<string, number> = {};
      for (const v of allVisits) {
        if (v.campaign) {
          byCampaign[v.campaign] = (byCampaign[v.campaign] || 0) + 1;
        }
      }

      // Unique sessions
      const uniqueSessions = new Set(allVisits.map(v => v.sessionId)).size;

      // By page
      const byPage: Record<string, number> = {};
      for (const v of allVisits) {
        byPage[v.page] = (byPage[v.page] || 0) + 1;
      }

      res.json({
        totalVisits: allVisits.length,
        uniqueVisitors: uniqueSessions,
        sources,
        dailyVisits,
        byCampaign,
        byPage,
      });
    } catch (err: any) {
      console.error("Traffic analytics error:", err);
      res.status(500).json({ error: "Failed to generate traffic analytics" });
    }
  });

  return httpServer;
}
