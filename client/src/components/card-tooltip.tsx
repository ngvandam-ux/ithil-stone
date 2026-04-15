import { useState, useRef, useEffect, useCallback, useMemo } from "react";

/**
 * CardTooltip — Hover over any MTG card name to see its Scryfall image.
 * Uses the Scryfall `/cards/named?exact=...&format=image` redirect endpoint
 * which returns a 302 to the actual card image (no API key needed).
 *
 * Features:
 * - Lazy loads images only on hover
 * - Caches results (both hits and misses) so repeated hovers are instant
 * - Gracefully falls back to plain text for non-card bold text
 * - Positions tooltip intelligently (above/below, left/right) to stay in viewport
 * - Links to Scryfall page on click
 */

// Cache: card name → { exists: boolean; imageUrl?: string; scryfallUrl?: string }
const cardCache = new Map<
  string,
  { exists: boolean; imageUrl?: string; scryfallUrl?: string }
>();

// Pending fetches to avoid duplicate requests
const pendingFetches = new Map<string, Promise<boolean>>();

// Rate-limited queue for Scryfall API (max 8 req/s to stay under 10/s limit)
const fetchQueue: Array<() => void> = [];
let fetchInFlight = 0;
const MAX_CONCURRENT = 8;

function enqueueFetch(fn: () => Promise<void>) {
  const run = async () => {
    fetchInFlight++;
    try { await fn(); } finally {
      fetchInFlight--;
      // Process next in queue after a small delay
      setTimeout(() => {
        const next = fetchQueue.shift();
        if (next) next();
      }, 120);
    }
  };
  if (fetchInFlight < MAX_CONCURRENT) {
    run();
  } else {
    fetchQueue.push(run);
  }
}

// Names that are definitely NOT card names (common markdown labels)
const NOT_CARD_NAMES = new Set([
  "speed",
  "consistency",
  "resilience",
  "disruption",
  "overall",
  "must-add",
  "strong upgrades",
  "spicy tech",
  "budget swaps",
  "mid-range upgrades",
  "premium staples",
  "favorable",
  "unfavorable",
  "even",
  "competitive",
  "strong",
  "situational",
  "note",
  "tip",
  "warning",
  "important",
  "key takeaway",
  "summary",
  "verdict",
  "rating",
  "score",
  "deck archetype",
  "power assessment",
  "strengths",
  "weaknesses",
  "mana base",
  "key synergies",
  "combo discovery",
  "sideboard guide",
  "meta positioning",
  "upgrade path",
]);

// Land cards — skip tooltip/API calls (no useful visual, saves Scryfall requests)
const LAND_NAMES = new Set([
  // Basic lands
  "plains", "island", "swamp", "mountain", "forest", "wastes",
  // Snow basics
  "snow-covered plains", "snow-covered island", "snow-covered swamp",
  "snow-covered mountain", "snow-covered forest",
  // Common fetches
  "flooded strand", "polluted delta", "bloodstained mire",
  "wooded foothills", "windswept heath", "scalding tarn",
  "misty rainforest", "verdant catacombs", "arid mesa", "marsh flats",
  // Common shocks
  "hallowed fountain", "watery grave", "blood crypt", "stomping ground",
  "temple garden", "godless shrine", "steam vents", "overgrown tomb",
  "sacred foundry", "breeding pool",
  // Common fast/check/pain/filter lands & utility
  "inspiring vantage", "spirebluff canal", "blooming marsh",
  "concealed courtyard", "botanical sanctum", "blackcleave cliffs",
  "copperline gorge", "darkslick shores", "razorverge thicket",
  "seachrome coast",
  // Triomes
  "indatha triome", "ketria triome", "raugrin triome",
  "savai triome", "zagoth triome", "jetmir's garden",
  "raffine's tower", "spara's headquarters", "xander's lounge",
  "ziatora's proving ground",
  // Misc utility lands
  "cavern of souls", "ancient tomb", "city of brass",
  "mana confluence", "gemstone caverns", "urza's saga",
  "field of the dead", "castle locthwain", "castle vantress",
  "castle embereth", "castle garenbrig", "castle ardenvale",
  "fabled passage", "prismatic vista", "fiery islet",
  "sunbaked canyon", "waterlogged grove", "nurturing peatland",
  "silent clearing", "horizon canopy",
  // Pioneer/Standard common duals
  "shattered sanctum", "stormcarved coast", "deathcap glade",
  "sundown pass", "dreamroot cascade", "haunted ridge",
  "overgrown farmland", "deserted beach", "shipwreck marsh",
  "rockfall vale",
  // Generic land references the AI might bold
  "basic land", "basic lands", "fetch land", "fetch lands",
  "shock land", "shock lands", "dual land", "dual lands",
  "pain land", "pain lands", "check land", "check lands",
  "fast land", "fast lands", "filter land", "filter lands",
  "utility land", "utility lands", "man land", "man lands",
  "creature land", "creature lands", "triome", "triomes",
]);

function isLikelyLabel(text: string): boolean {
  const lower = text.toLowerCase().trim();
  if (NOT_CARD_NAMES.has(lower)) return true;
  if (LAND_NAMES.has(lower)) return true;
  // Pure numbers like "7/10" or "$5.99"
  if (/^\d/.test(lower) && /\/\d+$/.test(lower)) return true;
  if (/^\$/.test(lower)) return true;
  // Single word common English words that aren't card names
  if (lower.length <= 2) return true;
  return false;
}

function prefetchCard(cardName: string): Promise<boolean> {
  const key = cardName.toLowerCase();

  if (cardCache.has(key)) {
    return Promise.resolve(cardCache.get(key)!.exists);
  }

  if (pendingFetches.has(key)) {
    return pendingFetches.get(key)!;
  }

  let resolve: (val: boolean) => void;
  const fetchPromise = new Promise<boolean>((r) => { resolve = r; });
  pendingFetches.set(key, fetchPromise);

  enqueueFetch(async () => {
    try {
      const res = await fetch(
        `https://api.scryfall.com/cards/named?exact=${encodeURIComponent(cardName)}`,
        { method: "GET" }
      );
      if (!res.ok) {
        cardCache.set(key, { exists: false });
        resolve!(false);
        return;
      }
      const data = await res.json();
      const imageUrl =
        data.image_uris?.normal ||
        data.card_faces?.[0]?.image_uris?.normal ||
        null;
      const scryfallUrl = data.scryfall_uri || null;
      cardCache.set(key, {
        exists: !!imageUrl,
        imageUrl: imageUrl || undefined,
        scryfallUrl: scryfallUrl || undefined,
      });
      resolve!(!!imageUrl);
    } catch {
      cardCache.set(key, { exists: false });
      resolve!(false);
    } finally {
      pendingFetches.delete(key);
    }
  });

  return fetchPromise;
}

interface CardTooltipProps {
  cardName: string;
  children: React.ReactNode;
  /** Optional: set of known deck card names (pre-verified, skip Scryfall check) */
  knownCards?: Set<string>;
}

export default function CardTooltip({
  cardName,
  children,
  knownCards,
}: CardTooltipProps) {
  const [showTooltip, setShowTooltip] = useState(false);
  // Pre-strip punctuation to compute initial state
  const cleanNameInit = cardName.replace(/[:.,;!?]+$/, "").trim();
  const keyInit = cleanNameInit.toLowerCase();
  const isKnown = !isLikelyLabel(cleanNameInit) && !!knownCards?.has(keyInit);
  const [isCard, setIsCard] = useState<boolean | null>(isKnown ? true : null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [scryfallUrl, setScryfallUrl] = useState<string | null>(null);
  const [position, setPosition] = useState<{
    top: boolean;
    left: boolean;
  }>({ top: true, left: false });
  const triggerRef = useRef<HTMLSpanElement>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout>>();
  const hoverStartRef = useRef<number>(0);

  // Strip trailing punctuation (colon, period, comma) from card name for lookup
  const cleanName = cardName.replace(/[:.,;!?]+$/, "").trim();
  const key = cleanName.toLowerCase();

  // Quick check if this is obviously not a card name
  const isLabel = isLikelyLabel(cleanName);

  // Eagerly verify card on mount so link styling shows immediately
  useEffect(() => {
    if (isLabel) return;
    // If it's a known deck card, mark it and prefetch image
    if (knownCards?.has(key)) {
      setIsCard(true);
      setScryfallUrl(`https://scryfall.com/search?q=${encodeURIComponent(`!"${cleanName}"`)}`);  
      // Also prefetch image data into cache
      prefetchCard(cleanName).then(() => {
        const data = cardCache.get(key);
        if (data?.imageUrl) setImageUrl(data.imageUrl);
        if (data?.scryfallUrl) setScryfallUrl(data.scryfallUrl);
      });
      return;
    }
    // Check cache
    const cached = cardCache.get(key);
    if (cached) {
      setIsCard(cached.exists);
      if (cached.exists) {
        setImageUrl(cached.imageUrl || null);
        setScryfallUrl(cached.scryfallUrl || null);
      }
      return;
    }
    // Pre-fetch from Scryfall in background
    prefetchCard(cleanName).then((exists) => {
      setIsCard(exists);
      if (exists) {
        const data = cardCache.get(key);
        if (data?.imageUrl) setImageUrl(data.imageUrl);
        if (data?.scryfallUrl) setScryfallUrl(data.scryfallUrl);
      }
    });
  // Only run on mount / when card name changes
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cleanName, key]);

  const handleMouseEnter = useCallback(() => {
    if (isLabel) return;
    hoverStartRef.current = Date.now();

    timeoutRef.current = setTimeout(async () => {
      // Calculate position
      if (triggerRef.current) {
        const rect = triggerRef.current.getBoundingClientRect();
        const spaceAbove = rect.top;
        const spaceBelow = window.innerHeight - rect.bottom;
        const spaceRight = window.innerWidth - rect.left;

        setPosition({
          top: spaceAbove > 340 || spaceAbove > spaceBelow,
          left: spaceRight < 280,
        });
      }

      // If we already have the image URL cached (from eager prefetch), show immediately
      if (imageUrl) {
        setShowTooltip(true);
        return;
      }

      // Check cache
      const cached = cardCache.get(key);
      if (cached) {
        setIsCard(cached.exists);
        if (cached.exists) {
          setImageUrl(cached.imageUrl || null);
          setScryfallUrl(cached.scryfallUrl || null);
          setShowTooltip(true);
        }
        return;
      }

      // If it's a known deck card, show tooltip immediately with constructed URL
      if (knownCards?.has(key)) {
        const imgUrl = `https://api.scryfall.com/cards/named?exact=${encodeURIComponent(cleanName)}&format=image&version=normal`;
        setIsCard(true);
        setImageUrl(imgUrl);
        setScryfallUrl(
          `https://scryfall.com/search?q=${encodeURIComponent(`!"${cleanName}"`)}`
        );
        setShowTooltip(true);
        return;
      }

      // Fetch from Scryfall
      const exists = await prefetchCard(cleanName);
      setIsCard(exists);
      if (exists) {
        const data = cardCache.get(key);
        setImageUrl(data?.imageUrl || null);
        setScryfallUrl(data?.scryfallUrl || null);
        setShowTooltip(true);
      }
    }, 120);
  }, [cleanName, key, isLabel, knownCards, imageUrl]);

  const handleMouseLeave = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }
    setShowTooltip(false);
  }, []);

  useEffect(() => {
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

  // If clearly a label, just render children as-is
  if (isLabel) {
    return <>{children}</>;
  }

  return (
    <span
      ref={triggerRef}
      className="relative inline"
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      {/* The card name text — subtle underline hint for card names */}
      <span
        className={`${
          isCard === true
            ? "decoration-primary/30 underline underline-offset-2 decoration-dotted cursor-pointer"
            : isCard === false
              ? ""
              : "cursor-default"
        } transition-colors`}
        onClick={() => {
          if (scryfallUrl) {
            window.open(scryfallUrl, "_blank", "noopener");
          }
        }}
      >
        {children}
      </span>

      {/* Floating card image tooltip */}
      {showTooltip && imageUrl && (
        <span
          className={`absolute z-50 pointer-events-none
            ${position.top ? "bottom-full mb-2" : "top-full mt-2"}
            ${position.left ? "right-0" : "left-0"}
          `}
          style={{ width: 244 }}
        >
          <span className="block rounded-xl overflow-hidden shadow-2xl shadow-black/60 ring-1 ring-white/10">
            <img
              src={imageUrl}
              alt={cardName}
              className="w-full h-auto block"
              loading="eager"
              style={{ aspectRatio: "488/680" }}
            />
          </span>
        </span>
      )}
    </span>
  );
}

/**
 * Utility: Extract all unique card names from a decklist string.
 * Returns a lowercase Set for O(1) lookup.
 */
export function extractDeckCardNames(decklist: string): Set<string> {
  const names = new Set<string>();
  for (const line of decklist.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("//") || trimmed.startsWith("#")) continue;
    const lower = trimmed.toLowerCase();
    if (
      lower === "sideboard" || lower === "sideboard:" ||
      lower === "mainboard" || lower === "mainboard:" ||
      lower === "deck" || lower === "deck:" ||
      lower === "commander" || lower === "commander:"
    ) continue;

    const match = trimmed.match(/^\d+\s*x?\s+(.+)$/i);
    if (match) {
      names.add(match[1].trim().toLowerCase());
    }
  }
  return names;
}
